/**
 * Every user-facing string, in Polish and English. Rule: add both languages for every key.
 * Polish strings that depend on the robot's grammatical gender are written as { m, f }.
 */
import type { Localized, Text } from '../../../shared/src/index.ts';

type Entry = string | { m: string; f: string };
export type Lang = 'pl' | 'en';

const pl: Record<string, Entry> = {
  canvasLabel: 'Miasteczko agentów. Każdy robocik to jeden agent.',
  noglTitle: 'Miasteczko się nie wyświetli.',
  noglText: 'Ta przeglądarka nie obsługuje WebGL albo ma go wyłączonego. Otwórz stronę w Chrome, Edge, Firefox lub Safari.',
  brandTitle: 'Wioska Agentów',
  brandSub: 'Każdy robocik to jedna sesja agenta. Kliknij go, żeby zobaczyć, co robi i czego potrzebuje.',
  langLabel: 'Język',
  statWork: 'pracuje', statWait: 'czeka na ciebie', statDone: 'się ładuje',
  modeLive: 'Na żywo', modeDemo: 'Demo', modeOffline: 'Brak serwera', modeReconnect: 'Łączenie…',
  toDemo: 'Demo', toLive: 'Na żywo',
  newBtn: 'Nowy robocik',
  legend: 'Legenda',
  lgSite: 'Budowa', lgSiteD: 'Klepie młotkiem. Z każdą zmianą rośnie piętro.',
  lgLib: 'Biblioteka', lgLibD: 'Czyta pliki na tablecie, potem niesie paczkę na budowę.',
  lgForge: 'Kuźnia', lgForgeD: 'Kuje przy kowadle, czyli uruchamia komendy.',
  lgTower: 'Wieża radarowa', lgTowerD: 'Radar się kręci, czyli szuka w internecie.',
  lgPlaza: 'Plac z fontanną', lgPlazaD: 'Myśli albo używa innych narzędzi.',
  lgCharge: 'Ładowarka', lgChargeD: 'Skończył turę i czeka na polecenie.',
  lgWait: 'Czeka na zgodę', lgAsk: 'Ma pytanie', lgAgentsD: 'Kolor robota mówi, z którego agenta pochodzi: ciepłe barwy to Claude, chłodne to Copilot.',
  lgNoteLive: 'Na żywo: zdarzenia przychodzą z hooków Claude Code i Copilota przez lokalny serwer.',
  lgNoteDemo: 'Demo: roboty i ich kroki są symulowane.',
  feedLabel: 'Ostatnie zdarzenia', camLabel: 'Kamera', rotL: 'Obróć w lewo (Q)', rotR: 'Obróć w prawo (E)', zoomIn: 'Przybliż', zoomOut: 'Oddal', recenter: 'Wyśrodkuj',
  closePanel: 'Zamknij panel', hTask: 'Zadanie', hNow: 'Teraz', hLog: 'Ostatnie kroki', hLast: 'Ostatnia odpowiedź',
  msgLabel: 'Wiadomość do robota', msgPh: 'Napisz do robota…', send: 'Wyślij', follow: 'Śledź kamerą', unfollow: 'Przestań śledzić', stop: 'Zatrzymaj',
  dlgTitle: 'Nowy robocik', dlgSub: 'Wpisz zadanie. Robocik wyjdzie z fabryki i od razu zacznie pracę.', dlgName: 'Imię', dlgTask: 'Zadanie', cancel: 'Anuluj', launch: 'Wypuść z fabryki',
  dlgLiveSub: 'Na żywo każdy robot to sesja Claude Code. Otwórz terminal w folderze projektu i uruchom:',
  dlgLiveNote: 'Robot wyjdzie z fabryki, gdy sesja wystartuje. Uruchamianie agentów prosto z wioski planujemy w etapie 3.',
  ok: 'OK',
  emptyTitle: 'Nikogo jeszcze nie ma', emptyText: 'Uruchom Claude Code w dowolnym projekcie, a pojawi się tu robot.', emptyDemo: 'Pokaż demo',
  emptyHooks: 'Nic się nie dzieje? Sprawdź hooki: pnpm hooks:status',
  offlineTitle: 'Serwer wioski nie odpowiada', offlineText: 'Uruchom pnpm start w folderze projektu. Na razie pokazuję demo.',
  st_lib: 'Biblioteka', st_site: 'Budowa', st_tower: 'Wieża radarowa', st_forge: 'Kuźnia', st_charge: 'Ładowarka', st_plaza: 'Plac',
  v_Read: 'czyta', v_Grep: 'przeszukuje pliki:', v_Glob: 'przegląda pliki', v_LS: 'przegląda folder', v_Edit: 'edytuje', v_MultiEdit: 'edytuje', v_Write: 'tworzy',
  v_Bash: 'uruchamia', v_PowerShell: 'uruchamia', v_WebSearch: 'szuka w sieci:', v_WebFetch: 'czyta stronę', v_Task: 'wysyła pomocnika:', v_Agent: 'wysyła pomocnika:',
  v_TodoWrite: 'planuje kroki', v_other: 'używa {tool}',
  s_lib: 'Czyta', s_site: 'Buduje', s_forge: 'Kuje w kuźni', s_tower: 'Nasłuchuje radaru', s_plaza: 'Pracuje', s_think: 'Myśli',
  sWalkHome: 'Idzie się naładować', sCarry: 'Niesie paczkę', sWalk: 'W drodze', sWait: 'Czeka na zgodę', sAsk: 'Ma pytanie', sIdle: 'Czeka na kolejny krok',
  sCharge: { m: 'Ładuje się · skończył turę', f: 'Ładuje się · skończyła turę' }, sStopped: { m: 'Zatrzymany', f: 'Zatrzymana' }, sSpawn: 'Wychodzi z fabryki', sLeave: 'Wraca do fabryki',
  nowWalk: 'W drodze. Cel: {st}.', nowCarry: { m: ' Niesie paczkę z tym, co przeczytał w bibliotece.', f: ' Niesie paczkę z tym, co przeczytała w bibliotece.' },
  nowWait: 'Stoi przy: {st}. Czeka na twoją decyzję.', nowWaitPlain: 'Czeka na twoją decyzję.', nowAsk: 'Czeka na twoją odpowiedź.', nowThink: 'Myśli nad zadaniem przy fontannie.',
  nowIdle: 'Czeka przy: {st} na kolejny krok.', nowCharge: 'Ładuje baterie. Czeka na kolejne polecenie.', nowSpawn: 'Wychodzi z fabryki.', nowLeave: 'Sesja się skończyła. Wraca do fabryki.',
  nowStopped: { m: 'Stoi na ładowarce. Możesz dać mu nowe zadanie.', f: 'Stoi na ładowarce. Możesz dać jej nowe zadanie.' },
  reqPerm: 'Prosi o zgodę', allow: 'Zezwól', deny: 'Odmów', reqAsk: 'Ma pytanie', answerLabel: 'Twoja odpowiedź', answerPh: 'Albo odpowiedz po swojemu', answerBtn: 'Odpowiedz',
  reqToolTitle: 'Chce użyć narzędzia {tool}.', reqTerminal: 'Odpowiedz w terminalu Claude Code.',
  reqTerminalHint: 'Żeby odpowiadać z wioski, włącz zgody: pnpm hooks:install --approvals', reqExpires: 'Claude Code czeka jeszcze {s} s, potem zapyta w terminalu.',
  askTerminal: 'Agent zadał pytanie. Odpowiedz w terminalu Claude Code.', idleTerminal: 'Tura skończona. Napisz kolejne polecenie w terminalu.',
  reqDone: 'Zadanie skończone', reqStopped: 'Robot zatrzymany', newTaskLabel: 'Nowe zadanie', newTaskPh: 'Co ma zrobić teraz?', giveTask: 'Daj nowe zadanie',
  errDecision: 'Nie udało się wysłać decyzji: {msg}',
  qAsk: 'ma pytanie', bubWait: '{name} czeka na zgodę', bubAsk: '{name} ma pytanie',
  helpers: 'pomocnicy: {n}', steps: 'kroki: {n}', noTask: 'Jeszcze bez zadania',
  a_session_start: { m: 'wyszedł z fabryki', f: 'wyszła z fabryki' }, a_prompt: { m: 'dostał zadanie', f: 'dostała zadanie' },
  a_tool_failed: 'błąd: {text}', a_permission: 'prosi o zgodę: {target}', a_question: 'ma pytanie', a_idle: 'czeka na polecenie', a_info: '{text}',
  a_res_allow: 'zgoda udzielona', a_res_deny: 'odmówiono', a_res_terminal: 'odpowiedziano w terminalu', a_res_timeout: 'brak odpowiedzi w wiosce, pyta w terminalu', a_res_cancelled: 'prośba anulowana',
  a_stop: { m: 'skończył turę', f: 'skończyła turę' }, a_sub_start: 'wysłał pomocnika {agent}', a_sub_stop: 'pomocnik skończył', a_end: { m: 'zakończył sesję', f: 'zakończyła sesję' },
  sysName: 'Miasteczko', sysStartDemo: 'Demo wystartowało z 6 robotami.', sysLive: 'Połączono z serwerem wioski.', sysTower: 'Na budowie stanął nowy wieżowiec. Za chwilę zaczną kolejny.',
  sysFull: 'Miasteczko jest pełne. Zatrzymaj kogoś albo daj nowe zadanie komuś z ładowarki.',
  you: 'Ty:', robot: 'Robot:', lAsk: 'Pyta: {q}', lWaitNote: 'czeka na zgodę', lAllowed: 'zezwolono na {target}', lDenied: 'odmówiono: {target}', lStopped: 'zatrzymano robota',
  lNewTask: 'nowe zadanie: {task}', lDone: 'Tura skończona', lAlt: 'Zrobię to bez uruchamiania: {target}', lSkip: 'Pomijam ten krok i idę dalej.',
  lGotIt: { m: 'Przyjąłem: {answer}. Wracam do pracy.', f: 'Przyjęłam: {answer}. Wracam do pracy.' },
  rep1: 'Jasne, uwzględnię to w kolejnych krokach.', rep2: 'Dobra, wezmę to pod uwagę.', rep3: { m: 'Przyjąłem. Dam znać, jak skończę.', f: 'Przyjęłam. Dam znać, jak skończę.' },
  popThanks: 'Dzięki!', popOther: 'Dobra, inaczej', popSure: 'Jasne!', popDone: 'Gotowe!', popHi: 'Cześć!',
  demoDone: 'Zrobione: {task}',
  hEarned: 'Zarobione', earnTokens: 'tokenów', earnIn: 'wejście', earnOut: 'wyjście', earnCw: 'zapis cache', earnCr: 'odczyt cache',
  earnCost: '≈ {usd} (szacunek Claude Code po cenniku)', earnCtx: 'Kontekst: {pct}%', earnNone: 'Jeszcze nic. Tokeny pojawią się po pierwszej turze.',
  earnCopilot: 'Copilot nie podaje tokenów dla pojedynczej sesji.',
  a_earned: { m: 'zarobił {n} tokenów', f: 'zarobiła {n} tokenów' },
  bankName: 'Bank', bankSub: 'Płaci robotom za pracę i pokazuje, ile limitu zostało.', bankOpen: 'Otwórz bank', closeBank: 'Zamknij bank',
  bank5h: 'Okno 5-godzinne', bank7d: 'Okno tygodniowe', bankSpend: 'Limit wydatków', bankLeft: 'zostało {pct}%', bankResets: 'odnowi się {when}',
  bankClaudeNone: 'Brak danych. Limity widać tylko w planach Pro i Max, po pierwszej odpowiedzi Claude Code z zainstalowanym status line.',
  bankCopilotReq: '{used} z {allowance} zapytań premium w miesiącu {month}', bankCopilotUsed: '{used} zapytań premium w miesiącu {month}',
  bankCopilotNone: 'Niepodłączony. Uruchom: pnpm copilot:setup', bankCopilotErr: 'Ostatni odczyt się nie udał: {msg}',
  bankCost: 'Koszt sesji na żywo', bankCostNote: 'szacunek Claude Code po cenniku',
  bankSource: 'Skąd liczby: Claude z status line Claude Code, Copilot z API rozliczeń GitHuba (co 10 minut).',
  bankDemo: 'Demo: bank jest symulowany.',
  lgBank: 'Bank', lgBankD: 'Płaci robotom monetami za tokeny. Szklane skarbce pokazują, ile limitu zostało: lewy Claude, prawy Copilot.',
  copilotMark: 'Copilot',
};

const en: Record<string, Entry> = {
  canvasLabel: 'Agent town. Each robot is one agent.',
  noglTitle: "The town can't be displayed.",
  noglText: 'This browser does not support WebGL or has it turned off. Open the page in Chrome, Edge, Firefox or Safari.',
  brandTitle: 'Agent Village',
  brandSub: 'Each robot is one agent session. Click a robot to see what it is doing and what it needs.',
  langLabel: 'Language',
  statWork: 'working', statWait: 'need you', statDone: 'charging',
  modeLive: 'Live', modeDemo: 'Demo', modeOffline: 'No server', modeReconnect: 'Reconnecting…',
  toDemo: 'Demo', toLive: 'Live',
  newBtn: 'New robot',
  legend: 'Legend',
  lgSite: 'Construction site', lgSiteD: 'Hammers away. Every change adds to the tower.',
  lgLib: 'Library', lgLibD: 'Reads files on a tablet, then carries a crate to the site.',
  lgForge: 'Forge', lgForgeD: 'Strikes the anvil, i.e. runs shell commands.',
  lgTower: 'Radar tower', lgTowerD: 'The dish spins while it searches the web.',
  lgPlaza: 'Fountain plaza', lgPlazaD: 'Thinking, or using other tools.',
  lgCharge: 'Charging station', lgChargeD: 'Finished its turn and waits for your next prompt.',
  lgWait: 'Needs approval', lgAsk: 'Has a question', lgAgentsD: 'The colour tells which agent a robot comes from: warm shades are Claude, cool shades are Copilot.',
  lgNoteLive: 'Live: events come from Claude Code and Copilot hooks through the local server.',
  lgNoteDemo: 'Demo: the robots and their steps are simulated.',
  feedLabel: 'Recent events', camLabel: 'Camera', rotL: 'Rotate left (Q)', rotR: 'Rotate right (E)', zoomIn: 'Zoom in', zoomOut: 'Zoom out', recenter: 'Recenter',
  closePanel: 'Close panel', hTask: 'Task', hNow: 'Now', hLog: 'Recent steps', hLast: 'Last reply',
  msgLabel: 'Message to the robot', msgPh: 'Message this robot…', send: 'Send', follow: 'Follow', unfollow: 'Stop following', stop: 'Stop',
  dlgTitle: 'New robot', dlgSub: 'Describe the task. The robot will roll out of the factory and get to work.', dlgName: 'Name', dlgTask: 'Task', cancel: 'Cancel', launch: 'Send it out',
  dlgLiveSub: 'In live mode every robot is a Claude Code session. Open a terminal in your project folder and run:',
  dlgLiveNote: 'The robot rolls out of the factory when the session starts. Launching agents straight from the town is planned for stage 3.',
  ok: 'OK',
  emptyTitle: 'Nobody here yet', emptyText: 'Start Claude Code in any project and a robot will appear here.', emptyDemo: 'Show demo',
  emptyHooks: 'Nothing happening? Check the hooks: pnpm hooks:status',
  offlineTitle: 'The village server is not answering', offlineText: 'Run pnpm start in the project folder. Showing the demo for now.',
  st_lib: 'Library', st_site: 'Construction site', st_tower: 'Radar tower', st_forge: 'Forge', st_charge: 'Charging station', st_plaza: 'Plaza',
  v_Read: 'is reading', v_Grep: 'is searching files for', v_Glob: 'is listing files in', v_LS: 'is listing', v_Edit: 'is editing', v_MultiEdit: 'is editing', v_Write: 'is writing',
  v_Bash: 'is running', v_PowerShell: 'is running', v_WebSearch: 'is searching the web for', v_WebFetch: 'is reading', v_Task: 'is sending a helper:', v_Agent: 'is sending a helper:',
  v_TodoWrite: 'is planning steps', v_other: 'is using {tool}',
  s_lib: 'Reading', s_site: 'Building', s_forge: 'At the forge', s_tower: 'On the radar', s_plaza: 'Working', s_think: 'Thinking',
  sWalkHome: 'Heading to charge', sCarry: 'Carrying a crate', sWalk: 'On the way', sWait: 'Needs approval', sAsk: 'Has a question', sIdle: 'Waiting for the next step',
  sCharge: 'Charging · turn finished', sStopped: 'Stopped', sSpawn: 'Leaving the factory', sLeave: 'Going back to the factory',
  nowWalk: 'On the way to: {st}.', nowCarry: ' Carrying what it read at the library.',
  nowWait: 'Standing at: {st}. Waiting for your decision.', nowWaitPlain: 'Waiting for your decision.', nowAsk: 'Waiting for your answer.', nowThink: 'Thinking about the task at the fountain.',
  nowIdle: 'Waiting at: {st} for the next step.', nowCharge: 'Recharging. Waiting for your next prompt.', nowSpawn: 'Leaving the factory.', nowLeave: 'The session ended. Going back to the factory.',
  nowStopped: 'Parked at the charger. You can give it a new task.',
  reqPerm: 'Asks for approval', allow: 'Allow', deny: 'Deny', reqAsk: 'Has a question', answerLabel: 'Your answer', answerPh: 'Or answer in your own words', answerBtn: 'Reply',
  reqToolTitle: 'Wants to use {tool}.', reqTerminal: 'Answer in the Claude Code terminal.',
  reqTerminalHint: 'To answer from the town, turn approvals on: pnpm hooks:install --approvals', reqExpires: 'Claude Code waits {s}s more, then asks in the terminal.',
  askTerminal: 'The agent asked a question. Answer in the Claude Code terminal.', idleTerminal: 'Turn finished. Type the next prompt in the terminal.',
  reqDone: 'Task complete', reqStopped: 'Robot stopped', newTaskLabel: 'New task', newTaskPh: 'What should it do next?', giveTask: 'Give a new task',
  errDecision: 'Could not send the decision: {msg}',
  qAsk: 'has a question', bubWait: '{name} needs approval', bubAsk: '{name} has a question',
  helpers: 'helpers: {n}', steps: 'steps: {n}', noTask: 'No task yet',
  a_session_start: 'rolled out of the factory', a_prompt: 'got a task',
  a_tool_failed: 'failed: {text}', a_permission: 'asks for approval: {target}', a_question: 'has a question', a_idle: 'is waiting for a prompt', a_info: '{text}',
  a_res_allow: 'approved', a_res_deny: 'denied', a_res_terminal: 'answered in the terminal', a_res_timeout: 'no answer in the town, asking in the terminal', a_res_cancelled: 'request cancelled',
  a_stop: 'finished its turn', a_sub_start: 'sent a helper {agent}', a_sub_stop: 'helper finished', a_end: 'ended the session',
  sysName: 'Town', sysStartDemo: 'The demo started with 6 robots.', sysLive: 'Connected to the village server.', sysTower: 'A new tower is finished. The next one starts shortly.',
  sysFull: 'The town is full. Stop a robot or give a new task to one at the charger.',
  you: 'You:', robot: 'Robot:', lAsk: 'Asks: {q}', lWaitNote: 'awaiting approval', lAllowed: 'allowed {target}', lDenied: 'denied: {target}', lStopped: 'stopped the robot',
  lNewTask: 'new task: {task}', lDone: 'Turn finished', lAlt: "I'll do it without applying it: {target}", lSkip: 'Skipping this step and moving on.',
  lGotIt: 'Got it: {answer}. Back to work.',
  rep1: "Sure, I'll take that into account in the next steps.", rep2: "OK, I'll keep that in mind.", rep3: "Got it. I'll let you know when I'm done.",
  popThanks: 'Thanks!', popOther: 'OK, another way', popSure: 'Sure!', popDone: 'Done!', popHi: 'Hi!',
  demoDone: 'Done: {task}',
  hEarned: 'Earned', earnTokens: 'tokens', earnIn: 'input', earnOut: 'output', earnCw: 'cache write', earnCr: 'cache read',
  earnCost: '≈ {usd} (Claude Code estimate at list price)', earnCtx: 'Context: {pct}%', earnNone: 'Nothing yet. Tokens show up after the first turn.',
  earnCopilot: 'Copilot does not report tokens per session.',
  a_earned: 'earned {n} tokens',
  bankName: 'Bank', bankSub: 'Pays the robots for their work and shows how much of each limit is left.', bankOpen: 'Open the bank', closeBank: 'Close the bank',
  bank5h: '5-hour window', bank7d: 'Weekly window', bankSpend: 'Spend limit', bankLeft: '{pct}% left', bankResets: 'resets {when}',
  bankClaudeNone: 'No data yet. Limits show only on Pro and Max plans, after the first Claude Code answer with the status line installed.',
  bankCopilotReq: '{used} of {allowance} premium requests in {month}', bankCopilotUsed: '{used} premium requests in {month}',
  bankCopilotNone: 'Not connected. Run: pnpm copilot:setup', bankCopilotErr: 'The last check failed: {msg}',
  bankCost: 'Cost of live sessions', bankCostNote: 'Claude Code estimate at list price',
  bankSource: 'Where the numbers come from: Claude from the Claude Code status line, Copilot from the GitHub billing API (every 10 minutes).',
  bankDemo: 'Demo: the bank is simulated.',
  lgBank: 'Bank', lgBankD: 'Pays robots in coins for their tokens. The glass vaults show how much of each limit is left: left Claude, right Copilot.',
  copilotMark: 'Copilot',
};

const STR: Record<Lang, Record<string, Entry>> = { pl, en };
const KEY = 'agent-village-lang';
const listeners: Array<() => void> = [];

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'pl' || saved === 'en') return saved;
  } catch { /* storage can be blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

export let lang: Lang = initialLang();

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  for (const fn of listeners) fn();
}
export function onLang(fn: () => void): void { listeners.push(fn); }

/** Resolves text that may come in both languages. */
export function L(v: Text | undefined | null): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'object' ? (v[lang] ?? v.en) : String(v);
}

type Vars = Record<string, Text | number | undefined>;

function tIn(lg: Lang, key: string, vars?: Vars, f?: boolean): string {
  let s = STR[lg][key] ?? STR.en[key];
  if (s === undefined) return key;
  if (typeof s === 'object') s = f ? s.f : s.m;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) return '';
    if (typeof v === 'number') return String(v);
    return typeof v === 'object' ? (v[lg] ?? v.en) : v;
  });
}

/** Translates a key. Vars replace {name} placeholders; `f` picks the feminine Polish form. */
export function t(key: string, vars?: Vars, f?: boolean): string {
  return tIn(lang, key, vars, f);
}

/** The same text in both languages, for content that must follow later language switches (demo lines). */
export function tBoth(key: string, vars?: Vars, f?: boolean): Localized {
  return { pl: tIn('pl', key, vars, f), en: tIn('en', key, vars, f) };
}

export function hasKey(key: string): boolean { return key in STR.en; }

/** Fills elements marked with data-i18n, data-i18n-html and data-i18n-attr="attr:key;attr:key". */
export function applyStatic(root: ParentNode = document): void {
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach(el => {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const i = pair.indexOf(':');
      if (i > 0) el.setAttribute(pair.slice(0, i), t(pair.slice(i + 1)));
    }
  });
}

/** Compact number in the UI language: 18 400 → "18 tys." (PL) or "18K" (EN). */
export function fmtCompact(n: number): string {
  return new Intl.NumberFormat(lang === 'pl' ? 'pl-PL' : 'en-US', { notation: 'compact', maximumFractionDigits: n < 10_000 ? 1 : 0 }).format(n);
}

/** Full number with grouping in the UI language. */
export function fmtNumber(n: number): string {
  return new Intl.NumberFormat(lang === 'pl' ? 'pl-PL' : 'en-US').format(Math.round(n));
}

/** "$3.40" in the UI language. */
export function fmtUsd(n: number): string {
  return new Intl.NumberFormat(lang === 'pl' ? 'pl-PL' : 'en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/** A reset time in local time: "14:30" today, "pon. 09:00" / "Mon 09:00" within a week, a date after that. */
export function fmtWhen(ms: number): string {
  const loc = lang === 'pl' ? 'pl-PL' : 'en-US';
  const d = new Date(ms), now = new Date();
  const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(d);
  if (d.toDateString() === now.toDateString()) return time;
  if (ms - now.getTime() < 6.5 * 86_400_000) return new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(d) + ' ' + time;
  return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' }).format(d) + ' ' + time;
}
