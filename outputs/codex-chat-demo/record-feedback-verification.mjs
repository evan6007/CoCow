import {FeedbackStore} from './feedback.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.argv[2];if(!root)throw Error('Explicit records directory required');
const store=new FeedbackStore(root),actor='evan6007@gmail.com';
const evidence='本輪新增7項附件/聊天操作回歸，node --test共69項全通過（exit 0）。測試是隔離fixture，未刪除真實聊天、未呼叫模型、未驗證遠端裝置。';
const pending=new Set(['84093df6-8223-4a69-a2b3-35971e3d42a6','b58ff45b-edf1-4ab1-87f3-ee893c593521']);
const result=[];
for(const report of store.list(actor,true).filter(r=>r.status!=='done')){
 const text=pending.has(report.id)?evidence+' 已確認磁碟含右鍵/選單/拖曳與同名附件按ID讀回修正；/version仍為0.62.21 build109。透過介面點擊立即更新，收到「本機對話1個、配對裝置對話」忙碌拒絕。未強制重啟或中止任何工作，等待所有對話結束後安全套用，再由回報端驗收。':evidence+' 本次僅補回歸紀錄，既有7件待驗收狀態不改，不代替回報者確認完成。';
 writeFileSync(resolve(root,'feedback',report.id+'.before-20260921-verification.bak'),readFileSync(store.path(report.id)),{flag:'wx'});
 const r=store.progress(report.id,actor,{text,...(pending.has(report.id)?{phase:'waiting'}:{})});result.push({id:r.id,status:r.status});
}
console.log(JSON.stringify({updated:result.length,reports:result,tests:{passed:69,failed:0},deployment:'blocked-by-active-conversations'},null,2));
