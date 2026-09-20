import {accountKey} from './account-budgets.mjs';
export function memberAccess(headers,origin,gateway,budgets){
 if(!gateway)throw new Error('請開啟額度主機的邀請頁。');
 const login=accountKey(gateway.identity(headers,origin)),account=budgets.view(login);
 if(login!==budgets.owner&&(!account.configured||!account.enabled))throw new Error('此 Tailscale 帳號尚未獲准加入工作台。');
 return account;
}
export function renderGuide(html,account=null){
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const identity=account?`${escape(account.login)} · ${account.mode==='percent'?'分配 '+escape(account.percentLimit)+'%':'已獲准使用'}`:'在自己的電腦保存紀錄';
 return html.replace('在自己的電腦保存紀錄',identity);
}
