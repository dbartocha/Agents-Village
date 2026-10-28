#!/usr/bin/env node
/**
 * Claude Code status line that also feeds Agent Village (model, cost, context, rate limits).
 *
 *   statusLine: { "type": "command", "command": "node \"<repo>/scripts/statusline.ts\"" }   (installed by pnpm hooks:install)
 *
 * Both CLIs pass JSON on stdin. A bounded local lookup adds the actual robot name.
 * Claude also posts usage; --copilot never feeds Copilot data into the Claude bank.
 * It never fails, hangs or prints errors: every error is swallowed.
 */
import { spawnSync } from 'node:child_process';
import { DEFAULT_PORT, loadStoredConfig } from '../packages/server/src/config.ts';
import { publishTerminalTitle } from './terminal-title.ts';

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
function defaultLine(data: Obj, copilot: boolean): string {
  const rl = obj(data.rate_limits);
  const parts = [
    typeof obj(data.model).display_name === 'string' ? (obj(data.model).display_name as string) : copilot ? 'Copilot' : 'Claude',
    pct(obj(data.context_window).used_percentage) && `ctx ${pct(obj(data.context_window).used_percentage)}`,
    pct(obj(rl.five_hour).used_percentage) && `5h ${pct(obj(rl.five_hour).used_percentage)}`,
    pct(obj(rl.seven_day).used_percentage) && `7d ${pct(obj(rl.seven_day).used_percentage)}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const stored = loadStoredConfig();
  const copilot = process.argv.includes('--copilot');
  let data: Obj = {};
  try { data = obj(JSON.parse(raw)); } catch { /* show the default line */ }

  let line = '';
  const wrapped = (copilot ? stored.wrappedCopilotStatusLine : stored.wrappedStatusLine)?.command;
  if (typeof wrapped === 'string' && wrapped.trim()) {
    try {
      const r = spawnSync(wrapped, { input: raw, shell: true, timeout: 1000, encoding: 'utf8', windowsHide: true });
      if (r.status === 0 && r.stdout) line = r.stdout.replace(/\s+$/, '');
    } catch { /* fall back to the default line */ }
  }
  let label = 'Agents Village: unavailable';
  try {
    const id = data.session_id ?? data.sessionId;
    if (typeof id !== 'string' || !id || !stored.token) throw new Error('No session identity');
    const base = `http://127.0.0.1:${stored.port ?? DEFAULT_PORT}`;
    const headers = { 'Content-Type': 'application/json', 'X-Agent-Village-Token': stored.token };
    const response = copilot
      ? await fetch(`${base}/api/robot?sessionId=${encodeURIComponent('copilot:' + id)}`, { headers, signal: AbortSignal.timeout(300) })
      : await fetch(`${base}/api/statusline`, { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(300) });
    const encoded = response.headers.get('X-Agent-Village-Robot-Name');
    if (!response.ok || !encoded) throw new Error('Robot not observed');
    const name = decodeURIComponent(encoded);
    if (!name.trim() || name.length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(name)) throw new Error('Invalid robot name');
    label = `${name} \u00b7 Agents Village`;
    // Title synchronization is optional; a closed launcher must not hide a valid name.
    await publishTerminalTitle(response, copilot ? 'copilot' : 'claude').catch(() => {});
  } catch { /* Offline status stays explicit without interrupting the CLI. */ }
  process.stdout.write(`${label} | ${line || defaultLine(data, copilot)}\n`);
}

setTimeout(() => { process.stdout.write('Agents Village: status line timed out\n'); process.exit(0); }, 2000).unref();
main().catch(() => { process.stdout.write('Agents Village: status line unavailable\n'); }).finally(() => { process.exitCode = 0; });
