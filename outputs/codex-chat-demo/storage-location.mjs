import {existsSync,lstatSync,readdirSync,readFileSync,writeFileSync,mkdirSync,renameSync,copyFileSync,openSync,readSync,closeSync,constants} from 'node:fs';
import {resolve,join,dirname,isAbsolute,relative,parse} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

const pointer='storage-redirect.json';
export const codexHome=()=>resolve(process.env.CODEX_HOME||join(homedir(),'.codex'));
export const defaultRecordsPath=()=>join(codexHome(),'workbench');
export function resolveRecordsPath(initial){
 let path=resolve(initial);const seen=new Set();
 for(let i=0;i<16;i++){
  if(seen.has(path))throw new Error('紀錄位置設定形成循環，請保留原資料並修正設定。');seen.add(path);
  if(!existsSync(join(path,pointer)))return path;
  const saved=JSON.parse(readFileSync(join(path,pointer),'utf8'));
  if(saved.version!==1||typeof saved.path!=='string'||!isAbsolute(saved.path)||!existsSync(saved.path))throw new Error('找不到設定的紀錄資料夾；沒有建立空白紀錄。');
  path=resolve(saved.path);
 }
 throw new Error('紀錄位置轉址過多。');
}
function noLinks(path){
 for(let p=resolve(path);;p=dirname(p)){
  if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw new Error('請選擇實際資料夾，不使用資料夾捷徑。');
  if(p===dirname(p))break;
 }
}
function contains(parent,child){const r=relative(parent,child);return !r||(!r.startsWith('..')&&!isAbsolute(r));}
function digest(file){
 const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),fd=openSync(file,'r');
 try{let bytes;while((bytes=readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,bytes));return hash.digest('hex');}finally{closeSync(fd);}
}
// Copy first, verify every file, then atomically point future launches at it.
// No source deletion and no writes to official Codex's database or sessions.
export function copyRecordsLocation(source,input){
 if(typeof input!=='string'||!input.trim()||!isAbsolute(input.trim())||/[\x00-\x1f]/.test(input)||/^\\\\/.test(input.trim()))throw new Error('請輸入這台電腦上的完整資料夾路徑。');
 source=resolve(source);const target=resolve(input.trim());noLinks(source);noLinks(target);
 if(contains(source,target)||contains(target,source))throw new Error('請選擇目前資料夾以外的位置。');
 const home=codexHome();
 if(contains(target,home)||['sessions','archived_sessions','memories','worktrees'].some(n=>contains(join(home,n),target)))throw new Error('請使用獨立的紀錄資料夾，例如 .codex/workbench；不合併官方 Codex 紀錄。');
 if(target===parse(target).root)throw new Error('請選擇磁碟內的獨立資料夾。');
 if(existsSync(target)&&(!lstatSync(target).isDirectory()||readdirSync(target).length))throw new Error('目的資料夾已有檔案，請選擇空白資料夾，避免覆蓋。');
 const files=[],directories=[];
 function scan(folder,rel=''){
  for(const name of readdirSync(folder)){
   if(!rel&&name===pointer)continue;
   const p=join(folder,name),r=join(rel,name),st=lstatSync(p);
   if(st.isSymbolicLink()||(!st.isDirectory()&&!st.isFile()))throw new Error('紀錄內含資料夾捷徑或特殊檔案，尚未更改位置。');
   if(st.isDirectory()){directories.push(r);scan(p,r);}else files.push(r);
  }
 }
 scan(source);mkdirSync(target,{recursive:true,mode:0o700});
 for(const dir of directories)mkdirSync(join(target,dir),{recursive:true,mode:0o700});
 for(const file of files){const from=join(source,file),to=join(target,file);copyFileSync(from,to,constants.COPYFILE_EXCL);if(digest(from)!==digest(to))throw new Error('複製驗證失敗；原資料已保留，尚未切換。');}
 const temp=join(source,pointer+'.'+randomUUID()+'.tmp');
 writeFileSync(temp,JSON.stringify({version:1,path:target,copiedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});renameSync(temp,join(source,pointer));
 return {dataPath:target,previousPath:source,files:files.length,originalsKept:true};
}
