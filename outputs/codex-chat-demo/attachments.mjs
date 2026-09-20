import {basename,extname,resolve}from'node:path';
import {existsSync,statSync,readFileSync,realpathSync}from'node:fs';
import {createHash}from'node:crypto';
const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.zip':'application/zip'};
const textTypes=new Set(['.txt','.md','.csv','.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.css','.html','.json','.log','.yml','.yaml']);
export const secretPath=p=>/(?:^|[\\/])(?:\.codex|\.ssh|\.aws|\.azure|\.config|\.env[^\\/]*|auth\.json|config\.toml|device-credential\.json|paired-devices\.json|.*(?:credentials|private[_-]?key|token[_-]?cache|cookie|login data).*|id_rsa|id_ed25519)(?:[\\/]|$)/i.test(p);
export const redact=s=>s.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g,'[REDACTED]').replace(/\bBearer\s+[A-Za-z0-9._-]{20,}/gi,'Bearer [REDACTED]').replace(/((?:["']?)(?:api[_-]?key|access_token|refresh_token|id_token|password|secret)(?:["']?)\s*[:=]\s*["']?)[^\s,"'\n}]+/gi,'$1[REDACTED]');
const localPath=s=>typeof s==='string'&&/^\/?[A-Za-z]:[\\/]/.test(s)?s.replace(/^\//,'').replace(/:\d+(?::\d+)?$/,''):null;
export class AttachmentStore{
 constructor(){this.refs=new Map();this.embeddedBytes=0;}
 forget(id){const old=this.refs.get(id);if(old?.url)this.embeddedBytes-=old.url.length*2;this.refs.delete(id);}
 register(threadId,itemId,index,source,label){
  const id=createHash('sha256').update(threadId+'\0'+itemId+'\0'+index+'\0'+(source.path||String(source.url).slice(0,160))).digest('hex').slice(0,32);
  let name=source.path?basename(source.path):'圖片.'+({jpeg:'jpg',webp:'webp',gif:'gif'}[source.url?.match(/^data:image\/([^;]+)/)?.[1]]||'png');let mime,bytes,reason;
  if(source.url){const m=source.url.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/);if(m){mime=m[1];bytes=Math.floor(m[2].length*3/4);if(bytes>20*1024*1024)reason='圖片超過 20 MB，請在原主機開啟。';}else reason='此附件不是可讀取的內嵌圖片；不代抓外部網址。';}
  else{const ext=extname(source.path||'').toLowerCase();mime=types[ext]||(textTypes.has(ext)?'text/plain':null);if(/^upload-[a-f0-9-]{36}\.(bin|png|jpg|gif|webp)$/.test(basename(source.path))){try{const u=JSON.parse(readFileSync(source.path.slice(0,-ext.length)+'.json','utf8'));mime=u.mime;name=u.name;}catch{}};if(!mime)reason='此格式暫不提供網頁預覽或下載。';else if(secretPath(source.path))reason='憑證或系統私密檔案不透過聊天介面提供。';else try{const real=realpathSync(source.path);if(secretPath(real))throw new Error();const st=statSync(real);if(!st.isFile())throw new Error();bytes=st.size;if(bytes>50*1024*1024)reason='檔案超過 50 MB，請在原主機開啟。';}catch{reason='原主機檔案已不存在或無法讀取。';}}
  const meta={id,name,label:label||null,mime:mime||'application/octet-stream',bytes:bytes??null,available:!reason,reason:reason||null};this.forget(id);if(!reason){this.refs.set(id,{...meta,...source});if(source.url)this.embeddedBytes+=source.url.length*2;while(this.refs.size>400||this.embeddedBytes>60*1024*1024)this.forget(this.refs.keys().next().value);}return meta;
 }
 extract(threadId,item){const refs=[],seen=new Set();const add=(source,label)=>{if(source.path)source.path=resolve(source.path);const k=source.path?source.path.toLowerCase():source.url;if(!k||seen.has(k))return;seen.add(k);refs.push(this.register(threadId,item.id,refs.length,source,label));};
  for(const c of item.content||[]){if(c.type==='image')add({url:c.url});if(c.type==='localImage')add({path:c.path});}
  const text=item.text||(item.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  // Only explicit attachment lists and file links, not arbitrary paths in prose.
  const fileBlock=text.match(/# Files mentioned by the user:\s*([\s\S]*?)(?:Distinguish instructions|## My request:|$)/)?.[1];
  if(fileBlock)for(const m of fileBlock.matchAll(/^\s*(?:-\s*|##\s*)([^\r\n]+?):\s*([A-Za-z]:[\\/][^\r\n]+)$/gm)){const p=localPath(m[2].trim());if(p)add({path:p},m[1]);}
  for(const m of text.matchAll(/!?\[([^\]\n]*)\]\((?:<([^>]+)>|([^\s)]+))\)/g)){let p;try{p=localPath(decodeURIComponent(m[2]||m[3]));}catch{}if(p)add({path:p},m[1]||undefined);}
  return refs.slice(0,24);
 }
 read(id){if(!/^[a-f0-9]{32}$/.test(id))throw new Error('附件識別碼錯誤。');const r=this.refs.get(id);if(!r)throw new Error('附件已過期，請更新對話後再開啟。');let buffer;if(r.url){buffer=Buffer.from(r.url.slice(r.url.indexOf(',')+1),'base64');}else{const path=realpathSync(r.path);if(secretPath(path)||statSync(path).size>50*1024*1024)throw new Error('此檔案無法透過介面提供。');buffer=readFileSync(path);if(r.mime==='text/plain')buffer=Buffer.from(redact(buffer.toString('utf8')));}
  return {buffer,mime:r.mime,name:r.name};
 }
}
