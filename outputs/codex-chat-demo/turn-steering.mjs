import {randomUUID} from 'node:crypto';
export async function steerActive(a, data, login, bridge) {
  if(typeof data.text!=='string'||!data.text.trim()||data.text.length>16000)throw Error('請輸入 1–16,000 字的補充。');
  if(!a||a.finishing||a.stopRequested||a.chat?.id!==data.chatId||a.budgetLogin!==login)throw Error('這段回答已結束或不屬於目前帳號；補充仍留在輸入框。');
  if(a.provider==='antigravity')throw Error('Gemini 正在處理；請等這輪完成再送出補充，或先停止。');
  if(!a.turnId||a.advancing)throw Error('回合正在準備，請稍後送出補充。');
  if(a.steering)throw Error('上一則補充正在傳送。');
  a.steering=true;
  try {
    const result=await (a.runBridge||bridge).rpc('turn/steer',{threadId:a.chat.threadId,expectedTurnId:a.turnId,input:[{type:'text',text:data.text.trim(),text_elements:[]}]});
    return {result,message:{id:randomUUID(),role:'user',text:data.text.trim(),at:new Date().toISOString(),steering:true}};
  } finally {a.steering=false;}
}
