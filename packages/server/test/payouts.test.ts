import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { localDay } from '../../shared/src/index.ts';
import type { ServerMessage } from '../../shared/src/index.ts';
import { PayoutLedger } from '../src/payouts.ts';
import { VillageState } from '../src/state.ts';

const yesterday = new Date(2026, 9, 19, 23, 59).getTime();
const today = new Date(2026, 9, 20, 0, 1).getTime();

test('daily payouts keep units separate and only pay cumulative increases', () => {
  const ledger = new PayoutLedger();
  assert.equal(ledger.earnings('unknown'), undefined);
  assert.equal(ledger.pay('zero', 'nanoAic', 0, today), 0);
  assert.deepEqual(ledger.earnings('zero'), { unit: 'nanoAic', total: 0 });
  assert.equal(ledger.pay('copilot:a', 'nanoAic', 100e9, yesterday), 100e9);
  assert.equal(ledger.pay('copilot:a', 'nanoAic', 125e9, today), 25e9);
  assert.equal(ledger.pay('copilot:a', 'nanoAic', 125e9, today), 0);
  assert.equal(ledger.pay('copilot:a', 'nanoAic', 110e9, yesterday), 0);
  assert.equal(ledger.pay('claude:a', 'tokens', 6000, today), 6000);
  assert.deepEqual(ledger.daily(today), { day: localDay(today), tokens: 6000, nanoAic: 25e9 });
  assert.deepEqual(ledger.daily(yesterday), { day: localDay(yesterday), tokens: 0, nanoAic: 100e9 });
  assert.throws(() => ledger.pay('copilot:a', 'tokens', 200e9, today), /mix/);
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => ledger.pay('invalid', 'tokens', amount, today), /Invalid payout/);
  }
  assert.throws(() => ledger.pay('invalid', 'tokens', 10, NaN), /Invalid payout/);
  ledger.pay('huge', 'tokens', Number.MAX_SAFE_INTEGER - 6000, today);
  assert.throws(() => ledger.pay('overflow', 'tokens', 1, today), /safe integer/);
  assert.equal(ledger.earnings('overflow'), undefined, 'failed payout is not recorded');
});

test('atomic private ledger restores totals and replay high-water marks together', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'av-payouts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'payouts.json');
  const first = PayoutLedger.load(file);
  first.pay('copilot:one', 'nanoAic', 1555360500000, today);
  first.pay('claude:one', 'tokens', 6789, today);
  await first.save(file);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const saved = readFileSync(file, 'utf8');
  assert.doesNotMatch(saved, /prompt|transcript|cwd|model|tool/);
  const second = PayoutLedger.load(file);
  assert.deepEqual(second.daily(today), first.daily(today));
  assert.equal(second.pay('copilot:one', 'nanoAic', 1555360500000, today), 0);
  assert.equal(second.pay('claude:one', 'tokens', 6789, today), 0);
  assert.equal(second.pay('copilot:one', 'nanoAic', 1556360500000, today), 1e9);
  await second.save(file);
  assert.equal(PayoutLedger.load(file).daily(today).nanoAic, 1556360500000);
  for (const invalid of ['{', '{}', '{"version":2,"sessions":[],"days":[]}',
    '{"version":1,"sessions":[["a",{"unit":"usd","total":1}]],"days":[]}',
    '{"version":1,"sessions":[],"days":[{"day":"2026-10-20","tokens":-1,"nanoAic":0}]}']) {
    writeFileSync(file, invalid);
    assert.throws(() => PayoutLedger.load(file));
  }
});

test('state broadcasts daily rollover and earnings without changing the working state', () => {
  let now = yesterday;
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60, now: () => now });
  const messages: ServerMessage[] = [];
  state.subscribe(m => messages.push(m));
  state.handleHook({ hook_event_name: 'PreToolUse', session_id: 'copilot:a', tool_name: 'Bash' }, 'copilot');
  state.pay('copilot:a', 'nanoAic', 20e9);
  assert.equal(state.sessions.get('copilot:a')!.status, 'working');
  assert.ok(messages.some(m => m.type === 'activity' && m.activity.nanoAic === 20e9 && m.activity.tokens === undefined));
  now = today;
  state.checkpointTimings();
  const lastBank = messages.filter(m => m.type === 'bank').at(-1);
  assert.deepEqual(lastBank?.bank.daily, { day: localDay(today), tokens: 0, nanoAic: 0 });
  state.pay('copilot:a', 'nanoAic', 22e9);
  assert.equal(state.bank.daily?.nanoAic, 2e9);
  const resumed = new VillageState({ approvals: false, approvalTimeoutSec: 60, payouts: state.payouts, now: () => now });
  assert.equal(resumed.sessions.size, 0);
  resumed.handleHook({ hook_event_name: 'SessionStart', session_id: 'copilot:a' }, 'copilot');
  assert.equal(resumed.sessions.get('copilot:a')!.earnings?.total, 22e9);
  assert.equal(resumed.pay('copilot:a', 'nanoAic', 22e9), undefined);
  assert.equal(resumed.bank.daily?.nanoAic, 2e9);
  assert.throws(() => resumed.pay('copilot:a', 'tokens', 22e9), /Wrong payout unit/);
});
