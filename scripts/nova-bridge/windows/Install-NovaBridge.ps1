[CmdletBinding()]
param([switch]$CreateStartMenuShortcuts, [switch]$EnableStartup)
$ErrorActionPreference = 'Stop'
$novaInstallRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'YKSim\NovaBridge'))
$novaExpectedRoot = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'YKSim\NovaBridge'))
if ($novaInstallRoot -ne $novaExpectedRoot) { throw 'Kurulum hedefi beklenen Windows kullanıcı klasörüyle eşleşmiyor.' }
if (Test-Path -LiteralPath $novaInstallRoot) {
  $novaTargetItem = Get-Item -LiteralPath $novaInstallRoot
  if (($novaTargetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Kurulum hedefi yönlendirilmiş bir klasör olamaz.' }
  if (Test-Path -LiteralPath (Join-Path $novaInstallRoot 'bridge-process.json')) {
    $novaOldLock = Get-Content -Raw -LiteralPath (Join-Path $novaInstallRoot 'bridge-process.json') | ConvertFrom-Json
    if (Get-Process -Id ([int]$novaOldLock.pid) -ErrorAction SilentlyContinue) { throw 'Kurulumdan önce mevcut Nova Bridge işlemini durdurun.' }
  }
}
$novaFiles = @('bridge.cjs', 'bridge-host.cjs', 'config.cjs', 'bridge-config.example.json', 'Common-NovaBridge.ps1', 'Install-NovaBridge.ps1', 'Start-NovaBridge.ps1', 'Stop-NovaBridge.ps1', 'Pair-NovaBridge.ps1', 'Doctor-NovaBridge.ps1', 'manifest.json', 'README.md')
foreach ($novaFile in $novaFiles) { if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $novaFile) -PathType Leaf)) { throw ('Paket dosyası eksik: ' + $novaFile) } }
$novaManifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') | ConvertFrom-Json
foreach ($novaFile in $novaFiles) {
  if ($novaFile -eq 'manifest.json') { continue }
  $novaExpectedHash = $novaManifest.files.$novaFile
  $novaActualHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $novaFile) -Algorithm SHA256).Hash
  if (-not $novaExpectedHash -or $novaActualHash -ne $novaExpectedHash) { throw ('Paket bütünlük kontrolü başarısız: ' + $novaFile) }
}
. (Join-Path $PSScriptRoot 'Common-NovaBridge.ps1')
$novaNode = Get-NovaNode
New-Item -ItemType Directory -Path $novaInstallRoot -Force | Out-Null
foreach ($novaFile in $novaFiles) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $novaFile) -Destination (Join-Path $novaInstallRoot $novaFile) -Force }
# Credentials, intentional-stop choice, and an existing explicit model config are preserved.
$novaConfigPath = Join-Path $novaInstallRoot 'bridge-config.json'
if (-not (Test-Path -LiteralPath $novaConfigPath)) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bridge-config.example.json') -Destination $novaConfigPath }
$novaShell = $null
function New-NovaShortcut([string]$shortcutPath, [string]$scriptName, [bool]$hidden, [string]$extraArguments = '') {
  if (-not $script:novaShell) { $script:novaShell = New-Object -ComObject WScript.Shell }
  $novaShortcut = $script:novaShell.CreateShortcut($shortcutPath)
  $novaShortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $novaWindow = if ($hidden) { '-WindowStyle Hidden ' } else { '-NoExit ' }
  $novaShortcut.Arguments = '-NoLogo -NoProfile ' + $novaWindow + '-ExecutionPolicy Bypass -File "' + (Join-Path $novaInstallRoot $scriptName) + '" ' + $extraArguments
  $novaShortcut.WorkingDirectory = $novaInstallRoot
  $novaShortcut.WindowStyle = if ($hidden) { 7 } else { 1 }
  $novaShortcut.Save()
}
if ($CreateStartMenuShortcuts) {
  $novaShortcutRoot = Join-Path ([Environment]::GetFolderPath('Programs')) 'YKSim Nova'
  New-Item -ItemType Directory -Path $novaShortcutRoot -Force | Out-Null
  New-NovaShortcut (Join-Path $novaShortcutRoot 'Nova Başlat.lnk') 'Start-NovaBridge.ps1' $true
  New-NovaShortcut (Join-Path $novaShortcutRoot 'Nova Durdur.lnk') 'Stop-NovaBridge.ps1' $true
  New-NovaShortcut (Join-Path $novaShortcutRoot 'Nova Model Kontrolü.lnk') 'Doctor-NovaBridge.ps1' $false
  New-NovaShortcut (Join-Path $novaShortcutRoot 'Nova Cihaz Eşleştir.lnk') 'Pair-NovaBridge.ps1' $false
}
Update-NovaStartupShortcut (Join-Path ([Environment]::GetFolderPath('Startup')) 'YKSim Nova Bridge.lnk') $EnableStartup.IsPresent {
  param($novaShortcutPath)
  New-NovaShortcut $novaShortcutPath 'Start-NovaBridge.ps1' $true '-FromStartup'
}
Write-Output ('Nova Bridge dosyaları kuruldu: ' + $novaInstallRoot)
Write-Output 'Mevcut cihaz kimliği ve model ayarı korundu. Bridge bu kurulum tarafından başlatılmadı.'
