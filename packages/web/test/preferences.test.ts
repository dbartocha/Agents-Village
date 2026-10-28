import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { initTheme } from '../src/ui/theme.ts';

function globals(t: TestContext, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

let imports = 0;
function i18n(): Promise<typeof import('../src/ui/i18n.ts')> {
  return import(new URL('../src/ui/i18n.ts', import.meta.url).href + '?test=' + imports++);
}

test('Hungarian browser language, saved preference and unsupported language fallback', async t => {
  let saved: string | null = null;
  const navigator = { language: 'hu-HU' };
  globals(t, { navigator, localStorage: { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; } } });
  const hu = await i18n();
  assert.equal(hu.lang, 'hu');
  hu.setLang('pl');
  assert.equal(saved, 'pl');
  assert.equal((await i18n()).lang, 'pl');
  saved = 'invalid';
  assert.equal((await i18n()).lang, 'hu');
  navigator.language = 'de-DE';
  assert.equal((await i18n()).lang, 'en');
});

test('translated demo text follows switches, keeps placeholders and supports older payloads', async t => {
  globals(t, { navigator: { language: 'hu' }, localStorage: { getItem: () => null, setItem() {} } });
  const i = await i18n();
  const task = { pl: 'zadanie', en: 'task', hu: 'feladat' };
  const message = i.tBoth('demoDone', { task });
  assert.equal(i.L(message), 'Elkészült: feladat');
  assert.equal(i.L({ pl: 'starszy tekst', en: 'older text' }), 'older text');
  assert.equal(i.L('Live prompt stays unchanged'), 'Live prompt stays unchanged');
  assert.match(i.t('homeConfirm', { name: 'Atlas' }), /Atlas/);
  assert.equal(i.fmtAic(1555360500000), new Intl.NumberFormat('hu-HU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1555.3605));
  assert.equal(i.fmtNumber(18400), new Intl.NumberFormat('hu-HU').format(18400));
  assert.equal(i.fmtUsd(3.4), new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'USD' }).format(3.4));
  assert.equal(i.fmtDuration(3661000), '1 ó 1 p 1 mp');
  i.setLang('en');
  assert.equal(i.L(message), 'Done: task');
  i.setLang('pl');
  assert.equal(i.L(message), 'Zrobione: zadanie');
  assert.equal(i.t('a_stop', undefined, true), 'skończyła turę');
  assert.equal(i.t('a_stop', undefined, false), 'skończył turę');
});

test('theme override is applied, persisted and removed when returning to system', t => {
  const data: Record<string, string> = {};
  const dataset: Record<string, string> = {};
  globals(t, {
    localStorage: { getItem: (key: string) => data[key], setItem: (key: string, value: string) => { data[key] = value; } },
    document: { documentElement: { dataset, removeAttribute: (name: string) => { if (name === 'data-theme') delete dataset.theme; } } },
  });
  class Select extends EventTarget { value = ''; }
  const select = new Select();
  initTheme(select as HTMLSelectElement);
  assert.equal(select.value, 'system');
  assert.equal(dataset.theme, undefined);
  for (const theme of ['dark', 'light', 'system']) {
    select.value = theme;
    select.dispatchEvent(new Event('change'));
    assert.equal(dataset.theme, theme === 'system' ? undefined : theme);
    assert.equal(data['agent-village-theme'], theme);
    const reloaded = new Select();
    initTheme(reloaded as HTMLSelectElement);
    assert.equal(reloaded.value, theme);
  }
});

test('blocked storage does not prevent changing language or theme', async t => {
  const dataset: Record<string, string> = {};
  globals(t, {
    navigator: { language: 'hu-HU' },
    localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    document: { documentElement: { dataset, removeAttribute() {} } },
  });
  const warning = t.mock.method(console, 'warn', () => {});
  const i = await i18n();
  assert.equal(i.lang, 'hu');
  i.setLang('en');
  assert.equal(i.lang, 'en');
  const select = Object.assign(new EventTarget(), { value: '' });
  initTheme(select as HTMLSelectElement);
  select.value = 'dark';
  select.dispatchEvent(new Event('change'));
  assert.equal(dataset.theme, 'dark');
  assert.equal(warning.mock.callCount(), 1);
});
