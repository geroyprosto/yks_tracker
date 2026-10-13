[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'Common-NovaBridge.ps1')
$novaExistingCredential = Join-Path $env:LOCALAPPDATA 'YKSim\NovaBridge\device.dpapi'
if (Test-Path -LiteralPath $novaExistingCredential) { throw 'Mevcut cihaz kimliği korunuyor. Yeniden eşleştirme için önce Nova Lab üzerinden cihazı iptal edin.' }
$novaNode = Get-NovaNode
Set-NovaConfiguration $novaNode
& $novaNode (Join-Path $PSScriptRoot 'bridge.cjs') pair --name 'Çalışma bilgisayarım'
exit $LASTEXITCODE
