import {redact,secretPath} from './attachments.mjs';
export function fileChangeActivity(item){
 if(item.type!=='fileChange')return null;
 const changes=(item.changes||[]).slice(0,100).map(c=>{
  if(secretPath(c.path||''))return {path:'受保護的設定或憑證檔',kind:c.kind?.type,unavailable:'此檔內容不透過網頁顯示。',added:null,removed:null};
  let raw=String(c.diff||'');
  // Native additions/deletions contain file content, whereas updates contain unified diffs.
  if(raw&&['add','delete'].includes(c.kind?.type)){const prefix=c.kind.type==='add'?'+':'-';raw=raw.replace(/\n$/,'').split('\n').map(l=>prefix+l).join('\n');}
  const lines=raw.split('\n'),diff=redact(raw.slice(0,120000));
  return {path:String(c.path||'未命名檔案'),kind:c.kind?.type||'update',movePath:c.kind?.move_path||null,diff,truncated:raw.length>120000,added:c.kind?.type==='add'?(raw?lines.length:0):lines.filter(l=>l.startsWith('+')&&!l.startsWith('+++')).length,removed:c.kind?.type==='delete'?(raw?lines.length:0):lines.filter(l=>l.startsWith('-')&&!l.startsWith('---')).length};
 });
 return {id:item.id,kind:'fileChange',label:'修改檔案',status:item.status||'completed',changes};
}
