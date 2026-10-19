/** Name tags, "!" / "?" bubbles and speech pops that float above robots (plain DOM over the canvas). */
import type { PopKind, Robot } from '../agents/robot';
import { $ } from '../lib/util';
import type { CameraRig } from '../world/camera';
import { t } from './i18n';

interface Tag { el: HTMLDivElement; bubble: HTMLButtonElement; name: HTMLSpanElement }

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
      if (vis) tag.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) translate(-50%,-100%)`;
    }
  }

  pop(r: Robot, key: string, kind: PopKind, rig: CameraRig): void {
    const el = document.createElement('div');
    el.className = 'pop ' + kind;
    el.textContent = t(key);
    const p = rig.toScreen(r.x, 2.3, r.z);
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1650);
  }

  clear(): void {
    for (const tag of this.tags.values()) tag.el.remove();
    this.tags.clear();
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
    const name = document.createElement('span');
    nameBtn.append(dot, name);
    el.append(bubble, nameBtn);
    const pickIt = () => this.onPick(r.id);
    bubble.addEventListener('click', pickIt);
    nameBtn.addEventListener('click', pickIt);
    this.root.appendChild(el);
    const tag = { el, bubble, name };
    this.tags.set(r.id, tag);
    return tag;
  }
}
