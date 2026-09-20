$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskWork = [IO.Path]::GetFullPath((Join-Path $taskRoot '../../work'))
$taskServer = Join-Path $taskRoot 'server.mjs'
$taskExisting = Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
if ($taskExisting) {
    $taskInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskExisting[0].OwningProcess)"
    if ($taskInfo.CommandLine -notlike "*$taskServer*") { throw 'Port 4318 is occupied by another application.' }
    Write-Output 'Already running: http://127.0.0.1:4318'
    exit
}
New-Item -ItemType Directory -Path $taskWork -Force | Out-Null
$taskNode = (Get-Command node.exe).Source
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskWork 'demo-stdout.log') -RedirectStandardError (Join-Path $taskWork 'demo-stderr.log')
$taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskWork 'demo-pid.txt')
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    if ($taskProcess.HasExited) { throw ('Demo startup failed. See ' + (Join-Path $taskWork 'demo-stderr.log')) }
    try {
        $taskResponse = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4318/' -TimeoutSec 1
        if ($taskResponse.StatusCode -eq 200) { Write-Output 'Ready: http://127.0.0.1:4318'; exit }
    } catch {}
    Start-Sleep -Milliseconds 500
}
throw 'Startup is still pending. Check work/demo-stderr.log before restarting.'
