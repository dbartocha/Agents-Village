#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createTitleBridge } from './terminal-title.ts';
import { DEFAULT_PORT, loadStoredConfig } from '../packages/server/src/config.ts';
import { terminateTree } from './process-tree.ts';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const [provider, ...args] = argv;
  if (!provider || provider === '--help') {
    console.log('Usage: pnpm agent <copilot|claude> [CLI arguments...]\nRun in a VS Code terminal with terminal.integrated.tabs.title set to "${sequence}".');
    return 0;
  }
  if (provider !== 'copilot' && provider !== 'claude') throw new Error('Agent must be copilot or claude.');
  if (process.platform === 'win32') throw new Error('Named terminals currently support macOS and Linux; use WSL on Windows.');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal, not a pipe or task output.');

  const warn = (error: Error) => console.error(`\n[Agent Village] ${error.message}`);
  let titleReceived = false;
  let lastTitle = '';
  let sessionId: string | undefined;
  const bridge = await createTitleBridge((title, id) => {
    if (id) sessionId = id;
    titleReceived = true;
    if (title !== lastTitle) {
      process.stdout.write(`\x1b]2;${title}\x07`);
      lastTitle = title;
    }
  }, warn);
  const notice = setTimeout(() => {
    if (!titleReceived) warn(new Error('No robot name received yet. Start/restart Agent Village and check its hooks (Claude also needs the village status line). The CLI can keep running.'));
  }, 15_000);
  notice.unref();
  process.stdout.write(`\x1b]2;Agent Village - ${provider}\x07`);
  try {
    const child = spawn(provider, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        AGENT_VILLAGE_TITLE_SOCKET: bridge.address,
        AGENT_VILLAGE_TITLE_PROVIDER: provider,
        ...(provider === 'copilot'
          ? { COPILOT_DISABLE_TERMINAL_TITLE: '1' }
          : { CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' }),
      },
    });
    const launcherId = randomUUID(), secret = randomBytes(32).toString('hex');
    let closed = false, polling: Promise<void> | undefined, stopping: Promise<void> | undefined;
    let stopFailed = false;
    let pollFailed = false;
    const poll = async (id: string, phase = 'running', error?: string): Promise<boolean> => {
      const stored = loadStoredConfig();
      if (!stored.token) throw new Error('Go home unavailable: village hooks are not installed.');
      const res = await fetch(`http://127.0.0.1:${stored.port ?? DEFAULT_PORT}/api/launcher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Village-Token': stored.token },
        body: JSON.stringify({ launcherId, secret, sessionId: id, phase, error }),
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) throw new Error(`Go home unavailable: village returned HTTP ${res.status}.`);
      const reply = await res.json() as { stop?: boolean; sessionId?: string };
      return reply.stop === true && reply.sessionId === id;
    };
    const terminate = () => {
      if (!stopping && child.pid && !closed) {
        stopFailed = false;
        stopping = terminateTree(child.pid).catch(error => {
          stopFailed = true;
          warn(error instanceof Error ? error : new Error(String(error)));
          if (sessionId) return poll(sessionId, 'error', 'Could not stop all supervised processes. Check the terminal.')
            .then(() => {}).catch(reportError => warn(reportError instanceof Error ? reportError : new Error(String(reportError))));
        }).finally(() => {
          if (!closed) stopping = undefined;
        });
      }
    };
    const timer = setInterval(() => {
      if (polling || closed || stopping || !sessionId) return;
      const id = sessionId;
      polling = poll(id).then(stop => {
        if (pollFailed) console.error('\n[Agent Village] Go home connection restored.');
        pollFailed = false;
        if (stop && id === sessionId && !closed) terminate();
      }).catch(error => {
        if (!pollFailed) warn(error instanceof Error ? error : new Error(String(error)));
        pollFailed = true;
      }).finally(() => { polling = undefined; });
    }, 1000);
    timer.unref();
    // Interactive Ctrl+C is handled by the CLI, which shares the foreground process group.
    const interrupt = () => {};
    const hangup = terminate;
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    process.on('SIGHUP', hangup);
    try {
      const code = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => { closed = true; resolve(code ?? (signal ? 128 + constants.signals[signal] : 1)); });
      });
      await stopping;
      await polling;
      if (sessionId && !stopFailed) {
        try { await poll(sessionId); await poll(sessionId, 'ended'); }
        catch (error) { warn(error instanceof Error ? error : new Error(String(error))); }
      }
      return code;
    } finally {
      closed = true;
      clearInterval(timer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      process.removeListener('SIGHUP', hangup);
    }
  } finally {
    clearTimeout(notice);
    await bridge.close();
    process.stdout.write('\x1b]2;\x07');
  }
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`[Agent Village] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
