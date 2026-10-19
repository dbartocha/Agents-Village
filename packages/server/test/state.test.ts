import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HookPayload, ServerMessage } from '../../shared/src/index.ts';
import { VillageState } from '../src/state.ts';

function setup(approvals = false) {
  let clock = 1_000_000;
  const state = new VillageState({ approvals, approvalTimeoutSec: 60, now: () => clock, endedTtlMs: 1000 });
  const messages: ServerMessage[] = [];
  state.subscribe(m => messages.push(m));
  const hook = (event: string, extra: Record<string, unknown> = {}, session = 'sess-1') =>
    state.handleHook({ hook_event_name: event, session_id: session, cwd: 'C:\\dev\\shop', ...extra } as HookPayload);
  return { state, messages, hook, tick: (ms: number) => { clock += ms; } };
}

test('first hook creates a named session with a project name', () => {
  const { state, hook } = setup();
  hook('SessionStart', { source: 'startup', model: 'claude-opus' });
  const s = state.sessions.get('sess-1');
  assert.ok(s);
  assert.equal(s.name, 'Atlas');
  assert.equal(s.project, 'shop');
  assert.equal(s.status, 'idle');
  assert.equal(s.model, 'claude-opus');
});

test('PreToolUse sends the robot to the matching station with a short target', () => {
  const { state, hook } = setup();
  hook('UserPromptSubmit', { prompt: 'Fix the cart' });
  const out = hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'C:\\dev\\shop\\src\\cart.ts' }, tool_use_id: 't1' });
  const a = out.activities.find(x => x.kind === 'tool');
  assert.ok(a);
  assert.equal(a.station, 'lib');
  assert.equal(a.target, 'src/cart.ts');
  assert.equal(state.sessions.get('sess-1')?.status, 'working');
  hook('PostToolUse', { tool_name: 'Read', tool_use_id: 't1' });
  assert.equal(state.sessions.get('sess-1')?.currentTool, undefined);
  assert.equal(state.sessions.get('sess-1')?.status, 'thinking');
});

test('unknown tools go to the plaza, Bash goes to the forge', () => {
  const { hook } = setup();
  assert.equal(hook('PreToolUse', { tool_name: 'mcp__github__create_issue', tool_input: { title: 'x' } }).activities[0].station, 'plaza');
  assert.equal(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }).activities[0].station, 'forge');
});

test('with approvals on, PermissionRequest asks the server to hold the hook', () => {
  const { state, hook } = setup(true);
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git push' } });
  const out = hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'git push' } });
  assert.ok(out.holdPermissionId);
  const s = state.sessions.get('sess-1');
  assert.equal(s?.status, 'waiting');
  assert.equal(s?.pending?.approvable, true);
  state.resolvePermission(out.holdPermissionId, 'allow');
  assert.equal(state.sessions.get('sess-1')?.status, 'working');
  assert.equal(state.sessions.get('sess-1')?.pending, undefined);
});

test('with approvals off, a permission notification is shown but answered in the terminal', () => {
  const { state, hook } = setup(false);
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } });
  const out = hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.equal(out.holdPermissionId, undefined);
  assert.equal(out.activities[0].attention, 'permission');
  assert.equal(state.sessions.get('sess-1')?.pending?.approvable, false);
  const after = hook('PostToolUse', { tool_name: 'Bash' });
  assert.ok(after.activities.some(a => a.kind === 'permission_resolved' && a.resolution === 'terminal'));
  assert.equal(state.sessions.get('sess-1')?.pending, undefined);
});

test('AskUserQuestion marks the robot as asking', () => {
  const { state, hook } = setup();
  const out = hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which database?' }] } });
  assert.ok(out.activities.some(a => a.kind === 'attention' && a.attention === 'question' && a.text === 'Which database?'));
  assert.equal(state.sessions.get('sess-1')?.status, 'asking');
});

test('Stop parks the robot and keeps the last message', () => {
  const { state, hook } = setup();
  hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a.ts' } });
  hook('Stop', { last_assistant_message: 'Done, tests pass.' });
  const s = state.sessions.get('sess-1');
  assert.equal(s?.status, 'idle');
  assert.equal(s?.lastMessage, 'Done, tests pass.');
});

test('ended sessions are removed after their time to live', () => {
  const { state, hook, messages, tick } = setup();
  hook('SessionEnd', { reason: 'prompt_input_exit' });
  assert.equal(state.sessions.get('sess-1')?.status, 'ended');
  tick(2000);
  assert.deepEqual(state.prune(), ['sess-1']);
  assert.ok(messages.some(m => m.type === 'removed'));
});

test('every session gets its own robot name', () => {
  const { state, hook } = setup();
  hook('SessionStart', {}, 'a');
  hook('SessionStart', {}, 'b');
  hook('SessionStart', {}, 'c');
  assert.deepEqual([...state.sessions.values()].map(s => s.name), ['Atlas', 'Nova', 'Bolt']);
});

test('subagents are counted and never go negative', () => {
  const { state, hook } = setup();
  hook('SubagentStart', { agent_type: 'explore' });
  hook('SubagentStop', { agent_type: 'explore' });
  hook('SubagentStop', { agent_type: 'explore' });
  assert.equal(state.sessions.get('sess-1')?.subagents, 0);
});

test('every streamed activity carries the session state it leads to', () => {
  const { messages, hook } = setup();
  hook('UserPromptSubmit', { prompt: 'Go' });
  hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 't1' });
  hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 't1' });
  const seen = messages.flatMap(m => (m.type === 'activity' ? [`${m.activity.kind}:${m.session.status}`] : []));
  assert.deepEqual(seen, [
    'prompt:thinking', 'tool:working', 'attention:waiting', 'permission_resolved:thinking', 'tool_done:thinking',
  ]);
});
