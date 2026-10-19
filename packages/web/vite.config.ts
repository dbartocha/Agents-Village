/**
 * Vite config for the town.
 * Dev: http://localhost:5173 proxies /events and /api to the village server and injects its token.
 * Build: writes dist/, which the village server serves (and injects the token into index.html itself).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const SERVER = `http://127.0.0.1:${process.env.AGENT_VILLAGE_PORT ?? 4747}`;

/** In dev the page is served by Vite, so put the server's token into the page here. */
function devToken(): Plugin {
  return {
    name: 'agent-village-dev-token',
    apply: 'serve',
    transformIndexHtml(html) {
      try {
        const dir = process.env.AGENT_VILLAGE_HOME || join(homedir(), '.agent-village');
        const { token } = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { token?: unknown };
        if (typeof token === 'string' && token) return html.replace('__AGENT_VILLAGE_TOKEN__', token);
      } catch {
        // No config yet: start the server once (pnpm serve) to create it. The page falls back to the demo.
      }
      return html;
    },
  };
}

export default defineConfig({
  plugins: [devToken()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/events': SERVER, '/api': SERVER },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
