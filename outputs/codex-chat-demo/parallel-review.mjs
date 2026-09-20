import {TurnUsageMeter} from './usage.mjs';
// Bounded, tool-free reviewers: same billing route, no recursive delegation.
export async function parallelReview(bridge,args,{model,alive,onUsage=()=>{},onProgress=()=>{}}){
 if(!Array.isArray(args.tasks)||args.tasks.length<1||args.tasks.length>2||args.tasks.some(t=>typeof t!=='string'||!t.trim()||t.length>6000))throw Error('一次提供 1–2 個任務，每個最多 6000 字。');
 if(typeof args.context!=='string'||args.context.length>16000)throw Error('共用背景最多 16000 字。');
 const results=await Promise.all(args.tasks.map(async(task,index)=>{
  if(!alive())throw Error('主回合已停止');
  const {thread}=await bridge.newThread(model,[],{persistent:false});let turnId,text='',settled=false;const meter=new TurnUsageMeter();let finish;
  const done=new Promise(resolve=>finish=resolve);const stop=()=>{if(turnId)bridge.rpc('turn/interrupt',{threadId:thread.id,turnId}).catch(()=>{});};
  const handler=(method,p)=>{if(p.threadId!==thread.id)return;if(method==='turn/started')turnId=p.turn?.id;if(method==='item/agentMessage/delta')text+=p.delta||'';if(method==='thread/tokenUsage/updated'){const u=meter.add(p,turnId);if(u)onUsage(index,u);}if(method==='turn/completed'){settled=true;finish({state:p.turn?.status||'completed',text:text.slice(0,24000)});}if(method==='error'&&!p.willRetry){settled=true;finish({state:'failed',text:'子代理執行失敗'});}};
  bridge.on('notification',handler);const timer=setTimeout(()=>{stop();finish({state:'timeout',text:text.slice(0,24000)});},90000);const guard=setInterval(()=>{if(!alive()){stop();finish({state:'stopped',text:text.slice(0,24000)});}},200);
  try{onProgress({index,state:'running'});const r=await bridge.rpc('turn/start',{threadId:thread.id,input:[{type:'text',text:'You are an independent reviewer. Do not use tools or request delegation. Analyze only supplied context; label anything unverified. Return a concise result in Traditional Chinese.\nTask: '+task+'\nContext: '+args.context,text_elements:[]}],effort:'low',serviceTierForTurn:'default'});turnId=r.turn.id;if(!alive())stop();const result=await done;onProgress({index,state:result.state});return {index,...result};}
  finally{clearTimeout(timer);clearInterval(guard);bridge.off('notification',handler);if(!settled)stop();}
 }));return {scope:'parallel-analysis-only',results};
}
export function mergeReviewUsage(meter,previous,index,usage){const prior=previous[index]||{},next=usage.last;for(const [key,value]of Object.entries(next))if(typeof value==='number')meter.sum[key]=(meter.sum[key]||0)+Math.max(0,value-(prior[key]||0));previous[index]={...next};return {...usage,last:{...meter.sum},measurement:'parent-and-reviewers',includesCachedInput:true};}
