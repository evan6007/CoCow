import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {homedir,hostname} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {privateOrigin} from './peer-gateway.mjs';
export function configureLocal({appRoot,name,dataDirectory,inferenceOrigin='https://e806.tail2e110c.ts.net'}){
 name=String(name||'').trim();if(!name||name.length>80)throw new Error('電腦名稱需為 1–80 字。');
 if(!dataDirectory?.trim())throw new Error('請指定紀錄資料夾。');
 const origin=privateOrigin(inferenceOrigin),data=resolve(dataDirectory.startsWith('~/')?join(homedir(),dataDirectory.slice(2)):dataDirectory);
 const pointer=join(appRoot,'local-data-path.txt'),config=join(data,'instance.json');
 if(existsSync(pointer))throw new Error('這份工作台已設定。請執行 node start-local.mjs；另一台電腦請使用獨立安裝。');
 if(existsSync(config))throw new Error('此資料夾已有工作台設定，沒有覆蓋。請選新資料夾，或使用原安裝啟動。');
 mkdirSync(data,{recursive:true,mode:0o700});
 writeFileSync(config,JSON.stringify({name,inferenceOrigin:origin},null,2),{flag:'wx',mode:0o600});
 writeFileSync(pointer,data,{flag:'wx',mode:0o600});return {name,data,inferenceOrigin:origin};
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('需要 Node.js 22 以上；建議安裝 Node.js 24 LTS。');
 const appRoot=dirname(fileURLToPath(import.meta.url));
 if(existsSync(join(appRoot,'local-data-path.txt')))throw new Error('已完成設定。請執行：node start-local.mjs');
 const origin='https://e806.tail2e110c.ts.net';
 process.stdout.write('工作台 · 本機設定\n正在確認 e806 連線與帳號權限…\n');
 try{const res=await fetch(origin+'/join',{signal:AbortSignal.timeout(15000)});if(!res.ok)throw new Error('denied');}
 catch{throw new Error('無法加入 e806。請先登入 Tailscale、接受機器分享，並確認 Email 已獲分配額度。');}
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{
  const name=await rl.question('電腦名稱 ['+hostname()+']：');
  const defaultData=join(homedir(),'.local','share','workbench');
  const folder=await rl.question('紀錄資料夾 ['+defaultData+']：');
  const result=configureLocal({appRoot,name:name||hostname(),dataDirectory:folder||defaultData,inferenceOrigin:origin});
  process.stdout.write('\n設定完成。紀錄資料夾：'+result.data+'\n下一步執行：node start-local.mjs\n首次啟動後，請擁有者在中控台核准你的裝置。\n');
 }finally{rl.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});

