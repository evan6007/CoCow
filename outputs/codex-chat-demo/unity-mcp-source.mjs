import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveCodex} from './runtime-paths.mjs';
const exec=promisify(execFile);
export async function discoverUnity(cwd){
 const binary=await resolveCodex();if(!binary.available)return {};
 const read=async args=>JSON.parse((await exec(binary.path,['mcp',...args,'--json'],{cwd,windowsHide:true,timeout:10000,maxBuffer:1048576})).stdout);
 const rows=await read(['list']),out={};
 for(const row of rows.filter(r=>/unity/i.test(r.name+' '+JSON.stringify(r.transport?.args||[])+' '+(r.transport?.command||'')))){
  const r=await read(['get',row.name]),t=r.transport;
  if(!['stdio','streamable_http'].includes(t?.type))continue;
  if(t.http_headers_helper)throw Error('Unity MCP 使用動態驗證標頭，請在 CoCow 設定支援的連線驗證。');
  const env={...t.env};for(const k of t.env_vars||[])if(process.env[k]!=null)env[k]=process.env[k];
  const headers={...t.http_headers};for(const [k,v]of Object.entries(t.env_http_headers||{})){if(!process.env[v])throw Error('Unity MCP 缺少驗證環境變數');headers[k]=process.env[v];}
  if(t.bearer_token_env_var){if(!process.env[t.bearer_token_env_var])throw Error('Unity MCP 缺少驗證環境變數');headers.Authorization='Bearer '+process.env[t.bearer_token_env_var];}
  out[r.name]={enabled:r.enabled===true,command:t.command,args:t.args||[],cwd:t.cwd||cwd,env,url:t.url,headers,enabled_tools:r.enabled_tools,disabled_tools:r.disabled_tools,source:'Codex Unity MCP'};
 }
 return out;
}
