import {randomUUID} from 'node:crypto';

// Keep the source link separate from a native thread: relay turns must never
// resume a source ID on the quota host or overwrite the local Codex transcript.
export function sharedHistoryChat(source, model) {
  if (!source?.id || !Array.isArray(source.messages)) throw new Error('無法讀取原對話，尚未建立接續紀錄。');
  return {
    id: randomUUID(), sourceCodexThreadId: source.id, user: '我', model,
    title: source.title || '接續 Codex 對話',
    createdAt: source.createdAt || new Date().toISOString(),
    messages: structuredClone(source.messages),
    projectId: source.projectId || null, cwd: source.cwd,
    continuationMode: 'shared-history'
  };
}
