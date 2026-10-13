[CmdletBinding()]
param([switch]$FromStartup)
. (Join-Path $PSScriptRoot 'Common-NovaBridge.ps1')
$novaStopped = Join-Path $PSScriptRoot 'bridge-stopped.json'
if ($FromStartup -and (Test-Path -LiteralPath $novaStopped)) { Write-Output 'Nova Bridge kullanıcı tarafından durdurulmuş; otomatik başlatılmadı.'; return }
if (Get-NovaProcess) { Write-Output 'Nova Bridge zaten çalışıyor.'; return }
$novaCredentialPath = Join-Path $env:LOCALAPPDATA 'YKSim\NovaBridge\device.dpapi'
if (-not (Test-Path -LiteralPath $novaCredentialPath)) { throw 'Cihaz eşleştirilmemiş. Önce Pair-NovaBridge.ps1 dosyasını çalıştırın.' }
$novaNode = Get-NovaNode
Set-NovaConfiguration $novaNode
if (Test-Path -LiteralPath $novaStopped) { Remove-Item -LiteralPath $novaStopped }
$novaHost = Join-Path $PSScriptRoot 'bridge-host.cjs'
$novaProcess = Start-Process -FilePath $novaNode -ArgumentList ('"' + $novaHost + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'bridge-status.log') -RedirectStandardError (Join-Path $PSScriptRoot 'bridge-error.log') -PassThru
Start-Sleep -Milliseconds 1200
if ($novaProcess.HasExited) { throw 'Bridge başlatılamadı. Doctor-NovaBridge.ps1 ve bridge-error.log dosyasını kontrol edin.' }
if (-not (Get-NovaProcess)) { throw 'Bridge işlem kaydı doğrulanamadı. Doctor-NovaBridge.ps1 dosyasını kontrol edin.' }
Write-Output ('Nova Bridge arka planda başlatıldı. İşlem: ' + $novaProcess.Id)
