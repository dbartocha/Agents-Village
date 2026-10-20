#!/usr/bin/env node
/**
 * Connects the Copilot vault of the town's bank to your GitHub account.
 *
 *   pnpm copilot:setup --user <github-name> [--allowance 300]
 *   pnpm copilot:setup --off            (forget the account and the token)
 *
 * The token (fine-grained, user permission "Plan": read) comes from AGENT_VILLAGE_GITHUB_TOKEN or is typed
 * in the terminal without echo. It is saved in ~/.agent-village/config.json (file mode 600), used only for
 * api.github.com, and never printed. See readme.adoc → "GitHub Copilot" → "The Copilot vault".
 */
import { loadStoredConfig, saveStoredConfig } from '../packages/server/src/config.ts';
import { fetchPremiumRequests, monthOf } from '../packages/server/src/copilot-bank.ts';

function readFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** Reads a line from the terminal without showing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { reject(new Error('No terminal to type the token in. Set AGENT_VILLAGE_GITHUB_TOKEN instead.')); return; }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (err) reject(err); else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { done(); return; }
        if (ch === '\u0003') { done(new Error('Cancelled.')); return; }
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(argv: string[]): Promise<number> {
  const stored = loadStoredConfig();
  if (argv.includes('--off')) {
    const { copilot: _c, ...rest } = stored;
    saveStoredConfig(rest);
    console.log('\n  The Copilot vault is disconnected and the token is deleted. Restart the town (pnpm start).\n');
    return 0;
  }
  const username = readFlag(argv, '--user') ?? stored.copilot?.username;
  if (!username) {
    console.log('\n  Usage: pnpm copilot:setup --user <your GitHub user name> [--allowance 300]\n');
    return 1;
  }
  const allowance = Number(readFlag(argv, '--allowance') ?? stored.copilot?.monthlyAllowance ?? 300);
  if (!Number.isFinite(allowance) || allowance <= 0) throw new Error('--allowance must be a positive number (premium requests per month).');
  const githubToken = process.env.AGENT_VILLAGE_GITHUB_TOKEN?.trim()
    || await askHidden('  Paste your GitHub token (Plan: read). It will not be shown: ');
  if (!githubToken) throw new Error('No token given. Nothing was changed.');

  console.log('  Checking the token with GitHub…');
  const used = await fetchPremiumRequests({ username, githubToken });
  saveStoredConfig({ ...loadStoredConfig(), copilot: { username, githubToken, monthlyAllowance: allowance } });
  console.log(`\n  Copilot vault connected for ${username}.`);
  console.log(`  Premium requests in ${monthOf(new Date())}: ${used} of ${allowance}.`);
  console.log('  The token is saved in ~/.agent-village/config.json. Restart the town (pnpm start) to see it in the bank.\n');
  return 0;
}

main(process.argv.slice(2))
  .then(code => { process.exitCode = code; })
  .catch(err => { console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`); process.exitCode = 1; });
