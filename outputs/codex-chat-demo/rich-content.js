import {toolActivity} from './tool-activity.mjs';
import{markdown}from'./markdown.mjs';
import{visibleText}from'./presentation.mjs';
export function createRichContent({$,el,headers,toast,openDialog}){
 const blobs=new Map();let bytes=0;
 async function fetchFile(a){if(blobs.has(a.id))return blobs.get(a.id);const r=await fetch('/api/attachment?id='+a.id,{headers});if(!r.ok){let err;try{err=(await r.json()).error;}catch{}throw new Error(err||'附件無法讀取，請更新對話後重試。');}const blob=await r.blob(),file={blob,url:URL.createObjectURL(blob)};blobs.set(a.id,file);bytes+=blob.size;
  while(bytes>70*1024*1024&&blobs.size>1){const [id,old]=blobs.entries().next().value;URL.revokeObjectURL(old.url);bytes-=old.blob.size;blobs.delete(id);}return file;
 }
 async function preview(a){try{const f=await fetchFile(a);$('attachment-title').textContent=a.name;const body=$('attachment-preview');body.replaceChildren();let n;
  if(a.mime.startsWith('image/')){n=el('img');n.src=f.url;n.alt=a.name;}
  else if(a.mime==='text/plain'){n=el('pre');const text=await f.blob.text();n.textContent=text.slice(0,300000)+(text.length>300000?'\n\n（預覽至此；下載可查看完整內容。）':'');}
  else if(a.mime.startsWith('audio/')||a.mime.startsWith('video/')){n=el(a.mime.split('/')[0]);n.controls=true;n.src=f.url;}
  else if(a.mime==='application/pdf'){n=el('iframe');n.src=f.url;n.title=a.name;n.setAttribute('sandbox','');}
  else n=el('p','hint','此格式可下載後在電腦上開啟。');body.append(n);const link=$('attachment-download');link.href=f.url;link.download=a.name;openDialog('attachment-dialog');
 }catch(e){toast(e.message);}}
 function attachments(list){const box=el('div','attachments');for(const a of list||[]){const card=el('button','attachment-card');card.disabled=!a.available;card.title=a.reason||a.name;const name=el('span','attachment-name',a.name);card.append(name,el('small','',a.available?`${a.mime.split('/').at(-1)}${a.bytes!=null?' · '+Math.ceil(a.bytes/1024)+' KB':''}`:a.reason));card.onclick=()=>preview(a);if(a.available&&a.mime.startsWith('image/')){card.classList.add('image-attachment');const img=el('img');img.alt=a.name;img.loading='lazy';card.prepend(img);fetchFile(a).then(f=>{if(img.isConnected)img.src=f.url;}).catch(()=>{img.remove();card.append(el('small','', '圖片暫時無法載入，請更新對話。'));});}box.append(card);}return box;}
 function fileChanges(row){
  const box=el('section','file-changes');box.setAttribute('aria-label','檔案修改清單');const all=row.changes||[],added=all.reduce((n,c)=>n+(c.added||0),0),removed=all.reduce((n,c)=>n+(c.removed||0),0);const head=el('div','file-changes-header');head.append(el('strong','',(row.status==='failed'?'修改失敗':row.status==='declined'?'未套用':row.status==='inProgress'?'正在修改':'已編輯')+' '+all.length+' 個檔案'),el('span','diff-added','+'+added),el('span','diff-removed','−'+removed),el('small','','展開查看差異'));box.append(head);
  for(const c of all){const d=el('details','file-diff');d.dataset.changePath=c.path;const s=el('summary');s.append(el('span','file-diff-path',c.path),el('span','diff-added',c.added==null?'':'+'+c.added),el('span','diff-removed',c.removed==null?'':'−'+c.removed));d.append(s);if(c.movePath)d.append(el('p','','移至 '+c.movePath));const pre=el('pre');if(c.unavailable)pre.textContent=c.unavailable;else if(!c.diff)pre.textContent='這筆紀錄未提供差異內容。';else for(const line of c.diff.split('\n'))pre.append(el('span',line.startsWith('+')?'diff-line add':line.startsWith('-')?'diff-line remove':'diff-line',line+'\n'));d.append(pre);if(c.truncated)d.append(el('p','hint','差異過長，顯示前 120,000 字。'));box.append(d);}return box;
 }
 function activity(row){if(row.kind==='fileChange')return fileChanges(row);const stage={completed:'完成',running:'執行中',inProgress:'執行中',failed:'失敗',declined:'未允許',pending:'等待中',interrupted:'已停止'}[row.status]||row.status||'';
  if(row.kind==='commentary'){const n=el('div','native-commentary');n.innerHTML=markdown(row.text);return n;}
  if(row.kind==='tool'){
      if(/^[a-z]+(?:_[a-z]+)+$/.test(row.label||''))row={...row,...toolActivity({tool:row.label,status:row.status,id:row.id,durationMs:row.durationMs,exitCode:row.exitCode}),text:row.text===row.label?'':row.text};
      if(['使用工具','呼叫工具'].includes(row.label)&&/^(?:[a-z_]+\.)?[a-z_]+$/.test(row.text||''))row={...row,...toolActivity({tool:row.text,status:row.status,id:row.id,durationMs:row.durationMs,exitCode:row.exitCode})};
      const rawLabel=row.label||'使用工具',done=row.status==='completed';
      const verbs={'執行指令':'已執行','執行程式':'已執行','寫入檔案':'已寫入','讀取檔案':'已讀取','修改檔案':'已修改','移除檔案':'已移除','查看資料夾':'已查看','查詢主機與額度':'已查詢主機與額度','確認 Gemini 額度':'已查詢 Gemini 額度','委派 Gemini':'Gemini 已交回結果','檢查工作':'已檢查工作'};
      const label=done?(verbs[rawLabel]||rawLabel):rawLabel;
      const kind=/Gemini/.test(rawLabel)?'gemini':/指令|程式|工作/.test(rawLabel)?'terminal':/檔案/.test(rawLabel)?'file':/資料夾/.test(rawLabel)?'folder':/瀏覽|網頁|搜尋/.test(rawLabel)?'globe':'status';
      const paths={terminal:'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1M7 8l4 4-4 4m7 0h3',file:'M14 3H5v18h14V8l-5-5v5h5M8 13h8m-8 4h5',folder:'M3 6h7l2 2h9v12H3V6',globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18',status:'M3 4h18v13H3V4m5 17h8m-4-4v4',gemini:'M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10'};
      const mark=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');mark.setAttribute('viewBox','0 0 24 24');mark.setAttribute('aria-hidden','true');mark.setAttribute('class','tool-icon '+kind);path.setAttribute('d',paths[kind]);mark.append(path);

      const n=el('details','native-activity tool-inline'),title=el('summary');n.dataset.activityId=String(row.id||'');
      const line=el('span','tool-line');line.append(el('span','tool-label',label));if(row.text)line.append(el('span','tool-description',' '+row.text));title.append(mark,line);title.title=[label,row.text].filter(Boolean).join(' ');if(stage&&!done)title.append(el('small','activity-stage',stage));n.append(title);
      const parts=[row.text,row.durationMs!=null?'耗時 '+(row.durationMs/1000).toFixed(1)+' 秒':null,row.exitCode!=null?'結束碼 '+row.exitCode:null].filter(Boolean);n.append(el('div','native-summary',parts.join('\n')||'沒有其他詳情'));return n;
    }
    const n=el('details','native-activity'),title=el('summary');n.dataset.activityId=String(row.id||row.label||row.kind);const mark=el('span','activity-mark');mark.setAttribute('aria-hidden','true');title.append(mark,el('span','',row.label||'工作進度'));if(stage)title.append(el('small','activity-stage',stage));n.append(title);if(row.text)n.append(el('div','native-summary',row.text));else if(row.kind==='reasoning')n.append(el('div','native-summary','未提供公開摘要。'));if(row.exitCode!=null)n.append(el('small','native-summary','結束碼 '+row.exitCode));else if(row.durationMs)n.append(el('small','native-summary',`${(row.durationMs/1000).toFixed(1)} 秒`));return n;
 }
 const displayText=m=>m.attachments?.length?visibleText(m.text).replace(/!?\[([^\]\n]*)\]\((?:<([^>]+)>|([^\s)]+))\)/g,(all,label,a,b)=>{let path;try{path=decodeURIComponent(a||b);}catch{return all;}return /^\/?[A-Za-z]:[\\/]/.test(path)?label:all;}):visibleText(m.text);
 return {attachments,activity,displayText,preview};
}
