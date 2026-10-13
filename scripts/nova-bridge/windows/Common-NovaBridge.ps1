$ErrorActionPreference = 'Stop'
function Update-NovaStartupShortcut([string]$novaStartupPath, [bool]$novaEnable, [scriptblock]$novaCreate) {
  # Upgrade the known old shortcut too, without enabling startup for a user
  # who never opted in. The callback writes only this exact shortcut path.
  if ($novaEnable -or (Test-Path -LiteralPath $novaStartupPath -PathType Leaf)) { & $novaCreate $novaStartupPath }
}
function Get-NovaNode {
  $novaExecutable = (Get-Command node -ErrorAction Stop).Source
  # Windows PowerShell 5.1 strips quotes inside native JavaScript arguments.
  # Read the native version flag so startup and installation use the same check.
  $novaVersion = & $novaExecutable --version
  if ($LASTEXITCODE -ne 0 -or $novaVersion -notmatch '^v([0-9]+)\.' -or [int]$Matches[1] -lt 24) { throw 'Node.js 24 veya sonrası gerekiyor.' }
  return $novaExecutable
}
function Set-NovaConfiguration([string]$novaExecutable) {
  $novaJson = & $novaExecutable (Join-Path $PSScriptRoot 'config.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Bridge ayarı okunamadı.' }
  $novaConfig = $novaJson | ConvertFrom-Json
  $env:NOVA_OLLAMA_MODEL = $novaConfig.model
  $env:NOVA_OLLAMA_URL = $novaConfig.ollamaUrl
  $env:NOVA_MODEL_TIMEOUT_MS = [string]$novaConfig.timeoutMs
  $env:NOVA_OLLAMA_KEEP_ALIVE = $novaConfig.keepAlive
  $env:NOVA_POLL_MS = [string]$novaConfig.pollMs
  $env:NOVA_APP_URL = $novaConfig.appUrl
  $env:OLLAMA_NO_CLOUD = '1'
}
function Get-NovaProcess {
  $novaLockPath = Join-Path $PSScriptRoot 'bridge-process.json'
  if (-not (Test-Path -LiteralPath $novaLockPath)) { return $null }
  $novaLock = Get-Content -Raw -LiteralPath $novaLockPath | ConvertFrom-Json
  if ([long]$novaLock.pid -lt 1 -or [long]$novaLock.pid -gt [int]::MaxValue -or $novaLock.instanceId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'İşlem kaydı geçersiz; hiçbir süreç değiştirilmedi.' }
  $novaProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$novaLock.pid)" -ErrorAction SilentlyContinue
  if (-not $novaProcess) { return $null }
  $novaHost = Join-Path $PSScriptRoot 'bridge-host.cjs'
  $novaPattern = '(?:^|\s)(?:"' + [Regex]::Escape($novaHost) + '"|' + [Regex]::Escape($novaHost) + ')(?:\s|$)'
  if ($novaProcess.Name -ne 'node.exe' -or -not $novaProcess.CommandLine -or $novaProcess.CommandLine -notmatch $novaPattern) { throw 'Kayıtlı PID bu Bridge ile eşleşmiyor; hiçbir süreç değiştirilmedi.' }
  $novaStarted = [DateTimeOffset]::Parse($novaLock.startedAt)
  if ([Math]::Abs((([DateTimeOffset]$novaProcess.CreationDate) - $novaStarted).TotalSeconds) -gt 10) { throw 'İşlem başlangıç zamanı eşleşmiyor; hiçbir süreç değiştirilmedi.' }
  return @{ Record = $novaLock; Process = $novaProcess }
}
