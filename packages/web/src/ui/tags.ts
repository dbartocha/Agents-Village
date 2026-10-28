/** Name tags, "!" / "?" bubbles and speech pops that float above robots (plain DOM over the canvas). */
import { AGENT_LABELS, modelLabel } from '../../../shared/src/index.ts';
import type { PopKind, Robot } from '../agents/robot';
import { $, placeScreenLabel } from '../lib/util';
import type { CameraRig } from '../world/camera';
import { fmtAic, fmtCompact, t } from './i18n';

interface Tag { el: HTMLDivElement; bubble: HTMLButtonElement; name: HTMLSpanElement; model: HTMLSpanElement; earnings: HTMLSpanElement }

export class Tags {
  private readonly root = $('#tags');
  private readonly tags = new Map<string, Tag>();

  private readonly onPick: (id: string) => void;

  constructor(onPick: (id: string) => void) { this.onPick = onPick; }

  /** Creates and removes tags so there is one per robot, and updates bubbles. */
  sync(robots: Robot[], selectedId: string | null): void {
    const ids = new Set(robots.map(r => r.id));
    for (const [id, tag] of this.tags) if (!ids.has(id)) { tag.el.remove(); this.tags.delete(id); }
    for (const r of robots) {
      let tag = this.tags.get(r.id);
      if (!tag) tag = this.create(r);
      tag.name.textContent = r.name;
      const earned = r.session.earnings;
      tag.earnings.hidden = !earned;
        if (earned) {
          const amount = earned.unit === 'nanoAic' ? fmtAic(earned.total) : fmtCompact(earned.total);
          tag.earnings.querySelector('strong')!.textContent = amount;
          tag.earnings.querySelector('.unit')!.textContent = earned.unit === 'nanoAic' ? 'AIC' : t('earnTokens');
          tag.earnings.title = t(earned.unit === 'nanoAic' ? 'earnAicLabel' : 'earnTokenLabel', { n: amount });
          tag.earnings.querySelector('.sr')!.textContent = t('hEarned') + ': ';
        }
      // "Atlas · Opus": the model once the status line or the transcript told us.
      const model = modelLabel(r.session);
      const modelText = model ? ' · ' + model : '';
      if (tag.model.textContent !== modelText) tag.model.textContent = modelText;
      tag.el.classList.toggle('sel', r.id === selectedId);
      const st = r.session.status;
      const on = (st === 'waiting' || st === 'asking') && !r.leaving;
      tag.bubble.hidden = !on;
      if (on) {
        const ask = st === 'asking';
        tag.bubble.textContent = ask ? '?' : '!';
        tag.bubble.classList.toggle('ask', ask);
        tag.bubble.setAttribute('aria-label', t(ask ? 'bubAsk' : 'bubWait', { name: r.name }));
      }
    }
  }

  /** Moves tags to follow their robots on screen. Called every frame. */
  place(robots: Robot[], rig: CameraRig): void {
    for (const r of robots) {
      const tag = this.tags.get(r.id);
      if (!tag) continue;
      const p = rig.toScreen(r.x, 1.9 * Math.max(0.3, r.scale), r.z);
      const vis = p.visible && r.scale > 0.3 && p.x > -40 && p.x < rig.width + 40 && p.y > -60 && p.y < rig.height + 60;
      tag.el.classList.toggle('off', !vis);
      if (vis) placeScreenLabel(tag.el, p.x, p.y);
    }
  }

  pop(r: Robot, key: string, kind: PopKind, rig: CameraRig): void {
    this.popText(r, t(key), kind, rig);
  }

  /** A pop with ready text (earned tokens: "+18K"). */
  popText(r: Robot, text: string, kind: PopKind | 'coin', rig: CameraRig): void {
    const el = document.createElement('div');
    el.className = 'pop ' + kind;
    if (kind === 'coin') {
      const coin = document.createElement('i');
      coin.className = 'coin-token';
      coin.setAttribute('aria-hidden', 'true');
      el.append(coin);
      const badge = this.tags.get(r.id)?.earnings;
      if (badge) {
        badge.classList.remove('received');
        void badge.offsetWidth;
        badge.classList.add('received');
      }
    }
    el.append(document.createTextNode(text));
    const p = rig.toScreen(r.x, 2.3, r.z);
    const label = kind === 'coin' ? this.tags.get(r.id)?.el.getBoundingClientRect() : undefined;
    el.style.left = p.x + 'px';
    el.style.top = (label?.height ? label.top - 14 : p.y) + 'px';
    this.root.appendChild(el);
    setTimeout(() => el.remove(), kind === 'coin' ? 2450 : 1650);
  }

  clear(): void {
    for (const tag of this.tags.values()) tag.el.remove();
    this.tags.clear();
    for (const pop of this.root.querySelectorAll('.pop')) pop.remove();
  }

  private create(r: Robot): Tag {
    const el = document.createElement('div');
    el.className = 'tag';
    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'bubble';
    bubble.hidden = true;
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'name';
    const dot = document.createElement('i');
    dot.style.background = r.color;
    nameBtn.title = AGENT_LABELS[r.session.provider ?? 'claude'];
    const name = document.createElement('span');
    const model = document.createElement('span');
    model.className = 'mdl';
    nameBtn.append(dot, name, model);
    if ((r.session.provider ?? 'claude') === 'copilot') {
      const mark = document.createElement('span');
      mark.className = 'mark copilot';
      mark.textContent = t('copilotMark');
      nameBtn.append(mark);
    }
    const earnings = document.createElement('span');
    earnings.className = 'earnings';
    earnings.innerHTML = '<i class="coin-token" aria-hidden="true"></i><span class="sr"></span><strong></strong><span class="unit"></span>';
    earnings.hidden = true;
    el.append(bubble, nameBtn, earnings);
    const pickIt = () => this.onPick(r.id);
    bubble.addEventListener('click', pickIt);
    nameBtn.addEventListener('click', pickIt);
    this.root.appendChild(el);
    const tag = { el, bubble, name, model, earnings };
    this.tags.set(r.id, tag);
    return tag;
  }
}
