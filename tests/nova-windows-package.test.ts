import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const source = fileURLToPath(new URL('../scripts/nova-bridge/windows/', import.meta.url));
const { validateConfig } = createRequire(import.meta.url)(path.join(source, 'config.cjs')) as {
  validateConfig: (value: unknown) => { model: string; keepAlive: string; pollMs: number };
};
test('Windows package config keeps explicit model choice and rejects secrets, remote inference and invalid timings', async () => {
  const defaults = JSON.parse(await readFile(path.join(source, 'bridge-config.example.json'), 'utf8'));
  assert.equal(validateConfig(defaults).model, 'qwen3:8b');
  assert.equal(validateConfig({ ...defaults, model: 'qwen3.5:9b', keepAlive: '5m', pollMs: 15000 }).model, 'qwen3.5:9b');
  for (const edit of [
    { token: 'must-not-be-in-config' }, { model: 'large:cloud' }, { model: '--help' },
    { ollamaUrl: 'https://example.com' }, { ollamaUrl: 'http://127.0.0.1:11434/api' },
    { appUrl: 'https://user:password@example.com' }, { keepAlive: '-1' }, { keepAlive: '3h' },
    { pollMs: 1000 }, { timeoutMs: 120001 },
  ]) assert.throws(() => validateConfig({ ...defaults, ...edit }), /NOVA_CONFIG_/);
});

const waitFor = async (check: () => Promise<boolean>, message: string) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.fail(message);
};

test('Windows host excludes duplicate instances, recovers stale record and stops only for its own request', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'NovaHostTest-'));
  const children: ChildProcess[] = [];
  try {
    for (const name of ['bridge-host.cjs', 'Common-NovaBridge.ps1', 'Stop-NovaBridge.ps1', 'Start-NovaBridge.ps1']) {
      const text = await readFile(path.join(source, name), 'utf8');
      await writeFile(path.join(directory, name), (name.endsWith('.ps1') ? '\uFEFF' : '') + text.replace(/^\uFEFF/u, ''));
    }
    await writeFile(path.join(directory, 'bridge.cjs'), `const timer=setInterval(()=>{},100);process.once('SIGTERM',()=>clearInterval(timer));`);
    const lockPath = path.join(directory, 'bridge-process.json');
    await writeFile(lockPath, JSON.stringify({ pid: 2000000000, instanceId: 'stale-instance' }));
    const local = path.join(directory, 'isolated-local');
    await mkdir(local);
    const start = (folder = directory) => {
      const child = spawn(process.execPath, [path.join(folder, 'bridge-host.cjs')], { env: { ...process.env, LOCALAPPDATA: local }, windowsHide: true, stdio: 'ignore' });
      children.push(child); return child;
    };
    const first = start();
    await waitFor(async () => JSON.parse(await readFile(lockPath, 'utf8')).pid === first.pid, 'First fake host did not start');
    const active = JSON.parse(await readFile(lockPath, 'utf8'));
    const secondFolder = path.join(directory, 'second');
    await mkdir(secondFolder);
    await copyFile(path.join(directory, 'bridge-host.cjs'), path.join(secondFolder, 'bridge-host.cjs'));
    await copyFile(path.join(directory, 'bridge.cjs'), path.join(secondFolder, 'bridge.cjs'));
    const second = start(secondFolder);
    await waitFor(async () => second.exitCode !== null, 'Duplicate fake host was not refused');
    assert.equal(second.exitCode, 1);
    await writeFile(path.join(directory, 'stop-request.json'), JSON.stringify({ instanceId: 'unrelated' }));
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(first.exitCode, null);
    await writeFile(lockPath, JSON.stringify({ ...active, pid: process.pid }));
    assert.throws(() => execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'Stop-NovaBridge.ps1')], { windowsHide: true, stdio: 'pipe', env: { ...process.env, LOCALAPPDATA: local }, timeout: 5000 }));
    assert.equal(first.exitCode, null);
    await writeFile(lockPath, JSON.stringify(active));
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'Stop-NovaBridge.ps1')], { windowsHide: true, stdio: 'pipe', env: { ...process.env, LOCALAPPDATA: local }, timeout: 15000 });
    await waitFor(async () => first.exitCode !== null, 'Matched graceful stop did not finish');
    assert.equal(first.exitCode, 0);
    await assert.rejects(() => readFile(lockPath), /ENOENT/);
    assert.ok(active.instanceId);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'bridge-stopped.json'), 'utf8')), { intentionallyStopped: true });
    // No credentials/config exist in this isolated folder; startup must return
    // before trying either and must not relaunch the intentionally stopped host.
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'Start-NovaBridge.ps1'), '-FromStartup'], { windowsHide: true, stdio: 'pipe', env: { ...process.env, LOCALAPPDATA: local }, timeout: 5000 });
    await assert.rejects(() => readFile(lockPath), /ENOENT/);
    const interrupted = start();
    await waitFor(async () => { try { return JSON.parse(await readFile(lockPath, 'utf8')).pid === interrupted.pid; } catch { return false; } }, 'Fake host did not restart');
    interrupted.kill();
    await waitFor(async () => interrupted.exitCode !== null || interrupted.signalCode !== null, 'Fake crash did not stop');
    const recovered = start();
    await waitFor(async () => { try { return JSON.parse(await readFile(lockPath, 'utf8')).pid === recovered.pid; } catch { return false; } }, 'OS guard was not released after fake crash');
    const recoveredLock = JSON.parse(await readFile(lockPath, 'utf8'));
    await writeFile(path.join(directory, 'stop-request.json'), JSON.stringify({ instanceId: recoveredLock.instanceId }));
    await waitFor(async () => recovered.exitCode !== null, 'Recovered fake host did not stop');
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('all Windows package PowerShell sources parse without execution', { skip: process.platform !== 'win32' }, () => {
  const escaped = source.replaceAll("'", "''");
  const code = `$ErrorActionPreference='Stop'; $novaErrors=@(); Get-ChildItem -LiteralPath '${escaped}' -Filter '*.ps1' | ForEach-Object { $novaTokens=$null; $novaParse=$null; [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$novaTokens,[ref]$novaParse) | Out-Null; $novaErrors += $novaParse }; if($novaErrors.Count) { throw ($novaErrors.Message -join ', ') }`;
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' });
});

test('Windows PowerShell 5.1 resolves Node 24 without passing quoted JavaScript to native arguments', { skip: process.platform !== 'win32' }, () => {
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const code = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; . ${quote(path.join(source, 'Common-NovaBridge.ps1'))}; $novaExecutable=Get-NovaNode; [pscustomobject]@{powershellMajor=$PSVersionTable.PSVersion.Major; node=$novaExecutable; version=(& $novaExecutable --version)} | ConvertTo-Json -Compress`;
  const result = JSON.parse(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })) as { powershellMajor: number; node: string; version: string };
  assert.equal(result.powershellMajor, 5);
  assert.equal(path.resolve(result.node).toLowerCase(), path.resolve(process.execPath).toLowerCase());
  assert.equal(result.version.trim(), `v${process.versions.node}`);
});

test('Windows native Node check rejects old, malformed and failed version output', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'NovaNodeVersionTest-'));
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  try {
    const fakeNode = path.join(directory, 'fake-node.cmd');
    for (const [version, exitCode] of [['v23.19.0', 0], ['24.19.0', 0], ['invalid', 0], ['v24.19.0', 1]] as const) {
      await writeFile(fakeNode, `@echo off\r\necho ${version}\r\nexit /b ${exitCode}\r\n`);
      const code = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; . ${quote(path.join(source, 'Common-NovaBridge.ps1'))}; function Get-Command { [pscustomobject]@{Source=${quote(fakeNode)}} }; $novaRejected=$false; try { Get-NovaNode | Out-Null } catch { $novaRejected=$true }; if(-not $novaRejected) {throw 'Unsupported native Node version was accepted'}`;
      execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' });
    }
  } finally {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('installer upgrades an existing startup shortcut but keeps absent startup disabled without opt-in', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'NovaStartupTest-'));
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  try {
    const target = path.join(directory, 'YKSim Nova Bridge.lnk');
    const code = `. ${quote(path.join(source, 'Common-NovaBridge.ps1'))}; $novaTarget=${quote(target)}; $novaCreate={param($novaPath) [IO.File]::WriteAllText($novaPath,'-FromStartup')}; Update-NovaStartupShortcut $novaTarget $false $novaCreate; if(Test-Path -LiteralPath $novaTarget) {throw 'Unexpected startup enable'}; [IO.File]::WriteAllText($novaTarget,'legacy'); Update-NovaStartupShortcut $novaTarget $false $novaCreate; if([IO.File]::ReadAllText($novaTarget) -ne '-FromStartup') {throw 'Legacy shortcut not upgraded'}; [IO.File]::Delete($novaTarget); Update-NovaStartupShortcut $novaTarget $true $novaCreate; if([IO.File]::ReadAllText($novaTarget) -ne '-FromStartup') {throw 'Explicit startup not enabled'}`;
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' });
  } finally {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
