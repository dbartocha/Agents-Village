#!/usr/bin/env node
/**
 * Claude Code status line that also feeds Agent Village (model, cost, context, rate limits).
 *
 *   statusLine: { "type": "command", "command": "node \"<repo>/scripts/statusline.ts\"" }   (installed by pnpm hooks:install)
 *
 * Claude Code passes JSON on stdin. The script prints the status line first, then posts the same JSON
 * to POST /api/statusline (300 ms timeout). If you had a status line before, it is saved as
 * wrappedStatusLine in ~/.agent-village/config.json and its output is shown instead of the default.
 * It never fails, hangs or prints errors: every error is swallowed.
 */
import { spawnSync } from 'node:child_process';
import { DEFAULT_PORT, loadStoredConfig } from '../packages/server/src/config.ts';

// Whatever happens, Claude Code gets its line back quickly.
setTimeout(() => process.exit(0), 1500).unref();

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const pct = (v: unknown): string | undefined => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}%` : undefined);

/** "Opus · ctx 23% · 5h 38% · 7d 59%" (parts that are missing are left out). */
function defaultLine(data: Obj): string {
  const rl = obj(data.rate_limits);
  const parts = [
    typeof obj(data.model).display_name === 'string' ? (obj(data.model).display_name as string) : 'Claude',
    pct(obj(data.context_window).used_percentage) && `ctx ${pct(obj(data.context_window).used_percentage)}`,
    pct(obj(rl.five_hour).used_percentage) && `5h ${pct(obj(rl.five_hour).used_percentage)}`,
    pct(obj(rl.seven_day).used_percentage) && `7d ${pct(obj(rl.seven_day).used_percentage)}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const stored = loadStoredConfig();
  let data: Obj = {};
  try { data = obj(JSON.parse(raw)); } catch { /* show the default line */ }

  let line = '';
  const wrapped = stored.wrappedStatusLine?.command;
  if (typeof wrapped === 'string' && wrapped.trim()) {
    try {
      const r = spawnSync(wrapped, { input: raw, shell: true, timeout: 1000, encoding: 'utf8', windowsHide: true });
      if (r.status === 0 && r.stdout) line = r.stdout.replace(/\s+$/, '');
    } catch { /* fall back to the default line */ }
  }
  process.stdout.write((line || defaultLine(data)) + '\n');

  if (!raw.trim() || !stored.token) return;
  await fetch(`http://127.0.0.1:${stored.port ?? DEFAULT_PORT}/api/statusline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Village-Token': stored.token },
    body: raw,
    signal: AbortSignal.timeout(300),
  });
}

main().catch(() => { /* the town is off: the status line is already printed */ }).finally(() => { process.exitCode = 0; });
