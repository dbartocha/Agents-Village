/**
 * Keeps one Robot per session and feeds it the messages from the active source (live server or demo).
 * Also tells the town which stations are busy and keeps the short event feed.
 */
import type { Activity, ServerMessage, SessionInfo, Text } from '../../../shared/src/index.ts';
import type { Mesh } from 'three';
import type { Busy, Town } from '../world/town';
import { burst } from '../world/particles';
import { Robot } from './robot';
import type { PopKind } from './robot';

export const COLORS = ['#ff6b5b', '#4d8dff', '#ffbf2e', '#9b6bff', '#2fbf8f', '#ff7eb6', '#38c6d9', '#ff9a3d', '#6f7cff', '#8fd14f', '#e85d75', '#b08968', '#00b3a4', '#c77dff'];

/** One line in the "recent events" feed. `key` is an i18n key for system lines. */
export type FeedItem =
  | { kind: 'activity'; robotId: string; a: Activity; fresh: boolean }
  | { kind: 'system'; key: string; fresh: boolean };

export interface VillageEvents {
  /** Something about this robot changed (undefined: the list of robots changed). */
  changed(robot?: Robot): void;
  feed(items: FeedItem[]): void;
  pop(robot: Robot, key: string, kind: PopKind): void;
}

/** Activities worth a line in the feed (tool_done and friends would flood it). */
const FEED_KINDS = new Set<Activity['kind']>([
  'session_start', 'prompt', 'tool', 'tool_failed', 'permission', 'attention', 'permission_resolved', 'stop', 'session_end',
]);

export class Village {
  readonly robots = new Map<string, Robot>();
  approvals = false;
  private feedItems: FeedItem[] = [];
  private colorIdx = 0;

  private readonly town: Town;
  private readonly events: VillageEvents;

  constructor(town: Town, events: VillageEvents) {
    this.town = town;
    this.events = events;
  }

  /** Applies one message from a source. The first snapshot places robots without walking. */
  apply(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        const snap = msg.snapshot;
        this.approvals = snap.approvals;
        const ids = new Set(snap.sessions.map(s => s.id));
        for (const r of [...this.robots.values()]) if (!ids.has(r.id)) r.leave();
        for (const s of snap.sessions) {
          const known = this.robots.get(s.id);
          if (known) { known.sync(s); continue; }
          if (s.status === 'ended') continue;
          const r = this.add(s);
          r.placeFromSession(s);
          for (const a of snap.recent) if (a.sessionId === s.id) r.addLog({ kind: 'activity', a });
        }
        this.events.changed();
        break;
      }
      case 'activity': {
        const { activity: a, session: s } = msg;
        let r = this.robots.get(s.id);
        if (!r) {
          if (a.kind === 'session_end') break;
          r = this.add(s);
          r.spawnAtFactory();
          burst(r.x, 0.5, r.z, '#ffffff', 16, { speed: 2.2, up: 1.0, g: 0.6, life: 1.0, size: 0.16, lit: true, spread: 0.6, smoke: true });
          this.events.changed();
        }
        r.onActivity(a, s);
        if (FEED_KINDS.has(a.kind) && !(a.kind === 'attention' && a.attention === 'idle')) this.pushFeed({ kind: 'activity', robotId: r.id, a, fresh: true });
        this.events.changed(r);
        break;
      }
      case 'removed': {
        this.robots.get(msg.sessionId)?.leave();
        break;
      }
    }
  }

  /** A chat line in the robot's log (demo: messages and replies). */
  say(sessionId: string, who: 'you' | 'robot', text: Text, at = Date.now(), quiet = false): void {
    const r = this.robots.get(sessionId);
    if (!r) return;
    r.addLog({ kind: 'say', who, text, at });
    if (who === 'robot' && !quiet) r.cheer();
    this.events.changed(r);
  }

  system(key: string): void { this.pushFeed({ kind: 'system', key, fresh: true }); }

  /** Removes every robot at once (switching between live and demo). */
  clear(): void {
    for (const r of this.robots.values()) r.dispose();
    this.robots.clear();
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
    for (const r of this.robots.values()) {
      r.update(dt, camAz);
      r.pose(t, dt);
      if (r.phase === 'work' && r.beat && !r.beat.think) {
        if (r.beat.station === 'forge') busy.forge++;
        else if (r.beat.station === 'tower') busy.tower++;
        else if (r.beat.station === 'site') busy.site++;
      }
    }
    return busy;
  }

  private add(s: SessionInfo): Robot {
    const color = COLORS[this.colorIdx++ % COLORS.length];
    const r = new Robot(s, color, {
      onBuild: n => this.town.grow(n),
      onGone: robot => {
        robot.dispose();
        this.robots.delete(robot.id);
        this.events.changed();
      },
      onPop: (robot, key, kind) => this.events.pop(robot, key, kind),
    });
    this.robots.set(s.id, r);
    return r;
  }

  private pushFeed(item: FeedItem): void {
    // Several tool calls in a row from the same robot collapse into one line.
    const top = this.feedItems[0];
    if (top && item.kind === 'activity' && top.kind === 'activity' && top.robotId === item.robotId && top.a.kind === 'tool' && item.a.kind === 'tool') {
      this.feedItems[0] = item;
    } else {
      this.feedItems.unshift(item);
      this.feedItems = this.feedItems.slice(0, 4);
    }
    this.events.feed(this.feedItems);
  }
}
