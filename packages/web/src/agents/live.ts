/** Live source: Server-Sent Events from the village server, decisions over POST. */
import type { Decision, ServerMessage } from '../../../shared/src/index.ts';
import type { Sink, Source } from './source';

const PLACEHOLDER = '__AGENT_VILLAGE_' + 'TOKEN__';

/** The token the server injected into index.html (empty when the page was not served by it). */
export function pageToken(): string {
  const v = document.querySelector<HTMLMetaElement>('meta[name="agent-village-token"]')?.content ?? '';
  return v && v !== PLACEHOLDER ? v : '';
}

export interface Health { ok: boolean; name?: string; version?: string; approvals?: boolean; sessions?: number }

/** Asks the server if it is there. Resolves to null when nothing answers within the timeout. */
export async function probeServer(timeoutMs = 3000): Promise<Health | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return null;
    const h = (await res.json()) as Health;
    return h && h.ok ? h : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class LiveSource implements Source {
  readonly kind = 'live' as const;
  private es: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private announced = false;

  private readonly token: string;

  constructor(token: string) { this.token = token; }

  start(sink: Sink): void {
    this.stopped = false;
    sink.state('connecting');
    this.connect(sink);
  }

  private connect(sink: Sink): void {
    if (this.stopped) return;
    const es = new EventSource('/events?token=' + encodeURIComponent(this.token));
    this.es = es;
    const handle = (e: MessageEvent<string>) => {
      try { sink.message(JSON.parse(e.data) as ServerMessage); } catch (err) { console.warn('[agent-village] bad message', err); }
    };
    es.addEventListener('snapshot', e => {
      sink.state('live');
      if (!this.announced) { this.announced = true; sink.system('sysLive'); }
      handle(e as MessageEvent<string>);
    });
    es.addEventListener('activity', e => handle(e as MessageEvent<string>));
    es.addEventListener('removed', e => handle(e as MessageEvent<string>));
    es.onerror = () => {
      if (this.stopped) return;
      if (es.readyState === EventSource.CLOSED) {
        // The browser gave up (server down or token rejected). Try again from scratch.
        sink.state('offline');
        es.close();
        this.retry = setTimeout(() => this.connect(sink), 3000);
      } else {
        sink.state('reconnecting');
      }
    };
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.es?.close();
    this.es = null;
  }

  async decide(_sessionId: string, permissionId: string, decision: Decision): Promise<void> {
    const res = await fetch('/api/permissions/' + encodeURIComponent(permissionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Village-Token': this.token },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* keep the status */ }
      throw new Error(msg);
    }
  }
}
