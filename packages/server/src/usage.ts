/**
 * Tokens per robot, read from the Claude Code transcript of each session (see readme.adoc → "Earned tokens").
 *
 * Every hook payload carries transcript_path. After Stop, SubagentStop, PostToolUse and SessionEnd the
 * transcript is read ~1.5 s later (Claude Code writes it asynchronously), never inside the hook request.
 * Long active tasks also read and pay new usage every ten minutes from the server poll.
 * Reads are incremental: a byte offset per file and the unfinished last line are kept for the next read.
 * Claude Code writes one line per content block, all with the same message.id and usage, so each
 * message.id is counted once (later lines of the same message only add what grew).
 *
 * Safety: only files ending in .jsonl whose real path lies inside the Claude config folder
 * (CLAUDE_CONFIG_DIR or ~/.claude) are read, read-only. Only the four token counters and the model id
 * are kept; nothing from the transcript is stored or sent anywhere.
 */
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { payoutPeriod, totalTokens } from '../../shared/src/index.ts';
import type { HookPayload, SessionInfo, TokenUsage } from '../../shared/src/index.ts';
import { JsonlTail } from './jsonl-tail.ts';

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/** The real path of a transcript we may read, or null. */
export async function allowedTranscript(path: string, claudeDir: string): Promise<string | null> {
  if (typeof path !== 'string' || !path.toLowerCase().endsWith('.jsonl')) return null;
  try {
    const [file, root] = await Promise.all([realpath(path), realpath(claudeDir)]);
    const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
    if (!file.toLowerCase().endsWith('.jsonl')) return null;
    return norm(file).startsWith(norm(root.endsWith(sep) ? root : root + sep)) ? file : null;
  } catch {
    return null;
  }
}

const EMPTY = (): TokenUsage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
const KEYS = ['input', 'output', 'cacheWrite', 'cacheRead'] as const;
const MAX_SEEN = 4000;

/** Incremental reader of one transcript file. */
export class TranscriptFile {
  readonly total = EMPTY();
  model?: string;
  private readonly tail = new JsonlTail();
  private readonly seen = new Map<string, TokenUsage>();

  /** Reads what was appended since the last call. Returns true when the totals grew. */
  async readNew(path: string): Promise<boolean> {
    let grew = false;
    await this.tail.read(path, text => { if (this.line(text)) grew = true; });
    return grew;
  }

  private line(text: string): boolean {
    if (!text.includes('"assistant"') || !text.includes('"usage"')) return false;
    let o: { type?: unknown; uuid?: unknown; message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> } };
    try { o = JSON.parse(text); } catch { return false; }
    const m = o?.message;
    if (o?.type !== 'assistant' || !m || !m.usage || typeof m.usage !== 'object') return false;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
    const u: TokenUsage = {
      input: n(m.usage.input_tokens), output: n(m.usage.output_tokens),
      cacheWrite: n(m.usage.cache_creation_input_tokens), cacheRead: n(m.usage.cache_read_input_tokens),
    };
    if (typeof m.model === 'string' && m.model && !m.model.startsWith('<')) this.model = m.model;
    const id = typeof m.id === 'string' ? m.id : typeof o.uuid === 'string' ? o.uuid : '';
    const prev = id ? this.seen.get(id) : undefined;
    let grew = false;
    const kept = prev ?? EMPTY();
    for (const k of KEYS) {
      if (u[k] > kept[k]) { this.total[k] += u[k] - kept[k]; kept[k] = u[k]; grew = true; }
    }
    if (id && !prev) {
      this.seen.set(id, kept);
      if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.keys().next().value as string);
    }
    return grew;
  }
}

export interface UsageTrackerOptions {
  claudeDir?: string;
  /** Wait after a hook before reading; the transcript can lag behind hooks. */
  delayMs?: number;
  onUsage: (sessionId: string, usage: TokenUsage, model?: string) => void;
  onEarned: (sessionId: string, tokens: number, cumulativeTokens: number) => void;
  log?: (line: string) => void;
}

interface SessionUsage {
  paths: Set<string>;
  files: Map<string, TranscriptFile>;
  earnedBase: number;
  timer?: ReturnType<typeof setTimeout>;
  wantEarned: boolean;
  chain: Promise<void>;
  payoutTask?: number;
  payoutPeriod?: number;
}

const READ_AFTER = new Set(['Stop', 'StopFailure', 'SubagentStop', 'PostToolUse', 'PostToolUseFailure', 'SessionEnd']);
const EARN_AFTER = new Set(['Stop', 'StopFailure', 'SessionEnd']);

/** Keeps token totals per Claude Code session and tells the state when they change. */
export class UsageTracker {
  private readonly sessions = new Map<string, SessionUsage>();
  private readonly claudeDir: string;
  private readonly delayMs: number;
  private readonly opts: UsageTrackerOptions;

  constructor(opts: UsageTrackerOptions) {
    this.opts = opts;
    this.claudeDir = opts.claudeDir ?? claudeConfigDir();
    this.delayMs = opts.delayMs ?? 1500;
  }

  /** Called for every Claude Code hook, after the hook was answered or handled. Never reads here. */
  onHook(p: HookPayload): void {
    const rec = this.record(p.session_id);
    if (typeof p.transcript_path === 'string' && p.transcript_path) rec.paths.add(p.transcript_path);
    // A subagent writes its own transcript; its tokens count for the parent robot.
    if (p.hook_event_name === 'SubagentStop' && typeof p.agent_transcript_path === 'string' && p.agent_transcript_path) rec.paths.add(p.agent_transcript_path);
    if (!READ_AFTER.has(p.hook_event_name)) return;
    if (EARN_AFTER.has(p.hook_event_name)) rec.wantEarned = true;
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = setTimeout(() => { rec.timer = undefined; void this.read(p.session_id); }, this.delayMs);
    rec.timer.unref?.();
  }

  /** Reads the session's transcripts now (queued after any running read). */
  read(sessionId: string): Promise<void> {
    const rec = this.sessions.get(sessionId);
    if (!rec) return Promise.resolve();
    rec.chain = rec.chain.then(() => this.readOnce(sessionId, rec)).catch(err => {
      this.opts.log?.(`usage ${sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
    });
    return rec.chain;
  }

  /** Read and pay ongoing tasks at ten-minute boundaries, even if no new hook arrives. */
  async poll(sessions: Iterable<SessionInfo>, now = Date.now()): Promise<void> {
    const reads: Promise<void>[] = [];
    for (const s of sessions) {
      const rec = this.sessions.get(s.id);
      if (!rec || s.provider !== 'claude' || s.taskStartedAt === undefined
        || (s.status !== 'working' && s.status !== 'thinking')) continue;
      if (rec.payoutTask !== s.taskStartedAt) {
        rec.payoutTask = s.taskStartedAt;
        rec.payoutPeriod = 0;
      }
      const period = payoutPeriod(s.taskStartedAt, now);
      if (period <= (rec.payoutPeriod ?? 0)) continue;
      rec.payoutPeriod = period;
      rec.wantEarned = true;
      reads.push(this.read(s.id));
    }
    await Promise.all(reads);
  }

  /** Resolves when every scheduled and running read is done (tests). */
  async idle(): Promise<void> {
    for (const rec of this.sessions.values()) await rec.chain;
  }

  forget(sessionId: string): void {
    const rec = this.sessions.get(sessionId);
    if (rec?.timer) clearTimeout(rec.timer);
    this.sessions.delete(sessionId);
  }

  stop(): void {
    for (const rec of this.sessions.values()) if (rec.timer) clearTimeout(rec.timer);
  }

  private record(id: string): SessionUsage {
    let rec = this.sessions.get(id);
    if (!rec) {
      rec = { paths: new Set(), files: new Map(), earnedBase: 0, wantEarned: false, chain: Promise.resolve() };
      this.sessions.set(id, rec);
    }
    return rec;
  }

  private async readOnce(sessionId: string, rec: SessionUsage): Promise<void> {
    const wantEarned = rec.wantEarned;
    rec.wantEarned = false;
    let grew = false;
    for (const path of rec.paths) {
      const real = await allowedTranscript(path, this.claudeDir);
      if (!real) continue;
      let f = rec.files.get(real);
      if (!f) { f = new TranscriptFile(); rec.files.set(real, f); }
      try { if (await f.readNew(real)) grew = true; }
      catch (err) {
        this.opts.log?.(`usage ${sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
        if (wantEarned) { rec.wantEarned = true; rec.payoutPeriod = undefined; }
      }
    }
    const total = EMPTY();
    for (const f of rec.files.values()) {
      for (const k of KEYS) total[k] += f.total[k];
    }
    // The model of the main transcript (the first path) wins over subagent models.
    const model = [...rec.files.values()][0]?.model;
    if (grew) this.opts.onUsage(sessionId, total, model);
    if (wantEarned) {
      const sum = totalTokens(total);
      const delta = sum - rec.earnedBase;
      if (delta > 0) {
        try { this.opts.onEarned(sessionId, delta, sum); }
        catch (err) { rec.wantEarned = true; rec.payoutPeriod = undefined; throw err; }
        rec.earnedBase = sum;
      }
    }
  }
}
