import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {estimateTokens} from './quota-estimate.mjs';

export const accountKey=login=>String(login||'').trim().toLowerCase();
const rounded=n=>Math.round(n*10000)/10000;
export function windowFor(period,now=Date.now()){
 const shifted=new Date(now+8*3600000);shifted.setUTCHours(0,0,0,0);
 if(period==='week')shifted.setUTCDate(shifted.getUTCDate()-(shifted.getUTCDay()+6)%7);
 const start=shifted.getTime()-8*3600000;return {start,end:start+(period==='week'?7:1)*86400000};
}
export function isQuotaAdmin(access,ownerLogin){
 return Boolean(ownerLogin && (access.remote===false || (access.remote===true && accountKey(access.login)===accountKey(ownerLogin))));
}
export function requireAdmin(access,ownerLogin){
 if(!isQuotaAdmin(access,ownerLogin)){const e=new Error('中控台僅限額度主機本機或擁有者登入。');e.statusCode=403;throw e;}
}
export class AccountBudgets {
 constructor(work,ownerLogin,{now=()=>Date.now()}={}){
  this.file=join(work,'account-budgets.json');this.owner=accountKey(ownerLogin);this.now=now;
  this.data=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{version:1,startedAt:new Date(now()).toISOString(),accounts:{},entries:[],audit:[]};
  if(this.data.version!==1||!this.data.accounts||!Array.isArray(this.data.entries)||!Array.isArray(this.data.audit))throw new Error('帳號配額資料格式錯誤，停止啟動以保留資料。');
  for(const e of this.data.entries)if(e.status==='reserved')e.status='cancelled';else if(e.status==='running')e.status='unknown';
  this.save();
 }
 save(){writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
 rule(login){const key=accountKey(login);return this.data.accounts[key]||{enabled:key===this.owner,period:'day',tokenLimit:key===this.owner?null:0,requestLimit:key===this.owner?null:0};}
 // Only official aggregate percentages are available, so individual shares are estimates.
 observeStatus(status){
  const at=Date.parse(status?.sources?.limits?.capturedAt||status?.capturedAt);
  if(!Number.isFinite(at)||at<(this.data.shared?.capturedAt||0))return;
  const windows=status?.windows,valid=Array.isArray(windows)&&windows.length>0&&windows.every(w=>Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>0&&Number.isFinite(w.resetsAt)&&w.resetsAt*1000>this.now());
  const evidence=status?.billing?.evidence;
  const trusted=status?.authMode==='chatgpt'&&evidence?.officialRouteVerified===true&&evidence?.matchesExpectedAccount===true&&evidence?.noExtraCodexCredits===true;
  if(!valid||!trusted){this.data.shared={...this.data.shared,available:false,capturedAt:at,reason:'無法取得已核對帳戶的有效百分比，暫停百分比配額。'};this.save();return;}
  const w=[...windows].sort((a,b)=>b.windowDurationMins-a.windowDurationMins)[0];
  const previous=this.data.shared;
  // Reset timestamps can jitter by a second between official samples. Preserve
  // the established identity only while that same window is still unexpired.
  const sameWindow=previous?.slot===w.slot&&previous.windowDurationMins===w.windowDurationMins&&Date.parse(previous.resetsAt)>this.now()&&Math.abs(Date.parse(previous.resetsAt)-w.resetsAt*1000)<=5000;
  const key=sameWindow?previous.key:`codex:${w.slot}:${w.windowDurationMins}:${w.resetsAt}`;
  // Reject out-of-order reads within a window. A backwards correction is ambiguous.
  const backwards=previous?.key===key&&w.usedPercent<previous.usedPercent;
  this.data.shared={available:true,key,slot:w.slot,windowDurationMins:w.windowDurationMins,usedPercent:w.usedPercent,remainingPercent:100-w.usedPercent,minimumRemainingPercent:Math.min(...windows.map(v=>100-v.usedPercent)),resetsAt:sameWindow?previous.resetsAt:new Date(w.resetsAt*1000).toISOString(),capturedAt:at,canStart:status.canStartChat===true,reason:status.canStartChat?null:status.billing?.reason||'共用訂閱暫時無法使用。'};
  this.data.usageReference={key,recentDays:status.accountUsage?.recentDays||[]};
  for(const e of this.data.entries.filter(e=>e.status==='running'&&e.percentCursor)){
   // Retain the high-water usage estimate on official downward corrections.
   // Never refund recorded usage or block an account solely for a correction.
   const cursor=e.percentCursor;
   if(cursor.key!==key){e.percentUncertain=true;e.percentCursor={key,used:w.usedPercent};continue;}
   const delta=Math.max(0,w.usedPercent-cursor.used);e.percentUsage||={};e.percentUsage[key]=rounded((e.percentUsage[key]||0)+delta);cursor.used=Math.max(cursor.used,w.usedPercent);e.percentSampleAt=at;
  }
  this.save();
 }
 sharedView(){const s=this.data.shared;return s?{...s,available:s.available&&this.now()-s.capturedAt<30000,measurement:'aggregate-window-delta-estimate'}:{available:false,reason:'尚未取得官方百分比。'};}
 stopReason(login){const v=this.view(login),s=this.sharedView();if(!v.enabled)return '帳號已暫停。';if(v.mode==='percent'){
   if(!s.available)return s.reason||'官方百分比尚未更新，暫停使用。';
   if(!s.canStart||s.minimumRemainingPercent<=0)return s.reason||'共用訂閱額度已用完。';
   if(v.percentUnknown)return '百分比用量未能確認，請擁有者到中控台處理。';
   if(v.remainingPercent<=0)return '這個帳號本期百分比額度已用完。';
  }return v.remainingTokens===0?'這個帳號本期 Token 額度已用完。':null;}
 view(login){const key=accountKey(login),rule=this.rule(key),window=windowFor(rule.period,this.now());
  const entries=this.data.entries.filter(e=>e.login===key&&e.status!=='cancelled'&&e.startedAt>=window.start&&e.startedAt<window.end),unknown=this.data.entries.filter(e=>e.login===key&&e.status==='unknown');
  const tokens=entries.reduce((n,e)=>n+(e.tokens||0),0),requests=entries.length,shared=this.sharedView();
  const percentUsed=rounded(this.data.entries.filter(e=>e.login===key&&e.status!=='cancelled').reduce((n,e)=>n+(e.percentUsage?.[shared.key]||0),0));
  const percentUnknown=this.data.entries.filter(e=>e.login===key&&(e.percentUncertain||e.status==='unknown'&&e.percentCursor)).length;
  const remainingPercent=rule.percentLimit==null?shared.remainingPercent:rounded(Math.max(0,rule.percentLimit-percentUsed));
  const tokenEstimate=estimateTokens({shared,remainingPercent,usage:this.data.usageReference?.key===shared.key?this.data.usageReference:null,now:this.now()});
  return {login:key,owner:key===this.owner,configured:Object.hasOwn(this.data.accounts,key)||key===this.owner,mode:rule.mode||'tokens',...rule,tokens,requests,percentUsed,percentUnknown,tokenEstimate,usablePercent:shared.available?Math.max(0,Math.min(remainingPercent,shared.minimumRemainingPercent)):null,remainingPercent:rule.percentLimit==null?null:rounded(Math.max(0,rule.percentLimit-percentUsed)),sharedRemainingPercent:shared.available?shared.remainingPercent:null,remainingTokens:rule.tokenLimit==null?null:Math.max(0,rule.tokenLimit-tokens),remainingRequests:rule.requestLimit==null?null:Math.max(0,rule.requestLimit-requests),unknown:unknown.length,pending:this.data.entries.filter(e=>e.login===key&&['reserved','running'].includes(e.status)).length,resetsAt:rule.mode==='percent'?shared.resetsAt||null:new Date(window.end).toISOString()};
 }
 check(login,{ignorePending=false}={}){const v=this.view(login);
  const reason=this.stopReason(login);if(reason)throw new Error(reason);
  if(!v.enabled)throw new Error('此帳號尚未獲分配額度，或已暫停使用。');
  if(v.unknown&&v.tokenLimit!=null)throw new Error('上一回合用量尚未確認，請擁有者到中控台處理。');
  if(!ignorePending&&v.pending)throw new Error('這個帳號已有處理中的請求。');
  if(v.remainingRequests===0)throw new Error('這個帳號本期提問次數已用完。');
  if(v.remainingTokens===0)throw new Error('這個帳號本期 Token 額度已用完。');return v;
 }
 // A shared host may run more than one independent conversation at once.  The
 // old implementation used one global lease, so a second chat was forced to
 // wait behind the first one even though Codex supports separate threads.
 // Keep per-account quota checks, but do not serialize unrelated turns here.
 reserve(login,{source='web',model}={}){this.check(login,{ignorePending:true});const e={id:randomUUID(),login:accountKey(login),source,model,status:'reserved',startedAt:this.now(),tokens:null};this.data.entries.push(e);this.save();return e.id;}
 dispatch(id){const e=this.data.entries.find(e=>e.id===id);if(!e||e.status!=='reserved')throw new Error('配額保留已失效。');const reason=this.stopReason(e.login);if(reason)throw new Error(reason);if(this.rule(e.login).mode==='percent'){const s=this.sharedView();e.percentCursor={key:s.key,used:s.usedPercent};e.percentUsage={};e.percentStartedAt=this.now();}e.status='running';this.save();}
 measure(id,usage){const e=this.data.entries.find(e=>e.id===id);const n=usage?.last?.totalTokens;if(!e||!Number.isSafeInteger(n)||n<0)return false;e.tokens=Math.max(e.tokens||0,n);this.save();const v=this.view(e.login);return !v.enabled||v.remainingTokens===0;}
 finish(id,{uncertain=false}={}){const e=this.data.entries.find(e=>e.id===id);if(!e||!['reserved','running'].includes(e.status))return;if(e.status==='running'&&e.percentCursor&&(!this.sharedView().available||!e.percentSampleAt||e.percentSampleAt<e.percentStartedAt||this.now()-e.percentSampleAt>5000))e.percentUncertain=true;e.status=e.status==='reserved'?'cancelled':(e.percentCursor?e.percentUncertain:uncertain||e.tokens==null)?'unknown':'completed';e.finishedAt=this.now();this.save();}
 knownLimit(login){const v=this.view(login),s=this.sharedView();return !v.enabled||v.remainingTokens===0||v.mode==='percent'&&v.remainingPercent===0||s.available&&s.minimumRemainingPercent===0;}
 configure(actor,change){const login=accountKey(change.login);if(!/^[^@\s]{1,120}@[^@\s]{1,120}$/.test(login))throw new Error('請填寫 Tailscale 登入帳號（Email）。');
  if(!['day','week'].includes(change.period)||typeof change.enabled!=='boolean')throw new Error('配額設定格式錯誤。');
  const limit=n=>{if(n===null)return null;if(!Number.isSafeInteger(n)||n<0||n>1000000000)throw new Error('上限須為 0–1,000,000,000 的整數；留空為不限。');return n;};
  const mode=change.mode||'tokens';if(!['percent','tokens'].includes(mode))throw new Error('未知配額模式。');
  if(mode==='percent'&&(!Number.isFinite(change.percentLimit)||change.percentLimit<0||change.percentLimit>100))throw new Error('百分比須介於 0–100。');
  const rule=mode==='percent'?{enabled:change.enabled,period:change.period,mode,percentLimit:rounded(change.percentLimit),tokenLimit:null,requestLimit:null}:{enabled:change.enabled,period:change.period,mode,tokenLimit:limit(change.tokenLimit),requestLimit:limit(change.requestLimit)};
  this.data.accounts[login]=rule;this.data.audit.push({at:new Date(this.now()).toISOString(),actor:accountKey(actor),action:'configure',login,...rule});this.save();return this.view(login);
 }
 acknowledge(actor,login){const key=accountKey(login);let count=0;for(const e of this.data.entries)if(e.login===key&&(e.status==='unknown'||e.percentUncertain)&&!['reserved','running'].includes(e.status)){e.status='acknowledged';e.percentUncertain=false;count++;}this.data.audit.push({at:new Date(this.now()).toISOString(),actor:accountKey(actor),action:'acknowledge-reported-usage',login:key,count});this.save();return this.view(key);}
 dashboard(devices=[]){const logins=[...new Set([this.owner,...Object.keys(this.data.accounts),...devices.map(d=>accountKey(d.login))])].filter(Boolean);
  return {startedAt:this.data.startedAt,capturedAt:new Date(this.now()).toISOString(),owner:this.owner,timeZone:'Asia/Taipei',shared:this.sharedView(),accounts:logins.map(login=>({...this.view(login),devices:devices.filter(d=>accountKey(d.login)===login).map(d=>({id:d.id,name:d.name,state:d.state,lastSeenAt:d.lastSeenAt}))})),audit:this.data.audit.slice(-20).reverse(),measurement:'aggregate-window-delta-estimate',note:'百分比按官方最長訂閱週期計算。10% 指完整週期的 10 個百分點，不是剩餘額度的 10%。所有人共用剩餘額度，先用先扣、不預留。個人用量以回合期間的帳戶百分比下降估算；官方回報可能延遲，且同帳戶的外部使用可能混入。達標後停止續跑與新提問，最後一回合可能超過上限。'};
 }
}
