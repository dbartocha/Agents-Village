import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CopilotBankPoller, sumPremiumRequests } from '../src/copilot-bank.ts';
import { VillageState } from '../src/state.ts';

const report = (items: Array<Record<string, unknown>>) => ({ timePeriod: { year: 2026, month: 10 }, user: 'me', usageItems: items });
const item = (extra: Record<string, unknown>) => ({
  product: 'Copilot', sku: 'Copilot Premium Request', model: 'Claude Sonnet 4.5', unitType: 'requests',
  pricePerUnit: 0.04, grossQuantity: 0, discountQuantity: 0, netQuantity: 0, ...extra,
});

test('premium requests of the month are summed, other products are not', () => {
  const body = report([
    item({ grossQuantity: 150, netQuantity: 0 }),
    item({ model: 'GPT-5', grossQuantity: 62.5 }),
    { product: 'Actions', sku: 'Actions Linux', unitType: 'minutes', grossQuantity: 900 },
  ]);
  assert.equal(sumPremiumRequests(body), 212.5);
  assert.throws(() => sumPremiumRequests({ message: 'Not Found' }));
});

test('the poller asks GitHub with the token and keeps the last value on errors', async () => {
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60 });
  const calls: Array<{ url: string; auth: string }> = [];
  let fail = false;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: String((init?.headers as Record<string, string>).Authorization) });
    if (fail) return new Response('{"message":"Bad credentials"}', { status: 401 });
    return new Response(JSON.stringify(report([item({ grossQuantity: 212 })])), { status: 200 });
  }) as typeof fetch;
  const poller = new CopilotBankPoller({
    settings: { username: 'octo cat', githubToken: 'ghp_secret', monthlyAllowance: 300 },
    state, fetch: fakeFetch, now: () => new Date(Date.UTC(2026, 9, 20, 12)),
  });
  const ok = await poller.poll();
  assert.equal(calls[0].url, 'https://api.github.com/users/octo%20cat/settings/billing/premium_request/usage?year=2026&month=10');
  assert.equal(calls[0].auth, 'Bearer ghp_secret');
  assert.deepEqual({ used: ok.used, allowance: ok.allowance, month: ok.month, error: ok.error }, { used: 212, allowance: 300, month: '2026-10', error: undefined });
  assert.equal(state.bank.copilot?.used, 212);

  fail = true;
  const bad = await poller.poll();
  assert.equal(bad.used, 212);
  assert.match(bad.error ?? '', /401/);
  assert.equal(state.bank.copilot?.used, 212);
  assert.ok(!JSON.stringify(state.bank).includes('ghp_secret'), 'the token never reaches the town');
});

test('a first failure shows an unknown vault, not a full one', async () => {
  const state = new VillageState({ approvals: false, approvalTimeoutSec: 60 });
  const poller = new CopilotBankPoller({
    settings: { username: 'me', githubToken: 't', monthlyAllowance: 300 }, state,
    fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
  });
  const b = await poller.poll();
  assert.equal(b.updatedAt, 0);
  assert.equal(b.error, 'Cannot reach api.github.com');
});
