import {installOfficialCLI} from './antigravity-install.mjs';
import {spawn, execFile} from 'node:child_process';
import {existsSync, readFileSync, statSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve, delimiter} from 'node:path';
import os from 'node:os';
import {StringDecoder} from 'node:string_decoder';

export const antigravityModel = {id:'antigravity:gemini-3.8-flash',name:'Gemini 3.8 Flash · Antigravity',efforts:['low','medium','high'],defaultEffort:'low',provider:'antigravity'};
export const isAntigravity = model => model === antigravityModel.id;
export function redact(value) {
  return String(value ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g,'')
    .replace(/\b(?:ya29\.|1\/\/)[\w.\-/]+/g,'[REDACTED]')
    .replace(/\b(?:AIza|sk-)[\w-]{16,}/g,'[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
    .replace(/((?:access_token|refresh_token|id_token|api_key|cookie|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,'$1[REDACTED]');
}
export function agyEnvironment(env=process.env) {
  // The official CLI owns OAuth/keyring access. Never inject provider API keys.
  const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|PROGRAMFILES.*|COMMONPROGRAMFILES.*|OS|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS|LANG|LC_.*|DISPLAY|WAYLAND_DISPLAY|DBUS_SESSION_BUS_ADDRESS|XDG_.*)$/i;
  return Object.fromEntries(Object.entries(env).filter(([k])=>allowed.test(k)));
}
export function findAntigravity() {
  const name=process.platform==='win32'?'agy.exe':'agy';
  const paths=[process.platform==='win32'?join(process.env.LOCALAPPDATA||join(os.homedir(),'AppData','Local'),'agy','bin',name):join(os.homedir(),'.local','bin',name),...(process.env.PATH||'').split(delimiter).map(p=>join(p,name))];
  return paths.find(p=>{try{return statSync(p).isFile();}catch{return false;}})||null;
}
export function parseModels(text) {
  return String(text).split(/\r?\n/).map(l=>l.trim().split(/\t+/)[0]).filter(s=>/^gemini-3\.8-flash-(low|medium|high)$/.test(s));
}
export function parseQuota(text) {
  return String(text).split(/\r?\n/).flatMap(line=>{
    const match=line.match(/^(.+?)\t([^\t]+)\t(\d+(?:\.\d+)?)%\t([^\t]+)$/);
    if(!match)return [];
    const n=Number(match[3]),reset=Date.parse(match[4]);
    if(n<0||n>100)return [];
    return [{name:match[1],period:match[2],remainingPercent:n,resetsAt:Number.isFinite(reset)?Math.floor(reset/1000):null}];
  });
}
function inspectSettings() {
  const file=join(os.homedir(),'.gemini','antigravity-cli','settings.json');
  try {
    const s=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
    if(s.modelProvider)return {blocked:'官方 CLI 設為 API／其他供應商模式；請先在官方 CLI 改回 Google 帳號登入。'};
    if(s.useG1Credits!==undefined&&s.useG1Credits!==false)return {blocked:'官方 CLI 的額外 AI 點數設定未明確關閉；請先關閉點數加購／超額付費再使用。'};
    return {blocked:null};
  } catch { return {blocked:'無法確認官方 CLI 的登入／點數設定，已停止送出。'}; }
}
export function stopChild(child) {
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  if(process.platform==='win32'){
    const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
  } else {try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}
}
function execute(file,args,{cwd,timeout=20000}={}) {
  return new Promise((ok,no)=>execFile(file,args,{cwd,env:agyEnvironment(),windowsHide:true,timeout,maxBuffer:512*1024},(err,out)=>err?no(new Error(/auth|login|sign.in/i.test(String(out))?'請先在此電腦登入官方 Antigravity CLI。':'官方 CLI 查詢失敗或逾時；請在設定重新檢查。')):ok(redact(out))));
}
export class AntigravityService {
  constructor(work,{runtime=findAntigravity,exec=execute,spawnProcess=spawn}={}) {this.work=work;this.runtime=runtime;this.exec=exec;this.spawnProcess=spawnProcess;this.cache=null;this.probing=null;this.installing=null;this.running=null;}
  async status(refresh=false) {
    if(this.probing)return this.probing;
    if(!refresh&&this.cache&&Date.now()-Date.parse(this.cache.capturedAt)<60000)return this.cache;
    this.probing=this.probe().then(s=>(this.cache=s)).finally(()=>this.probing=null);return this.probing;
  }
  async probe() {
    const path=this.runtime(),policy=inspectSettings();
    const s={provider:'antigravity',host:os.hostname(),available:!!path,authenticated:false,canStartChat:false,version:null,models:[],windows:[],email:null,accountReason:'官方 CLI 查詢未提供可核對的帳號識別；請在官方登入視窗確認。',authMode:'由官方 CLI 管理 Google 登入',billing:'此電腦的 Antigravity 帳號',billingReason:'不讀取或轉傳登入憑證；CLI 設定未啟用 API 模式及額外 AI 點數，未取得逐筆扣額明細。',reason:policy.blocked||(!path?'尚未安裝官方 Antigravity CLI。':null),capturedAt:new Date().toISOString()};
    if(s.reason)return s;
    try {
      s.version=(await this.exec(path,['--version'])).trim().slice(0,60);
      s.models=parseModels(await this.exec(path,['models']));
      s.windows=parseQuota(await this.exec(path,['-p','/usage','--print-timeout','15s']));
      s.authenticated=s.windows.length>0;
      s.canStartChat=s.authenticated&&s.models.length>0;
      const quota=s.windows.filter(w=>/gemini/i.test(w.name));
      if(!quota.length){s.canStartChat=false;s.reason='官方 CLI 未提供 Gemini 額度，暫停協作；請重新檢查。';}
      if(quota.some(w=>w.remainingPercent===0)){s.canStartChat=false;s.reason='Antigravity Gemini 額度已用完；等待官方重置，不切換其他帳號或付費 API。';}
      if(!s.authenticated)s.reason='尚未取得額度；請先登入官方 CLI，再重新檢查。';
      else if(!s.models.length)s.reason='此登入尚未提供 Gemini 3.8 Flash；請在官方 CLI 確認模型。';
    } catch(e) {s.reason=redact(e.message);}
    s.capturedAt=new Date().toISOString();return s;
  }
  async prepare(effort,mode) {
    if(!['low','medium','high'].includes(effort))throw Error('Antigravity 支援輕、中、高思考程度。');
    // No headless approval-response protocol is documented. Do not silently promote a sandbox or read-only session.
    if(mode!=='full')throw Error('Antigravity 預覽版目前需要此電腦的「完整存取權」。其他權限模式尚未接入官方 CLI，沒有自動放寬權限。');
    const policy=inspectSettings();if(policy.blocked)throw Error(policy.blocked);
    const s=await this.status();if(!s.canStartChat)throw Error(s.reason||'Antigravity 尚未連線。');
    const model='gemini-3.8-flash-'+effort;
    if(!s.models.includes(model))throw Error('官方 CLI 未回報這個模型與思考程度。');
    return {status:s,model};
  }
  run({text,model,effort,cwd,conversationId,onEvent=()=>{},timeoutMs=600000}) {
    if(!['low','medium','high'].includes(effort)||model!=='gemini-3.8-flash-'+effort)throw Error('Antigravity 模型未通過驗證。');
    if(this.running)throw Error('Antigravity 正在處理另一個回合。');
    if(typeof text!=='string'||text.length>120000)throw Error('Antigravity 輸入超過 120,000 字，請縮小範圍。');
    if(conversationId&&!/^[a-zA-Z0-9_-]{1,128}$/.test(conversationId))throw Error('Antigravity 對話識別碼不正確。');
    const policy=inspectSettings();if(policy.blocked)throw Error(policy.blocked);
    const path=this.runtime();if(!path)throw Error('尚未安裝官方 Antigravity CLI。');
    mkdirSync(cwd,{recursive:true});
    const args=['--input-format','stream-json','--output-format','stream-json','--model',model,'--effort',effort,'--dangerously-skip-permissions','--disable-slash-commands','--print-timeout','10m'];
    if(conversationId)args.push('--conversation',conversationId);
    const child=this.spawnProcess(path,args,{cwd,env:agyEnvironment(),windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    let abortReason=null,timer,killTimer,buffer='',result=null,steps=new Map(),settled=false;
    const decoder=new StringDecoder('utf8');
    const cancel=(reason='回答已停止。')=>{if(settled)return;abortReason=reason;stopChild(child);killTimer=setTimeout(()=>child.kill('SIGKILL'),1500);killTimer.unref();};
    const done=new Promise((ok,no)=>{
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);this.running=null;if(error||abortReason)return no(new Error(redact(abortReason||error)));
        if(!result)return no(new Error('官方 CLI 連線結束但未回報結果；請先查看紀錄，系統不自動重送。'));
        if(result.status!=='SUCCESS')return no(new Error(redact(result.error||'Antigravity 未完成此回合。').slice(0,1200)));
        const usage=steps.size?[...steps.values()].reduce((a,u)=>{for(const k of Object.keys(a))a[k]+=Number.isFinite(u[k])?u[k]:0;return a;},{inputTokens:0,outputTokens:0,cachedInputTokens:0,totalTokens:0}):null;
        ok({text:redact(result.response||''),usage,conversationId:result.conversation_id||conversationId,usageSource:usage?'官方 CLI 本回合步驟用量加總':'官方未提供可獨立計算的本回合用量'});
      };
      const line=value=>{if(!value.trim())return;let e;try{e=JSON.parse(value);}catch{cancel('官方 CLI 回傳了非預期格式，已停止；請更新 CLI 後重試。');return;}
        if(e.event==='step_update'){const s=e.step_update||{};if(s.state==='DONE'&&s.usage){const u=s.usage;steps.set(s.step_index,{inputTokens:u.input_tokens,outputTokens:u.output_tokens,cachedInputTokens:u.cache_read_tokens,totalTokens:u.total_tokens});}}
        if(e.event==='result')result=e.result;
        try{onEvent(e);}catch{cancel('無法保存 Antigravity 進度，已停止回合。');}
      };
      child.stdout.on('data',b=>{buffer+=decoder.write(b);if(buffer.length>2*1024*1024){cancel('官方 CLI 單筆事件過大，已停止。');return;}let at;while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at));buffer=buffer.slice(at+1);}});
      // Do not log raw stderr: official auth diagnostics may contain credential material.
      child.stderr.resume();child.stdin.on('error',()=>{});
      child.on('error',()=>finish('無法啟動官方 Antigravity CLI。'));
      child.on('close',code=>{buffer+=decoder.end();if(buffer.trim())line(buffer);finish(!result&&code!==0?'官方 CLI 未完成；請在設定確認登入與可用額度。':null);});
      timer=setTimeout(()=>cancel('Antigravity 工作逾時，已停止程序；不會自動重做。'),timeoutMs);timer.unref();
      child.stdin.end(JSON.stringify({event:'user',message:{content:redact(text)}})+'\n');
    });
    this.running={done,cancel};return this.running;
  }
  async install() {
    if(this.runtime())return {message:'已安裝；按「登入／開啟 CLI」完成登入。'};
    if(process.platform!=='win32')return {manual:true,message:'在終端機執行官方安裝指令，再按重新檢查。',command:'curl -fsSL https://antigravity.google/cli/install.sh | bash'};
    if(this.installing)return {message:'官方 CLI 正在安裝。'};
    this.installError=null;
    this.installing=installOfficialCLI(this.work,{execute:this.exec,runtime:this.runtime,onProgress:p=>{this.installProgress=p;}}).then(()=>{this.cache=null;}).catch(()=>this.installError='官方 CLI 安裝失敗；請重試或開啟官方安裝說明。').finally(()=>this.installing=null);
    return {message:'正在下載並安裝官方 CLI，完成後按「登入／開啟 CLI」。'};
  }
  login() {
    const path=this.runtime();if(!path)throw Error('請先安裝官方 CLI。');
    if(this.running)throw Error('請先等待目前回答完成。');
    if(process.platform!=='win32')return {manual:true,command:path,message:'請在這台電腦的終端機執行下方指令，由官方 CLI 完成登入。'};
    if(this.lastLogin&&Date.now()-this.lastLogin<10000)throw Error('登入視窗已開啟，請在這台電腦查看。');
    const command="& '"+path.replaceAll("'","''")+"'";
    const child=spawn('powershell.exe',['-NoProfile','-NoExit','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{detached:true,windowsHide:false,stdio:'ignore',env:agyEnvironment()});
    child.on('error',()=>{});child.unref();this.lastLogin=Date.now();this.cache=null;
    return {message:'已在 '+os.hostname()+' 開啟官方 CLI；完成 Google 登入後，按「重新檢查」。'};
  }
}
