/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomUUID, createHash } = require('node:crypto');
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
guard.listen(pipeName, () => {
  guard.unref();
  try {
    // A previous installer may still use a file-only host. Never replace the
    // record of any live PID, even when identity is uncertain.
    if (fs.existsSync(lockPath)) {
      const prior = readJson(lockPath);
      if (!Number.isSafeInteger(prior.pid) || prior.pid < 1) throw new Error('INVALID_LOCK');
      let alive = true;
      try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      if (alive) throw new Error('ALREADY_RUNNING');
    }
    const temporary = lockPath + '.' + instanceId + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(lock), { flag: 'wx' });
    fs.renameSync(temporary, lockPath);
  } catch {
    guard.close(); console.error('Bridge başlatılamadı. Mevcut işlem kaydını ve klasör izinlerini kontrol edin.'); process.exitCode = 1; return;
  }
  let stopping = false;
  watcher = setInterval(() => {
    if (stopping || !fs.existsSync(stopPath)) return;
    try {
      if (readJson(stopPath).instanceId !== instanceId) return;
      stopping = true; fs.unlinkSync(stopPath); process.emit('SIGTERM');
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
