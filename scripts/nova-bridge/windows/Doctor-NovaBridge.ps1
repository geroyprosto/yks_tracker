[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'Common-NovaBridge.ps1')
$novaNode = Get-NovaNode
Set-NovaConfiguration $novaNode
try {
  $novaCurrent = Get-NovaProcess
  if ($novaCurrent) { Write-Output ('Bridge işlemi çalışıyor. PID: ' + $novaCurrent.Record.pid) }
  elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bridge-process.json')) { Write-Output 'Bridge çalışmıyor; eski işlem kaydı var. Bu kayıt çıkış nedenini açıklamaz.' }
  else { Write-Output 'Bridge işlemi çalışmıyor.' }
} catch { Write-Output $_.Exception.Message }
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bridge-stopped.json')) { Write-Output 'Otomatik başlangıç kullanıcı durdurma tercihini koruyor.' }
& $novaNode (Join-Path $PSScriptRoot 'bridge.cjs') doctor
exit $LASTEXITCODE
