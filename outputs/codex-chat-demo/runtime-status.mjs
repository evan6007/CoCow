import os from 'node:os';

// Only these fields cross the process boundary. Never forward raw config/auth/RPC errors.
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = value => number(value) !== null && value >= 0 ? value : null;
const string = value => typeof value === 'string' ? value.slice(0, 200) : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const isoSeconds = value => number(value) !== null && value > 0 && value < 8.64e12 ? new Date(value * 1000).toISOString() : null;
function windowStatus(w, slot) {
  if (!w) return null;
  const used = number(w.usedPercent);
  const valid = used !== null && used >= 0 && used <= 100;
  return { slot, usedPercent: valid ? used : null, remainingPercent: valid ? 100 - used : null,
    windowDurationMins: nonnegative(w.windowDurationMins), resetsAt: isoSeconds(w.resetsAt) ? w.resetsAt : null,
    resetsAtIso: isoSeconds(w.resetsAt),
    unavailableReason: !valid ? '服務未回傳有效的使用百分比。' : !isoSeconds(w.resetsAt) ? '服務未回傳重置時間。' : null };
}
function creditsStatus(c) {
  if (!c) return null;
  const raw = c.balance;
  const balance = (typeof raw === 'number' || (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw))) && Number.isFinite(Number(raw)) ? String(raw) : null;
  return { hasCredits: boolean(c.hasCredits), unlimited: boolean(c.unlimited), balance };
}
function bucketStatus(b, id) {
  return { id: string(b.limitId) || string(id), name: string(b.limitName) || string(id), plan: string(b.planType),
    windows: [windowStatus(b.primary, 'primary'), windowStatus(b.secondary, 'secondary')].filter(Boolean),
    credits: creditsStatus(b.credits), reachedType: string(b.rateLimitReachedType), spendControlReached: boolean(b.spendControlReached) };
}
function sourceError(method, error) {
  const message = String(error?.message || '');
  if (/method not found|unknown variant|unknown method|unsupported/i.test(message)) return `目前 Codex 版本不支援 ${method}。`;
  if (/timeout/i.test(message)) return `${method} 查詢逾時。`;
  if (/401|403|unauthor|forbidden/i.test(message)) return `${method} 驗證失敗或權限不足。`;
  return `${method} 查詢失敗；未使用舊資料替代。`;
}
export const runtimeTools = [{ type: 'function', name: 'get_runtime_status', description: 'Read live backend account, subscription quota, reset times, token activity, billing evidence, dispatched model, host and tool permissions. Required for questions about my quota, whose allowance is used, model/auth/permissions, or why desktop can query but this chat cannot. Read-only; never uses conversation history.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }];
export function toolPermissions(owner = true) {
  return { allowed: owner ? ['runtime_status.get_runtime_status', 'codex_history.search_codex_history', 'codex_history.read_codex_history'] : [],
    denied: ['任意指令與 Shell', '檔案修改', '瀏覽器與網頁搜尋', '外部 MCP 與連接器', '更換帳戶或計費來源', '購買點數與使用重置券'],
    reason: owner ? '只開放帳戶狀態與歷史查詢的唯讀工具。' : '測試身分只提供文字問答，未開放主人的狀態或歷史工具。',
    desktopDifference: '本機 Codex 的查詢工具不會自動繼承到這個介面。舊版只註冊歷史工具，且提示詞禁止即時查詢；此版已新增受限的即時狀態工具。' };
}
export async function readRuntimeStatus(bridge, { expectedAccount = null, chat = null, requestedModel = 'auto', owner = true, localUsage = null } = {}) {
  if (bridge.remote) {
    const remote = await bridge.runtimeStatus({ chat, requestedModel, owner, localUsage });
    if (!remote.unavailable) return remote;
    const missing = await readRuntimeStatus({ rpc: async () => { throw new Error('Remote unavailable'); } }, { chat, requestedModel, owner, localUsage });
    missing.billing.reason = remote.reason;missing.billing.label = '配對額度服務尚未就緒';missing.connection = { kind: 'paired', inferenceOrigin: bridge.origin, storageHost: os.hostname(), transcriptsStoredAtInferenceHost: false };
    return missing;
  }
  const specs = [['account', 'account/read', { refreshToken: false }], ['limits', 'account/rateLimits/read', {}], ['config', 'config/read', { includeLayers: false }], ['usage', 'account/usage/read', {}]];
  const results = await Promise.all(specs.map(async ([key, method, params]) => {
    try { return { key, method, value: await bridge.rpc(method, params, 15000), capturedAt: new Date().toISOString() }; }
    catch (error) { return { key, method, error: sourceError(method, error), capturedAt: new Date().toISOString() }; }
  }));
  const raw = Object.fromEntries(results.map(r => [r.key, r.value]));
  const sources = Object.fromEntries(results.map(r => [r.key, { method: r.method, available: !r.error, capturedAt: r.capturedAt, reason: r.error || null }]));
  const account = raw.account?.account;
  const limits = raw.limits;
  const config = raw.config?.config;
  const provider = string(config?.model_provider);
  const customOpenai = config?.model_providers?.openai;
  const officialEndpoint = config?.chatgpt_base_url === 'https://chatgpt.com/backend-api/' || config?.chatgpt_base_url === 'https://chatgpt.com/backend-api';
  const routingVerified = !!config && provider === 'openai' && officialEndpoint && !customOpenai && config.forced_login_method === 'chatgpt';
  const buckets = limits?.rateLimitsByLimitId && Object.keys(limits.rateLimitsByLimitId).length
    ? Object.entries(limits.rateLimitsByLimitId).filter(([, b]) => b && typeof b === 'object').map(([id, b]) => bucketStatus(b, id))
    : limits?.rateLimits ? [bucketStatus(limits.rateLimits, limits.rateLimits.limitId || 'codex')] : [];
  const core = buckets.find(b => b.id === 'codex');
  const accountMatches = !expectedAccount?.accountId || !limits?.accountId ? null : limits.accountId === expectedAccount.accountId && (!expectedAccount.email || account?.email === expectedAccount.email);
  const noExtraCredits = core?.credits?.balance != null && Number(core.credits.balance) === 0 && core.credits.hasCredits === false && core.credits.unlimited === false;
  const allowanceAvailable = !!core?.windows.length && core.windows.every(w => w.remainingPercent !== null && w.remainingPercent > 0) && limits?.ordinaryUsageAllowed !== false && core.spendControlReached !== true;
  const confirmed = account?.type === 'chatgpt' && raw.account?.requiresOpenaiAuth === true && routingVerified && accountMatches === true && noExtraCredits && allowanceAvailable && (!chat?.modelProvider || chat.modelProvider === 'openai');
  const reason = accountMatches === false ? '後端帳戶與先前驗證的本機 Codex 帳戶不同；已停止新問答，沒有切換帳戶。'
    : accountMatches === null ? '無法核對本機 Codex 帳戶識別；已停止新問答。'
    : account?.type !== 'chatgpt' ? '後端不是可確認的 ChatGPT 登入；已停止新問答，沒有切換驗證方式。'
    : !routingVerified ? '無法確認官方供應商與服務路徑；已停止新問答。'
    : !noExtraCredits ? '另購 Codex 點數不為零或無法確認，無法保證只用訂閱；已停止新問答。'
    : !allowanceAvailable ? '訂閱剩餘額度不足或無法取得有效資料；已停止新問答。'
    : chat?.modelProvider && chat.modelProvider !== 'openai' ? '對話供應商與預期不同；已停止新問答。' : null;
  const usage = raw.usage;
  const summary = usage?.summary;
  const recent = Array.isArray(usage?.dailyUsageBuckets) ? usage.dailyUsageBuckets.filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.startDate) && nonnegative(b.tokens) !== null).map(b => ({ date: b.startDate, tokens: b.tokens })).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 7) : null;
  const now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    version: 1, capturedAt: now.toISOString(), capturedAtDisplay: now.toLocaleString('zh-TW', { timeZone, hour12: false }), timeZone, liveQuery: true, sources,
    authMode: string(account?.type), plan: string(account?.planType), ordinaryUsageAllowed: boolean(limits?.ordinaryUsageAllowed),
    account: { email: string(account?.email), idSuffix: typeof limits?.accountId === 'string' ? limits.accountId.slice(-8) : null,
      expectedEmail: string(expectedAccount?.email), matchesExpected: accountMatches, source: 'account/read + account/rateLimits/read',
      authDescription: account?.type === 'chatgpt' ? 'ChatGPT 登入（憑證由本機 Codex 管理）' : account?.type === 'apiKey' ? 'API key（本介面已阻止使用）' : '無法取得',
      unavailableReason: sources.account.reason || (!account ? '服務未回傳登入帳戶。' : !account.email ? '服務未提供帳戶電子郵件。' : null) },
    provider: { configured: provider, confirmedForChat: string(chat?.modelProvider), officialChatgptRouteVerified: routingVerified,
      endpoint: officialEndpoint ? 'https://chatgpt.com/backend-api/' : null, source: 'config/read；對話供應商另由 thread/start 回覆確認',
      unavailableReason: sources.config.reason || (!routingVerified ? '有效設定未能確認為官方 ChatGPT 服務路徑。' : null) },
    model: { requested: chat?.model || requestedModel, dispatched: chat?.actualModel || null,
      scope: chat ? '目前或最近一回合的送出模型' : '尚未開始這段對話',
      source: chat ? '後端 turn/start 送出參數；不是根據模型自我介紹' : '前端選擇；自動模式尚未路由',
      unavailableReason: chat?.actualModel ? null : '尚未送出問題，尚無本回合模型。' },
    billing: { source: confirmed ? 'codex_subscription' : 'unconfirmed', label: confirmed ? '已核對帳戶的 Codex 訂閱額度' : '無法確認；已停止新問答',
      accountEmail: string(account?.email), accountRelation: accountMatches === true ? '與先前本機 Codex 查詢回傳的帳戶 ID 相同' : '無法確認為預期帳戶',
      evidence: { chatgptAuth: account?.type === 'chatgpt', officialRouteVerified: routingVerified, matchesExpectedAccount: accountMatches,
        noExtraCodexCredits: noExtraCredits, subscriptionAllowanceAvailable: allowanceAvailable, apiCredentialsPassedToChild: false, apiFallbackEnabled: false },
      exactCharge: null, exactChargeReason: '官方查詢未提供本回合的扣帳收據或金額；以上為帳戶、服務路徑、額度及點數的交叉核對。',
      apiBalance: null, apiBalanceReason: '此程式沒有查詢 OpenAI API 帳務的授權或端點；無法取得 API 餘額，不能把 Codex 點數當成 API 餘額。',
      reason },
    windows: core?.windows || [], buckets, credits: core?.credits || null,
    quotaUnavailableReason: sources.limits.reason || (!core ? '服务未提供 codex 額度桶。' : !core.windows.length ? '服務未提供可用的訂閱額度時段。' : null),
    creditsUnavailableReason: !core?.credits || core.credits.balance === null ? '服務未提供另購 Codex 點數餘額。' : null,
    resetCredits: { availableCount: nonnegative(limits?.rateLimitResetCredits?.availableCount), reason: limits?.rateLimitResetCredits?.availableCount == null ? '服務未提供可用重置券數量。' : null, canConsume: false },
    accountUsage: { lifetimeTokens: nonnegative(summary?.lifetimeTokens), peakDailyTokens: nonnegative(summary?.peakDailyTokens),
      recentDays: recent, latestDay: recent?.[0] || null, source: 'account/usage/read', capturedAt: sources.usage.capturedAt,
      reason: sources.usage.reason || (!summary ? '服務未提供帳戶 Token 摘要。' : null),
      note: '帳戶活動統計可能延遲，日期以服務回傳為準；不是本聊天室用量，也不是 API 帳單。未提供的欄位表示無法取得。' },
    localUsage, host: { name: os.hostname(), platform: os.platform(), source: '後端作業系統' }, permissions: toolPermissions(owner),
    minimumRemainingPercent: 0, canStartChat: confirmed, apiKeyLoaded: null, apiKeyLoadedReason: '未讀取憑證內容；僅透過 account/read 核對驗證類型。', apiFallbackEnabled: false,
  };
}
