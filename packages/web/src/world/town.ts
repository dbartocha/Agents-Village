/**
 * Builds the round town once and animates its moving parts (crane, radar, forge fire, fountain,
 * chimney smoke, trees, clouds, charging pads, the growing tower on the construction site).
 * Geometry and colours are ported 1:1 from prototype/agent-village-prototype.html.
 */
import * as THREE from 'three';
import { R, angDiff, deg, dist2, pol, reduceMotion, rnd, rpick } from '../lib/util';
import {
  POINT_DECAY, POINT_SCALE, basic, box, cloudMat, cyl, fireMat, lampLights, lampMat, localToWorld, mesh, ringGroup, roundedBox,
  scene, sph, theme, toon, toonNew, winMat,
} from './kit';
import { FACTORY, ISLAND_R, STATIONS } from './layout';
import { burst } from './particles';

/** What the town needs to know each frame to animate stations. */
export interface Busy { forge: number; tower: number; site: number }

const FLOORS = 7;
const SEGS = FLOORS * 4;

export interface Town {
  /** Adds n pieces to the tower on the construction site. */
  grow(n: number): void;
  update(dt: number, t: number, busy: Busy): void;
  /** Called when a tower is finished. */
  onTowerDone?: () => void;
}

export function buildTown(): Town {
  const CHIMNEYS: THREE.Vector3[] = [];
  const crowns: Array<{ c: THREE.Group; off: number }> = [];

  /* ---------- island ---------- */
  mesh(cyl(ISLAND_R, ISLAND_R, 0.6, 96), '#94d36c', 0, -0.3, 0, scene, { noCast: true });
  const lip = mesh(new THREE.TorusGeometry(ISLAND_R, 0.32, 10, 96), '#83c25c', 0, -0.3, 0, scene, { noCast: true });
  lip.rotation.x = Math.PI / 2;
  mesh(cyl(ISLAND_R + 0.05, ISLAND_R - 0.6, 1.1, 96), '#b98457', 0, -1.15, 0, scene, { noCast: true });
  const under = mesh(new THREE.ConeGeometry(ISLAND_R - 0.6, 7.5, 96, 1), '#9a6b47', 0, -5.45, 0, scene, { noCast: true });
  under.rotation.x = Math.PI;
  for (const r of [[-6, -4.5, 7, 1], [8, -5.5, -5, 0.8], [2, -7.5, 3, 0.6], [-9, -3.2, -8, 0.7]]) {
    const m = mesh(new THREE.DodecahedronGeometry(r[3]), '#8a8f9c', r[0], r[1], r[2], scene, { noCast: true });
    m.rotation.set(R() * 3, R() * 3, 0);
  }

  /* ---------- plaza, ring road, spokes, pads ---------- */
  mesh(cyl(3.6, 3.6, 0.06, 72), '#e6d4ae', 0, 0.03, 0, scene, { noCast: true });
  const flatRing = (inner: number, outer: number, color: string, y: number) => {
    const m = mesh(new THREE.RingGeometry(inner, outer, 96), color, 0, y, 0, scene, { noCast: true });
    m.rotation.x = -Math.PI / 2;
  };
  flatRing(2.4, 2.6, '#d3bd92', 0.065);
  flatRing(4.75, 6.05, '#f2e4c2', 0.025);
  flatRing(6.05, 6.2, '#dcc9a0', 0.028);
  const spokeAngles = [STATIONS.lib.phi, STATIONS.site.phi, STATIONS.tower.phi, STATIONS.forge.phi, STATIONS.charge.phi, FACTORY.phi];
  for (const phi of spokeAngles) {
    const L = 3.2, p = pol(6 + L / 2, phi);
    const m = mesh(new THREE.PlaneGeometry(1.25, L), '#f2e4c2', p[0], 0.026, p[1], scene, { noCast: true });
    m.rotation.order = 'YXZ';
    m.rotation.set(-Math.PI / 2, deg(phi), 0);
  }
  const pads: Array<[keyof typeof STATIONS, number, string]> = [['site', 3.1, '#e2c493'], ['forge', 2.9, '#d9cfc2'], ['charge', 3.4, '#d8efe9'], ['lib', 2.9, '#ece4f8'], ['tower', 2.6, '#dfe5ee']];
  for (const [id, r, c] of pads) {
    const p = STATIONS[id].center;
    mesh(cyl(r, r, 0.05, 64), c, p[0], 0.03, p[1], scene, { noCast: true });
  }

  /* ---------- fountain ---------- */
  mesh(cyl(1.75, 1.85, 0.45, 48), '#d8ccb6', 0, 0.225, 0);
  mesh(cyl(1.5, 1.5, 0.06, 48), '#8fd3f4', 0, 0.44, 0, scene, { noCast: true });
  mesh(cyl(0.22, 0.3, 1.1, 20), '#d8ccb6', 0, 0.95, 0);
  mesh(cyl(0.75, 0.32, 0.28, 32), '#e4d9c4', 0, 1.55, 0);
  mesh(cyl(0.62, 0.62, 0.04, 32), '#8fd3f4', 0, 1.68, 0, scene, { noCast: true });
  mesh(sph(0.14, 14, 10), '#e4d9c4', 0, 1.82, 0);

  /* ---------- library ---------- */
  {
    const g = ringGroup(STATIONS.lib.bR, STATIONS.lib.phi);
    mesh(cyl(2.2, 2.3, 0.3, 48), '#f1ecfb', 0, 0.15, 0, g);
    mesh(cyl(1.95, 1.95, 2.2, 48), '#b9a6ea', 0, 1.4, 0, g);
    mesh(cyl(2.08, 2.08, 0.2, 48), '#f6f2ff', 0, 2.58, 0, g);
    mesh(new THREE.SphereGeometry(1.95, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), '#7c5cd6', 0, 2.66, 0, g);
    mesh(cyl(0.06, 0.06, 0.5, 8), '#ffd25e', 0, 4.8, 0, g);
    mesh(sph(0.17, 16, 12), '#ffd25e', 0, 5.1, 0, g);
    mesh(roundedBox(0.82, 1.15, 0.25, 0.08), '#4b3a7a', 0, 0.87, 1.9, g);
    const arch = mesh(cyl(0.41, 0.41, 0.25, 20, false, 0, Math.PI), '#4b3a7a', 0, 1.42, 1.9, g);
    arch.rotation.order = 'ZYX';
    arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    for (const a of [-100, -50, 50, 100, 150, 210]) {
      const w = mesh(roundedBox(0.34, 0.62, 0.1, 0.06), winMat, Math.sin(deg(a)) * 1.95, 1.62, Math.cos(deg(a)) * 1.95, g);
      w.rotation.y = deg(a);
    }
    mesh(cyl(1.0, 1.05, 0.12, 32), '#f1ecfb', 0, 0.06, 2.45, g);
  }

  /* ---------- construction site: crane and a tower that grows ---------- */
  const siteG = ringGroup(STATIONS.site.bR, STATIONS.site.phi);
  const crane = (() => {
    const cx = 2.3, cz = -1.3;
    mesh(roundedBox(1.1, 0.3, 1.1, 0.08), '#6f7787', cx, 0.15, cz, siteG);
    mesh(box(0.34, 7.2, 0.34), '#ffc23d', cx, 3.6, cz, siteG);
    for (let y = 0.8; y < 7; y += 0.9) mesh(box(0.36, 0.06, 0.36), '#e0a419', cx, y, cz, siteG, { noCast: true });
    const jib = new THREE.Group();
    jib.position.set(cx, 7.25, cz);
    siteG.add(jib);
    mesh(box(5.6, 0.26, 0.3), '#ffc23d', 1.4, 0, 0, jib);
    mesh(box(0.7, 0.5, 0.55), '#6f7787', -1.2, -0.12, 0, jib);
    mesh(roundedBox(0.62, 0.55, 0.62, 0.1), '#ff7a59', 0.2, -0.42, 0, jib);
    const base = Math.atan2(cz, -cx);
    const dist = Math.hypot(cx, cz);
    const cable = mesh(box(0.03, 1, 0.03), '#3d4357', dist, -0.5, 0, jib, { noCast: true });
    const hook = new THREE.Group();
    jib.add(hook);
    mesh(box(0.18, 0.12, 0.18), '#3d4357', 0, 0, 0, hook);
    const block = mesh(roundedBox(0.5, 0.38, 0.5, 0.06), '#ffe9c2', 0, -0.3, 0, hook);
    jib.rotation.y = base;
    for (const p of [[-1.9, 1.9], [1.6, 2.2]]) mesh(roundedBox(0.5, 0.5, 0.5, 0.05), '#d6a46a', p[0], 0.25, p[1], siteG);
    mesh(roundedBox(0.5, 0.5, 0.5, 0.05), '#d6a46a', -1.9, 0.75, 1.9, siteG);
    mesh(new THREE.ConeGeometry(0.18, 0.5, 16), '#ff8a3d', -2.3, 0.25, 0.6, siteG);
    return { jib, hook, cable, block, base, dist };
  })();

  const SEG_WALL = cyl(1.5, 1.5, 0.44, 16, false, 0, Math.PI / 2);
  const SEG_WIN = cyl(1.53, 1.53, 0.15, 16, true, 0, Math.PI / 2);
  const tower = { i: 0, items: [] as THREE.Group[], doneT: 0, clearT: 0 };
  const townApi: Town = { grow, update };

  function grow(n: number, instant = false): void {
    for (let k = 0; k < n && tower.i <= SEGS && !tower.clearT; k++) {
      const g = new THREE.Group();
      if (tower.i < SEGS) {
        const fl = Math.floor(tower.i / 4), q = tower.i % 4;
        const w = new THREE.Mesh(SEG_WALL, toon(fl % 2 ? '#fff3dc' : '#ffe6bd'));
        w.castShadow = w.receiveShadow = true;
        g.add(w);
        const win = new THREE.Mesh(SEG_WIN, winMat);
        win.position.y = 0.05;
        g.add(win);
        g.position.set(0, 0.08 + fl * 0.46 + 0.22, 0);
        g.rotation.y = (q * Math.PI) / 2;
      } else {
        const c = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.3, 32), toon('#ff6b6b'));
        c.castShadow = true;
        g.add(c);
        const pole = new THREE.Mesh(cyl(0.03, 0.03, 0.8, 6), toon('#3d4357'));
        pole.position.y = 1;
        g.add(pole);
        const flag = new THREE.Mesh(box(0.42, 0.26, 0.02), basic('#ffc23d'));
        flag.position.set(0.22, 1.25, 0);
        g.add(flag);
        g.position.set(0, 0.08 + FLOORS * 0.46 + 0.65, 0);
      }
      g.userData.pop = instant ? 1 : 0;
      g.scale.setScalar(instant ? 1 : 0.01);
      siteG.add(g);
      tower.items.push(g);
      tower.i++;
    }
    if (tower.i > SEGS && !tower.doneT && !tower.clearT) {
      tower.doneT = 6;
      const p = localToWorld(siteG, 0, 4.4, 0);
      for (const c of ['#ff6b6b', '#ffc23d', '#4d8dff', '#2fbf8f', '#9b6bff']) burst(p.x, p.y, p.z, c, 8, { speed: 4, up: 3.5, g: 6, life: 1.4, size: 0.09, shape: 'box' });
      townApi.onTowerDone?.();
    }
  }
  const towerHeight = () => 0.08 + Math.min(FLOORS, Math.ceil(tower.i / 4)) * 0.46;
  function updateTower(dt: number): void {
    for (const g of tower.items) {
      const pop = g.userData.pop as number;
      if (pop < 1) {
        const p = Math.min(1, pop + dt * 2.8);
        g.userData.pop = p;
        const s = 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2), w = Math.min(1, p * 1.6);
        g.scale.set(Math.max(0.01, w), Math.max(0.01, s), Math.max(0.01, w));
      }
    }
    if (tower.doneT) { tower.doneT -= dt; if (tower.doneT <= 0) { tower.doneT = 0; tower.clearT = 0.8; } }
    if (tower.clearT) {
      tower.clearT -= dt;
      const s = Math.max(0.01, tower.clearT / 0.8);
      for (const g of tower.items) g.scale.setScalar(s);
      if (tower.clearT <= 0) {
        tower.clearT = 0;
        for (const g of tower.items) siteG.remove(g);
        tower.items = [];
        tower.i = 0;
        grow(8);
      }
    }
  }

  /* ---------- forge ---------- */
  const forgeG = ringGroup(STATIONS.forge.bR, STATIONS.forge.phi);
  {
    mesh(roundedBox(3.3, 2.1, 2.5, 0.25), '#e8875c', 0, 1.05, 0, forgeG);
    const roof = mesh(cyl(1.38, 1.38, 3.5, 28, false, 0, Math.PI), '#9c4f3d', 0, 2.05, 0, forgeG);
    roof.rotation.set(0, 0, Math.PI / 2);
    const fw = mesh(cyl(0.55, 0.55, 0.12, 32), fireMat, -0.65, 1.0, 1.24, forgeG, { noCast: true });
    fw.rotation.x = Math.PI / 2;
    mesh(new THREE.TorusGeometry(0.6, 0.09, 10, 32), '#5a3326', -0.65, 1.0, 1.27, forgeG);
    mesh(roundedBox(0.72, 1.3, 0.12, 0.06), '#5a3326', 0.85, 0.65, 1.25, forgeG);
    mesh(cyl(0.3, 0.36, 2.0, 20), '#b85a3e', -1.0, 2.9, -0.5, forgeG);
    mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 20), '#8c4433', -1.0, 3.9, -0.5, forgeG).rotation.x = Math.PI / 2;
    CHIMNEYS.push(localToWorld(forgeG, -1.0, 4.05, -0.5));
  }
  for (const d of [-8, 8]) {
    const p = pol(9.05, STATIONS.forge.phi + d);
    const a = new THREE.Group();
    a.position.set(p[0], 0, p[1]);
    a.rotation.y = deg(STATIONS.forge.phi + d) + Math.PI / 2;
    scene.add(a);
    mesh(cyl(0.17, 0.26, 0.36, 14), '#4a4f5c', 0, 0.18, 0, a);
    mesh(roundedBox(0.72, 0.18, 0.34, 0.05), '#5d6372', 0, 0.45, 0, a);
    const horn = mesh(new THREE.ConeGeometry(0.11, 0.3, 12), '#5d6372', 0.48, 0.45, 0, a);
    horn.rotation.z = -Math.PI / 2;
  }
  const forgeLight = new THREE.PointLight(0xff8a2a, 0.8 * POINT_SCALE, 7, POINT_DECAY);
  forgeLight.position.copy(localToWorld(forgeG, -0.65, 1.0, 2.0));
  scene.add(forgeLight);

  /* ---------- radar tower ---------- */
  const towerG = ringGroup(STATIONS.tower.bR, STATIONS.tower.phi);
  const radar = (() => {
    mesh(cyl(1.3, 1.5, 0.5, 36), '#c9d3e0', 0, 0.25, 0, towerG);
    mesh(cyl(0.55, 0.95, 5.6, 36), '#f4f6fa', 0, 3.3, 0, towerG);
    const rAt = (h: number) => 0.95 - (0.4 * (h - 0.5)) / 5.6;
    for (const h of [2.1, 4.3]) mesh(cyl(rAt(h + 0.16) + 0.02, rAt(h - 0.16) + 0.02, 0.32, 36), '#ff6b6b', 0, h, 0, towerG);
    mesh(roundedBox(0.5, 0.9, 0.12, 0.08), '#4a5675', 0, 0.95, rAt(0.95) + 0.02, towerG);
    mesh(cyl(1.05, 1.05, 0.2, 36), '#c9d3e0', 0, 6.2, 0, towerG);
    const rail = mesh(new THREE.TorusGeometry(1.0, 0.04, 8, 40), '#8f9bb0', 0, 6.6, 0, towerG);
    rail.rotation.x = Math.PI / 2;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      mesh(cyl(0.025, 0.025, 0.4, 6), '#8f9bb0', Math.sin(a), 6.4, Math.cos(a), towerG, { noCast: true });
    }
    const head = new THREE.Group();
    head.position.set(0, 6.3, 0);
    towerG.add(head);
    mesh(cyl(0.08, 0.1, 0.6, 12), '#8f9bb0', 0, 0.3, 0, head);
    const dishG = new THREE.Group();
    dishG.position.set(0, 0.75, 0);
    dishG.rotation.x = -0.45;
    head.add(dishG);
    const dish = mesh(new THREE.SphereGeometry(0.9, 30, 14, 0, Math.PI * 2, 0, 1.0), toonNew('#e9eef7', { side: THREE.DoubleSide }), 0, 0, 0.55, dishG);
    dish.rotation.x = -Math.PI / 2;
    const feed = mesh(cyl(0.025, 0.025, 0.75, 8), '#8f9bb0', 0, 0, 0.15, dishG);
    feed.rotation.x = Math.PI / 2;
    mesh(sph(0.07, 10, 8), '#ff6b6b', 0, 0, 0.5, dishG);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
    const light = new THREE.Mesh(sph(0.1, 12, 10), lightMat);
    light.position.set(0, 0.65, 0);
    head.add(light);
    const ringGeo = new THREE.TorusGeometry(1, 0.035, 6, 48);
    const rings = Array.from({ length: 4 }, () => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      scene.add(m);
      return { m, t: 1 };
    });
    return { head, lightMat, rings, ringT: 0, pos: localToWorld(towerG, 0, 7.1, 0) };
  })();

  /* ---------- charging station ---------- */
  const padFx = STATIONS.charge.slots.map((s, i) => {
    mesh(cyl(0.52, 0.58, 0.12, 32), '#2d3550', s.x, 0.06, s.z, scene, { noCast: true });
    const ringM = new THREE.MeshBasicMaterial({ color: 0x3a6b5a });
    const ring = mesh(new THREE.TorusGeometry(0.43, 0.045, 8, 32), ringM, s.x, 0.13, s.z, scene, { noCast: true });
    ring.rotation.x = Math.PI / 2;
    const back = pol(10.75, STATIONS.charge.phi + [-21, -7, 7, 21][i]);
    const post = new THREE.Group();
    post.position.set(back[0], 0, back[1]);
    post.rotation.y = Math.atan2(s.x - back[0], s.z - back[1]);
    scene.add(post);
    mesh(roundedBox(0.42, 1.15, 0.3, 0.1), '#3cc0b0', 0, 0.58, 0, post);
    mesh(roundedBox(0.3, 0.2, 0.04, 0.015), '#1f2643', 0, 0.88, 0.16, post);
    const bar = mesh(box(0.24, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0x5dffa0 }), 0, 0.88, 0.19, post, { noCast: true });
    const cord = mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 16, Math.PI), '#2d3550', 0.23, 0.4, 0, post);
    cord.rotation.z = Math.PI / 2;
    return { slot: s, ringM, bar, t: 0 };
  });

  /* ---------- factory ---------- */
  const factoryG = ringGroup(FACTORY.bR, FACTORY.phi);
  const gear = new THREE.Group();
  {
    mesh(roundedBox(3.7, 2.0, 2.7, 0.2), '#9fb6d8', 0, 1.0, 0, factoryG);
    const tri = new THREE.Shape();
    tri.moveTo(0, 0); tri.lineTo(1.2, 0); tri.lineTo(0, 0.75); tri.lineTo(0, 0);
    const prism = new THREE.ExtrudeGeometry(tri, { depth: 2.6, bevelEnabled: false });
    prism.translate(-0.6, 0, -1.3);
    for (const x of [-1.2, 0, 1.2]) mesh(prism, '#ffc23d', x, 2.0, 0, factoryG);
    mesh(roundedBox(1.3, 1.25, 0.14, 0.08), '#3b4766', 0, 0.63, 1.36, factoryG);
    for (let k = 0; k < 5; k++) mesh(box(0.24, 0.1, 0.02), k % 2 ? '#2d3550' : '#ffc23d', -0.52 + k * 0.26, 1.35, 1.44, factoryG, { noCast: true });
    gear.position.set(-1.25, 1.25, 1.38);
    factoryG.add(gear);
    mesh(cyl(0.32, 0.32, 0.1, 20), '#ffc23d', 0, 0, 0, gear).rotation.x = Math.PI / 2;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const tooth = mesh(box(0.12, 0.14, 0.1), '#ffc23d', Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0, gear);
      tooth.rotation.z = a;
    }
    mesh(cyl(0.09, 0.09, 0.12, 12), '#3b4766', 0, 0, 0.02, gear).rotation.x = Math.PI / 2;
    mesh(roundedBox(0.5, 0.45, 0.08, 0.06), winMat, 1.25, 1.25, 1.38, factoryG);
    mesh(cyl(0.24, 0.3, 1.6, 18), '#8c99ad', 1.25, 2.6, -0.7, factoryG);
    CHIMNEYS.push(localToWorld(factoryG, 1.25, 3.45, -0.7));
  }

  /* ---------- huts, trees, bushes, lamps, flowers ---------- */
  const hut = (phi: number, r: number, roofC: string, chimney: boolean) => {
    const g = ringGroup(r, phi);
    mesh(cyl(0.92, 0.98, 1.15, 28), '#fff1d8', 0, 0.58, 0, g);
    mesh(new THREE.ConeGeometry(1.2, 1.0, 28), roofC, 0, 1.65, 0, g);
    mesh(roundedBox(0.42, 0.66, 0.1, 0.06), '#7a5134', 0, 0.36, 0.93, g);
    const w = mesh(cyl(0.15, 0.15, 0.08, 18), winMat, 0.52, 0.75, 0.78, g);
    w.rotation.order = 'YXZ';
    w.rotation.set(Math.PI / 2, 0.58, 0);
    if (chimney) {
      mesh(cyl(0.12, 0.14, 0.6, 10), '#b85a3e', 0.45, 1.95, -0.2, g);
      CHIMNEYS.push(localToWorld(g, 0.45, 2.3, -0.2));
    }
  };
  hut(75, 12.7, '#4d8dff', true);
  hut(195, 12.9, '#2fbf8f', false);
  hut(315, 12.7, '#ff7a59', true);
  hut(132, 13.3, '#9b6bff', false);

  const tree = (phi: number, r: number, s: number, kind: 'round' | 'pine') => {
    const p = pol(r, phi);
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[1]);
    scene.add(g);
    mesh(cyl(0.11 * s, 0.15 * s, 0.9 * s, 10), '#8a5a3b', 0, 0.45 * s, 0, g);
    const c = new THREE.Group();
    c.position.y = 0.85 * s;
    g.add(c);
    if (kind === 'pine') {
      for (const k of [[0.85, 1.0, 0.3], [0.65, 0.85, 0.85], [0.42, 0.7, 1.35]]) mesh(new THREE.ConeGeometry(k[0] * s, k[1] * s, 18), '#3f9e5a', 0, k[2] * s, 0, c);
    } else {
      const col = rpick(['#5cbf5a', '#6fcd5e', '#4fae55']);
      mesh(sph(0.8 * s, 20, 14), col, 0, 0.55 * s, 0, c);
      mesh(sph(0.55 * s, 18, 12), col, 0.45 * s, 0.35 * s, 0.2 * s, c);
      mesh(sph(0.5 * s, 18, 12), col, -0.4 * s, 0.4 * s, -0.15 * s, c);
    }
    crowns.push({ c, off: R() * 6 });
  };
  const trees: Array<[number, number, number, 'round' | 'pine']> = [
    [15, 12.2, 1.1, 'round'], [145, 11.8, 1.0, 'pine'], [255, 12.4, 1.15, 'round'], [300, 13.4, 0.9, 'pine'],
    [207, 11.3, 0.85, 'round'], [160, 13.6, 0.9, 'round'], [240, 13.6, 1.0, 'pine'], [350, 13.6, 0.9, 'round'],
    [95, 13.8, 0.8, 'pine'], [5, 13.9, 0.8, 'pine'],
  ];
  for (const t of trees) tree(...t);

  const bush = (x: number, z: number, s: number) => {
    const c = rpick(['#57b85a', '#64c460', '#4aa652']);
    mesh(sph(0.38 * s, 14, 10), c, x, 0.22 * s, z);
    mesh(sph(0.3 * s, 14, 10), c, x + 0.3 * s, 0.18 * s, z + 0.1 * s);
  };
  for (const b of [[30, 13.6], [38, 14.1], [52, 14.0], [60, 13.5], [22, 14.2], [68, 14.2], [115, 13.9], [175, 14.2], [215, 14.1], [330, 14.2]]) {
    const p = pol(b[1], b[0]);
    bush(p[0], p[1], 1 + R() * 0.4);
  }

  for (const phi of spokeAngles) {
    const p = pol(6.75, phi + 30);
    mesh(cyl(0.05, 0.07, 1.7, 10), '#3d4357', p[0], 0.85, p[1]);
    mesh(sph(0.17, 16, 12), lampMat, p[0], 1.8, p[1], scene, { noCast: true });
    mesh(cyl(0.12, 0.16, 0.08, 12), '#3d4357', p[0], 1.98, p[1]);
    const l = new THREE.PointLight(0xffd27a, 0, 6, POINT_DECAY);
    l.position.set(p[0], 1.8, p[1]);
    scene.add(l);
    lampLights.push(l);
  }

  {
    const flowerGeo = sph(0.075, 8, 6);
    const centers = [...Object.values(STATIONS).filter(s => s.id !== 'plaza').map(s => s.center), FACTORY.center];
    const d = new THREE.Object3D();
    for (const c of ['#ff6b6b', '#ffd23f', '#ffffff', '#b388eb', '#ff8fab', '#ff9f43']) {
      const list: Array<[number, number]> = [];
      for (let k = 0; k < 80 && list.length < 16; k++) {
        const r = rnd(7.4, 14.3), ph = rnd(0, 360), p = pol(r, ph);
        if (centers.some(cc => dist2(p[0], p[1], cc[0], cc[1]) < 3.4)) continue;
        if (spokeAngles.some(a => Math.abs(angDiff(deg(ph), deg(a))) * r < 1.1)) continue;
        list.push(p);
      }
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(flowerGeo, basic(c), list.length);
      list.forEach((p, i) => { d.position.set(p[0], 0.1, p[1]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
      im.frustumCulled = false;
      scene.add(im);
    }
  }

  /* ---------- clouds ---------- */
  const clouds = Array.from({ length: 7 }, (_, i) => {
    const g = new THREE.Group();
    const n = 3 + Math.floor(R() * 3);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(sph(0.9 + R() * 0.9, 16, 12), cloudMat);
      m.position.set(j * 1.2 - n * 0.6, R() * 0.4, (R() - 0.5) * 1.0);
      g.add(m);
    }
    scene.add(g);
    return { g, ang: (i / 7) * Math.PI * 2 + R() * 0.4, rad: 21 + R() * 6, y: -9 + R() * 5, spd: 0.012 + R() * 0.01 };
  });

  /* ---------- animation ---------- */
  let smokeT = 0, fountainT = 0;
  function update(dt: number, t: number, busy: Busy): void {
    // forge
    forgeLight.intensity = ((theme.night ? 1.2 : 0.55) + busy.forge * 0.7 + Math.sin(t * 17) * 0.08 + Math.sin(t * 7.3) * 0.1) * POINT_SCALE;
    fireMat.color.setHSL(0.07 + Math.sin(t * 9) * 0.012, 1, 0.55 + busy.forge * 0.04);
    // radar
    radar.head.rotation.y += dt * (busy.tower ? 2.6 : 0.5);
    radar.lightMat.color.set(Math.sin(t * 4) > 0.6 ? 0xff4d4d : 0x5a1f1f);
    radar.ringT -= dt;
    if (busy.tower && radar.ringT <= 0) {
      radar.ringT = 0.7;
      const r = radar.rings.find(x => x.t >= 1);
      if (r) { r.t = 0; r.m.visible = true; r.m.position.copy(radar.pos); }
    }
    for (const r of radar.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt * 0.7);
      const s = 0.6 + r.t * 4.2;
      r.m.scale.set(s, s, s);
      (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - r.t) * 0.75;
      if (r.t >= 1) r.m.visible = false;
    }
    // crane
    const targetJib = crane.base + (busy.site ? Math.sin(t * 0.55) * 0.45 : Math.sin(t * 0.18) * 0.18);
    crane.jib.rotation.y += (targetJib - crane.jib.rotation.y) * Math.min(1, dt * 2);
    const hookY = Math.max(towerHeight() + 1.2, 1.6) - 7.25 + (busy.site ? Math.sin(t * 1.1) * 0.45 : 0);
    const trolley = crane.dist + Math.sin(t * 0.4) * 0.15;
    crane.hook.position.set(trolley, hookY, 0);
    crane.hook.rotation.z = Math.sin(t * 1.3) * 0.05;
    crane.cable.position.set(trolley, hookY / 2, 0);
    crane.cable.scale.y = Math.max(0.05, -hookY);
    crane.block.visible = busy.site > 0;
    updateTower(dt);
    // factory
    gear.rotation.z += dt * 0.8;
    // charging pads
    for (const p of padFx) {
      const occ = !!p.slot.occ && (p.slot.occ as { charging?: boolean }).charging === true;
      p.t = occ ? (p.t + dt * 0.08) % 1 : 0;
      p.ringM.color.set(occ ? (Math.sin(t * 3) > -0.3 ? 0x5dffa0 : 0x2f8a5a) : 0x3a6b5a);
      p.bar.scale.x = occ ? 0.25 + p.t * 0.75 : 0.08;
      p.bar.position.x = (p.bar.scale.x - 1) * 0.12;
    }
    // fountain
    fountainT -= dt;
    if (fountainT <= 0) { fountainT = reduceMotion ? 0.3 : 0.07; burst(0, 1.85, 0, '#9fdcff', 1, { speed: 1.2, up: 2.1, g: 5.5, life: 0.85, size: 0.05 }); }
    // trees
    for (const c of crowns) { c.c.rotation.z = Math.sin(t * 1.1 + c.off) * 0.035; c.c.rotation.x = Math.cos(t * 0.9 + c.off) * 0.025; }
    // smoke
    smokeT -= dt;
    if (smokeT <= 0) {
      smokeT = reduceMotion ? 1.6 : 0.5;
      CHIMNEYS.forEach((c, i) => {
        if (i === 0 || Math.random() < 0.55) burst(c.x, c.y, c.z, theme.night ? '#7d8597' : '#e6e6e6', 1, { speed: 0.22, up: 0.65, g: -0.05, life: i === 0 && busy.forge ? 3 : 2.4, size: 0.26, smoke: true, lit: true });
      });
    }
    // clouds
    for (const c of clouds) {
      c.ang += c.spd * dt;
      c.g.position.set(Math.cos(c.ang) * c.rad, c.y + Math.sin(t * 0.3 + c.ang) * 0.3, Math.sin(c.ang) * c.rad);
      c.g.rotation.y = -c.ang;
    }
  }

  grow(13, true);
  return townApi;
}
