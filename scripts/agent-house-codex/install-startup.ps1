$ErrorActionPreference = 'Stop'
$agentRepo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$agentNode = (Get-Command node.exe -ErrorAction Stop).Source
$agentDirectory = Join-Path $env:LOCALAPPDATA 'YKSim\agent-house'
New-Item -ItemType Directory -Path $agentDirectory -Force | Out-Null
$agentLauncher = Join-Path $agentDirectory 'publish-on-login.vbs'
$agentEntry = Join-Path $agentRepo 'scripts\agent-house-codex\publish-on-login.ts'
$agentCommand = '"' + $agentNode + '" --import tsx "' + $agentEntry + '"'
# WScript starts Node without a console window; no API key is in the command or registry.
$agentVbs = @(
  'Set shell = CreateObject("WScript.Shell")',
  ('shell.CurrentDirectory = "' + $agentRepo.Replace('"', '""') + '"'),
  ('shell.Run "' + $agentCommand.Replace('"', '""') + '", 0, False')
)
Set-Content -LiteralPath $agentLauncher -Value $agentVbs -Encoding Unicode
$agentRunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $agentRunKey -Force | Out-Null
$agentWscript = Join-Path $env:WINDIR 'System32\wscript.exe'
New-ItemProperty -Path $agentRunKey -Name 'YKSimAgentHouseDelivery' -PropertyType String -Value ('"' + $agentWscript + '" "' + $agentLauncher + '"') -Force | Out-Null
Write-Output 'Windows oturum açılışında hazır Ajan Evi raporlarını aktarma etkin.'
