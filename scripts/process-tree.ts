import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
interface Process { pid: number; parent: number; identity: string }

async function processes(): Promise<Process[]> {
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,stat=,lstart='], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return m && !m[3].startsWith('Z') ? [{ pid: Number(m[1]), parent: Number(m[2]), identity: m[4] }] : [];
  });
}

function signal(p: Process, name: NodeJS.Signals): void {
  try { process.kill(p.pid, name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

/** Targets this child and observed descendants only, never terminal/shell parents or unrelated CLIs. */
export async function terminateTree(pid: number): Promise<void> {
  const initial = await processes();
  const root = initial.find(p => p.pid === pid);
  if (!root) return;
  const owned = new Map<number, Process>([[pid, root]]);
  const collect = (all: Process[]) => {
    let added: boolean;
    do {
      added = false;
      for (const p of all) {
        const parent = owned.get(p.parent);
        if (owned.has(p.pid) || !parent || !all.some(q => q.pid === parent.pid && q.identity === parent.identity)) continue;
        owned.set(p.pid, p);
        added = true;
      }
    } while (added);
  };
  collect(initial);
  for (const p of [...owned.values()].reverse()) signal(p, 'SIGTERM');
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(100);
    const current = await processes();
    collect(current);
    const alive = current.filter(p => owned.get(p.pid)?.identity === p.identity);
    if (!alive.length) return;
    if (attempt >= 9) for (const p of alive.reverse()) signal(p, 'SIGKILL');
  }
  throw new Error('Some supervised processes did not exit. Check the CLI terminal.');
}
