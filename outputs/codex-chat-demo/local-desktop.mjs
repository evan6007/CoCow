import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function desktopAction(a,signal){
 if(process.platform!=='win32')throw Error('此桌面控制版本只支援 Windows。');
 const actions=['screenshot','click','type','key','scroll'];if(!actions.includes(a.action))throw Error('未知桌面操作');
 if(a.action==='click'&&(!Number.isInteger(a.x)||!Number.isInteger(a.y)||Math.abs(a.x)>16000||Math.abs(a.y)>16000))throw Error('座標不正確');
 if(a.action==='type'&&(typeof a.text!=='string'||a.text.length>3000))throw Error('文字過長');
 const keys={enter:'{ENTER}',tab:'{TAB}',escape:'{ESC}',backspace:'{BACKSPACE}',up:'{UP}',down:'{DOWN}',left:'{LEFT}',right:'{RIGHT}',copy:'^c',paste:'^v',select_all:'^a',alt_tab:'%{TAB}'};
 if(a.action==='key'&&!keys[a.key])throw Error('不支援此按鍵');
 if(a.action==='scroll'&&(!Number.isInteger(a.amount)||Math.abs(a.amount)>10))throw Error('捲動量需為 -10 至 10');
 const payload=Buffer.from(JSON.stringify({...a,keys:keys[a.key]})).toString('base64');
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;
 Add-Type 'using System;using System.Runtime.InteropServices;public class CoCowInput{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,int d,UIntPtr e);[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}';[CoCowInput]::SetProcessDPIAware()|Out-Null;
 $a=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;
 switch($a.action){
 'screenshot' {$r=[Windows.Forms.SystemInformation]::VirtualScreen;$b=New-Object Drawing.Bitmap($r.Width,$r.Height);$g=[Drawing.Graphics]::FromImage($b);try{$g.CopyFromScreen($r.X,$r.Y,0,0,$b.Size);$m=New-Object IO.MemoryStream;$b.Save($m,[Drawing.Imaging.ImageFormat]::Jpeg);@{imageUrl='data:image/jpeg;base64,'+[Convert]::ToBase64String($m.ToArray());x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}|ConvertTo-Json -Compress;$m.Dispose()}finally{$g.Dispose();$b.Dispose()}}
 'click' {[CoCowInput]::SetCursorPos($a.x,$a.y)|Out-Null;[CoCowInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[CoCowInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero);'{"ok":true}'}
 'type' {$text=($a.text.ToCharArray()|ForEach-Object{if('+^%~(){}[]'.Contains([string]$_)){'{'+$_+'}'}else{[string]$_}})-join '';[Windows.Forms.SendKeys]::SendWait($text);'{"ok":true}'}
 'key' {[Windows.Forms.SendKeys]::SendWait($a.keys);'{"ok":true}'}
 'scroll' {[CoCowInput]::mouse_event(2048,0,0,($a.amount*120),[UIntPtr]::Zero);'{"ok":true}'}
 }`;
 const r=await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,signal,timeout:15000,maxBuffer:8000000});const result=JSON.parse(r.stdout);if(result.imageUrl?.length>7500000)throw Error('桌面截圖過大');return result;
}
