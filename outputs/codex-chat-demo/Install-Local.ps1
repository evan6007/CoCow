param(
    [string]$Name,
    [string]$InferenceUrl = 'https://e806.tail2e110c.ts.net',
    [string]$DataDirectory,
    [switch]$UseLocalCodex
)
$ErrorActionPreference = 'Stop'
if (!$Name) { $Name = Read-Host 'Name for this computer (for example Home-PC or Lab-PC)' }
if (!$Name.Trim()) { throw 'A computer name is required.' }
if (!$DataDirectory) { $DataDirectory = Join-Path $PSScriptRoot 'data' }
$taskData = [IO.Path]::GetFullPath($DataDirectory)
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
$taskNode = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$taskNode) { throw 'Node.js 22 or later is required. Install it from https://nodejs.org/en/download and run this script again.' }
$taskVersion = & $taskNode.Source -p 'process.versions.node.split(".")[0]'
if ([int]$taskVersion -lt 22) { throw 'Please update Node.js to version 22 or later.' }
$taskConfigPath = Join-Path $taskData 'instance.json'
if (Test-Path -LiteralPath $taskConfigPath) { throw 'This data directory already has a configuration. Use Start-Local.ps1, or choose a new DataDirectory.' }
$taskConfig = @{name=$Name;inferenceOrigin=$(if($UseLocalCodex){$null}else{$InferenceUrl})}
if ($UseLocalCodex) {
    if (!(Get-Command codex.exe -ErrorAction SilentlyContinue)) { throw 'Install Codex and sign in with your own ChatGPT account before choosing local Codex.' }
    $env:DEMO_DATA_DIR = $taskData
    & $taskNode.Source (Join-Path $PSScriptRoot 'initialize-account.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the local ChatGPT account. No account was switched.' }
}
[IO.File]::WriteAllText($taskConfigPath, ($taskConfig | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'local-data-path.txt'), $taskData, [Text.UTF8Encoding]::new($false))
Write-Output "Data and memory will be stored at: $taskData"
Write-Output 'Optional program execution requires Codex CLI with initialized Windows elevated sandbox on THIS computer, plus Python/Node and any GPU packages you use. Execution is off until enabled in Program & GPU. A first-time Windows setup prompt must be completed on this computer.'
Write-Output $(if($UseLocalCodex){'Inference uses this computer''s verified Codex account.'}else{"Inference uses: $InferenceUrl. The owner must approve this computer under Switch computer > Devices."})
& (Join-Path $PSScriptRoot 'Start-Local.ps1')
