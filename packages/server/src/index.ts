#!/usr/bin/env node
/**
 * Agent Village server. Runs with plain Node (22.18+ strips TypeScript types natively), no install needed:
 *   node packages/server/src/index.ts [--port 4747] [--host 127.0.0.1] [--approvals] [--approval-timeout 60] [--open]
 * See readme.adoc → "Server" for every option.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStoredConfig, resolveConfig } from './config.ts';
import { CopilotBankPoller } from './copilot-bank.ts';
import { createApp } from './http.ts';
import { PermissionBroker } from './permissions.ts';
import { VillageState } from './state.ts';
import { UsageTracker } from './usage.ts';
import { loadTimings, saveTimings } from './timing-store.ts';
import { PayoutLedger } from './payouts.ts';
import { CopilotUsageTracker } from './copilot-usage.ts';

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
  const timingFile = join(config.configDir, 'session-times.json');
  const payoutFile = join(config.configDir, 'payouts.json');
  const state = new VillageState({
    approvals: config.approvals, approvalTimeoutSec: config.approvalTimeoutSec, timings: loadTimings(timingFile),
    payouts: PayoutLedger.load(payoutFile),
  });
  const broker = new PermissionBroker();
  const usage = new UsageTracker({
    onUsage: (id, u, model) => state.setUsage(id, u, model),
    onEarned: (id, _tokens, total) => { state.pay(id, 'tokens', total); },
    log,
  });
  const copilotUsage = new CopilotUsageTracker({
    onCheckpoint: (id, checkpoint) => { state.pay(id, 'nanoAic', checkpoint.total, checkpoint.at); },
    onError: (id, error) => state.setEarningsError(id, error),
    log: message => console.error(`[village] ${message}`),
  });
  state.subscribe(msg => { if (msg.type === 'removed') { usage.forget(msg.sessionId); copilotUsage.forget(msg.sessionId); } });
  const copilot = loadStoredConfig().copilot;
  const poller = copilot?.username && copilot.githubToken
    ? new CopilotBankPoller({ settings: { username: copilot.username, githubToken: copilot.githubToken, monthlyAllowance: copilot.monthlyAllowance }, state, log })
    : undefined;
  poller?.start();
  const server = createApp({ config, state, broker, version: pkg.version, webRoot, usage, copilotUsage, log });
  const pruneTimer = setInterval(() => state.prune(), 5_000);
  pruneTimer.unref();
  let saving: Promise<void> | undefined;
  const persist = (): Promise<void> => Promise.allSettled([
    saveTimings(timingFile, state.timings), state.payouts.save(payoutFile),
  ]).then(results => {
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[village] Cannot save local timing/payout history:`, result.reason);
        process.exitCode = 1;
      }
    }
  });
  const timingTimer = setInterval(() => {
    void copilotUsage.poll();
    void usage.poll(state.sessions.values());
    if (saving) return;
    state.checkpointTimings();
    saving = persist().finally(() => { saving = undefined; });
  }, 5_000);
  timingTimer.unref();

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

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log('shutting down');
    clearInterval(pruneTimer);
    clearInterval(timingTimer);
    broker.cancelAll();
    usage.stop();
    poller?.stop();
    server.close();
    server.closeAllConnections();
    await copilotUsage.stop();
    await usage.idle();
    await saving;
    state.checkpointTimings(true);
    await persist();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
