import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseHookPayload } from '../../shared/src/index.ts';
import type { Decision, ServerMessage } from '../../shared/src/index.ts';
import type { VillageConfig } from './config.ts';
import { PermissionBroker, permissionHookResponse } from './permissions.ts';
import type { VillageState } from './state.ts';

export interface AppOptions {
  config: VillageConfig;
  state: VillageState;
  broker: PermissionBroker;
  version: string;
  /** Folder with the built web town (packages/web/dist). */
  webRoot: string;
  log?: (line: string) => void;
}

const MAX_BODY = 2 * 1024 * 1024;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
};
const HTML_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
].join('; ');

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1);
  return hostHeader.split(':')[0].toLowerCase();
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res: ServerResponse, status: number, body: string | Buffer = '', type = 'application/json; charset=utf-8', extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, data: unknown) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const NOT_BUILT_PAGE = `<!doctype html><meta charset="utf-8"><title>Agent Village</title>
<body style="font:16px system-ui;max-width:640px;margin:10vh auto;padding:0 16px;line-height:1.5">
<h1>Agent Village server is running</h1>
<p>The town (web front-end) is not built yet. In the project folder run:</p>
<pre style="background:#f2f4f7;padding:12px;border-radius:8px">pnpm install
pnpm build</pre>
<p>then refresh this page. For development use <code>pnpm dev</code>. Details: <code>readme.adoc</code>.</p></body>`;

/** Creates the HTTP server: hook endpoint, live event stream, small JSON API and the static town. */
export function createApp(opts: AppOptions): Server {
  const { config, state, broker, version, log = () => {} } = opts;
  const allowedHosts = new Set([...LOOPBACK, ...config.allowedHosts.map(h => h.toLowerCase())]);
  const webRoot = resolve(opts.webRoot);
  const clients = new Set<ServerResponse>();

  const sseWrite = (res: ServerResponse, msg: ServerMessage) => {
    res.write(`event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`);
  };
  state.subscribe(msg => { for (const c of clients) sseWrite(c, msg); });
  const heartbeat = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20_000);
  heartbeat.unref();

  const tokenOk = (req: IncomingMessage, url: URL) => {
    const given = (req.headers['x-agent-village-token'] as string | undefined) ?? url.searchParams.get('token') ?? '';
    return safeEqual(given, config.token);
  };
  const originOk = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return allowedHosts.has(new URL(origin).hostname.toLowerCase()) || allowedHosts.has(`[${new URL(origin).hostname}]`); }
    catch { return false; }
  };

  async function handleHook(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!tokenOk(req, url)) return json(res, 401, { error: 'Bad or missing X-Agent-Village-Token' });
    let body: unknown;
    try { body = JSON.parse(await readBody(req)); }
    catch { return json(res, 400, { error: 'Body must be JSON' }); }
    const parsed = parseHookPayload(body);
    if (!parsed.ok) return json(res, 400, { error: parsed.error });
    const outcome = state.handleHook(parsed.value);
    const p = parsed.value;
    log(`hook ${p.hook_event_name}${typeof p.tool_name === 'string' ? ' ' + p.tool_name : ''} · ${p.session_id.slice(0, 8)}`);
    if (!outcome.holdPermissionId) return send(res, 200, '', 'text/plain; charset=utf-8');

    const id = outcome.holdPermissionId;
    let closed = false;
    res.on('close', () => { if (!res.writableEnded) { closed = true; if (broker.cancel(id)) state.resolvePermission(id, 'cancelled'); } });
    const decision = await broker.wait(id, config.approvalTimeoutSec * 1000);
    if (closed) return;
    if (!decision) {
      state.resolvePermission(id, 'timeout');
      log(`permission ${id}: no answer in time, Claude Code will ask in the terminal`);
      return send(res, 200, '', 'text/plain; charset=utf-8');
    }
    log(`permission ${id}: ${decision}`);
    return send(res, 200, permissionHookResponse(decision));
  }

  async function handleDecision(req: IncomingMessage, res: ServerResponse, url: URL, id: string) {
    if (!tokenOk(req, url)) return json(res, 401, { error: 'Bad or missing token' });
    if (!originOk(req)) return json(res, 403, { error: 'Origin not allowed' });
    let decision: Decision;
    try {
      const body = JSON.parse(await readBody(req)) as { decision?: string };
      if (body.decision !== 'allow' && body.decision !== 'deny') throw new Error();
      decision = body.decision;
    } catch { return json(res, 400, { error: 'Body must be {"decision":"allow"|"deny"}' }); }
    if (!broker.decide(id, decision)) return json(res, 409, { error: 'This request is no longer waiting. Answer it in the terminal.' });
    state.resolvePermission(id, decision);
    return json(res, 200, { ok: true });
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!tokenOk(req, url)) return json(res, 401, { error: 'Bad or missing token' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    sseWrite(res, { type: 'snapshot', snapshot: state.snapshot(version) });
    clients.add(res);
    req.on('close', () => { clients.delete(res); });
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    const indexFile = join(webRoot, 'index.html');
    if (!existsSync(indexFile)) return send(res, 200, NOT_BUILT_PAGE, MIME['.html'], { 'Content-Security-Policy': HTML_CSP });
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(webRoot, rel));
    if (!file.startsWith(webRoot + sep) && file !== webRoot) return send(res, 403, 'Forbidden', 'text/plain');
    let target = file;
    if (!existsSync(target) || !statSync(target).isFile()) {
      if (extname(rel)) return send(res, 404, 'Not found', 'text/plain');
      target = indexFile;
    }
    const ext = extname(target).toLowerCase();
    if (ext === '.html') {
      const html = readFileSync(target, 'utf8').replace(/__AGENT_VILLAGE_TOKEN__/g, config.token);
      return send(res, 200, html, MIME['.html'], { 'Cache-Control': 'no-store', 'Content-Security-Policy': HTML_CSP });
    }
    const cache = target.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    return send(res, 200, readFileSync(target), MIME[ext] ?? 'application/octet-stream', { 'Cache-Control': cache });
  }

  const server = createServer((req, res) => {
    const host = hostnameOf(req.headers.host);
    if (!allowedHosts.has(host)) return send(res, 403, 'Host not allowed', 'text/plain');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const fail = (err: unknown) => {
      log(`error ${req.method} ${path}: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
    };
    try {
      if (path === '/hooks' && req.method === 'POST') return void handleHook(req, res, url).catch(fail);
      if (path === '/events' && req.method === 'GET') return handleEvents(req, res, url);
      if (path === '/api/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, name: 'agent-village', version, approvals: state.approvals, sessions: state.sessions.size });
      }
      if (path === '/api/state' && req.method === 'GET') {
        if (!tokenOk(req, url)) return json(res, 401, { error: 'Bad or missing token' });
        return json(res, 200, state.snapshot(version));
      }
      const m = path.match(/^\/api\/permissions\/([\w-]+)$/);
      if (m && req.method === 'POST') return void handleDecision(req, res, url, m[1]).catch(fail);
      if (path.startsWith('/api/') || path === '/hooks' || path === '/events') return json(res, 405, { error: 'Method not allowed' });
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
      return send(res, 405, 'Method not allowed', 'text/plain');
    } catch (err) { fail(err); }
  });
  server.on('close', () => { clearInterval(heartbeat); for (const c of clients) c.end(); clients.clear(); broker.cancelAll(); });
  return server;
}
