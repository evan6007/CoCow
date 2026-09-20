export function createComposerAttachments({$,el,headers,toast,draftKey,pref,changed,canUpload,preview}){
 const drafts=new Map(),pending=new Map();
 const failures=key=>{try{return JSON.parse(pref.get(key+'.attachment-errors','[]'));}catch{return [];}};
 function saveErrors(key,errors){pref.set(key+'.attachment-errors',JSON.stringify(errors));}
 function list(key=draftKey()){if(!drafts.has(key)){try{drafts.set(key,JSON.parse(pref.get(key+'.attachments','[]')));}catch{drafts.set(key,[]);}}return drafts.get(key);}
 function persist(key){pref.set(key+'.attachments',JSON.stringify(list(key)));}
 function render(){const key=draftKey(),box=$('composer-attachments');box.replaceChildren();for(const a of list(key)){
  const card=el('div','draft-attachment');if(a.mime.startsWith('image/')){const img=el('img');img.alt=a.name;card.append(img);fetch('/api/attachment?id='+encodeURIComponent(a.id),{headers}).then(r=>{if(!r.ok)throw Error();return r.blob();}).then(b=>{if(!img.isConnected)return;const url=URL.createObjectURL(b);img.src=url;img.onload=()=>URL.revokeObjectURL(url);}).catch(()=>{});}
  const info=el('div');const name=el('button','draft-file-name',a.name);name.type='button';name.title='預覽 '+a.name;name.onclick=()=>preview?.(a);info.append(name,el('small',a.modelReady?'':'error-text',a.modelReady?`${Math.ceil(a.bytes/1024)} KB · 已準備好`:a.reason));const remove=el('button','icon-button','×');remove.type='button';remove.setAttribute('aria-label','移除附件 '+a.name);remove.onclick=()=>{drafts.set(key,list(key).filter(x=>x.id!==a.id));persist(key);render();changed();};card.append(info,remove);box.append(card);
 }const errors=failures(key);if(errors.length){const warning=el('div','upload-error');warning.setAttribute('role','alert');warning.append(el('p','','部分附件未加入，送出已暫停：'+errors.join('；')));const acknowledge=el('button','button','確認只送出已成功加入的 '+list(key).length+' 個附件');acknowledge.type='button';acknowledge.onclick=()=>{saveErrors(key,[]);render();changed();};warning.append(acknowledge);box.append(warning);}if(pending.get(key))box.append(el('div','upload-pending','正在上傳附件…'));box.hidden=!box.childNodes.length;}
 async function add(files){if(!canUpload()){toast('請先選擇儲存主機，並等目前送出完成。');return;}const key=draftKey();pending.set(key,(pending.get(key)||0)+1);render();changed();try{
  for(const f of files){if(list(key).length>=8)throw Error('每則訊息最多 8 個附件。');if(!f.size||f.size>20*1024*1024)throw Error(f.name+'：單檔上限 20 MB。');if(list(key).reduce((n,a)=>n+a.bytes,0)+f.size>20*1024*1024)throw Error('附件合計上限 20 MB。');
   const r=await fetch('/api/uploads?name='+encodeURIComponent(f.name||'貼上的圖片.png'),{method:'POST',headers:{'X-Demo-Token':headers['X-Demo-Token'],'Content-Type':'application/octet-stream'},body:f});const a=await r.json();if(!r.ok)throw Error(a.error||'附件上傳失敗');list(key).push(a);persist(key);if(key===draftKey())render();
  }
 }catch(e){saveErrors(key,[...failures(key),e.message+'（本批次後續檔案未上傳，請重新加入）']);toast(e.message);}finally{pending.set(key,Math.max(0,(pending.get(key)||1)-1));if(key===draftKey())render();changed();}}
 $('attachment-input').onchange=e=>{add([...e.target.files]);e.target.value='';};
 $('composer-memory').onclick=()=>$('attachment-input').click();
 $('prompt').addEventListener('paste',e=>{const d=e.clipboardData;if(!d)return;const files=[...d.files];if(!files.length)for(const i of d.items||[])if(i.kind==='file'){const f=i.getAsFile();if(f)files.push(f);}if(files.length){e.preventDefault();const text=d.getData('text/plain');if(text){$('prompt').setRangeText(text,$('prompt').selectionStart,$('prompt').selectionEnd,'end');$('prompt').dispatchEvent(new Event('input'));}add(files);}else if(!d.getData('text/plain')&&d.getData('text/html')){e.preventDefault();const doc=new DOMParser().parseFromString(d.getData('text/html'),'text/html');doc.querySelectorAll('script,style').forEach(n=>n.remove());$('prompt').setRangeText(doc.body.textContent||'',$('prompt').selectionStart,$('prompt').selectionEnd,'end');$('prompt').dispatchEvent(new Event('input'));}});
 const composer=$('composer');let depth=0;
 composer.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();depth++;composer.classList.add('drop-active');}});
 composer.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
 composer.addEventListener('dragleave',()=>{if(--depth<=0)composer.classList.remove('drop-active');});
 composer.addEventListener('drop',e=>{depth=0;composer.classList.remove('drop-active');if(e.dataTransfer.files.length){e.preventDefault();add([...e.dataTransfer.files]);}});
 return {render,list,sending:()=>!!pending.get(draftKey()),invalid:()=>failures(draftKey()).length>0||list().some(a=>!a.modelReady),remove(ids,key=draftKey()){drafts.set(key,list(key).filter(a=>!ids.includes(a.id)));persist(key);if(key===draftKey())render();}};
}
