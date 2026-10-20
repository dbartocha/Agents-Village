import { readFileSync } from 'node:fs';
import { localDay } from '../../shared/src/index.ts';
import type { DailyPayouts, PayoutUnit, SessionEarnings } from '../../shared/src/index.ts';
import { savePrivateJson } from './atomic-json.ts';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Daily totals and per-session high-water marks are saved together to prevent replayed payouts. */
export class PayoutLedger {
  private readonly sessions = new Map<string, SessionEarnings>();
  private readonly days = new Map<string, DailyPayouts>();

  static load(file: string): PayoutLedger {
    const ledger = new PayoutLedger();
    let raw: string;
    try { raw = readFileSync(file, 'utf8'); }
    catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return ledger;
      throw err;
    }
    const body: unknown = JSON.parse(raw);
    if (!object(body) || body.version !== 1 || !Array.isArray(body.sessions) || !Array.isArray(body.days)) {
      throw new Error(`Invalid payout history: ${file}`);
    }
    for (const row of body.sessions) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || !row[0] || !object(row[1])
        || !['tokens', 'nanoAic'].includes(String(row[1].unit)) || !count(row[1].total) || ledger.sessions.has(row[0])) {
        throw new Error(`Invalid session payout: ${file}`);
      }
      const unit = row[1].unit === 'tokens' ? 'tokens' : 'nanoAic';
      ledger.sessions.set(row[0], { unit, total: row[1].total });
    }
    for (const row of body.days) {
      if (!object(row) || typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
        || !count(row.tokens) || !count(row.nanoAic) || ledger.days.has(row.day)) {
        throw new Error(`Invalid daily payout: ${file}`);
      }
      ledger.days.set(row.day, { day: row.day, tokens: row.tokens, nanoAic: row.nanoAic });
    }
    return ledger;
  }

  earnings(id: string): SessionEarnings | undefined {
    const value = this.sessions.get(id);
    return value ? { ...value } : undefined;
  }

  daily(at: number): DailyPayouts {
    const day = localDay(at);
    return { ...(this.days.get(day) ?? { day, tokens: 0, nanoAic: 0 }) };
  }

  /** The source reports a cumulative total; repeated and older checkpoints pay nothing. */
  pay(id: string, unit: PayoutUnit, total: number, at: number): number {
    if (!count(total) || !Number.isFinite(at) || !Number.isFinite(new Date(at).getTime())) throw new Error('Invalid payout amount or date');
    const previous = this.sessions.get(id);
    if (previous && previous.unit !== unit) throw new Error('Cannot mix payout units for one session');
    if (previous && total <= previous.total) return 0;
    const delta = total - (previous?.total ?? 0);
    const daily = this.daily(at);
    if (!count(daily[unit] + delta)) throw new Error('Daily payout exceeds the safe integer range');
    daily[unit] += delta;
    this.days.set(daily.day, daily);
    this.sessions.set(id, { unit, total });
    return delta;
  }

  save(file: string): Promise<void> {
    return savePrivateJson(file, { version: 1, sessions: [...this.sessions], days: [...this.days.values()] });
  }
}
