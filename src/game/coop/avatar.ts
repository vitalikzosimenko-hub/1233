// A co-op mate's avatar: its pose (as it travels) turned into what the model draws, and smoothed
// between updates so it walks along instead of hopping fifteen times a second.
import type { BlockBody } from '../body';
import type { MateView } from '../models';
import { lerpValues, P, PF, POSE_LERP } from './wire';

/** The mate as a screen shows it: the model's view of it, its canopy, its name. */
export interface MateShown {
  v: MateView;
  chute: number;
  name: string;
}

/** Builds the model's view from a pose placed in its frame (`body`: the deck or giant it is on). */
export function poseView(pose: number[], body: BlockBody | null, skin: string, name: string, hurt: number): MateShown {
  const lx = pose[P.x]! / 100;
  const ly = pose[P.y]! / 100;
  const lz = pose[P.z]! / 100;
  const [x, y, z] = body ? body.toWorld(lx, ly, lz) : [lx, ly, lz];
  const fl = pose[P.flags]!;
  const state: MateView['pose'] = fl & PF.dead ? 'down' : fl & PF.helm ? 'helm' : fl & PF.gunner ? 'guns' : fl & PF.climbing ? 'climb' : fl & PF.swim ? 'swim' : 'stand';
  const item = pose[P.item]!;
  return {
    v: {
      x, y, z,
      yaw: pose[P.yaw]! / 1000,
      pitch: pose[P.pitch]! / 1000,
      walkPhase: pose[P.walk]! / 100,
      speed: Math.hypot(pose[P.vx]!, pose[P.vz]!) / 100,
      swing: pose[P.swing]! / 100,
      skin,
      pose: state,
      turn: (pose[P.turn] ?? 0) / 100,
      hen: (fl & PF.hen) !== 0,
      hurt,
      item: item >= 0 && (fl & PF.hen) === 0 ? item : null,
    },
    chute: pose[P.chute]! / 100,
    name,
  };
}

/** Eases a stream of poses in their own frame (a change of frame, or a long jump, snaps). */
export class PoseSmoother {
  private shown: number[] | null = null;

  update(target: number[], dt: number): number[] {
    const s = this.shown;
    const jump = s ? Math.hypot(s[P.x]! - target[P.x]!, s[P.y]! - target[P.y]!, s[P.z]! - target[P.z]!) > 400 : true;
    if (!s || jump || s[P.frame] !== target[P.frame] || s[P.giant] !== target[P.giant]) {
      this.shown = target.slice();
      return this.shown;
    }
    lerpValues(s, target, 1 - Math.exp(-dt * 14), POSE_LERP, s);
    return s;
  }
}
