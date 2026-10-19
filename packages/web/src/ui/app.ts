/** What the UI modules need from the app (implemented in main.ts). */
import type { Village } from '../agents/controller';
import type { Robot } from '../agents/robot';
import type { Source, SourceState } from '../agents/source';
import type { CameraRig } from '../world/camera';

export interface App {
  readonly village: Village;
  readonly rig: CameraRig;
  readonly source: Source;
  readonly state: SourceState;
  readonly selected: Robot | null;
  readonly following: boolean;
  select(robot: Robot | null, focus?: boolean): void;
  setFollow(on: boolean): void;
  switchTo(kind: 'live' | 'demo'): void;
}
