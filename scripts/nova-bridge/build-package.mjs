import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output' || !args[1].toLowerCase().endsWith('.zip')) throw new Error('Usage: node scripts/nova-bridge/build-package.mjs --output C:\\output\\Nova-Bridge-Inceleme.zip');
if (process.platform !== 'win32') throw new Error('Windows packaging requires PowerShell and .NET ZIP support.');
const output = path.resolve(args[1]);
try { await access(output); throw new Error('Output exists; choose a new review filename.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const require = createRequire(import.meta.url);
const { build, version } = createRequire(require.resolve('tsx/package.json'))('esbuild');
const files = ['bridge-host.cjs', 'config.cjs', 'bridge-config.example.json', 'Common-NovaBridge.ps1', 'Install-NovaBridge.ps1', 'Start-NovaBridge.ps1', 'Stop-NovaBridge.ps1', 'Pair-NovaBridge.ps1', 'Doctor-NovaBridge.ps1', 'README.md'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stage = await mkdtemp(path.join(tmpdir(), 'NovaBridgeBuild-'));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
try {
  const bundled = await build({ absWorkingDir: root, entryPoints: ['scripts/nova-bridge/cli.ts'], bundle: true, platform: 'node', target: 'node24', format: 'cjs', outfile: 'bridge.cjs', write: false, metafile: true, legalComments: 'none', logLevel: 'silent' });
  const manifest = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), builtAt: new Date().toISOString(), nodeMinimum: 24,
    bundler: `esbuild ${version}`, purpose: 'review-candidate', installed: false, sourceInputsSha256: '', files: {} };
  const sourceHashes = [];
  for (const input of Object.keys(bundled.metafile.inputs).sort()) {
    if (input.includes('node_modules/')) continue;
    if (!input.startsWith('src/lib/nova/') && !input.startsWith('scripts/nova-bridge/') && input !== 'evals/nova/cases.ts') throw new Error('Unexpected bundle input: ' + input);
    sourceHashes.push([input, digest(await readFile(path.join(root, input)))]);
  }
  await writeFile(path.join(stage, 'bridge.cjs'), bundled.outputFiles[0].contents);
  manifest.files['bridge.cjs'] = digest(bundled.outputFiles[0].contents);
  for (const file of files) {
    const source = await readFile(path.join(root, 'scripts/nova-bridge/windows', file));
    // Windows PowerShell 5.1 needs a BOM for Turkish text.
    const bytes = file.endsWith('.ps1') ? Buffer.from('\uFEFF' + source.toString('utf8').replace(/^\uFEFF/u, '')) : source;
    await writeFile(path.join(stage, file), bytes);
    manifest.files[file] = digest(bytes); sourceHashes.push([`windows/${file}`, digest(source)]);
  }
  manifest.sourceInputsSha256 = digest(JSON.stringify(sourceHashes));
  await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(path.dirname(output), { recursive: true });
  const allowed = ['bridge.cjs', ...files, 'manifest.json'].map(file => quote(path.join(stage, file))).join(',');
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $novaZip=[IO.Compression.ZipFile]::Open(${quote(output)},[IO.Compression.ZipArchiveMode]::Create); try { foreach($novaFile in @(${allowed})) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($novaZip,$novaFile,[IO.Path]::GetFileName($novaFile),[IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { $novaZip.Dispose() }`;
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' });
  console.log(JSON.stringify({ output, sourceCommit: manifest.sourceCommit, sourceDirty: manifest.sourceDirty, sourceInputsSha256: manifest.sourceInputsSha256, zipSha256: digest(await readFile(output)), fileCount: Object.keys(manifest.files).length + 1 }, null, 2));
} finally {
  if (path.dirname(stage) !== path.resolve(tmpdir()) || !path.basename(stage).startsWith('NovaBridgeBuild-')) throw new Error('Unsafe temporary path');
  await rm(stage, { recursive: true, force: true });
}
