/**
 * Copilot CLI's local, cumulative AIC checkpoints. No billing API or credentials.
 * This is an internal CLI format: absent/unsupported data is reported, never treated as zero.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { localDay } from '../../shared/src/index.ts';
import type { HookPayload } from '../../shared/src/index.ts';
import { COPILOT_ID_PREFIX } from './copilot.ts';
import { JsonlTail } from './jsonl-tail.ts';
import { allowedTranscript } from './usage.ts';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AicCheckpoint { total: number; at: number }

export class CopilotCheckpoints {
  private readonly tail = new JsonlTail();
  private known = false;

  async read(path: string): Promise<AicCheckpoint[]> {
    const days = new Map<string, AicCheckpoint>();
    await this.tail.read(path, text => {
      if (!text.includes('session.usage_checkpoint')) return;
      const event: unknown = JSON.parse(text);
      if (!object(event) || event.type !== 'session.usage_checkpoint') return;
      const total = object(event.data) ? event.data.totalNanoAiu : undefined;
      const at = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : event.timestamp;
      if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0
        || typeof at !== 'number' || !Number.isFinite(at) || !Number.isFinite(new Date(at).getTime())) {
        throw new Error('Unsupported Copilot AIC checkpoint format');
      }
      days.set(localDay(at), { total, at });
      this.known = true;
    });
    if (!this.known) throw new Error('No saved AIC checkpoint yet (or this Copilot version does not provide it)');
    return [...days.values()];
  }
}

interface Options {
  root?: string;
  onCheckpoint: (id: string, checkpoint: AicCheckpoint) => void;
  onError: (id: string, error?: string) => void;
  log: (message: string) => void;
}

interface TrackedSession {
  reader: CopilotCheckpoints;
  pending: AicCheckpoint[];
  reading?: Promise<void>;
  error?: string;
}

export class CopilotUsageTracker {
  private readonly records = new Map<string, TrackedSession>();
  private readonly root: string;
  private readonly opts: Options;
  private stopped = false;

  constructor(opts: Options) {
    this.opts = opts;
    this.root = opts.root ?? join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'session-state');
  }

  onHook(p: HookPayload): void {
    if (this.stopped) return;
    if (!this.records.has(p.session_id)) this.records.set(p.session_id, { reader: new CopilotCheckpoints(), pending: [] });
    void this.read(p.session_id);
  }

  async read(id: string): Promise<void> {
    const rec = this.records.get(id);
    if (!rec || this.stopped) return;
    if (rec.reading) return rec.reading;
    rec.reading = this.readOnce(id, rec).finally(() => { rec.reading = undefined; });
    return rec.reading;
  }

  async poll(): Promise<void> { await Promise.all([...this.records.keys()].map(id => this.read(id))); }

  forget(id: string): void { this.records.delete(id); }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all([...this.records.values()].map(r => r.reading));
  }

  private async readOnce(id: string, rec: TrackedSession): Promise<void> {
    try {
      const rawId = id.startsWith(COPILOT_ID_PREFIX) ? id.slice(COPILOT_ID_PREFIX.length) : '';
      if (!UUID.test(rawId)) throw new Error('Local AIC data is available only for Copilot CLI session IDs');
      const path = await allowedTranscript(join(this.root, rawId, 'events.jsonl'), this.root);
      if (!path) throw new Error('Copilot session file is missing or outside the allowed session directory');
      const checkpoints = await rec.reader.read(path);
      if (this.records.get(id) !== rec) return;
      rec.pending.push(...checkpoints);
      while (rec.pending.length) {
        this.opts.onCheckpoint(id, rec.pending[0]);
        rec.pending.shift();
      }
      if (rec.error) { rec.error = undefined; this.opts.onError(id); }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (rec.error !== message) {
        rec.error = message;
        this.opts.log(`Copilot AIC ${id.slice(-8)}: ${message}`);
        this.opts.onError(id, message);
      }
    }
  }
}
