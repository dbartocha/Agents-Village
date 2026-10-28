import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Activity, TokenUsage } from '../../shared/src/index.ts';
import { PAYOUT_INTERVAL_MS, payoutPeriod } from '../../shared/src/index.ts';
import { TranscriptFile, UsageTracker, allowedTranscript } from '../src/usage.ts';
import { VillageState } from '../src/state.ts';

const assistant = (id: string, usage: Record<string, number>, model = 'claude-opus-5-5') =>
  JSON.stringify({ type: 'assistant', message: { id, model, usage } }) + '\n';
const U = { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000 };

test('ten-minute payouts update working sessions without hooks and final payout is only the remainder', async t => {
  const { root, file } = claudeHome();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const start = new Date(2026, 9, 22, 12).getTime();
  let now = start;
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60, now: () => now });
  const earned: number[] = [];
  const tracker = new UsageTracker({
    claudeDir: root, delayMs: 60_000,
    onUsage: (id, u) => state.setUsage(id, u),
    onEarned: (id, n, total) => { state.pay(id, 'tokens', total); earned.push(n); },
  });
  t.after(() => tracker.stop());
  const hook = (event: string) => {
    const p = { hook_event_name: event, session_id: 'periodic', transcript_path: file, tool_name: 'Bash' };
    state.handleHook(p);
    tracker.onHook(p);
  };
  hook('UserPromptSubmit');
  hook('PreToolUse');
  writeFileSync(file, assistant('m1', U));
  assert.equal(PAYOUT_INTERVAL_MS, 600_000);
  assert.equal(payoutPeriod(start, start - 1), 0);
  now = start + 599_999;
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, []);
  now++;
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, [6110]);
  assert.equal(state.sessions.get('periodic')?.status, 'working');
  assert.equal(state.sessions.get('periodic')?.taskStartedAt, start);
  assert.equal(state.bank.daily?.tokens, 6110);
  appendFileSync(file, assistant('m2', U));
  now = start + 1_199_999;
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, [6110]);
  now++;
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, [6110, 6110]);
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, [6110, 6110]);
  appendFileSync(file, assistant('m3', { output_tokens: 42 }));
  hook('Stop');
  await tracker.read('periodic');
  assert.deepEqual(earned, [6110, 6110, 42]);
  assert.equal(state.sessions.get('periodic')?.taskStartedAt, undefined);
  assert.equal(state.bank.daily?.tokens, 12262);
  now += 600_000;
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, [6110, 6110, 42]);
  hook('UserPromptSubmit');
  appendFileSync(file, assistant('m4', { output_tokens: 1 }));
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, [6110, 6110, 42], 'a new task gets its own interval');
  now += 600_000;
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(earned, [6110, 6110, 42, 1]);
});

test('partial payout waits for working state and retries a rejected payment without losing usage', async t => {
  const { root, file } = claudeHome();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let now = 1000;
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60, now: () => now });
  const errors: string[] = [];
  let reject = true;
  const totals: number[] = [];
  const tracker = new UsageTracker({
    claudeDir: root,
    onUsage: () => {},
    onEarned: (_id, _n, total) => { if (reject) throw new Error('payout unavailable'); totals.push(total); },
    log: message => errors.push(message),
  });
  t.after(() => tracker.stop());
  const p = { hook_event_name: 'UserPromptSubmit', session_id: 'waiting', transcript_path: file };
  state.handleHook(p);
  tracker.onHook(p);
  writeFileSync(file, assistant('m1', U));
  state.handleHook({ ...p, hook_event_name: 'PermissionRequest' });
  now += 600_000;
  await tracker.poll(state.sessions.values(), now);
  assert.deepEqual(totals, []);
  assert.deepEqual(errors, []);
  state.handleHook({ ...p, hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  await tracker.poll(state.sessions.values(), now);
  assert.equal(errors.length, 1);
  assert.deepEqual(totals, []);
  reject = false;
  await tracker.poll(state.sessions.values(), now + 5000);
  assert.deepEqual(totals, [6110]);
  await tracker.poll(state.sessions.values(), now + 10_000);
  assert.deepEqual(totals, [6110]);
});

function claudeHome() {
  const root = mkdtempSync(join(tmpdir(), 'av-claude-'));
  mkdirSync(join(root, 'projects', 'p'), { recursive: true });
  return { root, file: join(root, 'projects', 'p', 's1.jsonl') };
}

test('each message.id is counted once, other lines are ignored', async () => {
  const { file } = claudeHome();
  writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'hi', usage: { input_tokens: 999 } } }) + '\n',
    assistant('m1', U), assistant('m1', U), assistant('m1', U),
    JSON.stringify({ type: 'summary', usage: { input_tokens: 5 } }) + '\n',
    assistant('m2', { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 3 }),
  ].join(''));
  const f = new TranscriptFile();
  assert.equal(await f.readNew(file), true);
  assert.deepEqual(f.total, { input: 11, output: 102, cacheWrite: 1000, cacheRead: 5003 });
  assert.equal(f.model, 'claude-opus-5-5');
  assert.equal(await f.readNew(file), false);
});

test('a partial last line waits for the next read', async () => {
  const { file } = claudeHome();
  const line = assistant('m1', U);
  writeFileSync(file, line.slice(0, 40));
  const f = new TranscriptFile();
  assert.equal(await f.readNew(file), false);
  appendFileSync(file, line.slice(40) + assistant('m2', U).slice(0, 10));
  assert.equal(await f.readNew(file), true);
  assert.equal(f.total.output, 100);
  appendFileSync(file, assistant('m2', U).slice(10));
  await f.readNew(file);
  assert.equal(f.total.output, 200);
});

test('only .jsonl files inside the Claude config folder are read', async () => {
  const { root, file } = claudeHome();
  writeFileSync(file, '');
  assert.ok(await allowedTranscript(file, root));
  const outside = join(mkdtempSync(join(tmpdir(), 'av-other-')), 'x.jsonl');
  writeFileSync(outside, assistant('m1', U));
  assert.equal(await allowedTranscript(outside, root), null);
  assert.equal(await allowedTranscript(join(root, 'projects', 'p', '..', '..', '..', 'x.jsonl'), root), null);
  const txt = join(root, 'projects', 'p', 'notes.txt');
  writeFileSync(txt, '');
  assert.equal(await allowedTranscript(txt, root), null);
  assert.equal(await allowedTranscript(join(root, 'missing.jsonl'), root), null);
  // The tracker skips a file outside the folder even when a hook names it.
  const seen: TokenUsage[] = [];
  const tracker = new UsageTracker({ claudeDir: root, delayMs: 1, onUsage: (_id, u) => seen.push(u), onEarned: () => {} });
  tracker.onHook({ hook_event_name: 'Stop', session_id: 'x', transcript_path: outside });
  await new Promise(r => setTimeout(r, 20));
  await tracker.idle();
  assert.equal(seen.length, 0);
});

test('Stop → delayed read → earned with the tokens since the previous earned', async () => {
  const { root, file } = claudeHome();
  writeFileSync(file, assistant('m1', U));
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60 });
  const earned: Activity[] = [];
  state.subscribe(m => { if (m.type === 'activity' && m.activity.kind === 'earned') earned.push(m.activity); });
  const tracker = new UsageTracker({
    claudeDir: root, delayMs: 5,
    onUsage: (id, u, model) => state.setUsage(id, u, model),
    onEarned: (id, _n, total) => state.pay(id, 'tokens', total),
  });
  const hook = (event: string, extra: Record<string, unknown> = {}) => {
    const p = { hook_event_name: event, session_id: 's1', transcript_path: file, ...extra };
    state.handleHook(p);
    tracker.onHook(p);
  };
  hook('SessionStart');
  hook('PostToolUse', { tool_name: 'Read' });
  await new Promise(r => setTimeout(r, 30));
  await tracker.idle();
  assert.equal(earned.length, 0, 'PostToolUse only updates usage');
  assert.equal(state.sessions.get('s1')?.usage?.cacheRead, 5000);
  assert.equal(state.sessions.get('s1')?.model, 'claude-opus-5-5');

  hook('Stop');
  // Nothing is read inside the hook: the transcript catches up after the delay.
  appendFileSync(file, assistant('m2', { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }));
  await new Promise(r => setTimeout(r, 30));
  await tracker.idle();
  assert.equal(earned.length, 1);
  assert.equal(earned[0].tokens, 6110 + 10);

  // A subagent transcript counts for the parent robot.
  const sub = join(root, 'projects', 'p', 's1', 'subagents', 'agent-a.jsonl');
  mkdirSync(join(root, 'projects', 'p', 's1', 'subagents'), { recursive: true });
  writeFileSync(sub, assistant('sub1', { input_tokens: 0, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }));
  hook('SubagentStop', { agent_id: 'a', agent_transcript_path: sub });
  hook('Stop');
  await new Promise(r => setTimeout(r, 30));
  await tracker.idle();
  assert.equal(earned.length, 2);
  assert.equal(earned[1].tokens, 50);
  assert.equal(state.sessions.get('s1')?.usage?.output, 155);

  hook('Stop');
  await new Promise(r => setTimeout(r, 30));
  await tracker.idle();
  assert.equal(earned.length, 2, 'no earned activity when nothing was used');
});
