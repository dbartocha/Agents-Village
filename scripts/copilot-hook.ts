#!/usr/bin/env node
/**
 * Command hook for GitHub Copilot (Copilot CLI and VS Code agent mode).
 *
 *   node scripts/copilot-hook.ts <eventName>   (hook JSON on stdin)
 *
 * Copilot allows http hooks to localhost only with COPILOT_HOOK_ALLOW_LOCALHOST=1 and never for preToolUse,
 * and VS Code runs only command hooks, so Copilot runs this script instead. The script forwards the payload
 * to the village server (POST /hooks/copilot?event=<eventName>) and always exits 0 with
 * no output: Copilot treats a failing preToolUse hook as "deny", and the village must never block it.
 * Port and token come from ~/.agent-village/config.json. Installed by `pnpm hooks:install`.
 */
import { DEFAULT_PORT, loadStoredConfig } from '../packages/server/src/config.ts';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const event = process.argv[2] ?? '';
  const body = (await readStdin()).trim();
  const stored = loadStoredConfig();
  if (!body || !stored.token) return;
  await fetch(`http://127.0.0.1:${stored.port ?? DEFAULT_PORT}/hooks/copilot?event=${encodeURIComponent(event)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Village-Token': stored.token },
    body,
    signal: AbortSignal.timeout(2000),
  });
}

// Never hold Copilot up for long, even if stdin stays open.
setTimeout(() => process.exit(0), 4000).unref();
main().catch(() => { /* the town is off or busy: Copilot carries on */ }).finally(() => { process.exitCode = 0; });
