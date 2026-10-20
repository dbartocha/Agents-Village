/** Only session IDs and timing counters are persisted; no prompts, paths or tool inputs. */
import { readFileSync } from 'node:fs';
import type { SessionTiming } from '../../shared/src/index.ts';
import { savePrivateJson } from './atomic-json.ts';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function loadTimings(file: string): Map<string, SessionTiming> {
  let raw: string;
  try { raw = readFileSync(file, 'utf8'); }
  catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return new Map();
    throw err;
  }
  const body: unknown = JSON.parse(raw);
  if (!object(body) || body.version !== 1 || !Array.isArray(body.sessions)) throw new Error(`Invalid timing history: ${file}`);
  const records = new Map<string, SessionTiming>();
  for (const entry of body.sessions) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] || !object(entry[1])) {
      throw new Error(`Invalid timing entry: ${file}`);
    }
    const [id, t] = entry;
    if (!time(t.startedAt) || !time(t.since) || !time(t.workMs) || !time(t.waitMs) || !time(t.idleMs)
      || t.since < t.startedAt || records.has(id)
      || (t.endedAt !== undefined && (!time(t.endedAt) || t.endedAt < t.startedAt || t.endedAt > t.since))
      || t.workMs + t.waitMs + t.idleMs > (t.endedAt ?? t.since) - t.startedAt) {
      throw new Error(`Invalid timing counters: ${file}`);
    }
    // Never resume a persisted running state: time while the server was off is unobserved.
    records.set(id, {
      startedAt: t.startedAt, since: t.since, workMs: t.workMs, waitMs: t.waitMs, idleMs: t.idleMs,
      endedAt: t.endedAt,
    });
  }
  return records;
}

/** Atomic replacement. Callers serialize saves and report errors; a failed save keeps the old file. */
export async function saveTimings(file: string, records: ReadonlyMap<string, SessionTiming>): Promise<void> {
  const sessions = [...records].map(([id, t]) => [id, {
    startedAt: t.startedAt, since: t.since, workMs: t.workMs, waitMs: t.waitMs, idleMs: t.idleMs,
    endedAt: t.endedAt,
  }]);
  await savePrivateJson(file, { version: 1, sessions });
}
