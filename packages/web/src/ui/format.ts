/** Turns robots, activities and log lines into display text. Pure functions over i18n. */
import { AGENT_LABELS, QUESTION_TOOLS, canonicalTool, modelLabel } from '../../../shared/src/index.ts';
import type { Activity, StationId } from '../../../shared/src/index.ts';
import type { LogEntry, Robot } from '../agents/robot';
import { esc } from '../lib/util';
import { L, fmtCompact, hasKey, t } from './i18n';

export const stName = (id: StationId | undefined): string => t('st_' + (id ?? 'plaza'));

/** "is reading", "is running"… for a tool; unknown tools get "is using X". */
export function verb(tool: string | undefined): string {
  if (!tool) return '';
  const key = 'v_' + canonicalTool(tool);
  return hasKey(key) ? t(key) : t('v_other', { tool });
}

export type StatusClass = 'work' | 'wait' | 'ask' | 'done' | '';

/** Short status for the pill in the panel. Uses the real session state, refined by what the robot shows. */
export function statusOf(r: Robot): { text: string; cls: StatusClass } {
  const s = r.session;
  if (r.leaving || s.status === 'ended') return { text: t('sLeave'), cls: '' };
  if (s.status === 'waiting') return { text: t('sWait'), cls: 'wait' };
  if (s.status === 'asking') return { text: t('sAsk'), cls: 'ask' };
  if (r.phase === 'spawn') return { text: t('sSpawn'), cls: 'work' };
  if (s.status === 'idle') return r.homeBound ? { text: t('sWalkHome'), cls: '' } : { text: t('sCharge', undefined, r.f), cls: 'done' };
  if (r.phase === 'walk') return r.carry ? { text: t('sCarry'), cls: 'work' } : { text: t('sWalk'), cls: 'work' };
  if (r.phase === 'work' && r.beat) return { text: r.beat.think ? t('s_think') : t('s_' + r.beat.station), cls: 'work' };
  if (s.status === 'thinking') return { text: t('s_think'), cls: 'work' };
  return { text: t('sIdle'), cls: 'work' };
}

/** HTML for the "Now" line: always the real current step, not the animation. */
export function nowHTML(r: Robot): string {
  const s = r.session;
  const span = (x: string) => '<span>' + esc(x) + '</span>';
  if (r.leaving || s.status === 'ended') return span(t('nowLeave'));
  if (r.phase === 'spawn') return span(t('nowSpawn'));
  if (s.status === 'waiting') return span(s.currentTool ? t('nowWait', { st: stName(s.currentTool.station) }) : t('nowWaitPlain'));
  if (s.status === 'asking') return span(t('nowAsk'));
  if (s.status === 'idle') return span(r.homeBound ? t('sWalkHome') : t('nowCharge'));
  if (s.status === 'working' && s.currentTool) {
    const c = s.currentTool;
    return '<span class="tool">' + esc(c.tool) + '</span><span class="target">' + esc(L(c.target)) + '</span><span class="where">· ' + esc(stName(c.station)) + '</span>';
  }
  if (r.phase === 'walk' && !r.homeBound) return span(t('nowWalk', { st: stName(r.station) }) + (r.carry ? t('nowCarry', undefined, r.f) : ''));
  return span(t('nowThink'));
}

const toolChip = (tool: string | undefined, target: unknown, note?: string) =>
  '<span class="tool">' + esc(tool ?? '') + '</span><span class="target">' + esc(L(target as string)) + '</span>' + (note ? ' <em>' + esc(note) + '</em>' : '');

/** One log line, or null when the entry is not worth showing. `prev` helps skip duplicates. */
export function logLine(e: LogEntry, r: Robot, prev?: LogEntry): { cls: string; html: string } | null {
  if (e.kind === 'say') {
    return e.who === 'you'
      ? { cls: 'k-user', html: '<b>' + esc(t('you')) + '</b> <span>' + esc(L(e.text)) + '</span>' }
      : { cls: 'k-agent', html: '<b>' + esc(t('robot')) + '</b> <span>' + esc(L(e.text)) + '</span>' };
  }
  const a = e.a;
  const f = r.f;
  switch (a.kind) {
    case 'session_start': return { cls: 'k-sys', html: esc(t('a_session_start', undefined, f)) };
    case 'prompt': return { cls: 'k-user', html: '<b>' + esc(t('you')) + '</b> <span>' + esc(L(a.text)) + '</span>' };
    case 'tool':
      if (a.tool && QUESTION_TOOLS.has(a.tool)) return { cls: 'k-ask', html: '<span>' + esc(t('lAsk', { q: a.target })) + '</span>' };
      return { cls: 'k-tool', html: toolChip(a.tool, a.target) };
    case 'tool_done': return a.text ? { cls: 'k-result', html: '↳ ' + esc(L(a.text)) } : null;
    case 'tool_failed': return { cls: 'k-fail', html: '↳ ' + esc(t('a_tool_failed', { text: a.text })) };
    case 'permission': return { cls: 'k-warn', html: toolChip(a.tool, a.target, t('lWaitNote')) };
    case 'attention':
      if (a.attention === 'permission') {
        if (prev?.kind === 'activity' && prev.a.kind === 'permission') return null;
        return { cls: 'k-warn', html: '<span>' + esc(t('a_permission', { target: a.text })) + '</span>' };
      }
      if (a.attention === 'question') return a.tool ? null : { cls: 'k-ask', html: '<span>' + esc(t('lAsk', { q: a.text })) + '</span>' };
      if (a.attention === 'idle') return null;
      return a.text ? { cls: 'k-sys', html: esc(L(a.text)) } : null;
    case 'permission_resolved': {
      const key = 'a_res_' + (a.resolution ?? 'cancelled');
      if (a.resolution === 'allow' || a.resolution === 'deny') return { cls: 'k-user', html: '<b>' + esc(t('you')) + '</b> <span>' + esc(t(key)) + '</span>' };
      return { cls: 'k-sys', html: esc(t(key)) };
    }
    case 'stop': return { cls: 'k-done', html: '<span>✓ ' + esc(t('lDone')) + '</span>' };
    case 'earned': return { cls: 'k-earn', html: '<span>🪙 ' + esc(t('a_earned', { n: fmtCompact(a.tokens ?? 0) }, f)) + '</span>' };
    case 'subagent_start': return { cls: 'k-sys', html: esc(t('a_sub_start', { agent: a.agentType ?? '' })) };
    case 'subagent_stop': return { cls: 'k-sys', html: esc(t('a_sub_stop')) };
    case 'session_end': return { cls: 'k-sys', html: esc(t('a_end', undefined, f)) };
    default: return null;
  }
}

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'NotebookRead', 'LS']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput']);

/** Cuts text to max characters with an ellipsis. */
export function cut(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/**
 * A short form of a tool target for one-line places (feed, queue chips):
 * only the first command of a shell line, only the last folders of a path, only the host of a URL.
 */
export function shortTarget(tool: string | undefined, target: unknown, max = 34): string {
  let s = L(target as string).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  tool = tool && canonicalTool(tool);
  if (tool && SHELL_TOOLS.has(tool)) {
    const first = s.split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/)[0] ?? s;
    if (first && first.length < s.length) s = first + ' …';
  } else if (tool && FILE_TOOLS.has(tool)) {
    const parts = s.split(/[\\/]/).filter(Boolean);
    if (parts.length > 2) s = '…/' + parts.slice(-2).join('/');
  } else if (tool === 'WebFetch') {
    try { const u = new URL(s); s = u.hostname + (u.pathname.length > 1 ? u.pathname : ''); } catch { /* not a URL */ }
  }
  return cut(s, max);
}

/** One-line description of an activity for the feed. `short` keeps it to one line; the full text goes into the tooltip. */
export function feedText(a: Activity, f: boolean, short = true): string {
  const tgt = (v: unknown) => (short ? shortTarget(a.tool, v) : L(v as string));
  const txt = (v: unknown, max = 30) => (short ? cut(L(v as string), max) : L(v as string));
  switch (a.kind) {
    case 'session_start': return t('a_session_start', undefined, f);
    case 'prompt': return t('a_prompt', undefined, f) + (a.text ? ': ' + txt(a.text) : '');
    case 'tool': return a.tool && QUESTION_TOOLS.has(a.tool) ? t('a_question') : (verb(a.tool) + ' ' + tgt(a.target)).trim();
    case 'tool_failed': return t('a_tool_failed', { text: txt(a.text) });
    case 'permission': return t('a_permission', { target: tgt(a.target) });
    case 'attention':
      if (a.attention === 'permission') return t('a_permission', { target: txt(a.text) });
      if (a.attention === 'question') return t('a_question');
      return txt(a.text);
    case 'permission_resolved': return t('a_res_' + (a.resolution ?? 'cancelled'));
    case 'stop': return t('a_stop', undefined, f);
    case 'session_end': return t('a_end', undefined, f);
    case 'earned': return t('a_earned', { n: fmtCompact(a.tokens ?? 0) }, f);
    default: return '';
  }
}

/** "Claude Code · Opus · shop · steps: 12 · helpers: 1" */
export function metaLine(r: Robot): string {
  const s = r.session;
  const parts = [AGENT_LABELS[s.provider ?? 'claude'], modelLabel(s), s.project].filter(Boolean) as string[];
  if (s.toolCount) parts.push(t('steps', { n: s.toolCount }));
  if (s.subagents) parts.push(t('helpers', { n: s.subagents }));
  return parts.join(' · ');
}
