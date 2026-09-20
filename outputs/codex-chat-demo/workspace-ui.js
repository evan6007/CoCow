export function createWorkspaceUI({$,el,api,openDialog,saveDraft,isBusy,onStorage}){
 const header=document.querySelector('.top-actions'),account=el('button','account-button','帳號');account.id='account-open';account.type='button';header.prepend(account);
 const dialog=el('dialog','workspace-switch-dialog');dialog.id='workspace-switch-dialog';
 const head=el('div','dialog-header');head.append(el('h2','','工作空間'));const close=el('button','icon-button','×');close.ariaLabel='關閉工作空間';close.onclick=()=>dialog.close();head.append(close);
 const content=el('div','workspace-switch-content'),identity=el('p','workspace-identity'),list=el('div','workspace-targets'),note=el('p','hint');note.textContent='聊天、專案與程式都在選定的電腦。';
 const detail=el('button','text-button','紀錄位置與更多設定');detail.onclick=()=>{dialog.close();openDialog('devices-dialog');};content.append(identity,list,note,detail);dialog.append(head,content);document.body.append(dialog);
 const ad=el('dialog','workspace-switch-dialog');ad.id='account-dialog';const ah=el('div','dialog-header');ah.append(el('h2','','登入帳號'));const ac=el('button','icon-button','×');ac.ariaLabel='關閉帳號';ac.onclick=()=>ad.close();ah.append(ac);const ab=el('div','workspace-switch-content'),email=el('strong','account-email'),method=el('p','hint'),help=el('p','hint');help.textContent='帳號由 Tailscale 驗證。要換帳號：在這台電腦的 Tailscale 選擇帳號 → 切換，再重新開啟工作主機。只登入 Gmail 網頁不會切換 CoCow 身分。';ab.append(email,method,help);ad.append(ah,ab);document.body.append(ad);
 let data;
 function apply(s){data=s;const a=s.account;account.textContent=a.login||a.label;account.title='登入帳號：'+a.label;email.textContent=a.label;method.textContent=a.method+(a.verified?'':' · 目前無法重新核對');identity.textContent=a.label;list.replaceChildren();
  const rows=[{name:s.current.name,origin:location.origin,current:true},...(!s.current.isBrowserLocal?[{name:'這台電腦',origin:'http://127.0.0.1:9142',local:true}]:[]),...s.targets];const seen=new Set();
  for(const t of rows){if(!t.origin||seen.has(t.origin))continue;seen.add(t.origin);const b=el('button','workspace-target');b.type='button';b.classList.toggle('selected',!!t.current);const text=el('span');text.append(el('strong','',t.name),el('small','',t.current?'目前工作主機':t.ownerOnly&&!t.available?'需以 '+(t.ownerLogin||'主機擁有者')+' 登入':t.local?'開啟本機 CoCow':'檔案與程式在 '+t.name));b.append(text,el('span','',t.current?'✓':'›'));b.onclick=()=>{if(t.current){dialog.close();return;}if(isBusy()){note.textContent='請等目前回答完成再切換。';return;}if(t.ownerOnly&&!t.available){dialog.close();openDialog('account-dialog');return;}const u=new URL(t.origin);if(!(u.protocol==='https:'&&u.hostname.endsWith('.ts.net')||u.protocol==='http:'&&u.hostname==='127.0.0.1')||u.username||u.password)return;saveDraft();location.assign(u.origin+'/');};list.append(b);}
 }
 async function refresh(){try{apply(await api('/api/storage'));onStorage?.(data);}catch(e){note.textContent=e.message;}}
 async function show(){openDialog(dialog.id);if(!data)note.textContent='正在讀取工作主機…';await refresh();note.textContent='聊天、專案與程式都在選定的電腦。';}
 account.onclick=()=>{openDialog(ad.id);refresh();};$('host-open').onclick=show;$('top-host').onclick=show;$('devices-open').onclick=show;
 $('host-open').title='切換工作空間';$('devices-open').title='切換工作空間';
 return {apply,refresh};
}
