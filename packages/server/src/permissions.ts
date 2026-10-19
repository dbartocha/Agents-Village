import type { Decision } from '../../shared/src/index.ts';

interface Waiter {
  resolve: (decision: Decision | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Holds PermissionRequest hook calls open until the human clicks Allow or Deny in the village.
 * wait() resolves with the decision, or null when time runs out or the request is cancelled.
 */
export class PermissionBroker {
  private readonly waiting = new Map<string, Waiter>();

  wait(id: string, timeoutMs: number): Promise<Decision | null> {
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finish(id, null), timeoutMs);
      this.waiting.set(id, { resolve, timer });
    });
  }

  /** Returns false when nobody is waiting for this id any more (already answered, timed out or cancelled). */
  decide(id: string, decision: Decision): boolean {
    return this.finish(id, decision);
  }

  cancel(id: string): boolean {
    return this.finish(id, null);
  }

  has(id: string): boolean {
    return this.waiting.has(id);
  }

  get size(): number {
    return this.waiting.size;
  }

  cancelAll(): void {
    for (const id of [...this.waiting.keys()]) this.finish(id, null);
  }

  private finish(id: string, decision: Decision | null): boolean {
    const w = this.waiting.get(id);
    if (!w) return false;
    this.waiting.delete(id);
    clearTimeout(w.timer);
    w.resolve(decision);
    return true;
  }
}

/** Body Claude Code expects from a PermissionRequest hook. An empty body means "no decision". */
export function permissionHookResponse(decision: Decision): string {
  const body = decision === 'allow'
    ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }
    : { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied from Agent Village.' } } };
  return JSON.stringify(body);
}
