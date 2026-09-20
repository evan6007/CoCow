$ErrorActionPreference = 'Stop'
$taskServer = Join-Path $PSScriptRoot 'server.mjs'
$taskListener = Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
if (!$taskListener) { Write-Output 'Demo is not running.'; exit }
$taskPid = $taskListener[0].OwningProcess
$taskInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $taskPid"
if ($taskInfo.CommandLine -notlike "*$taskServer*") { throw 'Refusing to stop a process that does not belong to this demo.' }
# Stop this verified service's process tree, including its own program jobs.
# No unrelated Codex app or other service process is targeted.
& taskkill.exe /PID $taskPid /T /F | Out-Null
Write-Output 'Local demo stopped.'
