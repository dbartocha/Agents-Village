/** Top and bottom bars: counters, the waiting queue, live/demo switch, legend, feed, camera buttons. */
import type { FeedItem } from '../agents/controller';
import type { SourceState } from '../agents/source';
import { $, esc } from '../lib/util';
import type { App } from './app';
import { L, lang, setLang, t } from './i18n';
import { feedText } from './format';

export class Hud {
  private feedItems: FeedItem[] = [];
  private readonly feedEl = $('#feed');
  private readonly queueEl = $('#queue');

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
    this.queueEl.innerHTML = '';
    for (const r of robots) {
      const st = r.session.status;
      if (st === 'waiting' || st === 'asking') {
        wait++;
        const ask = st === 'asking';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'qchip' + (ask ? ' ask' : '');
        const what = ask ? t('qAsk') : L(r.session.pending?.target ?? r.session.attentionText ?? '');
        b.innerHTML = `<span class="g">${ask ? '?' : '!'}</span><b>${esc(r.name)}</b><span>${esc(what)}</span>`;
        b.addEventListener('click', () => this.app.select(r, true));
        this.queueEl.appendChild(b);
      } else if (st === 'idle') rest++;
      else work++;
    }
    $('#sWork').textContent = String(work);
    $('#sWait').textContent = String(wait);
    $('#sDone').textContent = String(rest);
    $('#sWaitBtn').classList.toggle('on', wait > 0);
    const s = this.app.state;
    $('#empty').hidden = !(this.app.source.kind === 'live' && s === 'live' && robots.length === 0);
    this.measureTop();
  }

  setFeed(items: FeedItem[]): void {
    this.feedItems = items;
    this.renderFeed();
  }

  renderFeed(): void {
    this.feedEl.innerHTML = '';
    for (const it of this.feedItems) {
      const li = document.createElement('li');
      if (it.fresh) { li.className = 'fresh'; it.fresh = false; }
      const r = it.kind === 'activity' ? this.app.village.get(it.robotId) : undefined;
      const color = r ? r.color : 'var(--edge-dark)';
      const who = it.kind === 'activity' ? (r?.name ?? '') : t('sysName');
      const what = it.kind === 'activity' ? feedText(it.a, r?.f ?? false) : t(it.key);
      li.innerHTML = `<button type="button"><i style="background:${esc(color)}"></i><span class="who">${esc(who)}</span><span class="what">${esc(what)}</span></button>`;
      if (r) li.querySelector('button')!.addEventListener('click', () => this.app.select(r, true));
      this.feedEl.appendChild(li);
    }
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
