/**
 * Pure functions that add or remove the Agent Village hooks in a Claude Code settings object.
 * Used by scripts/hooks.ts (the CLI) and covered by test/hooks-config.test.ts.
 */
export const OBSERVE_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd',
] as const;
export const APPROVAL_EVENT = 'PermissionRequest';
export const TOKEN_HEADER = 'X-Agent-Village-Token';

interface HttpHook { type: 'http'; url: string; timeout?: number; headers?: Record<string, string>; [k: string]: unknown }
interface HookGroup { matcher?: string; hooks: Array<HttpHook | Record<string, unknown>>; [k: string]: unknown }
export type Settings = { hooks?: Record<string, HookGroup[]>; [k: string]: unknown };

/** True for hook handlers this tool added (http hook pointing at /hooks with our token header). */
export function isVillageHook(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  const o = h as HttpHook;
  return o.type === 'http' && typeof o.url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/hooks$/.test(o.url)
    && !!o.headers && Object.keys(o.headers).some(k => k.toLowerCase() === TOKEN_HEADER.toLowerCase());
}

/** Removes every village handler, dropping groups and events that become empty. Other hooks are left untouched. */
export function removeVillageHooks(settings: Settings): Settings {
  const next: Settings = structuredClone(settings);
  if (!next.hooks) return next;
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map(g => ({ ...g, hooks: Array.isArray(g.hooks) ? g.hooks.filter(h => !isVillageHook(h)) : g.hooks }))
      .filter(g => !Array.isArray(g.hooks) || g.hooks.length > 0);
    if (kept.length) next.hooks[event] = kept;
    else delete next.hooks[event];
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return next;
}

export function addVillageHooks(settings: Settings, opts: { port: number; token: string; approvals: boolean; approvalTimeoutSec: number }): Settings {
  const next = removeVillageHooks(settings);
  next.hooks ??= {};
  const url = `http://127.0.0.1:${opts.port}/hooks`;
  const handler = (timeout: number): HttpHook => ({ type: 'http', url, timeout, headers: { [TOKEN_HEADER]: opts.token } });
  for (const event of OBSERVE_EVENTS) {
    (next.hooks[event] ??= []).push({ hooks: [handler(5)] });
  }
  if (opts.approvals) {
    // Claude Code waits for this hook, so its timeout must be longer than the village's own wait.
    (next.hooks[APPROVAL_EVENT] ??= []).push({ hooks: [handler(opts.approvalTimeoutSec + 15)] });
  }
  return next;
}

export function installedEvents(settings: Settings): string[] {
  return Object.entries(settings.hooks ?? {})
    .filter(([, groups]) => Array.isArray(groups) && groups.some(g => Array.isArray(g.hooks) && g.hooks.some(isVillageHook)))
    .map(([event]) => event);
}
