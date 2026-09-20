import {readFileSync,statSync} from 'node:fs';
const auditCache=new Map();
export function localRequestEvidence(path,now=Date.now()){
 try{
  const stat=statSync(path),key=stat.mtimeMs+':'+stat.size;
  let cached=auditCache.get(path);
  if(cached?.key!==key){const turns=[];for(const line of readFileSync(path,'utf8').split('\n')){try{const r=JSON.parse(line);if(r.event==='turn')turns.push({at:r.timestamp,tokens:r.usage?.last?.totalTokens??null,model:r.model,error:!!r.error});}catch{}}cached={key,turns};auditCache.set(path,cached);}
  const last=cached.turns.at(-1);
  return {completedLastMinute:cached.turns.filter(t=>!t.error&&Date.parse(t.at)>=now-60000).length,lastReplyAt:last?.at||null,lastReplyTokens:last?.tokens??null,lastModel:last?.model||null,evidenceAvailable:true};
 }catch{return {completedLastMinute:null,lastReplyAt:null,lastReplyTokens:null,evidenceAvailable:false};}
}

// App Server's `total` includes earlier turns. Sum only distinct model responses
// tagged with the CURRENT turn ID, including tool follow-up model responses.
export class TurnUsageMeter {
 constructor(){this.seen=new Set();this.sum={};}
 add(notification,turnId){
  if(!turnId||notification.turnId!==turnId)return null;
  const usage=notification.tokenUsage;
  if(!usage?.total||!usage.last)return null;
  const signature=turnId+':'+JSON.stringify(Object.entries(usage.total).sort());
  if(this.seen.has(signature))return null;
  this.seen.add(signature);
  for(const [key,value] of Object.entries(usage.last))if(typeof value==='number'&&Number.isFinite(value)&&value>=0)this.sum[key]=(this.sum[key]||0)+value;
  return {...usage,last:{...this.sum},measurement:'current-turn-responses',includesCachedInput:true};
 }
}
