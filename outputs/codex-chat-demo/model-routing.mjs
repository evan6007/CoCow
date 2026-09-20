export const effortOrder=['none','minimal','low','medium','high','xhigh','max','ultra'];
export const autoReviewId='cocow-auto-review';
export function shouldAutoReview(text=''){return /寫程式|程式碼|程式|改檔|修改檔案|建立檔案|建立專案|重構|除錯|debug|implement|implementation|refactor|code review|修復.*bug|測試.*程式|執行.*測試|Luna.*Astra|Astra.*審核|自動分工/i.test(text);}
export function catalog(raw){const available=raw.filter(m=>['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol','gpt-6-astra'].includes(m.model)).map(m=>({id:m.model,name:m.displayName,serviceTiers:m.serviceTiers||[],efforts:(m.supportedReasoningEfforts||[]).map(e=>e.reasoningEffort),defaultEffort:m.defaultReasoningEffort||'low'}));const auto=[{id:'auto',name:'自動選擇',efforts:effortOrder.filter(e=>available.some(m=>m.efforts.includes(e))),defaultEffort:'low'}];const luna=available.find(m=>m.id==='gpt-5.6-luna'),astra=available.find(m=>m.id==='gpt-6-astra');if(luna?.efforts.includes('max')&&astra?.efforts.includes('max'))auto.push({id:autoReviewId,name:'CoCow 自動分工 · Luna → Astra',efforts:['max'],defaultEffort:'max',strategy:'luna-max-then-astra-max'});return [...auto,...available];}
export function chooseModel(models,requested,text,effort='low'){
 if(requested===autoReviewId){const strategy=models.find(m=>m.id===autoReviewId),luna=models.find(m=>m.id==='gpt-5.6-luna');if(!strategy?.efforts.includes(effort)||!luna?.efforts.includes(effort))throw new Error('目前無法啟用 CoCow 自動分工：Luna 與 Astra 都必須支援所選思考程度。');return luna.id;}
 if(requested!=='auto'){const m=models.find(m=>m.id===requested);if(!m?.efforts.includes(effort))throw new Error('此模型不支援所選思考程度。');return m.id;}
 const preferred=text.length>600||/分析|規劃|比較|程式|論文|推導|設計|架構/.test(text)?'gpt-5.6-sol':'gpt-5.6-luna';
 const candidates=models.filter(m=>m.id!=='auto'&&m.efforts.includes(effort));const selected=candidates.find(m=>m.id===preferred)||candidates.find(m=>m.id==='gpt-5.6-sol')||candidates[0];
 if(!selected)throw new Error('目前可用模型不支援所選思考程度。');return selected.id;
}
