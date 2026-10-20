import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APPROVAL_EVENT, OBSERVE_EVENTS, addStatusLine, addVillageHooks, installedEvents, isVillageHook, isVillageStatusLine, removeStatusLine, removeVillageHooks,
} from '../src/hooks-config.ts';
import type { Settings } from '../src/hooks-config.ts';

const opts = { port: 4747, token: 'tok', approvals: false, approvalTimeoutSec: 60 };
const userHook = { type: 'command', command: 'echo hi' };

test('install adds an http hook for every observed event and keeps other settings', () => {
  const before: Settings = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [userHook] }] } };
  const after = addVillageHooks(before, opts);
  assert.equal(after.model, 'opus');
  assert.deepEqual(installedEvents(after).sort(), [...OBSERVE_EVENTS].sort());
  assert.deepEqual(after.hooks!.PreToolUse[0], { matcher: 'Bash', hooks: [userHook] });
  const ours = after.hooks!.PreToolUse[1].hooks[0] as Record<string, unknown>;
  assert.equal(ours.url, 'http://127.0.0.1:4747/hooks');
  assert.ok(isVillageHook(ours));
});

test('installing twice does not duplicate hooks', () => {
  const once = addVillageHooks({}, opts);
  const twice = addVillageHooks(once, opts);
  assert.deepEqual(twice, once);
});

test('approvals add a PermissionRequest hook with a longer timeout', () => {
  const after = addVillageHooks({}, { ...opts, approvals: true });
  const h = after.hooks![APPROVAL_EVENT][0].hooks[0] as Record<string, unknown>;
  assert.equal(h.timeout, 75);
});

test('uninstall removes only village hooks and empty containers', () => {
  const mixed = addVillageHooks({ hooks: { Stop: [{ hooks: [userHook] }] } }, opts);
  const cleaned = removeVillageHooks(mixed);
  assert.deepEqual(cleaned, { hooks: { Stop: [{ hooks: [userHook] }] } });
  assert.deepEqual(removeVillageHooks(addVillageHooks({}, opts)), {});
});

test('a user http hook to another URL is not treated as ours', () => {
  assert.equal(isVillageHook({ type: 'http', url: 'http://localhost:8080/my-hook', headers: { 'X-Agent-Village-Token': 'x' } }), false);
  assert.equal(isVillageHook({ type: 'http', url: 'http://127.0.0.1:4747/hooks' }), false);
});

test('the status line install wraps an existing one and uninstall restores it', () => {
  const script = 'C:/Agent Village/scripts/statusline.ts';
  const mine = { type: 'command', command: '~/.claude/my-line.sh', padding: 1 };
  const { settings, wrapped } = addStatusLine({ model: 'opus', statusLine: mine }, script);
  assert.deepEqual(wrapped, mine);
  assert.equal(settings.model, 'opus');
  assert.equal((settings.statusLine as Record<string, unknown>).command, 'node "C:/Agent Village/scripts/statusline.ts"');
  assert.ok(isVillageStatusLine(settings.statusLine));
  // Installing again does not wrap our own line.
  assert.equal(addStatusLine(settings, script).wrapped, undefined);
  assert.deepEqual(removeStatusLine(settings, wrapped).statusLine, mine);
  assert.equal('statusLine' in removeStatusLine(settings), false);
  // Someone else's status line is never removed.
  assert.deepEqual(removeStatusLine({ statusLine: mine }, undefined).statusLine, mine);
  assert.equal(isVillageStatusLine({ type: 'command', command: 'node "C:\\x\\scripts\\statusline.ts"' }), true);
});
