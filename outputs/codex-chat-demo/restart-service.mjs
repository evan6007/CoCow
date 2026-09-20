import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Started only by the authenticated storage relocation action, with fixed code.
// Wait for the old service to exit before binding the same port.
const parent=Number(process.argv[2]);
if(!Number.isInteger(parent)||parent<=0||!process.send)process.exit(1);
process.send({ready:true});
process.once('message',async message=>{
 if(message!=='restart')process.exit(1);
 for(let i=0;i<200;i++){
  let alive=true;try{process.kill(parent,0);}catch{alive=false;}
  if(!alive){
   const root=dirname(fileURLToPath(import.meta.url)),log=openSync(join(process.env.DEMO_DATA_DIR,'service-restart.log'),'a',0o600);
   const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:process.env,detached:true,windowsHide:true,stdio:['ignore',log,log]});
   child.on('error',()=>process.exit(1));await new Promise(r=>child.once('spawn',r));closeSync(log);child.unref();process.exit(0);
  }
  await new Promise(r=>setTimeout(r,100));
 }
 process.exit(1);
});
setTimeout(()=>process.exit(1),30000).unref();
