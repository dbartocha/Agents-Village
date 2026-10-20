/** Gold coins that fly from the bank to a robot when it "earns" tokens. */
import * as THREE from 'three';
import { reduceMotion } from '../lib/util';
import { cyl, scene, toon } from './kit';

interface Coin {
  m: THREE.Mesh;
  from: THREE.Vector3;
  to: () => { x: number; y: number; z: number } | null;
  t: number;
  delay: number;
  dur: number;
  spin: number;
  last?: () => void;
}

const GEO = cyl(0.22, 0.22, 0.06, 20);
const MAT = toon('#ffc93d');
const pool: THREE.Mesh[] = [];
const flying: Coin[] = [];
const FLIGHT = 1.2;

/**
 * Sends n coins along an arc from `from` to wherever `to()` is when they land (the robot may walk).
 * `done` runs once, when the last coin arrives (or at once when the target is gone).
 */
export function flyCoins(from: THREE.Vector3, to: Coin['to'], n: number, done?: () => void): void {
  if (reduceMotion) n = Math.min(n, 3);
  for (let i = 0; i < n; i++) {
    const m = pool.pop() ?? new THREE.Mesh(GEO, MAT);
    m.castShadow = false;
    m.visible = false;
    scene.add(m);
    flying.push({
      m, to, from: from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6)),
      t: 0, delay: i * 0.07, dur: FLIGHT * (0.9 + Math.random() * 0.2), spin: 6 + Math.random() * 6,
      last: i === n - 1 ? done : undefined,
    });
  }
}

export function updateCoins(dt: number): void {
  for (let i = flying.length - 1; i >= 0; i--) {
    const c = flying[i];
    if (c.delay > 0) { c.delay -= dt; continue; }
    const target = c.to();
    c.t += dt / c.dur;
    if (!target || c.t >= 1) {
      scene.remove(c.m);
      pool.push(c.m);
      flying.splice(i, 1);
      c.last?.();
      continue;
    }
    const k = c.t, e = 1 - Math.pow(1 - k, 2);
    const dist = Math.hypot(target.x - c.from.x, target.z - c.from.z);
    c.m.visible = true;
    c.m.position.set(
      c.from.x + (target.x - c.from.x) * e,
      c.from.y + (target.y - c.from.y) * e + Math.sin(Math.PI * k) * (1.6 + dist * 0.18),
      c.from.z + (target.z - c.from.z) * e,
    );
    c.m.rotation.set(Math.PI / 2, 0, c.t * c.spin * Math.PI);
    c.m.scale.setScalar(Math.min(1, k * 6) * (1 - Math.max(0, k - 0.9) * 6));
  }
}
