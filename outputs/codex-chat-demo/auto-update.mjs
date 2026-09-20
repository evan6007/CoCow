import {verify,createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync,readFileSync,cpSync,renameSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {updatePublicKey} from './update-public-key.mjs';
import {buildNumber} from './release.js';
export const currentRelease=buildNumber;
export function validateUpdate(envelope){
 if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>6000000||typeof envelope.signature!=='string'||!verify(null,Buffer.from(envelope.payload),updatePublicKey,Buffer.from(envelope.signature,'base64')))throw new Error('更新簽章不正確。');
 const p=JSON.parse(envelope.payload);if(!Number.isInteger(p.release)||p.release<1||!Array.isArray(p.files)||p.files.length>200)throw new Error('更新版本格式不正確。');
 const names=new Set();let total=0;for(const f of p.files){if(!/^[a-zA-Z0-9_\-\u4e00-\u9fff]+\.(mjs|js|html|css|svg|py)$/.test(f.name)||names.has(f.name)||typeof f.data!=='string')throw new Error('更新路徑不正確。');names.add(f.name);const bytes=Buffer.from(f.data,'base64');total+=bytes.length;if(total>5000000||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new Error('更新內容不完整。');}
 if(!names.has('server.mjs')||!names.has('index.html'))throw new Error('更新缺少必要檔案。');return p;
}
export async function prepareUpdate({origin,home,appRoot,release=currentRelease,fetcher=fetch,onProgress=()=>{}}){
 onProgress({stage:'checking',percent:null,label:'檢查更新'});
 const res=await fetcher(origin+'/download/app-update?manual=1&after='+release,{signal:AbortSignal.timeout(15000),redirect:'error'});if(res.status===304)return null;if(!res.ok)throw new Error('更新服務暫時無法連線。');
 const total=Number(res.headers.get('x-uncompressed-length'))||null;
 const reader=res.body.getReader();let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>6500000){await reader.cancel();throw new Error('更新檔案過大。');}chunks.push(Buffer.from(value));onProgress({stage:'downloading',percent:total?Math.min(80,Math.floor(size/total*80)):null,bytes:size,total,label:'下載更新'});}
 onProgress({stage:'verifying',percent:82,label:'驗證更新'});
 const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8')),update=validateUpdate(envelope);if(update.release<=release)return null;
 const root=join(home,'app-updates');mkdirSync(root,{recursive:true});const dest=join(root,String(update.release)),stamp=join(dest,'verified.json');
 if(existsSync(stamp)){const old=JSON.parse(readFileSync(stamp,'utf8'));if(old.digest===createHash('sha256').update(JSON.stringify(update)).digest('hex')&&update.files.every(f=>existsSync(join(dest,f.name))&&createHash('sha256').update(readFileSync(join(dest,f.name))).digest('hex')===f.sha256))return {appRoot:dest,release:update.release};throw new Error('已下載更新內容異常。');}
 const stage=join(root,'stage-'+randomUUID());mkdirSync(stage,{recursive:true});if(existsSync(join(appRoot,'fonts')))cpSync(join(appRoot,'fonts'),join(stage,'fonts'),{recursive:true});
 for(const [i,f] of update.files.entries()){writeFileSync(join(stage,f.name),Buffer.from(f.data,'base64'),{flag:'wx'});onProgress({stage:'installing',percent:84+Math.floor((i+1)/update.files.length*14),label:'安裝更新'});}
 writeFileSync(join(stage,'verified.json'),JSON.stringify({digest:createHash('sha256').update(JSON.stringify(update)).digest('hex')}));writeFileSync(join(stage,'signed-update.json'),JSON.stringify(envelope));renameSync(stage,dest);return {appRoot:dest,release:update.release};
}

export function cachedUpdate(home,release=currentRelease){
 const root=join(home,'app-updates');if(!existsSync(root))return null;
 for(const name of readdirSync(root).filter(n=>/^\d+$/.test(n)&&Number(n)>release).sort((a,b)=>Number(b)-Number(a))){
  try{const dir=join(root,name),p=validateUpdate(JSON.parse(readFileSync(join(dir,'signed-update.json'),'utf8')));
   if(p.release!==Number(name)||!p.files.every(f=>existsSync(join(dir,f.name))&&createHash('sha256').update(readFileSync(join(dir,f.name))).digest('hex')===f.sha256))continue;
   return {appRoot:dir,release:p.release};
  }catch{}
 }return null;
}
