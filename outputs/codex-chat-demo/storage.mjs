import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { cleanTranscript } from './conversations.mjs';
import {defaultRecordsPath,codexHome} from './storage-location.mjs';
import {buildNumber,version} from './release.js';

export const transferLimit = 10 * 1024 * 1024;
export function storageId(work) {
  const path = resolve(work, 'storage-identity.json');
  try { const saved = JSON.parse(readFileSync(path, 'utf8')); if (!saved.id) throw new Error('儲存主機識別檔損壞。'); return saved.id; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const id = randomUUID(); writeFileSync(path, JSON.stringify({ id }), { flag: 'wx' }); return id;
}
export function storageContext({work,id,access,localOrigin,config,paired=[],profiles=[],peerIdentity=null}) {
  let remote = {}; try { remote = JSON.parse(readFileSync(resolve(work,'remote-access.json'),'utf8')); } catch {}
  // This is the authenticated web identity, not the model billing account.
  const login=access.login||peerIdentity?.login||(!config.inferenceOrigin?remote.ownerLogin:null)||null;
  const identity = login || `本機使用者 ${os.userInfo().username}`;
  const key = createHash('sha256').update(access.login ? `tailscale:${access.login}` : `local:${id}:${os.userInfo().username}`).digest('hex').slice(0,24);
  const ownerLogin = access.login || remote.ownerLogin;
  return { account: { key, label: identity, login, ownerLogin:peerIdentity?.ownerLogin||remote.ownerLogin||null, method: access.remote||peerIdentity?.login&&!peerIdentity.unavailable ? 'Tailscale 登入' : '本機作業系統存取', verified:!peerIdentity?.unavailable },
    current: { id, name: config.name || os.hostname(), host: os.hostname(), origin:access.origin, localOrigin, appVersion:version,
      privateOrigin:remote.origin || null, dataPath:work, isBrowserLocal:!access.remote, defaultLocal:config.desktopManaged===true&&!access.remote,
      inferenceOrigin:config.inferenceOrigin || null, defaultDataPath:defaultRecordsPath(), codexHistoryPath:codexHome(), canChangePath:true },
    targets: [...(config.inferenceOrigin?[{name:new URL(config.inferenceOrigin).hostname.split('.')[0],origin:config.inferenceOrigin,ownerOnly:true,available:peerIdentity?.workspaceOwner===true,ownerLogin:peerIdentity?.ownerLogin}]:[]),...profiles, ...paired.filter(d=>d.state==='approved' && d.origin && ownerLogin && d.login===ownerLogin)],
    policy: { existingRecords:'remain', copySupported:true, loginDoesNotSelectBilling:true }, capturedAt:new Date().toISOString() };
}
function text(value,max,label) { if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label}格式不正確。`);return value; }
function timestamp(value) { return typeof value==='string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function record(c) {
  text(c.id,160,'紀錄識別');text(c.title,200,'對話名稱');
  if(!Array.isArray(c.messages)||c.messages.length>20000)throw new Error('對話訊息格式不正確。');
  return { id:c.id, title:cleanTranscript(c.title), createdAt:timestamp(c.createdAt), updatedAt:timestamp(c.updatedAt),
    messages:c.messages.map(m=>{if(!m||!['user','assistant'].includes(m.role))throw new Error('只能複製使用者訊息與助理回答。');if(typeof m.text!=='string'||m.text.length>2_000_000)throw new Error('訊息格式不正確。');return {role:m.role,text:cleanTranscript(m.text),at:timestamp(m.at||m.date)};}),
    archived:c.archived===true, pinned:c.pinned===true };
}
export function makeTransfer(source,records) {
  if(!Array.isArray(records)||!records.length||records.length>500)throw new Error('每次請選 1–500 段對話。');
  const result={format:'codex-local-records',version:1,exportedAt:new Date().toISOString(),source:{id:text(source.id,160,'來源主機'),name:text(source.name,80,'來源名稱')},records:records.map(record)};
  if(Buffer.byteLength(JSON.stringify(result))>transferLimit)throw new Error('本次複製超過 10 MB，請改選單段對話。');
  return result;
}
export function prepareImport(input,chats,targetId) {
  if(!input||input.format!=='codex-local-records'||input.version!==1)throw new Error('請選擇 Codex Local 匯出的紀錄檔。');
  const data=makeTransfer(input.source||{},input.records);
  if(data.source.id===targetId)throw new Error('這份紀錄已在目前主機，請選擇另一台電腦。');
  const next=new Map(chats), added=[], now=new Date().toISOString();let skipped=0;
  const known=new Set([...chats.values()].map(c=>c.copiedFrom?.fingerprint).filter(Boolean));
  for(const c of data.records) {
    const fingerprint=createHash('sha256').update(JSON.stringify({source:data.source.id,...c})).digest('hex');
    if(known.has(fingerprint)){skipped++;continue;}
    const chat={id:randomUUID(),user:'我',model:'auto',title:c.title.slice(0,100),createdAt:c.createdAt||now,updatedAt:c.updatedAt||now,messages:c.messages,archived:c.archived,pinned:c.pinned,
      copiedFrom:{host:data.source.name,sourceId:data.source.id,recordId:c.id,copiedAt:now,fingerprint}};
    // No remote thread IDs, project paths, model configuration or credentials survive a copy.
    next.set(chat.id,chat);known.add(fingerprint);added.push(chat.id);
  }
  return {next,added,skipped};
}
