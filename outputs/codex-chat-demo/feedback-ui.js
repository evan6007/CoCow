import {createFeedbackThread} from './feedback-thread.js';
const $=id=>document.getElementById(id),headers={'Content-Type':'application/json','x-demo-token':document.querySelector('meta[name=demo-token]').content};
const lanes=[['pending','待處理','#90969f'],['selected','已排修','#91b5db'],['in-progress','處理中','#d3b77f'],['awaiting-review','待驗收','#b1a0d8'],['done','已完成','#8cbea7']];let images=[],reports=[],admin=false,mine=false,dragId=null,mutating=false;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const kinds={bug:'Bug',feature:'功能需求',appearance:'外觀調整',question:'使用詢問',unclear:'待釐清'};
function classification(r){const c=r.classification,box=el('div','classification');box.append(el('span','classification-kind',kinds[c?.kind]||'待分類'),el('span','classification-category',c?.category||'等待巡查'));if(c?.severity){const labels=['','輕微','低','中','高','嚴重'];const tag=el('span','severity severity-'+c.severity.score,c.severity.score+'/5 '+labels[c.severity.score]);tag.title='AI 初評：'+c.severity.reason;box.prepend(tag);}if(c?.reason)box.title=c.reason;return box;}
const state=r=>r.status==='pending'&&r.selected?'selected':lanes.some(l=>l[0]===r.status)?r.status:'pending';
function stamp(value){const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'未記錄';}
function progressLabel(r){
 if(state(r)==='done')return '已結案';
 if(state(r)==='awaiting-review')return '已修復 · 待使用者驗證';
 if(state(r)==='selected'&&r.waitReason)return r.waitReason;if(state(r)==='in-progress'){const w=r.work;if(!w)return '未回報執行活動 · 等待接續';if(w.phase==='waiting')return '等待資料／條件';if(Date.parse(w.expiresAt)<=Date.now())return '活動逾時 · 等待接續';return ({investigating:'調查中',editing:'修改中',testing:'測試中'})[w.phase]||'等待接續';}
 if(!r.classification)return '尚未分流';
 if(r.classification.kind==='bug')return '已分流 · 待修復';
 return '已分流 · 待人工審核';
}
function reportTimes(r){const box=el('div','report-times');const dates=[r.updatedAt,r.reviewedAt,r.classification?.updatedAt,...(r.messages||[]).map(m=>m.createdAt)].filter(v=>v&&Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(b)-Date.parse(a));box.append(el('div','','更新 '+stamp(dates[0]||r.createdAt)));const fix=[...(r.messages||[])].reverse().find(m=>m.action==='resolve');if(fix)box.append(el('div','','修正 '+stamp(fix.createdAt)+' · '+(fix.version||'版本未記錄')));return box;}
async function api(method='GET',data){
 const request=()=>fetch('/api/feedback',{method,headers,cache:'no-store',signal:AbortSignal.timeout(15000),...(data?{body:JSON.stringify(data)}:{})});
 let r=await request();
 // A restart rotates the page token. Only retry reads, never replay a write.
 if(r.status===403&&method==='GET'){
  const page=await fetch('/feedback',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(page.ok){const doc=new DOMParser().parseFromString(await page.text(),'text/html'),token=doc.querySelector('meta[name=demo-token]')?.content;if(token){headers['x-demo-token']=token;r=await request();}}
 }
 const v=await r.json();if(!r.ok)throw Error(v.error||'請稍後重試');return v;
}
function previews(){$('previews').replaceChildren();images.forEach((im,i)=>{const box=el('figure'),img=el('img');img.src=im.data;img.alt=im.name;const remove=el('button','','×');remove.setAttribute('aria-label','移除 '+im.name);remove.onclick=()=>{images.splice(i,1);previews();};box.append(img,remove);$('previews').append(box);});}
async function add(files){try{for(const file of files){if(images.length>=6)throw Error('最多 6 張圖片');if(file.size>5*1024*1024)throw Error('每張圖片上限 5 MB');if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('請使用 PNG、JPEG 或 WebP');const data=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file);});images.push({name:file.name,data});}}catch(e){$('compose-status').textContent=e.message;}finally{previews();}}
$('new').onclick=()=>$('composer').showModal();$('files').onchange=e=>{add(e.target.files);e.target.value='';};$('dropzone').onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();$('files').click();}};
document.addEventListener('paste',e=>{if(!$('composer').open)return;const files=[...e.clipboardData.items].filter(x=>x.kind==='file').map(x=>x.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();add(files);}});
for(const event of ['dragover','dragenter'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('over');});$('dropzone').ondragleave=()=>$('dropzone').classList.remove('over');$('dropzone').ondrop=e=>{e.preventDefault();$('dropzone').classList.remove('over');add(e.dataTransfer.files);};
async function move(id,status){if(!admin)return;if(mutating){$('status').textContent='正在儲存上一筆變更，請稍候。';render();return;}mutating=true;$('board').setAttribute('aria-busy','true');$('status').textContent='正在儲存…';try{const updated=await api('PATCH',{id,status});reports=reports.map(r=>r.id===id?updated:r);render();$('status').textContent='已移至「'+lanes.find(l=>l[0]===status)[1]+'」';}catch(e){$('status').textContent=e.message;render();}finally{mutating=false;$('board').removeAttribute('aria-busy');}}
const thread=createFeedbackThread({api,getAdmin:()=>admin,onChange:r=>{reports=reports.map(x=>x.id===r.id?r:x);render();}});
function detail(r){thread.open(r);}
function render(){const q=$('search').value.trim().toLowerCase(),rows=reports.filter(r=>(!mine||r.owner===currentOwner)&&(!q||(r.text+' '+r.owner+' '+(kinds[r.classification?.kind]||'')+' '+(r.classification?.category||'')).toLowerCase().includes(q)));$('total').textContent=reports.length;$('chosen').textContent=reports.filter(r=>['selected','in-progress'].includes(state(r))).length;$('done').textContent=reports.filter(r=>state(r)==='done').length;$('count').textContent=rows.length+' 筆';$('board').replaceChildren();
for(const [key,label,color]of lanes){const lane=el('section','lane');lane.dataset.status=key;lane.style.setProperty('--lane',color);const list=rows.filter(r=>state(r)===key),head=el('h2','lane-head');head.append(el('span','dot'),document.createTextNode(label),el('span','badge',String(list.length)));lane.append(head);
if(admin){lane.ondragover=e=>{if(!dragId)return;e.preventDefault();e.dataTransfer.dropEffect='move';lane.classList.add('over');};lane.ondragleave=e=>{if(!lane.contains(e.relatedTarget))lane.classList.remove('over');};lane.ondrop=e=>{e.preventDefault();lane.classList.remove('over');if(dragId)move(dragId,key);dragId=null;};}
for(const r of list){const card=el('article','card');card.dataset.id=r.id;card.tabIndex=0;card.setAttribute('aria-label','開啟回報 '+r.id.slice(0,6));card.onclick=e=>{if(!e.target.closest('button,select,a,input')&&!dragId)detail(r);};card.onkeydown=e=>{if(e.target===card&&['Enter',' '].includes(e.key)){e.preventDefault();detail(r);}};card.draggable=admin;card.ondragstart=e=>{if(!admin)return;dragId=r.id;e.dataTransfer.setData('text/plain',r.id);e.dataTransfer.effectAllowed='move';card.classList.add('dragging');};card.ondragend=()=>{dragId=null;card.classList.remove('dragging');document.querySelectorAll('.lane.over').forEach(n=>n.classList.remove('over'));};const meta=el('div','card-meta');if(admin){const grip=el('span','drag-grip','⠿');grip.title='拖曳卡片到另一個欄位';grip.setAttribute('aria-label','拖曳把手');meta.append(grip);}meta.append(el('span','','#'+r.id.slice(0,6)),el('span','',stamp(r.createdAt)));const open=el('button','card-open');open.setAttribute('aria-label','開啟回報 '+r.id.slice(0,6));open.onclick=()=>detail(r);if(r.images.length)meta.append(el('span','attachment-count','▧ '+r.images.length));open.append(el('p','card-title',r.text||'圖片回報'));const bottom=el('div','card-bottom');bottom.append(el('span','avatar',r.owner.slice(0,1).toUpperCase()),el('span','owner',r.owner.split('@')[0]));if(admin){const select=el('select');select.setAttribute('aria-label','移動回報至');for(const [v,t]of lanes){const option=el('option','',t);option.value=v;select.append(option);}select.value=state(r);select.onchange=()=>move(r.id,select.value);select.onpointerdown=e=>e.stopPropagation();bottom.append(select);}if(r.work){const activity=el('button','work-activity-link','查看工作活動');activity.onclick=()=>detail(r);bottom.prepend(activity);}if(r.repairTask?.taskId){const link=el('a','repair-task-link','開啟修復子任務 →');link.href='/#task='+encodeURIComponent(r.repairTask.taskId);link.target='_blank';link.rel='noopener';bottom.prepend(link);}card.append(meta,open,classification(r),el('p','execution-truth',progressLabel(r)+(state(r)==='in-progress'&&r.work?' · '+r.work.summary:'')+(r.qaJob?.state==='running'?' · AI 問答中':r.qaJob?.state==='queued'?' · AI 問答排隊':'')),reportTimes(r),bottom);lane.append(card);}if(!list.length)lane.append(el('div','empty',q?'沒有符合的回報':admin?'將回報拖曳到這裡':'目前沒有回報'));$('board').append(lane);}}
let currentOwner='',loading=false,refreshFailed=false,activitySignature='[]';
const interacting=()=>mutating||dragId||$('composer').open||document.activeElement?.tagName==='SELECT';
async function load(background=false){
 if(loading||(background&&(document.hidden||interacting())))return;
 loading=true;$('refresh').disabled=true;
 try{
  const result=await api();if(result.apiVersion!==2)throw Error('回報服務仍是舊版，請重新整理後重試。');
  if(background&&interacting())return;
  const nextActivity=JSON.stringify(result.reports.map(progressLabel));const activityChanged=activitySignature!==nextActivity;activitySignature=nextActivity;
  const changed=JSON.stringify(reports)!==JSON.stringify(result.reports)||admin!==result.admin||currentOwner!==(result.owner||'');
  reports=result.reports;admin=result.admin;currentOwner=result.owner||'';
  $('role').textContent=admin?'管理者':'回報者';$('hint').textContent=(admin?'拖曳卡片排定處理階段，或使用卡片上的選單。':'你的回報與審核進度，都在這裡。')+' 每 5 秒自動更新。';
  if(changed||activityChanged||!background){render();thread.sync(reports);}if(refreshFailed){$('status').textContent='已恢復自動更新。';refreshFailed=false;}
 }catch(e){refreshFailed=true;$('status').textContent=e.message+' 自動更新暫時中斷，將持續重試。';}
 finally{loading=false;$('refresh').disabled=false;}
}
setInterval(()=>load(true),5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(true);});
window.addEventListener('focus',()=>load(true));
window.addEventListener('online',()=>load(true));
for(const id of ['composer','detail'])$(id).addEventListener('close',()=>load(true));
$('search').oninput=render;$('all').onclick=()=>{mine=false;$('all').classList.add('active');$('mine').classList.remove('active');render();};$('mine').onclick=()=>{mine=true;$('mine').classList.add('active');$('all').classList.remove('active');render();};$('submit').onclick=async()=>{$('submit').disabled=true;$('compose-status').textContent='正在送出…';try{await api('POST',{text:$('text').value,images,visibility:$('visibility').value});$('text').value='';images=[];previews();$('compose-status').textContent='';$('composer').close();$('status').textContent='已收到回報，等待分流；Bug 將安排調查修復。';await load();}catch(e){$('compose-status').textContent=e.message;}finally{$('submit').disabled=false;}};$('refresh').onclick=()=>load();load();

