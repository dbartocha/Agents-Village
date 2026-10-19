/** The robot panel: task, current step, request (approve / answer), last reply, recent steps, actions. */
import type { Activity, Decision, Text } from '../../../shared/src/index.ts';
import type { Robot } from '../agents/robot';
import { $, esc, pick } from '../lib/util';
import type { App } from './app';
import { L, lang, t } from './i18n';
import { logLine, metaLine, nowHTML, statusOf } from './format';

const LOG_SHOWN = 40;

export class Panel {
  private readonly el = $('#panel');
  private readonly action = $('#pAction');
  private readonly logEl = $('#pLog');
  private robot: Robot | null = null;
  private actionSig = '';
  private logSig = '';

  private readonly app: App;

  constructor(app: App) {
    this.app = app;
    $('#pClose').addEventListener('click', () => app.select(null));
    $('#pFollow').addEventListener('click', () => app.setFollow(!app.following));
    $('#pStop').addEventListener('click', () => { if (this.robot) app.source.demo?.halt(this.robot.id); });
    $('#msgForm').addEventListener('submit', e => {
      e.preventDefault();
      const input = $<HTMLInputElement>('#msgInput');
      if (this.robot && input.value.trim()) app.source.demo?.message(this.robot.id, input.value);
      input.value = '';
    });
    this.action.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
      const r = this.robot;
      if (!b || !r) return;
      const act = b.dataset.act;
      if (act === 'allow' || act === 'deny') this.decide(r, act);
      else if (act === 'answer') {
        const opt = this.questionOptions(r)[Number(b.dataset.i)];
        if (opt !== undefined) app.source.demo?.answer(r.id, opt);
      }
    });
    this.action.addEventListener('submit', e => {
      e.preventDefault();
      const r = this.robot;
      if (!r) return;
      const form = e.target as HTMLFormElement;
      if (form.id === 'answerForm') app.source.demo?.answer(r.id, $<HTMLInputElement>('#answerInput').value);
      if (form.id === 'taskForm') app.source.demo?.giveTask(r.id, $<HTMLTextAreaElement>('#newTaskInput').value);
    });
  }

  get current(): Robot | null { return this.robot; }

  open(r: Robot | null): void {
    this.robot = r;
    this.actionSig = '';
    this.logSig = '';
    if (!r) {
      this.el.hidden = true;
      document.body.classList.remove('panel-open');
      return;
    }
    this.el.hidden = false;
    document.body.classList.add('panel-open');
    $('#pAvatar').style.setProperty('--av-color', r.color);
    this.render(true);
    $('#pBody').scrollTop = 0;
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Re-renders what changed. `full` also rebuilds the request box and log (language switch, new robot). */
  render(full = false): void {
    const r = this.robot;
    if (!r) return;
    if (full) { this.actionSig = ''; this.logSig = ''; }
    const s = r.session;
    $('#pName').textContent = r.name;
    $('#pMeta').textContent = metaLine(r);
    $('#pMeta').title = s.cwd;
    const st = statusOf(r);
    const pill = $('#pStatus');
    pill.textContent = st.text;
    pill.className = 'pill ' + st.cls;
    $('#pTask').textContent = r.task ? L(r.task) : t('noTask');
    $('#pNow').innerHTML = nowHTML(r);
    const busy = (s.status === 'working' || s.status === 'thinking') && !r.leaving;
    const prog = $('#pProgWrap');
    prog.hidden = !busy;
    prog.classList.toggle('busy', busy);
    const last = s.status === 'idle' || s.status === 'ended' ? s.lastMessage : undefined;
    $('#pLastWrap').hidden = !last;
    $('#pLast').textContent = last ? L(last) : '';
    const demo = !!this.app.source.demo;
    $('#msgForm').hidden = !demo;
    $('#pStop').hidden = !demo;
    $<HTMLButtonElement>('#pStop').disabled = s.status === 'idle' || r.leaving;
    $('#pFollow').textContent = t(this.app.following ? 'unfollow' : 'follow');
    this.renderAction(r);
    this.renderLog(r);
    this.tick();
  }

  /** Updates countdowns. Called a few times per second. */
  tick(): void {
    const exp = this.action.querySelector<HTMLElement>('.expires');
    if (!exp) return;
    const left = Math.ceil((Number(exp.dataset.exp) - Date.now()) / 1000);
    exp.hidden = left <= 0;
    if (left > 0) exp.textContent = t('reqExpires', { s: left });
  }

  private renderAction(r: Robot): void {
    const s = r.session;
    const demo = !!this.app.source.demo;
    const sig = [s.status, s.pending?.id, s.pending?.approvable, L(s.attentionText), demo, lang, r.leaving].join('|');
    if (sig === this.actionSig) return;
    this.actionSig = sig;
    const box = this.action;
    let html = '';
    if (r.leaving || s.status === 'ended') html = '';
    else if (s.status === 'waiting') {
      const p = s.pending;
      html = `<div class="req"><h3><span class="g">!</span>${esc(t('reqPerm'))}</h3>`;
      if (p) {
        html += `<p>${esc(p.title ? L(p.title) : t('reqToolTitle', { tool: p.tool || '?' }))}</p>`;
        if (L(p.target)) html += `<code>${esc(L(p.target))}</code>`;
        if (p.why) html += `<p class="why">${esc(L(p.why))}</p>`;
      } else if (s.attentionText) {
        html += `<p>${esc(L(s.attentionText))}</p>`;
      }
      if (p?.approvable) {
        html += `<div class="row"><button class="btn ok" type="button" data-act="allow">${esc(t('allow'))}</button><button class="btn danger" type="button" data-act="deny">${esc(t('deny'))}</button></div>`;
        if (p.expiresAt) html += `<p class="expires" data-exp="${p.expiresAt}"></p>`;
        html += '<p class="err" hidden></p>';
      } else {
        html += `<p class="hint">${esc(t('reqTerminal'))}</p>`;
        if (!demo && !this.app.village.approvals) html += `<p class="hint">${esc(t('reqTerminalHint'))}</p>`;
      }
      html += '</div>';
    } else if (s.status === 'asking') {
      html = `<div class="req ask"><h3><span class="g">?</span>${esc(t('reqAsk'))}</h3>`;
      if (s.attentionText) html += `<p>${esc(L(s.attentionText))}</p>`;
      const opts = this.questionOptions(r);
      if (demo) {
        if (opts.length) html += '<div class="row">' + opts.map((o, i) => `<button class="btn small" type="button" data-act="answer" data-i="${i}">${esc(L(o))}</button>`).join('') + '</div>';
        html += `<form class="inline-form" id="answerForm"><label for="answerInput" class="sr">${esc(t('answerLabel'))}</label><input type="text" id="answerInput" placeholder="${esc(t('answerPh'))}" autocomplete="off"><button class="btn" type="submit">${esc(t('answerBtn'))}</button></form>`;
      } else {
        html += `<p class="hint">${esc(t('askTerminal'))}</p>`;
      }
      html += '</div>';
    } else if (s.status === 'idle') {
      html = `<div class="req done"><h3>${esc(t('reqDone'))}</h3>`;
      if (demo) {
        const suggestion = L(pick(this.app.source.demo!.suggestions));
        html += `<form id="taskForm" style="display:grid;gap:8px"><label for="newTaskInput" class="sr">${esc(t('newTaskLabel'))}</label><textarea id="newTaskInput" rows="2" placeholder="${esc(t('newTaskPh'))}">${esc(suggestion)}</textarea><button class="btn primary" type="submit">${esc(t('giveTask'))}</button></form>`;
      } else {
        html += `<p class="hint">${esc(t('idleTerminal'))}</p>`;
      }
      html += '</div>';
    }
    box.hidden = !html;
    box.innerHTML = html;
  }

  private renderLog(r: Robot): void {
    const lastEntry = r.log[r.log.length - 1];
    const sig = r.log.length + ':' + (lastEntry ? (lastEntry.kind === 'activity' ? lastEntry.a.seq : lastEntry.at) : '') + ':' + lang;
    if (sig === this.logSig) return;
    this.logSig = sig;
    const el = this.logEl;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    el.innerHTML = '';
    const lines: Array<{ cls: string; html: string }> = [];
    r.log.forEach((e, i) => {
      const prev = r.log[i - 1];
      const line = logLine(e, r, prev);
      if (!line) return;
      // "Bash npm test" followed by "Bash npm test · awaiting approval": keep only the second line.
      if (e.kind === 'activity' && e.a.kind === 'permission' && prev?.kind === 'activity' && prev.a.kind === 'tool'
        && prev.a.tool === e.a.tool && L(prev.a.target) === L(e.a.target)) lines.pop();
      lines.push(line);
    });
    for (const line of lines.slice(-LOG_SHOWN)) {
      const li = document.createElement('li');
      li.className = line.cls;
      li.innerHTML = line.html;
      el.appendChild(li);
    }
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  /** Answer options of the open question (demo questions carry them). */
  private questionOptions(r: Robot): Text[] {
    for (let i = r.log.length - 1; i >= 0; i--) {
      const e = r.log[i];
      if (e.kind === 'activity' && e.a.kind === 'attention' && e.a.attention === 'question') return (e.a as Activity).options ?? [];
    }
    return [];
  }

  private decide(r: Robot, decision: Decision): void {
    const p = r.session.pending;
    if (!p) return;
    const buttons = this.action.querySelectorAll<HTMLButtonElement>('[data-act="allow"],[data-act="deny"]');
    buttons.forEach(b => { b.disabled = true; });
    this.app.source.decide(r.id, p.id, decision).catch((err: unknown) => {
      buttons.forEach(b => { b.disabled = false; });
      const box = this.action.querySelector<HTMLElement>('.err');
      if (box) {
        box.hidden = false;
        box.textContent = t('errDecision', { msg: err instanceof Error ? err.message : String(err) });
      }
    });
  }
}
