/**
 * Entry point: builds the town, picks the source (live server or demo), wires the UI and runs the frame loop.
 */
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './ui/styles.css';

import * as THREE from 'three';
import { Village } from './agents/controller';
import { DemoSource } from './agents/demo';
import { LiveSource, pageToken, probeServer } from './agents/live';
import type { Robot } from './agents/robot';
import type { Sink, Source, SourceState } from './agents/source';
import { $ } from './lib/util';
import type { App } from './ui/app';
import { BankView } from './ui/bank';
import { NewRobotDialog } from './ui/dialog';
import { Hud } from './ui/hud';
import { applyStatic, fmtCompact, onLang } from './ui/i18n';
import { Panel } from './ui/panel';
import { Tags } from './ui/tags';
import { CameraRig, attachControls } from './world/camera';
import { updateCoins } from './world/coins';
import { BANK } from './world/layout';
import { createRenderer, onTheme, scene, watchTheme } from './world/kit';
import { updateParticles } from './world/particles';
import { buildTown } from './world/town';

const canvas = $<HTMLCanvasElement>('#world');
let renderer: THREE.WebGLRenderer;
try {
  renderer = createRenderer(canvas);
} catch (err) {
  console.error('[agent-village] WebGL is not available', err);
  applyStatic();
  $('#nogl').hidden = false;
  throw err;
}

const town = buildTown();
const rig = new CameraRig();

/* ---------- selection ring under the selected robot ---------- */
const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a5ce0, transparent: true, opacity: 0.9, depthWrite: false });
const selRing = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 32), ringMat);
selRing.rotation.x = -Math.PI / 2;
selRing.visible = false;
scene.add(selRing);
onTheme(night => ringMat.color.set(night ? 0x86a4ff : 0x3a5ce0));

/* ---------- app state ---------- */
let source: Source = new DemoSource();
let state: SourceState = 'connecting';
let selected: Robot | null = null;
let following = false;
let robotsDirty = true;
let panelDirty = false;

const app: App = {
  get village() { return village; },
  rig,
  get source() { return source; },
  get state() { return state; },
  get selected() { return selected; },
  get following() { return following; },
  select,
  setFollow,
  switchTo,
  openBank,
};

const tags = new Tags(id => { const r = village.get(id); if (r) select(r, false); });
const hud = new Hud(app);
const panel = new Panel(app);
const bankView = new BankView(app, levels => town.setVaults(levels), openBank);
const village = new Village(town, {
  changed(robot) {
    robotsDirty = true;
    if (!robot || robot === selected) panelDirty = true;
    if (selected && !village.get(selected.id)) select(null);
  },
  feed(items) { hud.setFeed(items); },
  pop(robot, key, kind) { tags.pop(robot, key, kind, rig); },
  paid(robot, tokens) { tags.popText(robot, '+' + fmtCompact(tokens), 'coin', rig); },
  bank(b) { bankView.set(b); },
});
const dialog = new NewRobotDialog(app, () => village.system('sysFull'));
town.onTowerDone = () => village.system('sysTower');

function select(r: Robot | null, focus = false): void {
  if (r) bankView.close();
  selected = r;
  panel.open(r);
  setFollow(false);
  if (r && focus) rig.focus(r.x, r.z);
  robotsDirty = true;
}

/** Opens the bank card and turns the camera to the bank. */
function openBank(): void {
  select(null);
  bankView.show();
  rig.focus(BANK.center[0] * 0.8, BANK.center[1] * 0.8);
}

function setFollow(on: boolean): void {
  following = on && !!selected;
  rig.follow = following ? () => (selected ? { x: selected.x, z: selected.z } : null) : null;
  panelDirty = true;
}

/* ---------- sources ---------- */
const sink: Sink = {
  message: m => village.apply(m),
  say: (id, who, text, at, quiet) => village.say(id, who, text, at, quiet),
  system: key => village.system(key),
  state: s => { state = s; hud.setMode(source.kind, s); robotsDirty = true; },
};

function use(next: Source): void {
  source.stop();
  select(null);
  village.clear();
  tags.clear();
  bankView.set({});
  source = next;
  hud.setMode(source.kind, source.kind === 'demo' ? 'demo' : 'connecting');
  source.start(sink);
  panelDirty = true;
}

async function switchTo(kind: 'live' | 'demo'): Promise<void> {
  if (kind === source.kind && state !== 'offline') return;
  if (kind === 'demo') { use(new DemoSource()); setUrlMode('demo'); return; }
  const health = await probeServer();
  const token = pageToken();
  if (!health || !token) {
    village.system('offlineTitle');
    hud.setMode('demo', 'demo');
    $('#connDot').className = 'dot conn offline';
    return;
  }
  use(new LiveSource(token));
  setUrlMode('live');
}

function setUrlMode(kind: 'live' | 'demo'): void {
  try {
    const url = new URL(location.href);
    if (kind === 'demo') url.searchParams.set('demo', ''); else url.searchParams.delete('demo');
    history.replaceState(null, '', url.toString().replace(/demo=(&|$)/, 'demo$1'));
  } catch { /* not important */ }
}

async function boot(): Promise<void> {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  const token = pageToken();
  const health = forceDemo || !token ? null : await probeServer();
  if (health && token) {
    use(new LiveSource(token));
  } else {
    use(new DemoSource());
    if (!forceDemo) {
      village.system('offlineText');
      $('#connDot').className = 'dot conn offline';
    }
  }
}

/* ---------- input ---------- */
attachControls(canvas, rig, {
  onClick: (x, y) => {
    const hit = rig.pick(x, y, [...village.hits(), ...town.bankHits]);
    const r = hit ? village.get(hit.userData.robotId as string) : undefined;
    if (r) select(r, false);
    else if (hit && town.bankHits.includes(hit as THREE.Mesh)) openBank();
    else { if (selected) select(null); bankView.close(); }
  },
  onHover: (x, y) => !!rig.pick(x, y, [...village.hits(), ...town.bankHits]),
  onUserMove: () => { if (following) setFollow(false); },
});
window.addEventListener('keydown', e => {
  const target = e.target as HTMLElement;
  if (target.closest?.('input,textarea')) { if (e.key === 'Escape') target.blur(); return; }
  if (e.key === 'Escape') { if (dialog.isOpen) dialog.close(); else { select(null); bankView.close(); } }
  if (e.key === 'q' || e.key === 'Q') rig.rotate(-1);
  if (e.key === 'e' || e.key === 'E') rig.rotate(1);
});

/* ---------- language and theme ---------- */
function relabel(): void {
  applyStatic();
  hud.setMode(source.kind, state);
  hud.relabel();
  dialog.relabel();
  bankView.relabel();
  panel.render(true);
}
onLang(relabel);
watchTheme();

/* ---------- size ---------- */
function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
  hud.measureTop();
}
window.addEventListener('resize', resize);

/* ---------- frame loop ---------- */
const clock = new THREE.Clock();
let uiT = 0;
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  rig.update(dt);
  const busy = village.update(dt, t, rig.az);
  town.update(dt, t, busy);
  updateParticles(dt);
  updateCoins(dt);
  if (selected) {
    selRing.visible = true;
    selRing.position.set(selected.x, 0.06, selected.z);
    const s = 1 + Math.sin(t * 4) * 0.07;
    selRing.scale.set(s, s, s);
  } else selRing.visible = false;
  renderer.render(scene, rig.camera);

  const robots = village.list();
  if (robotsDirty) {
    robotsDirty = false;
    tags.sync(robots, selected?.id ?? null);
    hud.render();
  }
  tags.place(robots, rig);
  bankView.place(rig, town.bankLabel.x, town.bankLabel.y, town.bankLabel.z);
  uiT -= dt;
  if (panelDirty || (uiT <= 0 && (selected || bankView.open))) {
    uiT = 0.25;
    panelDirty = false;
    panel.render();
    bankView.render();
  }
  requestAnimationFrame(frame);
}

relabel();
resize();
void boot();
requestAnimationFrame(frame);
