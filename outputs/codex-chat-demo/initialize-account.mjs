import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CodexBridge } from './bridge.mjs';
const work=resolve(process.env.DEMO_DATA_DIR||'data');mkdirSync(work,{recursive:true});
if(existsSync(join(work,'expected-account.json')))throw new Error('Existing account baseline is preserved.');
const b=await new CodexBridge(join(work,'sandbox')).start();
try{const a=await b.rpc('account/read',{refreshToken:false}),r=await b.rpc('account/rateLimits/read');if(a.account?.type!=='chatgpt'||!r.accountId)throw new Error('A verifiable ChatGPT account is required. API mode is not allowed.');
writeFileSync(join(work,'expected-account.json'),JSON.stringify({accountId:r.accountId,email:a.account.email,verifiedAgainst:'Local Codex account/read and account/rateLimits/read',verifiedAt:new Date().toISOString()},null,2));
console.log('Verified local account: '+(a.account.email||'email unavailable'));}finally{b.close();}
