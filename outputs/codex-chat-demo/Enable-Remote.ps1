$ErrorActionPreference = 'Stop'
$taskDataFile = Join-Path $PSScriptRoot 'local-data-path.txt'
$taskWork = if (Test-Path -LiteralPath $taskDataFile) { [IO.File]::ReadAllText($taskDataFile).Trim() } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../work/chat-demo')) }
$taskSeen = @{}
while (Test-Path -LiteralPath (Join-Path $taskWork 'storage-redirect.json')) {
    if ($taskSeen.ContainsKey($taskWork)) { throw 'Storage location redirect cycle.' }
    $taskSeen[$taskWork] = $true
    $taskRedirect = [IO.File]::ReadAllText((Join-Path $taskWork 'storage-redirect.json')) | ConvertFrom-Json
    if ($taskRedirect.version -ne 1 -or ![IO.Path]::IsPathRooted($taskRedirect.path) -or !(Test-Path -LiteralPath $taskRedirect.path -PathType Container)) { throw 'Saved storage location is unavailable.' }
    $taskWork = [IO.Path]::GetFullPath($taskRedirect.path)
}
$taskTailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
if (!(Test-Path -LiteralPath $taskTailscale)) { throw 'Install Tailscale, sign in, then run this script again.' }
$taskRaw = & $taskTailscale status --json
if ($LASTEXITCODE -ne 0) { throw 'Tailscale is not ready. Open Tailscale and sign in first.' }
$taskStatus = $taskRaw | ConvertFrom-Json
if ($taskStatus.BackendState -ne 'Running') { throw 'Open Tailscale and sign in first, then run this script again.' }
$taskUser = $taskStatus.User.PSObject.Properties[[string]$taskStatus.Self.UserID].Value
$taskDns = $taskStatus.Self.DNSName.TrimEnd('.')
if (!$taskUser.LoginName -or !$taskDns.EndsWith('.ts.net')) { throw 'Cannot determine the owner identity and private hostname.' }
$taskExistingRaw = & $taskTailscale serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the existing Serve configuration.' }
$taskExisting = $taskExistingRaw | ConvertFrom-Json
if ($taskExisting.TCP -and $taskExisting.TCP.PSObject.Properties['443']) {
    $taskWebKey = "${taskDns}:443"
    $taskProxy = $taskExisting.Web.PSObject.Properties[$taskWebKey].Value.Handlers.PSObject.Properties['/'].Value.Proxy
    if ($taskProxy -ne 'http://127.0.0.1:4318') { throw 'Port 443 has another Tailscale Serve target; leaving it unchanged.' }
}
# Serve only, never Funnel. The application separately checks the owner login header.
& $taskTailscale serve --bg --https=443 http://127.0.0.1:4318
if ($LASTEXITCODE -ne 0) { throw 'Complete any Tailscale HTTPS setup shown above, then run this script again.' }
New-Item -ItemType Directory -Path $taskWork -Force | Out-Null
$taskConfigPath = Join-Path $taskWork 'remote-access.json'
$taskConfig = @{origin="https://$taskDns";ownerLogin=$taskUser.LoginName} | ConvertTo-Json
[IO.File]::WriteAllText($taskConfigPath, $taskConfig, [Text.UTF8Encoding]::new($false))
Write-Output "Private owner-only URL: https://$taskDns"
Write-Output 'On your home device, sign in to the same Tailscale account and open this URL.'
Write-Output 'Keep this host powered on and the chat server running.'
