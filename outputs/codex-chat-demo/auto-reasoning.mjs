// Escalation is based on completed local jobs, never the model's self-assessment.
export class AutoReasoning {
  constructor(selection, supported = []) {
    this.enabled = selection === 'auto';
    this.levels = ['low', 'medium', 'high'].filter(v => supported.includes(v));
    if (this.enabled && this.levels[0] !== 'low') throw Error('此模型不支援自動推理所需的輕度。');
    this.index = 0;
    this.effort = this.enabled ? this.levels[0] : selection;
    this.jobs = new Set();
    this.observed = new Set();
    this.failures = 0;
    this.events = [];
  }
  observe(tool, args, result) {
    if (!this.enabled || !result) return;
    if (['start_job', 'run_command'].includes(tool) && result.id) this.jobs.add(result.id);
    if (tool !== 'job_status' || !this.jobs.has(result.id) || this.observed.has(result.id)) return;
    if (!['completed', 'failed', 'stopped'].includes(result.state)) return;
    this.observed.add(result.id);
    if (result.state === 'stopped') { this.failures = 0; return; }
    if (!Number.isInteger(result.exitCode)) return;
    this.failures = result.exitCode === 0 ? 0 : this.failures + 1;
  }
  next({ stopped = false, error = false, activeJobs = 0 } = {}) {
    if (!this.enabled || stopped || error || activeJobs || this.failures < 2 || this.index >= this.levels.length - 1) return null;
    const from = this.effort;
    this.effort = this.levels[++this.index];
    const event = { from, to: this.effort, reason: `連續 ${this.failures} 個程式工作回傳非零結束碼`, attempt: this.index + 1 };
    this.events.push(event);
    this.failures = 0;
    this.jobs.clear();
    return event;
  }
}
export const autoReasoningInstruction = '\n[COCOW_AUTO_REASONING]目前使用輕度推理。後端只在本輪建立且已查詢的程式工作連續兩次回傳非零結束碼時，於回合結束後提高推理強度，最高到高，最多追加兩輪。不要刻意製造失敗、重複執行失敗指令或用失敗作為升級請求。先查證，改變沒有進展的排查方向；尊重停止、權限與額度。[/COCOW_AUTO_REASONING]';
export function escalationInput(event) {
  return `[COCOW_AUTO_REASONING]後端觀察到${event.reason}，推理強度由 ${event.from} 提升為 ${event.to}（第 ${event.attempt}/3 輪）。繼續處理使用者原本的工作，先檢查失敗是否為預期結果或已修復；若是則直接結束。不必重做已完成的操作，尤其不要重送訊息、部署、安裝或刪除。需要再驗證時先提出不同且有證據的排查方向。權限與工作範圍完全不變，不可繞過拒絕或向使用者要求擴權。未能解決就如實說明。[/COCOW_AUTO_REASONING]`;
}
