import { timingSafeEqual } from 'node:crypto';
import type { VillageState } from './state.ts';

interface Lease {
  secret: string;
  sessionId: string;
  seen: number;
  stopping: boolean;
}

export class ControlError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Launchers poll for their own commands; the server never accepts a PID or executable from the browser. */
export class ManagedSessions {
  private readonly leases = new Map<string, Lease>();
  private readonly state: VillageState;
  private readonly now: () => number;

  constructor(state: VillageState, now = Date.now) { this.state = state; this.now = now; }

  poll(body: unknown): { stop: boolean; sessionId: string } {
    if (!body || typeof body !== 'object') throw new ControlError(400, 'Invalid launcher request');
    const b = body as Record<string, unknown>;
    const { launcherId, secret, sessionId, phase, error } = b;
    if (typeof launcherId !== 'string' || !/^[a-f0-9-]{36}$/.test(launcherId)
      || typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)
      || typeof sessionId !== 'string' || !sessionId || sessionId.length > 200
      || !['running', 'ended', 'error'].includes(String(phase))
      || (phase === 'error' && (typeof error !== 'string' || !error || error.length > 300))) {
      throw new ControlError(400, 'Invalid launcher request');
    }
    this.expire();
    const old = this.leases.get(launcherId);
    if (old && !timingSafeEqual(Buffer.from(old.secret), Buffer.from(secret))) throw new ControlError(403, 'Wrong launcher identity');
    const s = this.state.sessions.get(sessionId);
    if (!s) throw new ControlError(409, 'Session not observed yet');
    for (const [id, lease] of this.leases) {
      if (id !== launcherId && lease.sessionId === sessionId) throw new ControlError(409, 'Session belongs to another launcher');
    }
    if (phase === 'ended') {
      if (!old || old.sessionId !== sessionId) throw new ControlError(409, 'Launcher session changed');
      this.leases.delete(launcherId);
      this.state.setControl(sessionId, undefined);
      if (s.status !== 'ended') this.state.handleHook({ session_id: sessionId, hook_event_name: 'SessionEnd', reason: 'launcher_exit' }, s.provider);
      return { stop: false, sessionId };
    }
    if (old && old.sessionId !== sessionId) this.state.setControl(old.sessionId, undefined);
    const stopping = phase === 'running' && old?.sessionId === sessionId && old.stopping;
    this.leases.set(launcherId, { secret, sessionId, seen: this.now(), stopping: !!stopping });
    this.state.setControl(sessionId, {
      launcherId, status: stopping ? 'stopping' : 'ready',
      ...(phase === 'error' ? { error: String(error) } : old?.sessionId === sessionId && s.control?.error ? { error: s.control.error } : {}),
    });
    return { stop: !!stopping, sessionId };
  }

  requestStop(sessionId: string, launcherId: unknown): void {
    this.expire();
    const lease = typeof launcherId === 'string' ? this.leases.get(launcherId) : undefined;
    const s = this.state.sessions.get(sessionId);
    if (!lease || lease.sessionId !== sessionId || !s || s.status === 'ended') {
      throw new ControlError(409, 'No active launcher for this session. Close it in its terminal.');
    }
    lease.stopping = true;
    this.state.setControl(sessionId, { launcherId: String(launcherId), status: 'stopping' });
  }

  expire(): void {
    for (const [id, lease] of this.leases) {
      if (this.now() - lease.seen <= 8000) continue;
      this.leases.delete(id);
      this.state.setControl(lease.sessionId, undefined);
    }
  }
}
