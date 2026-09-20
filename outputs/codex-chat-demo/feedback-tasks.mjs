import {createHash} from 'node:crypto';
const stableId=value=>{const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export function ensureFeedbackTask({report,chats,taskStore,saveChats,saveReport,cwd,model}){
 const parentId=stableId('cocow-feedback-parent'),childId=stableId('cocow-feedback:'+report.id),now=new Date().toISOString();
 if(!chats.has(parentId))chats.set(parentId,{id:parentId,title:'CoCow 回報巡查與修復',user:'我',model,effort:'high',cwd,messages:[],createdAt:now});
 if(!chats.has(childId))chats.set(childId,{id:childId,title:'回報 #'+report.id.slice(0,6)+' · '+(report.text||'圖片問題').replace(/\s+/g,' ').slice(0,65),user:'我',model,effort:'high',cwd,parentChatId:parentId,feedbackId:report.id,messages:[],createdAt:now});
 if(chats.get(childId).deleted)throw Error('此回報的子任務已刪除，請先還原，避免重複執行');
 saveChats();taskStore.sync(chats);taskStore.link(childId,parentId);report.repairTask={parentTaskId:parentId,taskId:childId,linkedAt:report.repairTask?.linkedAt||now};saveReport(report);
 return {report,task:chats.get(childId),parentTaskId:parentId,prepared:true};
}
