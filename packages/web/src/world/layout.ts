/**
 * Map of the round town: where stations stand, where robots stand at them, and how robots walk
 * (along spokes to the ring road, around the ring, out along another spoke).
 */
import type { StationId } from '../../../shared/src/index.ts';
import { deg, dist2, pol, rnd } from '../lib/util';

export const RING_R = 5.4;
export const ENTRY_R = 7.3;
export const ISLAND_R = 15;
export const PLAZA_SLOT_R = 2.6;

export interface Slot {
  x: number;
  z: number;
  /** Facing angle (radians, 0 = +z) while working here. */
  face: number;
  /** Angle on the ring road (degrees) used to reach this slot. */
  ringPhi: number;
  /** Point where the robot leaves the ring road for this slot. */
  entry: [number, number];
  occ: unknown | null;
  pad?: boolean;
  extra?: boolean;
  station: StationId;
}

export interface Station {
  id: StationId;
  phi: number;
  bR: number;
  entry: [number, number];
  center: [number, number];
  slots: Slot[];
}

function slotAt(station: StationId, r: number, phi: number, ringPhi: number, look?: [number, number]): Slot {
  const p = pol(r, phi);
  return {
    x: p[0], z: p[1],
    face: look ? Math.atan2(look[0] - p[0], look[1] - p[1]) : deg(phi) + Math.PI,
    ringPhi, entry: pol(ENTRY_R, ringPhi), occ: null, station,
  };
}

function station(id: StationId, phi: number, bR: number): Station {
  return { id, phi, bR, entry: pol(ENTRY_R, phi), center: pol(bR, phi), slots: [] };
}

export const STATIONS: Record<StationId, Station> = {
  lib: station('lib', 345, 10.6),
  site: station('site', 285, 10.3),
  tower: station('tower', 225, 10.8),
  forge: station('forge', 165, 10.6),
  charge: station('charge', 45, 10.0),
  plaza: station('plaza', 0, 0),
};
export const FACTORY = { phi: 105, bR: 10.9, entry: pol(ENTRY_R, 105), door: pol(9.35, 105), center: pol(10.9, 105) };

{
  const S = STATIONS;
  S.lib.slots = [-10, 0, 10].map(d => slotAt('lib', 8.4, S.lib.phi + d, S.lib.phi, S.lib.center));
  S.site.slots = [-12, 0, 12].map(d => slotAt('site', 8.25, S.site.phi + d, S.site.phi, S.site.center))
    .concat([15, -15].map(d => slotAt('site', 10.3, S.site.phi + d, S.site.phi, S.site.center)));
  S.forge.slots = [-8, 8].map(d => slotAt('forge', 8.15, S.forge.phi + d, S.forge.phi, pol(9.05, S.forge.phi + d)));
  S.tower.slots = [-10, 0, 10].map(d => slotAt('tower', 8.4, S.tower.phi + d, S.tower.phi, S.tower.center));
  S.charge.slots = [-21, -7, 7, 21].map(d => ({ ...slotAt('charge', 9.75, S.charge.phi + d, S.charge.phi), pad: true }));
  // Plaza: around the fountain, facing it. Each slot is reached from the ring at its own angle.
  S.plaza.slots = [20, 80, 140, 200, 260, 320].map(a => {
    const s = slotAt('plaza', PLAZA_SLOT_R, a, a, [0, 0]);
    s.entry = pol(RING_R, a);
    return s;
  });
}

/** Station ids that have a building (used for decoration and spokes). */
export const BUILT_STATIONS: StationId[] = ['lib', 'site', 'tower', 'forge', 'charge'];

export function release(slot: Slot | null | undefined, owner: unknown): void {
  if (slot && slot.occ === owner) slot.occ = null;
}

/** Takes a free slot at a station; when all are taken, makes an extra spot next to it. */
export function acquire(id: StationId, owner: unknown): Slot {
  const st = STATIONS[id];
  let sl = st.slots.find(s => !s.occ);
  if (!sl) {
    const side = Math.random() < 0.5 ? -1 : 1;
    if (id === 'plaza') {
      const a = rnd(0, 360);
      sl = slotAt('plaza', PLAZA_SLOT_R + rnd(0.5, 0.9), a, a, [0, 0]);
      sl.entry = pol(RING_R, a);
    } else if (id === 'charge') {
      sl = slotAt('charge', rnd(8.6, 9.4), st.phi + side * rnd(29, 36), st.phi);
    } else {
      sl = slotAt(id, rnd(7.9, 8.7), st.phi + side * rnd(16, 22), st.phi, st.center);
    }
    sl.extra = true;
  }
  sl.occ = owner;
  return sl;
}

/** Points along the ring road from one angle to another, the short way round. */
export function ringArc(fromPhi: number, toPhi: number): Array<[number, number]> {
  const d = ((((toPhi - fromPhi) % 360) + 540) % 360) - 180;
  const n = Math.max(1, Math.ceil(Math.abs(d) / 12));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) pts.push(pol(RING_R, fromPhi + (d * i) / n));
  return pts;
}

export interface Place { x: number; z: number; ringPhi: number; entry: [number, number] }

/** Full walking path between two places in town. */
export function buildPath(from: Place, to: Place, sameStation: boolean): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (!sameStation) {
    pts.push(from.entry, ...ringArc(from.ringPhi, to.ringPhi), to.entry);
  }
  pts.push([to.x, to.z]);
  return pts.filter((p, i, arr) => (i === 0 ? dist2(p[0], p[1], from.x, from.z) > 0.15 : dist2(p[0], p[1], arr[i - 1][0], arr[i - 1][1]) > 0.15));
}

export const FACTORY_PLACE: Place = { x: FACTORY.door[0], z: FACTORY.door[1], ringPhi: FACTORY.phi, entry: FACTORY.entry };
