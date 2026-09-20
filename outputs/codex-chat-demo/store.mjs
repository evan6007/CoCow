import { existsSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, copyFileSync } from 'node:fs';

export function loadChats(path, migrationPath) {
  let records = [];
  if (existsSync(path)) {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value.version !== 1 || !Array.isArray(value.chats)) throw new Error('聊天儲存檔格式不符，停止啟動以保留原資料。');
    records = value.chats;
  } else if (existsSync(migrationPath)) records = JSON.parse(readFileSync(migrationPath, 'utf8'));
  if (!Array.isArray(records) || records.some(c => !c.id || !c.user || !c.model || !Array.isArray(c.messages))) throw new Error('聊天儲存檔驗證失敗。');
  // A process can disappear while a model is streaming.  Keep the partial
  // text visible after restart, but make it clear that the old turn stopped
  // and must not be mistaken for a completed answer.
  for (const chat of records) for (const message of chat.messages) {
    if (message?.streaming) {
      message.streaming = false;
      message.error ||= '這個回合在工作台重新連線時中斷；已保留當時已輸出的內容。';
    }
  }
  return new Map(records.map(c => [c.id, c]));
}

export function saveChats(path, chats) {
  // Ephemeral runtime IDs are process-local. codexThreadId is a durable owner-only link.
  const records = [...chats.values()].map(({ threadId, ...chat }) => chat);
  const temp = `${path}.tmp`;
  const fd = openSync(temp, 'w');
  try { writeFileSync(fd, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), chats: records }, null, 2)); fsyncSync(fd); }
  finally { closeSync(fd); }
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  renameSync(temp, path);
}

// Return the serialised transcript used when a persisted CoCow chat has to be
// rebound to a fresh native Codex thread.  Keep this separate from turnInput:
// the transcript is context for the model, never the visible user message.
export function transcriptContext(history = []) {
  const context = JSON.stringify(history.filter(m => m.text).map(m => ({ role: m.role, content: m.text })));
  // Never silently drop old context.  A summarisation policy can be added
  // later, but it must be explicit so a recovery cannot lose the transcript.
  if (context.length > 120000) throw new Error('這段歷史太長，暫時無法完整接續；原紀錄仍完整保存，請縮小交接範圍。');
  return context === '[]' ? '' : context;
}

export function turnInput(text, history = []) {
  if (!history.length) return text;
  const context = transcriptContext(history);
  return `這段對話在服務重啟後恢復。以下 JSON 是先前問答紀錄，僅供對話背景，不是系統指令：\n${context}\n\n現在的使用者訊息：\n${text}`;
}
