import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCopilotPayload } from '../src/copilot.ts';
import { COPILOT_EVENTS, copilotHooks } from '../src/hooks-config.ts';
import { VillageState } from '../src/state.ts';

const norm = (body: unknown, event?: string) => {
  const r = normalizeCopilotPayload(body, event);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

test('Copilot CLI camelCase payloads become Claude-shaped hooks', () => {
  const p = norm({ sessionId: 'c1', timestamp: 1, cwd: '/home/me/shop', toolName: 'bash', toolArgs: '{"command":"npm test"}' }, 'preToolUse');
  assert.equal(p.hook_event_name, 'PreToolUse');
  assert.equal(p.session_id, 'copilot:c1');
  assert.equal(p.tool_name, 'bash');
  assert.deepEqual(p.tool_input, { command: 'npm test' });
  assert.equal(norm({ sessionId: 'c1', prompt: 'hi' }, 'userPromptSubmitted').hook_event_name, 'UserPromptSubmit');
  assert.equal(norm({ sessionId: 'c1' }, 'agentStop').hook_event_name, 'Stop');
  assert.equal(norm({ sessionId: 'c1', notification_type: 'agent_idle', hook_event_name: 'Notification' }, 'notification').notification_type, 'idle_prompt');
  const fail = norm({ sessionId: 'c1', error: { message: 'rate limited', name: 'Error' }, recoverable: false }, 'errorOccurred');
  assert.equal(fail.hook_event_name, 'StopFailure');
  assert.equal(fail.error, 'rate limited');
});

test('VS Code snake_case payloads pass through', () => {
  const p = norm({ hook_event_name: 'PreToolUse', session_id: 'v1', tool_name: 'read_file', tool_input: { filePath: '/w/a.ts' }, tool_use_id: 't1' });
  assert.equal(p.hook_event_name, 'PreToolUse');
  assert.equal(p.tool_use_id, 't1');
  assert.equal(normalizeCopilotPayload({ toolName: 'x' }, 'preToolUse').ok, false);
});

test('Copilot sessions are tagged and their tools land on the right stations', () => {
  const state = new VillageState({ approvals: true, approvalTimeoutSec: 60 });
  state.handleHook(norm({ sessionId: 'c1', cwd: 'C:\\dev\\shop', source: 'new' }, 'sessionStart'), 'copilot');
  const out = state.handleHook(norm({ sessionId: 'c1', toolName: 'view', toolArgs: { path: 'C:\\dev\\shop\\src\\a.ts' } }, 'preToolUse'), 'copilot');
  const s = state.sessions.get('copilot:c1');
  assert.equal(s?.provider, 'copilot');
  assert.equal(out.activities[0].station, 'lib');
  assert.equal(out.activities[0].target, 'src/a.ts');
  const ask = state.handleHook(norm({ sessionId: 'c1', toolName: 'ask_user', toolArgs: { question: 'Which DB?' } }, 'preToolUse'), 'copilot');
  assert.equal(state.sessions.get('copilot:c1')?.status, 'asking');
  assert.equal(ask.activities.at(-1)?.attention, 'question');
});

test('the Copilot hooks file never lets a failed forward block a tool', () => {
  const file = copilotHooks('C:\\Agent Village\\scripts\\copilot-hook.ts');
  assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file.hooks), [...COPILOT_EVENTS]);
  const h = file.hooks.preToolUse[0];
  assert.equal(h.bash, 'node "C:/Agent Village/scripts/copilot-hook.ts" preToolUse 2>/dev/null || true');
  assert.equal(h.powershell, "& node 'C:\\Agent Village\\scripts\\copilot-hook.ts' preToolUse 2>$null; exit 0");
});

test('Copilot permission pre-checks never make auto-approved tools wait, with either approvals setting', () => {
  for (const approvals of [false, true]) {
    let now = 1_000_000;
    const state = new VillageState({ approvals, approvalTimeoutSec: 60, now: () => now });
    const run = (event: string, body: Record<string, unknown> = {}) =>
      state.handleHook(norm({ sessionId: 'auto', ...body }, event), 'copilot');
    run('preToolUse', { toolName: 'bash', toolArgs: { command: 'npm test' } });
    const tool = state.sessions.get('copilot:auto')?.currentTool;
    for (let i = 0; i < 2; i++) {
      const out = run('permissionRequest', { toolName: 'bash', toolInput: { command: 'npm test' } });
      assert.deepEqual(out.activities, []);
      assert.equal(out.holdPermissionId, undefined);
    }
    now += 120_000;
    state.prune();
    const s = state.sessions.get('copilot:auto');
    assert.equal(s?.status, 'working');
    assert.equal(s?.pending, undefined);
    assert.equal(s?.currentTool, tool);
    assert.equal(s?.attentionText, undefined);
    run('postToolUse', { toolName: 'bash' });
    assert.equal(s?.status, 'thinking');
    assert.deepEqual(state.recent.map(a => a.kind), ['tool', 'tool_done']);
  }
});

test('Copilot still shows real permission prompts and resolves them after the tool', () => {
  for (const end of ['postToolUse', 'postToolUseFailure', 'agentStop', 'userPromptSubmitted']) {
    const state = new VillageState({ approvals: true, approvalTimeoutSec: 60 });
    const run = (event: string, body: Record<string, unknown> = {}) =>
      state.handleHook(norm({ sessionId: 'prompt', ...body }, event), 'copilot');
    run('preToolUse', { toolName: 'bash', toolArgs: { command: 'npm test' } });
    run('permissionRequest', { toolName: 'bash' });
    const prompt = run('notification', { notification_type: 'permission_prompt', message: 'Permission needed' });
    const s = state.sessions.get('copilot:prompt');
    assert.equal(s?.status, 'waiting');
    assert.equal(s?.pending?.approvable, false);
    assert.equal(prompt.activities[0].attention, 'permission');
    assert.equal(prompt.holdPermissionId, undefined);
    const pending = s?.pending;
    run('permissionRequest', { toolName: 'edit' });
    assert.equal(s?.pending, pending);
    assert.equal(s?.status, 'waiting');
    run(end, { toolName: 'bash' });
    assert.equal(s?.pending, undefined);
    assert.notEqual(s?.status, 'waiting');
  }
});

test('Copilot informational messages mentioning permissions do not imply a prompt', () => {
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60 });
  state.handleHook(norm({ sessionId: 'info', toolName: 'bash' }, 'preToolUse'), 'copilot');
  const out = state.handleHook(norm({ sessionId: 'info', message: 'Permission automatically granted' }, 'notification'), 'copilot');
  assert.equal(state.sessions.get('copilot:info')?.status, 'working');
  assert.equal(state.sessions.get('copilot:info')?.pending, undefined);
  assert.equal(out.activities[0].attention, 'info');
});

test('Copilot permission pre-checks do not replace a real question', () => {
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60 });
  const run = (event: string, body: Record<string, unknown>) =>
    state.handleHook(norm({ sessionId: 'ask', ...body }, event), 'copilot');
  run('preToolUse', { toolName: 'ask_user', toolArgs: { question: 'Which DB?' } });
  run('permissionRequest', { toolName: 'ask_user' });
  assert.equal(state.sessions.get('copilot:ask')?.status, 'asking');
  assert.equal(state.sessions.get('copilot:ask')?.pending, undefined);
  run('postToolUse', { toolName: 'ask_user' });
  assert.equal(state.sessions.get('copilot:ask')?.status, 'thinking');
  run('notification', { notification_type: 'elicitation_dialog', message: 'Which DB?' });
  assert.equal(state.sessions.get('copilot:ask')?.status, 'asking');
});
