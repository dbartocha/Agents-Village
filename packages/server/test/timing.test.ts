import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { newSessionTiming, sessionDurations } from '../../shared/src/index.ts';
import { normalizeCopilotPayload } from '../src/copilot.ts';
import { VillageState } from '../src/state.ts';
import { loadTimings, saveTimings } from '../src/timing-store.ts';

test('real hook transitions accrue exact counters, including approvals and questions', () => {
  let now = 1000;
  const state = new VillageState({ approvals: true, approvalTimeoutSec: 60, now: () => now });
  const hook = (event: string, extra: Record<string, unknown> = {}) =>
    state.handleHook({ hook_event_name: event, session_id: 's1', ...extra });
  hook('SessionStart');
  now = 3000; hook('UserPromptSubmit');
  now = 8000; hook('PreToolUse', { tool_name: 'Bash' });
  now = 18000; const request = hook('PermissionRequest', { tool_name: 'Bash' });
  now = 22000; state.resolvePermission(request.holdPermissionId!, 'allow');
  now = 25000; hook('PostToolUse', { tool_name: 'Bash' });
  now = 28000; hook('PreToolUse', { tool_name: 'AskUserQuestion' });
  now = 32000; hook('PostToolUse', { tool_name: 'AskUserQuestion' });
  now = 35000; hook('Stop');
  now = 40000; hook('SessionEnd');
  state.checkpointTimings();
  const timing = state.sessions.get('s1')!.timing!;
  assert.deepEqual(sessionDurations(timing, 50000), {
    lifeMs: 39000, workMs: 24000, waitMs: 8000, idleMs: 7000, unobservedMs: 0,
  });
});

test('Copilot auto-approval stays work while real notifications count as waiting', () => {
  let now = 1000;
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60, now: () => now });
  const hook = (event: string, extra: Record<string, unknown> = {}) => {
    const p = normalizeCopilotPayload({ sessionId: 'c1', toolName: 'bash', ...extra }, event);
    assert.ok(p.ok);
    return state.handleHook(p.value, 'copilot');
  };
  hook('preToolUse');
  now = 2000; hook('permissionRequest');
  now = 121000; state.checkpointTimings();
  const timing = state.sessions.get('copilot:c1')!.timing!;
  assert.equal(timing.workMs, 120000);
  assert.equal(timing.waitMs, 0);
  hook('notification', { notification_type: 'permission_prompt' });
  now = 126000; hook('postToolUse');
  assert.equal(timing.waitMs, 5000);
});

test('timers survive disk round trips without attributing server downtime to work', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'av-timing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'session-times.json');
  let now = 1000;
  const first = new VillageState({ approvals: false, approvalTimeoutSec: 60, now: () => now });
  first.handleHook({
    hook_event_name: 'PreToolUse', session_id: 'stable-id', cwd: '/private/project',
    tool_name: 'Bash', tool_input: { command: 'private command' }, prompt: 'private prompt',
  });
  now = 11000;
  first.checkpointTimings();
  await saveTimings(file, first.timings);
  const json = readFileSync(file, 'utf8');
  assert.doesNotMatch(json, /private|command|prompt|Bash|active/);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const restored = loadTimings(file);
  assert.equal(restored.get('stable-id')?.active, undefined);
  now = 61000;
  const second = new VillageState({ approvals: false, approvalTimeoutSec: 60, timings: restored, now: () => now });
  assert.equal(second.sessions.size, 0);
  second.handleHook({ hook_event_name: 'PreToolUse', session_id: 'stable-id', tool_name: 'Bash' });
  now = 66000;
  second.checkpointTimings(true);
  await saveTimings(file, second.timings);
  const timing = loadTimings(file).get('stable-id')!;
  assert.equal(second.sessions.get('stable-id')?.startedAt, 1000);
  assert.deepEqual(sessionDurations(timing, 66000), {
    lifeMs: 65000, workMs: 15000, waitMs: 0, idleMs: 0, unobservedMs: 50000,
  });
});

test('pruned sessions retain their counters without counting the gap on reappearance', () => {
  let now = 1000;
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60, now: () => now, staleTtlMs: 1000 });
  state.handleHook({ hook_event_name: 'SessionStart', session_id: 's1' });
  now = 3000;
  state.prune();
  assert.equal(state.sessions.size, 0);
  now = 7000;
  state.handleHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1' });
  const timing = state.sessions.get('s1')!.timing!;
  assert.equal(timing.idleMs, 2000);
  assert.equal(sessionDurations(timing, 8000).unobservedMs, 4000);
});

test('missing history starts empty; damaged history and write errors are explicit', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'av-timing-errors-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'session-times.json');
  assert.equal(loadTimings(file).size, 0);
  for (const data of [
    '{', '{"version":2,"sessions":[]}', '{"version":1,"sessions":[["s1",{}]]}',
    JSON.stringify({ version: 1, sessions: [['s1', { ...newSessionTiming(1000), workMs: -1 }]] }),
    JSON.stringify({ version: 1, sessions: [['s1', { ...newSessionTiming(1000), workMs: 1000 }]] }),
  ]) {
    writeFileSync(file, data);
    assert.throws(() => loadTimings(file));
    assert.equal(readFileSync(file, 'utf8'), data);
  }
  await assert.rejects(saveTimings(join(file, 'not-a-directory.json'), new Map()));
});

test('timing checkpoints reach clients without changing session activity or stale timestamps', () => {
  let now = 1000;
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60, now: () => now });
  state.handleHook({ hook_event_name: 'UserPromptSubmit', session_id: 's1' });
  let updates = 0;
  state.subscribe(msg => { if (msg.type === 'session') updates++; });
  now = 6000;
  state.checkpointTimings();
  assert.equal(updates, 1);
  assert.equal(state.recent.length, 1);
  assert.equal(state.sessions.get('s1')?.updatedAt, 1000);
  assert.equal(state.snapshot('test').sessions[0].timing?.workMs, 5000);
});
