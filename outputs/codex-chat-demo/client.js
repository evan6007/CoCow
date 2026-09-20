function createTurnQueue({pref,api,headers,onComplete,notify}){
 const key='turn-queue-v1';let active=false;
 const read=()=>{try{return JSON.parse(pref.get(key,'[]'));}catch{return [];}};
 const save=rows=>{const value=JSON.stringify(rows);pref.set(key,value);if(pref.get(key)!==value)throw Error('無法保存佇列，請檢查瀏覽器儲存空間');};
 return {list:read,cancel(id){save(read().filter(r=>r.id!==id||r.state==='sending'));},add(payload){const rows=read();if(rows.length>=20)throw Error('佇列最多 20 筆');const row={id:crypto.randomUUID(),state:'queued',createdAt:new Date().toISOString(),payload};row.payload.requestId=row.id;rows.push(row);save(rows);return row;},async tick(){if(active)return;active=true;try{if(!navigator.locks)return;await navigator.locks.request('cocow-turn-queue',{ifAvailable:true},async lock=>{if(!lock)return;const rows=read();if(rows.some(r=>r.state==='sending')){for(const r of rows)if(r.state==='sending'){r.state='unknown';r.error='上次派送未取得完成回執，請核對原對話後移除此項；不自動重送';}save(rows);return;}const row=rows.find(r=>r.state==='queued');if(!row||rows.some(r=>r.state==='sending'||r.state==='unknown'))return;const chats=await api('/api/chats'),chat=chats.find(c=>c.id===row.payload.chatId);if(!chat){row.state='unknown';row.error='原對話不存在，未送出';save(rows);return;}if(chat.liveWorking)return;row.state='sending';save(rows);let error;try{const res=await fetch('/api/chat',{method:'POST',headers,body:JSON.stringify(row.payload)});if(!res.ok)throw Error((await res.json()).error||'送出失敗');const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;const event=line=>{if(!line.trim())return;const e=JSON.parse(line);if(e.type==='done'){done=true;if(e.error)error=e.error;}};while(true){const r=await reader.read();if(r.done)break;buffer+=decoder.decode(r.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(event);}if(buffer.trim())event(buffer);if(!done)throw Error('連線中斷，請核對原對話；不自動重送');if(error)throw Error(error);save(read().filter(r=>r.id!==row.id));notify('佇列工作已完成');await onComplete(row.payload.chatId);}catch(e){const latest=read(),item=latest.find(r=>r.id===row.id);if(item){item.state='unknown';item.error=e.message;save(latest);}notify('佇列已停止：'+e.message);}});}finally{active=false;}}};
}

import {createTurnInsights} from '/turn-insights.js';
import {createScrollFollow} from '/scroll-follow.js';
import {createWorkspaceUI} from '/workspace-ui.js';
import {createProgressView,readLive,mergeNativeLive} from '/live-view.js';
import {streamRenderer} from '/presentation.mjs';
import {createHybridUI,updateHybridUI} from '/hybrid-ui.js';
import {buildNumber,version} from '/release.js';
import {releaseNotes} from '/release-notes.mjs';
import {createUpdateControls} from '/update-controls.js';
import {createAdmin}from'/admin.js';
import {createPicker}from'/pickers.js';
import {createComposerAttachments}from'/composer-attachments.js';
import { createRichContent } from '/rich-content.js';
import { createSidebar } from '/sidebar.js';
import { createExecutionUI } from '/execution-ui.js';
import { markdown } from '/markdown.mjs';
const $ = id => document.getElementById(id);
window.addEventListener('DOMContentLoaded',()=>{turnInsights=createTurnInsights({el,container:$('inspector-overview').parentElement});showSavedInsights();createUpdateControls({$,api,saveDraft,buildNumber});installReleaseNotice();workspaceUI=createWorkspaceUI({$,el,api,openDialog,saveDraft,isBusy:()=>state.busy,onStorage:s=>{state.storage=s;renderLocation();}});if(state.storage)workspaceUI.apply(state.storage);createHybridUI({api,onChange:()=>refreshStatus()});});
const token = document.querySelector('meta[name="demo-token"]').content;
const headers = { 'Content-Type': 'application/json', 'X-Demo-Token': token };
const pref = { get(key,fallback=null){try{return localStorage.getItem('codex-local.'+key)??fallback}catch{return fallback}}, set(key,value){try{localStorage.setItem('codex-local.'+key,String(value))}catch{}} };
const state = { chats:[], chatId:null, busy:false, serverBusy:false, allowQueue:false, activeTurn:null, turns:new Map(), turnSequence:0, runningChats:new Set(), newParentChatId:null, ready:false, workspaceLoaded:false, storageChosen:false, archived:false, status:null, metrics:null, history:null, access:null, searchMode:'local', searchSeq:0, selectedHistory:null, toastTimer:null, identity:pref.get('identity','我') };
let composerUploads,adminUI,modelPicker,effortPicker,workspaceUI,scrollFollow,turnInsights;
const fmt = n => n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n)) ? Number(n).toLocaleString('zh-TW') : '—';
const bytes = n => { if(!Number.isFinite(n))return '—';const units=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return `${n.toLocaleString('zh-TW',{maximumFractionDigits:i?1:0})} ${units[i]}`; };
const date = value => { const d=new Date(value);return Number.isNaN(d.getTime())?'未知時間':d.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); };
const current = () => state.chats.find(c=>c.id===state.chatId);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
async function api(path,options={}){const response=await fetch(path,{...options,headers});const data=await response.json();if(response.status===403&&/頁面驗證已過期/.test(String(data.error||''))){saveDraft();if(!api.reloading){api.reloading=true;toast('工作台已重新連線，正在載入最新版本…');setTimeout(()=>location.reload(),50);}throw new Error('工作台已重新連線，正在載入最新版本…');}if(!response.ok)throw new Error(data.error||'連線失敗');return data;}
function activity(text,error=false){$('status-line').textContent=text&&state.reasoningLevel?'自動 · '+state.reasoningLevel+' · '+text:text;$('status-line').classList.toggle('is-error',error);}
function progressBlock(rows,live=false){return createProgressView({el,richContent})(rows,live);}
function restoreProgressViewport(oldNode,newNode){const oldMap=oldNode?.querySelector('.workflow-map'),newMap=newNode?.querySelector('.workflow-map'),oldDetails=oldNode?.querySelector('.workflow-details'),newDetails=newNode?.querySelector('.workflow-details');if(!newMap)return;if(oldDetails?.open&&newDetails)newDetails.open=true;const left=oldMap?.scrollLeft||0,atEnd=!oldMap||oldMap.scrollLeft+oldMap.clientWidth>=oldMap.scrollWidth-18;const latest=m=>{const nodes=m?.querySelectorAll('.workflow-node');const n=nodes?.[nodes.length-1];return n?String(nodes.length)+'|'+(n.dataset.nodeId||n.title):'';};const newStep=newNode.classList.contains('is-live')&&latest(oldMap)!==latest(newMap);requestAnimationFrame(()=>{newMap.scrollLeft=newStep||atEnd?newMap.scrollWidth:Math.min(left,Math.max(0,newMap.scrollWidth-newMap.clientWidth));});}
function updateProgress(node,rows,live=true){const old=node.querySelector('.turn-progress'),signature=JSON.stringify([rows,live]);if(old?.dataset.signature===signature)return;const d=progressBlock(rows,live);d.dataset.signature=signature;restoreProgressViewport(old,d);if(old)old.replaceWith(d);else node.prepend(d);}
function openDialog(id){if(!$(id).open)$(id).showModal();}
function closeSidebar(){$('app').classList.remove('sidebar-open');$('scrim').hidden=true;$('expand-sidebar').setAttribute('aria-expanded','false');}
function toggleInspector(force){const open=force??$('inspector').hidden;$('inspector').hidden=!open;pref.set('inspector-open',String(open));$('inspector-open').setAttribute('aria-expanded',String(open));if(open)refreshStatus().catch(e=>toast(e.message));}
function selectTheme(value){pref.set('theme',value);$('theme-select').value=value;document.documentElement.dataset.theme=value==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):value;}
selectTheme(pref.get('theme','dark'));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(pref.get('theme')==='system')selectTheme('system');});
$('identity').value=['我','測試使用者 A','測試使用者 B'].includes(state.identity)?state.identity:'我';state.identity=$('identity').value;
function draftKey(){return `draft.${state.identity}.${state.official?'codex.'+state.official.id:state.chatId||'new.'+(state.newParentChatId||state.newProjectId||'unfiled')}`;}
function saveDraft(){if(state.workspaceLoaded)pref.set(draftKey(),$('prompt').value);}
function fitPrompt(){const p=$('prompt');p.style.height='auto';p.style.height=Math.min(210,Math.max(54,p.scrollHeight))+'px';$('char-count').textContent=p.value.length>3000?`${p.value.length}/16000`:'';updateControls();}
function loadDraft(){$('prompt').value=pref.get(draftKey(),'');composerUploads?.render();fitPrompt();}
function rememberSelection(){pref.set(`selected.${state.identity}`,state.chatId||'');}
function modelPreferenceKey(){return `model.${state.identity}`;}
function rememberModel(){pref.set(modelPreferenceKey(),$('model').value||'auto');}
function updateControls(){const running=!!state.chatId&&state.runningChats.has(state.chatId),activeWorking=state.busy||running;$('refresh-desktop').disabled=activeWorking||!((state.official?.id)||current()?.codexThreadId);const blocked=!state.storageChosen||(activeWorking&&!state.chatId)||(state.status?.canStartChat===false&&!state.status?.routing?.canFallback);$('prompt').disabled=!state.storageChosen;$('identity').disabled=state.busy;for(const id of ['model','effort']){$(id).disabled=!state.storageChosen;$(id).title=activeWorking?'新選擇將用於下一回合，目前回合保持原設定':'';}$('send').disabled=!state.ready||blocked||composerUploads?.sending()||composerUploads?.invalid()||(!$('prompt').value.trim()&&!composerUploads?.list().length);$('send').hidden=false;if(activeWorking){$('send').disabled=state.steering||!state.chatId||!!composerUploads?.list().length;$('send').title='選擇送出方式';$('send').setAttribute('aria-label','選擇送出方式');$('composer').classList.add('is-guiding');$('guidance-status').hidden=false;$('guidance-status').textContent=state.steering?'正在送出引導…':'執行中 · 可隨時插入引導';}else{const recheck=state.official?.canContinue===false;$('send').title=recheck?'重新確認原對話狀態':'傳送訊息';$('send').setAttribute('aria-label',recheck?'重新確認原對話狀態':'傳送訊息');$('composer').classList.remove('is-guiding');$('guidance-status').hidden=true;}$('stop').hidden=!activeWorking;for(const id of ['rename-chat','pin-chat','archive-chat','export-chat'])$(id).disabled=!current()||state.busy;$('chat-title').disabled=!current()||state.busy;$('composer-memory').disabled=!state.storageChosen||state.busy;$('new-child-chat').hidden=!current()||!!state.official;$('new-child-chat').disabled=state.identity!=='我';$('open-memory').disabled=state.identity!=='我';$('search-codex').disabled=state.identity!=='我';$('memory-indicator').textContent=state.identity==='我'?'記憶已連接':'僅此對話';renderProjectPicker();if(document.querySelector('.desktop-intervene'))updateIntervention();executionUI.controls();modelPicker?.sync();effortPicker?.sync();}
async function selectChat(id,{preserveLibrary=false}={}){if(state.activeTurn)state.activeTurn.visible=false;if(state.busy){state.allowQueue=true;state.busy=false;updateControls();}saveDraft();state.officialSeq++;state.officialLoading=false;state.official=null;if(!preserveLibrary)state.libraryMode='web';let chat=state.chats.find(c=>c.id===id);if(!chat)return;state.identity=chat.user;$('identity').value=chat.user;pref.set('identity',chat.user);state.chatId=id;state.newParentChatId=null;state.archived=!!chat.archived;$('model').value=chat.model;$('execution-allow').checked=!!chat.executionEnabled;updateEfforts(chat.effort);rememberSelection();loadDraft();scrollFollow.latest();renderChat();const running=state.runningChats.has(id);activity(running?'這段對話正在背景執行…':'');closeSidebar();
 // A running turn is already checkpointed by the server and has its own live
 // stream.  Do not call native thread sync here: that endpoint intentionally
 // refuses an in-progress writer, and the old error toast made the transcript
 // look as if it had disappeared.  The background live poll updates this chat.
 if(chat.codexThreadId&&!running){try{const fresh=await api('/api/chats/sync',{method:'POST',body:JSON.stringify({id})});if(state.chatId===id&&!state.official){Object.assign(chat,fresh);renderChat();}}catch(e){if(state.chatId===id)toast('背景同步失敗：'+e.message);}}
}
function selectedProjectId(){return state.official?(Object.hasOwn(state.official,'projectId')?(state.official.projectId||''):(state.officialRows.find(t=>t.id===state.official.id)?.displayProjectId||'')):current()?(current().projectId||''):state.newProjectId||'';}
function renderProjectPicker(){const id=selectedProjectId(),ps=state.projects?.data||[],select=$('composer-project'),signature=JSON.stringify([ps.map(p=>[p.id,p.name]),id]);if(select.dataset.signature!==signature){select.replaceChildren();for(const p of [{id:'',name:'不放入專案'},...ps,...(id&&!ps.some(p=>p.id===id)?[{id,name:'目前專案'}]:[])]){const o=el('option','',p.name);o.value=p.id;select.append(o);}select.value=id;select.dataset.signature=signature;}select.disabled=state.busy||state.projectMoving||state.identity!=='我'||!!state.projects?.readOnly;$('composer-new-project').hidden=!id;$('composer-new-project').disabled=state.busy;$('project-context').hidden=state.identity!=='我';}
function newChat(projectId,parentChatId=null){if(state.activeTurn)state.activeTurn.visible=false;if(state.busy){state.allowQueue=true;state.busy=false;updateControls();}const target=typeof projectId==='string'?projectId:selectedProjectId();const parent=parentChatId&&state.chats.find(c=>c.id===parentChatId&&c.user===state.identity);saveDraft();state.officialSeq++;state.officialLoading=false;state.official=null;state.libraryMode=target&&!state.projects?.localOnly?'codex':'web';state.chatId=null;state.newProjectId=state.identity==='我'?target:'';state.newParentChatId=parent?.id||null;state.archived=false;const preferred=pref.get(modelPreferenceKey(),'auto');if(state.models?.some(m=>m.id===preferred)){$('model').value=preferred;updateEfforts();}$('execution-allow').checked=executionUI.defaultConsent();$('prompt').placeholder=parent?'在子聊天室輸入訊息…':'傳送訊息…';rememberSelection();loadDraft();scrollFollow.latest();renderChat();activity('');closeSidebar();$('prompt').focus();}
function newChildChat(){const c=current();if(c)newChat(c.projectId||'',c.id);}
$('composer-project').onchange=async()=>{const value=$('composer-project').value,official=state.official,chat=current();if(!official&&!chat){saveDraft();state.newProjectId=value;loadDraft();renderProjectPicker();return;}state.projectMoving=true;renderProjectPicker();try{await api(official?'/api/codex/conversation':'/api/chats',{method:'PATCH',body:JSON.stringify(official?{id:official.id,action:'move',projectId:value||null}:{id:chat.id,projectId:value||null})});if(official){official.projectId=value||null;const row=state.officialRows.find(t=>t.id===official.id);if(row){row.projectId=value||null;row.displayProjectId=value||null;}officialCache.delete(official.id);}else chat.projectId=value||null;renderList();toast('已移動專案');}catch(e){toast(e.message);}finally{state.projectMoving=false;renderProjectPicker();}};
$('composer-new-project').onclick=()=>newChat(selectedProjectId());
function renderWebList(){const list=$('chat-list');list.replaceChildren();$('list-label').textContent=state.archived?'已封存':'對話';$('archive-filter').title=state.archived?'顯示最近對話':'顯示封存對話';$('archive-filter').setAttribute('aria-label',$('archive-filter').title);const own=state.chats.filter(c=>c.user===state.identity&&!!c.archived===state.archived).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));if(!own.length)list.append(el('p','muted empty-list',state.archived?'還沒有封存的對話。':'你的對話會保存在這裡。'));let section=null;for(const c of own){const group=c.pinned?'置頂':'最近';if(group!==section){list.append(el('div','chat-section-title',group));section=group;}const b=el('button',`chat-link${c.id===state.chatId?' selected':''}`);b.title=c.title;if(c.pinned){const mark=el('span');mark.innerHTML=icon('pin');b.append(mark);}if(c.liveWorking||state.runningChats.has(c.id)){const spin=el('span','chat-running','');spin.title='正在執行';spin.setAttribute('aria-label','正在執行');b.append(spin);}b.append(el('span','chat-name',c.title));const t=el('time','',new Date(c.updatedAt||c.createdAt).toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'}));b.append(t);if(c.codexThreadId){const mark=el('span','sync-mark','↔');mark.title='與本機 Codex 共用紀錄';b.prepend(mark);}b.onclick=()=>selectChat(c.id);list.append(b);}}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('已複製。');}catch{toast('瀏覽器無法複製，請手動選取文字。');}}
function messageNode(m){const article=el('article',`message ${m.role}`);if(m.steering){article.classList.add('steering-message');if(m.id)article.dataset.steeringId=m.id;article.append(el('span','steering-label','↪ 引導 · 已送出'));}const body=el('div','message-body');if(m.role==='assistant')body.innerHTML=markdown(richContent.displayText(m));else body.textContent=richContent.displayText(m);if(m.workflow?.some(r=>r.kind!=='fileChange'))article.append(progressBlock(m.workflow.filter(r=>r.kind!=='fileChange')));article.append(body);for(const r of m.workflow||[])if(r.kind==='fileChange')article.append(richContent.activity(r));if(m.attachments?.length)article.append(richContent.attachments(m.attachments));if(m.error)article.append(el('p','error-text',m.error));const actions=el('div','message-actions');const b=el('button','icon-button');b.innerHTML=icon('copy');b.title='複製訊息';b.setAttribute('aria-label','複製訊息');b.onclick=()=>copy(m.text);actions.append(b);if(m.steering){const edit=el('button','text-button','編輯並重新送出');edit.onclick=()=>{const editChatId=state.chatId;const input=el('textarea','steering-editor');input.value=m.text;const save=el('button','text-button','送出修正'),cancel=el('button','text-button','取消');const panel=el('div','steering-edit-panel');panel.append(input,el('small','','原引導已送達；修改會以新的引導補充。'),save,cancel);edit.disabled=true;cancel.onclick=()=>{panel.remove();edit.disabled=false;};save.onclick=async()=>{if(!input.value.trim()){toast('請輸入修正內容');return;}save.disabled=true;try{const r=await api('/api/steer',{method:'POST',body:JSON.stringify({chatId:editChatId,text:'修正先前引導「'+m.text+'」：\n'+input.value.trim()})});if(state.chatId===editChatId)showSteering(r.message);panel.remove();edit.disabled=false;}catch(e){toast(e.message);save.disabled=false;}};article.append(panel);input.focus();};actions.append(edit);}if(m.role==='assistant'){const rich=el('button','text-button','複製格式');rich.title='複製格式至 Word / PPT（公式相容性依版本而定）';rich.onclick=async()=>{try{const clone=body.cloneNode(true);clone.querySelectorAll('button').forEach(n=>n.remove());const html='<div style="font-family:Segoe UI,Microsoft JhengHei,sans-serif;color:#111;font-size:12pt;line-height:1.6">'+clone.innerHTML+'</div>';await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([body.innerText],{type:'text/plain'})})]);toast('已複製格式，可貼到 Word / PPT。');}catch{toast('瀏覽器不支援格式複製，請使用複製訊息。');}};actions.append(rich);}if(m.role==='assistant'&&m.usage?.last){const stages=m.modelsUsed?.length>1?` · ${m.modelsUsed.map(v=>v.replace('gpt-','GPT-').replace('cocow-auto-review','CoCow 自動分工')).join(' → ')}`:'';actions.append(el('span','',`${fmt(m.usage.last.totalTokens)} tokens（含快取） · ${(m.model||'Codex').replace('gpt-','GPT-')}${stages}`));}if(m.statusQueries?.length)actions.append(el('span','history-chip',`已查即時狀態 · ${date(m.statusQueries.at(-1).capturedAt)}`));if(m.historySearches?.length)actions.append(el('span','history-chip',`已查閱記憶 ${m.historySearches.length} 次`));article.append(actions);return article;}
function showSavedInsights(){if(state.busy)return;const c=state.official?state.chats.find(c=>c.codexThreadId===state.official.id):current();const message=c?.messages?.findLast(m=>m.role==='assistant');turnInsights?.reset(message||{});}
function renderChat(){showSavedInsights();const scrollPosition=scrollFollow?.capture();state.officialRenderSignature=null;$('native-live-state').hidden=true;$('composer-note').hidden=true;if(state.official){renderOfficial();return;}$('official-banner').hidden=true;const c=current();$('welcome').hidden=!!c?.messages.length;$('messages').replaceChildren(...(c?.messages||[]).map(messageNode));$('chat-title').textContent=c?.title||'新增對話';$('chat-subtitle').textContent=c?`${c.user}${c.archived?' · 已封存':''} · ${date(c.updatedAt||c.createdAt)}`:'在目前主機上繼續';$('pin-chat').querySelector('span').textContent=c?.pinned?'取消置頂':'置頂對話';$('archive-chat').querySelector('span').textContent=c?.archived?'還原對話':'封存對話';document.title=`${c?.title||'共同牛牛'} · CoCow`;renderLocation();renderList();renderContext();updateControls();if(scrollPosition)scrollFollow.restore(scrollPosition);scrollFollow?.refresh();}
function renderContext(){const ctx=current()?.messages.findLast(m=>m.context)?.context;$('context-info').hidden=!ctx;if(ctx){const pct=ctx.window>0?Math.min(100,Math.round(ctx.inputTokens/ctx.window*100)):null;$('context-info').textContent=`上次模型輸入：${fmt(ctx.inputTokens)} / ${fmt(ctx.window)} tokens${pct==null?'':`（${pct}%）`}。為最後一次請求的輸入快照。`;}}
async function refreshChats(render=true){state.chats=await api('/api/chats');const localTurns=new Set([...state.turns.values()].map(t=>t.chatId));for(const c of state.chats){if(c.liveWorking)state.runningChats.add(c.id);else if(!localTurns.has(c.id))state.runningChats.delete(c.id);}if(render)renderChat();else renderList();}
function resetLabel(seconds){if(!seconds)return '重置時間未知';const delta=seconds*1000-Date.now();if(delta<=0)return '等待額度更新';const hours=Math.ceil(delta/3600000);return hours>=24?`${Math.floor(hours/24)} 天 ${hours%24} 小時後重置`:`${hours} 小時內重置`;}
function applyQuota(s){
 if(!s)return;state.status=s;updateHybridUI(s.routing);
 const windows=(s.windows||[]).filter(w=>Number.isFinite(w.remainingPercent));
 const remaining=windows.length?Math.min(...windows.map(w=>w.remainingPercent)):null;
 $('quota-label').textContent=remaining==null?'無法取得':`剩餘 ${remaining}%`;
 $('quota-bar').style.width=`${remaining??0}%`;
 if(s.allocation?.mode==='percent'){$('quota-label').textContent=`個人 ${s.allocation.remainingPercent}% · 共用 ${remaining??'—'}%`;$('quota-label').title='個人剩餘依官方百分比下降估算；仍受共用額度限制。';}else $('quota-label').removeAttribute('title');
 const allocation=s.allocation||{},estimate=allocation.tokenEstimate;
 $('personal-remaining').textContent=allocation.mode==='percent'?`${allocation.remainingPercent??'—'}%`:'未設百分比上限';
 $('personal-remaining').title=Number.isFinite(allocation.usablePercent)?`共用池目前最多可供 ${allocation.usablePercent}%，不預留。`:'';
 const exact=Number.isFinite(allocation.remainingTokens);
 $('personal-tokens-left').textContent=exact?fmt(allocation.remainingTokens):estimate?'約 '+new Intl.NumberFormat('zh-TW',{maximumSignificantDigits:2}).format(estimate.tokens):'估算資料不足';
 $('personal-tokens-left').previousElementSibling.textContent=exact?'可用 Tokens':'估計可用 Tokens';
 $('personal-tokens-left').title=estimate?.note||'需要同一額度週期內的用量資料才能估算；不使用帳戶終身 Token 倒推。';
 $('personal-tokens-used').textContent=Number.isFinite(allocation.tokens)?fmt(allocation.tokens):'無法取得';$('personal-tokens-used').title='本工作台收到的用量回報，含快取；不是官方扣額。';
 $('overview-quota').textContent=remaining==null?'無法取得':remaining+'%';
 const tight=windows.find(w=>w.remainingPercent===remaining);
 $('quota-reset').textContent=tight?resetLabel(tight.resetsAt):(s.quotaUnavailableReason||'服務未提供額度');
 $('plan-name').textContent=s.plan?String(s.plan).toUpperCase():'無法取得';
 $('credits').textContent=s.credits?.balance??`無法取得：${s.creditsUnavailableReason||'服務未提供'}`;
 $('quota-windows').replaceChildren();
 const personal=s.allocation;if(personal){const box=el('div','quota-window personal-quota'),head=el('div');head.append(el('span','','個人額度'),el('strong','',personal.mode==='percent'?`${personal.remainingPercent??'—'}%`:Number.isFinite(personal.remainingTokens)?`${fmt(personal.remainingTokens)} Tokens`:'未設 Token 上限'));const tokens=el('small','',`已用 ${fmt(personal.tokens||0)} Tokens · 剩餘 ${Number.isFinite(personal.remainingTokens)?fmt(personal.remainingTokens)+' Tokens':personal.tokenEstimate?'約 '+new Intl.NumberFormat('zh-TW',{maximumSignificantDigits:2}).format(personal.tokenEstimate.tokens)+' Tokens':'估算資料不足'}`);tokens.title=personal.tokenEstimate?.note||(personal.mode==='percent'?'目前按百分比分配；官方未提供可換算的 Token 總額。已用數為工作台收到的 Token 回報，含快取，不等於訂閱扣額。':'管理者設定的本工作台 Token 額度，不等於官方剩餘額度。');box.append(head,tokens);$('quota-windows').append(box);}
 for(const bucket of s.buckets||[]){for(const w of bucket.windows){
  const div=el('div','quota-window'),row=el('div');
  const label=w.windowDurationMins===10080?'每週':w.windowDurationMins===300?'5 小時':w.windowDurationMins?`${w.windowDurationMins} 分鐘`:'時段不明';
  row.append(el('span','',`${bucket.id==='codex'?'Codex':bucket.name} · ${label}`),el('strong','',w.remainingPercent===null?'無法取得':`${w.remainingPercent}%`));
  const meter=el('div','meter'),bar=el('i');bar.style.width=`${w.remainingPercent??0}%`;meter.append(bar);
  div.append(row,meter,el('small','',`已用 ${w.usedPercent??'無法取得'}% · ${w.resetsAtIso?date(w.resetsAtIso)+' 重置':'重置時間無法取得'}`));
  if(w.unavailableReason)div.append(el('small','',w.unavailableReason));$('quota-windows').append(div);
 }}
 if(!s.buckets?.some(b=>b.windows.length))$('quota-windows').append(el('p','hint',s.quotaUnavailableReason||'無法取得：服務未提供額度。'));
 $('connection-text').textContent=s.billing.source==='codex_subscription'?`Codex 訂閱 · 剩餘 ${remaining??'未知'}%`:'額度來源未確認 · 已停止送出';
 applyRuntime(s);updateControls();
}
function applyRuntime(s){
 $('overview-host').textContent=s.executionHost?.name||s.host.name;$('overview-model-label').textContent=s.model.dispatched?'最近模型':'模型服務';$('overview-model').textContent='Codex · '+(s.model.dispatched||'尚未送出').replace('gpt-','GPT-');$('overview-storage').textContent=s.storage?.profileName||s.host.name;

 const missing=(value,reason='服務未提供')=>value==null?`無法取得：${reason}`:String(value);
 $('runtime-execution-host').textContent=s.executionHost?.name||s.host.name;$('runtime-storage-host').textContent=s.storage?.profileName||s.host.name;$('runtime-storage-host').title=s.storage?.dataPath||'';$('runtime-model').textContent=s.model.dispatched||'尚未送出';
 $('runtime-model-note').textContent=`選擇：${s.model.requested==='auto'?'自動':s.model.requested}。${s.model.scope}；${s.model.source}。`;
 $('runtime-provider').title=s.execution?`AI 運算：${s.execution.modelComputation}；請求轉接：${s.execution.requestRelay}；搜尋工具：${s.execution.tools}`:'';$('runtime-provider').textContent=missing(s.provider.confirmedForChat||s.provider.configured,s.provider.unavailableReason);
 $('runtime-execution-note').textContent=`程式執行：${s.execution?.programHost||'無法取得'} · ${s.execution?.programEnabled?'此對話已允許':'此對話未啟用'}。AI 回答仍在雲端。`;$('runtime-compute').textContent=s.execution?.modelComputation||'無法取得';$('runtime-tools-host').textContent=s.execution?.tools||s.storage?.host||'無法取得';
 $('runtime-auth').textContent=s.account.authDescription;
 $('runtime-account').textContent=missing(s.account.email,s.account.unavailableReason);
 $('runtime-match').textContent=s.account.matchesExpected===true?`已核對額度主機 · …${s.account.idSuffix}`:s.account.matchesExpected===false?'帳戶不同，已停止問答':'無法取得：無法核對帳戶';
 $('runtime-billing').textContent=s.billing.label;
 $('runtime-billing-note').textContent=s.billing.reason||`使用服務主機上的 ${s.billing.accountEmail||'未提供識別'}；手機或瀏覽器不會自動切換扣款帳戶。`;
 const evidence=$('runtime-evidence');evidence.replaceChildren();
 for(const text of [`服務路徑：${s.provider.endpoint||'無法取得：未確認官方位址'}`,s.billing.exactChargeReason,s.billing.apiBalanceReason,...Object.values(s.sources).map(x=>`${x.method}：${x.available?'已查詢':x.reason} · ${date(x.capturedAt)}`)])evidence.append(el('p','hint',text));
 $('account-tokens').textContent=s.accountUsage.lifetimeTokens===null?missing(null,s.accountUsage.reason):fmt(s.accountUsage.lifetimeTokens);
 $('account-usage-date').textContent=missing(s.accountUsage.latestDay?.date,s.accountUsage.reason);
 $('account-day-tokens').textContent=s.accountUsage.latestDay?fmt(s.accountUsage.latestDay.tokens):missing(null,s.accountUsage.reason);
 $('account-usage-note').textContent=s.accountUsage.reason||s.accountUsage.note;
 $('reset-credits').textContent=s.resetCredits.availableCount===null?missing(null,s.resetCredits.reason):`${s.resetCredits.availableCount} 張（僅查詢）`;
 const permissions=$('runtime-permissions');permissions.replaceChildren(el('p','hint',s.permissions.reason));
 for(const tool of s.permissions.allowed)permissions.append(el('p','permission-tool',tool));
 permissions.append(el('p','hint',`未開放：${s.permissions.denied.join('、')}。`));
 $('runtime-updated').textContent=`帳戶／額度查詢於 ${new Date(s.capturedAt).toLocaleString('zh-TW')} · 每分鐘更新`;
 if(s.routing?.lastProvider==='antigravity'){
  const g=s.routing.status||{};$('overview-model').textContent='Gemini · Antigravity';$('runtime-provider').textContent='Google · Antigravity';$('runtime-compute').textContent='Google 雲端';$('runtime-execution-host').textContent=g.host||s.routing.host;$('runtime-auth').textContent=g.authMode||'官方 CLI 登入';$('runtime-account').textContent='無法取得';$('runtime-match').textContent=g.accountReason||'CLI 未提供帳號識別';$('runtime-billing').textContent=g.billing||'此電腦的 Antigravity 帳號';$('runtime-billing-note').textContent=g.billingReason||'';$('runtime-model-note').textContent='Codex 額度用完後，由官方 Antigravity CLI 接手；Codex 配額另列。';
 }
}
function applyMetrics(data){applyRemote(data.remote);const m=data.metrics||data;if(!m.host)return;const changed=state.metrics?.storage?.revision!=null&&m.storage.revision!==state.metrics.storage.revision;state.metrics=m;if(changed&&!state.busy&&state.ready)syncChats().catch(()=>{});if(data.online!=null)state.ready=!!data.online;if(data.history)state.history=data.history;const h=m.host,store=m.storage;const busy=data.busy??state.serverBusy;const wasBusy=state.serverBusy;state.serverBusy=busy;$('host-name').textContent=h.name;$('top-host-name').textContent=h.name;$('machine-name').textContent=h.name;$('host-state').textContent=(data.online===false?'已斷線':busy?'正在處理回答':'已連接')+` · ${h.platform}`;$('machine-os').textContent=`${h.platform} · ${h.arch} · ${h.logicalCores} 核心`;$('machine-busy').textContent=data.online===false?'Codex 未連線':busy?'正在回答':'閒置，可開始問答';$('machine-connection').textContent=data.online===false?'未連線':'已連接';$('connection-dot').classList.toggle('offline',data.online===false);const mins=Math.floor(h.serviceUptimeSeconds/60);$('service-uptime').textContent=mins<1?'不到 1 分鐘':mins<60?`${mins} 分鐘`:`${Math.floor(mins/60)} 小時 ${mins%60} 分鐘`;$('welcome-host').textContent=`目前主機 ${h.name}`;$('disk-free').textContent=h.disk?`${bytes(h.disk.freeBytes)} 可用`:'無法讀取';$('disk-total').textContent=h.disk?`總容量 ${bytes(h.disk.totalBytes)}`:'主機未提供磁碟資料';$('disk-bar').style.width=h.disk?.totalBytes?`${Math.max(0,Math.min(100,100-h.disk.freeBytes/h.disk.totalBytes*100))}%`:'0%';$('ram-used').textContent=bytes(h.totalMemoryBytes-h.freeMemoryBytes);$('ram-total').textContent=`總共 ${bytes(h.totalMemoryBytes)} · 可用 ${bytes(h.freeMemoryBytes)}`;$('ram-bar').style.width=`${Math.max(0,Math.min(100,100-h.freeMemoryBytes/h.totalMemoryBytes*100))}%`;$('data-size').textContent=bytes(store.totalBytes);$('chat-size').textContent=`${store.chats} 段 · ${bytes(store.files.chats)}`;$('index-size').textContent=bytes(store.files.index);$('source-size').textContent=bytes(store.sourceBytes);$('data-path').textContent=store.dataPath;$('today-tokens').textContent=fmt(m.usage.todayTokens);$('total-tokens').textContent=fmt(m.usage.reportedTokens);$('saved-turns').textContent=`${fmt(m.usage.turns)} 回合`;$('usage-evidence').textContent=`本工作台最近 1 分鐘完成 ${fmt(m.usage.completedLastMinute)} 回合；最近回答 ${m.usage.lastReplyAt?date(m.usage.lastReplyAt):'尚無紀錄'}，回報 ${fmt(m.usage.lastReplyTokens)} tokens。額度百分比由整個帳戶共用，未提供逐回合扣額。`;$('last-updated').textContent=`更新於 ${date(m.capturedAt)}`;const hist=state.history;if(hist){$('index-count').textContent=fmt(hist.conversations);$('memory-count').textContent=fmt(hist.conversations);$('welcome-memory').textContent=`${fmt(hist.conversations)} 段 Codex 記憶`;$('index-time').textContent=hist.error?`索引更新失敗：${hist.error}`:hist.refreshing?'正在更新索引…':`最後索引 ${date(hist.indexedAt)}`;}updateControls();}
async function refreshMetrics(){const data=await api('/api/metrics');applyMetrics(data);return data;}
function statusQuery(){return new URLSearchParams({chatId:state.chatId||'',model:$('model').value||'auto',user:state.identity}).toString();}
async function refreshStatus(){const query=statusQuery();const data=await api('/api/status?'+query);if(query!==statusQuery())return data;if(JSON.stringify(state.models)!==JSON.stringify(data.models)){const selected=$('model').value;state.models=data.models;$('model').replaceChildren(...data.models.map(m=>{const o=el('option','',m.name);o.value=m.id;return o;}));$('model').value=data.models.some(m=>m.id===selected)?selected:'auto';updateEfforts();}applyQuota(data.status);state.access=data.access;adminUI?.setAccess(data.access);state.history=data.history;state.ready=!!data.online;applyMetrics(data);$('access-mode').textContent=data.access.remote?'私人遠端連線':'這台電腦（本機）';return data;}
function download(name,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const link=el('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const safeName = text => text.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,80)||'對話';
function exportChat(){const c=current();if(!c)return;const text=`# ${c.title}\n\n建立：${c.createdAt}\n\n`+c.messages.map(m=>`## ${m.role==='user'?'我':'助理'}\n\n${m.text}${m.error?`\n\n> ${m.error}`:''}`).join('\n\n');download(safeName(c.title)+'.md',text,'text/markdown;charset=utf-8');toast('已匯出這段對話。');}
async function editChat(change){const c=current();if(!c||state.busy)return;const updated=await api('/api/chats',{method:'PATCH',body:JSON.stringify({id:c.id,...change})});state.chats=state.chats.map(x=>x.id===updated.id?updated:x);state.archived=!!updated.archived;renderChat();return updated;}
function showRename(){if(!current()||state.busy)return;$('rename-input').value=current().title;openDialog('rename-dialog');$('rename-input').focus();$('rename-input').select();}
function searchDialog(mode='local'){state.searchMode=mode==='codex'&&state.identity!=='我'?'local':mode;openDialog('search-dialog');$('search-input').focus();runSearch();}
let searchTimer;
async function runSearch(){const seq=++state.searchSeq;const q=$('search-input').value.trim();$('search-local').classList.toggle('active',state.searchMode==='local');$('search-codex').classList.toggle('active',state.searchMode==='codex');const list=$('search-results');list.replaceChildren();if(state.searchMode==='local'){const matches=state.chats.filter(c=>c.user===state.identity&&(!q||`${c.title}\n${c.messages.map(m=>m.text).join('\n')}`.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));$('search-count').textContent=`${matches.length} 段對話`;for(const c of matches){const b=el('button','search-result');b.append(el('strong','',c.title));const match=q?c.messages.find(m=>m.text.toLowerCase().includes(q.toLowerCase())):c.messages.at(-1);if(match){const at=Math.max(0,match.text.toLowerCase().indexOf(q.toLowerCase())-30);b.append(el('p','',match.text.slice(at,at+160)));}b.append(el('small','',`${date(c.updatedAt||c.createdAt)}${c.archived?' · 已封存':''}`));b.onclick=()=>{$('search-dialog').close();selectChat(c.id);};list.append(b);}if(!matches.length)list.append(el('p','empty-list muted','找不到符合的對話。'));return;}
 $('search-count').textContent='';if(!q){list.append(el('p','empty-list muted','輸入專案名稱或關鍵字，例如 TM5、論文、課程。'));return;}list.append(el('p','empty-list muted','正在搜尋記憶…'));try{const data=await api('/api/history/search?q='+encodeURIComponent(q));if(seq!==state.searchSeq)return;list.replaceChildren();$('search-count').textContent=`${data.results.length} 筆結果`;for(const hit of data.results){const b=el('button','search-result');b.append(el('strong','',hit.title),el('p','',hit.snippet),el('small','',`${date(hit.date)} · ${hit.role==='user'?'你的訊息':'助理回答'}`));b.onclick=()=>openHistory(hit);list.append(b);}if(!data.results.length)list.append(el('p','empty-list muted','找不到相關記憶，試試較短的關鍵字。'));}catch(e){if(seq===state.searchSeq){list.replaceChildren(el('p','empty-list error-text',e.message));}}}
async function openHistory(hit){try{const data=await api('/api/history/read?id='+encodeURIComponent(hit.conversationId)+'&at='+hit.messageIndex);state.selectedHistory={...hit,...data};$('history-title').textContent=data.title;$('history-date').textContent=`${date(hit.date)} · 歷史紀錄`;$('history-content').replaceChildren();for(const m of data.messages){const item=el('article','message');item.append(el('div','history-role',`${m.role==='user'?'你':'助理'} · ${date(m.date)}`));const body=el('div','message-body');body.innerHTML=markdown(m.text);item.append(body);$('history-content').append(item);}openDialog('history-dialog');}catch(e){toast(e.message);}}
function showAdmin(){const list=$('admin-list');list.replaceChildren();for(const c of state.chats.slice().reverse()){const b=el('button','search-result');b.append(el('strong','',c.title),el('small','',`${c.user} · ${c.messages.filter(m=>m.role==='user').length} 回合 · ${c.model}${c.archived?' · 已封存':''}`));b.onclick=()=>{$('admin-dialog').close();selectChat(c.id);};list.append(b);}openDialog('admin-dialog');}
async function send(){if(state.busy||state.runningChats.has(state.chatId))return chooseBusySend();const text=$('prompt').value.trim();if(state.official?.canContinue===false){if(state.access?.isAdmin)return interveneButton.click();const id=state.official?.id;if(id&&!state.officialLoading){activity('正在重新確認原對話狀態…');await openOfficial(id,{refresh:true});}if(state.official?.canContinue===false){toast(state.official?.continueReason||'這段原生對話目前無法接續；草稿已保留。');return;}}const attachments=[...composerUploads.list()],attachmentIds=attachments.map(a=>a.id),attachmentDraft=draftKey();if((!text&&!attachments.length)||composerUploads.sending()||composerUploads.invalid()||!state.storageChosen||state.busy||!state.ready)return;const nativeId=state.official?.id,projectId=!nativeId&&!state.chatId?state.newProjectId||null:null;const turn={requestId:crypto.randomUUID(),id:++state.turnSequence,chatId:state.chatId,officialId:nativeId,visible:true};state.turns.set(turn.id,turn);state.activeTurn=turn;state.busy=true;state.allowQueue=false;updateControls();$('prompt').value='';saveDraft();fitPrompt();$('welcome').hidden=true;const userNode=messageNode({role:'user',text,attachments});$('messages').append(userNode);const node=messageNode({role:'assistant',text:''});node.classList.add('streaming');$('messages').append(node);requestAnimationFrame(()=>scrollToLatest());activity(nativeId?'正在接續原本的 Codex 對話…':state.serverBusy?'正在與其他聊天室並行工作…':'正在確認訂閱額度…');const started=Date.now();let gotDone=false,answer='',sent=false;const stream=streamRenderer(node.querySelector('.message-body'),markdown,{after:()=>{if(state.activeTurn===turn&&turn.visible)scrollFollow.follow();}});
 try{const r=await fetch('/api/chat',{method:'POST',headers,body:JSON.stringify({requestId:turn.requestId,text,uploadIds:attachmentIds,chatId:nativeId?null:state.chatId,parentChatId:!nativeId&&!state.chatId?state.newParentChatId:null,codexId:nativeId,projectId,user:state.identity,model:$('model').value,serviceTier:pref.get('speed-tier','default'),effort:$('effort').value,executionEnabled:$('execution-allow').checked})});if(!r.ok)throw new Error((await r.json()).error);sent=true;composerUploads.remove(attachmentIds,attachmentDraft);const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
  const handle=line=>{if(!line.trim())return;const e=JSON.parse(line);const visible=()=>state.activeTurn===turn&&turn.visible;if(e.type==='start'){turn.chatId=e.chatId;state.runningChats.add(e.chatId);if(nativeId)state.runningChats.add(nativeId);state.sidebarSignature='';renderList();if(!visible())return;if(nativeId){state.official=null;$('official-banner').hidden=true;$('native-live-state').hidden=true;$('composer-note').hidden=true;$('prompt').placeholder='傳送訊息…';}state.chatId=e.chatId;state.newParentChatId=null;turnInsights?.reset({model:e.model,provider:e.model?.includes('gemini')?'antigravity':'codex',strategy:e.strategy});state.activeProvider='codex';updateControls();rememberSelection();applyQuota(e.status);activity(e.strategy?'Luna Max → Astra Max：先執行，再自動審核…':`${e.restored?'已恢復先前對話 · ':''}${e.model?.replace('gpt-','GPT-')||'Codex'} 正在回答…`);}if(e.type==='done'){completedNotice(e,turn);state.runningChats.delete(e.chatId||turn.chatId);if(turn.officialId)state.runningChats.delete(turn.officialId);state.sidebarSignature='';renderList();}if(!visible())return;const stick=scrollFollow.isFollowing();if(e.type==='provider'){turnInsights?.update({provider:e.provider,strategy:e.strategy});state.activeProvider=e.provider;activity(e.label);updateHybridUI({...state.status?.routing,working:e.label});}if(e.type==='reasoning-level'){const names={low:'輕',medium:'中',high:'高'};state.reasoningLevel=names[e.to];activity(e.from?names[e.from]+' → '+names[e.to]+' · '+e.reason:'開始處理');node.dataset.effort=e.to;}if(e.type==='steered')showSteering(e.message||{role:'user',text:e.text,steering:true});if(e.type==='delta'||e.type==='replace'){answer=e.type==='replace'?e.text:answer+e.text;stream.set(answer);}if(e.type==='runtime-status'){if(e.status)applyQuota(e.status);activity(e.stage==='querying'?'正在查詢即時帳戶與額度…':'即時狀態已取得，正在整理回答…');}if(e.type==='progress'){updateProgress(node,e.rows,true);turnInsights?.update({workflow:e.rows});}if(e.type==='usage')turnInsights?.update({usage:e.usage});if(e.type==='delegations')turnInsights?.update({delegations:e.delegations});if(e.type==='plan')turnInsights?.update({plan:e.plan});if(e.type==='workflow')activity(({thinking:'Codex 正在思考…',compacting:'Codex 正在壓縮上下文…',compacted:'上下文已壓縮，繼續處理…'})[e.stage]||'Codex 正在處理…');if(e.type==='execution'){activity('程式工具：'+e.tool+' · '+(e.result?.host||state.storage?.current.name||''));executionUI.refresh().catch(()=>{});}if(e.type==='history')activity(e.query?`正在搜尋記憶：${e.query}`:'正在閱讀相關對話…');if(e.type==='done'){turnInsights?.update({usage:e.usage,model:e.model,modelsUsed:e.modelsUsed,strategy:e.strategy,delegations:e.delegations,plan:e.plan,provider:e.provider});state.reasoningLevel=null;gotDone=true;answer=e.text;stream.finish(answer);applyQuota(e.status);activity(e.error||'',!!e.error);}if(stick)scrollFollow.follow();};
 while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)handle(line);}if(buffer.trim())handle(buffer);if(!gotDone)throw new Error('連線提前結束。已保存的訊息可重新開啟查看。');await refreshChats();
 }catch(e){const network=e instanceof TypeError&&/fetch|network|load failed/i.test(e.message);activity(network?'瀏覽器與本機工作台的連線中斷。請重新開啟工作台，再查看這段對話是否已送出；不要連按送出。':e.message,true);if(!sent){node.remove();userNode.remove();$('prompt').value=text;saveDraft();}else{try{await refreshChats();}catch{}}}finally{stream.dispose();state.runningChats.delete(turn.chatId);state.turns.delete(turn.id);if(state.activeTurn===turn){state.reasoningLevel=null;state.busy=false;state.allowQueue=false;}state.sidebarSignature='';renderList();node.classList.remove('streaming');updateControls();fitPrompt();refreshMetrics().catch(()=>{});if(state.libraryMode==='codex')loadLibrary().catch(()=>{});$('prompt').focus();}}
const turnQueue=createTurnQueue({pref,api,headers,notify:toast,onComplete:async id=>{await refreshChats();if(state.chatId===id&&!state.busy)renderChat();}});
const queueButton=el('button','text-button','佇列');queueButton.type='button';$('composer-memory').after(queueButton);
queueButton.onclick=()=>{const dialog=el('dialog','busy-send-dialog');dialog.append(el('h2','','待送出佇列'),el('p','','頁面開啟時自動接續；重新開啟後保留待送項目。送出中斷不自動重送，請先核對原對話。'));for(const r of turnQueue.list()){const item=el('div');item.append(el('p','',r.payload.text),el('small','',r.state==='queued'?'等待上一回合完成':r.error||'已派送，請核對原對話'));const remove=el('button','button','移除佇列項目');remove.disabled=r.state==='sending';remove.onclick=()=>{turnQueue.cancel(r.id);item.remove();};item.append(remove);dialog.append(item);}const close=el('button','button','關閉');close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(close);document.body.append(dialog);dialog.showModal();};
setInterval(()=>{queueButton.textContent='佇列 '+turnQueue.list().length;if(state.workspaceLoaded&&state.storageChosen)turnQueue.tick().catch(()=>{});},3000);
function completedNotice(e,turn){toast(e.error?'工作發生問題：'+e.error:'工作回合已完成');if(e.error)return;const text=e.text||'';if(!/[？?]/.test(text))return;const choices=[...text.matchAll(/^\s*(?:[-*•]|\d+[.)、])\s+(.+)$/gm)].map(m=>m[1].trim());if(choices.length<2||choices.length>5||choices.some(c=>c.length>240))return;const dialog=el('dialog','busy-send-dialog');dialog.append(el('h2','','工作需要你的回答'),el('p','',text.slice(0,2000)));for(const choice of choices){const b=el('button','button',choice);b.onclick=async()=>{dialog.close();dialog.remove();if(state.chatId!==turn.chatId)await selectChat(turn.chatId);$('prompt').value=choice;saveDraft();fitPrompt();$('prompt').focus();toast('已填入選項，確認後按送出');};dialog.append(b);}const close=el('button','text-button','稍後回答');close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(close);document.body.append(dialog);dialog.showModal();}
let busySendDialog;
function chooseBusySend(){
 if(!$('prompt').value.trim()||state.steering)return;
 if(busySendDialog?.open)return;
 const chatId=state.chatId;busySendDialog=el('dialog','busy-send-dialog');
 const title=el('h2','','工作正在執行，要如何送出？'),hint=el('p','','引導會加入目前工作；加入佇列會在上一回合完成後自動送出（需保持頁面開啟）。');
 const guide=el('button','button','引導目前工作'),wait=el('button','button','加入佇列，自動接續'),cancel=el('button','text-button','取消');
 const close=()=>{busySendDialog.close();busySendDialog.remove();};
 guide.onclick=()=>{close();if(state.chatId===chatId)steer();};wait.onclick=()=>{try{if(state.chatId!==chatId||!chatId)throw Error('請等對話建立後再排隊');if(composerUploads.sending()||composerUploads.invalid())throw Error('請等附件完成');const ids=composerUploads.list().map(a=>a.id);turnQueue.add({chatId,text:$('prompt').value.trim(),uploadIds:ids,user:state.identity,model:$('model').value,effort:$('effort').value,serviceTier:pref.get('speed-tier','default'),executionEnabled:$('execution-allow').checked});composerUploads.remove(ids);$('prompt').value='';saveDraft();fitPrompt();close();toast('已加入佇列，上一回合完成後自動接續');}catch(e){toast(e.message);}};cancel.onclick=close;
 busySendDialog.append(title,hint,guide,wait,cancel);document.body.append(busySendDialog);busySendDialog.showModal();
}
function showSteering(m){if(!m)return;if(!m.id&&[...$('messages').querySelectorAll('.steering-message .message-body')].some(n=>n.textContent===m.text))return;if(m.id&&[...$('messages').querySelectorAll('[data-steering-id]')].some(n=>n.dataset.steeringId===m.id))return;const n=messageNode(m);$('messages').append(n);scrollToLatest();}
async function steer(){
 const text=$('prompt').value.trim();if(!text||!state.chatId||state.steering||composerUploads.list().length)return;
 state.steering=true;updateControls();try{const chatId=state.chatId;const r=await api('/api/steer',{method:'POST',body:JSON.stringify({chatId,text})});if(state.chatId===chatId)showSteering(r.message||{role:'user',text,steering:true});if($('prompt').value.trim()===text){$('prompt').value='';saveDraft();fitPrompt();}toast('補充已送進目前回合');}catch(e){toast(e.message);}finally{state.steering=false;updateControls();}
}
$('send').onclick=send;$('prompt').addEventListener('input',()=>{saveDraft();fitPrompt();});$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
$('stop').onclick=async()=>{try{await api('/api/stop',{method:'POST',body:JSON.stringify({chatId:state.chatId})});activity('正在停止回答…');}catch(e){toast(e.message);}};
$('new-chat').onclick=()=>newChat();$('new-child-chat').onclick=newChildChat;$('model').onchange=()=>{rememberModel();updateEfforts();effortPicker?.sync();if(state.busy||state.runningChats.has(state.chatId))toast('已選擇下一回合模型；目前回合保持原設定，插入引導不會更換模型。');};$('effort').onchange=()=>{if(state.busy||state.runningChats.has(state.chatId))toast('已選擇下一回合思考程度；目前回合保持原設定。');};
$('identity').onchange=()=>{saveDraft();state.identity=$('identity').value;state.official=null;if(state.identity!=='我')state.libraryMode='web';pref.set('identity',state.identity);state.chatId=null;state.archived=false;const preferred=pref.get(modelPreferenceKey(),'auto');if(state.models?.some(m=>m.id===preferred)){$('model').value=preferred;updateEfforts();}loadDraft();renderChat();$('settings-dialog').close();};
$('collapse-sidebar').onclick=()=>{if(matchMedia('(max-width:800px)').matches)closeSidebar();else $('app').classList.add('sidebar-collapsed');};$('expand-sidebar').onclick=()=>{if(matchMedia('(max-width:800px)').matches){$('app').classList.add('sidebar-open');$('scrim').hidden=false;$('expand-sidebar').setAttribute('aria-expanded','true');}else $('app').classList.remove('sidebar-collapsed');};$('scrim').onclick=closeSidebar;
$('inspector-open').onclick=()=>toggleInspector();$('inspector-close').onclick=()=>toggleInspector(false);for(const id of ['host-open','top-host','quota-open'])$(id).onclick=()=>toggleInspector();
$('archive-filter').onclick=()=>{state.archived=!state.archived;if(state.libraryMode==='codex')loadLibrary();else renderList();};$('settings-open').onclick=()=>openDialog('settings-dialog');$('theme-select').onchange=()=>selectTheme($('theme-select').value);
$('open-search').onclick=()=>searchDialog('local');$('open-memory').onclick=()=>searchDialog('codex');$('search-local').onclick=()=>{state.searchMode='local';runSearch();};$('search-codex').onclick=()=>{state.searchMode='codex';runSearch();};$('search-input').oninput=()=>{++state.searchSeq;clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,200);};
$('rename-chat').onclick=showRename;$('chat-title').onclick=showRename;$('rename-save').onclick=async()=>{try{await editChat({title:$('rename-input').value});$('rename-dialog').close();toast('已更新對話名稱。');}catch(e){toast(e.message);}};$('rename-input').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing)$('rename-save').click();};
$('pin-chat').onclick=async()=>{try{await editChat({pinned:!current()?.pinned});toast(current()?.pinned?'已置頂對話。':'已取消置頂。');}catch(e){toast(e.message);}};$('archive-chat').onclick=async()=>{try{await editChat({archived:!current()?.archived});toast(current()?.archived?'已封存；可從側欄還原。':'已還原對話。');}catch(e){toast(e.message);}};$('export-chat').onclick=exportChat;
$('export-all').onclick=()=>{download(`codex-local-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({version:1,exportedAt:new Date().toISOString(),chats:state.chats},null,2),'application/json');toast('已匯出全部聊天紀錄。');};
$('refresh-desktop').onclick=async()=>{const id=state.official?.id||current()?.codexThreadId;if(!id)return;try{const result=await api('/api/codex/refresh-desktop',{method:'POST',body:JSON.stringify({id})});toast(result.notified?'已通知資料主機的官方 Codex 重新讀取紀錄。':result.reason);}catch(e){toast(e.message);}};
$('refresh-status').onclick=async()=>{const b=$('refresh-status');b.disabled=true;try{await refreshStatus();toast('狀態已更新。');}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('reindex').onclick=async()=>{const b=$('reindex');b.disabled=true;b.textContent='正在更新…';try{const result=await api('/api/history/refresh',{method:'POST',body:'{}'});await refreshMetrics();toast(result.refreshing?'索引更新正在進行。':`記憶已更新：${result.conversations} 段對話。`);}catch(e){toast(e.message);}finally{b.disabled=false;b.innerHTML=icon('refresh')+'更新記憶索引';}};
$('copy-path').onclick=()=>copy(state.metrics?.storage?.dataPath||'');$('admin-open').onclick=showAdmin;
$('ask-history').onclick=()=>{const h=state.selectedHistory;if(!h||state.busy)return;$('history-dialog').close();$('search-dialog').close();newChat();$('prompt').value=`請搜尋並讀取「${h.title}」（${date(h.date)}）這段歷史對話，再幫我整理可以接續的下一步。`;saveDraft();fitPrompt();$('prompt').focus();};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();for(const b of document.querySelectorAll('[data-prompt]'))b.onclick=()=>{$('prompt').value=b.dataset.prompt;saveDraft();fitPrompt();$('prompt').focus();};
document.addEventListener('click',e=>{const copyCode=e.target.closest('.copy-code');if(copyCode)copy(copyCode.closest('.code-block').querySelector('code').textContent);if(!$('chat-menu').contains(e.target)||e.target.closest('.menu button'))$('chat-menu').open=false;});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();searchDialog('local');}if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();if(!document.querySelector('dialog[open]'))newChat();}if(e.key==='Escape'){closeSidebar();if(!document.querySelector('dialog[open]'))toggleInspector(false);}});
window.addEventListener('beforeunload',()=>saveDraft());
async function loadWorkspace(){try{await sidebarUI.loadOrder();const data=await refreshStatus();state.models=data.models;updateEfforts();await executionUI.refresh();$('model').replaceChildren();for(const m of data.models){const o=el('option','',m.name);o.value=m.id;$('model').append(o);}const preferred=pref.get(modelPreferenceKey(),'auto');$('model').value=state.models.some(m=>m.id===preferred)?preferred:'auto';updateEfforts();await refreshChats(false);const taskLink=location.hash.match(/^#task=([0-9a-f-]{36})$/i)?.[1];const selected=taskLink||pref.get(`selected.${state.identity}`);const old=state.chats.find(c=>c.id===selected&&c.user===state.identity);if(old){state.chatId=old.id;state.archived=!!old.archived;$('model').value=old.model;updateEfforts(old.effort);}loadDraft();renderChat();loadLibrary().catch(e=>toast(e.message));state.workspaceLoaded=true;if(pref.get('inspector-open')!=='false'&&innerWidth>1100)toggleInspector(true);}catch(e){state.ready=false;activity(e.message,true);$('host-state').textContent='連線未就緒';updateControls();}}
async function init(){try{await loadStorage();const forced=['#choose-storage','#receive-records'].includes(location.hash);if(!forced&&(state.storage.current.defaultLocal||pref.get(storageChoiceKey())===state.storage.current.id)){state.storageChosen=true;pref.set(storageChoiceKey(),state.storage.current.id);if(location.hash==='#desktop-local')history.replaceState(null,'',location.pathname+location.search);await loadWorkspace();}else openDialog('devices-dialog');}catch(e){$('device-error').textContent=e.message;openDialog('devices-dialog');}updateControls();}
const sidebarUI=createSidebar({state,$,el,icon,api,pref,toast,openOfficial,selectChat,newChat,reload:async(more=false)=>{await refreshChats(false);if(state.libraryMode==='codex')await loadLibrary(more);else {state.projects=await api('/api/codex/projects');renderList();renderProjectPicker();}}});
const executionUI=createExecutionUI({state,$,el,api,toast,openDialog});
// Keep detailed diagnostics one click away without filling the reading area.
for(const section of document.querySelectorAll('.inspector-content > section')){
 const caption=section.querySelector('.section-caption');if(!caption)continue;
 const group=el('details','inspector-group'),summary=el('summary','',caption.firstChild?.textContent?.trim()||'詳細資訊');
 group.open=false;section.before(group);group.append(summary,section);
}
const inspectorDeep=el('details','inspector-deep');inspectorDeep.append(el('summary','','詳細資訊'));for(const group of document.querySelectorAll('.inspector-group'))inspectorDeep.append(group);$('last-updated').before(inspectorDeep);
adminUI=createAdmin({$,el,api,toast});
modelPicker=createPicker($('model'),{label:'模型',description:id=>id==='auto'?'一般問答單模型；程式工作自動 Luna → Astra':id==='cocow-auto-review'?'Luna Max 執行 → Astra Max 審核':''});
effortPicker=createPicker($('effort'),{label:'思考程度',description:id=>id==='auto'?'輕 → 中 → 高 · 連續失敗才升級':''});
const speedButton=el('button','speed-toggle');speedButton.type='button';function paintSpeed(){const on=pref.get('speed-tier','default')==='priority';speedButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5 14h6l-1 8 9-13h-6z"/></svg><span>'+(on?'加速':'一般')+'</span><span class="speed-state">'+(on?'開':'關')+'</span>';speedButton.setAttribute('aria-pressed',String(on));speedButton.setAttribute('aria-label','速度提升：'+(on?'開啟':'關閉'));speedButton.title=(on?'已選加速':'一般速度')+' · 下一回合生效；加速會增加額度消耗，不代表目前回合已加速。';}speedButton.onclick=()=>{pref.set('speed-tier',pref.get('speed-tier','default')==='priority'?'default':'priority');paintSpeed();};$('effort').parentElement.after(speedButton);paintSpeed();
const richContent=createRichContent({$,el,headers,toast,openDialog});
composerUploads=createComposerAttachments({$,el,headers,toast,draftKey,pref,preview:richContent.preview,changed:()=>{saveDraft();fitPrompt();},canUpload:()=>state.storageChosen&&!state.busy});
function updateEfforts(selected){const model=state.models?.find(m=>m.id===$('model').value);const choices=[...(model?.efforts?.includes('low')?['auto']:[]),...(model?.efforts||[])];if(!choices.length){const pending=el('option','','等待連線');pending.value='';$('effort').replaceChildren(pending);return;}const old=selected||$('effort').value||'low';$('effort').replaceChildren(...choices.map(v=>{const o=el('option','',({auto:'自動',none:'無',minimal:'最低',low:'輕',medium:'中',high:'高',xhigh:'更高',max:'Max',ultra:'Ultra'})[v]||v);o.value=v;return o;}));$('effort').value=choices.includes(old)?old:model?.defaultEffort||choices[0];}
init();
setInterval(()=>{if(state.storageChosen&&!document.hidden&&!state.busy)refreshMetrics().catch(()=>{$('host-state').textContent='主機暫時無法連線';$('connection-dot').classList.add('offline');});},15000);
setInterval(()=>{if(state.storageChosen&&!document.hidden&&!state.busy)refreshStatus().catch(()=>{});},60000);
function applyRemote(remote){if(!remote)return;state.remote=remote;$('remote-state').textContent=remote.label;$('remote-help').textContent=remote.ready?'家裡裝置登入同一個 Tailscale 帳號後，開啟下方網址。目前只限你本人。':'仍需完成私人連線設定。目前只能從本機使用；尚未開放其他人的帳號。';$('remote-url').hidden=!remote.ready;$('copy-remote').hidden=!remote.ready;if(remote.ready){$('remote-url').href=remote.privateUrl;$('remote-url').textContent=remote.privateUrl;}}
$('copy-remote').onclick=()=>{if(state.remote?.privateUrl)copy(state.remote.privateUrl);};
async function syncChats(){if(state.official){await openOfficial(state.official.id,{refresh:true});return;}if(current()?.codexThreadId&&!state.busy){try{await api('/api/chats/sync',{method:'POST',body:JSON.stringify({id:state.chatId})});}catch{}}await refreshChats();}
function renderLocation(){const h=state.storage?.current.name||state.metrics?.host.name;if(!h)return;const c=current();$('devices-open').textContent=h;$('devices-open').title='工作主機：'+h+' · 點此切換';$('chat-subtitle').textContent=`紀錄存在 ${h} · ${state.access?.remote?'遠端電腦':'這台電腦'}${c?.archived?' · 已封存':''}${state.identity==='我'?'':` · ${state.identity}`}`;}
$('ask-quota').onclick=()=>{if(state.official)newChat();toggleInspector(false);$('prompt').value='我剩多少額度？也請確認現在消耗誰的額度。';saveDraft();fitPrompt();$('prompt').focus();};

async function loadDeviceApprovals(){const data=await api('/api/devices');
 const approvals=$('device-approvals');approvals.replaceChildren();
 if(data.canApprove){approvals.append(el('h3','', '使用此台額度的裝置'));for(const d of data.devices){const row=el('div','device-row'),info=el('div');info.append(el('strong','',d.name),el('small','',d.login),el('small','',d.state==='pending'?'等待核准':d.state==='approved'?'已允許使用額度':'已撤銷'));const button=el('button','button secondary',d.state==='approved'?'撤銷':'核准');button.onclick=async()=>{button.disabled=true;try{await api('/api/devices',{method:'PATCH',body:JSON.stringify({id:d.id,state:d.state==='approved'?'revoked':'approved'})});await loadDeviceApprovals();}catch(e){toast(e.message);button.disabled=false;}};row.append(info,button);approvals.append(row);}approvals.append(el('p','hint','核准只提供模型問答與額度查詢；不提供這台主機的聊天、記憶、檔案或指令權限。對方的提問和選取的記憶片段仍須送到此主機與模型處理。'));}
 $('device-error').textContent=data.pairingError||'';
}
$('devices-open').onclick=()=>{if(state.busy){toast('請等待回答完成再切換。');return;}openDialog('devices-dialog');loadStorage().then(loadDeviceApprovals).catch(e=>{$('device-error').textContent=e.message;});};
$('profile-save').onclick=async()=>{try{await api('/api/host-profiles',{method:'POST',body:JSON.stringify({name:$('profile-name').value,origin:$('profile-origin').value})});$('profile-name').value='';$('profile-origin').value='';await loadStorage();toast('已儲存主機連線。');}catch(e){toast(e.message);}};

function storageChoiceKey(){return `storage-choice.${state.storage.account.key}`;}
function privateTarget(value){try{const u=new URL(value);return !u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&((u.protocol==='https:'&&u.hostname.endsWith('.ts.net'))||(u.protocol==='http:'&&u.hostname==='127.0.0.1'))?u.origin:null;}catch{return null;}}
function storageTargets(){
 const c=state.storage.current,rows=[{name:c.isBrowserLocal?'本機 · '+c.name:'目前遠端 · '+c.name,origin:location.origin,current:true}];
 if(!c.isBrowserLocal)rows.push({name:'本機 · 我正在操作的電腦',origin:'http://127.0.0.1:4318',local:true});
 if(c.privateOrigin&&c.privateOrigin!==location.origin)rows.push({name:c.name+' · 私人網址（同一份資料）',origin:c.privateOrigin,sameHost:true});
 for(const d of state.storage.targets){const origin=privateTarget(d.origin);if(origin&&!rows.some(x=>x.origin===origin))rows.push({...d,name:d.name,origin});}
 return rows;
}
async function loadStorage(){
 const s=await api('/api/storage');state.storage=s;workspaceUI?.apply(s);const c=s.current;
 const summary=$('device-current');summary.replaceChildren();
 const heading=el('div','storage-heading');heading.append(el('strong','',c.name),el('span','storage-badge',c.isBrowserLocal?'這台電腦':'遠端電腦'));summary.append(heading);
 const pathRow=el('div','storage-path-row'),pathInfo=el('div');pathInfo.append(el('span','storage-label','紀錄資料夾'),el('span','storage-path',c.dataPath));
 const change=el('button','button secondary','變更');change.type='button';change.onclick=()=>{editor.hidden=!editor.hidden;change.setAttribute('aria-expanded',String(!editor.hidden));if(!editor.hidden)input.focus();};change.setAttribute('aria-expanded','false');pathRow.append(pathInfo,change);summary.append(pathRow);
 const editor=el('form','storage-path-editor');editor.hidden=true;
 const label=el('label','field',`${c.name} 上的資料夾`),input=el('input');input.value=c.dataPath;input.id='records-path';input.autocomplete='off';input.spellcheck=false;label.htmlFor=input.id;label.append(input);editor.append(label);
 const buttons=el('div','storage-path-actions'),recommended=el('button','button secondary','使用建議位置'),save=el('button','button','複製並切換');recommended.type='button';recommended.onclick=()=>{input.value=c.defaultDataPath;input.focus();};save.type='submit';buttons.append(recommended,save);editor.append(buttons,el('p','hint','聊天、附件與設定一起複製，原資料保留。'));
 const result=el('p','storage-path-result');result.setAttribute('role','status');editor.append(result);summary.append(editor);
 editor.onsubmit=async e=>{
  e.preventDefault();if(state.busy){result.textContent='請等回答完成後再切換。';return;}
  save.disabled=recommended.disabled=change.disabled=true;input.readOnly=true;saveDraft();result.textContent='正在複製紀錄…';
  try{
   const moved=await api('/api/storage/location',{method:'POST',body:JSON.stringify({path:input.value})});result.textContent='已複製，正在重新連線…';
   for(let i=0;i<90;i++){
    await new Promise(r=>setTimeout(r,1000));
    try{const page=await fetch('/',{cache:'no-store',signal:AbortSignal.timeout(2000)});if(!page.ok)continue;
     const doc=new DOMParser().parseFromString(await page.text(),'text/html'),freshToken=doc.querySelector('meta[name="demo-token"]')?.content;if(!freshToken)continue;
     const reply=await fetch('/api/storage',{headers:{'x-demo-token':freshToken},signal:AbortSignal.timeout(2000)});if(!reply.ok)continue;const fresh=await reply.json();
     if(fresh.current.dataPath===moved.dataPath){location.reload();return;}
    }catch{}
   }
   result.textContent='紀錄已複製。重新連線較久，請重新開啟工作台；原資料仍保留。';
  }catch(e){result.textContent=e.message;save.disabled=recommended.disabled=change.disabled=false;input.readOnly=false;}
 };
 const details=el('details','storage-tech'),disclosure=el('summary','','連線詳情');details.append(disclosure);summary.append(details);
 for(const [name,value]of [['程式版本',c.appVersion||'舊版'],['登入身分',s.account.label],['登入方式',s.account.method],['Codex 歷史',c.codexHistoryPath]]){const row=el('div','storage-detail-row');row.append(el('span','',name),el('span','',value));details.append(row);}
 details.append(el('p','hint','工作台紀錄獨立保存；改位置不會搬動官方 Codex 專案或歷史。'));
 const quota=el('div','storage-detail-row');quota.append(el('span','','額度來源'),el('span','','查詢中…'));details.append(quota);
 api('/api/status').then(data=>{if(state.storage!==s)return;const r=data.status;quota.lastChild.textContent=r.billing.accountEmail||'無法取得';quota.lastChild.title=`${r.billing.label} · ${date(r.capturedAt)}`;}).catch(()=>{quota.lastChild.textContent='無法取得';});
 $('storage-remember').checked=pref.get(storageChoiceKey())===c.id;
 $('storage-close').hidden=!state.storageChosen;
 $('storage-first-hint').textContent='聊天、專案與程式都在選定的電腦。';
 const list=$('device-list'),select=$('copy-target');list.replaceChildren();select.replaceChildren();
 for(const t of storageTargets()){
  const row=el('div','device-row'),info=el('div');info.append(el('strong','',t.name),el('small','',t.origin));
  if(t.local)info.append(el('small','', '需先安裝工作台'));
  const button=el('button','button '+(t.current?'':'secondary'),t.current?'在這裡工作':'選擇');button.onclick=()=>chooseStorage(t);row.append(info,button);list.append(row);
  if(!t.current&&!t.sameHost){const o=el('option','',t.name);o.value=t.origin;select.append(o);}
 }
 $('copy-records').disabled=!select.options.length||!state.workspaceLoaded;
 $('download-records').disabled=!state.workspaceLoaded;
 renderLocation();
}
async function chooseStorage(t){
 if(state.busy||state.loadingWorkspace){toast('請等待目前操作完成。');return;}
 if(t.ownerOnly&&!t.available){openDialog('account-dialog');return;}
 if(!t.current){saveDraft();location.assign(t.origin+'/#choose-storage');return;}
 pref.set(storageChoiceKey(),$('storage-remember').checked?state.storage.current.id:'');
 state.storageChosen=true;state.loadingWorkspace=true;$('devices-dialog').close();
 try{if(!state.workspaceLoaded)await loadWorkspace();renderLocation();updateControls();if(location.hash==='#receive-records')startReceiving();else if(location.hash==='#choose-storage')history.replaceState(null,'',location.pathname);}
 finally{state.loadingWorkspace=false;}
}
function closeStorage(){if(state.storageChosen)$('devices-dialog').close();}
 $('storage-close').onclick=closeStorage;
 $('devices-dialog').addEventListener('cancel',e=>{if(!state.storageChosen)e.preventDefault();});

let outgoing=null,incoming=null,receiveTimer=null;
async function selectedRecords(){
 if(state.identity!=='我')throw new Error('請切回自己的工作紀錄再複製。');
 if(state.busy)throw new Error('請等待回答完成。');
 const scope=$('copy-scope').value;
 if(scope==='current'&&state.official)return api('/api/records/export',{method:'POST',body:JSON.stringify({codexId:state.official.id})});
 const ids=scope==='web'?state.chats.filter(c=>c.user==='我').map(c=>c.id):[current()?.id].filter(Boolean);
 if(!ids.length)throw new Error('目前沒有選中的對話，請先開啟一段對話。');
 return api('/api/records/export',{method:'POST',body:JSON.stringify({ids})});
}
function offerRecords(){if(outgoing?.data&&outgoing.nonce&&!outgoing.window.closed)outgoing.window.postMessage({type:'codex-records-offer',nonce:outgoing.nonce,source:outgoing.data.source.name,count:outgoing.data.records.length,titles:outgoing.data.records.slice(0,8).map(c=>c.title)},outgoing.origin);}
 $('copy-records').onclick=async()=>{
 const origin=privateTarget($('copy-target').value);if(!origin||origin===location.origin)return;
 if(outgoing&&!outgoing.window.closed){toast('請先完成或關閉上一個接收視窗。');return;}
 const popup=window.open(origin+'/#receive-records','_blank');
 if(!popup){$('copy-progress').textContent='瀏覽器封鎖新視窗。請允許彈出視窗，或下載紀錄檔後到目的地主機匯入。';return;}
 outgoing={window:popup,origin,data:null,nonce:null};$('copy-progress').textContent='正在讀取完整紀錄；請到新視窗選擇儲存位置並確認接收。';
 try{outgoing.data=await selectedRecords();offerRecords();}catch(e){popup.close();outgoing=null;$('copy-progress').textContent=e.message;}
};
 $('download-records').onclick=async()=>{try{const data=await selectedRecords();download('Codex-Local-紀錄-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(data,null,2),'application/json');$('copy-progress').textContent='紀錄檔已下載。在接收電腦開啟「儲存位置 → 從紀錄檔匯入」。';}catch(e){$('copy-progress').textContent=e.message;}};
function receiveView(){
 const s=state.storage;$('receive-destination').textContent=`保存到：${s.current.name} · ${s.account.label}\n${s.current.dataPath}`;
 $('receive-summary').textContent=incoming?.offer?`來源：${incoming.origin||'你選擇的檔案'} · ${incoming.offer.source} · ${incoming.offer.count} 段對話`:'等待來源電腦連線。若未連上，可取消後改用紀錄檔匯入。';
 $('receive-titles').replaceChildren(...(incoming?.offer?.titles||[]).map(t=>el('li','',String(t))));
 $('receive-result').textContent='';$('receive-confirm').disabled=!incoming?.offer;openDialog('receive-dialog');
}
function startReceiving(){
 history.replaceState(null,'',location.pathname);clearInterval(receiveTimer);
 incoming={nonce:crypto.randomUUID(),origin:null,window:window.opener};receiveView();
 if(!window.opener){$('receive-summary').textContent='來源視窗已關閉或被瀏覽器隔離，請改用紀錄檔匯入。';return;}
 let tries=0;const hello=()=>{if(!incoming?.window||++tries>300){clearInterval(receiveTimer);return;}incoming.window.postMessage({type:'codex-records-ready',nonce:incoming.nonce},'*');};hello();receiveTimer=setInterval(hello,1000);
}
function cancelReceive(){clearInterval(receiveTimer);if(incoming?.origin)incoming.window?.postMessage({type:'codex-records-cancel',nonce:incoming.nonce},incoming.origin);incoming=null;$('receive-dialog').close();}
 $('receive-close').onclick=cancelReceive;$('receive-dialog').addEventListener('cancel',()=>{cancelReceive();});
 $('import-file').onchange=async()=>{
 const file=$('import-file').files[0];if(!file)return;
 try{if(file.size>10*1024*1024)throw new Error('紀錄檔超過 10 MB，請縮小匯出範圍。');const data=JSON.parse(await file.text());if(data.format!=='codex-local-records'||data.version!==1||!Array.isArray(data.records)||!data.source)throw new Error('請選擇工作台匯出的紀錄檔。');
 incoming={data,offer:{source:String(data.source.name),count:data.records.length,titles:data.records.slice(0,8).map(c=>c.title)}};receiveView();
 }catch(e){toast(e.message);}finally{$('import-file').value='';}
};
async function importReceived(data,session){
 try{const r=await api('/api/records/import',{method:'POST',body:JSON.stringify(data)});if(incoming!==session)return;
  $('receive-result').textContent=`已保存到 ${r.host}：新增 ${r.added.length} 段，略過重複 ${r.skipped} 段。原主機紀錄保留。`;
  if(session.window)session.window.postMessage({type:'codex-records-done',nonce:session.nonce,added:r.added.length,skipped:r.skipped},session.origin);
  session.completed=true;state.storageChosen=true;pref.set(storageChoiceKey(),$('storage-remember').checked?state.storage.current.id:'');
  if(!state.workspaceLoaded)await loadWorkspace();else await refreshChats(false);
  state.libraryMode='web';state.official=null;state.identity='我';$('identity').value='我';pref.set('identity','我');state.archived=false;
  if(r.added.length)await selectChat(r.added[0]);else renderChat();$('devices-dialog').close();
 }catch(e){$('receive-result').textContent=e.message;$('receive-confirm').disabled=false;session.accepted=false;session.importing=false;}
}
 $('receive-confirm').onclick=()=>{if(!incoming?.offer||incoming.accepted)return;incoming.accepted=true;$('receive-confirm').disabled=true;$('receive-result').textContent='正在保存…';if(incoming.data)importReceived(incoming.data,incoming);else incoming.window.postMessage({type:'codex-records-accept',nonce:incoming.nonce},incoming.origin);};
window.addEventListener('message',e=>{
 const m=e.data;if(!m||typeof m!=='object'||typeof m.type!=='string'||!m.type.startsWith('codex-records-'))return;
 if(outgoing&&e.source===outgoing.window&&e.origin===outgoing.origin){
  if(m.type==='codex-records-ready'&&typeof m.nonce==='string'&&/^[0-9a-f-]{36}$/.test(m.nonce)){outgoing.nonce=m.nonce;offerRecords();}
  else if(m.nonce===outgoing.nonce&&m.type==='codex-records-accept'&&outgoing.data){outgoing.window.postMessage({type:'codex-records-data',nonce:m.nonce,data:outgoing.data},outgoing.origin);$('copy-progress').textContent='接收端已確認，正在寫入…';}
  else if(m.nonce===outgoing.nonce&&m.type==='codex-records-done'){if(Number.isInteger(m.added)&&Number.isInteger(m.skipped))$('copy-progress').textContent=`複製完成：新增 ${m.added} 段，略過重複 ${m.skipped} 段。原紀錄保留。`;outgoing=null;}
  else if(m.nonce===outgoing.nonce&&m.type==='codex-records-cancel'){$('copy-progress').textContent='接收端已取消；原紀錄保留。';outgoing=null;}
  return;
 }
 if(!incoming||incoming.completed||e.source!==incoming.window||e.source!==window.opener||m.nonce!==incoming.nonce||!privateTarget(e.origin))return;
 if(m.type==='codex-records-offer'&&!incoming.offer&&Number.isInteger(m.count)&&m.count>0&&m.count<=500&&Array.isArray(m.titles)){
  incoming.origin=e.origin;incoming.offer={source:String(m.source).slice(0,80),count:m.count,titles:m.titles.slice(0,8).map(t=>String(t).slice(0,200))};clearInterval(receiveTimer);receiveView();
 }else if(m.type==='codex-records-data'&&incoming.accepted&&e.origin===incoming.origin&&!incoming.importing){incoming.importing=true;importReceived(m.data,incoming);}
});

Object.assign(state,{libraryMode:pref.get('libraryMode','codex'),official:null,officialRows:[],libraryCursor:null,libraryLoading:false,librarySeq:0,officialSeq:0});
function renderList(){
 if(state.sidebarDragging)return;
 const codex=state.libraryMode==='codex'&&state.identity==='我';
 $('library-codex').disabled=state.identity!=='我';$('library-codex').classList.toggle('active',codex);$('library-web').classList.toggle('active',!codex);$('library-search-wrap').hidden=!codex;
 $('library-note').textContent=codex?'目前主機的 Codex 對話；專案可拖曳，右鍵顯示操作。':'網頁對話；排序保存在目前主機。';
 $('list-label').textContent=state.archived?'已封存任務':'專案';$('archive-filter').title=state.archived?'顯示最近對話':'顯示封存對話';$('archive-filter').setAttribute('aria-label',$('archive-filter').title);const signature=JSON.stringify([state.libraryMode,state.identity,state.archived,state.chatId,state.official?.id,state.projects?.data,state.officialRows,state.chats.map(c=>[c.id,c.title,c.projectId,c.parentChatId,c.archived,c.pinned]),state.runningChats&&[...state.runningChats],state.sidebarOrder,state.libraryCursor,state.libraryError,state.officialRows.length?false:state.libraryLoading]);if(signature!==state.sidebarSignature){state.sidebarSignature=signature;sidebarUI.render();}
}
async function loadLibrary(more=false){
 if(state.libraryLoading||state.sidebarDragging||!state.storageChosen||state.identity!=='我')return;const seq=++state.librarySeq;state.libraryLoading=true;state.libraryError=null;renderList();
 try{const q=new URLSearchParams({q:$('library-search').value,archived:String(state.archived)});if(more&&state.libraryCursor)q.set('cursor',state.libraryCursor);const [r,projectData]=await Promise.all([api('/api/codex/threads?'+q),api('/api/codex/projects'),sidebarUI.loadOrder()]);state.projects=projectData;if(seq!==state.librarySeq)return;state.officialRows=more?[...state.officialRows,...r.data]:r.data;const localTurns=[...state.turns.values()];for(const row of r.data){if(row.liveWorking)state.runningChats.add(row.id);else if(!localTurns.some(t=>t.officialId===row.id))state.runningChats.delete(row.id);}state.libraryCursor=r.nextCursor;state.libraryUpdated=r.capturedAt;}
 catch(e){if(seq===state.librarySeq){state.libraryError=e.message;toast(e.message);}}finally{if(seq===state.librarySeq){state.libraryLoading=false;renderList();renderProjectPicker();}}
}
const officialCache=new Map();
function retainOfficialFallback(id,error){
 const linked=state.chats.find(c=>c.codexThreadId===id),currentOfficial=state.official;
 const source=currentOfficial?.messages?.length?currentOfficial:linked?.messages?.length?linked:null;
 if(!source)return false;
 state.official={...(currentOfficial||{}),id,title:currentOfficial?.title||linked?.title||'Codex 對話',messages:source.messages||[],activities:currentOfficial?.activities||[],canContinue:currentOfficial?.canContinue??false,continueReason:'同步暫時中斷，先顯示已保存紀錄。',syncError:String(error||'同步暫時中斷')};
 state.officialRenderSignature=null;renderOfficial();return true;
}
async function openOfficial(id,{older=false,refresh=false}={}){
 if(state.activeTurn)state.activeTurn.visible=false;if(state.busy){state.allowQueue=true;state.busy=false;updateControls();}if((refresh||older)&&state.officialLoading)return;state.officialLoading=true;const seq=++state.officialSeq,prior=state.official;if(!refresh&&!older){saveDraft();state.chatId=null;state.libraryMode='codex';const cached=officialCache.get(id),row=state.officialRows.find(t=>t.id===id);state.official=cached||{id,title:row?.title||'讀取中…',messages:[],activities:[],canContinue:false,continueReason:'正在讀取對話…',projectId:row?.displayProjectId||row?.projectId||null,capturedAt:new Date().toISOString()};state.officialRenderSignature=null;loadDraft();scrollFollow.latest();renderOfficial();closeSidebar();}const box=$('conversation'),top=box.scrollTop,height=box.scrollHeight,scrollPosition=scrollFollow.capture();
 try{const q=new URLSearchParams({id});if(older&&prior?.olderCursor)q.set('before',prior.olderCursor);if(refresh&&prior?.messages[0]?.id)q.set('from',prior.messages[0].id);const r=await api('/api/codex/conversation?'+q);if(seq!==state.officialSeq||state.busy)return;if(!older&&!refresh&&r.continuationMode==='shared-history'&&r.linkedChatId){await refreshChats(false);if(seq!==state.officialSeq||state.busy)return;if(state.chats.some(c=>c.id===r.linkedChatId)){await selectChat(r.linkedChatId,{preserveLibrary:true});return;}}state.chatId=null;state.newParentChatId=null;const linked=state.chats.find(c=>c.codexThreadId===id||c.id===r.linkedChatId),incoming=Array.isArray(r.messages)?r.messages:[],safeMessages=!older&&!incoming.length&&linked?.messages?.length?linked.messages:incoming;state.official={...r,messages:older?[...incoming,...(prior?.messages||[])]:safeMessages,syncError:null};if(r.liveWorking)state.runningChats.add(id);else if(![...state.turns.values()].some(t=>t.officialId===id))state.runningChats.delete(id);officialCache.delete(id);officialCache.set(id,state.official);if(officialCache.size>12)officialCache.delete(officialCache.keys().next().value);pref.set('officialSelected',id);if(!refresh&&!older){$('execution-allow').checked=!!r.linkedChatId&&executionUI.defaultConsent();if(linked)$('model').value=linked.model;updateEfforts(linked?.effort);}renderOfficial();
 if(!refresh&&!older)closeSidebar();if(older)scrollFollow.restore({...scrollPosition,following:false,top:top+box.scrollHeight-height});else scrollFollow.refresh();
 }catch(e){if(seq!==state.officialSeq)return;if(refresh){if(!retainOfficialFallback(id,e.message))$('official-note').textContent='同步暫時中斷 · '+e.message;}else if(!retainOfficialFallback(id,e.message))toast(e.message);}finally{if(seq===state.officialSeq)state.officialLoading=false;}
}
function renderOfficial({live=false}={}){
 const c=state.official;if(!c)return;const scrollPosition=scrollFollow.capture();const working=c.liveWorking??!!(c.lastTurn&&(!c.lastTurn.completedAt&&c.lastTurn.status==='inProgress'||c.runtimeStatus?.type==='active'));$('welcome').hidden=true;$('official-banner').hidden=false;
 const turns=new Set(c.messages.map(m=>m.turnId)),rows=[...c.messages.map(m=>({...m,entry:'message'})),...(c.activities||[]).filter(a=>turns.has(a.turnId)).map(a=>({...a,entry:'activity'}))].sort((a,b)=>(a.order||0)-(b.order||0));
 const signature=JSON.stringify(rows);if(state.officialRenderSignature!==signature){const existing=new Map([...$('messages').children].filter(n=>n.dataset.itemId).map(n=>[n.dataset.itemId,n]));const openDiffs=new Set([...$('messages').querySelectorAll('.file-diff[open]')].map(n=>(n.closest('[data-item-id]')?.dataset.itemId||'')+'|'+n.dataset.changePath));const open=new Set([...$('messages').querySelectorAll('details[open][data-item-id]')].map(n=>n.dataset.itemId)),nodes=[];let group=[];
  const flush=()=>{if(!group.length)return;const d=el('details','history-work-process');const heading=el('summary','','工作過程 · '+group.length+' 項');d.append(heading);for(const step of group)d.append(richContent.activity(step));d.dataset.itemId=group[0].id;const oldGroup=existing.get(d.dataset.itemId);d.open=oldGroup?.open??false;nodes.push(d);group=[];};
  for(const r of rows){if(r.entry==='activity'){group.push(r);continue;}flush();const rowSignature=JSON.stringify(r),prior=existing.get(r.id),n=prior?.dataset.rowSignature===rowSignature?prior:r.entry==='message'?messageNode(r):richContent.activity(r);n.dataset.itemId=r.id;n.dataset.rowSignature=rowSignature;for(const d of n.querySelectorAll('.file-diff'))d.open=openDiffs.has(r.id+'|'+d.dataset.changePath);nodes.push(n);}flush();const parent=$('messages');for(let i=0;i<nodes.length;i++)if(parent.children[i]!==nodes[i])parent.insertBefore(nodes[i],parent.children[i]||null);while(parent.children.length>nodes.length)parent.lastChild.remove();state.officialRenderSignature=signature;}
 $('chat-title').textContent=c.title;$('chat-subtitle').textContent=(state.metrics?.host.name||'目前主機')+' · Codex 對話';document.title=c.title+' · CoCow';
 
 $('official-note').textContent=c.syncError?'同步暫時中斷 · 已保留保存紀錄':state.liveConnected?'即時連線':working?'同步中':'已同步';
 $('official-banner').classList.toggle('sync-error',!!c.syncError);
 $('official-banner').classList.toggle('live',!!working);$('native-live-state').hidden=false;
 $('native-live-state').textContent=working?'正在工作…':'';$('native-live-state').hidden=!working;
 $('official-older').hidden=!c.olderCursor;$('official-continue').hidden=!c.linkedChatId;$('prompt').placeholder=c.canContinue===false?c.continueReason:'傳送訊息…';$('composer-note').textContent=c.canContinue===false?c.continueReason:c.continuationMode==='shared-history'?'使用共用額度在 CoCow 接續，保留原對話歷史。':'直接送回原對話；若官方 Codex 正在使用它，草稿會保留並提示原因。';$('composer-note').hidden=c.canContinue!==false;if(!live){renderList();updateControls();}else if(document.querySelector('.desktop-intervene'))updateIntervention();scrollFollow.restore(scrollPosition);
}
setInterval(()=>{if(state.storageChosen&&state.official&&!state.liveConnected&&!document.hidden&&!state.busy&&!state.officialLoading&&!document.querySelector('dialog[open]')&&!state.sidebarDragging)openOfficial(state.official.id,{refresh:true});},3000);
let livePolling=false;
setInterval(async()=>{if(!state.storageChosen||state.official||state.busy||!state.chatId||document.hidden||state.liveConnected||livePolling)return;livePolling=true;const id=state.chatId;
 try{const r=await api('/api/chat-live?id='+encodeURIComponent(id));if(state.chatId!==id||state.official||state.busy)return;let node=$('messages').querySelector('.remote-live');
  if(r.active){const box=$('conversation'),stick=scrollFollow.isFollowing();state.serverBusy=true;updateControls();if(!node){node=messageNode({role:'assistant',text:''});node.classList.add('remote-live');$('messages').append(node);}node.querySelector('.message-body').innerHTML=markdown(r.text);if(r.workflow.length)updateProgress(node,r.workflow,true);activity(r.finishing?'正在保存回答…':'正在同步回答…');if(stick)scrollFollow.follow();
  }else{state.serverBusy=!!r.busy;updateControls();if(node){await refreshChats();activity('回答已同步。');}}
 }catch{}finally{livePolling=false;}
},2000);
$('library-codex').onclick=()=>{state.libraryMode='codex';pref.set('libraryMode','codex');state.archived=false;loadLibrary();};
$('library-web').onclick=()=>{state.libraryMode='web';pref.set('libraryMode','web');state.archived=false;renderList();};
$('library-refresh').onclick=()=>loadLibrary();let libraryTimer;$('library-search').oninput=()=>{clearTimeout(libraryTimer);libraryTimer=setTimeout(()=>loadLibrary(),250);};
$('official-refresh').onclick=()=>openOfficial(state.official.id,{refresh:true});$('official-older').onclick=()=>openOfficial(state.official.id,{older:true});$('official-continue').onclick=()=>selectChat(state.official.linkedChatId,{preserveLibrary:true});
setInterval(()=>{if(state.storageChosen&&!document.hidden&&!state.busy&&!state.sidebarDragging&&!document.querySelector('dialog[open]')&&$('sidebar-context').hidden){if(!state.official&&current()?.codexThreadId)syncChats().catch(()=>{});if(state.libraryMode==='codex'&&!state.libraryLoading&&state.officialRows.length<=50)loadLibrary().catch(()=>{});}},15000);
document.addEventListener('visibilitychange',()=>{if(state.storageChosen&&!document.hidden&&!state.busy){if(state.official)openOfficial(state.official.id,{refresh:true});if(state.libraryMode==='codex')loadLibrary();}});

async function organizeThread(data){
 try{const r=await api('/api/codex/conversation',{method:'PATCH',body:JSON.stringify(data)});toast(r.message);$('organize-sync').textContent=r.message;await loadLibrary();await refreshChats(false);if(state.official?.id===data.id)await openOfficial(data.id,{refresh:true});return r;}catch(e){toast(e.message);$('organize-sync').textContent=e.message;}
}
$('official-organize').onclick=async()=>{
 const c=state.official;if(!c)return;const scrollPosition=scrollFollow.capture();const working=c.liveWorking??!!(c.lastTurn&&(!c.lastTurn.completedAt&&c.lastTurn.status==='inProgress'||c.runtimeStatus?.type==='active'));try{state.projects=await api('/api/codex/projects');if(state.projects.readOnly){toast(state.projects.syncNote);return;}$('organize-title').value=c.title;const select=$('organize-project');select.replaceChildren();for(const p of [{id:'',name:'未分類對話'},...state.projects.data]){const o=el('option','',p.name);o.value=p.id;select.append(o);}select.value=c.projectId||state.officialRows.find(t=>t.id===c.id)?.displayProjectId||'';$('organize-sync').textContent=state.projects.syncNote;$('organize-pin').textContent=c.section?.name==='Pinned'?'取消置頂':'置頂';$('organize-archive').textContent=state.archived?'還原':'封存';openDialog('organize-dialog');}catch(e){toast(e.message);}
};
$('organize-rename').onclick=()=>organizeThread({id:state.official.id,action:'rename',title:$('organize-title').value});
$('organize-move').onclick=()=>organizeThread({id:state.official.id,action:'move',projectId:$('organize-project').value||null});
$('organize-pin').onclick=async()=>{await organizeThread({id:state.official.id,action:state.official.section?.name==='Pinned'?'unpin':'pin'});$('organize-pin').textContent=state.official.section?.name==='Pinned'?'取消置頂':'置頂';};
$('organize-archive').onclick=async()=>{await organizeThread({id:state.official.id,action:state.archived?'unarchive':'archive'});$('organize-dialog').close();};
async function renderProjects(){
 const data=await api('/api/codex/projects');state.projects=data;$('projects-note').textContent=data.syncNote;$('projects-list').replaceChildren();
 for(let i=0;i<data.data.length;i++){const p=data.data[i],row=el('div','project-editor');const name=el('input');name.value=p.name;name.maxLength=100;name.setAttribute('aria-label','專案名稱 '+p.name);row.append(name);const save=el('button','button secondary','改名');save.onclick=()=>projectAction({id:p.id,action:'rename',name:name.value});const up=el('button','button secondary','上移');up.disabled=i===0;up.onclick=()=>projectAction({id:p.id,action:'move',beforeId:data.data[i-1]?.id||null});const down=el('button','button secondary','下移');down.disabled=i===data.data.length-1;down.onclick=()=>projectAction({id:p.id,action:'move',beforeId:data.data[i+2]?.id||null});row.append(save,up,down);$('projects-list').append(row);}
}
async function projectAction(body){try{const r=await api('/api/codex/projects',{method:'PATCH',body:JSON.stringify(body)});toast(r.message);await renderProjects();await loadLibrary();}catch(e){toast(e.message);}}
$('projects-open').onclick=()=>{openDialog('projects-dialog');renderProjects().catch(e=>toast(e.message));};




const latestButton=el('button','jump-latest','↓');latestButton.type='button';latestButton.title='回到最新訊息';latestButton.setAttribute('aria-label','回到最新訊息');latestButton.hidden=true;$('conversation').after(latestButton);
scrollFollow=createScrollFollow($('conversation'),latestButton);
function scrollToLatest(){scrollFollow.latest();}


// Explicit desktop delivery uses the original window's account and permissions.
const interveneButton=el('button','desktop-intervene','介入 Codex');interveneButton.type='button';interveneButton.hidden=true;interveneButton.title='交給原 Codex 視窗；沿用原對話的模型、帳號與權限';$('send').before(interveneButton);
function updateIntervention(){interveneButton.hidden=!state.official||!state.access?.isAdmin;interveneButton.disabled=state.busy||state.intervening||!$('prompt').value.trim()||!!composerUploads?.list().length;}
$('prompt').addEventListener('input',updateIntervention);
interveneButton.onclick=async()=>{const id=state.official?.id,text=$('prompt').value.trim();if(!id||!text||state.intervening)return;state.intervening=true;updateIntervention();const requestId=state.pendingIntervention?.id===id&&state.pendingIntervention?.text===text?state.pendingIntervention.requestId:crypto.randomUUID();state.pendingIntervention={id,text,requestId};try{await api('/api/codex/intervene',{method:'POST',body:JSON.stringify({id,text,requestId})});state.pendingIntervention=null;if(state.official?.id===id&&$('prompt').value.trim()===text){$('prompt').value='';saveDraft();fitPrompt();}toast('已交給原 Codex 視窗');if(state.official?.id===id)await openOfficial(id,{refresh:true});}catch(e){toast(e.message);}finally{state.intervening=false;updateIntervention();}};

$('settings-dialog').append($('execution-open'));

createPicker($('composer-project'),{label:'對話專案'});

// One abortable stream follows only the selected task. Polling is a fallback.
let liveController=null,liveKey='',liveRetry=0;
setInterval(()=>{
 const id=state.official?.id||state.chatId,source=state.official?'native':'web',key=state.storageChosen&&!state.busy&&!document.hidden&&id?source+':'+id:'';
 if(key!==liveKey){liveController?.abort();liveController=null;liveKey=key;state.liveConnected=false;liveRetry=0;}
 if(!key||liveController||Date.now()<liveRetry)return;
 const controller=liveController=new AbortController();
 readLive('/api/live?source='+source+'&id='+encodeURIComponent(id),headers,controller.signal,event=>{
  if(controller!==liveController||key!==liveKey)return;
  if(event.type==='unavailable')throw Error(event.message);
  if(event.type==='heartbeat')return;
  state.liveConnected=true;const box=$('conversation'),stick=scrollFollow.isFollowing();
  if(event.type==='native-live'&&state.official?.id===id){mergeNativeLive(state.official,event);renderOfficial({live:true});}
  else if(event.type==='web-live'&&state.chatId===id&&!state.official){
   let node=$('messages').querySelector('.remote-live');state.serverBusy=event.active||event.busy;updateControls();
   if(event.active){turnInsights?.update(event);if(!node){node=messageNode({role:'assistant',text:''});node.classList.add('remote-live');$('messages').append(node);}const body=node.querySelector('.message-body');if(body.dataset.text!==event.text){body.innerHTML=markdown(event.text);body.dataset.text=event.text;}updateProgress(node,event.workflow,true);}
   else if(node){refreshChats().then(()=>activity('')).catch(()=>{});}
  }
  if(stick)scrollFollow.follow();
 }).catch(()=>{}).finally(()=>{if(liveController===controller){liveController=null;state.liveConnected=false;liveRetry=Date.now()+10000;}});
},250);

document.addEventListener('click',async event=>{const button=event.target.closest('button[data-local-path]');if(!button)return;event.preventDefault();button.disabled=true;try{const result=await api('/api/local-file/reveal',{method:'POST',body:JSON.stringify({path:button.dataset.localPath})});toast('已在 '+result.host+' 的檔案總管顯示檔案。');}catch(e){toast(e.message);}finally{button.disabled=false;}});
const imageAssets=new Map();
async function hydrateLocalImages(){for(const card of document.querySelectorAll('[data-image-path]:not([data-loaded])')){card.dataset.loaded='true';const path=card.dataset.imagePath,preview=card.querySelector('.inline-image-preview');try{let asset=imageAssets.get(path);if(!asset){const response=await fetch('/api/local-image',{method:'POST',headers,body:JSON.stringify({path})});if(!response.ok){const err=await response.json();throw Error(err.error||'Image unavailable');}asset=URL.createObjectURL(await response.blob());imageAssets.set(path,asset);}const img=document.createElement('img');img.src=asset;img.alt=card.querySelector('.inline-image-actions>span').textContent;preview.replaceChildren(img);preview.onclick=()=>{const dialog=document.createElement('dialog');dialog.className='image-lightbox';const close=document.createElement('button');close.textContent='Close / 關閉';close.onclick=()=>dialog.close();dialog.append(close,img.cloneNode());document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();};const link=card.querySelector('.inline-image-download');link.href=asset;link.download=path.split(/[\\/]/).pop();link.hidden=false;}catch(e){preview.textContent=e.message;preview.disabled=true;}}}
let imageHydrationQueued=false;new MutationObserver(()=>{if(imageHydrationQueued)return;imageHydrationQueued=true;queueMicrotask(()=>{imageHydrationQueued=false;hydrateLocalImages();});}).observe($('messages'),{childList:true,subtree:true});
window.addEventListener('pagehide',()=>{for(const url of imageAssets.values())URL.revokeObjectURL(url);});

const feedbackLink=document.createElement("a");feedbackLink.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></svg><span>問題回報</span>';feedbackLink.setAttribute('aria-label','問題回報');feedbackLink.title='貼上文字或圖片，回報使用問題';feedbackLink.href="https://e806.tail2e110c.ts.net/feedback";feedbackLink.target="_blank";feedbackLink.rel="noopener";feedbackLink.className="footer-action";$("version-open").before(feedbackLink);

function installReleaseNotice(){
 const summary=el('section','release-summary'),heading=el('h3','','這版改了什麼 · v'+version),items=el('ul');for(const text of releaseNotes)items.append(el('li','',text));summary.append(heading,items);$('update-status').after(summary);
 const notice=el('aside','release-notice');notice.id='release-notice';notice.setAttribute('role','status');notice.setAttribute('aria-label','版本更新說明');notice.hidden=true;const title=el('strong','','已更新至 v'+version),close=el('button','release-dismiss','×');close.setAttribute('aria-label','關閉更新說明');const body=el('ul');for(const text of releaseNotes)body.append(el('li','',text));const more=el('button','release-more','查看版本與更新');more.onclick=()=>{$('settings-open').click();dismiss();};function dismiss(){notice.hidden=true;pref.set('release-notes-seen',buildNumber);}close.onclick=dismiss;notice.append(title,close,body,more);document.body.append(notice);
 if(pref.get('release-notes-seen')!==String(buildNumber)){const timer=setInterval(()=>{if(!state.storageChosen||document.querySelector('dialog[open]')||document.hidden)return;clearInterval(timer);notice.hidden=false;pref.set('release-notes-seen',buildNumber);},700);}
}
