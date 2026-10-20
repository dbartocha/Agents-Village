/**
 * Reads the JSON that Claude Code passes to its status line command (forwarded by scripts/statusline.ts
 * to POST /api/statusline). Field names from https://code.claude.com/docs/en/statusline (checked 2026-10-20):
 * session_id, model.id, model.display_name, cost.total_cost_usd, context_window.used_percentage and
 * rate_limits.{five_hour,seven_day,spend_limit}.{used_percentage,resets_at} (percent 0–100, epoch seconds).
 * rate_limits appear only for Pro/Max (or a spend limit) and only after the first answer; every part may be missing.
 */
import type { BankWindow, ClaudeBank } from '../../shared/src/index.ts';

export interface StatusLineInfo {
  sessionId?: string;
  modelId?: string;
  modelName?: string;
  costUsd?: number;
  contextPct?: number;
  /** Only the windows present in this payload. */
  claude?: Omit<ClaudeBank, 'updatedAt'>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const pct = (v: unknown): number | undefined => { const n = num(v); return n === undefined ? undefined : Math.round(Math.min(100, Math.max(0, n)) * 10) / 10; };

/** Epoch seconds (documented) or an ISO date (read defensively) → epoch milliseconds. */
function resetTime(v: unknown): number | undefined {
  const n = num(v);
  if (n !== undefined) return n > 1e12 ? n : n * 1000;
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

function window(v: unknown): BankWindow | undefined {
  const o = obj(v);
  const usedPct = pct(o?.used_percentage);
  if (!o || usedPct === undefined) return undefined;
  const w: BankWindow = { usedPct };
  const r = resetTime(o.resets_at);
  if (r !== undefined) w.resetsAt = r;
  return w;
}

export function parseStatusLine(input: unknown): StatusLineInfo | null {
  const o = obj(input);
  if (!o) return null;
  const info: StatusLineInfo = {};
  const sessionId = str(o.session_id);
  if (sessionId) info.sessionId = sessionId;
  const model = obj(o.model);
  if (str(model?.id)) info.modelId = str(model?.id);
  if (str(model?.display_name)) info.modelName = str(model?.display_name);
  const cost = num(obj(o.cost)?.total_cost_usd);
  if (cost !== undefined) info.costUsd = Math.round(cost * 100) / 100;
  const ctx = pct(obj(o.context_window)?.used_percentage);
  if (ctx !== undefined) info.contextPct = ctx;

  const rl = obj(o.rate_limits);
  if (rl) {
    const claude: Omit<ClaudeBank, 'updatedAt'> = {};
    const five = window(rl.five_hour);
    if (five) claude.fiveHour = five;
    const seven = window(rl.seven_day);
    if (seven) claude.sevenDay = seven;
    const sl = obj(rl.spend_limit);
    const slPct = pct(sl?.used_percentage);
    if (sl && slPct !== undefined) {
      const spend: NonNullable<ClaudeBank['spend']> = { usedPct: slPct };
      const used = num(sl.used_usd), limit = num(sl.limit_usd), period = str(sl.period), r = resetTime(sl.resets_at);
      if (used !== undefined) spend.usedUsd = Math.round(used * 100) / 100;
      if (limit !== undefined) spend.limitUsd = Math.round(limit * 100) / 100;
      if (period) spend.period = period;
      if (r !== undefined) spend.resetsAt = r;
      claude.spend = spend;
    }
    if (Object.keys(claude).length) info.claude = claude;
  }
  return info;
}
