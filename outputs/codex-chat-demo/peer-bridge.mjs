import { EventEmitter } from 'node:events';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { privateOrigin } from './peer-gateway.mjs';
import { toolPermissions } from './runtime-status.mjs';

export class PeerBridge extends EventEmitter {
  constructor(work,config){super();this.work=work;this.origin=privateOrigin(config.inferenceOrigin);this.name=config.name||os.hostname();this.remote=true;this.cursor=0;this.closed=false;this.controller=new AbortController();
    const file=join(work,'device-credential.json');this.credential=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{id:randomUUID(),secret:randomBytes(32).toString('hex'),inferenceOrigin:this.origin};
    if(this.credential.inferenceOrigin!==this.origin)throw new Error('配對憑證屬於另一台額度主機；請建立新的獨立安裝，不能靜默轉用憑證。');
    if(!existsSync(file))writeFileSync(file,JSON.stringify(this.credential),{mode:0o600});
  }
  async request(path,body,authenticate=true,timeoutMs=60000){
    const readOnly=body===undefined;
    for(let attempt=0;;attempt++){
      let r,data;
      try{
        r=await fetch(this.origin+path,{method:readOnly?'GET':'POST',headers:{'Content-Type':'application/json',...(authenticate?{Authorization:'Bearer '+this.credential.secret}:{})},...(!readOnly?{body:JSON.stringify(body)}:{}),signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(timeoutMs)])});
        data=await r.json();
      }catch(e){
        if(this.closed)throw e;
        // Retry only read-only transport failures. A lost POST response may already have started a turn.
        if(readOnly&&attempt===0&&timeoutMs===60000){await new Promise(resolve=>setTimeout(resolve,350));continue;}
        const raw=e.cause?.code||e.code||e.name;
        const code=/^[A-Z_0-9]{2,50}$/.test(raw||'')?raw:e.name==='TimeoutError'?'TIMEOUT':'NETWORK';
        const reason=code==='ENOTFOUND'||code==='EAI_AGAIN'?'私人網址無法解析，請確認 Tailscale 已連線。':code==='ECONNREFUSED'?'額度主機的服務未啟動。':code.includes('CERT')?'私人連線憑證驗證失敗。':'私人連線中斷或逾時，請確認 Tailscale 與額度主機均在線。';
        const error=new Error(`本機連不到額度主機：${reason}（${code}）`+(!readOnly?' 請先查看對話是否已開始；系統不會自動重送問題。':''));
        error.code=code;throw error;
      }
      if(!r.ok)throw new Error(data.error||`額度主機拒絕請求（HTTP ${r.status}）。`);
      return data;
    }
  }
  async register(){
    if(this.registering)return this.registering;
    this.registering=this.request('/peer/register',{id:this.credential.id,keyHash:createHash('sha256').update(this.credential.secret).digest('hex'),name:this.name,origin:this.storageOrigin()},false).then(r=>{this.registration=r;return r;}).catch(e=>{this.registration={state:'offline',reason:e.message};return this.registration;}).finally(()=>{this.registering=null;});
    return this.registering;
  }
  async start(){
    this.register();this.poll();this.heartbeat=setInterval(()=>this.presence().catch(()=>{}),60000);this.heartbeat.unref();return this;
  }
  storageOrigin(){try{return JSON.parse(readFileSync(join(this.work,'remote-access.json'),'utf8')).origin;}catch{return null;}}
  async presence(){return this.request('/peer/presence',{origin:this.storageOrigin()});}
  async models(){if(this.registration?.state!=='approved')return [];try{return await this.request('/peer/models');}catch{return [];}}
  async devices(){return this.request('/peer/devices',undefined,true,3000);}
  async identity(){try{return await this.request('/peer/identity',undefined,false,3000);}catch{return {login:this.registration?.login||null,workspaceOwner:false,unavailable:true};}}
  async runtimeStatus(context){
    let s;
    if(this.registration?.state!=='approved')return {unavailable:true,reason:this.registration?.reason||'正在連接額度主機；本機紀錄仍可查看。'};
    try{s=await this.request('/peer/status');if(this.epoch&&this.epoch!==s.gatewayEpoch){this.cursor=0;this.emit('session-reset');}this.epoch=s.gatewayEpoch;this.presence().catch(()=>{});}
    catch(e){return {unavailable:true,reason:e.message};}
    const chat=context.chat;
    return {...s,executionHost:s.host,host:{name:os.hostname(),platform:os.platform(),source:'儲存主機作業系統'},
      connection:{kind:'paired',inferenceOrigin:this.origin,storageHost:os.hostname(),transcriptsStoredAtInferenceHost:false},
      model:{requested:chat?.model||context.requestedModel||'auto',dispatched:chat?.actualModel||null,scope:chat?'目前或最近一回合的送出模型':'尚未開始這段對話',source:'本機後端送交已配對額度主機的 turn/start 模型',unavailableReason:chat?.actualModel?null:'尚未送出問題'},
      localUsage:context.localUsage,permissions:toolPermissions(context.owner!==false),
      billing:{...s.billing,accountRelation:'此為配對額度主機的帳戶；不是儲存主機或瀏覽器的登入帳戶'},
    };
  }
  async newThread(model,tools=[],options={}){return this.request('/peer/thread',{model,historyEnabled:tools.length>0,executionEnabled:!!options.executionTools?.length,executionToolNames:(options.executionTools||[]).map(t=>t.name)});}
  async rpc(method,params){if(method==='turn/steer')return this.request('/peer/steer',{threadId:params.threadId,turnId:params.expectedTurnId,text:params.input[0].text});if(method==='turn/start')return this.request('/peer/turn',{threadId:params.threadId,model:params.model,text:params.input[0].text,context:params.additionalContext?.cocow_runtime?.value,serviceTier:params.serviceTierForTurn||'default',images:params.input.filter(i=>i.type==='image'),effort:params.effort});if(method==='turn/interrupt')return this.request('/peer/interrupt',{threadId:params.threadId});throw new Error('配對模式未開放此操作。');}
  async poll(){while(!this.closed){try{if(this.registration?.state!=='approved'){await this.register();if(this.registration?.state!=='approved')throw Error('Not connected');}const data=await this.request('/peer/events?after='+this.cursor+(this.epoch?'&epoch='+encodeURIComponent(this.epoch):''));if(data.reset||this.epoch&&data.gatewayEpoch&&this.epoch!==data.gatewayEpoch){this.cursor=0;this.epoch=data.gatewayEpoch;this.emit('session-reset');continue;}if(data.gatewayEpoch)this.epoch=data.gatewayEpoch;for(const event of data.events){this.cursor=event.sequence;if(event.type==='notification')this.emit('notification',event.method,event.params);else if(event.type==='tool-call')this.respondTool(event);}}catch{if(!this.closed)await new Promise(r=>setTimeout(r,3000));}}}
  async respondTool(event){let result;try{result=await this.toolHandler(event.params);}catch(e){result={success:false,contentItems:[{type:'inputText',text:e.message}]};}try{await this.request('/peer/tool-result',{callId:event.callId,...result});}catch{}}
  close(){this.closed=true;clearInterval(this.heartbeat);this.controller.abort();}
}
