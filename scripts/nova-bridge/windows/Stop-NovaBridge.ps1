[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'Common-NovaBridge.ps1')
$novaCurrent = Get-NovaProcess
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'bridge-stopped.json'), '{"intentionallyStopped":true}', [Text.UTF8Encoding]::new($false))
if (-not $novaCurrent) { Write-Output 'Nova Bridge çalışmıyor. Açıkça başlatana kadar otomatik başlangıç durduruldu.'; return }
$novaStopPath = Join-Path $PSScriptRoot 'stop-request.json'
$novaStopTemp = Join-Path $PSScriptRoot ('stop-request.' + [Guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllText($novaStopTemp, (@{instanceId=$novaCurrent.Record.instanceId} | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $novaStopTemp -Destination $novaStopPath -Force
for ($novaAttempt = 0; $novaAttempt -lt 20; $novaAttempt++) {
  if (-not (Get-NovaProcess)) { Write-Output 'Nova Bridge güvenli biçimde durduruldu. Bekleyen mesajlar korunuyor.'; return }
  Start-Sleep -Milliseconds 500
}
Write-Output 'Durdurma isteği iletildi; etkin işlemin iptali bekleniyor. Zorla sonlandırma yapılmadı.'
