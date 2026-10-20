import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Callers serialize writes and report errors. Failed replacement leaves the previous file intact. */
export async function savePrivateJson(file: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value) + '\n';
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, 'wx', 0o600);
    try { await handle.writeFile(data, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}
