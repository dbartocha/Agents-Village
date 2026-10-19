/**
 * Where robots come from. The live source reads the village server; the demo source simulates agents.
 * Both speak the same ServerMessage format, so the town has one code path.
 */
import type { Decision, Localized, ServerMessage, Text } from '../../../shared/src/index.ts';

export type SourceState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'demo';

export interface Sink {
  message(m: ServerMessage): void;
  /** Chat line in a robot's log (demo only). */
  say(sessionId: string, who: 'you' | 'robot', text: Text, at?: number, quiet?: boolean): void;
  /** System line in the feed (i18n key). */
  system(key: string): void;
  state(s: SourceState): void;
}

/** Things only the demo can do. Live agents are steered from the Claude Code terminal (stage 3 will change that). */
export interface DemoControls {
  answer(sessionId: string, answer: Text): void;
  giveTask(sessionId: string, task: string): void;
  message(sessionId: string, text: string): void;
  halt(sessionId: string): void;
  /** Returns the new session id, or null when the town is full. */
  spawn(name: string, f: boolean, task: string): string | null;
  freeName(): { name: string; f: boolean };
  readonly suggestions: readonly Localized[];
}

export interface Source {
  readonly kind: 'live' | 'demo';
  start(sink: Sink): void;
  stop(): void;
  /** Answers a permission request. Rejects with a readable message when it is too late. */
  decide(sessionId: string, permissionId: string, decision: Decision): Promise<void>;
  readonly demo?: DemoControls;
}
