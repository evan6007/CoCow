$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$taskRoot = $PSScriptRoot
$taskOrigin = 'https://e806.tail2e110c.ts.net'
function Show-WorkbenchError($message) { [System.Windows.Forms.MessageBox]::Show($message,'工作台',0,48) | Out-Null }
function Open-ExistingWorkbench {
    $taskPath = Join-Path $taskRoot 'local-data-path.txt'
    $taskServer = Join-Path $taskRoot 'server.mjs'
    $taskListener = Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
    if ($taskListener) {
        $taskProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskListener[0].OwningProcess)"
        if ($taskProcessInfo.CommandLine -notlike "*$taskServer*") { throw '4318 連接埠已由另一份服務使用；請先關閉另一份工作台。' }
    } else {
        & (Join-Path $taskRoot 'Start-Local.ps1')
    }
    Start-Process 'http://127.0.0.1:4318/'
}
if (Test-Path -LiteralPath (Join-Path $taskRoot 'local-data-path.txt')) {
    try { Open-ExistingWorkbench } catch { Show-WorkbenchError $_.Exception.Message }
    exit
}
$taskForm = New-Object System.Windows.Forms.Form
$taskForm.Text = '工作台 · 第一次設定'
$taskForm.ClientSize = New-Object System.Drawing.Size(580,430)
$taskForm.StartPosition = 'CenterScreen'
$taskForm.FormBorderStyle = 'FixedDialog'
$taskForm.MaximizeBox = $false
$taskForm.Font = New-Object System.Drawing.Font('Microsoft JhengHei UI',10)
function Add-TaskLabel($text,$x,$y,$width=510,$height=28) {
    $taskLabel = New-Object System.Windows.Forms.Label
    $taskLabel.Text=$text
    $taskLabel.Location=New-Object System.Drawing.Point($x,$y)
    $taskLabel.Size=New-Object System.Drawing.Size($width,$height)
    $taskForm.Controls.Add($taskLabel)
}
Add-TaskLabel '紀錄留在你選的資料夾，模型使用 e806 共用額度。' 24 20
Add-TaskLabel '電腦名稱' 24 67
$taskName = New-Object System.Windows.Forms.TextBox
$taskName.Text=$env:COMPUTERNAME
$taskName.Location=New-Object System.Drawing.Point(24,97)
$taskName.Size=New-Object System.Drawing.Size(530,30)
$taskForm.Controls.Add($taskName)
Add-TaskLabel '紀錄資料夾' 24 142
$taskFolder = New-Object System.Windows.Forms.TextBox
$taskFolder.Text=Join-Path ([Environment]::GetFolderPath('MyDocuments')) '工作台資料'
$taskFolder.Location=New-Object System.Drawing.Point(24,172)
$taskFolder.Size=New-Object System.Drawing.Size(382,30)
$taskForm.Controls.Add($taskFolder)
$taskBrowse=New-Object System.Windows.Forms.Button
$taskBrowse.Text='選擇資料夾'
$taskBrowse.Location=New-Object System.Drawing.Point(418,169)
$taskBrowse.Size=New-Object System.Drawing.Size(136,34)
$taskBrowse.Add_Click({
    $taskDialog=New-Object System.Windows.Forms.FolderBrowserDialog
    $taskDialog.Description='選擇保存聊天、附件與工作檔的資料夾'
    if(Test-Path -LiteralPath $taskFolder.Text){$taskDialog.SelectedPath=$taskFolder.Text}
    if($taskDialog.ShowDialog() -eq 'OK'){$taskFolder.Text=$taskDialog.SelectedPath}
    $taskDialog.Dispose()
})
$taskForm.Controls.Add($taskBrowse)
Add-TaskLabel '本機檔案可供 Codex 閱讀；不會自動變成官方側欄的對話。' 24 220 530 46
$taskNodeLink=New-Object System.Windows.Forms.LinkLabel
$taskNodeLink.Text='安裝 Node.js'
$taskNodeLink.Location=New-Object System.Drawing.Point(24,280)
$taskNodeLink.Size=New-Object System.Drawing.Size(145,28)
$taskNodeLink.Add_LinkClicked({Start-Process 'https://nodejs.org/en/download'})
$taskForm.Controls.Add($taskNodeLink)
$taskTailLink=New-Object System.Windows.Forms.LinkLabel
$taskTailLink.Text='安裝 Tailscale'
$taskTailLink.Location=New-Object System.Drawing.Point(185,280)
$taskTailLink.Size=New-Object System.Drawing.Size(145,28)
$taskTailLink.Add_LinkClicked({Start-Process 'https://tailscale.com/download/windows'})
$taskForm.Controls.Add($taskTailLink)
$taskHelp=New-Object System.Windows.Forms.LinkLabel
$taskHelp.Text='新手教學'
$taskHelp.Location=New-Object System.Drawing.Point(363,280)
$taskHelp.Size=New-Object System.Drawing.Size(145,28)
$taskHelp.Add_LinkClicked({Start-Process (Join-Path $taskRoot '新手教學.html')})
$taskForm.Controls.Add($taskHelp)
$taskInstall=New-Object System.Windows.Forms.Button
$taskInstall.Text='安裝並開啟'
$taskInstall.Location=New-Object System.Drawing.Point(374,347)
$taskInstall.Size=New-Object System.Drawing.Size(180,48)
$taskForm.AcceptButton=$taskInstall
$taskForm.Controls.Add($taskInstall)
$taskInstall.Add_Click({
    $taskInstall.Enabled=$false
    try {
        if(!$taskName.Text.Trim()){throw '請填寫電腦名稱。'}
        $taskNode=Get-Command node.exe -ErrorAction SilentlyContinue
        if(!$taskNode){throw '請先按「安裝 Node.js」，安裝後關閉此視窗再重新執行。'}
        $taskVersion=& $taskNode.Source -p 'process.versions.node.split(".")[0]'
        if([int]$taskVersion -lt 22){throw 'Node.js 需要 22 或更新版本。'}
        $taskTailscale=Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
        if(!(Test-Path -LiteralPath $taskTailscale)){throw '請先安裝 Tailscale，登入獲分配額度的 Email，並接受 e806 分享邀請。'}
        $taskState=& $taskTailscale status --json | ConvertFrom-Json
        if($taskState.BackendState -ne 'Running'){throw '請先開啟 Tailscale 並登入自己的帳號。'}
        try { $taskReachable=Invoke-WebRequest -UseBasicParsing ($taskOrigin+'/join') -TimeoutSec 15 } catch { throw '無法連到 e806。請確認已接受機器分享邀請，且登入的 Email 已獲分配額度。' }
        if($taskReachable.StatusCode -ne 200){throw '此帳號尚未獲准使用。'}
        if(!$taskFolder.Text.Trim()){throw '請選擇紀錄資料夾。'}
        & (Join-Path $taskRoot 'Install-Local.ps1') -Name ($taskName.Text.Trim()) -DataDirectory ($taskFolder.Text.Trim()) -InferenceUrl $taskOrigin
        Start-Process 'http://127.0.0.1:4318/'
        [System.Windows.Forms.MessageBox]::Show('安裝完成。首次使用請 e806 擁有者核准你的裝置，再重新整理本機工作台。','工作台',0,64) | Out-Null
        $taskForm.Close()
    } catch { Show-WorkbenchError $_.Exception.Message }
    finally { $taskInstall.Enabled=$true }
})
[void]$taskForm.ShowDialog()
$taskForm.Dispose()

