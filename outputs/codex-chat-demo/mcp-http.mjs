export function httpClient(c){
 const url=new URL(c.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('MCP URL 不正確');
 let id=0,session,protocol,closed=false;const controllers=new Set();
 async function send(method,params,notification=false){
  if(closed)throw Error('MCP 連線已中止');const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),20000),n=++id;
  try{
   const headers={...c.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};if(session)headers['Mcp-Session-Id']=session;if(protocol)headers['MCP-Protocol-Version']=protocol;
   const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:n}),method,params}),signal:controller.signal,redirect:'error'});
   if(!res.ok)throw Error('MCP HTTP 連線失敗（'+res.status+'）');session=res.headers.get('mcp-session-id')||session;
   if(notification){await res.body?.cancel();return;}
   const sse=(res.headers.get('content-type')||'').includes('text/event-stream');let buffer='',size=0;const decoder=new TextDecoder();
   function result(m){if(m.id!==n)return; if(m.error)throw Error('MCP 工具回傳錯誤');if(method==='initialize')protocol=m.result?.protocolVersion;return {value:m.result};}
   for await(const chunk of res.body){size+=chunk.length;if(size>2000000)throw Error('MCP 回應過大');buffer+=decoder.decode(chunk,{stream:true}).replace(/\r\n/g,'\n');if(sse){let pos;while((pos=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,pos);buffer=buffer.slice(pos+2);const data=block.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trimStart()).join('\n');if(data){const found=result(JSON.parse(data));if(found)return found.value;}}}}
   if(!sse){const found=result(JSON.parse(buffer));if(found)return found.value;}throw Error('MCP 未回傳相符的回應');
  }finally{clearTimeout(timer);controllers.delete(controller);controller.abort();}
 }
 return {rpc:(m,p={})=>send(m,p),notify:(m,p={})=>send(m,p,true),close(){closed=true;for(const c of controllers)c.abort();}};
}
