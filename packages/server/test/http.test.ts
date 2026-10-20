import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { VillageConfig } from '../src/config.ts';
import { createApp } from '../src/http.ts';
import { PermissionBroker } from '../src/permissions.ts';
import { VillageState } from '../src/state.ts';

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef';
const servers: Array<{ close: () => void }> = [];
after(() => { for (const s of servers) s.close(); });

async function start(opts: { approvals?: boolean; timeoutSec?: number; webRoot?: string } = {}) {
  const config: VillageConfig = {
    port: 0, host: '127.0.0.1', token: TOKEN, approvals: opts.approvals ?? false,
    approvalTimeoutSec: opts.timeoutSec ?? 30, open: false, allowedHosts: [], configDir: tmpdir(),
  };
  const state = new VillageState({ approvals: config.approvals, approvalTimeoutSec: config.approvalTimeoutSec });
  const broker = new PermissionBroker();
  const server = createApp({ config, state, broker, version: '0.0.0-test', webRoot: opts.webRoot ?? join(tmpdir(), 'no-such-web-root') });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  servers.push({ close: () => { server.close(); server.closeAllConnections(); } });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, state, broker };
}

const hook = (base: string, body: unknown, token = TOKEN) => fetch(`${base}/hooks`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-village-token': token }, body: JSON.stringify(body),
});

test('health answers without a token', async () => {
  const { base } = await start();
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, 'agent-village');
});

test('hooks need the token and update the state', async () => {
  const { base, state } = await start();
  assert.equal((await hook(base, { hook_event_name: 'SessionStart', session_id: 's1' }, 'wrong')).status, 401);
  const ok = await hook(base, { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/home/me/shop' });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '');
  assert.equal(state.sessions.get('s1')?.project, 'shop');
  assert.equal((await hook(base, { session_id: 's1' })).status, 400);
});

test('requests with a foreign Host header are rejected (DNS rebinding guard)', async () => {
  const { base } = await start();
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(`${base}/api/health`, { headers: { host: 'evil.example:80' } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('the event stream sends a snapshot and then live activity', async () => {
  const { base } = await start();
  const ctrl = new AbortController();
  const res = await fetch(`${base}/events?token=${TOKEN}`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const readUntil = async (needle: string) => {
    while (!buf.includes(needle)) { const { value, done } = await reader.read(); if (done) break; buf += decoder.decode(value); }
  };
  await readUntil('event: snapshot');
  await hook(base, { hook_event_name: 'PreToolUse', session_id: 's2', tool_name: 'Grep', tool_input: { pattern: 'TODO' } });
  await readUntil('event: activity');
  assert.match(buf, /"station":"lib"/);
  ctrl.abort();
});

test('with approvals on, a click in the village answers the waiting hook', async () => {
  const { base, state } = await start({ approvals: true });
  const pending = hook(base, { hook_event_name: 'PermissionRequest', session_id: 's3', tool_name: 'Bash', tool_input: { command: 'git push' } });
  let id: string | undefined;
  for (let i = 0; i < 50 && !id; i++) { await new Promise(r => setTimeout(r, 10)); id = state.sessions.get('s3')?.pending?.id; }
  assert.ok(id);
  const noToken = await fetch(`${base}/api/permissions/${id}`, { method: 'POST', body: JSON.stringify({ decision: 'allow' }) });
  assert.equal(noToken.status, 401);
  const decide = await fetch(`${base}/api/permissions/${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-village-token': TOKEN }, body: JSON.stringify({ decision: 'allow' }),
  });
  assert.equal(decide.status, 200);
  const body = await (await pending).json();
  assert.equal(body.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(state.sessions.get('s3')?.status, 'working');
});

test('without an answer the hook returns an empty body so Claude Code asks in the terminal', async () => {
  const { base, state } = await start({ approvals: true, timeoutSec: 0.2 });
  const res = await hook(base, { hook_event_name: 'PermissionRequest', session_id: 's4', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  assert.equal(state.sessions.get('s4')?.pending?.approvable, false);
});

test('the built town gets the token injected; a missing build shows instructions', async () => {
  const empty = await start();
  assert.match(await (await fetch(empty.base + '/')).text(), /not built yet/);
  const dir = mkdtempSync(join(tmpdir(), 'av-web-'));
  writeFileSync(join(dir, 'index.html'), '<meta name="agent-village-token" content="__AGENT_VILLAGE_TOKEN__">');
  const built = await start({ webRoot: dir });
  const res = await fetch(built.base + '/some/deep/link');
  assert.match(await res.text(), new RegExp(TOKEN));
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
});

test('Copilot hooks are recognised by the agent header', async () => {
  const { base, state } = await start();
  const res = await fetch(`${base}/hooks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-village-token': TOKEN, 'x-agent-village-agent': 'copilot', 'x-agent-village-event': 'sessionStart' },
    body: JSON.stringify({ sessionId: 'cop-1', cwd: '/home/me/api', source: 'new' }),
  });
  assert.equal(res.status, 200);
  assert.equal(state.sessions.get('copilot:cop-1')?.provider, 'copilot');
  await hook(base, { hook_event_name: 'SessionStart', session_id: 'cl-1' });
  assert.equal(state.sessions.get('cl-1')?.provider, 'claude');
});

test('Copilot hooks on /hooks/copilot need the token and take the event from the query', async () => {
  const { base, state } = await start();
  const post = (token: string) => fetch(`${base}/hooks/copilot?event=preToolUse`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-village-token': token },
    body: JSON.stringify({ sessionId: 'abc', cwd: '/w/api', toolName: 'bash', toolArgs: '{"command":"npm test"}' }),
  });
  assert.equal((await post('wrong')).status, 401);
  assert.equal(state.sessions.size, 0);
  const res = await post(TOKEN);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  const s = state.sessions.get('copilot:abc');
  assert.equal(s?.provider, 'copilot');
  assert.equal(s?.currentTool?.station, 'forge');
});

test('a Copilot permission request is never held, even with approvals on', async () => {
  const { base, state } = await start({ approvals: true });
  const res = await fetch(`${base}/hooks/copilot?event=permissionRequest`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-village-token': TOKEN },
    body: JSON.stringify({ sessionId: 'p1', toolName: 'bash', toolInput: { command: 'rm -rf dist' } }),
  });
  assert.equal(await res.text(), '');
  const s = state.sessions.get('copilot:p1');
  assert.equal(s?.status, 'waiting');
  assert.equal(s?.pending?.approvable, false);
});

test('the status line updates the session and the bank, and unchanged values are not sent again', async () => {
  const { base, state } = await start();
  await hook(base, { hook_event_name: 'SessionStart', session_id: 'st1' });
  const sent: string[] = [];
  state.subscribe(m => { sent.push(m.type); });
  const line = {
    session_id: 'st1', model: { id: 'claude-opus-5-5', display_name: 'Opus' }, cost: { total_cost_usd: 3.4012 },
    context_window: { used_percentage: 23.04 },
    rate_limits: { five_hour: { used_percentage: 38, resets_at: 1792440000 }, seven_day: { used_percentage: 59.02, resets_at: 1792900000 } },
  };
  const post = (body: unknown, token = TOKEN) => fetch(`${base}/api/statusline`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-village-token': token }, body: JSON.stringify(body),
  });
  assert.equal((await post(line, 'nope')).status, 401);
  assert.equal(sent.length, 0);
  assert.equal((await post(line)).status, 200);
  const s = state.sessions.get('st1');
  assert.equal(s?.modelName, 'Opus');
  assert.equal(s?.costUsd, 3.4);
  assert.equal(s?.contextPct, 23);
  assert.equal(state.bank.claude?.fiveHour?.usedPct, 38);
  assert.equal(state.bank.claude?.fiveHour?.resetsAt, 1792440000 * 1000);
  assert.equal(state.bank.claude?.sevenDay?.usedPct, 59);
  assert.deepEqual(sent, ['session', 'bank']);
  // Same values after rounding (0.1 % and $0.01): nothing is broadcast.
  await post({ ...line, cost: { total_cost_usd: 3.4033 }, context_window: { used_percentage: 23.01 } });
  assert.deepEqual(sent, ['session', 'bank']);
  // A payload without rate limits keeps the bank.
  await post({ session_id: 'st1', cost: { total_cost_usd: 3.6 } });
  assert.deepEqual(sent, ['session', 'bank', 'session']);
  assert.equal(state.bank.claude?.fiveHour?.usedPct, 38);
  const snap = await (await fetch(`${base}/api/state?token=${TOKEN}`)).json();
  assert.equal(snap.protocol, 2);
  assert.equal(snap.bank.claude.sevenDay.usedPct, 59);
});
