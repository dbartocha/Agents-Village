/**
 * The Copilot vault: premium requests used this month, from the GitHub billing API
 * (GET /users/{username}/settings/billing/premium_request/usage?year=&month=, checked 2026-10-20 at
 * https://docs.github.com/en/rest/billing/usage). Needs a fine-grained personal access token with the
 * "Plan" user permission (read), saved by `pnpm copilot:setup`. This is the only call the server makes
 * to the internet. The token never leaves the server: it is not logged and not sent to the browser.
 */
import type { CopilotBank } from '../../shared/src/index.ts';
import type { VillageState } from './state.ts';

export interface CopilotSettings {
  username: string;
  githubToken: string;
  monthlyAllowance?: number;
}

export const API_VERSION = '2026-03-10';

type Fetch = typeof fetch;

/** "2026-10" for a date (UTC, like GitHub billing). */
export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Sums the Copilot premium-request items of a usage report. */
export function sumPremiumRequests(body: unknown): number {
  const items = body && typeof body === 'object' ? (body as { usageItems?: unknown }).usageItems : undefined;
  if (!Array.isArray(items)) throw new Error('GitHub sent no usageItems');
  let used = 0;
  for (const it of items as Array<Record<string, unknown>>) {
    if (!it || typeof it !== 'object') continue;
    const product = String(it.product ?? ''), sku = String(it.sku ?? ''), unit = String(it.unitType ?? '');
    if (!/copilot/i.test(product + ' ' + sku)) continue;
    if (!/request/i.test(unit) && !/premium|request/i.test(sku)) continue;
    const q = typeof it.grossQuantity === 'number' ? it.grossQuantity : typeof it.netQuantity === 'number' ? it.netQuantity : 0;
    used += Number.isFinite(q) ? q : 0;
  }
  return Math.round(used * 100) / 100;
}

/** One call to GitHub. Throws a readable error (never containing the token). */
export async function fetchPremiumRequests(cfg: CopilotSettings, now = new Date(), fetchImpl: Fetch = fetch, timeoutMs = 10_000): Promise<number> {
  const url = `https://api.github.com/users/${encodeURIComponent(cfg.username)}/settings/billing/premium_request/usage`
    + `?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.githubToken}`,
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'agent-village',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(err instanceof Error && err.name === 'TimeoutError' ? 'GitHub did not answer in time' : 'Cannot reach api.github.com');
  }
  if (res.status === 401) throw new Error('GitHub rejected the token (401). Run pnpm copilot:setup again.');
  if (res.status === 403) throw new Error('The token has no access to billing (403). It needs the "Plan" permission (read).');
  if (res.status === 404) throw new Error('No billing data for this user (404). Is the user name right, and is Copilot paid by you, not an organisation?');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return sumPremiumRequests(await res.json());
}

export interface PollerOptions {
  settings: CopilotSettings;
  state: VillageState;
  intervalMs?: number;
  fetch?: Fetch;
  now?: () => Date;
  log?: (line: string) => void;
}

/** Asks GitHub at start and every 10 minutes. On errors the last value stays and `error` is set. */
export class CopilotBankPoller {
  private timer?: ReturnType<typeof setInterval>;
  private last?: CopilotBank;
  private readonly opts: PollerOptions;

  constructor(opts: PollerOptions) { this.opts = opts; }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs ?? 10 * 60_000);
    this.timer.unref?.();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  async poll(): Promise<CopilotBank> {
    const { settings, state } = this.opts;
    const now = this.opts.now?.() ?? new Date();
    const month = monthOf(now);
    let next: CopilotBank;
    try {
      const used = await fetchPremiumRequests(settings, now, this.opts.fetch ?? fetch);
      next = { used, month, updatedAt: now.getTime() };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      this.opts.log?.(`copilot bank: ${error}`);
      // updatedAt 0 means "never fetched": the town then shows an unknown vault, not a full one.
      next = this.last ? { ...this.last, error } : { used: 0, month, updatedAt: 0, error };
    }
    if (settings.monthlyAllowance) next.allowance = settings.monthlyAllowance;
    if (!next.error) this.last = next;
    state.setCopilotBank(next);
    return next;
  }
}
