import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {homedir,hostname} from 'node:os';

// Local metadata only. No authentication file, gateway RPC, or live database writes.
export async function localCodexProjects(home=process.env.CODEX_HOME||join(homedir(),'.codex')){
 let state={},source=null,error=null;
 try{state=JSON.parse(readFileSync(join(home,'.codex-global-state.json'),'utf8'));source='desktop-state';}catch(e){if(e.code!=='ENOENT')error='本機 Codex 專案設定暫時無法讀取。';}
 const map=state['app-server-project-id-by-legacy-project-id-by-host']?.['local:'+home]||{};
 const rows=new Map(),assignments={};
 for(const [key,p]of Object.entries(state['local-projects']||{})){
  if(!p||typeof p.name!=='string'||!Array.isArray(p.rootPaths))continue;
  const roots=p.rootPaths.filter(p=>typeof p==='string'&&isAbsolute(p)).map(path=>({path}));if(!roots.length)continue;
  const id=map[key]||p.id||key;rows.set(id,{id,name:p.name,roots,position:Math.max(0,(state['project-order']||[]).indexOf(key))});
 }
 let db;
 try{
  const file=readdirSync(home).filter(f=>/^state_\d+\.sqlite$/.test(f)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]))[0];
  if(file){const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(join(home,file),{readOnly:true});
   const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
   if(tables.has('projects')&&tables.has('project_roots')){
    for(const p of db.prepare('SELECT id,name,position FROM projects ORDER BY position LIMIT 1000').all()){
     const roots=db.prepare('SELECT path FROM project_roots WHERE project_id=? ORDER BY position').all(p.id).filter(r=>isAbsolute(r.path));
     rows.set(p.id,{...p,roots});
    }source='local-state-database';
   }
   if(tables.has('threads')&&db.prepare('PRAGMA table_info(threads)').all().some(c=>c.name==='project_id'))for(const t of db.prepare('SELECT id,project_id FROM threads WHERE project_id IS NOT NULL LIMIT 100000').all())if(rows.has(t.project_id))assignments[t.id]=t.project_id;
  }
 }catch(e){if(e.code!=='ENOENT'&&!source)error='本機 Codex 專案資料庫暫時無法讀取。';}finally{db?.close();}
 for(const [id,v]of Object.entries(state['thread-project-assignments']||{})){const p=map[v?.projectId]||v?.projectId;if(!assignments[id]&&v?.projectKind==='local'&&rows.has(p))assignments[id]=p;}
 return {data:[...rows.values()].sort((a,b)=>a.position-b.position),assignments,readOnly:true,source,host:hostname(),capturedAt:new Date().toISOString(),unavailableReason:source?null:error||'這台電腦尚未找到 Codex 專案。',syncNote:'讀取這台電腦的 Codex 專案；模型額度仍使用原先選定的主機。'};
}
export function attachLocalProjects(result,catalog){
 const normalized=p=>{const value=p.replaceAll('\\','/').replace(/\/+$/,'');return /^[a-z]:/i.test(value)?value.toLowerCase():value;};
 return {...result,host:catalog.host,data:result.data.map(t=>{
  const cwd=normalized(t.cwd||''),rootProject=catalog.data.map(p=>({p,score:Math.max(-1,...p.roots.map(r=>{const root=normalized(r.path);return root&&(cwd===root||cwd.startsWith(root+'/'))?root.length:-1;}))})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score)[0]?.p;
  return {...t,projectId:Object.hasOwn(t,'projectId')?t.projectId:catalog.assignments[t.id]||rootProject?.id||null,displayProjectId:Object.hasOwn(t,'displayProjectId')?t.displayProjectId:catalog.assignments[t.id]||rootProject?.id||null};
 })};
}
