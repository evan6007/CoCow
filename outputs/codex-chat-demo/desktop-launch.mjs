import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {homedir,hostname} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {privateOrigin} from './peer-gateway.mjs';
import {defaultRecordsPath,resolveRecordsPath} from './storage-location.mjs';
import {prepareUpdate,currentRelease,cachedUpdate} from './auto-update.mjs';
import {version as release} from './release.js';

export function desktopHome(){return process.env.WORKBENCH_DESKTOP_HOME|| (process.platform==='win32'?join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'Workbench'):join(process.env.XDG_DATA_HOME||join(homedir(),'.local','share'),'workbench'));}
export function prepareDesktop(home=desktopHome(),inferenceOrigin='https://e806.tail2e110c.ts.net',recordsRoot=defaultRecordsPath()){
 const origin=privateOrigin(inferenceOrigin),legacy=join(resolve(home),'data');
 const selectedFile=join(resolve(home),'records-location.json');let selected=null;
 if(existsSync(selectedFile)){const saved=JSON.parse(readFileSync(selectedFile,'utf8'));if(saved.version!==1||typeof saved.path!=='string'||!isAbsolute(saved.path)||!existsSync(join(resolveRecordsPath(saved.path),'instance.json')))throw new Error('舊版紀錄位置無法讀取，沒有建立空白紀錄。');selected=saved.path;}
 const data=resolveRecordsPath(selected||(existsSync(join(legacy,'instance.json'))?legacy:recordsRoot));
 mkdirSync(data,{recursive:true,mode:0o700});
 const path=join(data,'instance.json');
 if(!existsSync(path)&&readdirSync(data).length)throw new Error('此紀錄位置已有其他工作台的資料，沒有改動資料或額度帳戶。請先使用原工作台。');
 if(!existsSync(path))writeFileSync(path,JSON.stringify({name:hostname(),inferenceOrigin:origin,desktopManaged:true},null,2),{flag:'wx',mode:0o600});
 const config=JSON.parse(readFileSync(path,'utf8'));
 if(config.inferenceOrigin!==origin)throw new Error('這份紀錄使用另一個額度主機，沒有自動切換帳戶。');
 return {data,origin,config};
}
function openBrowser(url){
 const command=process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 const child=spawn(command[0],command[1],{stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref();
}
async function availablePort(preferred=4318){
 const probe=http.createServer();let port=preferred;
 await new Promise((resolve,reject)=>{probe.once('error',e=>{if(e.code==='EADDRINUSE'&&port){port=0;probe.listen(0,'127.0.0.1',resolve);}else reject(e);});probe.listen(port,'127.0.0.1',resolve);});
 port=probe.address().port;await new Promise(r=>probe.close(r));return port;
}
export async function launchDesktop({home=desktopHome(),inferenceOrigin='https://e806.tail2e110c.ts.net',recordsRoot=defaultRecordsPath(),open=true,appRoot=dirname(fileURLToPath(import.meta.url)),spawnService=spawn}={}){
 mkdirSync(home,{recursive:true,mode:0o700});
 const settings=prepareDesktop(home,inferenceOrigin,recordsRoot),sessionFile=join(home,'desktop-session.json');
 try{
  const old=JSON.parse(readFileSync(sessionFile,'utf8'));
  if(Number.isInteger(old.port)&&old.port>0&&old.port<65536&&/^[a-f0-9]{64}$/.test(old.token)){
   const origin='http://127.0.0.1:'+old.port,r=await fetch(origin+'/status',{headers:{'x-workbench-desktop':old.token},signal:AbortSignal.timeout(1200)});
   if(r.ok){const previous=await r.json();if(previous.dataPath===settings.data&&previous.version===release){if(open)openBrowser(origin);return {existing:true,origin};}if(previous.dataPath===settings.data&&previous.connected){const page=await(await fetch(previous.serviceOrigin)).text(),t=page.match(/name="demo-token" content="([^"]+)"/)?.[1];if(!t)throw Error('舊版狀態無法確認');const headers={'x-demo-token':t};const [m,e]=await Promise.all(['/api/metrics','/api/execution'].map(p=>fetch(previous.serviceOrigin+p,{headers}).then(r=>r.json())));if(m.busy!==false||e.activeJobs!==0||e.setup?.state==='running'){if(open)openBrowser(origin);return {existing:true,origin,updateDeferred:true};}const stopped=await fetch(origin+'/stop',{method:'POST',headers:{'x-workbench-desktop':old.token,Origin:origin}});if(!stopped.ok)throw Error('舊版尚未停止');}}
  }
 }catch{}
 let appRelease=currentRelease,updateBusy=false,updateProgress=null;const originalRoot=appRoot;
 const cached=cachedUpdate(home);if(cached){appRoot=cached.appRoot;appRelease=cached.release;}
 const token=randomBytes(32).toString('hex');let serverOrigin='',child=null,serviceOrigin=null,servicePort=4318,busy=false,last={stage:'ready',title:'準備開啟工作台',message:'紀錄會自動保存在這台電腦。'};
 const activeVersion=()=>{try{return readFileSync(join(appRoot,'release.js'),'utf8').match(/version='([^']+)'/)?.[1]||release;}catch{return release;}};
 const status=()=>({...last,version:activeVersion(),launcherVersion:release,appRelease,updateBusy,progress:updateProgress,dataPath:settings.data,computer:settings.config.name,serviceOrigin,busy,connected:!!serviceOrigin});
 const stopService=async()=>{if(child&&child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));if(process.platform==='win32'){await new Promise(r=>{const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});killer.once('exit',r);killer.once('error',r);});}else child.kill();await Promise.race([stopped,new Promise(r=>setTimeout(r,5000))]);}child=null;serviceOrigin=null;};
 async function update(){if(updateBusy||busy)return;updateBusy=true;try{if(serviceOrigin){const page=await(await fetch(serviceOrigin)).text(),token=page.match(/name="demo-token" content="([^"]+)"/)?.[1];if(!token)return;const headers={'x-demo-token':token};const [metrics,execution]=await Promise.all(['/api/metrics','/api/execution'].map(p=>fetch(serviceOrigin+p,{headers,signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)throw Error('忙碌狀態不明');return r.json();})));if(metrics.busy!==false||execution.activeJobs!==0||execution.setup?.state==='running'||execution.approvals?.length)return;}const next=await prepareUpdate({origin:settings.origin,home,appRoot:originalRoot,release:appRelease,onProgress:p=>{updateProgress=p;}});if(next){if(serviceOrigin){const page=await(await fetch(serviceOrigin)).text(),t=page.match(/name="demo-token" content="([^"]+)"/)?.[1];if(!t)return;const ready=await fetch(serviceOrigin+'/api/update/prepare',{method:'POST',headers:{'x-demo-token':t,Origin:serviceOrigin,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});if(!ready.ok)return;}await stopService();appRoot=next.appRoot;appRelease=next.release;last={stage:'updated',title:'已更新',message:'已套用最新版本，紀錄保留。'};}}catch{ /* Offline or invalid updates preserve the working release. */ }finally{updateBusy=false;}}
 async function start(){
  if(busy||updateBusy||serviceOrigin)return status();busy=true;
  try{
   updateProgress={stage:'starting',percent:null,label:'正在啟動本機服務'};last={stage:'checking',title:'正在確認連線',message:'檢查帳號與主機。'};
   // Local history must remain reachable when Tailscale or the quota relay is offline.
   settings.data=resolveRecordsPath(settings.data);
   const port=await availablePort(servicePort);servicePort=port;
   const service=spawnService(process.execPath,[join(appRoot,'server.mjs')],{cwd:appRoot,env:{...process.env,DEMO_DATA_DIR:settings.data,DEMO_PORT:String(port),WORKBENCH_MANAGED_RESTART:'1'},stdio:['ignore','ignore','pipe'],windowsHide:true});
   child=service;let exited=false,startError='';service.stderr?.on('data',b=>{startError=(startError+b.toString()).slice(-4000);});service.once('error',()=>{exited=true;});service.once('exit',code=>{exited=true;if(child===service){child=null;serviceOrigin=null;last={stage:'stopped',title:'工作台已停止',message:'紀錄仍保存在這台電腦，按下方按鈕重新開啟。'};if(code===75){last={stage:'restarting',title:'正在切換紀錄位置',message:'即將重新連線。'};setTimeout(async()=>{await update();await start();},100);}}});
   const origin='http://127.0.0.1:'+port;
   for(let attempt=0;attempt<70;attempt++){
    if(exited)throw new Error('本機服務無法啟動。'+(startError?startError.replace(/Bearer\s+[^\s]+/gi,'Bearer [REDACTED]').replace(/(?:sk-|ya29\.)[A-Za-z0-9._-]+/g,'[REDACTED]').slice(-1600):'請從桌面捷徑重試。'));
    try{const page=await fetch(origin,{signal:AbortSignal.timeout(700)});if(page.ok){const text=await page.text();if(text.includes('name="demo-token"')){serviceOrigin=origin;updateProgress={stage:'ready',percent:100,label:'已完成'};last={stage:'running',title:'工作台已開啟',message:'已加入名單的帳號會自動連線；未加入時請管理者加入帳號。'};return status();}}}catch{}
    await new Promise(r=>setTimeout(r,250));
   }
   throw new Error('啟動時間較久，請稍後再試。');
  }catch(e){await stopService();last={stage:'error',title:'尚未開啟',message:e.message};return status();}finally{busy=false;}
 }
 const server=http.createServer(async(req,res)=>{
  const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  if(req.headers.host!==new URL(serverOrigin).host||Object.keys(req.headers).some(k=>k.startsWith('x-forwarded-')||k.startsWith('tailscale-'))||req.headers.origin&&req.headers.origin!==serverOrigin)return send(403,{error:'僅限這台電腦開啟。'});
  if(req.method==='GET'&&req.url==='/'){
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+token+"'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
   return res.end(readFileSync(join(appRoot,'desktop-welcome.html'),'utf8').replaceAll('__DESKTOP_TOKEN__',token));
  }
  if(req.headers['x-workbench-desktop']!==token)return send(403,{error:'請重新開啟工作台。'});
  if(req.method==='GET'&&req.url==='/status')return send(200,status());
  if(req.method==='POST'&&req.url==='/update'){await update();if(!serviceOrigin)await start();return send(200,status());}
  if(req.method==='POST'&&req.url==='/start')return send(200,await start());
  if(req.method==='POST'&&req.url==='/stop'){await stopService();last={stage:'stopped',title:'工作台已停止',message:'紀錄已保留。'};return send(200,status());}
  return send(404,{error:'Not found'});
 });
 const managerPort=await availablePort(9142);await new Promise(r=>server.listen(managerPort,'127.0.0.1',r));serverOrigin='http://127.0.0.1:'+server.address().port;
 writeFileSync(sessionFile,JSON.stringify({port:server.address().port,token}),{mode:0o600});

 const close=async()=>{await stopService();server.closeAllConnections();await new Promise(r=>server.close(r));};
 if(open)openBrowser(serverOrigin);
 return {origin:serverOrigin,token,close,status,start,checkUpdate:async()=>{await update();if(!serviceOrigin)await start();return status();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)launchDesktop().catch(e=>{const home=desktopHome();mkdirSync(home,{recursive:true});writeFileSync(join(home,'startup-error.txt'),String(e.message).slice(0,4000));console.error(e.message);process.exitCode=1;});
