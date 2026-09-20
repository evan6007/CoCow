import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,delimiter,basename} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function discoverPython(){
 const win=process.platform==='win32',home=homedir(),paths=[];
 const addRoot=root=>{if(root)paths.push(join(root,win?'python.exe':'bin/python'));};
 addRoot(process.env.VIRTUAL_ENV);addRoot(process.env.CONDA_PREFIX);
 for(const dir of String(process.env.PATH||'').split(delimiter).filter(Boolean))paths.push(join(dir,win?'python.exe':'python3'));
 if(win){
  const installed=join(process.env.LOCALAPPDATA||join(home,'AppData','Local'),'Programs','Python');
  try{for(const d of readdirSync(installed,{withFileTypes:true}).filter(d=>d.isDirectory()))addRoot(join(installed,d.name));}catch{}
  for(const base of [join(home,'miniconda3'),join(home,'anaconda3'),join(home,'miniforge3'),join(process.env.ProgramData||'C:/ProgramData','miniconda3'),join(process.env.ProgramData||'C:/ProgramData','anaconda3')]){
   addRoot(base);try{for(const d of readdirSync(join(base,'envs'),{withFileTypes:true}).filter(d=>d.isDirectory()))addRoot(join(base,'envs',d.name));}catch{}
  }
  try{for(const line of readFileSync(join(home,'.conda','environments.txt'),'utf8').split(/\r?\n/).filter(Boolean))addRoot(line.trim());}catch{}
  try{const r=await exec('py.exe',['--list-paths'],{windowsHide:true,timeout:7000});for(const line of r.stdout.split(/\r?\n/)){const m=line.match(/([A-Za-z]:\\.*python\.exe)\s*$/i);if(m)paths.push(m[1]);}}catch{}
 }
 const candidates=[...new Set(paths)].filter(p=>existsSync(p)&&!/[\\/]WindowsApps[\\/]python/i.test(p)).slice(0,40);
 const found=[];
 for(let i=0;i<candidates.length;i+=4){
  await Promise.all(candidates.slice(i,i+4).map(async path=>{try{
   const r=await exec(path,['-c','import sys,json,importlib.util; print(json.dumps(dict(executable=sys.executable,version=sys.version.split()[0],prefix=sys.prefix,hasTorch=importlib.util.find_spec("torch") is not None)))'],{windowsHide:true,timeout:8000,maxBuffer:30000});
   const p=JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));if(!p.executable||found.some(x=>x.executable.toLowerCase()===p.executable.toLowerCase()))return;
   found.push({...p,priority:candidates.indexOf(path),id:createHash('sha256').update(p.executable.toLowerCase()).digest('hex').slice(0,16),label:basename(p.prefix)+' · Python '+p.version+(p.hasTorch?' · PyTorch':'')});
  }catch{}}));
 }
 return found.sort((a,b)=>Number(b.hasTorch)-Number(a.hasTorch)||a.priority-b.priority).map(({priority,...p})=>p);
}
