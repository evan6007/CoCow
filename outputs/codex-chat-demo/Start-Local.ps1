$ErrorActionPreference = 'Stop'
$taskPathFile = Join-Path $PSScriptRoot 'local-data-path.txt'
if (!(Test-Path -LiteralPath $taskPathFile)) { throw 'Run Install-Local.ps1 first.' }
$env:DEMO_DATA_DIR = [IO.File]::ReadAllText($taskPathFile).Trim()
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskServer = Join-Path $PSScriptRoot 'server.mjs'
$taskListener = Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
if ($taskListener) { throw 'Port 4318 is already in use. Open the existing service or stop it before starting this installation.' }
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskServer + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:DEMO_DATA_DIR 'service-stdout.log') -RedirectStandardError (Join-Path $env:DEMO_DATA_DIR 'service-stderr.log')
$taskProcess.Id | Set-Content -LiteralPath (Join-Path $env:DEMO_DATA_DIR 'service-pid.txt')
for ($taskAttempt=0; $taskAttempt -lt 40; $taskAttempt++) {
    try { $taskResponse=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4318/' -TimeoutSec 1; if($taskResponse.StatusCode -eq 200){Write-Output 'Ready: http://127.0.0.1:4318/';return} } catch {}
    Start-Sleep -Milliseconds 500
}
throw 'Startup is not ready. Check service-stderr.log in the configured data directory.'
