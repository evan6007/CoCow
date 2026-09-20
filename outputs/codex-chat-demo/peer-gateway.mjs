import {serviceTier} from './service-tier.mjs';
import {validToolOutput,toolOutput} from './tool-output.mjs';
import {parallelReview,mergeReviewUsage} from './parallel-review.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {accountKey} from './account-budgets.mjs';
import {TurnUsageMeter}from'./usage.mjs';
import { historyTools } from './history.mjs';
import { executionTools } from './execution-tools.mjs';

export function privateOrigin(value) {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !(u.protocol === 'https:' && u.hostname.endsWith('.ts.net') || u.protocol === 'http:' && u.hostname === '127.0.0.1')) throw new Error('請使用 Tailscale 私人 HTTPS 網址，或本機測試位址。');
  return u.origin;
}
const hash = value => createHash('sha256').update(value).digest('hex');
const safeDevice = d => ({ id: d.id, name: d.name, login: d.login, origin: d.origin, state: d.state, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt || null });
const reply = (res, code, data) => { res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store' });res.end(JSON.stringify(data)); };
async function body(req) { let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>29000000)throw new Error('請求過大。');}return JSON.parse(text||'{}'); }

// A model-only gateway: no transcript/index files, ephemeral Codex threads only.
// Device secrets stay on the paired computer; this host stores only SHA-256 hashes.
export class PeerGateway {
  constructor({ bridge, work, models, getStatus, budgets, isLocalBusy }) {
    Object.assign(this,{bridge,work,models,getStatus,budgets,isLocalBusy});this.file=join(work,'paired-devices.json');
    this.devices=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):[];
    this.threads=new Map();this.queues=new Map();this.waiters=new Map();this.calls=new Map();this.actives=new Map();this.active=null;this.epoch=randomUUID();
    bridge.on('notification',(method,p)=>this.onEvent(method,p));
  }
  save(){writeFileSync(this.file+'.tmp',JSON.stringify(this.devices,null,2));renameSync(this.file+'.tmp',this.file);}
  list(){return this.devices.map(d=>safeDevice(this.approveListed(d)));}
  setState(id,state){const d=this.devices.find(x=>x.id===id);if(!d||!['approved','revoked'].includes(state))throw new Error('未知裝置或狀態。');d.state=state;this.save();if(state==='revoked')for(const a of this.activeList().filter(x=>x.deviceId===id))this.interrupt('裝置授權已撤銷。',{active:a});return safeDevice(d);}
  activeList(includeSettling=false){return [...this.actives.values()].filter(a=>a&&(includeSettling||!a.settling));}
  findActive({threadId,deviceId,turnId}={},includeSettling=false){return this.activeList(includeSettling).find(a=>(threadId&&a.threadId===threadId)&&(deviceId==null||a.deviceId===deviceId)&&(turnId==null||a.turnId===turnId))||null;}
  registerActive(a){this.actives.set(a.threadId,a);if(!this.active||this.active.settling)this.active=a;return a;}
  removeActive(a){if(!a)return;if(this.actives.get(a.threadId)===a)this.actives.delete(a.threadId);if(this.active===a)this.active=this.activeList()[0]||null;}
  get busy(){return this.activeList().length>0;}
  owns(id){return this.threads.has(id);}
  // Only a trusted local client or Tailscale Serve may reach this route.
  identity(headers,localOrigin){
    const configFile=join(this.work,'remote-access.json');const config=existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')):null;
    const localHost=new URL(localOrigin).host;
    const proxied=headers.host!==localHost||Object.keys(headers).some(k=>k.startsWith('tailscale-')||k.startsWith('x-forwarded-'));
    if(!proxied){if(headers.origin&&headers.origin!==localOrigin)throw new Error('跨來源請求已拒絕。');return config?.ownerLogin||'local-owner';}
    if(!config||![localHost,new URL(privateOrigin(config.origin)).host].includes(headers.host)||typeof headers['tailscale-user-login']!=='string'||!headers['tailscale-user-login'])throw new Error('需透過已登入的 Tailscale 私人連線。');
    if(headers.origin&&headers.origin!==config.origin)throw new Error('跨來源請求已拒絕。');
    return headers['tailscale-user-login'];
  }
  accountEnabled(login){const account=this.budgets?.view(login);return account?.configured===true&&account.enabled===true;}
  approveListed(d){if(d.state==='pending'&&this.accountEnabled(d.login)){d.state='approved';this.save();}return d;}
  authenticate(req,login){const bearer=req.headers.authorization;if(typeof bearer!=='string'||!/^Bearer [a-f0-9]{64}$/.test(bearer))throw new Error('缺少裝置驗證。');const keyHash=hash(bearer.slice(7));const d=this.devices.find(x=>x.keyHash===keyHash&&accountKey(x.login)===accountKey(login));if(this.budgets&&!this.accountEnabled(login))throw new Error('此帳號尚未加入名單或已暫停。');if(d)this.approveListed(d);if(!d||d.state!=='approved')throw new Error(d?.state==='pending'?'等待額度主機擁有者核准此裝置。':'裝置未授權或已撤銷。');return d;}
  enqueue(id,event){const q=this.queues.get(id)||{sequence:0,events:[]};q.events.push({sequence:++q.sequence,...event});this.queues.set(id,q);this.waiters.get(id)?.();if(q.events.length>4000)for(const a of this.activeList().filter(x=>x.deviceId===id))this.interrupt('連線中斷，事件佇列已滿。',{active:a});}
  async events(id,cursor,epoch){let q=this.queues.get(id)||{sequence:0,events:[]};if(epoch&&epoch!==this.epoch||cursor>q.sequence)return {events:[],gatewayEpoch:this.epoch,reset:true};q.events=q.events.filter(e=>e.sequence>cursor);this.queues.set(id,q);if(!q.events.length)await new Promise(resolve=>{const timer=setTimeout(done,20000);const self=this;function done(){clearTimeout(timer);self.waiters.delete(id);resolve();}this.waiters.set(id,done);});q=this.queues.get(id);return {gatewayEpoch:this.epoch,events:q.events.filter(e=>e.sequence>cursor).slice(0,500)};}
  onEvent(method,p){const t=this.threads.get(p.threadId);if(!t)return;const a=this.findActive({threadId:p.threadId});
    if(method==='item/started'&&/commandExecution|fileChange|mcpToolCall|webSearch|imageGeneration|collabAgent/.test(p.item?.type||'')){this.interrupt('共用服務只允許文字與受限唯讀工具。',{active:a});return;}
    const allowed=['item/agentMessage/delta','item/reasoning/summaryTextDelta','item/started','item/completed','thread/tokenUsage/updated','turn/started','turn/completed','error'];
    if(allowed.includes(method))this.enqueue(t.deviceId,{type:'notification',method,params:p});
    if(method==='turn/started'&&a)a.turnId=p.turn?.id;
    if(method==='thread/tokenUsage/updated'&&a){const usage=a.meter.add(p,a.turnId);if(usage&&this.budgets?.measure(a.budgetId,usage)){this.interrupt('此帳號本期 Token 額度已用完，已停止續跑。',{active:a});return;}}
    if(method==='turn/completed'&&a)this.settle(a,p.turn?.status!=='completed');
    if(method==='error'&&p.willRetry!==true&&a)this.settle(a,true);
  }
  settle(a,uncertain=false){if(a.settling||a.stopping&&!a.stopAcknowledged)return;a.settling=true;clearTimeout(a.timer);
    const finish=()=>{this.budgets?.finish(a.budgetId,{uncertain});this.removeActive(a);};
    a.settled=this.budgets?.rule(a.login).mode==='percent'?this.getStatus().then(s=>this.budgets.observeStatus(s)).catch(()=>{}).finally(finish):Promise.resolve().then(finish);
  }
  interrupt(message,{quotaStop=false,active=null}={}){const a=active||this.active;if(!a||a.settling||a.stopping)return;a.stopping=true;clearTimeout(a.timer);this.enqueue(a.deviceId,{type:'notification',method:'error',params:{threadId:a.threadId,error:{message},willRetry:false}});for(const [id,c] of this.calls)if(c.threadId===a.threadId){clearTimeout(c.timer);c.reject(new Error(message));this.calls.delete(id);}const stopped=a.turnId?this.bridge.rpc('turn/interrupt',{threadId:a.threadId,turnId:a.turnId}):Promise.resolve();return stopped.catch(()=>{quotaStop=false;}).finally(()=>{a.stopAcknowledged=true;this.settle(a,!quotaStop);});}
  async toolHandler(p){const t=this.threads.get(p.threadId);const a=this.findActive({threadId:p.threadId,turnId:p.turnId});if(!t||!a)throw new Error('此工具不屬於目前配對回合。');
    if(!(p.namespace==='codex_history'&&historyTools.some(x=>x.name===p.tool)||p.namespace==='runtime_status'&&p.tool==='get_runtime_status'||t.executionEnabled&&p.namespace==='workspace_execution'&&(t.executionToolNames||['list_files','read_file','write_file','start_job','job_status','stop_job']).includes(p.tool)))throw new Error('工具未開放。');
    if(++a.toolCalls>(t.executionEnabled?68:8))throw new Error('工具呼叫上限已到。');
    if(p.namespace==='workspace_execution'&&p.tool==='parallel_review'){if(a.reviewUsed)throw Error('每回合最多一組平行代理');a.reviewUsed=true;const previous={};return toolOutput(await parallelReview(this.bridge,p.arguments||{},{model:t.model,alive:()=>this.findActive({threadId:a.threadId})===a&&!a.stopping&&!a.settling,onUsage:(i,u)=>{const usage=mergeReviewUsage(a.meter,previous,i,u);if(this.budgets?.measure(a.budgetId,usage))this.interrupt('個人額度已用完',{active:a,quotaStop:true});},onProgress:r=>this.enqueue(t.deviceId,{type:'notification',method:'item/reasoning/summaryTextDelta',params:{threadId:a.threadId,turnId:a.turnId,delta:'平行代理 '+(r.index+1)+'：'+r.state+'\n'}})}));}
    const callId=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.calls.delete(callId);reject(new Error('本機唯讀工具回應逾時。'));},150000);this.calls.set(callId,{deviceId:t.deviceId,resolve,reject,timer});this.enqueue(t.deviceId,{type:'tool-call',callId,params:p});});
  }
  async handle(req,res,url,localOrigin){
    try{
      const login=accountKey(this.identity(req.headers,localOrigin));
      if(req.method==='GET'&&url.pathname==='/peer/identity')return reply(res,200,{login,workspaceOwner:login===this.budgets.owner,ownerLogin:this.budgets.owner});
      if(req.method==='POST'&&url.pathname==='/peer/register'){
        const b=await body(req);if(!/^[a-f0-9-]{36}$/.test(b.id)||!/^[a-f0-9]{64}$/.test(b.keyHash)||typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw new Error('裝置登記格式錯誤。');
        let d=this.devices.find(x=>x.id===b.id);if(d&&(d.keyHash!==b.keyHash||accountKey(d.login)!==login))throw new Error('裝置識別已存在。');
        if(!d){if(this.devices.filter(x=>x.login===login&&x.state==='pending').length>=5)throw new Error('待核准裝置過多。');d={id:b.id,keyHash:b.keyHash,name:b.name.trim(),login,origin:b.origin?privateOrigin(b.origin):null,state:this.accountEnabled(login)?'approved':'pending',createdAt:new Date().toISOString(),lastSeenAt:new Date().toISOString()};this.devices.push(d);this.save();}
        return reply(res,200,safeDevice(this.approveListed(d)));
      }
      const d=this.authenticate(req,login);
      if(req.method==='GET'&&url.pathname==='/peer/status')return reply(res,200,{...await this.getStatus(),gatewayEpoch:this.epoch,allocation:this.budgets?.view(login)});
      if(req.method==='GET'&&url.pathname==='/peer/models')return reply(res,200,this.models.filter(m=>!['auto','cocow-auto-review'].includes(m.id)).map(m=>({model:m.id,displayName:m.name,serviceTiers:m.serviceTiers||[],supportedReasoningEfforts:(m.efforts||['low','medium','high']).map(reasoningEffort=>({reasoningEffort})),defaultReasoningEffort:m.defaultEffort||'low'})));
      if(req.method==='GET'&&url.pathname==='/peer/devices')return reply(res,200,this.devices.filter(x=>x.login===d.login&&x.state==='approved').map(safeDevice));
      if(req.method==='POST'&&url.pathname==='/peer/presence'){const b=await body(req);d.origin=b.origin?privateOrigin(b.origin):null;d.lastSeenAt=new Date().toISOString();this.save();return reply(res,200,safeDevice(d));}
      if(req.method==='GET'&&url.pathname==='/peer/events')return reply(res,200,await this.events(d.id,Number(url.searchParams.get('after'))||0,url.searchParams.get('epoch')));
      if(req.method==='POST'&&url.pathname==='/peer/thread'){
        const b=await body(req);if(!this.models.some(m=>m.id===b.model&&m.id!=='auto'))throw new Error('未知模型。');
        if([...this.threads.values()].filter(t=>t.deviceId===d.id).length>=150)throw new Error('此裝置工作階段過多，請重新連線。');
        const enabled=b.executionEnabled===true&&b.historyEnabled===true;
        const selectedTools=enabled?executionTools.filter(t=>(Array.isArray(b.executionToolNames)?b.executionToolNames:['list_files','read_file','write_file','start_job','job_status','stop_job']).includes(t.name)):[];
        const result=await this.bridge.newThread(b.model,b.historyEnabled===true?historyTools:[],{persistent:false,executionTools:selectedTools});
        this.threads.set(result.thread.id,{model:b.model,deviceId:d.id,executionEnabled:enabled,executionToolNames:selectedTools.map(t=>t.name)});return reply(res,200,{thread:{id:result.thread.id},model:result.model,modelProvider:result.modelProvider});
      }
      if(req.method==='POST'&&url.pathname==='/peer/turn'){
        const b=await body(req);if(this.threads.get(b.threadId)?.deviceId!==d.id)throw new Error('不能操作其他裝置的對話。');
        const previous=this.findActive({threadId:b.threadId,deviceId:d.id},true);if(previous?.settling)await previous.settled;
        if(this.findActive({threadId:b.threadId,deviceId:d.id}))return reply(res,409,{error:'這段對話正在回答中；可切換到其他聊天室繼續工作。'});
        if(!this.models.some(m=>m.id===b.model&&m.id!=='auto')||typeof b.text!=='string'||b.text.length>160000)throw new Error('模型或訊息格式錯誤。');
        if(b.context!=null&&(typeof b.context!=='string'||b.context.length>100000))throw Error('回合背景格式不正確。');
        const images=b.images||[];if(!Array.isArray(images)||images.length>8||images.some(i=>i.type!=='image'||typeof i.url!=='string'||!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(i.url)))throw new Error('圖片格式不正確。');
        const live=await this.getStatus();this.budgets?.observeStatus(live);if(!live.canStartChat)throw new Error(live.billing?.reason||'共用額度無法使用。');
        const tier=serviceTier(this.models,b.model,b.serviceTier);const model=this.models.find(m=>m.id===b.model),effort=b.effort||'low';if(!(model.efforts?.length?model.efforts:['low','medium','high']).includes(effort))throw new Error('不支援的推理強度。');const a=this.registerActive({deviceId:d.id,login:d.login,threadId:b.threadId,turnId:null,toolCalls:0,meter:new TurnUsageMeter(),budgetId:this.budgets?.reserve(d.login,{source:'paired-device',model:b.model})});
        try{const status=await this.getStatus();this.budgets?.observeStatus(status);if(!status.canStartChat)throw new Error(status.billing.reason);this.budgets?.dispatch(a.budgetId);const result=await this.bridge.rpc('turn/start',{threadId:b.threadId,model:b.model,input:[{type:'text',text:b.text,text_elements:[]},...images.map(i=>({type:'image',url:i.url}))],effort,additionalContext:{cocow_runtime:{kind:'application',value:'PAIRED DEVICE EXECUTION: The cwd and environment paths in the model host belong to the quota relay, NOT the user workspace. Never present relay cwd as the client project or recommend its paths for client commands. Use fresh runtime_status and workspace_execution results to determine the selected storage device and workspace. If these are unavailable, state that the client path is unknown. Do not run builtin tools on the relay.\n'+(b.context||'')}},serviceTierForTurn:tier});if(this.findActive({threadId:a.threadId})===a)a.turnId=result.turn.id;return reply(res,200,result);}catch(e){this.budgets?.finish(a.budgetId,{uncertain:true});this.removeActive(a);throw e;}
      }
      if(req.method==='POST'&&url.pathname==='/peer/steer'){
        const b=await body(req),a=this.findActive({threadId:b.threadId,deviceId:d.id,turnId:b.turnId});
        if(!a||a.deviceId!==d.id||a.threadId!==b.threadId||a.turnId!==b.turnId||a.stopping||a.settling)throw Error('不能介入其他裝置或已結束的回合。');
        if(typeof b.text!=='string'||!b.text.trim()||b.text.length>16000)throw Error('補充文字格式不正確。');
        const result=await this.bridge.rpc('turn/steer',{threadId:a.threadId,expectedTurnId:a.turnId,input:[{type:'text',text:b.text.trim(),text_elements:[]}]});
        return reply(res,200,result);
      }
      if(req.method==='POST'&&url.pathname==='/peer/interrupt'){const b=await body(req),a=this.findActive({threadId:b.threadId,deviceId:d.id});if(!a)throw new Error('不能停止其他裝置的回答。');this.interrupt('回答已停止。',{active:a});return reply(res,200,{});}
      if(req.method==='POST'&&url.pathname==='/peer/tool-result'){
        const b=await body(req),call=this.calls.get(b.callId);if(!call||call.deviceId!==d.id)throw new Error('未知的工具回覆。');
        if(!validToolOutput(b))throw new Error('工具回覆格式錯誤。');
        clearTimeout(call.timer);this.calls.delete(b.callId);call.resolve({success:b.success,contentItems:b.contentItems});return reply(res,200,{ok:true});
      }
      return reply(res,404,{error:'未知的配對服務路徑。'});
    }catch(e){return reply(res,403,{error:e.message});}
  }
}

