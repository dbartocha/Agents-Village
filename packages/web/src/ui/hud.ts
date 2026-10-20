/** Top and bottom bars: counters, the waiting queue, live/demo switch, legend, feed, camera buttons. */
import type { FeedItem } from '../agents/controller';
import type { Robot } from '../agents/robot';
import type { SourceState } from '../agents/source';
import { $ } from '../lib/util';
import type { App } from './app';
import { L, lang, setLang, t } from './i18n';
import { feedText, shortTarget } from './format';

/** Sets text only when it changed, so elements under the mouse stay untouched. */
function setText(el: HTMLElement, text: string): void { if (el.textContent !== text) el.textContent = text; }

export class Hud {
  private feedItems: FeedItem[] = [];
  private readonly feedEl = $('#feed');
  private readonly queueEl = $('#queue');
  /** Elements are kept per feed item and per waiting robot and updated in place: re-creating them on every event would swallow clicks. */
  private readonly feedLis = new Map<FeedItem, HTMLLIElement>();
  private readonly chips = new Map<string, HTMLButtonElement>();

  private readonly app: App;

  constructor(app: App) {
    this.app = app;
    document.querySelectorAll<HTMLButtonElement>('.lang button').forEach(b => {
      b.addEventListener('click', () => setLang(b.dataset.lang === 'pl' ? 'pl' : 'en'));
    });
    document.querySelectorAll<HTMLButtonElement>('#mode button').forEach(b => {
      b.addEventListener('click', () => app.switchTo(b.dataset.mode === 'demo' ? 'demo' : 'live'));
    });
    $('#emptyDemo').addEventListener('click', () => app.switchTo('demo'));
    $('#sWaitBtn').addEventListener('click', () => {
      const r = app.village.list().find(x => x.session.status === 'waiting' || x.session.status === 'asking');
      if (r) app.select(r, true);
    });
    const rig = app.rig;
    $('#rotL').addEventListener('click', () => rig.rotate(-1));
    $('#rotR').addEventListener('click', () => rig.rotate(1));
    $('#zoomIn').addEventListener('click', () => rig.zoomBy(1.25));
    $('#zoomOut').addEventListener('click', () => rig.zoomBy(1 / 1.25));
    $('#recenter').addEventListener('click', () => { rig.home(); app.setFollow(false); });
    if (window.innerWidth <= 720 || window.innerHeight < 760) ($('#legend') as HTMLDetailsElement).open = false;
  }

  /** Counters, queue chips and the empty state. Called when robots change. */
  render(): void {
    const robots = this.app.village.list().filter(r => !r.leaving);
    let work = 0, wait = 0, rest = 0;
    const waiting: Robot[] = [];
    for (const r of robots) {
      const st = r.session.status;
      if (st === 'waiting' || st === 'asking') { wait++; waiting.push(r); }
      else if (st === 'idle') rest++;
      else work++;
    }
    this.renderChips(waiting);
    setText($('#sWork'), String(work));
    setText($('#sWait'), String(wait));
    setText($('#sDone'), String(rest));
    $('#sWaitBtn').classList.toggle('on', wait > 0);
    const s = this.app.state;
    $('#empty').hidden = !(this.app.source.kind === 'live' && s === 'live' && robots.length === 0);
    this.measureTop();
  }

  private renderChips(waiting: Robot[]): void {
    const ids = new Set(waiting.map(r => r.id));
    for (const [id, chip] of this.chips) if (!ids.has(id)) { chip.remove(); this.chips.delete(id); }
    waiting.forEach((r, i) => {
      let chip = this.chips.get(r.id);
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.innerHTML = '<span class="g"></span><b></b><span class="q"></span>';
        const id = r.id;
        chip.addEventListener('click', () => { const robot = this.app.village.get(id); if (robot) this.app.select(robot, true); });
        this.chips.set(r.id, chip);
      }
      const ask = r.session.status === 'asking';
      const p = r.session.pending;
      const full = ask ? L(r.session.attentionText) || t('qAsk') : L(p?.target ?? r.session.attentionText ?? '');
      chip.className = 'qchip' + (ask ? ' ask' : '');
      chip.title = full;
      setText(chip.querySelector<HTMLElement>('.g')!, ask ? '?' : '!');
      setText(chip.querySelector<HTMLElement>('b')!, r.name);
      setText(chip.querySelector<HTMLElement>('.q')!, ask ? t('qAsk') : shortTarget(p?.tool, full, 30));
      if (this.queueEl.children[i] !== chip) this.queueEl.insertBefore(chip, this.queueEl.children[i] ?? null);
    });
  }

  setFeed(items: FeedItem[]): void {
    this.feedItems = items;
    this.renderFeed();
  }

  /** Short one-line entries; the full text is in the tooltip and a click opens the robot's panel. */
  renderFeed(): void {
    const keep = new Set(this.feedItems);
    for (const [it, li] of this.feedLis) if (!keep.has(it)) { li.remove(); this.feedLis.delete(it); }
    let next: HTMLLIElement | null = null;
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const it = this.feedItems[i];
      let li = this.feedLis.get(it);
      if (!li) {
        li = this.createFeedLine(it);
        this.feedLis.set(it, li);
        this.feedEl.insertBefore(li, next);
      }
      this.fillFeedLine(li, it);
      next = li;
    }
  }

  private createFeedLine(it: FeedItem): HTMLLIElement {
    const li = document.createElement('li');
    if (it.fresh) { li.className = 'fresh'; it.fresh = false; }
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<i></i><span class="who"></span><span class="what"></span>';
    if (it.kind === 'activity') {
      const id = it.robotId;
      b.addEventListener('click', () => { const r = this.app.village.get(id); if (r) this.app.select(r, true); });
    } else {
      b.classList.add('sys');
      b.tabIndex = -1;
    }
    li.appendChild(b);
    return li;
  }

  private fillFeedLine(li: HTMLLIElement, it: FeedItem): void {
    const b = li.firstElementChild as HTMLButtonElement;
    const r = it.kind === 'activity' ? this.app.village.get(it.robotId) : undefined;
    const color = r ? r.color : 'var(--muted)';
    const dot = b.querySelector<HTMLElement>('i')!;
    if (dot.style.background !== color) dot.style.background = color;
    setText(b.querySelector<HTMLElement>('.who')!, it.kind === 'activity' ? (r?.name ?? '') : t('sysName'));
    const short = it.kind === 'activity' ? feedText(it.a, r?.f ?? false) : t(it.key);
    const full = it.kind === 'activity' ? feedText(it.a, r?.f ?? false, false) : short;
    setText(b.querySelector<HTMLElement>('.what')!, short);
    const title = (r ? r.name + ' ' : '') + full;
    if (b.title !== title) b.title = title;
  }

  /** Live/demo switch, connection dot and the legend note. */
  setMode(kind: 'live' | 'demo', state: SourceState): void {
    document.querySelectorAll<HTMLButtonElement>('#mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === kind)));
    const dot = $('#connDot');
    const conn = kind === 'demo' ? (state === 'demo' ? '' : state) : state;
    dot.className = 'dot conn ' + conn;
    const title = state === 'live' ? t('modeLive') : state === 'offline' ? t('modeOffline') : state === 'demo' ? t('modeDemo') : t('modeReconnect');
    dot.parentElement!.title = kind === 'live' ? title : t('toLive');
    $('#legendNote').textContent = t(kind === 'live' ? 'lgNoteLive' : 'lgNoteDemo');
  }

  /** After a language change. */
  relabel(): void {
    document.querySelectorAll<HTMLButtonElement>('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    this.renderFeed();
    this.render();
  }

  measureTop(): void {
    const r = $('#top').getBoundingClientRect();
    document.documentElement.style.setProperty('--hud-top', Math.round(r.bottom + 10) + 'px');
  }
}
