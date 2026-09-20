import os from 'node:os';
import { statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import {localRequestEvidence} from './usage.mjs';

const fileBytes = path => { try { return statSync(path).size; } catch { return 0; } };
export function hostMetrics(work, history, chats) {
  let disk = null;
  try { const s = statfsSync(work); disk = { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) }; } catch {}
  const files = { chats: fileBytes(join(work, 'chat-store.json')), index: fileBytes(join(work, 'codex-history-index.json')), audit: fileBytes(join(work, 'audit.jsonl')), backup: fileBytes(join(work, 'chat-store.json.bak')) };
  const records = [...chats.values()];
  const replies = records.flatMap(c => c.messages).filter(m => m.role === 'assistant');
  return {
    host: { name: os.hostname(), platform: os.platform() === 'win32' ? 'Windows' : os.platform(), arch: os.arch(), logicalCores: os.cpus().length, uptimeSeconds: os.uptime(), serviceUptimeSeconds: Math.floor(process.uptime()), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), processMemoryBytes: process.memoryUsage().rss, disk },
    storage: { files, revision: statSync(join(work,'chat-store.json')).mtimeMs, totalBytes: Object.values(files).reduce((n,v)=>n+v,0), sourceBytes: Object.values(history.index.files).reduce((n,f)=>n+f.size,0), chats: records.length, messages: records.reduce((n,c)=>n+c.messages.length,0), archived: records.filter(c=>c.archived).length, dataPath: work },
    usage: { turns: replies.length, reportedTokens: replies.reduce((n,m)=>n+(m.usage?.last?.totalTokens || 0),0), todayTokens: replies.filter(m=>new Date(m.at).toLocaleDateString('en-CA')===new Date().toLocaleDateString('en-CA')).reduce((n,m)=>n+(m.usage?.last?.totalTokens || 0),0),
      ...localRequestEvidence(join(work,'audit.jsonl')),
      note:'本工作台的回合統計，包含快取輸入；不包含官方桌面或其他服務。舊版本統計可能包含累計誤差，不能換算為帳戶額度百分比。' },
    capturedAt: new Date().toISOString(),
  };
}
