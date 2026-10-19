#!/usr/bin/env node
/**
 * Development mode: runs the server (restarts on change) and the Vite dev server for the town together.
 * Open http://localhost:5173 — Vite proxies /events and /api to the server on port 4747.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const isWin = process.platform === 'win32';
const procs: ChildProcess[] = [];

function run(name: string, cmd: string, args: string[]): void {
  const p = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: isWin });
  const prefix = (line: string) => `[${name}] ${line}`;
  p.stdout?.on('data', (d: Buffer) => process.stdout.write(d.toString().split('\n').filter(Boolean).map(prefix).join('\n') + '\n'));
  p.stderr?.on('data', (d: Buffer) => process.stderr.write(d.toString().split('\n').filter(Boolean).map(prefix).join('\n') + '\n'));
  p.on('exit', code => { console.log(prefix(`exited with code ${code}`)); shutdown(); });
  procs.push(p);
}

function shutdown(): void {
  for (const p of procs) if (!p.killed) p.kill();
  setTimeout(() => process.exit(0), 200).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run('server', process.execPath, ['--watch', 'packages/server/src/index.ts']);
run('web', 'pnpm', ['--filter', '@agent-village/web', 'dev']);
console.log('\n  Dev mode: open http://localhost:5173 (Ctrl+C stops both)\n');
