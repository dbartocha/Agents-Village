import { mkdtemp, rmdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from '../packages/shared/src/index.ts';

export const ROBOT_NAME_HEADER = 'X-Agent-Village-Robot-Name';

function validTitle(title: string): boolean {
  return title.length > 0 && title.length <= 160 && !/[\x00-\x1f\x7f-\x9f]/.test(title);
}

/** Hooks have captured stdout; only the launcher writes escape sequences to its own terminal. */
export async function publishTerminalTitle(response: Response, provider: Provider): Promise<void> {
  const address = process.env.AGENT_VILLAGE_TITLE_SOCKET;
  if (!address || process.env.AGENT_VILLAGE_TITLE_PROVIDER !== provider || !response.ok) return;
  const encoded = response.headers.get(ROBOT_NAME_HEADER);
  if (!encoded) return;
  const name = decodeURIComponent(encoded);
  const title = `${name} \u00b7 ${provider === 'copilot' ? 'Copilot' : 'Claude Code'}`;
  if (!name.trim() || !validTitle(title)) throw new Error('Invalid robot name in terminal title response');
  const encodedId = response.headers.get('X-Agent-Village-Session-Id');
  const sessionId = encodedId ? decodeURIComponent(encodedId) : undefined;
  if (sessionId && (sessionId.length > 200 || /[\x00-\x20\x7f]/.test(sessionId)
    || (provider === 'copilot') !== sessionId.startsWith('copilot:'))) throw new Error('Invalid session identity');
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ path: address });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Terminal title update timed out')); }, 200);
    socket.once('connect', () => socket.end(sessionId ? JSON.stringify({ title, sessionId }) : title));
    socket.once('error', reject);
    socket.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

export async function createTitleBridge(onTitle: (title: string, sessionId?: string) => void, onError: (error: Error) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'av-title-'));
  const address = join(directory, 's');
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket);
    let title = '';
    socket.setEncoding('utf8');
    socket.setTimeout(500, () => socket.destroy());
    socket.on('data', chunk => {
      title += chunk;
      if (title.length > 1024) {
        onError(new Error('Terminal title is too long'));
        socket.destroy();
      }
    });
    socket.on('end', () => {
      try {
        const packet: unknown = title.startsWith('{') ? JSON.parse(title) : { title };
        if (!packet || typeof packet !== 'object') throw new Error('Invalid terminal title');
        const p = packet as Record<string, unknown>;
        if (typeof p.title !== 'string' || !validTitle(p.title)
          || (p.sessionId !== undefined && (typeof p.sessionId !== 'string' || !p.sessionId
            || p.sessionId.length > 200 || /[\x00-\x20\x7f]/.test(p.sessionId)))) throw new Error('Invalid terminal title');
        onTitle(p.title, typeof p.sessionId === 'string' ? p.sessionId : undefined);
      } catch (error) { onError(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('error', onError);
    socket.on('close', () => sockets.delete(socket));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address, () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) {
    await rmdir(directory);
    throw error;
  }
  server.on('error', onError);
  return {
    address,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rmdir(directory);
    },
  };
}
