import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { CopilotCheckpoints, CopilotUsageTracker } from '../src/copilot-usage.ts';
import type { AicCheckpoint } from '../src/copilot-usage.ts';
import { PayoutLedger } from '../src/payouts.ts';

const uuid = '11111111-2222-4333-8444-555555555555';
const id = `copilot:${uuid}`;
const at = new Date(2026, 9, 20, 10).getTime();
const checkpoint = (total: number, time = at) =>
  JSON.stringify({ type: 'session.usage_checkpoint', timestamp: new Date(time).toISOString(), data: { totalNanoAiu: total, totalPremiumRequests: 14 } }) + '\n';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'av-copilot-aic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'session-state');
  mkdirSync(join(root, uuid), { recursive: true });
  return { dir, root, file: join(root, uuid, 'events.jsonl') };
}

test('local checkpoints match CLI AIC, keep days separate and ignore per-call records', async t => {
  const { file } = fixture(t);
  const yesterday = new Date(2026, 9, 19, 23, 59).getTime();
  writeFileSync(file, checkpoint(100e9, yesterday) + checkpoint(500e9) +
    JSON.stringify({ type: 'session.usage_record', data: { usage: { cost: 1, copilotUsage: { totalNanoAiu: 1555360500000 } } } }) + '\n' +
    checkpoint(1555360500000));
  const reader = new CopilotCheckpoints();
  const values = await reader.read(file);
  assert.deepEqual(values, [{ total: 100e9, at: yesterday }, { total: 1555360500000, at }]);
  assert.equal((values[1].total / 1e9).toFixed(2), '1555.36');
  const ledger = new PayoutLedger();
  for (const value of values) ledger.pay(id, 'nanoAic', value.total, value.at);
  assert.equal(ledger.daily(at).nanoAic, 1455360500000);
  assert.deepEqual(await reader.read(file), []);
});

test('partial UTF-8 lines wait; known zero differs from unsupported or missing data', async t => {
  const { file } = fixture(t);
  writeFileSync(file, '');
  const reader = new CopilotCheckpoints();
  await assert.rejects(reader.read(file), /No saved AIC/);
  const text = Buffer.from(JSON.stringify({ type: 'note', text: 'Żółć' }) + '\n' + checkpoint(0));
  const split = text.indexOf(Buffer.from('Ż')) + 1;
  appendFileSync(file, text.subarray(0, split));
  await assert.rejects(reader.read(file), /No saved AIC/);
  appendFileSync(file, text.subarray(split, text.length - 1));
  await assert.rejects(reader.read(file), /No saved AIC/);
  appendFileSync(file, '\n');
  assert.deepEqual(await reader.read(file), [{ total: 0, at }]);
  appendFileSync(file, '{"type":"session.usage_checkpoint","timestamp":"2026-10-20T10:00:00Z","data":{}}\n');
  await assert.rejects(reader.read(file), /Unsupported/);
  await assert.rejects(reader.read(file), /Unsupported/, 'bad complete lines are not silently skipped');
});

test('a failed batch is retried without losing earlier valid checkpoints', async t => {
  const { file } = fixture(t);
  writeFileSync(file, checkpoint(10e9) + '{"type":"session.usage_checkpoint"\n');
  const reader = new CopilotCheckpoints();
  await assert.rejects(reader.read(file));
  writeFileSync(file, checkpoint(10e9) + checkpoint(20e9));
  assert.deepEqual(await reader.read(file), [{ total: 20e9, at }]);
});

test('tracker restores ledger without duplicate payments, polls, and reports/retries errors', async t => {
  const { dir, root, file } = fixture(t);
  const ledgerFile = join(dir, 'payouts.json');
  let ledger = new PayoutLedger();
  const errors: Array<string | undefined> = [];
  const deltas: number[] = [];
  let rejectPayout = false;
  const make = () => new CopilotUsageTracker({
    root, log: () => {},
    onError: (_id, error) => errors.push(error),
    onCheckpoint: (_id, c) => {
      if (rejectPayout) throw new Error('payout temporarily unavailable');
      deltas.push(ledger.pay(id, 'nanoAic', c.total, c.at));
    },
  });
  let tracker = make();
  tracker.onHook({ hook_event_name: 'SessionStart', session_id: id });
  await tracker.poll();
  assert.match(errors.at(-1)!, /missing/);
  writeFileSync(file, checkpoint(1555360500000));
  await tracker.poll();
  assert.equal(errors.at(-1), undefined);
  assert.deepEqual(deltas, [1555360500000]);
  await ledger.save(ledgerFile);
  await tracker.stop();
  ledger = PayoutLedger.load(ledgerFile);
  tracker = make();
  t.after(() => tracker.stop());
  tracker.onHook({ hook_event_name: 'PreToolUse', session_id: id });
  await Promise.all([tracker.poll(), tracker.poll()]);
  assert.deepEqual(deltas, [1555360500000, 0]);
  appendFileSync(file, checkpoint(1556360500000));
  rejectPayout = true;
  await tracker.poll();
  assert.match(errors.at(-1)!, /temporarily/);
  rejectPayout = false;
  await tracker.poll();
  assert.equal(errors.at(-1), undefined);
  assert.equal(deltas.at(-1), 1e9);
  assert.equal(ledger.daily(at).nanoAic, 1556360500000);
});

test('tracker rejects invalid IDs and symlinks outside its allowed root', async t => {
  const { dir, root, file } = fixture(t);
  const errors: string[] = [];
  const values: AicCheckpoint[] = [];
  const tracker = new CopilotUsageTracker({
    root, log: () => {}, onError: (_id, error) => { if (error) errors.push(error); },
    onCheckpoint: (_id, value) => values.push(value),
  });
  t.after(() => tracker.stop());
  tracker.onHook({ hook_event_name: 'SessionStart', session_id: 'copilot:../../outside' });
  await tracker.poll();
  assert.match(errors.at(-1)!, /session IDs/);
  const outside = join(dir, 'outside.jsonl');
  writeFileSync(outside, checkpoint(1e9));
  symlinkSync(outside, file);
  tracker.onHook({ hook_event_name: 'SessionStart', session_id: id });
  await tracker.poll();
  assert.match(errors.at(-1)!, /outside/);
  assert.deepEqual(values, []);
});
