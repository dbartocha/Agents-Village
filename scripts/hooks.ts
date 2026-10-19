#!/usr/bin/env node
/**
 * Installs, removes or shows the Claude Code hooks that feed Agent Village.
 *
 *   node scripts/hooks.ts install   [--approvals] [--port 4747] [--project <folder>]
 *   node scripts/hooks.ts uninstall [--project <folder>]
 *   node scripts/hooks.ts status    [--project <folder>]
 *
 * Default target is your user settings (~/.claude/settings.json), so every project you open with
 * Claude Code shows up in the town. --project writes <folder>/.claude/settings.local.json instead.
 * A backup of the settings file is saved in ~/.agent-village/backups before every change.
 * See readme.adoc → "Claude Code hooks".
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  DEFAULT_APPROVAL_TIMEOUT_SEC, DEFAULT_PORT, configDir, ensureToken, loadStoredConfig, saveStoredConfig,
} from '../packages/server/src/config.ts';
import {
  APPROVAL_EVENT, OBSERVE_EVENTS, addVillageHooks, installedEvents, removeVillageHooks,
} from '../packages/server/src/hooks-config.ts';
import type { Settings } from '../packages/server/src/hooks-config.ts';

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function settingsPath(argv: string[]): string {
  const project = readFlag(argv, '--project');
  if (project) return join(resolve(project), '.claude', 'settings.local.json');
  return join(homedir(), '.claude', 'settings.json');
}

function readSettings(file: string): Settings {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw) as Settings; }
  catch { throw new Error(`${file} is not valid JSON. Fix it by hand first (nothing was changed).`); }
}

function writeSettings(file: string, settings: Settings): string | undefined {
  let backup: string | undefined;
  if (existsSync(file)) {
    const dir = join(configDir(), 'backups');
    mkdirSync(dir, { recursive: true });
    backup = join(dir, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    copyFileSync(file, backup);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return backup;
}

function main(argv: string[]): number {
  const cmd = argv[0];
  const file = settingsPath(argv);
  if (cmd === 'install') {
    const stored = loadStoredConfig();
    const port = Number(readFlag(argv, '--port') ?? stored.port ?? DEFAULT_PORT);
    const approvals = argv.includes('--approvals') ? true : argv.includes('--no-approvals') ? false : (stored.approvals ?? false);
    const approvalTimeoutSec = stored.approvalTimeoutSec ?? DEFAULT_APPROVAL_TIMEOUT_SEC;
    const token = ensureToken();
    saveStoredConfig({ ...loadStoredConfig(), port, approvals, approvalTimeoutSec });
    const backup = writeSettings(file, addVillageHooks(readSettings(file), { port, token, approvals, approvalTimeoutSec }));
    console.log(`\n  Hooks installed in ${file}`);
    if (backup) console.log(`  Backup of the previous file: ${backup}`);
    console.log(`  Events: ${OBSERVE_EVENTS.join(', ')}${approvals ? ', ' + APPROVAL_EVENT : ''}`);
    console.log(`  Approvals from the village: ${approvals ? 'on' : 'off'}`);
    console.log('\n  Restart open Claude Code sessions (or run /hooks in them) so they pick up the change.\n');
    return 0;
  }
  if (cmd === 'uninstall') {
    const before = readSettings(file);
    if (!installedEvents(before).length) { console.log(`\n  No Agent Village hooks in ${file}. Nothing to do.\n`); return 0; }
    const backup = writeSettings(file, removeVillageHooks(before));
    console.log(`\n  Agent Village hooks removed from ${file}`);
    if (backup) console.log(`  Backup of the previous file: ${backup}`);
    console.log('');
    return 0;
  }
  if (cmd === 'status') {
    const events = installedEvents(readSettings(file));
    console.log(`\n  Settings file: ${file}`);
    console.log(events.length ? `  Installed for: ${events.join(', ')}` : '  Not installed. Run: pnpm hooks:install');
    console.log(`  Approvals from the village: ${events.includes(APPROVAL_EVENT) ? 'on' : 'off'}\n`);
    return 0;
  }
  console.log('Usage: node scripts/hooks.ts <install|uninstall|status> [--approvals] [--port 4747] [--project <folder>]');
  return cmd ? 1 : 0;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (err) { console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; }
