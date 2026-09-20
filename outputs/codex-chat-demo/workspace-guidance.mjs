import {existsSync,lstatSync,readdirSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
const inside=(root,file)=>{const r=relative(realpathSync(root),realpathSync(file));return !r.startsWith('..')&&!isAbsolute(r);};
export function workspaceGuidance(workspace,{scope='list',id=null}={}){
 const roots=[['project',join(workspace,'.agents','skills')],['user',join(homedir(),'.agents','skills')],['codex-user',join(homedir(),'.codex','skills')]];
 const skills=[];
 for(const [origin,root] of roots){if(!existsSync(root))continue;for(const d of readdirSync(root,{withFileTypes:true})){if(!d.isDirectory()||d.isSymbolicLink()||d.name.startsWith('.'))continue;const file=join(root,d.name,'SKILL.md');if(existsSync(file)&&!lstatSync(file).isSymbolicLink()&&inside(root,file)&&lstatSync(file).size<=64000)skills.push({id:origin+':'+d.name,name:d.name,origin,file});}}
 if(scope==='skill'){const skill=skills.find(s=>s.id===id);if(!skill)throw new Error('找不到此 Skill。');return {id:skill.id,text:readFileSync(skill.file,'utf8'),notice:'Skill 不會擴大授權；只能使用本回合提供的工具。'};}
 const file=resolve(workspace,'AGENTS.md');const instructions=existsSync(file)&&!lstatSync(file).isSymbolicLink()&&inside(workspace,file)&&lstatSync(file).size<=64000?readFileSync(file,'utf8'):null;
 return {skills:skills.map(({file,...s})=>s),instructions,capability:'讀取 Skill 與工作區 AGENTS.md；執行仍受工作區工具及沙箱限制。'};
}
