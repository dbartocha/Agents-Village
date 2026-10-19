/**
 * The square-headed robot: built from primitives, animated procedurally (walk, hammer, read, look up,
 * wave, charge, cheer, shake). Ported from the prototype.
 */
import * as THREE from 'three';
import type { StationId } from '../../../shared/src/index.ts';
import { ease } from '../lib/util';
import { basic, box, cyl, roundedBox, scene, sph, toon } from './kit';
import { burst } from './particles';

export type Phase = 'spawn' | 'walk' | 'work' | 'idle' | 'wait' | 'ask' | 'charge' | 'leave';

/** What the controller tells the mesh to show this frame. */
export interface PoseInput {
  phase: Phase;
  station?: StationId;
  carry: boolean;
  /** Turn finished normally (sleepy eyes) vs. parked for another reason. */
  sleepy: boolean;
  onPad: boolean;
  x: number;
  z: number;
  face: number;
  react: { kind: 'cheer' | 'shake'; t: number; dur: number } | null;
  /** Grows from 0 to 1 when the robot appears and shrinks when it leaves. */
  scale: number;
}

const RG = {
  head: roundedBox(0.56, 0.44, 0.44, 0.1),
  body: roundedBox(0.5, 0.44, 0.36, 0.11),
  foot: roundedBox(0.17, 0.09, 0.24, 0.04),
  screen: roundedBox(0.44, 0.29, 0.04, 0.018),
  eye: roundedBox(0.075, 0.115, 0.03, 0.012),
  chest: roundedBox(0.22, 0.13, 0.03, 0.012),
  leg: cyl(0.055, 0.055, 0.27, 12),
  arm: cyl(0.045, 0.045, 0.26, 12),
  hand: sph(0.075, 14, 10),
  joint: sph(0.065, 12, 8),
  neck: cyl(0.07, 0.07, 0.08, 14),
  ear: cyl(0.075, 0.075, 0.06, 16),
  stick: cyl(0.014, 0.014, 0.2, 6),
  bulb: sph(0.058, 14, 10),
  dot: sph(0.025, 8, 6),
  handle: cyl(0.026, 0.026, 0.38, 8),
  hhead: roundedBox(0.17, 0.11, 0.11, 0.03),
  tablet: roundedBox(0.32, 0.22, 0.03, 0.012),
  tscreen: new THREE.PlaneGeometry(0.27, 0.17),
  crate: roundedBox(0.4, 0.3, 0.32, 0.04),
  tape: box(0.41, 0.05, 0.325),
};
const MAT = {
  head: toon('#eef1f6'), limb: toon('#9aa3b5'), screen: toon('#1f2643'), eye: basic('#7ff3ff'), dark: toon('#3d4357'),
  steel: toon('#7d8597'), wood: toon('#a87850'), crate: toon('#d6a46a'), tape: toon('#b88446'), tscreen: basic('#8ff0ff'), chest: toon('#dfe8f5'),
};
const BULB = {
  wait: new THREE.Color('#ffd23f'), ask: new THREE.Color('#62b0ff'), charge: new THREE.Color('#5dffa0'),
  radar: new THREE.Color('#7fe8ff'), off: new THREE.Color('#3a3f52'),
};
const tmpC = new THREE.Color();

export class RobotMesh {
  readonly group = new THREE.Group();
  /** Meshes used for click picking; each carries userData.robotId. */
  readonly hits: THREE.Mesh[] = [];
  private readonly root = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly ant = new THREE.Group();
  private readonly hammer = new THREE.Group();
  private readonly tablet = new THREE.Group();
  private readonly crate = new THREE.Group();
  private readonly eyeL: THREE.Mesh;
  private readonly eyeR: THREE.Mesh;
  private readonly bulbM: THREE.MeshBasicMaterial;
  private readonly dotM = new THREE.MeshBasicMaterial({ color: 0xff6b6b });
  private readonly dot2 = new THREE.MeshBasicMaterial({ color: 0x5dffa0 });
  private readonly off = Math.random() * 10;
  private prevP = 0;
  private blinkT = 1 + Math.random() * 3;
  private blink = 0;

  readonly robotId: string;
  readonly color: string;

  constructor(robotId: string, color: string) {
    this.robotId = robotId;
    this.color = color;
    const g = this.group, root = this.root;
    g.add(root);
    const M = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.robotId = robotId;
      parent.add(m);
      this.hits.push(m);
      return m;
    };
    const body = toon(color);
    this.legL.position.set(0.12, 0.36, 0);
    this.legR.position.set(-0.12, 0.36, 0);
    root.add(this.legL, this.legR);
    for (const l of [this.legL, this.legR]) { M(RG.leg, MAT.limb, l, 0, -0.14, 0); M(RG.foot, MAT.dark, l, 0, -0.315, 0.035); }
    M(RG.body, body, root, 0, 0.6, 0);
    M(RG.chest, MAT.chest, root, 0, 0.62, 0.185);
    M(RG.dot, this.dotM, root, -0.05, 0.62, 0.2);
    M(RG.dot, this.dot2, root, 0.05, 0.62, 0.2);
    this.armL.position.set(0.31, 0.76, 0);
    this.armR.position.set(-0.31, 0.76, 0);
    root.add(this.armL, this.armR);
    for (const a of [this.armL, this.armR]) { M(RG.joint, MAT.limb, a); M(RG.arm, MAT.limb, a, 0, -0.14, 0); M(RG.hand, body, a, 0, -0.29, 0); }
    M(RG.neck, MAT.limb, root, 0, 0.86, 0);
    this.head.position.set(0, 0.88, 0);
    root.add(this.head);
    M(RG.head, MAT.head, this.head, 0, 0.24, 0);
    M(RG.screen, MAT.screen, this.head, 0, 0.23, 0.215);
    this.eyeL = M(RG.eye, MAT.eye, this.head, 0.095, 0.245, 0.24);
    this.eyeR = M(RG.eye, MAT.eye, this.head, -0.095, 0.245, 0.24);
    for (const x of [0.3, -0.3]) M(RG.ear, body, this.head, x, 0.24, 0).rotation.z = Math.PI / 2;
    this.ant.position.set(0, 0.46, 0);
    this.head.add(this.ant);
    M(RG.stick, MAT.limb, this.ant, 0, 0.1, 0);
    this.bulbM = new THREE.MeshBasicMaterial({ color });
    M(RG.bulb, this.bulbM, this.ant, 0, 0.22, 0);
    // props
    this.hammer.position.set(0, -0.3, 0);
    this.armR.add(this.hammer);
    const hh = new THREE.Mesh(RG.handle, MAT.wood); hh.rotation.x = Math.PI / 2; hh.position.z = 0.16; this.hammer.add(hh);
    const hd = new THREE.Mesh(RG.hhead, MAT.steel); hd.position.z = 0.35; this.hammer.add(hd);
    hh.castShadow = hd.castShadow = true;
    this.tablet.position.set(0, 0.64, 0.3);
    this.tablet.rotation.x = -1.15;
    root.add(this.tablet);
    this.tablet.add(new THREE.Mesh(RG.tablet, MAT.dark));
    const ts = new THREE.Mesh(RG.tscreen, MAT.tscreen); ts.position.z = 0.017; this.tablet.add(ts);
    this.crate.position.set(0, 0.62, 0.34);
    root.add(this.crate);
    const cm = new THREE.Mesh(RG.crate, MAT.crate); cm.castShadow = true; this.crate.add(cm);
    const tp = new THREE.Mesh(RG.tape, MAT.tape); tp.position.y = 0.13; this.crate.add(tp);
    this.hammer.visible = this.tablet.visible = this.crate.visible = false;
    scene.add(g);
  }

  dispose(): void {
    scene.remove(this.group);
  }

  /** Poses the robot for this frame. Ported from the prototype's animate(). */
  pose(s: PoseInput, t: number, dt: number): void {
    const { legL, legR, armL, armR, head, root, ant } = this;
    legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, 0); armR.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0); root.rotation.set(0, 0, 0); root.position.set(0, 0, 0); root.scale.set(1, 1, 1);
    ant.rotation.set(0, 0, 0);
    this.hammer.visible = this.crate.visible = this.tablet.visible = false;
    const tt = t + this.off;
    const working = s.phase === 'work' || s.phase === 'idle';
    const st = working ? s.station : undefined;
    let eyeY = 1, eyeOffY = 0, pulse = 0;
    let bulb: THREE.Color | null = null;

    if (s.phase === 'walk' || s.phase === 'leave' || s.phase === 'spawn') {
      const ph = tt * 10.5, sw = Math.sin(ph) * 0.62;
      legL.rotation.x = sw; legR.rotation.x = -sw;
      if (s.carry) { armL.rotation.x = armR.rotation.x = -1.35; armL.rotation.z = -0.18; armR.rotation.z = 0.18; this.crate.visible = true; }
      else { armL.rotation.x = -sw * 0.85; armR.rotation.x = sw * 0.85; }
      root.position.y = Math.abs(Math.cos(ph)) * 0.06;
      const sq = Math.cos(ph * 2) * 0.035;
      root.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
      root.rotation.z = Math.sin(ph) * 0.04;
      head.rotation.z = -Math.sin(ph) * 0.05;
      ant.rotation.x = -0.25 + Math.sin(ph * 2) * 0.12;
      ant.rotation.z = Math.sin(ph) * 0.18;
    } else if (s.phase === 'work' && (st === 'site' || st === 'forge')) {
      const p = (((tt * (st === 'forge' ? 1.45 : 1.2)) % 1) + 1) % 1;
      const up = p < 0.62 ? ease(p / 0.62) : 1 - Math.pow((p - 0.62) / 0.38, 2);
      armR.rotation.x = -0.45 - 2.15 * up;
      armL.rotation.x = -0.6; armL.rotation.z = -0.15;
      root.rotation.x = 0.1 - up * 0.08;
      root.scale.set(1, 1 - (1 - up) * 0.03, 1);
      head.rotation.x = 0.22;
      eyeOffY = -0.02;
      this.hammer.visible = true;
      ant.rotation.x = Math.sin(tt * 6) * 0.08 + (1 - up) * 0.15;
      if (p < this.prevP) {
        const fx = s.x + Math.sin(s.face) * 0.62, fz = s.z + Math.cos(s.face) * 0.62;
        if (st === 'forge') burst(fx, 0.6, fz, Math.random() < 0.5 ? '#ffb347' : '#ffe08a', 8, { speed: 2.6, up: 2.2, g: 9, life: 0.5, size: 0.04 });
        else burst(fx, 0.7, fz, '#fff1cc', 5, { speed: 1.6, up: 1.4, g: 6, life: 0.5, size: 0.05, lit: true });
      }
      this.prevP = p;
    } else if (s.phase === 'work' && (st === 'lib' || st === 'plaza')) {
      armL.rotation.x = armR.rotation.x = -1.05; armL.rotation.z = -0.32; armR.rotation.z = 0.32;
      head.rotation.x = 0.38 + Math.sin(tt * 1.2) * 0.05;
      head.rotation.y = Math.sin(tt * 0.7) * 0.12;
      eyeOffY = -0.025;
      this.tablet.visible = true;
      root.position.y = Math.sin(tt * 2) * 0.01;
      if (Math.random() < dt * 1.2) {
        const fx = s.x + Math.sin(s.face) * 0.35, fz = s.z + Math.cos(s.face) * 0.35;
        burst(fx, 0.95, fz, '#8ff0ff', 1, { speed: 0.3, up: 0.6, g: -0.2, life: 1.0, size: 0.035 });
      }
    } else if (s.phase === 'work' && st === 'tower') {
      armR.rotation.x = -2.3; armR.rotation.z = 0.55;
      head.rotation.x = -0.42; head.rotation.y = Math.sin(tt * 0.9) * 0.45;
      root.position.y = Math.abs(Math.sin(tt * 2.2)) * 0.02;
      bulb = BULB.radar; pulse = 0.5 + 0.5 * Math.sin(tt * 6);
      ant.rotation.z = Math.sin(tt * 3) * 0.1;
    } else if (s.phase === 'wait' || s.phase === 'ask') {
      const w = Math.sin(tt * 9);
      armR.rotation.z = -(2.5 + w * 0.38);
      armL.rotation.z = 0.12;
      root.position.y = Math.abs(Math.sin(tt * 4.5)) * 0.07;
      root.scale.set(1, 1 + Math.abs(Math.sin(tt * 4.5)) * 0.03, 1);
      head.rotation.x = -0.12; head.rotation.z = Math.sin(tt * 4.5) * 0.06;
      eyeY = 1.25;
      bulb = s.phase === 'ask' ? BULB.ask : BULB.wait;
      pulse = Math.sin(tt * 10) > 0 ? 1 : 0.15;
      ant.rotation.z = w * 0.15;
    } else if (s.phase === 'charge') {
      root.position.y = -0.035 + Math.sin(tt * 1.6) * 0.008;
      root.scale.set(1, 0.97, 1);
      legL.rotation.x = -0.18; legR.rotation.x = -0.18; root.rotation.x = 0.1;
      armL.rotation.z = 0.12; armR.rotation.z = -0.12; armL.rotation.x = armR.rotation.x = 0.1;
      head.rotation.x = 0.25 + Math.sin(tt * 1.1) * 0.04;
      eyeY = s.sleepy ? 0.22 : 0.5;
      bulb = BULB.charge; pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tt * 2.5));
    } else {
      // idle at a station, waiting for the next step
      root.position.y = Math.sin(tt * 2) * 0.012;
      armL.rotation.z = 0.06; armR.rotation.z = -0.06;
      head.rotation.y = Math.sin(tt * 0.6) * 0.25;
      ant.rotation.z = Math.sin(tt * 1.7) * 0.06;
    }

    if (s.react) {
      s.react.t += dt;
      const k = s.react.t;
      if (s.react.kind === 'cheer') {
        armR.rotation.set(0, 0, -2.75); armL.rotation.set(0, 0, 2.75);
        root.position.y = Math.abs(Math.sin(k * 9)) * 0.22;
        root.scale.set(1, 1 + Math.sin(k * 18) * 0.05, 1);
        eyeY = 0.4;
      } else {
        head.rotation.y = Math.sin(k * 24) * 0.45;
        armL.rotation.set(0, 0, 0.1); armR.rotation.set(0, 0, -0.1);
        eyeY = 0.7;
      }
      if (s.react.t >= s.react.dur) s.react = null;
    }

    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.13; this.blinkT = 2.5 + Math.random() * 3; }
    if (this.blink > 0) { this.blink -= dt; eyeY = Math.min(eyeY, 0.12); }
    this.eyeL.scale.set(1, eyeY, 1);
    this.eyeR.scale.set(1, eyeY, 1);
    this.eyeL.position.y = this.eyeR.position.y = 0.245 + eyeOffY;

    if (bulb) { tmpC.copy(BULB.off).lerp(bulb, pulse); this.bulbM.color.copy(tmpC); }
    else this.bulbM.color.set(this.color);
    this.dotM.color.set(Math.sin(tt * 3) > 0 ? 0xff6b6b : 0x5a2b2b);
    this.dot2.color.set(Math.sin(tt * 2.3 + 1) > 0 ? 0x5dffa0 : 0x1f4a33);

    this.group.scale.setScalar(Math.max(0.01, s.scale));
    this.group.position.set(s.x, s.phase === 'charge' && s.onPad ? 0.12 : 0, s.z);
    this.group.rotation.y = s.face;
  }
}
