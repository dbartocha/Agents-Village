#!/usr/bin/env node
/**
 * Installs, removes or shows the Claude Code and GitHub Copilot hooks that feed Agent Village.
 *
 *   node scripts/hooks.ts install   [--approvals] [--port 4747] [--project <folder>] [--only claude|copilot] [--claude | --copilot] [--no-statusline]
 *   node scripts/hooks.ts uninstall [--project <folder>] [--only claude|copilot] [--claude | --copilot]
 *   node scripts/hooks.ts status    [--project <folder>]
 *
 * Claude Code: default target is your user settings (~/.claude/settings.json), so every project you open
 * shows up in the town. --project writes <folder>/.claude/settings.local.json instead.
 * The same settings file gets the village status line (scripts/statusline.ts); a status line you already
 * had is kept in ~/.agent-village/config.json and restored by uninstall. --no-statusline skips it.
 * A backup of the settings file is saved in ~/.agent-village/backups before every change.
 * GitHub Copilot: one file of our own, ~/.copilot/hooks/agent-village.json (user level only).
 * See readme.adoc → "Claude Code hooks" and "GitHub Copilot hooks".
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_APPROVAL_TIMEOUT_SEC, DEFAULT_PORT, configDir, ensureToken, loadStoredConfig, saveStoredConfig,
} from '../packages/server/src/config.ts';
import {
  APPROVAL_EVENT, COPILOT_HOOKS_FILE, OBSERVE_EVENTS, addStatusLine, addVillageHooks, copilotHooks, installedEvents,
  isVillageStatusLine, removeStatusLine, removeVillageHooks,
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

/** Copilot CLI and VS Code read user hooks from here (COPILOT_HOME moves it). */
function copilotHooksPath(): string {
  return join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'hooks', COPILOT_HOOKS_FILE);
}

const COPILOT_SCRIPT = fileURLToPath(new URL('./copilot-hook.ts', import.meta.url));
const STATUSLINE_SCRIPT = fileURLToPath(new URL('./statusline.ts', import.meta.url));

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
  const only = readFlag(argv, '--only') ?? (argv.includes('--copilot') ? 'copilot' : argv.includes('--claude') ? 'claude' : undefined);
  if (only && only !== 'claude' && only !== 'copilot') throw new Error('--only must be "claude" or "copilot".');
  const doClaude = only !== 'copilot';
  // Copilot hooks are user-level only; a project install is about one Claude Code project.
  const doCopilot = only !== 'claude' && !readFlag(argv, '--project');
  const copilotFile = copilotHooksPath();
  if (cmd === 'install') {
    const stored = loadStoredConfig();
    const port = Number(readFlag(argv, '--port') ?? stored.port ?? DEFAULT_PORT);
    const approvals = argv.includes('--approvals') ? true : argv.includes('--no-approvals') ? false : (stored.approvals ?? false);
    const approvalTimeoutSec = stored.approvalTimeoutSec ?? DEFAULT_APPROVAL_TIMEOUT_SEC;
    const token = ensureToken();
    saveStoredConfig({ ...loadStoredConfig(), port, approvals, approvalTimeoutSec });
    if (doClaude) {
      let next = addVillageHooks(readSettings(file), { port, token, approvals, approvalTimeoutSec });
      const withStatus = !argv.includes('--no-statusline');
      if (withStatus) {
        const r = addStatusLine(next, STATUSLINE_SCRIPT);
        next = r.settings;
        // Save the user's own status line before it is replaced; scripts/statusline.ts keeps showing it.
        if (r.wrapped) saveStoredConfig({ ...loadStoredConfig(), wrappedStatusLine: r.wrapped });
      }
      const backup = writeSettings(file, next);
      console.log(`\n  Claude Code hooks installed in ${file}`);
      if (backup) console.log(`  Backup of the previous file: ${backup}`);
      console.log(`  Events: ${OBSERVE_EVENTS.join(', ')}${approvals ? ', ' + APPROVAL_EVENT : ''}`);
      console.log(`  Approvals from the village: ${approvals ? 'on' : 'off'}`);
      if (withStatus) {
        const wrapped = loadStoredConfig().wrappedStatusLine;
        console.log(`  Status line: installed (model, cost and limits for the bank)${wrapped ? `; your previous one still shows: ${wrapped.command ?? ''}` : ''}`);
      }
      console.log('  Restart open Claude Code sessions (or run /hooks in them) so they pick up the change.');
    }
    if (doCopilot) {
      mkdirSync(dirname(copilotFile), { recursive: true });
      writeFileSync(copilotFile, JSON.stringify(copilotHooks(COPILOT_SCRIPT), null, 2) + '\n', 'utf8');
      console.log(`\n  GitHub Copilot hooks installed in ${copilotFile}`);
      console.log('  Used by Copilot CLI and VS Code agent mode (watch only). Start new Copilot sessions to pick them up.');
    }
    console.log('');
    return 0;
  }
  if (cmd === 'uninstall') {
    if (doClaude) {
      const before = readSettings(file);
      const stored = loadStoredConfig();
      if (!installedEvents(before).length && !isVillageStatusLine(before.statusLine)) console.log(`\n  No Agent Village hooks in ${file}. Nothing to do.`);
      else {
        const hadStatus = isVillageStatusLine(before.statusLine);
        const backup = writeSettings(file, removeStatusLine(removeVillageHooks(before), stored.wrappedStatusLine));
        console.log(`\n  Agent Village hooks removed from ${file}`);
        if (hadStatus) {
          console.log(stored.wrappedStatusLine ? '  Your previous status line is back.' : '  Status line removed.');
          const { wrappedStatusLine: _w, ...rest } = stored;
          saveStoredConfig(rest);
        }
        if (backup) console.log(`  Backup of the previous file: ${backup}`);
      }
    }
    if (doCopilot) {
      if (existsSync(copilotFile)) { rmSync(copilotFile); console.log(`  GitHub Copilot hooks removed (${copilotFile})`); }
      else console.log('  No GitHub Copilot hooks from Agent Village. Nothing to do.');
    }
    console.log('');
    return 0;
  }
  if (cmd === 'status') {
    const settings = readSettings(file);
    const events = installedEvents(settings);
    console.log(`\n  Settings file: ${file}`);
    console.log(events.length ? `  Installed for: ${events.join(', ')}` : '  Not installed. Run: pnpm hooks:install');
    console.log(`  Approvals from the village: ${events.includes(APPROVAL_EVENT) ? 'on' : 'off'}`);
    const wrapped = loadStoredConfig().wrappedStatusLine;
    const ours = isVillageStatusLine(settings.statusLine);
    console.log(`  Status line: ${ours ? 'installed' + (wrapped ? ` (wraps: ${wrapped.command ?? ''})` : '') : settings.statusLine ? 'another one (the bank gets no model, cost or limits)' : 'not installed'}`);
    console.log(`  GitHub Copilot: ${existsSync(copilotFile) ? 'installed (' + copilotFile + ')' : 'not installed'}\n`);
    return 0;
  }
  console.log('Usage: node scripts/hooks.ts <install|uninstall|status> [--approvals] [--port 4747] [--project <folder>] [--only claude|copilot] [--claude|--copilot] [--no-statusline]');
  return cmd ? 1 : 0;
}

try { process.exitCode = main(process.argv.slice(2)); }
catch (err) { console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; }
