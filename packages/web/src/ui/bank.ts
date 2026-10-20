/**
 * The bank in the UI: the floating label above the building, the chip next to the counters and the bank card.
 * Daily token/AIC payouts are separate from optional provider allowance vaults.
 */
import type { Bank } from '../../../shared/src/index.ts';
import { $, esc, placeScreenLabel } from '../lib/util';
import type { CameraRig } from '../world/camera';
import type { VaultLevels } from '../world/town';
import type { App } from './app';
import { fmtAic, fmtCompact, fmtNumber, fmtUsd, fmtWhen, t } from './i18n';

const left = (usedPct: number) => Math.max(0, Math.min(100, Math.round(100 - usedPct)));

/** Fill levels of the two glass vaults (what is left, 0–1). Unknown stays undefined: an empty grey vault. */
export function vaultLevels(bank: Bank): VaultLevels {
  const c = bank.claude, p = bank.copilot;
  const five = c?.fiveHour, seven = c?.sevenDay;
  return {
    claude: {
      level: five ? left(five.usedPct) / 100 : seven ? left(seven.usedPct) / 100 : undefined,
      mark: five && seven ? left(seven.usedPct) / 100 : undefined,
    },
    copilot: { level: p && p.updatedAt > 0 && p.allowance ? Math.max(0, 1 - p.used / p.allowance) : undefined },
  };
}

export class BankView {
  private bank: Bank = {};
  private isOpen = false;
  private sig = '';
  private readonly card = $('#bankCard');
  private readonly chip = $('#bankChip');
  private readonly tag: HTMLButtonElement;
  private readonly app: App;
  private readonly onLevels: (v: VaultLevels) => void;

  constructor(app: App, onLevels: (v: VaultLevels) => void, onOpen: () => void) {
    this.app = app;
    this.onLevels = onLevels;
    this.chip.addEventListener('click', onOpen);
    $('#bankClose').addEventListener('click', () => this.close());
    this.tag = document.createElement('button');
    this.tag.type = 'button';
    this.tag.className = 'banktag';
    this.tag.innerHTML = '<span class="bank-heading"><b></b><small></small></span>'
      + '<span class="c"><span>Claude</span><strong></strong></span>'
      + '<span class="p"><span>Copilot</span><strong></strong></span>';
    this.tag.addEventListener('click', onOpen);
    $('#tags').appendChild(this.tag);
    this.set({});
  }

  get open(): boolean { return this.isOpen; }

  set(bank: Bank): void {
    this.bank = bank;
    this.onLevels(vaultLevels(bank));
    this.relabel();
  }

  relabel(): void {
    this.tag.querySelector('b')!.textContent = t('bankName');
    this.tag.querySelector('small')!.textContent = t('bankToday');
    const daily = this.bank.daily;
    this.tag.querySelector('.c strong')!.textContent = daily ? `${fmtCompact(daily.tokens)} ${t('earnTokens')}` : '—';
    this.tag.querySelector('.p strong')!.textContent = daily ? `${fmtAic(daily.nanoAic)} AIC` : '—';
    const paid = daily ? t('bankDailyShort', { aic: fmtAic(daily.nanoAic), tokens: fmtCompact(daily.tokens) }) : '—';
    this.tag.title = this.chip.title = t('bankOpen');
    this.chip.innerHTML = `<span class="coin" aria-hidden="true"></span><span>${esc(paid)}</span>`;
    if (this.isOpen) this.render(true);
  }

  /** Keeps the label over the building. Called every frame. */
  place(rig: CameraRig, x: number, y: number, z: number): void {
    const p = rig.toScreen(x, y, z);
    const vis = p.visible && p.x > -80 && p.x < rig.width + 80 && p.y > -60 && p.y < rig.height + 60;
    this.tag.classList.toggle('off', !vis);
    if (vis) placeScreenLabel(this.tag, p.x, p.y);
  }

  show(): void {
    this.isOpen = true;
    this.card.hidden = false;
    document.body.classList.add('panel-open');
    this.render(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.card.hidden = true;
    if (!this.app.selected) document.body.classList.remove('panel-open');
  }

  /** Re-renders the card when something it shows changed. */
  render(force = false): void {
    if (!this.isOpen) return;
    const robots = this.app.village.list().filter(r => !r.leaving);
    const costs = robots.map(r => r.session.costUsd).filter((v): v is number => typeof v === 'number');
    const cost = costs.reduce((a, b) => a + b, 0);
    const demo = this.app.source.kind === 'demo';
    const sig = JSON.stringify([this.bank, costs.length, cost.toFixed(2), demo, t('bankName')]);
    if (!force && sig === this.sig) return;
    this.sig = sig;
    $('#bankTitle').textContent = t('bankName');
    $('#bankSubtitle').textContent = t('bankSub');

    const bar = (pct: number | undefined, cls: string) =>
      `<div class="vbar ${cls}${pct === undefined ? ' unknown' : ''}"><i style="width:${pct ?? 0}%"></i></div>`;
    const row = (label: string, usedPct: number, resetsAt?: number) => {
      const l = left(usedPct);
      return `<div class="vrow"><div class="vlab"><span>${esc(label)}</span><b>${esc(t('bankLeft', { pct: l }))}</b></div>${bar(l, 'claude')}`
        + (resetsAt ? `<p class="vnote">${esc(t('bankResets', { when: fmtWhen(resetsAt) }))}</p>` : '') + '</div>';
    };

    const c = this.bank.claude;
    let claude = `<section class="vault"><h3><i class="vdot claude"></i>Claude</h3>`;
    if (c && (c.fiveHour || c.sevenDay || c.spend)) {
      if (c.fiveHour) claude += row(t('bank5h'), c.fiveHour.usedPct, c.fiveHour.resetsAt);
      if (c.sevenDay) claude += row(t('bank7d'), c.sevenDay.usedPct, c.sevenDay.resetsAt);
      if (c.spend) {
        claude += row(t('bankSpend'), c.spend.usedPct, c.spend.resetsAt);
        if (c.spend.usedUsd !== undefined && c.spend.limitUsd !== undefined) claude += `<p class="vnote">${esc(fmtUsd(c.spend.usedUsd))} / ${esc(fmtUsd(c.spend.limitUsd))}</p>`;
      }
    } else {
      claude += bar(undefined, 'claude') + `<p class="vnote">${esc(t('bankClaudeNone'))}</p>`;
    }
    claude += '</section>';

    const p = this.bank.copilot;
    let copilot = `<section class="vault"><h3><i class="vdot copilot"></i>Copilot</h3>`;
    if (p && p.updatedAt > 0) {
      const usedPct = p.allowance ? (p.used / p.allowance) * 100 : undefined;
      if (usedPct !== undefined) copilot += `<div class="vrow"><div class="vlab"><span>${esc(`${Math.round(p.used)}/${p.allowance}`)}</span><b>${esc(t('bankLeft', { pct: left(usedPct) }))}</b></div>${bar(left(usedPct), 'copilot')}</div>`;
      copilot += `<p class="vnote">${esc(t(p.allowance ? 'bankCopilotReq' : 'bankCopilotUsed', { used: Math.round(p.used), allowance: p.allowance, month: p.month }))}</p>`;
    } else if (!p) {
      copilot += bar(undefined, 'copilot') + `<p class="vnote">${esc(t('bankCopilotNone'))}</p>`;
    } else {
      copilot += bar(undefined, 'copilot');
    }
    if (p?.error) copilot += `<p class="verr">${esc(t('bankCopilotErr', { msg: p.error }))}</p>`;
    copilot += '</section>';

    const costHtml = costs.length
      ? `<section><h3>${esc(t('bankCost'))}</h3><p class="vbig">≈ ${esc(fmtUsd(cost))}</p><p class="vnote">${esc(t('bankCostNote'))}</p></section>`
      : '';
    const daily = this.bank.daily;
    const payouts = `<section class="daily-payout"><h3>${esc(t('bankDaily'))}</h3>`
      + (daily ? `<p class="vnote">${esc(daily.day)}</p><div class="vrow"><span>Copilot</span><b class="vbig">${esc(fmtAic(daily.nanoAic))} AIC</b></div>`
        + `<div class="vrow"><span>Claude</span><b class="vbig" title="${esc(fmtNumber(daily.tokens))}">${esc(fmtCompact(daily.tokens))} ${esc(t('earnTokens'))}</b></div>`
        : `<p class="vnote">${esc(t('bankDailyMissing'))}</p>`)
      + `<p class="hint">${esc(t('bankDailyNote'))}</p></section>`;
    $('#bankBody').innerHTML = payouts + claude + copilot + costHtml + `<p class="hint">${esc(t(demo ? 'bankDemo' : 'bankSource'))}</p>`;
  }
}
