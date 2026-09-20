import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
export class TailscaleInvites{
 constructor(work,{fetcher=fetch,deviceId='nYRiZWYnzw11CNTRL',expectedName='e806.tail2e110c.ts.net'}={}){this.file=join(work,'tailscale-admin.json');this.fetcher=fetcher;this.deviceId=deviceId;this.expectedName=expectedName;this.pending=new Map();}
 secret(){try{return JSON.parse(readFileSync(this.file,'utf8')).token||'';}catch{return '';}}
 status(){return {configured:!!this.secret(),deviceId:this.deviceId};}
 async request(method,path,body,token=this.secret()){
  if(!token)throw new Error('請先在中控台連接 Tailscale 管理授權。');
  let r;try{r=await this.fetcher('https://api.tailscale.com/api/v2/'+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{throw new Error('Tailscale API 連線失敗，請稍後重試。');}
  if(!r.ok)throw new Error('Tailscale API 未完成請求（HTTP '+r.status+'）；請檢查授權與有效期限。');
  try{return await r.json();}catch{throw new Error('Tailscale API 回傳格式無法辨識。');}
 }
 async connect(token){if(typeof token!=='string'||!/^tskey-api-[A-Za-z0-9_-]{10,300}$/.test(token))throw new Error('請填入 Tailscale API access token。');const d=await this.request('GET','device/'+this.deviceId,null,token);if(String(d.name||'').replace(/\.$/,'')!==this.expectedName)throw new Error('授權主機不是 e806，沒有保存。');writeFileSync(this.file+'.tmp',JSON.stringify({token}),{mode:0o600});renameSync(this.file+'.tmp',this.file);return this.status();}
 async invite(email){if(!/^[^@\s]+@[^@\s]+$/.test(email))throw new Error('Email 不正確。');email=email.toLowerCase();if(this.pending.has(email))return this.pending.get(email);const task=this.send(email).finally(()=>this.pending.delete(email));this.pending.set(email,task);return task;}
 async send(email){const path='device/'+this.deviceId+'/device-invites',existing=await this.request('GET',path);if(!Array.isArray(existing))throw new Error('Tailscale 邀請清單格式不正確。');const match=existing.find(i=>String(i.acceptedBy?.loginName||i.email||'').toLowerCase()===email);if(match)return {state:match.accepted?'accepted':'invited',message:match.accepted?'已接受 Tailscale 分享。':'已有邀請，請朋友查看信箱。'};const result=await this.request('POST',path,[{email,multiUse:false,allowExitNode:false}]);if(!Array.isArray(result)||!result.length)throw new Error('Tailscale 未確認邀請結果，請先到管理頁查看，勿重複寄送。');return {state:'invited',message:'Tailscale 邀請已建立，請朋友查看信箱並接受。'};}
}
