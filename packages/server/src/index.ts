#!/usr/bin/env node
/**
 * Agent Village server. Runs with plain Node (22.18+ strips TypeScript types natively), no install needed:
 *   node packages/server/src/index.ts [--port 4747] [--host 127.0.0.1] [--approvals] [--approval-timeout 60] [--open]
 * See readme.adoc → "Server" for every option.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadStoredConfig, resolveConfig } from './config.ts';
import { CopilotBankPoller } from './copilot-bank.ts';
import { createApp } from './http.ts';
import { PermissionBroker } from './permissions.ts';
import { VillageState } from './state.ts';
import { UsageTracker } from './usage.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* opening the browser is optional */ }
}

function main(): void {
  const config = resolveConfig();
  const quiet = process.argv.includes('--quiet');
  const log = (line: string) => { if (!quiet) console.log(`[village] ${new Date().toLocaleTimeString()} ${line}`); };
  const state = new VillageState({ approvals: config.approvals, approvalTimeoutSec: config.approvalTimeoutSec });
  const broker = new PermissionBroker();
  const usage = new UsageTracker({
    onUsage: (id, u, model) => state.setUsage(id, u, model),
    onEarned: (id, tokens) => { if (state.earned(id, tokens)) log(`earned ${tokens} tokens - ${id.slice(0, 8)}`); },
    log,
  });
  state.subscribe(msg => { if (msg.type === 'removed') usage.forget(msg.sessionId); });
  const copilot = loadStoredConfig().copilot;
  const poller = copilot?.username && copilot.githubToken
    ? new CopilotBankPoller({ settings: { username: copilot.username, githubToken: copilot.githubToken, monthlyAllowance: copilot.monthlyAllowance }, state, log })
    : undefined;
  poller?.start();
  const server = createApp({ config, state, broker, version: pkg.version, webRoot, usage, log });
  const pruneTimer = setInterval(() => state.prune(), 5_000);
  pruneTimer.unref();

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${config.port} is already in use. Is Agent Village already running? Open http://localhost:${config.port}`);
      console.error('Or start on another port: node packages/server/src/index.ts --port 4848 (then run "pnpm hooks:install --port 4848").\n');
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const url = `http://localhost:${config.port}`;
    console.log('');
    console.log(`  Agent Village ${pkg.version} is running`);
    console.log(`  Town:       ${url}`);
    console.log(`  Approvals:  ${config.approvals ? `on (waits up to ${config.approvalTimeoutSec}s for your click)` : 'off (watch only)'}`);
    console.log(`  Copilot:    ${poller ? `vault on (GitHub user ${copilot?.username})` : 'vault off (run pnpm copilot:setup)'}`);
    console.log(`  Config:     ${config.configDir}`);
    console.log('  Stop:       Ctrl+C');
    console.log('');
    if (config.open) openBrowser(url);
  });

  const shutdown = () => {
    log('shutting down');
    broker.cancelAll();
    usage.stop();
    poller?.stop();
    server.close();
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 300).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
