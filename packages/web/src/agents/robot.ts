/**
 * One robot = one agent session. Turns the stream of activities into something watchable:
 * steps are queued as "beats", quick steps at the same station merge, each beat is shown for a
 * minimum time (shorter when the queue grows), and permissions or questions jump the queue.
 * See readme.adoc → "The town (web)" → Pacing.
 */
import { QUESTION_TOOLS } from '../../../shared/src/index.ts';
import type { Activity, SessionInfo, StationId, Text } from '../../../shared/src/index.ts';
import { angDiff, clamp } from '../lib/util';
import { FACTORY_PLACE, acquire, buildPath, release } from '../world/layout';
import type { Place, Slot } from '../world/layout';
import { RobotMesh } from '../world/robot';
import type { Phase, PoseInput } from '../world/robot';

export interface Beat {
  station: StationId;
  tool?: string;
  target?: Text;
  count: number;
  think?: boolean;
}

/** One line in the robot's log: a real activity, or a chat line (demo messages). */
export type LogEntry =
  | { kind: 'activity'; a: Activity }
  | { kind: 'say'; who: 'you' | 'robot'; text: Text; at: number };

export type PopKind = 'ok' | 'no' | '';

export interface RobotEvents {
  /** A beat at the construction site finished; grow the tower by this many pieces. */
  onBuild: (pieces: number) => void;
  /** The robot walked into the factory and can be removed. */
  onGone: (robot: Robot) => void;
  /** Short speech pop above the robot (an i18n key). */
  onPop: (robot: Robot, key: string, kind: PopKind) => void;
}

type Attention = 'wait' | 'ask';

const BASE_SPEED = 2.3;
const SPAWN_TIME = 0.7;
const LEAVE_TIME = 0.6;
const LOG_LIMIT = 80;
const WORK_BEAT = 1.7;
const THINK_BEAT = 1.2;

export class Robot implements PoseInput {
  readonly id: string;
  readonly mesh: RobotMesh;
  readonly color: string;
  session: SessionInfo;
  log: LogEntry[] = [];
  task?: Text;

  // PoseInput
  phase: Phase = 'spawn';
  station?: StationId;
  carry = false;
  sleepy = true;
  onPad = false;
  x = 0;
  z = 0;
  face = 0;
  react: PoseInput['react'] = null;
  scale = 1;

  // pacing and movement
  queue: Beat[] = [];
  beat: Beat | null = null;
  timer = 0;
  dur = 1;
  leaving = false;
  attn: Attention | null = null;
  private readonly events: RobotEvents;
  private path: Array<[number, number]> = [];
  private slot: Slot | null = null;
  private faceGoal = 0;
  private onArrive: (() => void) | null = null;
  private pendingStop = false;
  private lastStation?: StationId;
  private spawnT = 0;
  private leaveT = 0;
  private idleT = 0;
  private atFactory = false;

  constructor(session: SessionInfo, color: string, events: RobotEvents) {
    this.id = session.id;
    this.session = session;
    this.color = color;
    this.events = events;
    this.task = session.prompt;
    this.mesh = new RobotMesh(session.id, color, session.provider ?? 'claude');
  }

  get name(): string { return this.session.name; }
  get f(): boolean { return this.session.f; }
  /** Read by the charging pads to light up. */
  get charging(): boolean { return this.phase === 'charge'; }
  /** Walking to the charger after a finished turn. */
  get homeBound(): boolean { return this.phase === 'walk' && this.station === 'charge'; }
  get progress(): number { return this.phase === 'work' && this.dur > 0 ? clamp(1 - this.timer / this.dur, 0, 1) : 0; }

  /* ---------- placement ---------- */

  /** A new robot rolling out of the factory door. */
  spawnAtFactory(): void {
    this.x = FACTORY_PLACE.x;
    this.z = FACTORY_PLACE.z;
    this.face = this.faceGoal = Math.atan2(-this.x, -this.z);
    this.atFactory = true;
    this.phase = 'spawn';
    this.spawnT = SPAWN_TIME;
    this.scale = 0.01;
    this.attn = attentionOf(this.session);
  }

  /** Puts the robot straight where its session says it is (first snapshot, no walking). */
  placeFromSession(s: SessionInfo): void {
    this.session = s;
    this.task = s.prompt;
    this.scale = 1;
    this.attn = attentionOf(s);
    const st: StationId = s.status === 'idle' ? 'charge' : s.status === 'thinking' ? 'plaza' : (s.currentTool?.station ?? 'plaza');
    release(this.slot, this);
    this.slot = acquire(st, this);
    this.station = st;
    this.x = this.slot.x;
    this.z = this.slot.z;
    this.face = this.faceGoal = this.slot.face;
    this.onPad = !!this.slot.pad;
    this.atFactory = false;
    if (this.attn) { this.phase = this.attn; return; }
    if (s.status === 'idle') { this.phase = 'charge'; this.sleepy = true; return; }
    this.sleepy = false;
    this.beat = s.status === 'thinking'
      ? { station: 'plaza', think: true, count: 1 }
      : { station: st, tool: s.currentTool?.tool, target: s.currentTool?.target, count: 1 };
    this.startWork();
    this.timer = this.dur * (0.3 + 0.7 * Math.random());
  }

  /* ---------- input from the source ---------- */

  onActivity(a: Activity, s: SessionInfo): void {
    this.session = s;
    this.addLog({ kind: 'activity', a });
    if (this.leaving) return;
    switch (a.kind) {
      case 'prompt':
        this.task = a.text;
        this.react = { kind: 'cheer', t: 0, dur: 0.8 };
        this.pendingStop = false;
        this.sleepy = false;
        this.enqueue({ station: 'plaza', think: true, count: 1 });
        break;
      case 'tool':
        if (a.tool && QUESTION_TOOLS.has(a.tool)) break;
        this.sleepy = false;
        this.enqueue({ station: a.station ?? 'plaza', tool: a.tool, target: a.target, count: 1 });
        break;
      case 'tool_failed':
        this.react = { kind: 'shake', t: 0, dur: 0.8 };
        break;
      case 'permission_resolved':
        if (a.resolution === 'allow') { this.react = { kind: 'cheer', t: 0, dur: 0.9 }; this.events.onPop(this, 'popThanks', 'ok'); }
        else if (a.resolution === 'deny') { this.react = { kind: 'shake', t: 0, dur: 0.9 }; this.events.onPop(this, 'popOther', 'no'); }
        break;
      case 'stop':
        this.pendingStop = true;
        this.sleepy = true;
        break;
      case 'session_end':
        this.leave();
        return;
      default:
        break;
    }
    this.syncAttention();
    this.kick();
  }

  /** Brings the robot in line with a fresh picture of its session (snapshot after a reconnect). */
  sync(s: SessionInfo): void {
    this.session = s;
    this.task = s.prompt ?? this.task;
    if (s.status === 'ended') { this.leave(); return; }
    if (s.status === 'idle') this.pendingStop = true;
    this.syncAttention();
    this.kick();
  }

  /** Adds a log line, keeping the log in time order (seeded demo lines can arrive late). */
  addLog(e: LogEntry): void {
    const at = entryTime(e);
    let i = this.log.length;
    while (i > 0 && entryTime(this.log[i - 1]) > at) i--;
    this.log.splice(i, 0, e);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  /** Little jump of joy (demo: a message was answered). */
  cheer(): void { this.react = { kind: 'cheer', t: 0, dur: 0.7 }; }

  /* ---------- beats ---------- */

  private enqueue(b: Beat): void {
    const last = this.queue[this.queue.length - 1];
    if (last && last.station === b.station && !b.think && !last.think) {
      last.count += 1;
      last.tool = b.tool ?? last.tool;
      last.target = b.target ?? last.target;
      return;
    }
    if (!last && this.beat && this.phase === 'work' && this.beat.station === b.station && !b.think) {
      // Same station as the step on screen: keep working there instead of queueing a new visit.
      this.beat.count += 1;
      this.beat.tool = b.tool ?? this.beat.tool;
      this.beat.target = b.target ?? this.beat.target;
      this.beat.think = false;
      this.timer = Math.max(this.timer, this.beatDuration() * 0.6);
      return;
    }
    if (last && last.think && b.think) return;
    this.queue.push(b);
  }

  private beatDuration(): number {
    const base = this.beat?.think ? THINK_BEAT : WORK_BEAT;
    return clamp(base - this.queue.length * 0.22, 0.5, base);
  }

  private speed(): number {
    return BASE_SPEED * (1 + Math.min(1.6, this.queue.length * 0.3)) * (this.carry ? 0.85 : 1);
  }

  /** Starts the next thing to do if the robot is free. */
  private kick(): void {
    if (this.leaving) return;
    if (this.phase === 'spawn' || this.phase === 'walk' || this.phase === 'work' || this.phase === 'wait' || this.phase === 'ask') return;
    this.next();
  }

  private next(): void {
    if (this.leaving || this.phase === 'spawn') return;
    if (this.attn) { this.goToAttention(); return; }
    if (this.queue.length) {
      const b = this.queue.shift()!;
      while (this.queue[0] && this.queue[0].station === b.station && !this.queue[0].think && !b.think) {
        const m = this.queue.shift()!;
        b.count += m.count;
        b.tool = m.tool ?? b.tool;
        b.target = m.target ?? b.target;
      }
      this.beat = b;
      if (this.isAt(b.station)) { this.startWork(); return; }
      const carry = this.lastStation === 'lib' && b.station === 'site';
      this.travelTo(b.station, () => this.startWork(), carry);
      return;
    }
    const s = this.session;
    if (s.status === 'working' && s.currentTool && !QUESTION_TOOLS.has(s.currentTool.tool)) {
      this.queue.push({ station: s.currentTool.station, tool: s.currentTool.tool, target: s.currentTool.target, count: 1 });
      this.next();
      return;
    }
    if (this.pendingStop || s.status === 'idle') { this.goCharge(); return; }
    this.phase = 'idle';
    this.idleT = 0;
  }

  private startWork(): void {
    this.carry = false;
    this.phase = 'work';
    this.dur = this.timer = this.beatDuration();
  }

  /** True while the real agent is still doing what this beat shows (a long command, long thinking). */
  private beatStillLive(b: Beat): boolean {
    const s = this.session;
    if (b.think) return s.status === 'thinking';
    return s.status === 'working' && s.currentTool?.station === b.station;
  }

  private finishBeat(): void {
    const b = this.beat;
    this.beat = null;
    if (b) {
      if (b.station === 'site' && !b.think) this.events.onBuild(Math.min(4, b.count));
      if (!b.think) this.lastStation = b.station;
    }
    this.next();
  }

  private goCharge(): void {
    const done = () => {
      this.phase = 'charge';
      if (this.pendingStop) this.events.onPop(this, 'popDone', 'ok');
      this.pendingStop = false;
    };
    if (this.isAt('charge')) { done(); return; }
    this.travelTo('charge', done);
  }

  /* ---------- attention (permission or question) ---------- */

  private syncAttention(): void {
    const want = attentionOf(this.session);
    if (want === this.attn) return;
    this.attn = want;
    if (want) {
      // Steps still in the queue already happened; skip them so the wave is not late.
      for (const b of this.queue) if (b.station === 'site' && !b.think) this.events.onBuild(Math.min(4, b.count));
      this.queue = [];
      if (this.phase === 'work' || this.phase === 'idle' || this.phase === 'charge' || this.phase === 'walk') this.goToAttention();
    } else if (this.phase === 'wait' || this.phase === 'ask') {
      this.phase = 'idle';
      this.next();
    }
  }

  private goToAttention(): void {
    const target: StationId = this.session.currentTool?.station ?? this.station ?? 'plaza';
    this.beat = null;
    const arrive = () => {
      if (this.attn) { this.phase = this.attn; this.carry = false; }
      else { this.phase = 'idle'; this.next(); }
    };
    if (this.phase === 'walk' && this.station === target) { this.onArrive = arrive; return; }
    if (this.isAt(target)) { arrive(); return; }
    this.travelTo(target, arrive, this.carry);
  }

  /* ---------- leaving ---------- */

  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.queue = [];
    this.beat = null;
    this.attn = null;
    this.carry = false;
    if (this.spawnT > 0 || this.atFactory) {
      // Never really left the factory: just fade out at the door.
      this.spawnT = 0;
      this.phase = 'leave';
      this.leaveT = LEAVE_TIME;
      return;
    }
    const from = this.place();
    release(this.slot, this);
    this.slot = null;
    this.path = buildPath(from, FACTORY_PLACE, false);
    this.phase = 'leave';
    this.onArrive = () => { this.leaveT = LEAVE_TIME; };
    if (!this.path.length) this.arrive();
  }

  /* ---------- movement ---------- */

  private isAt(id: StationId): boolean {
    return this.station === id && !!this.slot && !this.slot.extra && !this.atFactory && this.phase !== 'walk';
  }

  private place(): Place {
    if (this.atFactory || !this.slot) return { x: this.x, z: this.z, ringPhi: FACTORY_PLACE.ringPhi, entry: FACTORY_PLACE.entry };
    return { x: this.x, z: this.z, ringPhi: this.slot.ringPhi, entry: this.slot.entry };
  }

  private travelTo(id: StationId, then: () => void, carry = false): void {
    const from = this.place();
    const same = !this.atFactory && this.station === id && this.phase !== 'walk';
    release(this.slot, this);
    const slot = acquire(id, this);
    this.path = buildPath(from, { x: slot.x, z: slot.z, ringPhi: slot.ringPhi, entry: slot.entry }, same);
    this.slot = slot;
    this.station = id;
    this.onPad = !!slot.pad;
    this.atFactory = false;
    this.carry = carry;
    this.phase = 'walk';
    this.onArrive = then;
    if (!this.path.length) this.arrive();
  }

  private arrive(): void {
    if (this.slot) this.faceGoal = this.slot.face;
    const f = this.onArrive;
    this.onArrive = null;
    f?.();
  }

  /** Advances the robot by dt seconds. camAz lets a waving robot turn to the viewer. */
  update(dt: number, camAz: number): void {
    if (this.spawnT > 0) {
      this.spawnT = Math.max(0, this.spawnT - dt);
      const k = 1 - this.spawnT / SPAWN_TIME;
      this.scale = Math.max(0.01, 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2));
      if (this.spawnT === 0) {
        this.scale = 1;
        this.phase = 'idle';
        if (!this.queue.length && this.session.status === 'thinking') this.enqueue({ station: 'plaza', think: true, count: 1 });
        this.next();
      }
      return;
    }
    if (this.leaveT > 0) {
      this.leaveT = Math.max(0, this.leaveT - dt);
      this.scale = Math.max(0.01, this.leaveT / LEAVE_TIME);
      if (this.leaveT === 0) this.events.onGone(this);
      return;
    }
    switch (this.phase) {
      case 'walk':
      case 'leave': {
        const tgt = this.path[0];
        if (!tgt) break;
        const dx = tgt[0] - this.x, dz = tgt[1] - this.z, d = Math.hypot(dx, dz), step = this.speed() * dt;
        if (d > 0.001) this.faceGoal = Math.atan2(dx, dz);
        if (d <= step) { this.x = tgt[0]; this.z = tgt[1]; this.path.shift(); }
        else { this.x += (dx / d) * step; this.z += (dz / d) * step; }
        if (!this.path.length) this.arrive();
        break;
      }
      case 'work':
        if (this.slot) this.faceGoal = this.slot.face;
        this.timer -= dt;
        if (this.timer <= 0) {
          if (!this.queue.length && this.beat && this.beatStillLive(this.beat)) {
            if (this.beat.station === 'site' && !this.beat.think) this.events.onBuild(1);
            this.dur = this.timer = this.beatDuration();
          } else {
            this.finishBeat();
          }
        }
        break;
      case 'wait':
      case 'ask':
        this.faceGoal = camAz;
        break;
      case 'idle':
        if (this.slot) this.faceGoal = this.slot.face;
        this.idleT += dt;
        if (this.session.status === 'thinking' && this.idleT > (this.station === 'plaza' ? 0.3 : 2.5)) {
          this.enqueue({ station: 'plaza', think: true, count: 1 });
          this.next();
        } else if ((this.session.status === 'idle' || this.session.status === 'working') && this.idleT > 0.5) {
          this.next();
        }
        break;
      case 'charge':
        if (this.slot) this.faceGoal = this.slot.face;
        break;
      default:
        break;
    }
    this.face += angDiff(this.faceGoal, this.face) * Math.min(1, dt * 8);
  }

  pose(t: number, dt: number): void {
    this.mesh.pose(this, t, dt);
  }

  dispose(): void {
    release(this.slot, this);
    this.slot = null;
    this.mesh.dispose();
  }
}

export const entryTime = (e: LogEntry): number => (e.kind === 'activity' ? e.a.at : e.at);

function attentionOf(s: SessionInfo): Attention | null {
  return s.status === 'waiting' ? 'wait' : s.status === 'asking' ? 'ask' : null;
}
