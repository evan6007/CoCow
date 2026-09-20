import {existsSync,readdirSync,statSync} from 'node:fs';
import {join,delimiter,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);let cached=null;
export function codexCandidates({env=process.env,platform=process.platform}={}){
 const paths=[];if(env.CODEX_BINARY)paths.push(env.CODEX_BINARY);
 for(const dir of String(env.PATH||'').split(delimiter).filter(Boolean))paths.push(join(dir,platform==='win32'?'codex.exe':'codex'));
 if(platform==='win32'){
  const local=env.LOCALAPPDATA||join(homedir(),'AppData','Local');
  const bundled=join(local,'OpenAI','Codex','bin');
  if(existsSync(bundled))for(const d of readdirSync(bundled,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>join(bundled,d.name)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs))paths.push(join(d,'codex.exe'));
  for(const base of [join(env.APPDATA||join(homedir(),'AppData','Roaming'),'npm','node_modules','@openai','codex'),join(local,'Programs','Codex','resources')]){
   paths.push(join(base,'codex.exe'),join(base,'vendor','x86_64-pc-windows-msvc','codex','codex.exe'),join(base,'node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','codex','codex.exe'));
  }
 }
 return [...new Set(paths)].filter(p=>isAbsolute(p)&&existsSync(p));
}
export async function resolveCodex(refresh=false){
 if(!refresh&&cached&&existsSync(cached.path))return cached;
 const candidates=codexCandidates();
 if(process.platform==='win32'&&!candidates.length){
  try{const shell=join(process.env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');const r=await exec(shell,['-NoProfile','-NonInteractive','-Command','Get-AppxPackage -Name OpenAI.Codex | Select-Object -ExpandProperty InstallLocation'],{windowsHide:true,timeout:10000});for(const line of r.stdout.trim().split(/\r?\n/)){if(isAbsolute(line)){const p=join(line,'app','resources','codex.exe');if(existsSync(p))candidates.push(p);}}}catch{}
 }
 for(const path of candidates){try{const r=await exec(path,['--version'],{windowsHide:true,timeout:7000,maxBuffer:30000});if(/codex/i.test(r.stdout)){cached={available:true,path,output:r.stdout.trim()};return cached;}}catch{}}
 return {available:false,reason:'找不到可執行的本機 Codex。請先安裝或開啟官方 Codex，再按重新檢查。'};
}
