import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const run = promisify(execFile);
let cached = null, captured = 0, pending = null;
export async function remoteStatus(work) {
  if (cached && Date.now()-captured < 15000) return cached;
  if (pending) return pending;
  pending = (async()=>{
    const executable = process.platform==='win32'?join(process.env.ProgramFiles || 'C:/Program Files', 'Tailscale/tailscale.exe'):'tailscale';
    if (process.platform==='win32'&&!existsSync(executable)) return { stage: 'not-installed', label: '尚未安裝私人連線', ready: false, privateUrl: null };
    try {
      const result = await run(executable, ['status','--json'], { windowsHide: true, timeout: 4000, maxBuffer: 2000000 });
      const status = JSON.parse(result.stdout);
      if (status.BackendState !== 'Running') return { stage: 'needs-login', label: '等待 Tailscale 登入', ready: false, privateUrl: null };
      const configPath = join(work, 'remote-access.json');
      const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath,'utf8')) : null;
      const serve = JSON.parse((await run(executable,['serve','status','--json'],{windowsHide:true,timeout:4000})).stdout);
      const host = status.Self.DNSName.replace(/\.$/,'');
      const target = serve.Web?.[`${host}:443`]?.Handlers?.['/']?.Proxy;
      const ready = !!(status.Self.Online && target === 'http://127.0.0.1:4318' && config?.origin === `https://${host}` && config?.ownerLogin);
      return { stage: ready ? 'ready' : 'needs-serve', label: ready ? '私人遠端已就緒' : '已登入，等待開啟私人網頁', ready, privateUrl: ready ? config.origin : null, setupUrl: !ready && status.Self.ID ? `https://login.tailscale.com/f/serve?node=${encodeURIComponent(status.Self.ID)}` : null, ownerOnly: true };
    } catch { return { stage: 'unavailable', label: '無法確認私人連線', ready: false, privateUrl: null }; }
  })();
  try { cached=await pending;captured=Date.now();return cached; } finally { pending=null; }
}
