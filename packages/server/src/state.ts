import {
  PROTOCOL_VERSION, QUESTION_TOOLS, ROBOT_NAMES, clip, projectName, stationForTool, summarizeTool,
} from '../../shared/src/index.ts';
import type {
  Activity, ActivityKind, HookPayload, Resolution, ServerMessage, SessionInfo, Snapshot,
} from '../../shared/src/index.ts';

export interface StateOptions {
  approvals: boolean;
  approvalTimeoutSec: number;
  now?: () => number;
  recentLimit?: number;
  /** How long an ended session stays visible so its robot can walk away. */
  endedTtlMs?: number;
  /** Sessions with no events for this long are removed (Claude Code was closed without SessionEnd). */
  staleTtlMs?: number;
}

export interface HookOutcome {
  activities: Activity[];
  /** Set when the server should hold the HTTP response until the human decides in the village. */
  holdPermissionId?: string;
}

type Listener = (msg: ServerMessage) => void;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * In-memory picture of every Claude Code session the village knows about.
 * Hooks go in through handleHook(); everything that changes is broadcast to listeners (the SSE stream).
 */
export class VillageState {
  readonly sessions = new Map<string, SessionInfo>();
  readonly recent: Activity[] = [];
  private seq = 0;
  private permSeq = 0;
  private readonly listeners = new Set<Listener>();
  private readonly now: () => number;
  private readonly opts: Required<Omit<StateOptions, 'now'>>;

  constructor(options: StateOptions) {
    this.now = options.now ?? Date.now;
    this.opts = {
      approvals: options.approvals,
      approvalTimeoutSec: options.approvalTimeoutSec,
      recentLimit: options.recentLimit ?? 400,
      endedTtlMs: options.endedTtlMs ?? 15_000,
      staleTtlMs: options.staleTtlMs ?? 3 * 60 * 60 * 1000,
    };
  }

  get approvals(): boolean { return this.opts.approvals; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  snapshot(version: string): Snapshot {
    return {
      protocol: PROTOCOL_VERSION,
      version,
      approvals: this.opts.approvals,
      sessions: [...this.sessions.values()].map(s => structuredClone(s)),
      recent: this.recent.slice(-200),
    };
  }

  handleHook(p: HookPayload): HookOutcome {
    const now = this.now();
    const s = this.ensureSession(p, now);
    const out: Activity[] = [];
    const emit = (kind: ActivityKind, extra: Partial<Activity> = {}) => { out.push(this.emit(s, kind, extra)); };
    const agentType = str(p.agent_type) || undefined;

    switch (p.hook_event_name) {
      case 'SessionStart': {
        s.status = 'idle';
        if (str(p.model)) s.model = str(p.model);
        emit('session_start', { text: str(p.source) || undefined });
        break;
      }
      case 'UserPromptSubmit': {
        this.clearPending(s, 'cancelled', emit);
        s.prompt = clip(p.prompt, 500);
        s.status = 'thinking';
        s.attentionText = undefined;
        emit('prompt', { text: s.prompt });
        break;
      }
      case 'PreToolUse': {
        const tool = str(p.tool_name) || 'Tool';
        const target = summarizeTool(tool, p.tool_input, s.cwd);
        const station = stationForTool(tool);
        const toolUseId = str(p.tool_use_id) || undefined;
        // A new tool call means any earlier prompt was answered in the terminal.
        this.clearPending(s, 'terminal', emit);
        s.currentTool = { tool, target, station, toolUseId, startedAt: now };
        s.toolCount += 1;
        // Update the session before emitting, so every activity carries the state it leads to.
        const asks = QUESTION_TOOLS.has(tool);
        s.status = asks ? 'asking' : 'working';
        if (asks) s.attentionText = target;
        emit('tool', { tool, target, station, toolUseId, agentType });
        if (asks) emit('attention', { attention: 'question', text: target, tool });
        break;
      }
      case 'PermissionRequest': {
        const tool = str(p.tool_name) || s.currentTool?.tool || 'Tool';
        const target = summarizeTool(tool, p.tool_input, s.cwd) || s.currentTool?.target || '';
        const id = `perm-${++this.permSeq}`;
        const approvable = this.opts.approvals;
        s.pending = {
          id, tool, target, createdAt: now, approvable,
          expiresAt: approvable ? now + this.opts.approvalTimeoutSec * 1000 : undefined,
        };
        s.status = 'waiting';
        emit('permission', { tool, target, permissionId: id, attention: 'permission' });
        return { activities: out, holdPermissionId: approvable ? id : undefined };
      }
      case 'Notification': {
        const type = str(p.notification_type);
        const message = clip(p.message, 220);
        if (type === 'permission_prompt' || (!type && /permission/i.test(message))) {
          if (!s.pending) {
            s.pending = {
              id: `perm-${++this.permSeq}`,
              tool: s.currentTool?.tool ?? '',
              target: s.currentTool?.target ?? message,
              createdAt: now,
              approvable: false,
            };
          }
          s.status = 'waiting';
          s.attentionText = message;
          emit('attention', { attention: 'permission', text: message, permissionId: s.pending.id });
        } else if (type === 'idle_prompt') {
          s.status = 'idle';
          emit('attention', { attention: 'idle', text: message });
        } else if (['agent_needs_input', 'elicitation_dialog', 'elicitation_url_dialog'].includes(type)) {
          s.status = 'asking';
          s.attentionText = message;
          emit('attention', { attention: 'question', text: message });
        } else {
          emit('attention', { attention: 'info', text: message || type });
        }
        break;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const failed = p.hook_event_name === 'PostToolUseFailure';
        const tool = str(p.tool_name) || s.currentTool?.tool || 'Tool';
        const toolUseId = str(p.tool_use_id) || undefined;
        // The tool ran, so a permission that was still open was granted in the terminal.
        this.clearPending(s, 'terminal', emit);
        const error = failed ? clip(p.error ?? p.tool_response ?? '', 200) : undefined;
        if (s.currentTool && (!toolUseId || !s.currentTool.toolUseId || s.currentTool.toolUseId === toolUseId)) s.currentTool = undefined;
        if (QUESTION_TOOLS.has(tool)) s.attentionText = undefined;
        s.status = 'thinking';
        emit(failed ? 'tool_failed' : 'tool_done', { tool, toolUseId, text: error || undefined, agentType });
        break;
      }
      case 'Stop':
      case 'StopFailure': {
        this.clearPending(s, 'cancelled', emit);
        s.status = 'idle';
        s.currentTool = undefined;
        s.attentionText = undefined;
        const text = clip(p.last_assistant_message ?? p.error ?? '', 300);
        s.lastMessage = text || s.lastMessage;
        emit('stop', { text: text || undefined });
        break;
      }
      case 'SubagentStart': {
        s.subagents += 1;
        emit('subagent_start', { agentType });
        break;
      }
      case 'SubagentStop': {
        s.subagents = Math.max(0, s.subagents - 1);
        emit('subagent_stop', { agentType });
        break;
      }
      case 'SessionEnd': {
        this.clearPending(s, 'cancelled', emit);
        s.status = 'ended';
        s.currentTool = undefined;
        emit('session_end', { text: str(p.reason) || undefined });
        break;
      }
      default:
        // Unknown or not-yet-mapped event: the session was touched, nothing to animate.
        break;
    }
    return { activities: out };
  }

  /** Called when the human answers in the village, or when waiting ends without an answer. */
  resolvePermission(id: string, resolution: Resolution): SessionInfo | undefined {
    for (const s of this.sessions.values()) {
      if (s.pending?.id !== id) continue;
      s.pending = undefined;
      s.attentionText = undefined;
      if (resolution === 'allow') s.status = 'working';
      else s.status = 'thinking';
      // timeout: Claude Code now shows its own prompt in the terminal, so the robot keeps waiting.
      if (resolution === 'timeout') {
        s.status = 'waiting';
        s.pending = { id, tool: s.currentTool?.tool ?? '', target: s.currentTool?.target ?? '', createdAt: this.now(), approvable: false };
      }
      this.emit(s, 'permission_resolved', { permissionId: id, resolution });
      return s;
    }
    return undefined;
  }

  /** Removes sessions that ended a while ago or went silent. Returns removed ids. */
  prune(): string[] {
    const now = this.now();
    const removed: string[] = [];
    for (const [id, s] of this.sessions) {
      const age = now - s.updatedAt;
      if ((s.status === 'ended' && age > this.opts.endedTtlMs) || age > this.opts.staleTtlMs) {
        this.sessions.delete(id);
        removed.push(id);
        this.broadcast({ type: 'removed', sessionId: id });
      }
    }
    return removed;
  }

  private ensureSession(p: HookPayload, now: number): SessionInfo {
    let s = this.sessions.get(p.session_id);
    if (!s) {
      const { name, f } = this.pickName();
      s = {
        id: p.session_id, name, f,
        cwd: str(p.cwd), project: projectName(str(p.cwd)),
        status: 'idle', startedAt: now, updatedAt: now, subagents: 0, toolCount: 0,
      };
      this.sessions.set(s.id, s);
    } else if (s.status === 'ended' && p.hook_event_name !== 'SessionEnd') {
      s.status = 'idle';
    }
    if (str(p.cwd) && str(p.cwd) !== s.cwd) { s.cwd = str(p.cwd); s.project = projectName(s.cwd); }
    s.updatedAt = now;
    return s;
  }

  private pickName(): { name: string; f: boolean } {
    const used = new Set([...this.sessions.values()].map(s => s.name));
    const free = ROBOT_NAMES.find(n => !used.has(n.name));
    if (free) return { ...free };
    let i = 2;
    while (used.has(`Robo ${i}`)) i += 1;
    return { name: `Robo ${i}`, f: false };
  }

  private clearPending(s: SessionInfo, resolution: Resolution, emit: (k: ActivityKind, e?: Partial<Activity>) => void): void {
    if (!s.pending) return;
    const id = s.pending.id;
    s.pending = undefined;
    if (s.status === 'waiting') { s.attentionText = undefined; s.status = 'thinking'; }
    emit('permission_resolved', { permissionId: id, resolution });
  }

  private emit(s: SessionInfo, kind: ActivityKind, extra: Partial<Activity>): Activity {
    const activity: Activity = { seq: ++this.seq, at: this.now(), sessionId: s.id, kind, ...extra };
    for (const k of Object.keys(activity) as Array<keyof Activity>) if (activity[k] === undefined) delete activity[k];
    this.recent.push(activity);
    if (this.recent.length > this.opts.recentLimit) this.recent.splice(0, this.recent.length - this.opts.recentLimit);
    s.updatedAt = activity.at;
    this.broadcast({ type: 'activity', activity, session: structuredClone(s) });
    return activity;
  }

  private broadcast(msg: ServerMessage): void {
    for (const fn of this.listeners) {
      try { fn(msg); } catch { /* a broken listener must not stop the others */ }
    }
  }
}
