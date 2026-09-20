const names={get_runtime_status:'查詢主機與額度',write_file:'寫入檔案',edit_file:'修改檔案',read_file:'讀取檔案',delete_file:'移除檔案',list_files:'查看資料夾',run_command:'執行指令',start_job:'執行程式',job_status:'檢查工作',stop_job:'停止工作',workspace_guidance:'讀取專案指引',delegate_antigravity:'委派 Gemini',antigravity_status:'確認 Gemini 額度',parallel_review:'平行審查',browser:'操作背景瀏覽器',web_read:'讀取網頁',desktop:'操作桌面',mcp_connector:'呼叫連接器'};
export function safeSummary(s){return String(s||'').replace(/\b(?:ya29\.|sk-|AIza)[\w.\-/]+/g,'[已隱藏]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [已隱藏]').replace(/((?:token|password|passwd|secret|api[_-]?key|cookie|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,'$1[已隱藏]').replace(/(--?(?:token|password|secret|api-key)\s+)\S+/gi,'$1[已隱藏]').replace(/\s+/g,' ').trim().slice(0,240);}
export function toolActivity(item){
 const tool=String(item.tool||item.type).split('.').at(-1);let args=item.arguments||{};if(typeof args==='string'){try{args=JSON.parse(args);}catch{args={};}}
 const label=names[tool]||({commandExecution:'執行指令',webSearch:'搜尋網頁',mcpToolCall:'呼叫工具'}[item.type])||tool;
 // Only a short, redacted description. Never render file contents or raw tool output.
 const detail=args.path||args.file||args.filePath||args.command||args.cmd||args.script||args.query||args.task||args.jobId||item.command||item.query||args.action||'';
 return {id:item.id,kind:'tool',toolName:tool,label,text:safeSummary(detail),provider:/antigravity/.test(tool)?'antigravity':'codex',status:item.status||'inProgress',exitCode:item.exitCode??null,durationMs:item.durationMs??null};
}
