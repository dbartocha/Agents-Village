/** Orthographic "diorama" camera with pan, zoom, 45° rotation, follow and click picking. */
import * as THREE from 'three';
import { clamp } from '../lib/util';

const HOME = new THREE.Vector3(0, 0, -0.6);
const MINZ = 0.55, MAXZ = 2.8, LIMIT = 13;

export class CameraRig {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  az = Math.PI / 4;
  azGoal = Math.PI / 4;
  readonly el = 0.64;
  zoom = 1;
  zoomGoal = 1;
  readonly target = HOME.clone();
  readonly goal = HOME.clone();
  /** When set, the camera keeps this point (a robot) in the middle. */
  follow: (() => { x: number; z: number } | null) | null = null;
  width = 1;
  height = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly v3 = new THREE.Vector3();

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    const aspect = w / h;
    const halfH = aspect < 1 ? Math.max(12.4, 9.8 / aspect) : Math.max(12.4, 17.2 / aspect);
    Object.assign(this.camera, { left: -halfH * aspect, right: halfH * aspect, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.az += (this.azGoal - this.az) * Math.min(1, dt * 5);
    this.zoom += (this.zoomGoal - this.zoom) * Math.min(1, dt * 8);
    const f = this.follow?.();
    if (f) this.goal.set(f.x, 0, f.z);
    this.target.lerp(this.goal, Math.min(1, dt * 4));
    const r = 80, c = this.camera;
    c.position.set(
      this.target.x + r * Math.cos(this.el) * Math.sin(this.az),
      this.target.y + r * Math.sin(this.el),
      this.target.z + r * Math.cos(this.el) * Math.cos(this.az),
    );
    c.lookAt(this.target);
    c.zoom = this.zoom;
    c.updateProjectionMatrix();
  }

  pan(dx: number, dy: number): void {
    const c = this.camera;
    const upp = (c.top - c.bottom) / c.zoom / this.height;
    const rx = Math.cos(this.az), rz = -Math.sin(this.az);
    const fx = -Math.sin(this.az), fz = -Math.cos(this.az);
    const k = 1 / Math.sin(this.el);
    const mx = -dx * upp * rx + dy * upp * k * fx, mz = -dx * upp * rz + dy * upp * k * fz;
    for (const v of [this.goal, this.target]) {
      v.x = clamp(v.x + mx, -LIMIT, LIMIT);
      v.z = clamp(v.z + mz, -LIMIT, LIMIT);
    }
  }

  zoomBy(f: number): void { this.zoomGoal = clamp(this.zoomGoal * f, MINZ, MAXZ); }
  rotate(steps: number): void { this.azGoal += (steps * Math.PI) / 4; }
  home(): void { this.goal.copy(HOME); this.zoomGoal = 1; this.follow = null; }
  focus(x: number, z: number): void { this.goal.set(x, 0, z); }

  /** First object hit under a screen point, from the given list. */
  pick(cx: number, cy: number, objects: THREE.Object3D[]): THREE.Object3D | null {
    this.ndc.set((cx / this.width) * 2 - 1, -(cy / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.intersectObjects(objects, false)[0]?.object ?? null;
  }

  /** Screen position of a point in the town. */
  toScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.v3.set(x, y, z).project(this.camera);
    return { x: ((this.v3.x + 1) / 2) * this.width, y: ((1 - this.v3.y) / 2) * this.height, visible: this.v3.z < 1 && this.v3.z > -1 };
  }
}

/** Mouse, touch and keyboard controls for the canvas. onClick gets screen coordinates of a tap. */
export function attachControls(canvas: HTMLCanvasElement, rig: CameraRig, handlers: {
  onClick: (x: number, y: number) => void;
  onHover: (x: number, y: number) => boolean;
  onUserMove: () => void;
}): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0, pinch: { d: number; z: number } | null = null, lastHover = 0;
  const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pointers.size === 2) pinch = { d: dist(), z: rig.zoomGoal };
  });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      const now = performance.now();
      if (now - lastHover > 70) { lastHover = now; canvas.classList.toggle('hover', handlers.onHover(e.clientX, e.clientY)); }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 5) { canvas.classList.add('drag'); rig.pan(dx, dy); handlers.onUserMove(); }
    } else if (pointers.size === 2 && pinch) {
      rig.zoomGoal = clamp((pinch.z * dist()) / pinch.d, MINZ, MAXZ);
      moved = 99;
    }
  });
  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    canvas.classList.remove('drag');
    if (e.type === 'pointerup' && moved <= 5 && pointers.size === 0) handlers.onClick(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); rig.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
}
