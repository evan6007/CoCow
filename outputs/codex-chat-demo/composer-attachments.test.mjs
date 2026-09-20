import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./composer-attachments.js',import.meta.url),'utf8').replace('export function','function');
function fixture(storage=new Map()){
 const nodes=new Map(),errors=[];let key='chat-a',serial=0;
 const element=()=>({childNodes:[],hidden:false,isConnected:false,append(...xs){this.childNodes.push(...xs);},replaceChildren(){this.childNodes=[];},setAttribute(){},addEventListener(){},classList:{add(){},remove(){}}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const ctx=vm.createContext({fetch:async(url,options)=>url.startsWith('/api/uploads')?{ok:true,json:async()=>({id:String(++serial),name:'image.png',mime:'image/png',bytes:options.body.size,modelReady:true})}:{ok:true,blob:async()=>({})},URL,encodeURIComponent});
 vm.runInContext(source,ctx);
 const api=ctx.createComposerAttachments({$,el:element,headers:{},toast:x=>errors.push(x),draftKey:()=>key,pref:{get:(k,d)=>storage.get(k)??d,set:(k,v)=>storage.set(k,v)},changed(){},canUpload:()=>true});
 return {api,storage,errors,switchTo:k=>key=k,async add(files){$('attachment-input').onchange({target:{files,value:'chosen'}});while(api.sending())await new Promise(r=>setImmediate(r));},nodes,$};
}
test('three same-name images remain distinct, persist and remove only sent ids',async()=>{
 const f=fixture();await f.add(Array.from({length:3},()=>({name:'image.png',size:3348*1024})));
 assert.equal(f.errors.length,0);assert.equal(f.api.list().length,3);assert.equal(new Set(f.api.list().map(a=>a.id)).size,3);
 assert.equal(f.$('composer-attachments').childNodes.length,3);
 const restored=fixture(f.storage);assert.equal(restored.api.list().length,3);
 restored.api.remove([restored.api.list()[1].id]);assert.equal(restored.api.list().length,2);
 restored.switchTo('chat-b');assert.equal(restored.api.list().length,0);restored.switchTo('chat-a');assert.equal(restored.api.list().length,2);
});
test('over-total-limit reports the rejection and preserves already uploaded images',async()=>{
 const f=fixture();await f.add(Array.from({length:3},()=>({name:'image.png',size:8*1024*1024})));
 assert.equal(f.api.list().length,2);assert.match(f.errors[0],/合計上限 20 MB/);assert.equal(f.api.sending(),false);assert.equal(f.api.invalid(),true);assert.equal(fixture(f.storage).api.invalid(),true);
});
