import {toolActivity} from './tool-activity.mjs';
import os from 'node:os';
import {visibleText} from './presentation.mjs';
import {fileChangeActivity}from'./file-changes.mjs';
import {AttachmentStore}from'./attachments.mjs';
export const attachmentStore=new AttachmentStore();

export const validThreadId = id => typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export function cleanTranscript(text) {
  return visibleText(text).replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/g, '')
    .replace(/\[COCOW_HANDOFF\][\s\S]*?\[\/COCOW_HANDOFF\]/g,'')
    .replace(/\[CURRENT_BACKEND_RUNTIME_STATUS\][\s\S]*?\[\/CURRENT_BACKEND_RUNTIME_STATUS\]/g,'')
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]').replace(/\bBearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]').trim();
}
export function userText(text){
 let s=cleanTranscript(text);
 if(/^\s*# Files mentioned by the user:/.test(s)&&s.includes('## My request:'))s=s.slice(s.indexOf('## My request:')+14).trim();
 s=s.replace(/^\s*## My request:\s*/,'').replace(/\n\n<uploaded_file name=[^\n]*>\n[\s\S]*?\n<\/uploaded_file>/g,'').trim();
 if(/^<send_user_message_question_reply>/.test(s)){try{const rows=JSON.parse(s.replace(/^<send_user_message_question_reply>\s*/,'').replace(/\s*<\/send_user_message_question_reply>$/,''));return rows.map(r=>r.question?`回覆「${r.question}」：${r.answer}`:String(r.answer||'')).join('\n');}catch{}}
 return s;
}
export function threadSummary(t) {
  return { id:t.id, title:cleanTranscript(t.name || t.preview?.slice(0,80) || '未命名 Codex 對話'), cwd:t.cwd,
    createdAt:new Date(t.createdAt*1000).toISOString(), updatedAt:new Date(t.updatedAt*1000).toISOString(),
    host:os.hostname(), source:'codex', model:t.model || null,projectId:t.projectId||null,section:t.section||null };
}
export function visibleMessages(thread) {
  const messages=[];let order=0;
  for(const turn of thread.turns || []) for(const item of turn.items || []) {
    order++;
    let role,text;
    if(item.type==='userMessage') {
      role='user';text=(item.content || []).filter(c=>c.type==='text' && !/^\s*(<environment_context>|<recommended_plugins>|# AGENTS\.md instructions)/.test(c.text)).map(c=>userText(c.text)).filter(Boolean).join('\n');
    } else if(item.type==='agentMessage' && (!item.phase || item.phase==='final_answer')) {role='assistant';text=cleanTranscript(item.text);}
    const attachments=role?attachmentStore.extract(thread.id,item):[];
    if(text||attachments.length)messages.push({id:item.id,role,text:text||'',order,attachments,turnId:turn.id,at:turn.startedAt?new Date(turn.startedAt*1000).toISOString():null});
  }
  return messages;
}
export function visibleActivities(thread){
 const rows=[];let order=0;
 for(const turn of thread.turns||[])for(const item of turn.items||[]){order++;let row;
  if(item.type==='agentMessage'&&item.phase==='commentary')row={kind:'commentary',text:cleanTranscript(item.text)};
  // Expose only the provider's public summary, never raw reasoning content.
  if(item.type==='reasoning'&&item.summary?.some(s=>s.trim()))row={kind:'reasoning',text:cleanTranscript(item.summary.join('\n')),label:'思考摘要'};
  if(item.type==='contextCompaction')row={kind:'compaction',text:'Codex 已整理上下文',label:'上下文壓縮'};
  if(item.type==='plan')row={kind:'plan',text:cleanTranscript(item.text),label:'工作計畫'};
  const labels={commandExecution:'執行程式',fileChange:'修改檔案',mcpToolCall:'使用工具',dynamicToolCall:'使用工具',webSearch:'搜尋網頁',collabAgentToolCall:'協作工作'};
  if(labels[item.type])row=toolActivity({...item,status:item.status||'completed'});
  if(item.type==='fileChange')row=fileChangeActivity(item);
  if(row&&(row.text||row.label))rows.push({id:item.id,turnId:turn.id,order,...row});
 }
 return rows.slice(-400);
}
export function mergedMessages(chat,fresh) {
  if(chat.externalMessages?.length){
    const base=mergedMessages({...chat,externalMessages:[]},fresh),ids=new Set(base.map(m=>m.id).filter(Boolean));
    return [...base,...chat.externalMessages.filter(m=>!ids.has(m.id))].map((m,i)=>({m,i})).sort((a,b)=>(Date.parse(a.m.at)||0)-(Date.parse(b.m.at)||0)||a.i-b.i).map(x=>x.m);
  }
  if(chat.copiedContext){
    const base=chat.messages.slice(0,chat.copiedContext.messageCount);
    return [...base,...fresh.map((m,i)=>i===0&&m.role==='user'?{...m,text:chat.copiedContext.firstUserText}:m)];
  }
  if(chat.legacyImport)return [...chat.messages.slice(0,chat.legacyImport.messageCount),...fresh.slice(2)];
  return fresh;
}
export async function readConversation(bridge,id) {
  if(!validThreadId(id))throw new Error('對話識別碼不正確。');
  const {thread}=await bridge.rpc('thread/read',{threadId:id,includeTurns:true});
  return {...threadSummary(thread),archived:/[\\/]archived_sessions[\\/]/.test(thread.path||''),messages:visibleMessages(thread),activities:visibleActivities(thread),runtimeStatus:thread.status,lastTurn:thread.turns?.length?{id:thread.turns.at(-1).id,status:thread.turns.at(-1).status,completedAt:thread.turns.at(-1).completedAt}:null,capturedAt:new Date().toISOString(),view:'同步訊息、公開思考摘要、進度與工具狀態；不傳送原始內部推理或工具參數'};
}
export async function listConversations(bridge,{cursor,archived=false,query=''}={}) {
  if(query.length>300 || (cursor && cursor.length>2048))throw new Error('查詢參數過長。');
  const r=await bridge.rpc('thread/list',{limit:50,sortKey:'updated_at',sourceKinds:['cli','vscode','appServer'],archived,useStateDbOnly:true,...(cursor?{cursor}:{}),...(query?{searchTerm:query}:{})});
  return {data:r.data.filter(t=>!t.parentThreadId).map(threadSummary),nextCursor:r.nextCursor,capturedAt:new Date().toISOString(),host:os.hostname()};
}
