import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

export function webUrl(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('只接受不含密碼的 HTTP / HTTPS 網址。');return u.href;}
export async function readWeb(url,signal){url=webUrl(url);const r=await fetch(url,{signal:signal||AbortSignal.timeout(20000),redirect:'error',headers:{accept:'text/html,text/plain,application/json'}});if(!r.ok)throw Error('HTTP '+r.status);const type=r.headers.get('content-type')||'';if(!/text\/|json/.test(type))throw Error('此工具只讀取文字網頁。');let text='',size=0;const decoder=new TextDecoder();for await(const b of r.body){size+=b.length;if(size>1000000)throw Error('網頁超過 1 MB。');text+=decoder.decode(b,{stream:true});}text+=decoder.decode();return {url,untrustedContent:true,text:text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,40000)};}

// A separate browser profile. Never attaches to a user's signed-in browser.
export class LocalBrowser {
 constructor(work,{headless=true}={}){this.headless=headless;this.work=work;this.pending=new Map();this.seq=0;}
 async start(){if(this.ws?.readyState===1)return;if(this.starting)return this.starting;this.starting=this.launch().finally(()=>this.starting=null);return this.starting;}
 async launch(){
  if(process.platform!=='win32')throw Error('此版瀏覽器控制目前支援 Windows Edge / Chrome。');
  const exe=[join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe')].find(existsSync);if(!exe)throw Error('找不到 Edge 或 Chrome。');
  const profile=join(this.work,'browser-profile');mkdirSync(profile,{recursive:true});
  this.child=spawn(exe,[...(this.headless?['--headless=new','--disable-gpu']:[]),'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});this.child.on('error',()=>{});
  let port;for(let i=0;i<80;i++){await new Promise(r=>setTimeout(r,100));try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);if(port){const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(500)})).json();const page=pages.find(p=>p.type==='page');if(page){this.ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('瀏覽器連線逾時')),5000);this.ws.addEventListener('open',()=>{clearTimeout(t);ok();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(t);no(Error('瀏覽器連線失敗'));},{once:true});});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});this.ws.addEventListener('close',()=>this.fail());return;}}}catch{}}
  this.close();throw Error('瀏覽器啟動失敗。');
 }
 fail(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('瀏覽器已停止。'));}this.pending.clear();}
 rpc(method,params={}){return new Promise((resolve,reject)=>{const id=++this.seq,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('瀏覽器操作逾時'));},15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 async preview(){if(this.ws?.readyState!==1)return {running:false};const r=await this.rpc('Page.captureScreenshot',{format:'jpeg',quality:45});return {running:true,imageUrl:'data:image/jpeg;base64,'+r.data,capturedAt:new Date().toISOString()};}
 async call(a){await this.start();if(a.action==='navigate'){await this.rpc('Page.navigate',{url:webUrl(a.url)});return {navigated:true,note:'請呼叫 read 取得目前頁面內容。'};}
  if(a.action==='search'){await this.rpc('Page.navigate',{url:'https://www.google.com/search?q='+encodeURIComponent(String(a.query||'').slice(0,1000))});return {navigated:true,note:'請呼叫 read 讀取搜尋結果；若遇驗證請由使用者處理。'};}
  if(a.action==='read'){const r=await this.rpc('Runtime.evaluate',{expression:'JSON.stringify({url:location.href,title:document.title,text:document.body.innerText.slice(0,24000),links:Array.from(document.querySelectorAll("a[href]")).slice(0,80).map(a=>({text:a.innerText,url:a.href}))})',returnByValue:true});return {untrustedContent:true,page:JSON.parse(r.result.value)};}
  if(a.action==='click'){if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||a.x<0||a.y<0||a.x>10000||a.y>10000)throw Error('座標不正確');for(const type of ['mousePressed','mouseReleased'])await this.rpc('Input.dispatchMouseEvent',{type,x:a.x,y:a.y,button:'left',clickCount:1});return {clicked:true};}
  if(a.action==='type'){if(typeof a.text!=='string'||a.text.length>5000)throw Error('輸入文字過長');await this.rpc('Input.insertText',{text:a.text});return {typed:true};}
  if(a.action==='screenshot'){const r=await this.rpc('Page.captureScreenshot',{format:'jpeg',quality:60});return {imageUrl:'data:image/jpeg;base64,'+r.data};}
  if(a.action==='close'){this.close();return {closed:true};}throw Error('未知瀏覽器操作');
 }
 close(){if(this.ws?.readyState===1)this.ws.send(JSON.stringify({id:++this.seq,method:'Browser.close'}));this.ws?.close();this.child?.kill();this.ws=null;this.fail();}
}
