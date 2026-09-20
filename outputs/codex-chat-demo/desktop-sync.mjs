import net from 'node:net';
import os from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Optional local desktop cache notification. No model call, commands, credentials,
// transcript payload, or modification of the desktop's live global-state file.
// This transport is version-dependent; delivery does not prove UI rendering.
export function notifyDesktop({threadId,archived=false,timeoutMs=1500,pipePath=process.platform==='win32'?'\\\\.\\pipe\\codex-ipc':join(process.env.CODEX_HOME||join(os.homedir(),'.codex'),'ipc','ipc.sock')}={}) {
 if(!/^[0-9a-f-]{36}$/i.test(threadId||''))return Promise.resolve({notified:false,reason:'缺少有效的原生對話 ID。'});
 return new Promise(resolve=>{
  const socket=net.createConnection(pipePath),requestId=randomUUID();let buffer=Buffer.alloc(0),settled=false;
  const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();resolve({...result,at:new Date().toISOString()});};
  const timer=setTimeout(()=>finish({notified:false,reason:'桌面通知逾時。'}),timeoutMs);
  const frame=value=>{const text=Buffer.from(JSON.stringify(value));const out=Buffer.alloc(4+text.length);out.writeUInt32LE(text.length);text.copy(out,4);return out;};
  socket.on('error',()=>finish({notified:false,reason:'官方桌面未開啟，或目前版本不提供本機通知通道。'}));
  socket.on('close',()=>finish({notified:false,reason:'桌面通知通道已關閉。'}));
  socket.on('connect',()=>socket.write(frame({type:'request',method:'initialize',version:0,requestId,params:{clientType:'codex-local-web'}})));
  socket.on('data',chunk=>{
   if(buffer.length+chunk.length>1024*1024)return finish({notified:false,reason:'桌面通知回應超出限制。'});
   buffer=Buffer.concat([buffer,chunk]);
   while(buffer.length>=4){const length=buffer.readUInt32LE();if(length>1024*1024)return finish({notified:false,reason:'桌面通知格式不符。'});if(buffer.length<4+length)return;
    let msg;try{msg=JSON.parse(buffer.subarray(4,4+length).toString());}catch{return finish({notified:false,reason:'桌面通知格式不符。'});}buffer=buffer.subarray(4+length);
    if(msg.type!=='response'||msg.requestId!==requestId)continue;
    if(msg.resultType!=='success'||typeof msg.result?.clientId!=='string')return finish({notified:false,reason:'桌面未接受更新通知。'});
    // Native desktop uses these notifications to invalidate the thread catalog
    // and read the durable record. Caller must have committed this exact state.
    socket.write(frame({type:'broadcast',method:archived?'thread-archived':'thread-unarchived',version:archived?2:1,sourceClientId:msg.result.clientId,params:{hostId:'local',conversationId:threadId}}),err=>finish(err?{notified:false,reason:'桌面通知傳送失敗。'}:{notified:true,reason:null}));
   }
  });
 });
}
