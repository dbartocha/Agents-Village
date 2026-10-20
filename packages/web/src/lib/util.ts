/** Small helpers used across the town. */

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded random for scenery, so the town looks the same on every load. */
export const R = mulberry32(19102026);
export const rnd = (a: number, b: number) => a + (b - a) * Math.random();
export const rint = (a: number, b: number) => Math.floor(rnd(a, b + 1));
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const rpick = <T>(arr: readonly T[]): T => arr[Math.floor(R() * arr.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const deg = (d: number) => (d * Math.PI) / 180;
/** Point on a circle around the town centre. phi in degrees, 0 = +z. Returns [x, z]. */
export const pol = (r: number, phi: number): [number, number] => [Math.sin(deg(phi)) * r, Math.cos(deg(phi)) * r];
export const dist2 = (x1: number, z1: number, x2: number, z2: number) => Math.hypot(x1 - x2, z1 - z2);
export function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};
/** Snap the label's top-left corner after centering, so text stays on physical pixels. */
export function placeScreenLabel(el: HTMLElement, x: number, y: number): void {
  const { width, height } = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const left = Math.round((x - width / 2) * dpr) / dpr;
  const top = Math.round((y - height) * dpr) / dpr;
  el.style.transform = `translate(${left}px,${top}px)`;
}
export const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
