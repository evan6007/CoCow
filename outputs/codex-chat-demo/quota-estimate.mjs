// A display-only projection. Official percentage gates remain authoritative.
export function estimateTokens({shared,remainingPercent,usage,now=Date.now()}){
 if(!shared?.available||!Number.isFinite(remainingPercent))return null;
 const percent=Math.max(0,Math.min(remainingPercent,shared.minimumRemainingPercent??shared.remainingPercent));
 if(percent===0)return {tokens:0,usablePercent:0,kind:'exhausted',note:'個人或共用額度已用完。'};
 const end=Date.parse(shared.resetsAt),start=end-shared.windowDurationMins*60000;
 if(!Number.isFinite(start)||shared.windowDurationMins<1440||shared.usedPercent<5)return null;
 const startDay=new Date(start).toISOString().slice(0,10),today=new Date(now).toISOString().slice(0,10);
 // Exclude the reset boundary day, which can contain tokens from the prior cycle,
 // and the current partial day. Never divide lifetime tokens by current usage.
 const days=(usage?.recentDays||[]).filter(d=>d.date>startDay&&d.date<today&&d.date<new Date(end).toISOString().slice(0,10)&&Number.isFinite(d.tokens)&&d.tokens>=0);
 if(days.length<3)return null;
 const latest=days.map(d=>d.date).sort().at(-1);
 if(now-Date.parse(latest+'T00:00:00Z')>3*86400000)return null;
 const recorded=days.reduce((n,d)=>n+d.tokens,0);if(recorded<=0)return null;
 const total=recorded/shared.usedPercent*100;
 return {tokens:Math.floor(total*percent/100),usablePercent:percent,referenceTotal:Math.floor(total),kind:'reported-period-projection',through:latest,days:days.length,
  note:`保守粗估：本週 ${days.length} 個完整日期已回報 ${recorded.toLocaleString('en-US')} Tokens ÷ 已用 ${shared.usedPercent}% × 目前可用 ${percent}%。統計截至 ${latest}，未含重置當日與今天，可能低估；換模型、快取與統計延遲會改變換算。不是官方保證餘額。`};
}
