import net from 'node:net';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validThreadId,visibleMessages,visibleActivities} from './conversations.mjs';

export function applyPatches(root,patches) {
  for(const p of patches||[]){
    if(!['add','replace','remove'].includes(p.op)||!Array.isArray(p.path)||p.path.some(k=>['__proto__','constructor','prototype'].includes(String(k))))throw Error('Unsupported desktop patch');
    if(!p.path.length){if(p.op==='remove')throw Error('Missing snapshot');root=p.value;continue;}
    let parent=root;for(const key of p.path.slice(0,-1)){if(!parent||!Object.hasOwn(parent,key))throw Error('Snapshot gap');parent=parent[key];}
    const key=p.path.at(-1);if(!parent||typeof parent!=='object')throw Error('Snapshot gap');
    if(Array.isArray(parent)&&typeof key==='number'){if(key<0||key>parent.length)throw Error('Snapshot gap');if(p.op==='add')parent.splice(key,0,p.value);else if(p.op==='remove')parent.splice(key,1);else parent[key]=p.value;}
    else if(p.op==='remove')delete parent[key];else parent[key]=p.value;
  }return root;
}

// Only public, visible items leave this module. Raw tool inputs, credentials and
// internal reasoning are never sent to the web client.
export function publicNativeState(s,id){
  const entities=s?.turnHistory?.history?.entitiesByKey;
  const turns=entities?Object.values(entities):s?.turns||[];
  const t=turns.filter(t=>Array.isArray(t.items)).sort((a,b)=>(a.turnStartedAtMs||0)-(b.turnStartedAtMs||0)).at(-1);
  if(!t)return {type:'native-live',id,working:s?.threadRuntimeStatus?.type==='active',messages:[],activities:[]};
  const turn={id:t.turnId||t.id,items:t.items,startedAt:t.turnStartedAtMs/1000||t.startedAt};
  const thread={id,turns:[turn]};
  return {type:'native-live',id,turnId:turn.id,working:t.status==='inProgress',messages:visibleMessages(thread),activities:visibleActivities(thread),capturedAt:new Date().toISOString()};
}

export function followNative(id,onUpdate,onError,{pipePath=process.platform==='win32'?'\\\\.\\pipe\\codex-ipc':join(process.env.CODEX_HOME||join(homedir(),'.codex'),'ipc','ipc.sock')}={}){
  if(!validThreadId(id))throw Error('Invalid thread ID');
  const socket=net.createConnection(pipePath);let buffer=Buffer.alloc(0),clientId,owner,state,revision,closed=false,scheduled;
  const send=m=>{if(socket.destroyed)return;const b=Buffer.from(JSON.stringify(m)),f=Buffer.alloc(4+b.length);f.writeUInt32LE(b.length);b.copy(f,4);socket.write(f);};
  const follow=value=>send({type:'broadcast',method:'thread-stream-following-changed',version:1,sourceClientId:clientId,targetClientIds:[owner],params:{hostId:'local',conversationId:id,following:value}});
  const close=()=>{if(closed)return;closed=true;clearTimeout(timeout);clearTimeout(scheduled);if(owner)follow(false);socket.end();socket.destroy();state=null;};
  const fail=()=>{if(closed)return;close();onError?.('桌面即時通道未連線，改為同步已保存紀錄。');};
  const timeout=setTimeout(fail,10000);
  socket.on('error',fail);socket.on('close',fail);
  socket.on('connect',()=>send({type:'request',requestId:'init',method:'initialize',version:0,params:{clientType:'cocow'}}));
  socket.on('data',b=>{try{
    buffer=Buffer.concat([buffer,b]);if(buffer.length>64*1024*1024)throw Error('Snapshot too large');
    while(buffer.length>=4){const n=buffer.readUInt32LE();if(n>64*1024*1024)throw Error('Frame too large');if(buffer.length<n+4)break;const m=JSON.parse(buffer.subarray(4,n+4));buffer=buffer.subarray(n+4);
      if(m.type==='response'&&m.requestId==='init'){clientId=m.result?.clientId;if(!clientId)throw Error('No IPC client');send({type:'request',requestId:'owner',sourceClientId:clientId,method:'thread-owner-discovery',version:1,params:{hostId:'local',conversationId:id}});}
      else if(m.type==='response'&&m.requestId==='owner'){owner=m.handledByClientId;if(m.resultType!=='success'||!owner)throw Error('No desktop owner');follow(true);}
      else if(m.type==='broadcast'&&m.method==='thread-stream-state-changed'&&m.version===11&&m.sourceClientId===owner&&m.params?.conversationId===id&&m.params.hostId==='local'){
        const c=m.params.change;
        if(c.type==='snapshot'){state=c.conversationState;revision=c.revision;clearTimeout(timeout);}
        else if(c.type==='patches'){if(!state||revision!==c.baseRevision)throw Error('Snapshot revision gap');state=applyPatches(state,c.patches);revision=c.revision;}
        if(state&&!scheduled)scheduled=setTimeout(()=>{scheduled=null;try{onUpdate(publicNativeState(state,id));}catch{fail();}},40);
      }
    }
  }catch{fail();}});
  return close;
}
