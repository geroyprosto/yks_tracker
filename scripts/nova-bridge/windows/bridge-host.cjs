/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomUUID, createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
if (process.platform !== 'win32') { console.error('Bu başlatıcı Windows içindir.'); process.exit(1); }
const lockPath = path.join(__dirname, 'bridge-process.json');
const stopPath = path.join(__dirname, 'stop-request.json');
const instanceId = randomUUID();
const lock = { pid: process.pid, instanceId, startedAt: new Date().toISOString(), hostPath: __filename };
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
// The OS releases this exclusive pipe even after an abnormal exit. The JSON
// record is diagnostic; it is never the mutual-exclusion mechanism.
const scope = path.resolve(process.env.LOCALAPPDATA || __dirname).toLowerCase();
const pipeName = '\\\\.\\pipe\\YKSim-NovaBridge-' + createHash('sha256').update(scope).digest('hex').slice(0, 24);
const guard = net.createServer(socket => socket.destroy());
let watcher;
guard.once('error', () => { console.error('Nova Bridge zaten çalışıyor veya çalışma kilidi alınamadı.'); process.exitCode = 1; });
function assertNoLiveRecordedProcess() {
  if (!fs.existsSync(lockPath)) return;
  const prior = readJson(lockPath);
  if (!Number.isSafeInteger(prior.pid) || prior.pid < 1) throw new Error('INVALID_LOCK');
  let alive = true;
  try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  if (alive) throw new Error('ALREADY_RUNNING');
}
async function publishRecord(temporary) {
  for (let attempt = 0; ; attempt++) {
    // A legacy file-only host may appear during a retry. Keep its live PID
    // protected even though this version holds the exclusive OS pipe.
    assertNoLiveRecordedProcess();
    try { await fs.promises.rename(temporary, lockPath); return; }
    catch (error) {
      // Windows readers briefly prevent replacing an otherwise writable file.
      // Retry only that sharing failure, for at most 500 ms; never delete the
      // existing record or publish partially written JSON.
      if (!['EPERM', 'EACCES'].includes(error.code) || attempt >= 20) throw error;
      await delay(25);
    }
  }
}
guard.listen(pipeName, async () => {
  try {
    // A previous installer may still use a file-only host. Never replace the
    // record of any live PID, even when identity is uncertain.
    assertNoLiveRecordedProcess();
    const temporary = lockPath + '.' + instanceId + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(lock), { flag: 'wx' });
    await publishRecord(temporary);
  } catch {
    guard.close(); console.error('Bridge başlatılamadı. Mevcut işlem kaydını ve klasör izinlerini kontrol edin.'); process.exitCode = 1; return;
  }
  guard.unref();
  let stopping = false;
  watcher = setInterval(() => {
    if (stopping || !fs.existsSync(stopPath)) return;
    try {
      if (readJson(stopPath).instanceId !== instanceId) return;
      stopping = true; process.emit('SIGTERM');
      // An approved stop must not depend on deleting a briefly shared file.
      try { if (readJson(stopPath).instanceId === instanceId) fs.unlinkSync(stopPath); } catch {}
    } catch { /* Incomplete or stale requests cannot stop another instance. */ }
  }, 250);
  watcher.unref();
  process.argv = [process.execPath, path.join(__dirname, 'bridge.cjs'), 'start', ...process.argv.slice(2)];
  require('./bridge.cjs');
});
process.once('exit', () => {
  clearInterval(watcher);
  try { if (readJson(lockPath).instanceId === instanceId) fs.unlinkSync(lockPath); } catch { /* No owned record remains. */ }
});
