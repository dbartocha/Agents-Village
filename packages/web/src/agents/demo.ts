/**
 * Demo source: six simulated agents (the scenes from the prototype) that produce the same
 * activities as real Claude Code sessions. Used when no server is running, or on request.
 */
import { PROTOCOL_VERSION, ROBOT_NAMES, advanceTiming, localDay, newSessionTiming, stationForTool, totalTokens } from '../../../shared/src/index.ts';
import type {
  Activity, ActivityKind, AgentKind, Bank, Decision, Localized, PendingPermission, SessionInfo, Snapshot, Text,
} from '../../../shared/src/index.ts';
import { pick, rint, rnd } from '../lib/util';
import { tBoth } from '../ui/i18n';
import type { DemoControls, Sink, Source } from './source';

const B = (pl: string, en: string): Localized => ({ pl, en });

interface Step {
  tool: string;
  target?: Text;
  result?: Text;
  diff?: string;
  perm?: { title: Text; why: Text };
  alt?: Step;
  ask?: { q: Text; options: Text[] };
  answer?: Text;
  granted?: boolean;
}

interface Template { name: string; f: boolean; agent?: AgentKind; model?: DemoModel; task: Localized; steps: Step[] }

/** Demo models: display name, id and a rough price per token (mostly cache reads) for the cost estimate. */
type DemoModel = 'Opus' | 'Sonnet' | 'Haiku';
const MODELS: Record<DemoModel, { id: string; usdPerToken: number }> = {
  Opus: { id: 'claude-opus-5-5', usdPerToken: 4e-6 },
  Sonnet: { id: 'claude-sonnet-5-5', usdPerToken: 2.4e-6 },
  Haiku: { id: 'claude-haiku-4-5', usdPerToken: 0.8e-6 },
};

const DUR: Record<string, number> = { Read: 4, Grep: 3.2, Glob: 3, Edit: 5.5, Write: 6.5, Bash: 5, WebSearch: 5.5, WebFetch: 4.5 };
const MAX_ROBOTS = 14;

const TEMPLATES: Template[] = [
  { name: 'Atlas', f: false, model: 'Opus', task: B('Przenieś logowanie na nowe sesje i usuń stare tokeny JWT.', 'Move login to the new sessions and remove the old JWT tokens.'), steps: [
    { tool: 'Grep', target: 'getSessionToken', result: B('14 wystąpień w 6 plikach', '14 matches in 6 files') },
    { tool: 'Read', target: 'src/auth/session.ts' },
    { tool: 'Read', target: 'src/auth/middleware.ts' },
    { tool: 'Edit', target: 'src/auth/session.ts', diff: '+38 −21' },
    { tool: 'Edit', target: 'src/auth/middleware.ts', diff: '+12 −30' },
    { tool: 'Bash', target: 'npm test -- auth', result: B('3 testy nie przechodzą', '3 tests failing') },
    { tool: 'Read', target: 'tests/auth/session.test.ts' },
    { tool: 'Edit', target: 'tests/auth/session.test.ts', diff: '+9 −4' },
    { tool: 'Bash', target: 'npm test -- auth', result: B('Wszystkie 42 testy przechodzą', 'All 42 tests passing') },
    { tool: 'Bash', target: 'git push origin feat/sessions', perm: { title: B('Chce wypchnąć zmiany na zdalne repozytorium.', 'Wants to push changes to the remote repository.'), why: B('Gałąź feat/sessions trafi na GitHuba i uruchomi CI.', 'The feat/sessions branch will go to GitHub and trigger CI.') }, result: B('Wypchnięto 3 commity', 'Pushed 3 commits') },
  ] },
  { name: 'Nova', f: true, agent: 'copilot', task: B('Napisz testy e2e dla rejestracji i resetu hasła.', 'Write e2e tests for sign-up and password reset.'), steps: [
    { tool: 'Read', target: 'playwright.config.ts' },
    { tool: 'Read', target: 'src/pages/register.tsx' },
    { tool: 'Read', target: 'src/pages/reset-password.tsx' },
    { tool: 'Write', target: 'tests/e2e/register.spec.ts', diff: '+74' },
    { tool: 'Bash', target: 'npx playwright install chromium', perm: { title: B('Chce pobrać przeglądarkę do testów.', 'Wants to download a browser for testing.'), why: B('Pobierze około 150 MB do ~/.cache/ms-playwright.', 'Downloads about 150 MB into ~/.cache/ms-playwright.') }, result: B('Zainstalowano Chromium', 'Chromium installed') },
    { tool: 'Bash', target: 'npx playwright test register', result: B('5 z 5 testów przechodzi', '5 of 5 tests passing') },
    { tool: 'Write', target: 'tests/e2e/reset-password.spec.ts', diff: '+58' },
    { tool: 'Bash', target: 'npx playwright test reset-password', result: B('4 z 4 testów przechodzi', '4 of 4 tests passing') },
  ] },
  { name: 'Bolt', f: false, model: 'Sonnet', task: B('Dodaj numer telefonu do profilu użytkownika, razem z migracją bazy.', 'Add a phone number to the user profile, including a database migration.'), steps: [
    { tool: 'Read', target: 'prisma/schema.prisma' },
    { tool: 'Edit', target: 'prisma/schema.prisma', diff: '+2' },
    { tool: 'Bash', target: 'npx prisma migrate dev --name add_phone', perm: { title: B('Chce uruchomić migrację bazy danych.', 'Wants to run a database migration.'), why: B('Zmieni schemat Twojej lokalnej bazy: tabela users dostanie kolumnę phone.', 'Changes your local database schema: the users table gets a phone column.') }, alt: { tool: 'Bash', target: 'npx prisma migrate dev --create-only', result: B('Przygotowano plik migracji bez uruchamiania', 'Migration file prepared without applying it') }, result: B('Migracja add_phone zastosowana', 'Migration add_phone applied') },
    { tool: 'Edit', target: 'src/api/users.ts', diff: '+16 −2' },
    { tool: 'Bash', target: 'npm run typecheck', result: B('Bez błędów', 'No errors') },
  ] },
  { name: 'Iris', f: true, model: 'Haiku', task: B('Uzupełnij dokumentację API dla endpointów /orders.', 'Complete the API docs for the /orders endpoints.'), steps: [
    { tool: 'Glob', target: 'src/api/orders/**/*.ts', result: B('7 plików', '7 files') },
    { tool: 'Read', target: 'src/api/orders/create.ts' },
    { tool: 'WebSearch', target: B('OpenAPI 3.1 przykłady odpowiedzi z błędami', 'OpenAPI 3.1 error response examples') },
    { tool: 'Ask', ask: { q: B('Czy w przykładach pokazywać kwoty w złotówkach, czy neutralne liczby?', 'Should the examples show amounts in PLN, or neutral numbers?'), options: [B('Kwoty w PLN', 'Amounts in PLN'), B('Neutralne liczby', 'Neutral numbers')] } },
    { tool: 'Write', target: 'docs/api/orders.md', diff: '+212' },
    { tool: 'Edit', target: 'docs/api/README.md', diff: '+3' },
  ] },
  { name: 'Pixel', f: false, agent: 'copilot', task: B('Napraw błąd #412: koszyk gubi produkty po odświeżeniu strony.', 'Fix bug #412: the cart loses items after a page refresh.'), steps: [
    { tool: 'Read', target: 'src/cart/store.ts' },
    { tool: 'Grep', target: 'localStorage', result: B('2 wystąpienia', '2 matches') },
    { tool: 'Edit', target: 'src/cart/store.ts', diff: '+11 −3' },
    { tool: 'Write', target: 'tests/cart/persist.test.ts', diff: '+40' },
    { tool: 'Bash', target: 'npx vitest run cart', result: B('8 z 8 testów przechodzi', '8 of 8 tests passing') },
  ] },
  { name: 'Luna', f: true, model: 'Sonnet', task: B('Przygotuj stronę cennika z trzema pakietami.', 'Build a pricing page with three plans.'), steps: [
    { tool: 'WebSearch', target: B('dostępny przełącznik miesięcznie / rocznie', 'accessible monthly / yearly toggle') },
    { tool: 'Read', target: 'src/components/Card.tsx' },
    { tool: 'Ask', ask: { q: B('Środkowy pakiet ma być wyróżniony jako polecany?', 'Should the middle plan be highlighted as recommended?'), options: [B('Tak, wyróżnij', 'Yes, highlight it'), B('Nie, wszystkie równo', 'No, keep them equal')] }, answer: B('Tak, wyróżnij', 'Yes, highlight it') },
    { tool: 'Write', target: 'src/pages/pricing.tsx', diff: '+128' },
    { tool: 'Edit', target: 'src/styles/pricing.css', diff: '+46' },
    { tool: 'Bash', target: 'npm run build', result: B('Build gotowy w 18 s', 'Build finished in 18 s') },
  ] },
];

const SUGGESTIONS: Localized[] = [
  B('Dodaj tryb ciemny do panelu admina.', 'Add dark mode to the admin panel.'),
  B('Zaktualizuj zależności i sprawdź, czy build przechodzi.', 'Update dependencies and check that the build passes.'),
  B('Zoptymalizuj ładowanie zdjęć na stronie produktu.', 'Optimize image loading on the product page.'),
  B('Napisz skrypt, który co noc robi kopię bazy.', 'Write a script that backs up the database every night.'),
];

/** Plausible steps for a task typed by the user. */
function genericSteps(task: string): Step[] {
  const tl = task.toLowerCase();
  let area: string;
  let perm: { cmd: string; title: Localized; why: Localized; result: Localized } | undefined;
  if (/zdję|obraz|image|photo|foto/.test(tl)) {
    area = 'src/media';
    perm = { cmd: 'npm install sharp', title: B('Chce dodać nową zależność do projektu.', 'Wants to add a new dependency to the project.'), why: B('Zmieni package.json i package-lock.json.', 'Changes package.json and package-lock.json.'), result: B('Dodano sharp', 'Added sharp') };
  } else if (/zależn|pakiet|depend|aktualiz|update|upgrade/.test(tl)) {
    area = '.';
    perm = { cmd: 'npm update', title: B('Chce zaktualizować zależności.', 'Wants to update dependencies.'), why: B('Podniesie wersje pakietów w package-lock.json.', 'Bumps package versions in package-lock.json.'), result: B('Zaktualizowano 23 pakiety', 'Updated 23 packages') };
  } else if (/baz|backup|kopi|database/.test(tl)) {
    area = 'scripts/db';
    perm = { cmd: 'chmod +x scripts/db/backup.sh', title: B('Chce nadać skryptowi prawo uruchamiania.', 'Wants to make the script executable.'), why: B('Plik backup.sh będzie można odpalić bezpośrednio, np. z crona.', 'backup.sh can then run directly, e.g. from cron.'), result: B('Gotowe', 'Done') };
  } else {
    area = /ciemn|dark|motyw|theme/.test(tl) ? 'src/admin/theme' : pick(['src/checkout', 'src/profile', 'src/search', 'src/notifications']);
  }
  const slug = area === '.' ? 'deps' : area.split('/').pop()!;
  perm ??= {
    cmd: 'git checkout -b feat/' + slug,
    title: B('Chce utworzyć nową gałąź.', 'Wants to create a new branch.'),
    why: B('Niezatwierdzone zmiany przejdą razem z nim na feat/' + slug + '.', 'Uncommitted changes will move with it to feat/' + slug + '.'),
    result: B('Utworzono gałąź feat/' + slug, 'Created branch feat/' + slug),
  };
  const base = area === '.' ? '' : area + '/';
  const f1 = area === '.' ? 'package.json' : base + pick(['index.ts', 'config.ts', 'service.ts']);
  const f2 = area === '.' ? 'package-lock.json' : base + pick(['utils.ts', 'api.ts', 'store.ts', 'hooks.ts']);
  const nFiles = rint(3, 12), nTests = rint(12, 60);
  const steps: Step[] = [
    { tool: 'Glob', target: area === '.' ? '**/package.json' : base + '**/*', result: B(nFiles + ' plików', nFiles + ' files') },
    { tool: 'Read', target: f1 },
    { tool: 'Read', target: f2 },
  ];
  if (Math.random() < 0.5) steps.push({ tool: 'WebSearch', target: task.replace(/\.$/, '').slice(0, 42).toLowerCase() });
  if (Math.random() < 0.5) steps.push({ tool: 'Ask', ask: { q: B('Zrobić to w osobnej gałęzi, czy w obecnej?', 'Do this on a separate branch or the current one?'), options: [B('W osobnej gałęzi', 'Separate branch'), B('W obecnej', 'Current branch')] } });
  steps.push({ tool: 'Edit', target: area === '.' ? 'package.json' : f1, diff: '+' + rint(8, 60) + ' −' + rint(1, 20) });
  steps.push({ tool: 'Write', target: 'tests/' + slug + '.test.ts', diff: '+' + rint(20, 80) });
  steps.push({ tool: 'Bash', target: perm.cmd, perm: { title: perm.title, why: perm.why }, result: perm.result });
  steps.push({ tool: 'Bash', target: 'npm test', result: B(nTests + ' testów przechodzi', nTests + ' tests passing') });
  return steps;
}

type AgentState = 'run' | 'wait' | 'ask' | 'idle' | 'pause';

interface DemoAgent {
  s: SessionInfo;
  steps: Step[];
  si: number;
  state: AgentState;
  timer: number;
  later: { t: number; fn: () => void } | null;
  /** Tokens or nano-AIC already paid out by the bank. */
  earnedBase: number;
  nanoAic: number;
}

export class DemoSource implements Source {
  readonly kind = 'demo' as const;
  readonly demo: DemoControls;
  private sink: Sink | null = null;
  private agents = new Map<string, DemoAgent>();
  private seq = 0;
  private ids = 0;
  private perms = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  /** Simulated bank: the 5-hour window slowly empties, Copilot sits at 212 of 300 premium requests. */
  private bank: Bank = {};

  constructor() {
    const self = this;
    this.demo = {
      answer: (id, v) => self.answer(id, v),
      giveTask: (id, task) => self.giveTask(id, task),
      message: (id, text) => self.message(id, text),
      halt: id => self.halt(id),
      spawn: (name, f, task) => self.spawn(name, f, task),
      freeName: () => self.freeName(),
      suggestions: SUGGESTIONS,
    };
  }

  start(sink: Sink): void {
    this.sink = sink;
    this.agents.clear();
    sink.state('demo');
    const now = Date.now();
    const recent: Activity[] = [];
    this.live = false;
    this.buffer = [];
    const seeded: Array<{ id: string; text: Text; at: number }> = [];
    const seed = (tp: Template, si: number, setup: (a: DemoAgent) => void) => {
      const a = this.create(tp.name, tp.f, tp.task, tp.steps.map(x => ({ ...x })), tp.agent, tp.model);
      let at = now - 90_000 + rint(0, 20_000);
      recent.push(this.act(a, 'session_start', {}, at));
      recent.push(this.act(a, 'prompt', { text: tp.task }, (at += 2000)));
      a.s.prompt = tp.task;
      for (let k = 0; k < si; k++) {
        const st = a.steps[k];
        const tool = st.ask ? 'AskUserQuestion' : st.tool;
        recent.push(this.act(a, 'tool', { tool, target: st.ask ? st.ask.q : st.target, station: stationForTool(tool) }, (at += 5000)));
        if (st.ask) seeded.push({ id: a.s.id, text: st.answer ?? st.ask.options[0], at: at + 2000 });
        if (st.perm) recent.push(this.act(a, 'permission_resolved', { resolution: 'allow' }, (at += 1500)));
        this.spend(a);
        recent.push(this.act(a, 'tool_done', { tool, text: st.result }, (at += 3000)));
        a.s.toolCount += 1;
      }
      // Earlier turns were paid out already.
      a.earnedBase = a.s.provider === 'copilot' ? a.nanoAic : totalTokens(a.s.usage);
      a.s.earnings = { unit: a.s.provider === 'copilot' ? 'nanoAic' : 'tokens', total: a.earnedBase };
      a.si = si;
      setup(a);
    };
    seed(TEMPLATES[0], 3, a => this.beginStep(a, 0.35));
    seed(TEMPLATES[1], 1, a => this.beginStep(a, 0.7));
    seed(TEMPLATES[2], 2, a => this.beginStep(a));
    seed(TEMPLATES[3], 2, a => this.beginStep(a, 0.55));
    seed(TEMPLATES[4], 1, a => { this.beginStep(a); a.timer = 0.6; });
    seed(TEMPLATES[5], TEMPLATES[5].steps.length, a => {
      recent.push(this.act(a, 'stop', { text: tBoth('demoDone', { task: a.s.prompt }) }, now - 5000));
      a.s.status = 'idle';
      a.s.lastMessage = tBoth('demoDone', { task: a.s.prompt });
      a.state = 'idle';
    });
    recent.push(...this.buffer);
    this.buffer = [];
    recent.sort((x, y) => x.at - y.at);
    const month = new Date().toISOString().slice(0, 7);
    this.bank = {
      daily: { day: localDay(now), tokens: 0, nanoAic: 0 },
      claude: {
        fiveHour: { usedPct: 38, resetsAt: now + 2.3 * 3600_000 },
        sevenDay: { usedPct: 59, resetsAt: now + 3.4 * 86_400_000 },
        updatedAt: now,
      },
      copilot: { used: 212, allowance: 300, month, updatedAt: now },
    };
    for (const a of this.agents.values()) {
      const earned = a.s.earnings!;
      this.bank.daily![earned.unit] += earned.total;
    }
    const snapshot: Snapshot = {
      protocol: PROTOCOL_VERSION, version: 'demo', approvals: true,
      sessions: [...this.agents.values()].map(a => structuredClone(a.s)),
      recent,
      bank: structuredClone(this.bank),
    };
    for (const s of snapshot.sessions) {
      const a = this.agents.get(s.id)!;
      a.s.timing = newSessionTiming(now);
      advanceTiming(a.s.timing, a.s.status, now);
      s.timing = structuredClone(a.s.timing);
    }
    sink.message({ type: 'snapshot', snapshot });
    for (const x of seeded) sink.say(x.id, 'you', x.text, x.at, true);
    sink.system('sysStartDemo');
    this.live = true;
    this.last = performance.now();
    this.interval = setInterval(() => this.tick(), 100);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.live = false;
    this.sink = null;
    this.agents.clear();
  }

  async decide(sessionId: string, permissionId: string, decision: Decision): Promise<void> {
    const a = this.agents.get(sessionId);
    if (!a || a.state !== 'wait' || a.s.pending?.id !== permissionId) throw new Error('not waiting');
    const st = a.steps[a.si];
    a.s.pending = undefined;
    a.state = 'pause';
    if (decision === 'allow') {
      st.granted = true;
      a.s.status = 'working';
      this.emit(a, 'permission_resolved', { permissionId, resolution: 'allow' });
      this.later(a, 0.9, () => { a.state = 'run'; a.timer = this.stepDur(st); });
    } else {
      a.s.status = 'thinking';
      a.s.currentTool = undefined;
      this.emit(a, 'permission_resolved', { permissionId, resolution: 'deny' });
      this.later(a, 1, () => {
        if (st.alt) {
          a.steps[a.si] = { ...st.alt };
          this.sink?.say(a.s.id, 'robot', tBoth('lAlt', { target: st.alt.target }));
          this.beginStep(a);
        } else {
          this.sink?.say(a.s.id, 'robot', tBoth('lSkip'));
          a.si++;
          this.startStep(a);
        }
      });
    }
  }

  /* ---------- simulation ---------- */

  /** False while start() seeds the town: activities then go into the snapshot instead of the stream. */
  private live = false;
  private buffer: Activity[] = [];

  private tick(): void {
    if (this.bank.daily?.day !== localDay(Date.now())) {
      this.bank.daily = { day: localDay(Date.now()), tokens: 0, nanoAic: 0 };
      this.sendBank();
    }
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    for (const a of this.agents.values()) {
      if (a.later) {
        a.later.t -= dt;
        if (a.later.t <= 0) { const fn = a.later.fn; a.later = null; fn(); }
      }
      if (a.state === 'run') {
        a.timer -= dt;
        if (a.timer <= 0) this.completeStep(a);
      }
    }
  }

  private later(a: DemoAgent, sec: number, fn: () => void): void { a.later = { t: sec, fn }; }

  private stepDur(st: Step): number { return (DUR[st.tool] ?? 4) * rnd(0.85, 1.2); }

  private create(name: string, f: boolean, task: Text, steps: Step[], agent: AgentKind = 'claude', model?: DemoModel): DemoAgent {
    const id = `demo-${++this.ids}`;
    const now = Date.now();
    const s: SessionInfo = {
      id, provider: agent, name, f, cwd: '~/projects/shop', project: 'shop', status: 'idle',
      startedAt: now, updatedAt: now, timing: newSessionTiming(now), prompt: task, subagents: 0, toolCount: 0,
    };
    // Copilot earnings use AIC, not a Claude token breakdown.
    if (agent === 'claude') {
      const m = model ?? pick(['Opus', 'Sonnet', 'Haiku'] as const);
      s.modelName = m;
      s.model = MODELS[m].id;
      s.usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
      s.costUsd = 0;
      s.contextPct = rnd(4, 9);
    }
    const a: DemoAgent = { s, steps, si: 0, state: 'idle', timer: 0, later: null, earnedBase: 0, nanoAic: 0 };
    this.agents.set(id, a);
    return a;
  }

  private act(a: DemoAgent, kind: ActivityKind, extra: Partial<Activity>, at = Date.now()): Activity {
    const activity: Activity = { seq: ++this.seq, at, sessionId: a.s.id, kind, ...extra };
    for (const k of Object.keys(activity) as Array<keyof Activity>) if (activity[k] === undefined) delete activity[k];
    a.s.updatedAt = at;
    return activity;
  }

  private emit(a: DemoAgent, kind: ActivityKind, extra: Partial<Activity> = {}): void {
    const activity = this.act(a, kind, extra);
    if (a.s.timing) advanceTiming(a.s.timing, a.s.status, activity.at);
    if (this.live) this.sink?.message({ type: 'activity', activity, session: structuredClone(a.s) });
    else this.buffer.push(activity);
  }

  private startStep(a: DemoAgent): void {
    const st = a.steps[a.si];
    if (!st) { this.finish(a); return; }
    this.beginStep(a);
  }

  /** Starts step a.si. `left` (0..1) starts it part-way through (seeding). */
  private beginStep(a: DemoAgent, left = 1): void {
    const st = a.steps[a.si];
    if (!st) { this.finish(a); return; }
    if (st.ask) {
      const tool = 'AskUserQuestion';
      a.s.currentTool = { tool, target: st.ask.q, station: stationForTool(tool), startedAt: Date.now() };
      a.s.status = 'asking';
      a.s.attentionText = st.ask.q;
      a.s.toolCount += 1;
      a.state = 'ask';
      this.emit(a, 'tool', { tool, target: st.ask.q, station: stationForTool(tool) });
      this.emit(a, 'attention', { attention: 'question', text: st.ask.q, tool, options: st.ask.options });
      return;
    }
    const station = stationForTool(st.tool);
    a.s.currentTool = { tool: st.tool, target: st.target ?? '', station, startedAt: Date.now() };
    a.s.toolCount += 1;
    if (st.perm && !st.granted) {
      a.s.status = 'waiting';
      const pending: PendingPermission = {
        id: `demo-perm-${++this.perms}`, tool: st.tool, target: st.target ?? '', title: st.perm.title, why: st.perm.why,
        createdAt: Date.now(), approvable: true,
      };
      a.s.pending = pending;
      a.state = 'wait';
      this.emit(a, 'tool', { tool: st.tool, target: st.target, station });
      this.emit(a, 'permission', { tool: st.tool, target: st.target, permissionId: pending.id, attention: 'permission' });
      return;
    }
    a.s.status = 'working';
    a.state = 'run';
    a.timer = this.stepDur(st) * left;
    this.emit(a, 'tool', { tool: st.tool, target: st.target, station });
  }

  /** One step uses 2k–30k tokens, mostly cache reads, like a real agent. */
  private spend(a: DemoAgent): void {
    if (a.s.provider === 'copilot') {
      a.nanoAic += rint(100, 4000) * 10_000_000;
      return;
    }
    const u = a.s.usage;
    if (!u) return;
    const n = rint(2000, 30000);
    const read = Math.round(n * rnd(0.6, 0.8)), write = Math.round(n * rnd(0.08, 0.18)), out = Math.round(n * rnd(0.05, 0.12));
    u.cacheRead += read;
    u.cacheWrite += write;
    u.output += out;
    u.input += Math.max(0, n - read - write - out);
    const m = MODELS[(a.s.modelName as DemoModel) ?? 'Sonnet'] ?? MODELS.Sonnet;
    a.s.costUsd = Math.round(((a.s.costUsd ?? 0) + n * m.usdPerToken) * 100) / 100;
    a.s.contextPct = Math.min(92, Math.round(((a.s.contextPct ?? 5) + n / 4000) * 10) / 10);
  }

  private completeStep(a: DemoAgent): void {
    const st = a.steps[a.si];
    this.spend(a);
    a.s.status = 'thinking';
    a.s.currentTool = undefined;
    a.state = 'pause';
    this.emit(a, 'tool_done', { tool: st.tool, text: st.result ?? (st.diff ? st.diff : undefined) });
    a.si++;
    this.later(a, rnd(0.4, 1.1), () => this.startStep(a));
  }

  private finish(a: DemoAgent): void {
    a.state = 'idle';
    a.s.status = 'idle';
    a.s.currentTool = undefined;
    a.s.attentionText = undefined;
    const text = tBoth('demoDone', { task: a.s.prompt });
    a.s.lastMessage = text;
    this.emit(a, 'stop', { text });
    this.payOut(a);
  }

  /** End of a turn: the bank pays the robot and the simulated limits move. */
  private payOut(a: DemoAgent): void {
    const b = this.bank;
    if (a.s.provider === 'copilot') {
      if (b.copilot) { b.copilot = { ...b.copilot, used: Math.min(b.copilot.allowance ?? 300, b.copilot.used + 1), updatedAt: Date.now() }; this.sendBank(); }
    }
    const unit = a.s.provider === 'copilot' ? 'nanoAic' : 'tokens';
    const total = unit === 'nanoAic' ? a.nanoAic : totalTokens(a.s.usage);
    const delta = total - a.earnedBase;
    a.earnedBase = total;
    if (delta <= 0) return;
    setTimeout(() => {
      if (!this.live || this.agents.get(a.s.id) !== a) return;
      a.s.earnings = { unit, total };
      if (b.daily?.day !== localDay(Date.now())) b.daily = { day: localDay(Date.now()), tokens: 0, nanoAic: 0 };
      b.daily[unit] += delta;
      this.emit(a, 'earned', unit === 'nanoAic' ? { nanoAic: delta } : { tokens: delta });
      const c = b.claude;
      if (unit === 'tokens' && c?.fiveHour && c.sevenDay) {
        c.fiveHour = { ...c.fiveHour, usedPct: Math.min(97, Math.round((c.fiveHour.usedPct + delta / 25_000) * 10) / 10) };
        c.sevenDay = { ...c.sevenDay, usedPct: Math.min(97, Math.round((c.sevenDay.usedPct + delta / 120_000) * 10) / 10) };
        c.updatedAt = Date.now();
      }
      this.sendBank();
    }, 800);
  }

  private sendBank(): void {
    if (this.live) this.sink?.message({ type: 'bank', bank: structuredClone(this.bank) });
  }

  /* ---------- controls ---------- */

  private answer(id: string, v: Text): void {
    const a = this.agents.get(id);
    if (!a || a.state !== 'ask') return;
    if (typeof v === 'string') { v = v.trim(); if (!v) return; }
    const answer = v;
    a.state = 'pause';
    a.s.status = 'thinking';
    a.s.attentionText = undefined;
    a.s.currentTool = undefined;
    this.sink?.say(id, 'you', answer);
    this.emit(a, 'tool_done', { tool: 'AskUserQuestion' });
    this.later(a, 0.9, () => {
      this.sink?.say(id, 'robot', tBoth('lGotIt', { answer }, a.s.f));
      a.si++;
      this.startStep(a);
    });
  }

  private halt(id: string): void {
    const a = this.agents.get(id);
    if (!a || a.state === 'idle') return;
    this.sink?.say(id, 'you', tBoth('lStopped'));
    if (a.s.pending) {
      const pid = a.s.pending.id;
      a.s.pending = undefined;
      a.s.status = 'thinking';
      this.emit(a, 'permission_resolved', { permissionId: pid, resolution: 'cancelled' });
    }
    a.later = null;
    a.si = a.steps.length;
    a.state = 'idle';
    a.s.status = 'idle';
    a.s.currentTool = undefined;
    a.s.attentionText = undefined;
    this.emit(a, 'stop', {});
    this.payOut(a);
  }

  private giveTask(id: string, task: string): void {
    const a = this.agents.get(id);
    task = task.trim();
    if (!a || !task || a.state !== 'idle') return;
    this.prompt(a, task, genericSteps(task));
  }

  private prompt(a: DemoAgent, task: string, steps: Step[]): void {
    a.steps = steps;
    a.si = 0;
    a.s.prompt = task;
    a.s.status = 'thinking';
    a.s.lastMessage = undefined;
    a.state = 'pause';
    this.emit(a, 'prompt', { text: task });
    this.later(a, rnd(1.2, 2), () => this.startStep(a));
  }

  private message(id: string, text: string): void {
    text = text.trim();
    if (!text || !this.agents.has(id)) return;
    this.sink?.say(id, 'you', text);
    setTimeout(() => {
      const a = this.agents.get(id);
      if (a) this.sink?.say(id, 'robot', tBoth(pick(['rep1', 'rep2', 'rep3']), undefined, a.s.f));
    }, 1200);
  }

  private spawn(name: string, f: boolean, task: string): string | null {
    if (this.agents.size >= MAX_ROBOTS) return null;
    const a = this.create(name, f, task, genericSteps(task));
    a.s.prompt = undefined;
    this.emit(a, 'session_start', {});
    this.later(a, 0.9, () => this.prompt(a, task, a.steps));
    return a.s.id;
  }

  private freeName(): { name: string; f: boolean } {
    const used = new Set([...this.agents.values()].map(a => a.s.name));
    return ROBOT_NAMES.find(n => !used.has(n.name)) ?? { name: 'Robo ' + (this.ids + 1), f: false };
  }
}
