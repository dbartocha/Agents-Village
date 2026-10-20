/**
 * Shared contract between the server (hook receiver) and the web town.
 * Everything here is plain TypeScript with erasable syntax only, so Node can
 * run it directly (type stripping) and Vite can bundle it for the browser.
 * See readme.adoc → "Event model" for the human description of these types.
 */

export const PROTOCOL_VERSION = 2;

/** Places in the town where a robot can work. */
export type StationId = 'lib' | 'site' | 'forge' | 'tower' | 'plaza' | 'charge';

/** Text that the demo can provide in both languages. The server always sends plain strings. */
export type Localized = { pl: string; en: string };
export type Text = string | Localized;

/** Which coding agent (provider) a session comes from. Robots are coloured by it. */
export type AgentKind = 'claude' | 'copilot';
export type Provider = AgentKind;
export const AGENT_KINDS: ReadonlyArray<AgentKind> = ['claude', 'copilot'];
export const AGENT_LABELS: Readonly<Record<AgentKind, string>> = { claude: 'Claude Code', copilot: 'GitHub Copilot' };

export function parseAgentKind(v: unknown): AgentKind {
  return typeof v === 'string' && (AGENT_KINDS as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as AgentKind) : 'claude';
}

/**
 * GitHub Copilot tool names → the Claude Code tool that does the same job, so stations, labels and
 * verbs need only one list. First Copilot CLI names, then VS Code agent mode names (best known; tools
 * that are missing here simply go to the plaza).
 */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  view: 'Read', grep: 'Grep', rg: 'Grep', glob: 'Glob',
  edit: 'Edit', str_replace_editor: 'Edit', apply_patch: 'Edit', create: 'Write',
  bash: 'Bash', read_bash: 'BashOutput', write_bash: 'Bash', stop_bash: 'KillShell',
  powershell: 'PowerShell', read_powershell: 'BashOutput', write_powershell: 'PowerShell', stop_powershell: 'KillShell',
  web_fetch: 'WebFetch', web_search: 'WebSearch', ask_user: 'AskUserQuestion', task: 'Task', update_todo: 'TodoWrite',
  read_file: 'Read', list_dir: 'LS', file_search: 'Glob', grep_search: 'Grep', semantic_search: 'Grep',
  replace_string_in_file: 'Edit', multi_replace_string_in_file: 'MultiEdit', insert_edit_into_file: 'Edit',
  create_file: 'Write', create_directory: 'Write', edit_notebook_file: 'NotebookEdit',
  run_in_terminal: 'Bash', get_terminal_output: 'BashOutput', run_task: 'Bash',
  fetch_webpage: 'WebFetch', vscode_websearch: 'WebSearch', manage_todo_list: 'TodoWrite', runSubagent: 'Task',
};

/** The Claude Code name for a tool (Copilot names are translated, everything else is unchanged). */
export function canonicalTool(tool: string): string {
  return TOOL_ALIASES[tool] ?? tool;
}

/** Which station a Claude Code tool sends the robot to. Unknown tools go to the plaza. */
export const TOOL_STATIONS: Readonly<Record<string, StationId>> = {
  Read: 'lib', Grep: 'lib', Glob: 'lib', LS: 'lib', NotebookRead: 'lib',
  Edit: 'site', MultiEdit: 'site', Write: 'site', NotebookEdit: 'site',
  Bash: 'forge', BashOutput: 'forge', KillShell: 'forge', KillBash: 'forge', PowerShell: 'forge', Monitor: 'forge',
  WebSearch: 'tower', WebFetch: 'tower',
};

export function stationForTool(tool: string): StationId {
  return TOOL_STATIONS[canonicalTool(tool)] ?? 'plaza';
}

/** Tools that mean "the agent is asking the human something". */
export const QUESTION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ask_user']);

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
  | 'subagent_start' | 'subagent_stop' | 'session_end'
  /** The robot was "paid": `tokens` is how many tokens its session used since the previous 'earned'. */
  | 'earned';

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
  /** 'earned' only: tokens used since the previous 'earned'. */
  tokens?: number;
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

/** Tokens one session used, from the Claude Code transcript (see readme.adoc → "Earned tokens"). */
export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export function totalTokens(u: TokenUsage | undefined): number {
  return u ? u.input + u.output + u.cacheWrite + u.cacheRead : 0;
}

export interface SessionInfo {
  id: string;
  provider: Provider;
  name: string;
  f: boolean;
  cwd: string;
  project: string;
  /** Model id, e.g. "claude-opus-5-5" (from hooks or the transcript). */
  model?: string;
  /** Display name from the status line, e.g. "Opus". */
  modelName?: string;
  usage?: TokenUsage;
  /** Claude Code's own estimate of the session cost at list price (status line). */
  costUsd?: number;
  /** How full the context window is, 0–100 (status line). */
  contextPct?: number;
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

/** One usage window of a provider limit. usedPct is 0–100; resetsAt is epoch milliseconds. */
export interface BankWindow { usedPct: number; resetsAt?: number }

/** Claude subscription limits, from the Claude Code status line (Pro/Max only, after the first answer). */
export interface ClaudeBank {
  fiveHour?: BankWindow;
  sevenDay?: BankWindow;
  spend?: { usedPct: number; usedUsd?: number; limitUsd?: number; period?: string; resetsAt?: number };
  updatedAt: number;
}

/** GitHub Copilot premium requests this month, from the GitHub billing API. */
export interface CopilotBank {
  used: number;
  allowance?: number;
  /** "2026-10" */
  month: string;
  updatedAt: number;
  /** Last error; `used` then keeps the last good value. */
  error?: string;
}

/** What the town's bank shows: how much of each provider's limit is left. */
export interface Bank { claude?: ClaudeBank; copilot?: CopilotBank }

export interface Snapshot {
  protocol: number;
  version: string;
  approvals: boolean;
  sessions: SessionInfo[];
  recent: Activity[];
  bank: Bank;
}

/** Messages sent over the SSE stream at GET /events. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'activity'; activity: Activity; session: SessionInfo }
  | { type: 'removed'; sessionId: string }
  | { type: 'bank'; bank: Bank }
  /** The session changed without an activity (tokens, model, cost). */
  | { type: 'session'; session: SessionInfo };

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

/** Short model name for labels: "claude-opus-5-5" → "Opus 5.5", "claude-sonnet-4-5-20250929" → "Sonnet 4.5". */
export function modelLabel(s: Pick<SessionInfo, 'model' | 'modelName'>): string {
  if (s.modelName) return s.modelName;
  if (!s.model) return '';
  const parts = s.model.replace(/^claude-/, '').replace(/\[.*\]$/, '').split('-').filter(p => !/^\d{8}$/.test(p));
  const name = parts.filter(p => !/^\d+$/.test(p));
  const ver = parts.filter(p => /^\d+$/.test(p)).join('.');
  if (!name.length) return s.model;
  return [name.map(w => w[0].toUpperCase() + w.slice(1)).join(' '), ver].filter(Boolean).join(' ');
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
  switch (canonicalTool(tool)) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': case 'NotebookRead':
      return clip(relPath(str('file_path') || str('filePath') || str('notebook_path') || str('path') || str('dirPath'), cwd), 90);
    case 'Bash': case 'PowerShell':
      return clip(str('command'), 90);
    case 'Grep':
      return clip((str('pattern') || str('query')) + (str('path') ? ' · ' + relPath(str('path'), cwd) : ''), 90);
    case 'Glob':
      return clip(str('pattern') || str('query'), 90);
    case 'LS':
      return clip(relPath(str('path'), cwd), 90);
    case 'WebSearch':
      return clip(str('query'), 90);
    case 'WebFetch':
      return clip(str('url') || (Array.isArray(i.urls) && typeof i.urls[0] === 'string' ? i.urls[0] : ''), 90);
    case 'Task': case 'Agent':
      return clip(str('description') || str('subagent_type') || str('agent_type') || str('prompt'), 90);
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
