/**
 * Rendering basics: renderer, scene, lights, cartoon (toon) materials and geometry helpers.
 * The look was tuned on three.js r128. To keep it on newer three.js we turn colour management off,
 * output linear colours and scale light intensities (physical light units arrived in r155).
 */
import * as THREE from 'three';
import { deg, pol } from '../lib/util';

THREE.ColorManagement.enabled = false;

/**
 * Converts the r128 light values used in this project to current three.js.
 * Ambient, hemisphere and directional lights only need ×π (r155+ dropped the hidden π factor).
 * Point lights also changed their falloff (r128: (1 - d/range)², now: 1/d^decay with a soft cut-off).
 * Decay 1 with ×2.8 matches the old lamp and forge light pools within a few percent over 1–5 units.
 */
export const LIGHT_SCALE = Math.PI;
export const POINT_SCALE = 2.8;
export const POINT_DECAY = 1;

export const scene = new THREE.Scene();

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

/* ---------- materials ---------- */
const gradData = new Uint8Array([125, 125, 125, 255, 195, 195, 195, 255, 255, 255, 255, 255]);
const grad = new THREE.DataTexture(gradData, 3, 1, THREE.RGBAFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.generateMipmaps = false;
grad.needsUpdate = true;

const toonCache = new Map<string, THREE.MeshToonMaterial>();
const basicCache = new Map<string, THREE.MeshBasicMaterial>();

/** Shared toon material for a colour. Do not mutate the result; use toonNew for per-object materials. */
export function toon(color: string): THREE.MeshToonMaterial {
  let m = toonCache.get(color);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: grad }); toonCache.set(color, m); }
  return m;
}
export function toonNew(color: string, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
}
export function basic(color: string): THREE.MeshBasicMaterial {
  let m = basicCache.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); basicCache.set(color, m); }
  return m;
}

/** Materials that change with day and night. */
export const winMat = toonNew('#3d4f7a', { emissive: 0x000000 });
export const lampMat = toonNew('#fff4cc', { emissive: 0x000000 });
export const fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
export const cloudMat = toonNew('#ffffff');

/* ---------- geometry helpers ---------- */
export interface MeshOpts { noCast?: boolean }
export function mesh(
  geo: THREE.BufferGeometry, mat: string | THREE.Material, x = 0, y = 0, z = 0,
  parent: THREE.Object3D = scene, opt: MeshOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? toon(mat) : mat);
  m.position.set(x, y, z);
  m.castShadow = !opt.noCast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export const cyl = (rt: number, rb: number, h: number, s = 28, open = false, ts = 0, tl = Math.PI * 2) =>
  new THREE.CylinderGeometry(rt, rb, h, s, 1, open, ts, tl);
export const sph = (r: number, w = 22, h = 16) => new THREE.SphereGeometry(r, w, h);
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** Box with soft rounded edges (extruded rounded rectangle with a bevel). */
export function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const iw = w - 2 * r, ih = h - 2 * r, cr = Math.min(iw, ih) * 0.3;
  const s = new THREE.Shape(), x = -iw / 2, y = -ih / 2;
  s.moveTo(x + cr, y); s.lineTo(x + iw - cr, y); s.quadraticCurveTo(x + iw, y, x + iw, y + cr);
  s.lineTo(x + iw, y + ih - cr); s.quadraticCurveTo(x + iw, y + ih, x + iw - cr, y + ih);
  s.lineTo(x + cr, y + ih); s.quadraticCurveTo(x, y + ih, x, y + ih - cr);
  s.lineTo(x, y + cr); s.quadraticCurveTo(x, y, x + cr, y);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(1e-3, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 5,
  });
  g.center();
  return g;
}

/** Group placed on a circle around the centre; its local +z faces the middle of town. */
export function ringGroup(r: number, phi: number): THREE.Group {
  const g = new THREE.Group();
  const p = pol(r, phi);
  g.position.set(p[0], 0, p[1]);
  g.rotation.y = deg(phi) + Math.PI;
  scene.add(g);
  return g;
}
export function localToWorld(g: THREE.Object3D, x: number, y: number, z: number): THREE.Vector3 {
  g.updateMatrixWorld(true);
  return new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
}

/* ---------- lights and theme ---------- */
export const hemi = new THREE.HemisphereLight(0xe8f2ff, 0x9db58c, 0.46 * LIGHT_SCALE);
export const ambient = new THREE.AmbientLight(0xffffff, 0.16 * LIGHT_SCALE);
export const sun = new THREE.DirectionalLight(0xfff7ec, 0.48 * LIGHT_SCALE);
sun.position.set(-12, 24, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
scene.add(hemi, ambient, sun, sun.target);

export const lampLights: THREE.PointLight[] = [];
export const theme = { night: false };

export function isDarkTheme(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Day or night lighting, following the page theme. Extra callbacks let other modules recolour things. */
const themeHooks: Array<(night: boolean) => void> = [];
export function onTheme(fn: (night: boolean) => void): void { themeHooks.push(fn); fn(theme.night); }
export function applyTheme(): void {
  const night = (theme.night = isDarkTheme());
  // Day: lit tops stay near 1.0 so colours don't clip; generous soft fill keeps shade light and pastel.
  hemi.intensity = (night ? 0.34 : 0.46) * LIGHT_SCALE;
  hemi.color.set(night ? 0x8fa6d9 : 0xe8f2ff);
  hemi.groundColor.set(night ? 0x1b2838 : 0x9db58c);
  sun.intensity = (night ? 0.38 : 0.48) * LIGHT_SCALE;
  sun.color.set(night ? 0x9fb6ec : 0xfff7ec);
  ambient.intensity = (night ? 0.14 : 0.16) * LIGHT_SCALE;
  winMat.emissive.set(night ? 0xffbf55 : 0x000000);
  lampMat.emissive.set(night ? 0xffd27a : 0x2a2210);
  for (const l of lampLights) l.intensity = night ? 1.1 * POINT_SCALE : 0;
  cloudMat.color.set(night ? 0x8d9bbd : 0xffffff);
  // Lifts clouds and smoke back to white under the warmer, dimmer day light.
  cloudMat.emissive.set(night ? 0x000000 : 0x0c0e12);
  for (const fn of themeHooks) fn(night);
}
export function watchTheme(): void {
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}
