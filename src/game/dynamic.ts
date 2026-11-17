// Geometry rebuilt every frame: legs, machines, creatures, loot, projectiles, decals and
// particles. Opaque things go to `opaque`, cut-outs to `cutout`, cracks and the selection box
// to `overlay`, and soft sprites (smoke, dust, sparks) to `soft`.
import { B, I } from './blocks';
import { kx, ky, kz } from './body';
import { pick } from './build';
import type { Actor } from './entities';
import type { Game, Target } from './game';
import { F_OVERLAY, F_UNLIT, type MeshBuilder, type TexRect } from './gl';
import { normalize, type Vec3 } from './math3d';
import { subRect, tileRect } from './mesher';
import { aimPoint, nearestCannon, planShot, planThrow, shotPath, turretReady, type Shot } from './combat';
import { poundReach } from './fortress';
import { treasureTarget } from './quests';
import { GRAPPLE_RANGE, hookFlight, hookPoint } from './relics';
import { starDir } from './events';
import { FOLD_TIME } from './chute';
import { howlPose } from './pet';
import { bodyShown, heldOut, selfView } from './perspective';
import { officerCall } from './company';
import { drawCrane, drawCrate, hobSpot } from './crane';
import { add, arrow, ballistaModel, calloutOver, beam, billboard, blobShadow, blockCube, cannonBarrel, chicken, chuteCanopy, crack, helmWheel, itemDrop, lightningBolt, mate, mortarModel, mySkin, outline, parachuteCrate, pilot, pitchBasis, propeller, ropeLadder, sails, scale, segmentedBeam, sheep, sprite, uvs, villager, walkerLeg, WHITE, wolf, WOOL_TINTS, yawBasis, type Basis } from './models';
import { creeperModel, endermanModel, evokerModel, ghastModel, illagerModel, phantomModel, potionTint, ravagerModel, skeletonModel, slimeModel, spiderModel, vexModel, witchModel, witherModel, zombieModel, type MobLayers } from './models-mobs';
import { witherPose } from './bosses';
import { creatureShadow, crown, drawCreature, ravagerArmor } from './creatures';
import { clamp } from './rng';
import { DIRS } from './world';

/** Away from the wall a ladder leans on (by its DIRS index), in its grid's frame. */
const WALL_OUT: ReadonlyArray<readonly [number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export interface DynamicOut {
  opaque: MeshBuilder;
  cutout: MeshBuilder;
  overlay: MeshBuilder;
  soft: MeshBuilder;
}

/** What dynamic geometry needs from the renderer. */
export interface DynamicView {
  eye: Vec3;
  cam: Basis;
  hover: { x: number; y: number } | null;
  /** 0..1 through the arm's chop while you dig or strike. */
  swingT: number;
  screenRay(x: number, y: number, game: Game): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number };
  /** Whether a sphere is inside the camera's view. */
  inView(x: number, y: number, z: number, r: number): boolean;
}

/** The fortress's legs as last built (see buildDynamic), and what they were built from. */
let legCut: { v: Uint8Array; i: Uint32Array; base: number } | null = null;
let legCutKey: number[] = [];
let legKey: number[] = [];

function sameKey(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function buildDynamic(game: Game, view: DynamicView, out: DynamicOut): void {
  const b = out.opaque;
  const o = out.overlay;
  const soft = out.soft;
  b.reset();
  o.reset();
  soft.reset();
  out.cutout.reset();
  const w = game.world;
  const time = game.time;
  const e = view.eye;
  const near = (x: number, y: number, z: number, r: number): boolean => Math.abs(x - e[0]) < r && Math.abs(z - e[2]) < r && Math.abs(y - e[1]) < r;
  // Near enough, and on screen or close enough to it to throw a shadow into it (a phone's narrow
  // view leaves most of the creatures round it unbuilt).
  const seen = (x: number, y: number, z: number, size: number, reach: number): boolean => near(x, y, z, reach) && view.inView(x, y, z, size + 8);
  const lit = (mb: MeshBuilder, x: number, y: number, z: number): void => {
    const [s, l] = game.lightAt(x, y, z);
    mb.sky = s;
    mb.blk = l;
  };
  const env = game.renderer.env;

  // ---- walker legs (fortress and giants)
  const F = game.fortress;
  // (A leg's shadow falls well clear of it: a wide margin while there are shadows.)
  const legMargin = env.shadows ? 12 : 2;
  const legSeen = (hip: Vec3, foot: Vec3): boolean => {
    const r = Math.hypot(hip[0] - foot[0], hip[1] - foot[1], hip[2] - foot[2]) / 2 + 3 + legMargin;
    return view.inView((hip[0] + foot[0]) / 2, (hip[1] + foot[1]) / 2, (hip[2] + foot[2]) / 2, r);
  };
  // (Standing, the fortress's legs are the same frame after frame: what they were built into is
  // copied back instead of being built again. They are copied out only once they have held still
  // for a frame: on the march they change every frame, and the copies would only be garbage.)
  const legs: Array<{ hip: Vec3; knee: Vec3; foot: Vec3; damage: number; sky: number; blk: number }> = [];
  const key = legKey;
  key.length = 0;
  key.push(F.walkPhase, game.walker.spec.size * game.walker.scale, game.walker.shinLength(), b.verts, b.count);
  for (const l of game.walker.legs) {
    const hip = game.walker.hipWorld(F, l);
    if (!near(hip[0], hip[1], hip[2], 160) || !legSeen(hip, l.foot)) {
      key.push(-1);
      continue;
    }
    const knee = game.walker.knee(F, l, hip);
    const [sky, blk] = game.lightAt(knee[0], knee[1], knee[2]);
    legs.push({ hip, knee, foot: l.foot, damage: l.damage, sky, blk });
    key.push(hip[0], hip[1], hip[2], knee[0], knee[1], knee[2], l.foot[0], l.foot[1], l.foot[2], l.damage, sky, blk);
  }
  if (legCut && sameKey(key, legCutKey)) {
    b.paste(legCut);
    const last = legs[legs.length - 1];
    if (last) {
      b.sky = last.sky;
      b.blk = last.blk;
    }
  } else {
    const v0 = b.verts;
    const c0 = b.count;
    for (const l of legs) {
      b.sky = l.sky;
      b.blk = l.blk;
      walkerLeg(b, l.hip, l.knee, l.foot, game.walker.spec.size * game.walker.scale, false, F.walkPhase, l.damage, game.walker.shinLength());
    }
    legCut = sameKey(key, legCutKey) ? b.cut(v0, c0) : null;
    legKey = legCutKey;
    legCutKey = key;
  }
  for (const giant of game.giants) {
    if (giant.dead) continue;
    const body = giant.body;
    for (const l of giant.walker.legs) {
      const hip = giant.walker.hipWorld(body, l);
      if (!legSeen(hip, l.foot)) continue;
      const knee = giant.walker.knee(body, l, hip);
      lit(b, knee[0], knee[1], knee[2]);
      walkerLeg(b, hip, knee, l.foot, giant.walker.spec.size, true, body.walkPhase);
    }
  }

  // ---- machines on the fortress (forEach: a for-of over the map makes a pair per cell, every frame)
  F.cells.forEach((c, key) => {
    const turret = c.id === B.CANNON || c.id === B.BALLISTA || c.id === B.MORTAR;
    if (c.id === B.HELM) {
      // The wheel turns with the rudder (its post is part of the hull's mesh).
      const [hx, , hz] = DIRS[c.dir & 3] ?? [1, 0, 0];
      const [ax, az] = F.dirToWorld(hx, hz);
      const ctr = F.toWorld(kx(key) + 0.5 + hx * 0.1, ky(key) + 1.0, kz(key) + 0.5 + hz * 0.1);
      lit(b, ctr[0], ctr[1], ctr[2]);
      helmWheel(b, ctr, [ax, 0, az], [-az, 0, ax], game.helmSpin);
      return;
    }
    if (!turret && c.id !== B.THRUSTER && !(c.hp < c.maxHp && c.maxHp > 1)) return;
    const [cx, cy, cz] = F.toWorld(kx(key) + 0.5, ky(key) + 0.5, kz(key) + 0.5);
    if (turret) {
      const s = F.cannons.get(key);
      lit(b, cx, cy + 1, cz);
      const yaw = F.yaw + (s?.yaw ?? 0);
      if (c.id === B.CANNON) cannonBarrel(b, [cx, cy - 0.5, cz], yaw, s?.pitch ?? 0.5, s?.recoil ?? 0, F.poweredMachines.has(key), F.c, F.s);
      // The crossbow and the mortar tube stand on top of their blocks.
      else if (c.id === B.BALLISTA) ballistaModel(b, [cx, cy, cz], yaw, s?.pitch ?? 0.1, s?.recoil ?? 0, F.c, F.s);
      else mortarModel(b, [cx, cy - 0.15, cz], yaw, s?.pitch ?? 0.9, s?.recoil ?? 0, F.poweredMachines.has(key), F.c, F.s);
    } else if (c.id === B.THRUSTER) {
      const powered = F.poweredMachines.has(key);
      lit(b, cx - F.c, cy, cz - F.s);
      propeller(b, [cx, cy, cz], powered ? time * (F.moving ? 10 : 2.5) + kz(key) : 0.4, F.c, F.s);
    }
    if (c.hp < c.maxHp && c.maxHp > 1 && near(cx, cy, cz, 24)) crack(o, cx, cy, cz, Math.floor((1 - c.hp / c.maxHp) * 10), F.c, F.s);
  });
  // Hoisted windmills turn their sails as the fortress marches (and in the breeze).
  for (const info of game.cargo) {
    if (info.hub === null || !F.cells.has(info.hub)) continue;
    const [ldx, , ldz] = DIRS[info.dir] ?? [0, 0, 1];
    const hub = F.toWorld(kx(info.hub) + 0.5 + ldx * 0.6, ky(info.hub) + 0.5, kz(info.hub) + 0.5 + ldz * 0.6);
    const [dx, dz] = F.dirToWorld(ldx, ldz);
    lit(b, hub[0], hub[1], hub[2]);
    sails(b, hub, [dx, 0, dz], time * (F.moving ? 1.6 : 0.35), info.sail ?? (info.mini ? 3 : 6));
  }
  // The crane: its mast, jib and hook, the chains on a load, the blueprint at its mark, and what flies off it.
  drawCrane(game, b, o, lit);
  for (const giant of game.giants) {
    if (giant.dead) continue;
    const gb = giant.body;
    gb.cells.forEach((c, key) => {
      if (!(c.hp < c.maxHp && c.maxHp > 1)) return;
      const [x, y, z] = gb.toWorld(kx(key) + 0.5, ky(key) + 0.5, kz(key) + 0.5);
      crack(o, x, y, z, Math.floor((1 - c.hp / c.maxHp) * 10), gb.c, gb.s);
    });
  }

  // ---- mining cracks and the highlighted block
  const m = game.mining;
  /** Centre and turn of a targeted cell. */
  const cellFrame = (t: Target): [number, number, number, number, number] => {
    if (!t.body) return [t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 0];
    const [x, y, z] = t.body.toWorld(t.x + 0.5, t.y + 0.5, t.z + 0.5);
    return [x, y, z, t.body.c, t.body.s];
  };
  if (m.target && m.progress > 0) {
    const [x, y, z, rc, rs] = cellFrame(m.target);
    crack(o, x, y, z, Math.floor(m.progress * 10), rc, rs);
  }
  if (game.isPlaying()) {
    let focus: Target | null = m.target;
    if (!focus) {
      const ray = view.hover ? view.screenRay(view.hover.x, view.hover.y, game) : game.viewRay();
      focus = pick(game, ray).block;
    }
    game.focus = focus;
    if (focus) {
      const [x, y, z, rc, rs] = cellFrame(focus);
      outline(o, x, y, z, rc, rs);
    }
  }

  // ---- creatures, each lit by the light where it stands, with a soft shadow underfoot
  const shadowK = 0.3 + 0.35 * env.daylight;
  const shadowUnder = (x: number, y: number, z: number, radius: number): void => {
    if (!near(x, y, z, 30)) return;
    for (let k = 0; k < 4; k += 1) {
      const cy = Math.floor(y - 0.01) - k;
      if (w.solid(Math.floor(x), cy, Math.floor(z))) {
        blobShadow(o, x, cy + 1, z, radius, shadowK * (1 - clamp((y - cy - 1) / 3, 0, 1)));
        return;
      }
    }
  };
  // Armour and rags go on the cut-out layer, jelly and auras on the blended one.
  const layers: MobLayers = { cut: out.cutout, soft };
  for (const mob of game.mobs) {
    const big = mob.kind === 'ghast' || mob.kind === 'wither';
    if (!seen(mob.x, mob.y + mob.h / 2, mob.z, big ? 6 : Math.max(1.5, mob.h), big ? 160 : 90)) continue;
    lit(b, mob.x, mob.y + Math.min(1.2, mob.h * 0.6), mob.z);
    drawMob(game, b, layers, mob, time);
    const r = shadowRadius(mob);
    if (r > 0 && !mob.climb && !mob.flying && !mob.mount) shadowUnder(mob.x, mob.y, mob.z, r);
  }
  // The fallen: toppled on their side, flashing red until they puff away (or flat as a pancake
  // where a fortress foot came down on them).
  for (const c of game.corpses) {
    if (!seen(c.x, c.y, c.z, 2.5, 90)) continue;
    lit(b, c.x, c.y + 0.6, c.z);
    if (c.squash > 0) drawPancake(game, b, c, time);
    else drawMob(game, b, layers, c, time);
  }
  // An evoker's fangs: two jaws bursting out of the ground, snapping shut, sinking back.
  if (game.fangs.length) {
    const cut = out.cutout;
    const tex = tileRect('fangs');
    const faces = [null, null, null, null, tex, tex];
    for (const f of game.fangs) {
      if (f.t < 0 || !near(f.x, f.y, f.z, 80)) continue;
      const rise = Math.min(1, f.t / 0.1);
      const sink = f.t > 0.62 ? Math.min(1, (f.t - 0.62) / 0.3) : 0;
      const lift = (1 - (1 - rise) * (1 - rise)) * (1 - sink * sink);
      // Gaping as they rise, slamming shut on the bite.
      const open = f.t < 0.12 ? 0.7 : f.t < 0.28 ? 0.7 * (1 - (f.t - 0.12) / 0.16) : f.t < 0.34 ? -0.06 * Math.sin(((f.t - 0.28) / 0.06) * Math.PI) : 0;
      lit(cut, f.x, f.y + 0.5, f.z);
      const al: Vec3 = [Math.cos(f.yaw), 0, Math.sin(f.yaw)];
      const sd: Vec3 = [-al[2], 0, al[0]];
      const base: Vec3 = [f.x, f.y - 0.86 + lift * 0.86, f.z];
      for (const s of [-1, 1]) {
        const up: Vec3 = [sd[0] * s * Math.sin(open), Math.cos(open), sd[2] * s * Math.sin(open)];
        const nrm: Vec3 = [-al[2] * up[1], al[2] * up[0] - al[0] * up[2], al[0] * up[1]];
        const c = add(add(base, scale(sd, s * 0.09)), scale(up, 0.42));
        cut.box(c, scale(al, 0.3), scale(up, 0.42), scale(nrm, 0.012), faces);
      }
    }
  }
  // Sword sweeps: a pale crescent racing right to left in front of you.
  if (game.slashes.length) {
    const white = tileRect('white');
    soft.flags = F_OVERLAY | F_UNLIT;
    soft.emit = 1;
    for (const s of game.slashes) {
      const reveal = Math.min(1, s.t / 0.07);
      const fade = 1 - Math.min(1, s.t / 0.24);
      const fx = Math.cos(s.yaw);
      const fz = Math.sin(s.yaw);
      const rx = -fz;
      const rz = fx;
      const seg = 12;
      const span = 0.8;
      const at = (th: number, rad: number): Vec3 => [
        s.x + fx * Math.cos(th) * rad + rx * Math.sin(th) * rad,
        s.y + th * 0.2,
        s.z + fz * Math.cos(th) * rad + rz * Math.sin(th) * rad,
      ];
      soft.tint = s.crit ? [1, 0.88, 0.55] : [0.92, 0.96, 1];
      const shown = Math.ceil(seg * reveal);
      for (let i = 0; i < shown; i += 1) {
        const a0 = span - (2 * span * i) / seg;
        const a1 = span - (2 * span * (i + 1)) / seg;
        // A crescent: thick in the middle, tapering to points, brightest where the blade is.
        const w = Math.sin(Math.PI * ((i + 0.5) / seg));
        const lead = shown - i <= 2 ? 1 : 0.7;
        soft.alpha = fade * (0.25 + 0.6 * w) * lead;
        const p0 = at(a0, 1.5 - 0.24 * w);
        const p1 = at(a0, 1.56 + 0.05 * w);
        const p2 = at(a1, 1.56 + 0.05 * w);
        const p3 = at(a1, 1.5 - 0.24 * w);
        soft.quad([...p0, ...p1, ...p2, ...p3], white, 0, 1, 0);
      }
    }
    soft.flags = 0;
    soft.emit = 0;
    soft.tint = [1, 1, 1];
    soft.alpha = 1;
  }
  const p = game.player;
  // You at the wheel (or on the guns), seen from the commander's view; anywhere else, in the
  // third-person view (knocked flat, too).
  const shown = bodyShown(game);
  if (game.camPull > 0.15 && !p.dead) {
    lit(b, p.x, p.y + 1.2, p.z);
    if (game.gunner) mate(b, { x: p.x, y: p.y, z: p.z, yaw: game.yaw, pitch: game.pitch, walkPhase: 0, speed: 0, swing: 0, skin: mySkin(), pose: 'guns', turn: 0, hen: false, hurt: p.hurt, item: null }, time, out.cutout);
    else pilot(b, p.x, p.y, p.z, F.yaw, time, game.turnRate / Math.max(0.05, game.turnSpeed()), mySkin(), out.cutout);
  } else if (shown) {
    lit(b, p.x, p.y + 1.2, p.z);
    mate(b, selfView(game, view.swingT), time, out.cutout);
    if (!p.dead && p.chute <= 0) shadowUnder(p.x, p.y, p.z, 0.36);
  }
  // Your co-op mate: walking, at the helm or the guns, on a ladder, a hen in its arms, a canopy over it.
  const crew = game.mate();
  if (crew && seen(crew.v.x, crew.v.y + 1, crew.v.z, 2, 160)) {
    const v = crew.v;
    lit(b, v.x, v.y + 1.2, v.z);
    mate(b, v, time, out.cutout);
    if (crew.chute > 0) chuteCanopy(b, v.x, v.y, v.z, v.yaw, crew.chute, 0, 0, time);
    if (v.pose !== 'down') shadowUnder(v.x, v.y, v.z, 0.36);
  }
  // Pip: wagging, sitting for a pat, lunging at monsters, howling at the moon.
  const pet = game.pet;
  if (pet && seen(pet.a.x, pet.a.y, pet.a.z, 1.5, 90)) {
    const a = pet.a;
    lit(b, a.x, a.y + 0.6, a.z);
    wolf(b, a, time, pet.sit > 0, 0.35 + pet.happy * 0.5, pet.happy, howlPose(pet));
    shadowUnder(a.x, a.y, a.z, 0.36);
  }
  // Hens and sheep about the villages (and the hens riding on the deck).
  for (const a of game.animals) {
    if (!seen(a.x, a.y + 0.5, a.z, 1.5, 72)) continue;
    lit(b, a.x, a.y + 0.6, a.z);
    if (a.kind === 'chicken') chicken(b, a, time);
    else if (a.kind === 'sheep') sheep(b, a, time, WOOL_TINTS[a.tint] ?? WOOL_TINTS[0]!);
    else drawCreature(game, b, layers, a, time);
    shadowUnder(a.x, a.y, a.z, creatureShadow(a) ?? (a.kind === 'chicken' ? 0.24 : 0.5));
  }
  // Supply crates under their canopies (the canopy folds over a landed crate, then goes).
  for (const d of game.airdrops) {
    if (!near(d.x, d.y, d.z, 140)) continue;
    const fold = d.chest ? Math.min(1, d.t / 1.1) : 0;
    if (d.chest && fold >= 1) continue;
    lit(b, d.x, d.y + 1, d.z);
    parachuteCrate(b, d.x, d.y, d.z, d.sway, fold, d.chest !== null);
    if (!d.chest) shadowUnder(d.x, d.y, d.z, 0.55);
  }
  // Your parachute overhead, and a landed one settling where you came down (its lines to your
  // shoulders when the view shows you).
  if (p.chute > 0 && !p.dead) {
    lit(b, p.x, p.y + 4, p.z);
    chuteCanopy(b, p.x, p.y, p.z, game.yaw, p.chute, 0, game.chuteRoll, time, !shown);
  }
  const fold = game.chuteFold;
  if (fold) {
    lit(b, fold.x, fold.y + 1, fold.z);
    chuteCanopy(b, fold.x, fold.y, fold.z, fold.yaw, fold.open, Math.min(1, fold.t / FOLD_TIME), 0, time);
  }
  // Rope ends of the ladders hanging off the fortress, down to the ground wherever it stands.
  for (const r of game.ropeEnds()) {
    const [ox, oz] = WALL_OUT[r.dir] ?? [0, 0];
    const plane = (c: number, o: number): number => c + (o > 0 ? 0.05 : o < 0 ? 0.95 : 0.5);
    const top = F.toWorld(plane(r.x, ox), r.y, plane(r.z, oz));
    const floor = game.ropeFloor(r);
    if (top[1] - floor < 0.3 || !near(top[0], top[1], top[2], 110)) continue;
    if (!view.inView(top[0], (top[1] + floor) / 2, top[2], (top[1] - floor) / 2 + 3)) continue;
    const [wox, woz] = F.dirToWorld(ox, oz);
    const [wax, waz] = F.dirToWorld(oz !== 0 ? 1 : 0, ox !== 0 ? 1 : 0);
    const swing = Math.sin(time * 1.3 + r.x) * Math.min(0.25, (top[1] - floor) * 0.02);
    lit(b, top[0], top[1] - 1, top[2]);
    ropeLadder(b, top, [top[0] + wox * swing, floor + 0.05, top[2] + woz * swing], [wax * 0.34, 0, waz * 0.34], [wox, 0, woz]);
  }
  for (const v of game.villagers) {
    if (!seen(v.x, v.y + 1, v.z, 2, 90)) continue;
    const alert = (v.trader || v.freed || (!v.recruited && !v.captive)) && Math.hypot(v.x - p.x, v.z - p.z) < (v.trader ? 24 : 9);
    lit(b, v.x, v.y + 1.3, v.z);
    if (v.kind !== 'villager') {
      drawCreature(game, b, layers, v, time);
      if (v.kind === 'npc' && !v.captive) {
        const call = officerCall(game, v);
        if (call) calloutOver(b, v.x, v.y + 2.5, v.z, time, call === 'done' ? [1, 0.82, 0.25] : call === 'new' ? [1, 0.82, 0.25] : [0.55, 0.85, 1]);
      }
    } else villager(b, v.x, v.y, v.z, v.yaw, v.walkPhase, v.hurt > 0, alert, time, v.role);
    shadowUnder(v.x, v.y, v.z, creatureShadow(v) ?? 0.42);
  }
  // Old Hob at the crane's mast, in his brass hard hat, watching the hook (or you, when you come by).
  const hob = hobSpot(game);
  if (hob && view.inView(hob[0], hob[1] + 1, hob[2], 3)) {
    const p = game.player;
    const near = Math.hypot(p.x - hob[0], p.z - hob[2]) < 6;
    const rig = game.crane;
    const yaw = near && !game.craneCam ? Math.atan2(p.z - hob[2], p.x - hob[0]) : rig.slew;
    lit(b, hob[0], hob[1] + 1.3, hob[2]);
    villager(b, hob[0], hob[1], hob[2], yaw, 0, false, false, time, 'smith');
    const brass = [tileRect('brass')];
    b.box([hob[0], hob[1] + 1.95, hob[2]], [0.3, 0, 0], [0, 0.035, 0], [0, 0, 0.3], brass);
    b.box([hob[0], hob[1] + 2.04, hob[2]], [0.22, 0, 0], [0, 0.09, 0], [0, 0, 0.22], brass);
    shadowUnder(hob[0], hob[1], hob[2], 0.42);
  }
  if (game.crew > 0) {
    const posts = game.crewPosts;
    for (let i = 0; i < Math.min(game.crew, posts.length); i += 1) {
      const post = posts[i]!;
      const yaw = F.yaw + (post.cannon !== null ? Math.atan2(kz(post.cannon) - post.z, kx(post.cannon) - post.x) : Math.sin(time * 0.3 + i) * 2);
      const [vx, vy, vz] = F.toWorld(post.x + 0.5, post.y, post.z + 0.5);
      // Step aside rather than fill the screen when you stand on their spot.
      if (Math.hypot(vx - e[0], vz - e[2]) < 0.9 && Math.abs(vy + 1.5 - e[1]) < 1.5) continue;
      if (!view.inView(vx, vy + 1, vz, 10)) continue;
      // A cheer: they hop for joy, each to their own beat.
      const hop = game.crewJoy > 0 ? Math.abs(Math.sin((1.5 - game.crewJoy) * 8 + i * 1.3)) * 0.42 * Math.min(1, game.crewJoy * 2) : 0;
      lit(b, vx, vy + 1.3, vz);
      villager(b, vx, vy + hop, vz, yaw, Math.sin(time * 2 + i) > 0.9 ? 0.4 : 0, false, false, time, game.crewRoles[i] ?? 'villager');
    }
  }

  // ---- loose items, falling blocks, projectiles
  for (const d of game.drops) {
    if (!view.inView(d.x, d.y, d.z, 2)) continue;
    const y = d.y + 0.15 + Math.sin(d.age * 4) * 0.06;
    // Item sprites have see-through texels: the cut-out layer (the solid one never discards).
    lit(out.cutout, d.x, y + 0.2, d.z);
    itemDrop(out.cutout, d.id, [d.x, y, d.z], d.age);
    shadowUnder(d.x, d.y, d.z, 0.2);
  }
  for (const f of game.falling) {
    lit(b, f.x, f.y, f.z);
    blockCube(b, f.id, [f.x, f.y, f.z], 0.42, f.rot, f.rot * 0.7);
  }
  for (const pr of game.projectiles) {
    if (Math.hypot(pr.x - e[0], pr.y - e[1], pr.z - e[2]) < 1.6) continue;
    lit(b, pr.x, pr.y, pr.z);
    if (pr.kind === 'arrow') {
      arrow(b, [pr.x, pr.y, pr.z], [pr.vx, pr.vy, pr.vz]);
      continue;
    }
    if (pr.kind === 'bolt') {
      arrow(b, [pr.x, pr.y, pr.z], [pr.vx, pr.vy, pr.vz], 2.2);
      continue;
    }
    if (pr.kind === 'ibolt') {
      arrow(b, [pr.x, pr.y, pr.z], [pr.vx, pr.vy, pr.vz], 1.25);
      continue;
    }
    if (pr.kind === 'fireball') {
      fireball(b, soft, view.cam, pr.x, pr.y, pr.z, pr.age, pr.deflected === true);
      continue;
    }
    if (pr.kind === 'trident') {
      // A drowned's trident: a long shaft of sea-green metal, tines first.
      b.tint = [0.55, 0.9, 0.86];
      arrow(b, [pr.x, pr.y, pr.z], [pr.vx, pr.vy, pr.vz], 2.4);
      b.tint = WHITE;
      continue;
    }
    if (pr.kind === 'wind' || pr.kind === 'web') {
      // A wind charge (a pale swirl, spinning) or a glob of web, as a sprite facing you.
      const wind = pr.kind === 'wind';
      const c = view.cam;
      const k = wind ? 0.42 : 0.38;
      const a = pr.spin;
      const x = add(scale(c.r, Math.cos(a) * k), scale(c.u, Math.sin(a) * k));
      const y = add(scale(c.u, Math.cos(a) * k), scale(c.r, -Math.sin(a) * k));
      const cut = out.cutout;
      lit(cut, pr.x, pr.y, pr.z);
      sprite(cut, wind ? 'wind_charge_item' : 'cobweb', { x, y, z: scale(c.f, -k), t: [pr.x, pr.y, pr.z] });
      if (wind) {
        soft.flags = F_OVERLAY | F_UNLIT;
        soft.alpha = 0.35;
        billboard(soft, c, [pr.x, pr.y, pr.z], 0.7, tileRect('smoke'), 0.9, 0.97, 1, 0.5, -a);
        soft.flags = 0;
        soft.alpha = 1;
      }
      continue;
    }
    if (pr.kind === 'ember') {
      // A blaze's small fireball: a hot ember in a flame glow.
      b.emit = 1;
      b.tint = [1, 0.6, 0.3];
      b.box([pr.x, pr.y, pr.z], [0.12, 0, 0], [0, 0.12, 0], [0, 0, 0.12], [tileRect('lava_still')]);
      b.emit = 0;
      b.tint = WHITE;
      soft.flags = F_OVERLAY | F_UNLIT;
      soft.alpha = 0.8;
      billboard(soft, view.cam, [pr.x, pr.y, pr.z], 0.34, tileRect('flame'), 1, 0.55, 0.2, 2, pr.age * 6);
      soft.flags = 0;
      soft.alpha = 1;
      continue;
    }
    if (pr.kind === 'skull' || pr.kind === 'blueskull') {
      witherSkull(b, soft, view.cam, pr.x, pr.y, pr.z, [pr.vx, pr.vy, pr.vz], pr.kind === 'blueskull', pr.age);
      continue;
    }
    if (pr.kind === 'potion' || pr.kind === 'pearl') {
      // A splash potion (tinted to its brew) or an ender pearl, tumbling end over end.
      const potion = pr.kind === 'potion';
      const a = pr.age * (potion ? 10 : 6);
      const c = view.cam;
      const k = potion ? 0.42 : 0.3;
      const x = add(scale(c.r, Math.cos(a) * k), scale(c.u, Math.sin(a) * k));
      const y = add(scale(c.u, Math.cos(a) * k), scale(c.r, -Math.sin(a) * k));
      // (Sprites have see-through texels: the cut-out layer.)
      const cut = out.cutout;
      lit(cut, pr.x, pr.y, pr.z);
      cut.tint = potion ? potionTint(pr.effect ?? 'harm') : WHITE;
      sprite(cut, potion ? 'splash_item' : 'pearl_item', { x, y, z: scale(c.f, -k), t: [pr.x, pr.y, pr.z] });
      cut.tint = WHITE;
      continue;
    }
    const flash = Math.floor(pr.age * 8) % 2 === 0;
    if (pr.kind === 'crate') {
      // The crane's crate, tumbling as it falls, its fuse lit.
      drawCrate(b, [pr.x, pr.y, pr.z], Math.atan2(pr.vz, pr.vx), pr.spin * 0.25, flash);
      continue;
    }
    if (pr.kind === 'breaker') {
      // A Heartbreaker: a shard of the Citadel's Heart, pulsing as it tumbles.
      blockCube(b, B.CITADEL_HEART, [pr.x, pr.y, pr.z], 0.3, pr.spin, pr.spin * 0.6, 1, flash ? 0.9 : 0.35);
      continue;
    }
    if (pr.block !== undefined) {
      // A titan's boulder: a tumbling lump of its stone (or its ice).
      blockCube(b, pr.block, [pr.x, pr.y, pr.z], 0.62, pr.spin, pr.spin * 0.6);
      continue;
    }
    blockCube(b, B.TNT_BLOCK, [pr.x, pr.y, pr.z], pr.kind === 'shell' || pr.kind === 'gshell' ? 0.42 : pr.kind === 'thrown' ? 0.26 : 0.34, pr.spin, pr.spin * 0.6, flash ? 1.4 : 1, flash ? 0.6 : 0);
  }

  // Arrows and bolts stuck where they hit (the ones in your hull ride along with it).
  for (const sa of game.stuckArrows) {
    let at: Vec3 = [sa.x, sa.y, sa.z];
    let d: Vec3 = [sa.dx, sa.dy, sa.dz];
    if (sa.local && sa.ldir) {
      at = F.toWorld(sa.local[0], sa.local[1], sa.local[2]);
      const [dx, dz] = F.dirToWorld(sa.ldir[0], sa.ldir[2]);
      d = [dx, sa.ldir[1], dz];
    }
    if (!near(at[0], at[1], at[2], 60)) continue;
    const k = sa.big ? 1.25 : 1;
    lit(b, at[0] - d[0] * 0.4, at[1] - d[1] * 0.4, at[2] - d[2] * 0.4);
    arrow(b, [at[0] - d[0] * 0.15 * k, at[1] - d[1] * 0.15 * k, at[2] - d[2] * 0.15 * k], d, k);
  }

  // ---- the grapple: its rope from your hand to the hook, and where the hook would bite
  const hook = hookPoint(game);
  if (hook) {
    const c = view.cam;
    const hand: Vec3 = shown ? heldOut(game) : [e[0] + c.f[0] * 0.55 + c.r[0] * 0.3 - c.u[0] * 0.3, e[1] + c.f[1] * 0.55 + c.r[1] * 0.3 - c.u[1] * 0.3, e[2] + c.f[2] * 0.55 + c.r[2] * 0.3 - c.u[2] * 0.3];
    const k = hookFlight(game);
    const tip: Vec3 = [hand[0] + (hook[0] - hand[0]) * k, hand[1] + (hook[1] - hand[1]) * k, hand[2] + (hook[2] - hand[2]) * k];
    lit(b, tip[0], tip[1], tip[2]);
    segmentedBeam(b, hand, tip, 0.03, 0.03, [tileRect('chain')], 0.8);
    b.box(tip, [0.09, 0, 0], [0, 0.09, 0], [0, 0, 0.09], [tileRect('leg_plate')]);
  } else if (game.isPlaying() && !game.helm && game.selected === I.GRAPPLE && game.mode === 'mine' && !game.player.dead) {
    const ray = game.viewRay();
    const bite = pick(game, ray, GRAPPLE_RANGE).block;
    if (bite) {
      // A gold spark where the hook would bite (pulled toward you so the face does not hide it).
      const d = Math.max(0.5, bite.dist - 0.35);
      const at: Vec3 = [ray.ox + ray.dx * d, ray.oy + ray.dy * d, ray.oz + ray.dz * d];
      soft.flags = F_OVERLAY | F_UNLIT;
      soft.alpha = 0.95;
      soft.emit = 1;
      billboard(soft, view.cam, at, 0.12 + bite.dist * 0.014, tileRect('spark'), 1, 0.85, 0.35, 1, time * 2);
      soft.flags = 0;
      soft.alpha = 1;
      soft.emit = 0;
    }
  }

  // ---- the arc of the TNT in your hand
  const drawArc = (shot: Shot): void => {
    soft.flags = F_OVERLAY;
    const dots = shotPath(shot, 18);
    dots.forEach((pt, i) => {
      const d = Math.hypot(pt[0] - e[0], pt[1] - e[1], pt[2] - e[2]);
      if (d < 2.5) return;
      soft.alpha = 0.8 - (i / dots.length) * 0.45;
      soft.sky = 1;
      soft.blk = 1;
      billboard(soft, view.cam, pt, 0.025 + d * 0.0045, tileRect('white'), 1, 0.62, 0.18, 0.5);
    });
    soft.flags = 0;
    soft.alpha = 1;
  };
  const throwing = game.isPlaying() && !game.helm && !game.player.dead && game.mode === 'mine' && ((game.selected === I.TNT && game.count(I.TNT) > 0) || (game.selected === I.BREAKER && game.count(I.BREAKER) > 0));
  if (throwing) drawArc(planThrow(game, game.viewRay()));

  // ---- the aiming arc of the turret you command
  if (!throwing && game.isPlaying() && (game.helm || game.mannedCannon()) && !game.player.dead) {
    const target = aimPoint(game);
    let key: number | null = null;
    if (game.helm) {
      // The nearest ready turret to the aim stands in for the one the helm will pick.
      let bestD = Infinity;
      for (const k of F.cannons.keys()) {
        if (!turretReady(F, k)) continue;
        const q = F.cellCenter(kx(k), ky(k), kz(k));
        const d = Math.hypot(q.x - target.x, q.z - target.z);
        if (d < bestD) {
          bestD = d;
          key = k;
        }
      }
    } else key = nearestCannon(game)?.key ?? null;
    const shot = key !== null ? planShot(F, key, target.x, target.y, target.z) : null;
    if (shot) drawArc(shot);
  }

  // ---- weather: rain around you, a lightning bolt, the Citadel pylons' shield beams
  const storm = game.weather.storm;
  if (storm > 0.05) {
    const drops = Math.round(170 * storm);
    const rainTex = tileRect('rain');
    soft.flags = F_OVERLAY;
    soft.sky = 0.8;
    soft.blk = 0;
    // A faint glow of their own keeps the drops readable in the dark.
    soft.emit = 0.12 + game.weather.flash;
    const flat = Math.hypot(view.cam.r[0], view.cam.r[2]) || 1;
    const rx: Vec3 = [view.cam.r[0] / flat, 0, view.cam.r[2] / flat];
    for (let i = 0; i < drops; i += 1) {
      const h1 = Math.sin(i * 12.9898) * 43758.5453;
      const h2 = Math.sin(i * 78.233) * 12543.123;
      const fx = h1 - Math.floor(h1);
      const fz = h2 - Math.floor(h2);
      const a = fx * Math.PI * 2;
      const r = 1.5 + fz * 15;
      const x = e[0] + Math.cos(a) * r;
      const z = e[2] + Math.sin(a) * r;
      const fall = (time * 20 + fx * 40) % 18;
      const y = e[1] + 9 - fall;
      if (!view.inView(x, y, z, 1) || y < w.topAt(x, z) + 1) continue;
      soft.alpha = 0.4 * storm;
      streak(soft, [x, y, z], rx, 0.025, 0.55, rainTex);
    }
    soft.flags = 0;
    soft.alpha = 1;
    soft.emit = 0;
  }
  if (game.bolt) lightningBolt(soft, game.bolt.x, game.bolt.y, game.bolt.z, game.bolt.seed, game.bolt.t);
  // A shooting star sweeping across the night sky: a bright head and a glittering tail.
  if (game.star) {
    const s = game.star;
    const R = 90;
    const fade = Math.min(1, s.t * 8, (1 - s.t) * 6);
    soft.flags = F_OVERLAY | F_UNLIT;
    soft.sky = 1;
    soft.blk = 1;
    const head = starDir(s);
    const at = (d: Vec3): Vec3 => [e[0] + d[0] * R, e[1] + d[1] * R, e[2] + d[2] * R];
    soft.alpha = fade * (0.42 + Math.sin(time * 15) * 0.1);
    billboard(soft, view.cam, at(head), 5.5, tileRect('smoke'), 1, 0.9, 0.62, 3);
    for (let i = 20; i >= 0; i -= 1) {
      const k = 1 - i / 21;
      soft.alpha = fade * (i === 0 ? 1 : 0.8 * k);
      billboard(soft, view.cam, at(starDir(s, i * 0.0095)), i === 0 ? 2.3 : 0.35 + 1.5 * k, tileRect('spark'), 1, 0.96 - i * 0.012, 0.62 + k * 0.38, 3, time * 3 + i * 0.7);
    }
    soft.flags = 0;
    soft.alpha = 1;
  }
  // Short gold markers over deck cells worth a look (a turret just bolted on).
  for (const p of game.pings) {
    const [x, y, z] = game.fortress.toWorld(p.local[0] + 0.5, p.local[1] + 1, p.local[2] + 0.5);
    soft.flags = F_OVERLAY | F_UNLIT;
    soft.tint = [1, 0.82, 0.3];
    soft.emit = 1.5;
    soft.alpha = 0.55 + Math.sin(time * 4) * 0.15;
    beam(soft, [x, y, z], [x, y + 3 + Math.sin(time * 3) * 0.3, z], 0.2, [tileRect('quest_beam')], 0.2, [1, 0, 0]);
    soft.flags = 0;
    soft.tint = [1, 1, 1];
    soft.emit = 0;
    soft.alpha = 1;
  }
  // Beacons over the next step (gold, red when urgent) and a mapped hoard, seen across the valley.
  const goals: Array<{ at: Vec3; tint: Vec3 }> = [];
  const next = game.goalTarget();
  if (next) goals.push({ at: next, tint: game.goal?.tone === 'danger' ? [1, 0.38, 0.24] : [1, 0.82, 0.3] });
  const hoard = game.phase === 'day' ? treasureTarget(game) : null;
  if (hoard && game.goal?.tag !== 'TREASURE') goals.push({ at: [hoard.x, hoard.y, hoard.z], tint: [1, 0.82, 0.3] });
  for (const { at: goal, tint } of goals) {
    const d = Math.hypot(goal[0] - e[0], goal[2] - e[2]);
    if (d < 6) continue;
    // From the ground, or (for a spot up on the fortress) from the spot itself.
    const ground = w.groundAt(goal[0], goal[2]);
    const gy = goal[1] > ground + 3 ? goal[1] - 0.5 : ground;
    soft.flags = F_OVERLAY | F_UNLIT;
    soft.tint = tint;
    soft.emit = 1.5;
    // A spot on the fortress gets a short marker; close by, a beam fades (the gold line says the rest).
    const deck = goal === next && game.goalLocal !== null;
    soft.alpha = (0.45 + Math.sin(time * 2.5) * 0.1) * Math.min(1, Math.max(deck ? 0.6 : 0.2, (d - 6) / 18));
    const top = deck ? gy + 2.5 + Math.sin(time * 3) * 0.25 : gy + 48;
    shaft(soft, e, [goal[0], gy, goal[2]], top, deck ? 0.3 : 0.6, tileRect('quest_beam'));
    soft.flags = 0;
    soft.tint = [1, 1, 1];
    soft.emit = 0;
    soft.alpha = 1;
  }
  // A big gold chevron bobbing over the next spot (a lesson's spot while one is up), pointing
  // down at it; it grows with distance so it reads from across the village.
  const spot = game.lessonMark ?? next;
  if (spot && game.isPlaying()) {
    const next = spot;
    const d = Math.hypot(next[0] - e[0], next[1] - e[1], next[2] - e[2]);
    if (d > 3 && d < 110) {
      const s = 0.32 + d * 0.02;
      const y = next[1] + 0.5 + s + Math.abs(Math.sin(time * 3.4)) * s * 0.7;
      const c = view.cam;
      const rl = Math.hypot(c.r[0], c.r[2]) || 1;
      const rx = c.r[0] / rl;
      const rz = c.r[2] / rl;
      const tip: Vec3 = [next[0], y, next[2]];
      const thick = s * 0.2;
      const white = [tileRect('white')];
      soft.flags = F_OVERLAY | F_UNLIT;
      soft.emit = 0.9;
      soft.alpha = 0.95;
      // A dark rim under the gold so it reads against a bright sky.
      for (const [k, tint] of [[1.45, [0.12, 0.08, 0.02]], [1, game.goal?.tone === 'danger' ? [1, 0.36, 0.22] : [1, 0.8, 0.22]]] as const) {
        soft.tint = [tint[0], tint[1], tint[2]];
        for (const side of [-1, 1]) {
          const arm: Vec3 = [next[0] + rx * s * side, y + s, next[2] + rz * s * side];
          beam(soft, arm, tip, thick * k, white, thick * 0.5, c.f);
        }
      }
      soft.flags = 0;
      soft.tint = [1, 1, 1];
      soft.emit = 0;
      soft.alpha = 1;
    }
  }
  // Snow drifting down over the snowfields; spores hanging in the blighted air.
  const flakes = Math.round(110 * game.region.snow);
  const spores = Math.round(45 * game.region.blight);
  if (flakes + spores > 0) {
    soft.flags = F_OVERLAY;
    soft.sky = 1;
    soft.blk = 0;
    const flakeTex = tileRect('snowflake');
    const sporeTex = tileRect('spark');
    for (let i = 0; i < flakes + spores; i += 1) {
      const spore = i >= flakes;
      const h1 = Math.sin(i * 91.7 + 3.1) * 43758.5453;
      const h2 = Math.sin(i * 17.3 + 9.4) * 12543.123;
      const fx = h1 - Math.floor(h1);
      const fz = h2 - Math.floor(h2);
      const a = fx * Math.PI * 2;
      const r = 1.5 + fz * 16;
      const speed = spore ? 0.25 : 1.8;
      const fall = (time * speed + fx * 30) % 16;
      const x = e[0] + Math.cos(a) * r + Math.sin(time * 0.7 + i) * (spore ? 1.2 : 0.6);
      const z = e[2] + Math.sin(a) * r + Math.cos(time * 0.6 + i * 1.3) * (spore ? 1.2 : 0.6);
      const y = spore ? e[1] - 3 + ((fx * 7 + time * 0.2) % 8) : e[1] + 8 - fall;
      if (!view.inView(x, y, z, 0.5) || y < w.topAt(x, z) + 1) continue;
      soft.alpha = spore ? 0.55 : 0.8;
      if (spore) billboard(soft, view.cam, [x, y, z], 0.05, sporeTex, 0.7, 0.45, 1, 0.8);
      else billboard(soft, view.cam, [x, y, z], 0.06, flakeTex, 1, 1, 1, 0.15);
    }
    soft.flags = 0;
    soft.alpha = 1;
  }
  // Ash sifting down and embers rising over the ember wastes; fireflies over the swamp and the
  // green valley after dusk; red dust blowing through the badlands, pale sand over the desert;
  // seeds and pollen drifting in the green valley's sunshine.
  const R = game.region;
  const green = clamp(1 - R.desert - R.snow - R.blight - R.swamp - R.badlands - R.ember, 0, 1);
  const dusk = clamp(env.night * 1.4 + env.sunset * 0.6, 0, 1);
  const ash = Math.round(80 * R.ember);
  const flies = Math.round((34 * R.swamp + 22 * green) * dusk);
  const dust = Math.round(40 * R.badlands);
  const sand = Math.round(36 * R.desert * clamp(env.daylight * 1.5, 0, 1));
  const pollen = Math.round(28 * green * clamp(env.daylight * 1.4 - env.sunset, 0, 1) * (1 - game.weather.storm));
  if (ash + flies + dust + sand + pollen > 0) {
    soft.flags = F_OVERLAY;
    soft.sky = 1;
    soft.blk = 0;
    const flakeTex = tileRect('snowflake');
    const glowTex = tileRect('spark');
    for (let i = 0; i < ash + flies + dust + sand + pollen; i += 1) {
      const kind = i < ash ? (i % 3 === 0 ? 'ember' : 'ash') : i < ash + flies ? 'fly' : i < ash + flies + dust ? 'dust' : i < ash + flies + dust + sand ? 'sand' : 'pollen';
      const h1 = Math.sin(i * 63.1 + 1.7) * 43758.5453;
      const h2 = Math.sin(i * 29.9 + 5.2) * 12543.123;
      const fx = h1 - Math.floor(h1);
      const fz = h2 - Math.floor(h2);
      const a = fx * Math.PI * 2;
      const r = 1.5 + fz * (kind === 'fly' ? 12 : 16);
      let x = e[0] + Math.cos(a) * r;
      let z = e[2] + Math.sin(a) * r;
      let y: number;
      if (kind === 'ash') {
        y = e[1] + 8 - ((time * 0.7 + fx * 30) % 14);
        x += Math.sin(time * 0.5 + i) * 0.9;
        z += Math.cos(time * 0.4 + i * 1.7) * 0.9;
      } else if (kind === 'ember') {
        y = e[1] - 4 + ((time * 1.3 + fx * 20) % 12);
        x += Math.sin(time * 1.6 + i) * 0.5;
        z += Math.cos(time * 1.4 + i) * 0.5;
      } else if (kind === 'fly') {
        y = e[1] - 1.5 + Math.sin(time * 0.7 + i * 2.3) * 1.6 + fz * 2;
        x += Math.sin(time * 0.45 + i * 1.1) * 2.2;
        z += Math.cos(time * 0.38 + i * 0.7) * 2.2;
      } else if (kind === 'pollen') {
        // Lazy loops on a summer breeze, never quite settling.
        y = e[1] - 1 + Math.sin(time * 0.33 + i * 1.7) * 1.8 + fz * 3;
        x += Math.sin(time * 0.21 + i * 0.9) * 2.6 + ((time * 0.35 + fx * 9) % 6) - 3;
        z += Math.cos(time * 0.17 + i * 1.3) * 2.6;
      } else {
        // Blown along on the canyon wind, low over the ground.
        const run = (time * 5 + fx * 40) % 32;
        x = e[0] - 16 + run;
        z = e[2] + (fz - 0.5) * 28 + Math.sin(time * 2 + i) * 0.4;
        y = e[1] - 1.2 + Math.sin(time * 3 + i * 1.9) * 0.5 + fx * 2.2;
      }
      if (!view.inView(x, y, z, 0.5) || y < w.topAt(x, z) + 1) continue;
      if (kind === 'ash') {
        soft.alpha = 0.7;
        billboard(soft, view.cam, [x, y, z], 0.055, flakeTex, 0.42, 0.4, 0.4, 0);
      } else if (kind === 'ember') {
        soft.alpha = 0.85;
        billboard(soft, view.cam, [x, y, z], 0.045, glowTex, 1, 0.5, 0.16, 1.6);
      } else if (kind === 'fly') {
        // Each one blinks on and off in its own time.
        const blink = Math.max(0, Math.sin(time * (1.3 + fz) + i * 4.1));
        if (blink < 0.15) continue;
        soft.alpha = 0.95 * blink;
        billboard(soft, view.cam, [x, y, z], 0.05, glowTex, 0.82, 1, 0.35, 2);
      } else if (kind === 'pollen') {
        // (Catching the sun as they turn.)
        soft.alpha = 0.45 + 0.35 * Math.max(0, Math.sin(time * 2.1 + i * 2.9));
        billboard(soft, view.cam, [x, y, z], 0.032, glowTex, 1, 0.97, 0.78, 0.35);
      } else if (kind === 'sand') {
        soft.alpha = 0.5;
        billboard(soft, view.cam, [x, y, z], 0.035, glowTex, 0.93, 0.83, 0.58, 0);
      } else {
        soft.alpha = 0.55;
        billboard(soft, view.cam, [x, y, z], 0.04, glowTex, 0.78, 0.45, 0.25, 0);
      }
    }
    soft.flags = 0;
    soft.alpha = 1;
  }
  drawBirds(game, soft, e, time, env.daylight);
  // The beacon on the Engine Core (lit with the Wither's Nether Star): a cyan beam to the sky.
  if (game.beacon) {
    const key = game.coreKey();
    if (key !== null && F.blockAt(kx(key), ky(key) + 1, kz(key)) === B.BEACON) {
      const base = F.toWorld(kx(key) + 0.5, ky(key) + 1.95, kz(key) + 0.5);
      const top: Vec3 = [base[0], base[1] + 96, base[2]];
      const pulse = 0.55 + Math.sin(time * 2.2) * 0.08;
      soft.flags = F_OVERLAY | F_UNLIT;
      soft.tint = [0.45, 0.9, 1];
      soft.emit = 2;
      soft.alpha = pulse;
      beam(soft, base, top, 0.17, [tileRect('white')], 0.17, [1, 0, 0]);
      soft.alpha = pulse * 0.3;
      beam(soft, base, top, 0.36, [tileRect('white')], 0.36, [1, 0, 0]);
      soft.flags = 0;
      soft.tint = [1, 1, 1];
      soft.emit = 0;
      soft.alpha = 1;
    }
  }
  if (game.siege && game.siegeStage !== 'heart') {
    const st = w.structures.byId.get('citadel');
    if (st) {
      const hx = (st.minX + st.maxX + 1) / 2;
      const hz = (st.minZ + st.maxZ + 1) / 2;
      const hy = st.floorY + 29.5;
      soft.flags = F_OVERLAY | F_UNLIT;
      soft.tint = [0.35, 1, 0.45];
      soft.emit = 2;
      soft.alpha = 0.55 + Math.sin(time * 6) * 0.15;
      for (const py of game.pylons) if (py.alive) beam(soft, [py.x, py.y, py.z], [hx, hy, hz], 0.22, [tileRect('quest_beam')]);
      soft.flags = 0;
      soft.tint = [1, 1, 1];
      soft.emit = 0;
      soft.alpha = 1;
    }
  }

  // ---- the stomp: its reach ringed on the ground as it winds up, shock rings rolling out after the slam
  drawStomp(game, soft);

  // ---- particles: chips of block texture, and soft sprites
  const cut = out.cutout;
  for (const q of game.particles.list) {
    if (!near(q.x, q.y, q.z, 120) || !view.inView(q.x, q.y, q.z, q.size + 0.5)) continue;
    if (!q.soft) {
      const t: TexRect = q.tile === 'white' ? tileRect('white') : subRect(q.tile, q.u, q.v, q.u + 6, q.v + 6);
      const [s, l] = q.emit > 0 ? [1, 1] : game.lightAt(q.x, q.y, q.z);
      const target = q.emit > 0 ? soft : cut;
      target.sky = s;
      target.blk = l;
      if (q.emit > 0) {
        target.flags = F_OVERLAY;
        target.alpha = clamp(q.life / q.max * 2, 0, 1);
      }
      billboard(target, view.cam, [q.x, q.y, q.z], q.size / 2, t, q.r, q.g, q.b, q.emit);
      target.flags = 0;
      target.alpha = 1;
      continue;
    }
    const life = q.life / q.max;
    // Fade in quickly, out slowly.
    const a = q.a * Math.min(1, (1 - life) * 6) * Math.min(1, life * 1.6);
    if (a <= 0.01) continue;
    const [s, l] = q.emit > 0 ? [1, 1] : game.lightAt(q.x, q.y, q.z);
    soft.sky = s;
    soft.blk = l;
    soft.flags = F_OVERLAY;
    soft.alpha = a;
    billboard(soft, view.cam, [q.x, q.y, q.z], q.size / 2, tileRect(q.tile), q.r, q.g, q.b, q.emit, q.spin);
  }
  soft.flags = 0;
  soft.alpha = 1;
}

/**
 * A shaft of light standing up from a spot, turned to face the eye: one soft beam from any side
 * (a box of the same texture shows two bright edges side by side).
 */
function shaft(b: MeshBuilder, eye: Vec3, base: Vec3, top: number, hw: number, t: TexRect): void {
  const vx = base[0] - eye[0];
  const vz = base[2] - eye[2];
  const l = Math.hypot(vx, vz) || 1;
  const rx = (-vz / l) * hw;
  const rz = (vx / l) * hw;
  b.quad([base[0] - rx, base[1], base[2] - rz, base[0] - rx, top, base[2] - rz, base[0] + rx, top, base[2] + rz, base[0] + rx, base[1], base[2] + rz], t, -vx / l, 0, -vz / l);
}

/**
 * Birds wheeling high over the lands by day: loose flocks circling on the wind, beating their
 * wings then gliding. Crows over the blight; none in the ember wastes' smoke or the snow's cold.
 */
function drawBirds(game: Game, soft: MeshBuilder, e: Vec3, time: number, daylight: number): void {
  const R = game.region;
  const k = clamp(daylight * 1.4 - 0.25, 0, 1) * clamp(1 - R.ember - R.snow * 0.6, 0, 1) * (1 - game.weather.storm);
  if (k < 0.05) return;
  const crows = R.blight;
  const white = tileRect('white');
  soft.flags = F_OVERLAY | F_UNLIT;
  soft.sky = 1;
  soft.blk = 0;
  soft.emit = 0;
  const shade = 0.06 + 0.05 * (1 - crows);
  soft.tint = [shade, shade, shade * 1.1];
  soft.alpha = 0.9 * k;
  for (let f = 0; f < 2; f += 1) {
    // Each flock's centre drifts slowly round the sky over you.
    const dir = f === 1 ? -1 : 1;
    const fa = time * 0.013 * dir + f * 2.7;
    const fr = 30 + f * 18;
    const cx = e[0] + Math.cos(fa) * fr;
    const cz = e[2] + Math.sin(fa) * fr;
    const cy = e[1] + 22 + f * 8 - crows * 6;
    const n = f === 0 ? 6 : 4;
    for (let i = 0; i < n; i += 1) {
      const ph = i * 1.37 + f * 5.1;
      const a = time * (0.22 + 0.03 * Math.sin(ph)) * dir + ph;
      const r = 5 + (i % 3) * 2.2 + Math.sin(time * 0.3 + ph) * 1.2;
      const px = cx + Math.cos(a) * r;
      const pz = cz + Math.sin(a) * r;
      const py = cy + Math.sin(time * 0.5 + ph * 2) * 1.5;
      // Heading along the circle; wings beating, then a long glide.
      const hx = -Math.sin(a) * dir;
      const hz = Math.cos(a) * dir;
      const glide = Math.sin(time * 0.6 + ph) > 0.2 ? 0.15 : 1;
      const flap = 0.25 + Math.sin(time * 9 + ph * 3) * 0.55 * glide;
      const size = (crows > 0.5 ? 1.0 : 0.75) * (0.85 + 0.15 * Math.sin(ph * 7));
      const span = 1.05 * size;
      const ch = 0.28 * size;
      for (const side of [-1, 1]) {
        const ox = -hz * side * Math.cos(flap) * span;
        const oz = hx * side * Math.cos(flap) * span;
        const oy = Math.sin(flap) * span;
        soft.quad([
          px - hx * ch, py, pz - hz * ch,
          px + hx * ch, py, pz + hz * ch,
          px + ox + hx * ch * 0.3, py + oy, pz + oz + hz * ch * 0.3,
          px + ox - hx * ch * 0.5, py + oy, pz + oz - hz * ch * 0.5,
        ], white, 0, 1, 0);
      }
    }
  }
  soft.flags = 0;
  soft.alpha = 1;
  soft.tint = [1, 1, 1];
}

/** A creature's model by its kind (its overlays on the layers given; none for a pancake). */
function drawMob(game: Game, b: MeshBuilder, L: MobLayers, mob: Actor, time: number): void {
  switch (mob.kind) {
    case 'skeleton':
    case 'stray':
    case 'witherskel':
      skeletonModel(b, L, mob, time);
      return;
    case 'creeper':
      creeperModel(b, L, mob, time);
      return;
    case 'spider':
    case 'cavespider':
      spiderModel(b, mob, time);
      return;
    case 'phantom':
      phantomModel(b, mob, time);
      return;
    case 'enderman':
      endermanModel(b, L, mob, time);
      return;
    case 'witch':
      witchModel(b, L, mob, time);
      return;
    case 'slime':
      slimeModel(b, L, mob, time);
      // The Slime King wears its crown (riding the squash and stretch of its hops).
      if (mob.boss && mob.deathT < 0) {
        const sq = mob.act === 'pounce' ? 0.25 : !mob.onGround ? -0.15 : 0;
        crown(b, [mob.x, mob.y + mob.h * (1 - sq) - 0.02, mob.z], mob.yaw, mob.hw * 1.05);
      }
      return;
    case 'pillager':
    case 'vindicator':
      illagerModel(b, L, mob, time);
      return;
    case 'evoker':
      evokerModel(b, L, mob, time);
      return;
    case 'vex':
      vexModel(b, L, mob, time);
      return;
    case 'ravager':
      ravagerModel(b, L, mob, time);
      // The Ravager King goes armoured in iron and gold.
      if (mob.boss) ravagerArmor(L, mob, time, b);
      return;
    case 'ghast':
      ghastModel(b, L, mob, time);
      return;
    case 'wither':
      witherModel(b, L, mob, time, witherPose(game, mob));
      return;
    default:
      if (!drawCreature(game, b, L, mob, time)) zombieModel(b, L, mob, time);
  }
}

/** The soft shadow under a creature's feet (none for fliers). */
function shadowRadius(m: Actor): number {
  const own = creatureShadow(m);
  if (own !== null) return own;
  switch (m.kind) {
    case 'phantom':
    case 'vex':
    case 'ghast':
    case 'wither':
      return 0;
    case 'spider':
      return 0.7;
    case 'cavespider':
      return 0.45;
    case 'ravager':
      return 1.25;
    case 'slime':
      return 0.18 + m.size * 0.24;
    default:
      return m.baby ? 0.26 : 0.42;
  }
}

/** A ghast's fireball: a tumbling lump of molten rock in a flame glow (white-gold once batted back). */
function fireball(b: MeshBuilder, soft: MeshBuilder, cam: Basis, x: number, y: number, z: number, age: number, back: boolean): void {
  const c: Vec3 = [x, y, z];
  const bs = pitchBasis(yawBasis(age * 7), age * 5);
  b.emit = 1;
  b.tint = back ? [1, 0.95, 0.75] : [1, 0.55, 0.32];
  b.box(c, scale(bs.f, 0.24), scale(bs.u, 0.24), scale(bs.r, 0.24), [tileRect('lava_still')]);
  b.emit = 0;
  b.tint = WHITE;
  soft.flags = F_OVERLAY | F_UNLIT;
  soft.alpha = 0.85;
  billboard(soft, cam, c, 0.55 + Math.sin(age * 23) * 0.05, tileRect('flame'), 1, back ? 0.95 : 0.5, back ? 0.65 : 0.18, 2, age * 5);
  soft.alpha = 0.45;
  billboard(soft, cam, c, back ? 1.2 : 0.95, tileRect('spark'), 1, back ? 0.92 : 0.5, back ? 0.55 : 0.15, 1.5, -age * 3);
  soft.flags = 0;
  soft.alpha = 1;
}

/** One of the Wither's skulls: a little black head flying face first (the blue one glows). */
function witherSkull(b: MeshBuilder, soft: MeshBuilder, cam: Basis, x: number, y: number, z: number, v: Vec3, blue: boolean, age: number): void {
  const d = normalize(v);
  const bs = pitchBasis(yawBasis(Math.atan2(d[2], d[0])), -Math.asin(clamp(d[1], -1, 1)));
  const sk = uvs('wither', 0, 0, 8, 8, 8);
  const half = blue ? 0.2 : 0.16;
  const c: Vec3 = [x, y, z];
  b.tint = blue ? [0.55, 0.75, 1] : WHITE;
  b.emit = blue ? 0.6 : 0.05;
  b.box(c, scale(bs.f, half), scale(bs.u, half), scale(bs.r, half), [tileRect('wither_skull'), sk[1]!, sk[2]!, sk[3]!, sk[4]!, sk[5]!]);
  b.tint = WHITE;
  b.emit = 0;
  soft.flags = F_OVERLAY | F_UNLIT;
  if (blue) {
    // The blue skull glows through a pale blue shell.
    soft.tint = [0.5, 0.75, 1];
    soft.emit = 1;
    soft.alpha = 0.42;
    const k = half * 1.14;
    soft.box(c, scale(bs.f, k), scale(bs.u, k), scale(bs.r, k), [tileRect('white')]);
    soft.tint = WHITE;
    soft.emit = 0;
  }
  soft.alpha = blue ? 0.6 : 0.3;
  billboard(soft, cam, c, blue ? 0.6 : 0.4, tileRect('spark'), blue ? 0.5 : 0.35, blue ? 0.75 : 0.3, blue ? 1 : 0.45, 1.2, age * 4);
  soft.flags = 0;
  soft.alpha = 1;
}

/**
 * Squashed under a fortress foot: the creature laid out flat on its back (feet at the foot's rim,
 * head pointing away) and pressed thin, with a little jelly wobble as it lands.
 */
function drawPancake(game: Game, b: MeshBuilder, c: Actor, time: number): void {
  const from = b.verts;
  const t = c.deathT;
  const hurt = c.hurt;
  c.deathT = -1;
  c.hurt = 0;
  // Only the solid builder's vertices are pressed flat: no overlays.
  drawMob(game, b, { cut: null, soft: null }, c, time);
  c.deathT = t;
  c.hurt = hurt;
  const wob = Math.exp(-t * 7);
  const thin = 0.16 + Math.max(0, Math.sin(t * 24)) * wob * 0.22;
  const wide = 1.2 + Math.max(0, Math.sin(t * 24 + 1.2)) * wob * 0.16;
  const fx = Math.cos(c.yaw);
  const fz = Math.sin(c.yaw);
  const y0 = c.y + 0.03;
  b.transformSince(from, (p) => {
    const dx = p[0] - c.x;
    const dz = p[2] - c.z;
    const along = dx * fx + dz * fz;
    const side = (-dx * fz + dz * fx) * wide;
    // What stood up now lies back behind it; its front faces the sky.
    const back = -(p[1] - c.y) * wide;
    return [c.x + fx * back - fz * side, y0 + (along + 0.25) * thin, c.z + fz * back + fx * side];
  }, (n) => {
    const along = (n[0] * fx + n[2] * fz) / thin;
    const side = (-n[0] * fz + n[2] * fx) / wide;
    const back = -n[1] / wide;
    return normalize([fx * back - fz * side, along, fz * back + fx * side]);
  });
}

/** A flat ring laid over the ground (each segment's ends sit on the ground beneath them, kept near y0). */
function groundRing(b: MeshBuilder, game: Game, x: number, z: number, y0: number, r0: number, r1: number, t: TexRect, dashed = false): void {
  const w = game.world;
  const seg = Math.max(24, Math.min(72, Math.round(r1 * 3)));
  const at = (r: number, a: number): Vec3 => {
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    return [px, clamp(w.groundAt(px, pz), y0 - 4, y0 + 2) + 0.12, pz];
  };
  for (let i = 0; i < seg; i += 1) {
    if (dashed && i % 3 === 2) continue;
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    b.quad([...at(r0, a0), ...at(r1, a0), ...at(r1, a1), ...at(r0, a1)], t, 0, 1, 0);
  }
}

/** The stomp on the ground: the reach it will cover while it winds up, then its shock rings. */
function drawStomp(game: Game, soft: MeshBuilder): void {
  const p = game.pound;
  const white = tileRect('white');
  if (!p?.held && game.shocks.length === 0) return;
  soft.flags = F_OVERLAY | F_UNLIT;
  soft.sky = 1;
  soft.blk = 1;
  if (p?.held) {
    // Winding up: a dashed ring marks how far the slam will fling them (it grows as you hold).
    const c = game.fortressCentre();
    const y0 = game.world.groundAt(c[0], c[2]);
    const r = poundReach(game, p.charge);
    const pulse = 0.6 + Math.sin(game.time * 14) * 0.15;
    soft.tint = p.charge >= 1 ? [1, 0.8, 0.25] : [1, 0.45, 0.12];
    soft.emit = 0.4;
    soft.alpha = pulse;
    groundRing(soft, game, c[0], c[2], y0, r - 0.3, r + 0.3, white, true);
  }
  for (const s of game.shocks) {
    if (s.t < 0) continue;
    const u = clamp(s.t / s.life, 0, 1);
    const ease = 1 - (1 - u) * (1 - u);
    const r = s.r0 + (s.r1 - s.r0) * ease;
    const width = s.width * (1 - 0.5 * u);
    const fade = (1 - u) ** 1.4;
    // A band of dust thickening towards its bright leading edge.
    soft.tint = [0.95, 0.78, 0.55];
    soft.emit = 0.1 + s.power * 0.15;
    for (let k = 0; k < 3; k += 1) {
      const a0 = r - width + (width * k) / 3;
      const a1 = r - width + (width * (k + 1)) / 3;
      soft.alpha = fade * (0.1 + 0.22 * (k + 1)) * (0.8 + s.power * 0.4);
      groundRing(soft, game, s.x, s.z, s.y, Math.max(0, a0), a1, white);
    }
    soft.tint = [1, 0.95, 0.82];
    soft.emit = 0.5;
    soft.alpha = fade * (0.55 + s.power * 0.3);
    groundRing(soft, game, s.x, s.z, s.y, r, r + 0.18 + s.power * 0.16, white);
  }
  soft.flags = 0;
  soft.tint = [1, 1, 1];
  soft.emit = 0;
  soft.alpha = 1;
}

/** A vertical streak (a raindrop) facing the camera. */
function streak(b: MeshBuilder, c: Vec3, rx: Vec3, hw: number, hh: number, t: TexRect): void {
  const p = [
    c[0] - rx[0] * hw, c[1] - hh, c[2] - rx[2] * hw,
    c[0] - rx[0] * hw, c[1] + hh, c[2] - rx[2] * hw,
    c[0] + rx[0] * hw, c[1] + hh, c[2] + rx[2] * hw,
    c[0] + rx[0] * hw, c[1] - hh, c[2] + rx[2] * hw,
  ];
  b.tint = [0.7, 0.78, 0.9];
  b.quad(p, t, -rx[2], 0, rx[0]);
  b.tint = [1, 1, 1];
}

