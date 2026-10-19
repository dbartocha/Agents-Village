/** Tiny pooled particle system: sparks, wood chips, smoke, fountain water, confetti. */
import * as THREE from 'three';
import { reduceMotion } from '../lib/util';
import { basic, box, scene, sph, toon } from './kit';

export interface BurstOptions {
  speed?: number;
  up?: number;
  g?: number;
  life?: number;
  size?: number;
  spread?: number;
  /** Lit (toon) material instead of a flat glowing one. */
  lit?: boolean;
  /** Grows and fades like smoke. */
  smoke?: boolean;
  shape?: 'sph' | 'box';
}

interface Particle {
  m: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; max: number; g: number; size: number; smoke: boolean; shape: 'sph' | 'box';
}

const MAX = 450;
const geo = { sph: sph(1, 8, 6), box: box(1, 1, 1) };
const live: Particle[] = [];
const pool: Record<'sph' | 'box', THREE.Mesh[]> = { sph: [], box: [] };

export function burst(x: number, y: number, z: number, color: string, n: number, o: BurstOptions = {}): void {
  if (reduceMotion) n = Math.ceil(n / 3);
  const shape = o.shape ?? 'sph';
  for (let i = 0; i < n && live.length < MAX; i++) {
    const m = pool[shape].pop() ?? new THREE.Mesh(geo[shape]);
    m.material = o.lit ? toon(color) : basic(color);
    const sp = o.speed ?? 1.6;
    const spread = o.spread ?? 0.1;
    m.position.set(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    const life = (o.life ?? 0.6) * (0.7 + Math.random() * 0.6);
    const size = o.size ?? 0.06;
    m.scale.setScalar(size);
    scene.add(m);
    live.push({
      m, shape, size, life, max: life, g: o.g ?? 7, smoke: !!o.smoke,
      vx: (Math.random() - 0.5) * sp, vy: (o.up ?? 1.5) + Math.random() * sp * 0.5, vz: (Math.random() - 0.5) * sp,
    });
  }
}

export function updateParticles(dt: number): void {
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.m);
      live.splice(i, 1);
      pool[p.shape].push(p.m);
      continue;
    }
    p.m.position.x += p.vx * dt;
    p.m.position.y += p.vy * dt;
    p.m.position.z += p.vz * dt;
    p.vy -= p.g * dt;
    if (p.shape === 'box') { p.m.rotation.x += dt * 6; p.m.rotation.y += dt * 5; }
    const k = p.life / p.max;
    if (p.smoke) p.m.scale.setScalar(p.size * (1 + (1 - k) * 1.8) * Math.min(1, k * 3));
    else p.m.scale.setScalar(p.size * Math.min(1, k * 2.5));
  }
}
