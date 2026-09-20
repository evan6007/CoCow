import {toolActivity} from './tool-activity.mjs';
export function createTurnInsights({el,container}){
 const panel=el('section','turn-insights'),heading=el('h3','','本輪工作'),current=el('div','insights-provider'),plan=el('div','insights-plan'),usage=el('div','insights-usage'),delegates=el('div','insights-delegates');
 panel.append(heading,current,plan,usage,delegates);const overview=container.querySelector?.('#inspector-overview');if(overview)overview.after(panel);else container.append(panel);let data={};
 const count=u=>Number.isFinite(u?.totalTokens)?u.totalTokens.toLocaleString('zh-TW')+' Tokens':'未回報';
 function update(change={}){data={...data,...change};panel.hidden=!data.model&&!data.usage&&!data.workflow?.length&&!data.delegations?.length;
  const gemini=data.provider==='antigravity'||data.delegations?.some(d=>d.state==='running'),mark=el('span','provider-mark '+(gemini?'gemini':'codex'),gemini?'✦':'⌘');current.replaceChildren(mark,el('strong','',gemini?'Gemini':'Codex'),el('span','muted',gemini?(data.delegations?.at(-1)?.model||(data.model?.includes('gemini')?data.model:'')):(data.model||'')));
  plan.replaceChildren();if(data.plan?.length){for(const p of data.plan){const row=el('div','insight-step');row.append(el('span','',p.status==='completed'?'✓':p.status==='inProgress'?'●':'○'),el('span','',p.step));plan.append(row);}}
  else{let last=data.workflow?.filter(r=>r.kind==='tool'||r.kind==='plan').at(-1);if(last?.kind==='tool'&&/^[a-z]+(?:_[a-z]+)+$/.test(last.label||''))last={...last,...toolActivity({tool:last.label}),text:last.text===last.label?'':last.text};plan.append(el('p','hint',last?[last.label,last.text].filter(Boolean).join(' · '):'尚未提供工作計畫'));}
  usage.replaceChildren();const main=el('div','overview-row');main.append(el('span','',data.mainProvider==='antigravity'?'Gemini 本輪':'Codex 本輪'),el('strong','',count(data.usage)));main.title='官方回報 Tokens，含快取；Codex 數字含其子代理，不等於訂閱扣額。';usage.append(main);
  const tasks=data.delegations||[],known=tasks.filter(d=>Number.isFinite(d.usage?.totalTokens));if(tasks.length){const sum=known.reduce((n,d)=>n+d.usage.totalTokens,0),row=el('div','overview-row');row.append(el('span','','Gemini 委派'),el('strong','',known.length?sum.toLocaleString('zh-TW')+' Tokens'+(known.length<tasks.length?'＋未回報':''):'未回報'));usage.append(row);}
  delegates.replaceChildren();for(const [i,d] of tasks.entries()){const item=el('div','delegation-card'),top=el('div','overview-row');top.append(el('span','','✦ Gemini '+(i+1)),el('strong','',count(d.usage)));item.append(top,el('p','delegation-task',d.task||'委派工作'),el('small','muted',({running:'處理中',completed:'已完成',failed:'未完成'}[d.state]||'已記錄')+(d.durationMs?' · '+Math.round(d.durationMs/1000)+' 秒':'')));item.title=d.model||'Gemini';delegates.append(item);}
 }
 function reset(value={}){data={mainProvider:value.provider||'codex'};update(value);}reset();return {update,reset};
}
