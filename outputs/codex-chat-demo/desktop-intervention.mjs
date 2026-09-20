import net from 'node:net';
import os from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Version-dependent desktop follower protocol. Never remove a writer lock or
// retry an ambiguous submission: it may already have reached the owning window.
export async function desktopIntervention({threadId,text,cwd,working=false,probe=false,requestId=randomUUID(),pipePath=process.platform==='win32'?'\\\\.\\pipe\\codex-ipc':join(process.env.CODEX_HOME||join(os.homedir(),'.codex'),'ipc','ipc.sock'),timeoutMs=10000}) {
 if(!/^[0-9a-f-]{36}$/i.test(threadId||''))throw Error('對話 ID 不正確');
 if(!probe&&(typeof text!=='string'||!text.trim()||text.length>16000))throw Error('請輸入介入訊息');
 const socket=net.createConnection(pipePath),pending=new Map();let buffer=Buffer.alloc(0),clientId;
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('桌面通道中斷；請先查看原對話，避免重複送出。'));}pending.clear();};
 socket.on('error',fail);socket.on('close',fail);
 socket.on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>4*1024*1024)return socket.destroy();
  while(buffer.length>=4){const n=buffer.readUInt32LE();if(n>4*1024*1024)return socket.destroy();if(buffer.length<n+4)return;let msg;try{msg=JSON.parse(buffer.subarray(4,n+4));}catch{return socket.destroy();}buffer=buffer.subarray(n+4);const p=pending.get(msg.requestId);if(msg.type!=='response'||!p)continue;pending.delete(msg.requestId);clearTimeout(p.timer);msg.resultType==='success'?p.resolve(msg):p.reject(Error(msg.error==='no-client-found'?'找不到持有此對話的 Codex 視窗；請在官方 Codex 開啟此對話。':'桌面未接受請求：'+String(msg.error).slice(0,300)));}
 });
 const rpc=(method,version,params,targetClientId)=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('桌面回應逾時；請查看原對話確認是否送達，勿直接重送。'));},timeoutMs);pending.set(id,{resolve,reject,timer});const data=Buffer.from(JSON.stringify({type:'request',requestId:id,sourceClientId:clientId,version,method,params,targetClientId,timeoutMs})),frame=Buffer.alloc(data.length+4);frame.writeUInt32LE(data.length);data.copy(frame,4);socket.write(frame);});
 try{
  clientId=(await rpc('initialize',0,{clientType:'cocow'})).result.clientId;
  const owner=await rpc('thread-owner-discovery',1,{hostId:'local',conversationId:threadId});
  if(!owner.handledByClientId)throw Error('桌面沒有回傳對話擁有者');
  if(probe)return {available:true};
  const input=[{type:'text',text:text.trim(),text_elements:[]}];
  const method=working?'thread-follower-steer-turn':'thread-follower-start-turn';
  const params=working?{conversationId:threadId,input,clientUserMessageId:requestId,attachments:[],restoreMessage:{id:requestId,text:text.trim(),cwd,createdAt:Date.now(),context:{prompt:text.trim(),addedFiles:[],fileAttachments:[],imageAttachments:[],ideContext:null,workspaceRoots:cwd?[cwd]:[]}}}:{conversationId:threadId,turnStart:{request:{threadId,input,clientUserMessageId:requestId},context:{inheritThreadSettings:true}}};
  const result=await rpc(method,working?1:2,params,owner.handledByClientId);
  return {accepted:true,mode:working?'steer':'start',result:result.result?.result??null};
 }finally{socket.destroy();fail();}
}
