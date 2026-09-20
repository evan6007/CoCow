import {readFileSync,statSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {validThreadId} from './conversations.mjs';

// Read only the desktop's project layout. Never write its live global-state file.
export function desktopProjectLayout(){
 const home=process.env.CODEX_HOME||join(homedir(),'.codex');
 try{
  const state=JSON.parse(readFileSync(join(home,'.codex-global-state.json'),'utf8'));
  const key='local:'+home,map=state['app-server-project-id-by-legacy-project-id-by-host']?.[key]||{};
  const assignments=Object.fromEntries(Object.entries(state['thread-project-assignments']||{}).filter(([,v])=>v?.projectKind==='local'&&map[v.projectId]).map(([id,v])=>[id,map[v.projectId]]));
  return {assignments,migrationComplete:state['app-server-projects-migration-by-host']?.[key]?.threadAssignmentsMigrated===true,available:true};
 }catch{return {assignments:{},migrationComplete:false,available:false};}
}
export async function projects(bridge){
 const data=[];let cursor;
 do{const r=await bridge.rpc('project/list',{limit:100,...(cursor?{cursor}:{})});data.push(...r.data.map(p=>({id:p.id,name:p.name,roots:p.roots,position:p.position})));cursor=r.nextCursor;}while(cursor&&data.length<1000);
 const layout=desktopProjectLayout();
 return {data,desktopLayoutAvailable:layout.available,desktopAssignmentsMigrated:layout.migrationComplete,
  syncNote:layout.migrationComplete?'使用 Codex 服務端專案資料；桌面呈現仍以實際更新為準。':'此版官方桌面仍保留舊專案分類。移動會保存到 Codex 服務端；目前不能保證桌面立即更新。'};
}
export async function projectForChat(bridge,id){
 if(!validThreadId(id))throw new Error('專案識別碼不正確。');
 const {project}=await bridge.rpc('project/read',{projectId:id});
 const cwd=project.roots?.[0]?.path;
 if(!cwd||!isAbsolute(cwd))throw new Error('這個專案沒有可用的工作資料夾。');
 try{if(!statSync(cwd).isDirectory())throw new Error();}catch{throw new Error('專案資料夾不在目前主機，請先切換到正確的電腦。');}
 return{id:project.id,name:project.name,cwd};
}
export async function moveConversation(bridge,id,projectId){
 if(!validThreadId(id))throw new Error('對話識別碼不正確。');
 if(projectId!==null){if(!validThreadId(projectId))throw new Error('專案識別碼不正確。');await bridge.rpc('project/read',{projectId});}
 const result=await bridge.rpc('thread/metadata/update',{threadId:id,projectId:projectId||''});
 if((result.thread.projectId||null)!==projectId)throw new Error('服務回傳的專案與目的地不同。');
 const layout=desktopProjectLayout(),desktopProjectId=layout.assignments[id]||null;
 return {projectId,desktopProjectId,serverSaved:true,desktopMatched:layout.available&&desktopProjectId===projectId,
  message:layout.available&&desktopProjectId===projectId?'已保存；桌面分類與目標一致。':'已保存到 Codex 服務端；官方桌面分類尚未確認同步。'};
}
export async function organizeProject(bridge,data){
 if(!validThreadId(data.id))throw new Error('專案識別碼不正確。');
 const existing=(await projects(bridge)).data;if(!existing.some(p=>p.id===data.id))throw new Error('找不到專案。');
 if(data.action==='rename'){
  if(typeof data.name!=='string'||!data.name.trim()||data.name.length>100)throw new Error('請輸入 1–100 字的專案名稱。');
  await bridge.rpc('project/update',{projectId:data.id,name:data.name.trim()});
 }else if(data.action==='move'){
  if(data.beforeId!==null&&!existing.some(p=>p.id===data.beforeId))throw new Error('找不到目的地專案。');
  if(data.beforeId===data.id)throw new Error('不能移到自己前面。');
  await bridge.rpc('project/move',{projectId:data.id,beforeProjectId:data.beforeId});
 }else throw new Error('不支援的專案操作。');
 return {serverSaved:true,message:'已保存到 Codex 服務端；此版官方桌面呈現尚未確認同步。',...await projects(bridge)};
}
