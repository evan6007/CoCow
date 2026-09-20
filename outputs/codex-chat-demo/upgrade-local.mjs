import {existsSync,readFileSync,writeFileSync,copyFileSync,mkdirSync,renameSync,lstatSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {desktopHome} from './desktop-launch.mjs';
import {resolveRecordsPath} from './storage-location.mjs';
const exec=promisify(execFile),expectedOrigin='https://e806.tail2e110c.ts.net';
function noLinks(path){for(let p=resolve(path);;p=dirname(p)){if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw new Error('請選擇實際安裝資料夾，不使用資料夾捷徑。');if(p===dirname(p))break;}}
const same=(a,b)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
export function inspectLegacy(selection,origin=expectedOrigin){
 const file=resolve(selection);noLinks(file);
 if(!['開啟工作台.cmd','開始使用.cmd','local-data-path.txt'].includes(basename(file)))throw new Error('請選舊版的「開啟工作台.cmd」或「開始使用.cmd」。');
 const root=dirname(file),pointer=join(root,'local-data-path.txt'),server=join(root,'server.mjs');
 if(!existsSync(file)||!existsSync(pointer)||!existsSync(server)||!readFileSync(server,'utf8').includes('Local subscription chat demo ready'))throw new Error('這不是可接續的舊版工作台資料夾。');
 const original=readFileSync(pointer,'utf8').replace(/^\uFEFF/,'').trim();if(!isAbsolute(original))throw new Error('舊版紀錄路徑不是完整路徑，尚未更動。');
 const data=resolveRecordsPath(original);noLinks(data);const config=JSON.parse(readFileSync(join(data,'instance.json'),'utf8').replace(/^\uFEFF/,''));
 if(config.inferenceOrigin?.replace(/\/$/,'')!==origin)throw new Error('這份舊紀錄使用不同的額度來源，沒有自動切換。');
 return {root,server,data,config};
}
async function json(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error('無法核對舊服務，請先停止舊工作台再更新。');return r.json();}
async function service(origin){
 const url=new URL(origin);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error('無法核對本機服務。');
 const r=await fetch(origin,{signal:AbortSignal.timeout(4000)}),page=await r.text();const token=page.match(/name="demo-token" content="([a-f0-9]{64})"/)?.[1];if(!r.ok||!token)throw new Error('無法核對舊工作台頁面。');
 const headers={'x-demo-token':token},storage=await json(origin+'/api/storage',{headers}),metrics=await json(origin+'/api/metrics',{headers}),execution=await json(origin+'/api/execution',{headers});
 if(metrics.busy||execution.activeJobs||execution.setup?.state==='running')throw new Error('舊工作台還在回答或執行程式，請等它完成再更新。');
 return storage.current.dataPath;
}
export async function stopDesktopManager(home){
 const file=join(home,'desktop-session.json');if(!existsSync(file))return;
 let session;try{session=JSON.parse(readFileSync(file,'utf8'));}catch{throw new Error('桌面管理設定損壞，尚未更新。');}
 if(!Number.isInteger(session.port)||session.port<=0||session.port>65535||!/^[a-f0-9]{64}$/.test(session.token))throw new Error('桌面管理設定無法核對。');
 const origin='http://127.0.0.1:'+session.port,headers={'x-workbench-desktop':session.token};let status;
 try{status=await json(origin+'/status',{headers});}catch(e){if(e.cause?.code==='ECONNREFUSED')return;throw e;}
 if(status.busy)throw new Error('舊工作台正在啟動，請稍後再更新。');
 if(status.serviceOrigin){if(!same(await service(status.serviceOrigin),status.dataPath))throw new Error('舊服務資料位置不一致，尚未停止。');await json(origin+'/stop',{method:'POST',headers});}
}
async function legacyProcess(server,port){
 const script=`$p=Get-NetTCPConnection -LocalPort ([int]$env:WORKBENCH_LEGACY_PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if(!$p){'null';exit}; $i=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$p.OwningProcess); $s=$env:WORKBENCH_LEGACY_SERVER; $match=$i.Name -eq 'node.exe' -and ($i.CommandLine.Contains('"'+$s+'"') -or $i.CommandLine.EndsWith(' '+$s)); @{pid=$i.ProcessId;matches=$match}|ConvertTo-Json -Compress`;
 const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',script],{env:{...process.env,WORKBENCH_LEGACY_SERVER:server,WORKBENCH_LEGACY_PORT:String(port)},windowsHide:true,timeout:8000});return JSON.parse(stdout.trim());
}
export async function stopLegacy(legacy,{port=4318}={}){
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('無效的服務埠。');
 const before=await legacyProcess(legacy.server,port);if(!before)return;
 if(!before.matches)throw new Error('另一份程式正在使用工作台連接埠，請先停止那份工作台再更新。');
 if(!same(await service('http://127.0.0.1:'+port),legacy.data))throw new Error('舊服務與所選資料夾不一致，沒有停止其他程式。');
 const after=await legacyProcess(legacy.server,port);if(!after?.matches||after.pid!==before.pid)throw new Error('舊服務狀態已變更，請重新執行更新。');
 await exec('taskkill.exe',['/PID',String(before.pid),'/T','/F'],{windowsHide:true,timeout:8000});
 for(let i=0;i<30;i++){try{process.kill(before.pid,0);}catch{return;}await new Promise(r=>setTimeout(r,100));}throw new Error('舊服務尚未停止，請稍後再試。');
}
function atomic(file,value){const temp=file+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});renameSync(temp,file);}
export function adoptLegacy(legacy,home,launcher){
 noLinks(home);noLinks(launcher);if(!existsSync(launcher))throw new Error('新版啟動器尚未安裝完成。');mkdirSync(home,{recursive:true,mode:0o700});
 const stamp=new Date().toISOString().replace(/[^0-9]/g,''),selected=join(home,'records-location.json');
 if(existsSync(selected))copyFileSync(selected,selected+'.backup-'+stamp);
 atomic(selected,{version:1,path:legacy.data});
 const instance=join(legacy.data,'instance.json');if(!legacy.config.desktopManaged){copyFileSync(instance,instance+'.backup-'+stamp);atomic(instance,{...legacy.config,desktopManaged:true});}
 // Only the two known entry points are redirected. Original scripts stay as backups.
 const redirect='@echo off\r\nstart "" "%LOCALAPPDATA%\\Programs\\Workbench\\Workbench.exe" --run\r\n';
 for(const name of ['開啟工作台.cmd','開始使用.cmd']){const file=join(legacy.root,name);if(!existsSync(file))continue;noLinks(file);if(readFileSync(file,'utf8')===redirect)continue;copyFileSync(file,file+'.backup-'+stamp);writeFileSync(file,redirect,'ascii');}
 return {dataPath:legacy.data,recordsPreserved:true,oldEntryUpdated:true};
}
export async function upgradeLocal({selection=null,home=desktopHome(),launcher=join(process.env.LOCALAPPDATA||'','Programs','Workbench','Workbench.exe'),platform=process.platform,stopManaged=stopDesktopManager,stopManual=stopLegacy}={}){
 if(platform!=='win32')throw new Error('此更新入口僅支援 Windows。');
 const legacy=selection?inspectLegacy(selection):null;
 await stopManaged(home);if(legacy){await stopManual(legacy);return adoptLegacy(legacy,home,launcher);}return {recordsPreserved:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const result=await upgradeLocal({selection:process.argv[2]||null});console.log(JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}}
