/**
 * "+ New robot". In the demo it sends a new simulated agent out of the factory.
 * Live, it explains how to start a Claude Code session (launching from the town is stage 3).
 */
import { $, pick } from '../lib/util';
import type { App } from './app';
import { ROBOT_NAMES } from '../../../shared/src/index.ts';
import { L, t } from './i18n';

export class NewRobotDialog {
  private readonly dlg = $('#newDlg');

  private readonly app: App;
  private readonly onFull: () => void;

  constructor(app: App, onFull: () => void) {
    this.app = app;
    this.onFull = onFull;
    $('#newBtn').addEventListener('click', () => this.open());
    $('#newCancel').addEventListener('click', () => this.close());
    this.dlg.addEventListener('click', e => { if (e.target === this.dlg) this.close(); });
    $('#newForm').addEventListener('submit', e => {
      e.preventDefault();
      this.submit();
    });
  }

  get isOpen(): boolean { return !this.dlg.hidden; }

  open(): void {
    const demo = this.app.source.demo;
    $('#dlgDemo').hidden = !demo;
    $('#dlgLive').hidden = !!demo;
    $('#newSubmit').dataset.i18n = demo ? 'launch' : 'ok';
    $('#newCancel').hidden = !demo;
    if (demo) {
      const n = demo.freeName();
      const name = $<HTMLInputElement>('#newName');
      name.value = n.name;
      name.dataset.f = n.f ? '1' : '';
      $<HTMLTextAreaElement>('#newTask').value = L(pick(demo.suggestions));
      this.renderSuggestions();
    }
    this.relabel();
    this.dlg.hidden = false;
    setTimeout(() => (demo ? $('#newTask') : $('#newSubmit')).focus(), 30);
  }

  close(): void { this.dlg.hidden = true; }

  /** Refreshes texts that depend on the language. */
  relabel(): void {
    const submit = $('#newSubmit');
    submit.textContent = t(submit.dataset.i18n ?? 'launch');
    if (this.isOpen && this.app.source.demo) this.renderSuggestions();
  }

  private renderSuggestions(): void {
    const demo = this.app.source.demo;
    const box = $('#suggest');
    box.innerHTML = '';
    if (!demo) return;
    for (const s of demo.suggestions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = L(s);
      b.addEventListener('click', () => { $<HTMLTextAreaElement>('#newTask').value = L(s); });
      box.appendChild(b);
    }
  }

  private submit(): void {
    const demo = this.app.source.demo;
    this.close();
    if (!demo) return;
    const nameInput = $<HTMLInputElement>('#newName');
    const name = nameInput.value.trim() || demo.freeName().name;
    const task = $<HTMLTextAreaElement>('#newTask').value.trim() || L(pick(demo.suggestions));
    const known = ROBOT_NAMES.find(n => n.name.toLowerCase() === name.toLowerCase());
    const f = known ? known.f : nameInput.dataset.f === '1';
    const id = demo.spawn(name, f, task);
    if (!id) { this.onFull(); return; }
    // Select the newcomer once its robot exists (the source emits synchronously).
    const r = this.app.village.get(id);
    if (r) this.app.select(r, true);
  }
}
