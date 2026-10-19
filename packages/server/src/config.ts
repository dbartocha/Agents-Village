import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PORT = 4747;
export const DEFAULT_APPROVAL_TIMEOUT_SEC = 60;

/** What the server runs with after merging the stored file, environment and command line. */
export interface VillageConfig {
  port: number;
  host: string;
  token: string;
  approvals: boolean;
  approvalTimeoutSec: number;
  open: boolean;
  /** Extra host names accepted in the Host header (for example a LAN IP when --host is used). */
  allowedHosts: string[];
  configDir: string;
}

/** Settings persisted in ~/.agent-village/config.json. */
export interface StoredConfig {
  token?: string;
  port?: number;
  approvals?: boolean;
  approvalTimeoutSec?: number;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_VILLAGE_HOME || join(homedir(), '.agent-village');
}

export function configFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json');
}

export function loadStoredConfig(env: NodeJS.ProcessEnv = process.env): StoredConfig {
  const file = configFile(env);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as StoredConfig) : {};
  } catch {
    return {};
  }
}

export function saveStoredConfig(next: StoredConfig, env: NodeJS.ProcessEnv = process.env): void {
  mkdirSync(configDir(env), { recursive: true });
  writeFileSync(configFile(env), JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/** Returns the shared secret used by hooks and the web page, creating it on first use. */
export function ensureToken(env: NodeJS.ProcessEnv = process.env): string {
  const stored = loadStoredConfig(env);
  if (stored.token && stored.token.length >= 32) return stored.token;
  const token = randomBytes(24).toString('hex');
  saveStoredConfig({ ...stored, token }, env);
  return token;
}

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find(a => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : undefined;
}

function toBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function resolveConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): VillageConfig {
  const stored = loadStoredConfig(env);
  const token = ensureToken(env);
  const port = Number(readFlag(argv, '--port') ?? env.AGENT_VILLAGE_PORT ?? stored.port ?? DEFAULT_PORT);
  const host = readFlag(argv, '--host') ?? env.AGENT_VILLAGE_HOST ?? '127.0.0.1';
  let approvals = stored.approvals ?? false;
  const envApprovals = toBool(env.AGENT_VILLAGE_APPROVALS);
  if (envApprovals !== undefined) approvals = envApprovals;
  if (argv.includes('--approvals')) approvals = true;
  if (argv.includes('--no-approvals')) approvals = false;
  const approvalTimeoutSec = Number(readFlag(argv, '--approval-timeout') ?? env.AGENT_VILLAGE_APPROVAL_TIMEOUT ?? stored.approvalTimeoutSec ?? DEFAULT_APPROVAL_TIMEOUT_SEC);
  const allowedHosts = (env.AGENT_VILLAGE_ALLOWED_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(host)) allowedHosts.push(host);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${port}`);
  if (!Number.isFinite(approvalTimeoutSec) || approvalTimeoutSec < 5) throw new Error(`Invalid approval timeout: ${approvalTimeoutSec}`);
  return { port, host, token, approvals, approvalTimeoutSec, open: argv.includes('--open'), allowedHosts, configDir: configDir(env) };
}
