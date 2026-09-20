import {stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {hostname} from 'node:os';
export function validateLocalPath(path){
 if(typeof path!=='string'||path.length>4096||! /^[A-Za-z]:[\\/]/.test(path)||/[\x00-\x1f"<>|]/.test(path)||path.slice(2).includes(':'))throw Error('請提供有效的本機磁碟路徑。');
 return path.replaceAll('/','\\');
}
export async function revealLocalFile(input,{launch=spawn,inspect=stat,platform=process.platform}={}){
 if(platform!=='win32')throw Error('目前僅支援 Windows 檔案總管。');
 const path=validateLocalPath(input);let entry;try{entry=await inspect(path);}catch{throw Error('目前這台電腦找不到檔案；請切換到檔案所在的工作主機。');}
 const args=entry.isDirectory()?[path]:['/select,',path];
 await new Promise((resolve,reject)=>{const child=launch('explorer.exe',args,{shell:false,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
 return {ok:true,host:hostname(),action:'reveal'};
}
