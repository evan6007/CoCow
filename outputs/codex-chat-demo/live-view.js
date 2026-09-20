export function createProgressView({el,richContent}) {
  const headline=row=>{if(!row)return '正在思考';if(row.kind==='reasoning')return (row.text||'正在思考').split('\n').find(s=>s.trim())?.replace(/^#+\s*/, '').slice(0,120);const label=row.label||({plan:'規劃工作',contextCompaction:'整理上下文',fileChange:'處理檔案',tool:'使用工具'}[row.kind]||'正在處理');return [label,row.kind==='tool'?row.text:''].filter(Boolean).join(' · ').slice(0,140);};
  const visual=row=>{const raw=[row?.toolName,row?.label,row?.text].filter(Boolean).join(' '),name=raw.toLowerCase();if(row?.kind==='reasoning')return ['reasoning','✦','推理'];if(row?.kind==='plan')return ['plan','☷','規劃'];if(row?.kind==='contextCompaction')return ['context','↻','整理'];if(row?.kind==='fileChange')return ['file','✎','改檔'];if(/gemini|antigravity/i.test(name))return ['gemini','✦','Gemini'];if(/runtime_status|get_runtime_status|額度|狀態/.test(name))return ['status','◉','查狀態'];if(/write_file|edit_file|read_file|delete_file|檔案|file/.test(name))return ['file','✎',/read_file|讀取/.test(name)?'讀檔':/delete_file|移除/.test(name)?'刪檔':/edit_file|修改/.test(name)?'改檔':'寫檔'];if(/run_command|start_job|job_status|stop_job|指令|程式|工作|terminal|command/.test(name))return ['terminal','›_','執行'];if(/資料夾|folder|list_files/.test(name))return ['folder','□','資料夾'];if(/瀏覽|網頁|搜尋|browser|web/.test(name))return ['globe','◎','網頁'];return ['status','•','處理'];};
  return (rows,live=false)=>{
    const box=el('div','turn-progress');box.classList.toggle('is-live',live);
    const steps=rows.filter(r=>r.kind!=='commentary'),last=rows.at(-1),commentary=rows.filter(r=>r.kind==='commentary');
    if(live){const line=el('div','live-headline',last?.kind==='commentary'?'目前：繼續處理中':'目前：'+headline(last));line.setAttribute('role','status');box.append(line);}
    for(const row of commentary)box.append(richContent.activity(row));
    if(steps.length){
      // Keep the complete activity graph in the DOM.  The viewport is the
      // scroll container; this means a user can inspect an earlier node
      // without the next streamed event jumping the view back to the end.
      const map=el('div','workflow-map');map.setAttribute('role','list');map.setAttribute('aria-label',`工作流程，共 ${steps.length} 步，可水平滑動`);
      const graph=el('div','workflow-graph');
       const running=row=>/^(running|inprogress)$/i.test(String(row?.state||row?.status||''));const concurrent=live&&steps.filter(running).length>1;
       const laneKey=row=>String(row?.lane||row?.parallelGroup||(concurrent&&running(row)?'active:'+steps.indexOf(row):row?.parentId?'parent:'+row.parentId:'main')); 
       const laneLabel=(name,index)=>name==='main'?'主線':name==='plan'?'規劃':name.startsWith('active:')?'執行中':`分支 ${index+1}`;
      const laneNames=[...new Set(steps.map(laneKey))];graph.classList.toggle('is-branched',laneNames.length>1);if(laneNames.length>1)graph.append(el('div','workflow-root',concurrent?'多項工作同時執行':'工作分支')); 
      laneNames.forEach((laneName,laneIndex)=>{
        const lane=el('div','workflow-lane');lane.dataset.lane=laneName;
         if(laneNames.length>1)lane.append(el('span','workflow-lane-label',laneLabel(laneName,laneIndex)));
        const track=el('div','workflow-track');
        const laneSteps=steps.filter(row=>laneKey(row)===laneName);
        laneSteps.forEach((row,index)=>{
           const [kind,glyph,label]=visual(row);if(index)track.append(el('span','workflow-connector'));
           const rawState=String(row?.state||row?.status||'').toLowerCase().replace(/[^a-z0-9_-]/g,'');
           const stateClass=rawState?` workflow-state-${rawState}`:'';
           const node=el('div',`workflow-node workflow-${kind}${stateClass}${live&&(running(row)||row===steps.at(-1)&&!steps.some(running))?' current':''}`);node.setAttribute('role','listitem');node.title=headline(row);if(row?.id)node.dataset.nodeId=row.id;if(row?.parentId)node.dataset.parentId=row.parentId;if(rawState)node.dataset.state=rawState;
          const dot=el('span',`workflow-dot workflow-${kind}`,glyph);dot.setAttribute('aria-hidden','true');node.append(dot,el('span','workflow-node-label',kind==='status'&&label==='處理'?(row.label||'處理'):label));track.append(node);
        });
        lane.append(track);graph.append(lane);
      });
      map.append(graph);box.append(map);
      const detail=el('details','workflow-details'),detailSummary=el('summary','',`步驟明細 · ${steps.length}`);detail.append(detailSummary);for(const row of steps)detail.append(richContent.activity(row));box.append(detail);
    }

    return box;
  };
}

export async function readLive(url,headers,signal,onEvent) {
  const response=await fetch(url,{headers,signal});if(!response.ok)throw Error('Live connection unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
  try{while(true){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(line.trim())onEvent(JSON.parse(line));}}}finally{reader.releaseLock();}
}

export function mergeNativeLive(c,event){
  if(event.turnId){
    const incoming=new Set(event.messages.map(m=>m.id)),first=c.messages.findIndex(m=>m.turnId===event.turnId||incoming.has(m.id));
    const base=first<0?c.messages:c.messages.slice(0,first),oldTurn=first<0?null:c.messages[first]?.turnId;
    const activities=(c.activities||[]).filter(a=>a.turnId!==event.turnId&&(!oldTurn||a.turnId!==oldTurn));
    const offset=Math.max(0,...base.map(m=>m.order||0),...activities.map(a=>a.order||0));
    c.messages=[...base,...event.messages.map(m=>({...m,order:offset+m.order}))];
    c.activities=[...activities,...event.activities.map(a=>({...a,order:offset+a.order}))];
  }
  c.liveWorking=event.working;c.liveTurnId=event.turnId;c.capturedAt=event.capturedAt;
}
