import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
export async function installOfficialCLI(work,{fetcher=fetch,execute,runtime,onProgress=()=>{}}){
 const history=[];const startedAt=new Date().toISOString();
 const report=(stage,label,percent=null)=>{const updatedAt=new Date().toISOString();history.push({stage,label,at:updatedAt});onProgress({stage,label,percent,startedAt,updatedAt,history:[...history]});};
 try {
  report('downloading','正在取得官方安裝程式');
  const r=await fetcher('https://antigravity.google/cli/install.ps1',{signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('下載失敗');
  const script=await r.text();if(script.length>200000||!script.includes('sha512'))throw Error('安裝內容無法驗證');
  mkdirSync(work,{recursive:true});const path=join(work,'antigravity-install.ps1');writeFileSync(path,script);
  report('installing','正在下載、驗證與安裝 Antigravity CLI');
  await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path,'--skip-path','--skip-aliases'],{timeout:180000});
  report('verifying','正在確認安裝結果');
  const binary=runtime();if(!binary)throw Error('沒有找到官方 CLI');
  await execute(binary,['--version'],{timeout:20000});
  report('done','安裝完成，請登入 Google 帳號',100);
 }catch(e){report('error','安裝未完成，請重試');throw e;}
}
