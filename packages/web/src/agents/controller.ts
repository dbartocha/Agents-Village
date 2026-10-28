/**
 * Keeps one Robot per session and feeds it the messages from the active source (live server or demo).
 * Also tells the town which stations are busy and keeps the short event feed.
 */
import type { Activity, AgentKind, Bank, ServerMessage, SessionInfo, Text } from '../../../shared/src/index.ts';
import { payoutPeriod } from '../../../shared/src/index.ts';
import type { Mesh } from 'three';
import type { Busy, Town } from '../world/town';
import { clearCoins, flyCoins } from '../world/coins';
import { burst } from '../world/particles';
import { Robot } from './robot';
import type { PopKind } from './robot';

/**
 * Robot colours by agent family: warm for Claude Code, cool for GitHub Copilot.
 * The first colour of each family is its signature colour (legend, panel badge).
 */
export const AGENT_COLORS: Record<AgentKind, string[]> = {
  claude: ['#e8794a', '#ffbf2e', '#ff6b5b', '#ff9a3d', '#e85d75', '#b08968', '#ff7eb6'],
  copilot: ['#4d8dff', '#9b6bff', '#38c6d9', '#6f7cff', '#2fbf8f', '#c77dff', '#00b3a4'],
};

export const agentOf = (s: SessionInfo): AgentKind => s.provider ?? 'claude';

/** One line in the "recent events" feed. `key` is an i18n key for system lines. */
export type FeedItem =
  | { kind: 'activity'; robotId: string; a: Activity; fresh: boolean }
  | { kind: 'system'; key: string; fresh: boolean };

export interface VillageEvents {
  /** Something about this robot changed (undefined: the list of robots changed). */
  changed(robot?: Robot): void;
  feed(items: FeedItem[]): void;
  pop(robot: Robot, key: string, kind: PopKind): void;
  /** The coins of an 'earned' activity reached the robot. */
  paid(robot: Robot, payout: Activity): void;
  /** The bank changed (snapshot or a 'bank' message). */
  bank(bank: Bank): void;
}

/** Activities worth a line in the feed (tool_done and friends would flood it). */
const FEED_KINDS = new Set<Activity['kind']>([
  'session_start', 'prompt', 'tool', 'tool_failed', 'permission', 'attention', 'permission_resolved', 'stop', 'session_end', 'earned',
]);

export class Village {
  readonly robots = new Map<string, Robot>();
  approvals = false;
  bank: Bank = {};
  private feedItems: FeedItem[] = [];
  private readonly colorIdx: Record<AgentKind, number> = { claude: 0, copilot: 0 };
  private readonly pendingPayouts = new Map<Robot, Activity>();
  private readonly payoutsInFlight = new Set<Robot>();
  private readonly payoutPeriods = new Map<Robot, { startedAt: number; period: number }>();
  private background = false;

  private readonly town: Town;
  private readonly events: VillageEvents;

  constructor(town: Town, events: VillageEvents) {
    this.town = town;
    this.events = events;
  }

  setBackground(hidden: boolean): void {
    this.background = hidden;
    this.reconcile();
  }

  /** Animation is expendable; after a suspended frame loop show current state, not old tool visits. */
  reconcile(): void {
    clearCoins();
    this.pendingPayouts.clear();
    this.payoutsInFlight.clear();
    for (const r of this.list()) {
      if (r.session.status === 'ended' || r.leaving) this.remove(r);
      else { r.sync(r.session); this.resetPayoutPeriod(r); }
    }
    this.events.changed();
  }

  /** Applies one message from a source. The first snapshot places robots without walking. */
  apply(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        clearCoins();
        this.pendingPayouts.clear();
        this.payoutsInFlight.clear();
        const snap = msg.snapshot;
        this.approvals = snap.approvals;
        this.bank = snap.bank ?? {};
        this.events.bank(this.bank);
        const ids = new Set(snap.sessions.map(s => s.id));
        for (const r of [...this.robots.values()]) if (!ids.has(r.id)) this.remove(r);
        for (const s of snap.sessions) {
          const known = this.robots.get(s.id);
          if (s.status === 'ended') { if (known) this.remove(known); continue; }
          if (known) {
            known.sync(s);
            known.log = known.log.filter(entry => entry.kind === 'say');
            for (const a of snap.recent) if (a.sessionId === s.id) known.addLog({ kind: 'activity', a });
            this.pendingPayouts.delete(known);
            this.resetPayoutPeriod(known);
            continue;
          }
          const r = this.add(s);
          r.placeFromSession(s);
          for (const a of snap.recent) if (a.sessionId === s.id) r.addLog({ kind: 'activity', a });
        }
        this.feedItems = [];
        for (const a of snap.recent) {
          if (this.robots.has(a.sessionId) && FEED_KINDS.has(a.kind) && !(a.kind === 'attention' && a.attention === 'idle')) {
            this.pushFeed({ kind: 'activity', robotId: a.sessionId, a, fresh: false });
          }
        }
        this.events.feed(this.feedItems);
        this.events.changed();
        break;
      }
      case 'activity': {
        const { activity: a, session: s } = msg;
        let r = this.robots.get(s.id);
        if (!r) {
          if (s.status === 'ended') break;
          r = this.add(s);
          if (this.background) r.placeFromSession(s);
          else {
            r.spawnAtFactory();
            burst(r.x, 0.5, r.z, '#ffffff', 16, { speed: 2.2, up: 1.0, g: 0.6, life: 1.0, size: 0.16, lit: true, spread: 0.6, smoke: true });
          }
          this.events.changed();
        }
        if (this.background) {
          r.session = s;
          r.addLog({ kind: 'activity', a });
          if (s.status === 'ended') this.remove(r);
          this.events.changed(r);
          break;
        }
        r.onActivity(a, s);
        if (a.kind === 'earned' && (a.tokens || a.nanoAic)) {
          const previous = this.pendingPayouts.get(r);
          this.pendingPayouts.set(r, {
            ...a,
            ...(a.nanoAic !== undefined
              ? { nanoAic: (previous?.nanoAic ?? 0) + a.nanoAic }
              : { tokens: (previous?.tokens ?? 0) + (a.tokens ?? 0) }),
          });
        }
        if (FEED_KINDS.has(a.kind) && !(a.kind === 'attention' && a.attention === 'idle')) this.pushFeed({ kind: 'activity', robotId: r.id, a, fresh: true });
        this.events.changed(r);
        break;
      }
      case 'removed': {
        const r = this.robots.get(msg.sessionId);
        if (r) { if (this.background) this.remove(r); else r.leave(); }
        break;
      }
      case 'bank': {
        this.bank = msg.bank;
        this.events.bank(this.bank);
        break;
      }
      case 'session': {
        // Metadata or timing checkpoint; the robot's behaviour does not depend on these.
        const r = this.robots.get(msg.session.id);
        if (r) { r.session = msg.session; this.events.changed(r); }
        break;
      }
    }
  }

  /** A chat line in the robot's log (demo: messages and replies). */
  say(sessionId: string, who: 'you' | 'robot', text: Text, at = Date.now(), quiet = false): void {
    const r = this.robots.get(sessionId);
    if (!r) return;
    r.addLog({ kind: 'say', who, text, at });
    if (who === 'robot' && !quiet && !this.background) r.cheer();
    this.events.changed(r);
  }

  system(key: string): void { this.pushFeed({ kind: 'system', key, fresh: true }); }

  /** Removes every robot at once (switching between live and demo). */
  clear(): void {
    clearCoins();
    for (const r of this.robots.values()) r.dispose();
    this.robots.clear();
    this.pendingPayouts.clear();
    this.payoutsInFlight.clear();
    this.payoutPeriods.clear();
    this.feedItems = [];
    this.events.feed(this.feedItems);
    this.events.changed();
  }

  get(id: string): Robot | undefined { return this.robots.get(id); }

  list(): Robot[] { return [...this.robots.values()]; }

  /** Meshes for click picking. */
  hits(): Mesh[] { return this.list().flatMap(r => r.mesh.hits); }

  /** Moves and poses every robot; returns how busy each station is for the town animation. */
  update(dt: number, t: number, camAz: number): Busy {
    const busy: Busy = { forge: 0, tower: 0, site: 0 };
    if (this.background) return busy;
    for (const r of this.robots.values()) {
      r.update(dt, camAz);
      r.pose(t, dt);
      const startedAt = r.session.taskStartedAt;
      let progress = this.payoutPeriods.get(r);
      if (startedAt !== undefined && progress?.startedAt !== startedAt) {
        progress = { startedAt, period: 0 };
        this.payoutPeriods.set(r, progress);
      }
      const period = startedAt === undefined ? 0 : payoutPeriod(startedAt, Date.now());
      const partial = (r.session.status === 'working' || r.session.status === 'thinking')
        && progress !== undefined && period > progress.period;
      const finished = r.session.status === 'idle' && (r.homeBound || r.charging);
      if ((finished || partial) && !r.leaving && !this.payoutsInFlight.has(r)) {
        const payout = this.pendingPayouts.get(r);
        if (payout) {
          if (partial && progress) progress.period = period;
          this.pendingPayouts.delete(r);
          this.payoutsInFlight.add(r);
          this.payOut(r, payout);
        }
      }
      if (r.phase === 'work' && r.beat && !r.beat.think) {
        if (r.beat.station === 'forge') busy.forge++;
        else if (r.beat.station === 'tower') busy.tower++;
        else if (r.beat.station === 'site') busy.site++;
      }
    }
    return busy;
  }

  private resetPayoutPeriod(r: Robot): void {
    const startedAt = r.session.taskStartedAt;
    if (startedAt === undefined) this.payoutPeriods.delete(r);
    else this.payoutPeriods.set(r, { startedAt, period: payoutPeriod(startedAt, Date.now()) });
  }

  /** The bank pays the robot: 6–12 coins fly from the bank, then "+18K" pops over its head. */
  private payOut(r: Robot, payout: Activity): void {
    const amount = payout.nanoAic !== undefined ? payout.nanoAic / 1e9 : payout.tokens ?? 0;
    const n = Math.round(Math.min(12, Math.max(6, (Math.log10(Math.max(10, amount)) - 2) * 1.6 + 4)));
    const alive = () => (this.robots.get(r.id) === r && !r.leaving ? { x: r.x, y: 1.1 * Math.max(0.3, r.scale), z: r.z } : null);
    flyCoins(this.town.bankCoins, alive, n, () => {
      this.payoutsInFlight.delete(r);
      if (!alive()) return;
      burst(r.x, 1.3, r.z, '#ffc93d', 8, { speed: 1.6, up: 1.8, g: 6, life: 0.6, size: 0.05 });
      if (r.session.status === 'idle') r.cheer();
      this.events.paid(r, payout);
    });
  }

  private add(s: SessionInfo): Robot {
    const agent = agentOf(s);
    const palette = AGENT_COLORS[agent];
    const color = palette[this.colorIdx[agent]++ % palette.length];
    const r = new Robot(s, color, {
      onBuild: n => this.town.grow(n),
      onGone: robot => this.remove(robot),
      onPop: (robot, key, kind) => this.events.pop(robot, key, kind),
    });
    this.robots.set(s.id, r);
    this.resetPayoutPeriod(r);
    return r;
  }

  private remove(robot: Robot): void {
    this.pendingPayouts.delete(robot);
    this.payoutsInFlight.delete(robot);
    this.payoutPeriods.delete(robot);
    robot.dispose();
    this.robots.delete(robot.id);
    this.events.changed();
  }

  private pushFeed(item: FeedItem): void {
    // Several tool calls in a row from the same robot collapse into one line.
    const top = this.feedItems[0];
    if (top && item.kind === 'activity' && top.kind === 'activity' && top.robotId === item.robotId && top.a.kind === 'tool' && item.a.kind === 'tool') {
      // Update the line in place (same object), so the page keeps the same element and clicks on it keep working.
      top.a = item.a;
    } else {
      this.feedItems.unshift(item);
      this.feedItems = this.feedItems.slice(0, 4);
    }
    this.events.feed(this.feedItems);
  }
}
