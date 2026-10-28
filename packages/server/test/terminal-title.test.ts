import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTitleBridge, ROBOT_NAME_HEADER } from '../../../scripts/terminal-title.ts';
import { createApp } from '../src/http.ts';
import { PermissionBroker } from '../src/permissions.ts';
import { VillageState } from '../src/state.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function run(command: string, args: string[], env: NodeJS.ProcessEnv, input: string | null = '') {
  const child = spawn(command, args, { env, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout!.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr!.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const done = once(child, 'close');
  child.stdin?.end(input);
  const [code] = await done;
  return { code, stdout, stderr };
}

test('real forwarders deliver only their robot title to separate launchers; hook output stays clean', { skip: process.platform === 'win32' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'av-title-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const titles: string[] = [], otherTitles: string[] = [], errors: Error[] = [];
  const bridge = await createTitleBridge(title => titles.push(title), error => errors.push(error));
  const other = await createTitleBridge(title => otherTitles.push(title), error => errors.push(error));
  t.after(() => bridge.close());
  t.after(() => other.close());
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 30 });
  const server = createApp({
    config: { port: 0, host: '127.0.0.1', token: 'test-secret', approvals: false, approvalTimeoutSec: 30, open: false, allowedHosts: [], configDir: home },
    state, broker: new PermissionBroker(), version: 'test', webRoot: home,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const port = (server.address() as AddressInfo).port;
  await writeFile(join(home, 'config.json'), JSON.stringify({ port, token: 'test-secret' }));
  const env = { ...process.env, AGENT_VILLAGE_HOME: home, AGENT_VILLAGE_TITLE_SOCKET: bridge.address, AGENT_VILLAGE_TITLE_PROVIDER: 'copilot' };
  const forward = (sessionId: string, nextEnv = env) => run(process.execPath, [join(root, 'scripts/copilot-hook.ts'), 'sessionStart'], nextEnv, JSON.stringify({ sessionId }));
  assert.deepEqual(await forward('one'), { code: 0, stdout: '', stderr: '' });
  assert.deepEqual(titles, [`${state.sessions.get('copilot:one')!.name} \u00b7 Copilot`]);
  await forward('two', { ...env, AGENT_VILLAGE_TITLE_SOCKET: other.address });
  assert.deepEqual(otherTitles, [`${state.sessions.get('copilot:two')!.name} \u00b7 Copilot`]);
  assert.equal(titles.length, 1);
  await forward('two');
  assert.equal(titles.at(-1), otherTitles[0], 'switching sessions updates the title');

  state.handleHook({ hook_event_name: 'SessionStart', session_id: 'claude-one' });
  const statusline = await run(process.execPath, [join(root, 'scripts/statusline.ts')], {
    ...env, AGENT_VILLAGE_TITLE_PROVIDER: 'claude',
  }, JSON.stringify({ session_id: 'claude-one', model: { display_name: 'Opus' } }));
  assert.deepEqual(statusline, { code: 0, stdout: `${state.sessions.get('claude-one')!.name} \u00b7 Agents Village | Opus\n`, stderr: '' });
  assert.equal(titles.at(-1), `${state.sessions.get('claude-one')!.name} \u00b7 Claude Code`);
  const count = titles.length;
  await forward('one', { ...env, AGENT_VILLAGE_TITLE_PROVIDER: 'claude' });
  await forward('one', { ...env, AGENT_VILLAGE_TITLE_SOCKET: '' });
  await writeFile(join(home, 'config.json'), JSON.stringify({ port, token: 'wrong-token' }));
  assert.deepEqual(await forward('one'), { code: 0, stdout: '', stderr: '' });
  assert.equal(titles.length, count, 'opt-out, other providers and failed auth cannot rename the terminal');
  assert.deepEqual(errors, []);

  await writeFile(join(home, 'config.json'), JSON.stringify({ port, token: 'test-secret' }));
  const absent = await forward('one', { ...env, AGENT_VILLAGE_TITLE_SOCKET: join(home, 'missing-socket') });
  assert.deepEqual(absent, { code: 0, stdout: '', stderr: '' }, 'an exited launcher must never block a hook');

  await writeFile(join(home, 'config.json'), JSON.stringify({
    port, token: 'test-secret', wrappedCopilotStatusLine: { command: `"${process.execPath}" -e "console.log('My existing line')"` },
  }));
  const copilotLine = await run(process.execPath, [join(root, 'scripts/statusline.ts'), '--copilot'], {
    ...env, AGENT_VILLAGE_TITLE_SOCKET: '',
  }, JSON.stringify({ session_id: 'one', rate_limits: { five_hour: { used_percentage: 99 } } }));
  assert.equal(copilotLine.stdout, `${state.sessions.get('copilot:one')!.name} \u00b7 Agents Village | My existing line\n`);
  assert.equal(state.bank.claude, undefined, 'Copilot status data must not change Claude limits');
  const missingLine = await run(process.execPath, [join(root, 'scripts/statusline.ts'), '--copilot'], env, '{"session_id":"missing"}');
  assert.equal(missingLine.stdout, 'Agents Village: unavailable | My existing line\n');
  await writeFile(join(home, 'config.json'), JSON.stringify({ port: 1, token: 'test-secret' }));
  const offline = await run(process.execPath, [join(root, 'scripts/statusline.ts')], env, '{"session_id":"claude-one"}');
  assert.equal(offline.code, 0);
  assert.equal(offline.stdout, 'Agents Village: unavailable | Claude\n');
});

test('title bridge rejects escape/control injection and cleans up its private socket', { skip: process.platform === 'win32' }, async () => {
  const titles: string[] = [], errors: Error[] = [];
  const bridge = await createTitleBridge(title => titles.push(title), error => errors.push(error));
  try {
    for (const title of ['Atlas\x1b]52;clipboard\x07', 'Atlas\nfake', 'x'.repeat(161)]) {
      const socket = createConnection(bridge.address);
      socket.on('error', () => {});
      const done = once(socket, 'close');
      socket.end(title);
      await done;
    }
    assert.deepEqual(titles, []);
    assert.equal(errors.length, 3);
  } finally { await bridge.close(); }
  assert.equal(existsSync(dirname(bridge.address)), false);
});

test('launcher preserves arguments, TTYs, exit status and isolated title updates in a real PTY', { skip: process.platform !== 'darwin' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'av-launch-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const executable = join(home, 'copilot');
  const helper = new URL('../../../scripts/terminal-title.ts', import.meta.url);
  // The fake CLI exercises the same bridge as a hook, without starting a paid agent.
  await writeFile(executable, `#!${process.execPath}
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { publishTerminalTitle } from ${JSON.stringify(helper.href)};
assert.equal(process.stdin.isTTY, true);
assert.equal(process.stdout.isTTY, true);
assert.equal(process.env.COPILOT_DISABLE_TERMINAL_TITLE, '1');
assert.deepEqual(process.argv.slice(2), ['--resume', 'a name; not a shell command']);
writeFileSync(process.env.TEST_ADDRESS_FILE, process.env.AGENT_VILLAGE_TITLE_SOCKET);
await publishTerminalTitle(new Response('', { headers: { ${JSON.stringify(ROBOT_NAME_HEADER)}: 'Atlas' } }), 'copilot');
await publishTerminalTitle(new Response('', { headers: { ${JSON.stringify(ROBOT_NAME_HEADER)}: 'Atlas' } }), 'copilot');
await publishTerminalTitle(new Response('', { headers: { ${JSON.stringify(ROBOT_NAME_HEADER)}: 'Nova' } }), 'copilot');
process.exitCode = 7;
`);
  await chmod(executable, 0o700);
  const addressFile = join(home, 'address');
  const result = await run('/usr/bin/script', ['-q', '/dev/null', process.execPath, join(root, 'scripts/agent.ts'), 'copilot', '--resume', 'a name; not a shell command'], {
    ...process.env, PATH: `${home}:${process.env.PATH}`, TEST_ADDRESS_FILE: addressFile,
  }, null);
  assert.equal(result.code, 7, result.stdout + result.stderr);
  assert.equal(result.stdout.split('\x1b]2;Atlas \u00b7 Copilot\x07').length - 1, 1);
  assert.ok(result.stdout.includes('\x1b]2;Nova \u00b7 Copilot\x07'), result.stdout);
  assert.ok(result.stdout.endsWith('\x1b]2;\x07'), result.stdout);
  assert.equal(existsSync(dirname(await readFile(addressFile, 'utf8'))), false);
});

test('Go home closes the selected real launcher and stubborn descendants, not another CLI', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'av-stop-test-'));
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 30 });
  const server = createApp({
    config: { port: 0, host: '127.0.0.1', token: 'test-secret', approvals: false, approvalTimeoutSec: 30, open: false, allowedHosts: [], configDir: home },
    state, broker: new PermissionBroker(), version: 'test', webRoot: home,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await writeFile(join(home, 'config.json'), JSON.stringify({ port: (server.address() as AddressInfo).port, token: 'test-secret' }));
  const executable = join(home, 'copilot');
  await writeFile(executable, `#!${process.execPath}
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { publishTerminalTitle } from ${JSON.stringify(new URL('../../../scripts/terminal-title.ts', import.meta.url).href)};
process.on('SIGTERM', () => {});
const worker = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { stdio: ['ignore','pipe','inherit'] });
await new Promise(r => worker.stdout.once('data', r));
writeFileSync(process.env.TEST_PIDS, JSON.stringify([process.pid, worker.pid]));
const res = await fetch(${JSON.stringify(base + '/hooks/copilot?event=sessionStart')}, {
  method:'POST', headers:{'content-type':'application/json','x-agent-village-token':'test-secret'},
  body:JSON.stringify({sessionId:'controlled'})
});
await publishTerminalTitle(res, 'copilot');
setInterval(()=>{},1000);
`);
  await chmod(executable, 0o700);
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(() => other.kill());
  const launcher = spawn('/usr/bin/script', ['-q', '/dev/null', process.execPath, join(root, 'scripts/agent.ts'), 'copilot'], {
    env: { ...process.env, AGENT_VILLAGE_HOME: home, PATH: `${home}:${process.env.PATH}`, TEST_PIDS: join(home, 'pids') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  launcher.stdout.on('data', d => { output += String(d); });
  launcher.stderr.on('data', d => { output += String(d); });
  const done = once(launcher, 'close');
  t.after(async () => {
    if (existsSync(join(home, 'pids'))) {
      for (const pid of JSON.parse(await readFile(join(home, 'pids'), 'utf8')) as number[]) {
        try { process.kill(pid, 'SIGKILL'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
      }
    }
    launcher.kill();
  });
  t.after(() => rm(home, { recursive: true, force: true }));
  let control;
  for (let i = 0; i < 80 && !control; i++) {
    await new Promise(r => setTimeout(r, 100));
    control = state.sessions.get('copilot:controlled')?.control;
  }
  assert.ok(control, output);
  const res = await fetch(`${base}/api/sessions/copilot%3Acontrolled/home`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-village-token': 'test-secret' },
    body: JSON.stringify({ launcherId: control.launcherId }),
  });
  assert.equal(res.status, 202);
  await done;
  assert.equal(state.sessions.get('copilot:controlled')!.status, 'ended', output);
  for (const pid of JSON.parse(await readFile(join(home, 'pids'), 'utf8')) as number[]) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `process ${pid} still exists`);
  }
  assert.equal(other.exitCode, null, 'unrelated CLI was not stopped');
  assert.equal(process.kill(other.pid!, 0), true);
});
