import { existsSync, readFileSync } from 'node:fs';

export function accessContext(headers, localOrigin, configPath) {
  const localHost = new URL(localOrigin).host;
  const proxied = headers.host !== localHost || Object.keys(headers).some(k => k.startsWith('tailscale-') || k.startsWith('x-forwarded-'));
  let origin = localOrigin;
  let login = null;
  if (proxied) {
    if (!existsSync(configPath)) throw new Error('私人遠端連線尚未設定。');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const remote = new URL(config.origin);
    if (remote.protocol !== 'https:' || !remote.hostname.endsWith('.ts.net') || remote.pathname !== '/' || remote.port || remote.username || remote.password || remote.search || remote.hash) throw new Error('遠端主機設定不正確。');
    if (typeof config.ownerLogin !== 'string' || !config.ownerLogin.trim() || headers['tailscale-user-login'] !== config.ownerLogin) throw new Error('此私人聊天室只允許主機擁有者登入。');
    if (![localHost, remote.host].includes(headers.host)) throw new Error('未知的遠端主機。');
    origin = remote.origin;
    login = headers['tailscale-user-login'];
  }
  if (headers.origin && headers.origin !== origin) throw new Error('Cross-origin requests are blocked.');
  return { origin, remote: proxied, login };
}
