/**
 * Shared contract between the server (hook receiver) and the web town.
 * Everything here is plain TypeScript with erasable syntax only, so Node can
 * run it directly (type stripping) and Vite can bundle it for the browser.
 * See readme.adoc → "Event model" for the human description of these types.
 */

export const PROTOCOL_VERSION = 1;

/** Places in the town where a robot can work. */
export type StationId = 'lib' | 'site' | 'forge' | 'tower' | 'plaza' | 'charge';

/** Text that the demo can provide in both languages. The server always sends plain strings. */
export type Localized = { pl: string; en: string };
export type Text = string | Localized;

/** Which station a Claude Code tool sends the robot to. Unknown tools go to the plaza. */
export const TOOL_STATIONS: Readonly<Record<string, StationId>> = {
  Read: 'lib', Grep: 'lib', Glob: 'lib', LS: 'lib', NotebookRead: 'lib',
  Edit: 'site', MultiEdit: 'site', Write: 'site', NotebookEdit: 'site',
  Bash: 'forge', BashOutput: 'forge', KillShell: 'forge', KillBash: 'forge', PowerShell: 'forge', Monitor: 'forge',
  WebSearch: 'tower', WebFetch: 'tower',
};

export function stationForTool(tool: string): StationId {
  return TOOL_STATIONS[tool] ?? 'plaza';
}

/** Tools that mean "the agent is asking the human something". */
export const QUESTION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion']);

/** Robot names. `f` only matters for Polish grammar in the UI. */
export const ROBOT_NAMES: ReadonlyArray<{ name: string; f: boolean }> = [
  { name: 'Atlas', f: false }, { name: 'Nova', f: true }, { name: 'Bolt', f: false }, { name: 'Iris', f: true },
  { name: 'Pixel', f: false }, { name: 'Luna', f: true }, { name: 'Orbit', f: false }, { name: 'Juno', f: true },
  { name: 'Rex', f: false }, { name: 'Ivy', f: true }, { name: 'Comet', f: false }, { name: 'Ruby', f: true },
  { name: 'Volt', f: false }, { name: 'Sky', f: true }, { name: 'Max', f: false }, { name: 'Echo', f: true },
];

export type ActivityKind =
  | 'session_start' | 'prompt' | 'tool' | 'tool_done' | 'tool_failed'
  | 'permission' | 'permission_resolved' | 'attention' | 'stop'
  | 'subagent_start' | 'subagent_stop' | 'session_end';

export type AttentionKind = 'permission' | 'question' | 'idle' | 'info';
export type Decision = 'allow' | 'deny';
export type Resolution = Decision | 'timeout' | 'terminal' | 'cancelled';

/** One thing that happened to one agent. The town animates these; the panel lists them. */
export interface Activity {
  seq: number;
  at: number;
  sessionId: string;
  kind: ActivityKind;
  tool?: string;
  target?: Text;
  station?: StationId;
  toolUseId?: string;
  /** Prompt text, notification message, error, or last assistant message (already shortened). */
  text?: Text;
  attention?: AttentionKind;
  permissionId?: string;
  resolution?: Resolution;
  agentType?: string;
  /** Demo only: answer buttons for a question. */
  options?: Text[];
}

export type SessionStatus = 'idle' | 'thinking' | 'working' | 'waiting' | 'asking' | 'ended';

export interface PendingPermission {
  id: string;
  tool: string;
  target: Text;
  /** Short human description, when the source provides one. */
  title?: Text;
  why?: Text;
  createdAt: number;
  /** When the village stops holding the request and Claude Code falls back to its own prompt. */
  expiresAt?: number;
  /** True when the human can answer from the village (approvals are on and the hook is waiting). */
  approvable: boolean;
}

export interface SessionInfo {
  id: string;
  name: string;
  f: boolean;
  cwd: string;
  project: string;
  model?: string;
  status: SessionStatus;
  startedAt: number;
  updatedAt: number;
  prompt?: Text;
  currentTool?: { tool: string; target: Text; station: StationId; toolUseId?: string; startedAt: number };
  pending?: PendingPermission;
  attentionText?: Text;
  subagents: number;
  toolCount: number;
  lastMessage?: Text;
}

export interface Snapshot {
  protocol: number;
  version: string;
  approvals: boolean;
  sessions: SessionInfo[];
  recent: Activity[];
}

/** Messages sent over the SSE stream at GET /events. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'activity'; activity: Activity; session: SessionInfo }
  | { type: 'removed'; sessionId: string };

/** Fields Claude Code sends to every hook. Anything else is optional and read defensively. */
export interface HookPayload {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  transcript_path?: string;
  permission_mode?: string;
  [key: string]: unknown;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseHookPayload(input: unknown): ParseResult<HookPayload> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Body must be a JSON object' };
  const o = input as Record<string, unknown>;
  if (typeof o.hook_event_name !== 'string' || !o.hook_event_name) return { ok: false, error: 'Missing hook_event_name' };
  if (typeof o.session_id !== 'string' || !o.session_id) return { ok: false, error: 'Missing session_id' };
  if (o.cwd !== undefined && typeof o.cwd !== 'string') return { ok: false, error: 'cwd must be a string' };
  return { ok: true, value: o as HookPayload };
}

/** Shortens text for display and logs. */
export function clip(value: unknown, max = 120): string {
  if (value === undefined || value === null) return '';
  const s = (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Makes a path relative to the project folder when it lives inside it. Works for Windows and POSIX paths. */
export function relPath(p: string, cwd?: string): string {
  if (!cwd) return p;
  const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(p), b = norm(cwd);
  if (a.toLowerCase().startsWith(b.toLowerCase() + '/')) return a.slice(b.length + 1);
  return a;
}

/** Last folder name of a path, e.g. "C:\\dev\\shop" → "shop". */
export function projectName(cwd?: string): string {
  if (!cwd) return '';
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || cwd;
}

/** One-line summary of what a tool call is about, for the robot's label and the log. */
export function summarizeTool(tool: string, input: unknown, cwd?: string): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  switch (tool) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': case 'NotebookRead':
      return clip(relPath(str('file_path') || str('notebook_path') || str('path'), cwd), 90);
    case 'Bash': case 'PowerShell':
      return clip(str('command'), 90);
    case 'Grep':
      return clip(str('pattern') + (str('path') ? ' · ' + relPath(str('path'), cwd) : ''), 90);
    case 'Glob':
      return clip(str('pattern'), 90);
    case 'LS':
      return clip(relPath(str('path'), cwd), 90);
    case 'WebSearch':
      return clip(str('query'), 90);
    case 'WebFetch':
      return clip(str('url'), 90);
    case 'Task': case 'Agent':
      return clip(str('description') || str('subagent_type') || str('prompt'), 90);
    case 'AskUserQuestion': {
      const qs = Array.isArray(i.questions) ? (i.questions as Array<Record<string, unknown>>) : [];
      return clip(qs[0] && typeof qs[0].question === 'string' ? qs[0].question : str('question'), 120);
    }
    case 'TodoWrite': {
      const todos = Array.isArray(i.todos) ? i.todos.length : 0;
      return todos ? `${todos} todos` : 'todos';
    }
    default: {
      const firstString = Object.values(i).find(v => typeof v === 'string');
      return clip(firstString ?? '', 90);
    }
  }
}
