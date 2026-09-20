// CoCow threads keep their tool registration when opened from the Codex list.
// Arbitrary imported native threads have no CoCow dynamic tools registered.
// Access to this HTTP handler is authenticated separately; test identities stay read-only.
export function turnExecutionEnabled(user, executionInfo, chat = null) {
  return user === '我' && !chat?.nativeImported && executionInfo?.canRun === true;
}
