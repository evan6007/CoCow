import {readFileSync,existsSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const appRoot=dirname(fileURLToPath(import.meta.url));
try{
 const pointer=join(appRoot,'local-data-path.txt');
 if(!existsSync(pointer))throw new Error('請先執行：node setup-local.mjs');
 const data=readFileSync(pointer,'utf8').trim();
 if(!isAbsolute(data)||!existsSync(join(data,'instance.json')))throw new Error('紀錄資料夾設定失效，請確認資料夾未被搬動。');
 const config=JSON.parse(readFileSync(join(data,'instance.json'),'utf8'));
 if(!config.inferenceOrigin)throw new Error('此啟動器僅供共用額度的本機服務。');
 process.env.DEMO_DATA_DIR=data;
 console.log('紀錄資料夾：'+data+'\n啟動中；看到網址後再開啟瀏覽器。保持此終端機開啟，Ctrl+C 可停止。');
 await import('./server.mjs');
}catch(e){console.error(e.message);process.exitCode=1;}

