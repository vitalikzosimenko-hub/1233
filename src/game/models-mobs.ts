// Monster models (Minecraft-style box models on the skin atlas). The horde first: zombies (babies,
// zombie villagers, zombies in iron), husks, skeletons and strays drawing their bows, wither
// skeletons, creepers (swelling, flashing, crackling blue when charged), spiders and cave spiders
// crouching to pounce, phantoms shrieking before the dive. Then the valley's other monsters:
// endermen, witches, slimes, the illagers and their ravager, vexes, ghasts, and the Wither.
// Heads track you as you move about them; struck monsters flash red; the dying topple.
import { blockCube, bodyBasis, flashOf, limb, part, pitchBasis, rollBasis, scale, add, sprite, spar, uvs, WHITE, yawBasis, beam, type Basis } from './models';
import type { Actor } from './entities';
import { F_FLAT, F_OVERLAY, F_UNLIT, type MeshBuilder, type TexRect } from './gl';
import { normalize, type Vec3 } from './math3d';
import { subRect, tileRect } from './mesher';
import { POTION_RGB } from './monsters';
import { witherHeads, type WitherHead } from './bosses';

/** Where a mob's overlays go: armour and rags (cut-out), auras and slime jelly (blended). */
export interface MobLayers {
  cut: MeshBuilder | null;
  soft: MeshBuilder | null;
}

/** The Wither's pose (from its fight): waking (how far), armoured, dying, its heads, the dash tell. */
export interface WitherDraw {
  grow: number;
  armored: boolean;
  dying: number;
  heads: WitherHead[] | null;
  tell: number;
}

// ------------------------------------------------------------------ shared helpers

/** The head's frame: the body's facing turned by where its eyes track you (the falling keep the body's). */
function headBasis(a: Actor, base: Basis): Basis {
  if (a.deathT >= 0) return base;
  return pitchBasis(yawBasis(a.yaw + a.headYaw), -a.headPitch);
}

/** A held item's extruded sprite, gripped at its handle, its blade along `along`, lying in the plane facing `normal`. */
function held(b: MeshBuilder, icon: string, hand: Vec3, along: Vec3, normal: Vec3, size: number, tint: Vec3 = WHITE): void {
  const t = normalize(along);
  const n = normalize(normal);
  const across = normalize([n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]);
  const x = scale(normalize(add(t, scale(across, -1))), size);
  const y = scale(normalize(add(t, across)), size);
  const z = scale(n, size);
  const grip: Vec3 = [-0.32, -0.32, 0];
  const o = add(hand, scale(add(scale(x, grip[0]), scale(y, grip[1])), -1));
  b.tint = tint;
  sprite(b, icon, { x, y, z, t: o });
  b.tint = WHITE;
}

/** Point at the far end of a limb (its hand or foot), and the limb's own frame. */
function limbEnd(o: Vec3, basis: Basis, px: number, pivot: Vec3, angle: number, len: number, roll = 0): { at: Vec3; frame: Basis } {
  const lb = rollBasis(pitchBasis(basis, angle), roll);
  const p = add(o, add(scale(basis.f, pivot[0] * px), add(scale(basis.u, pivot[1] * px), scale(basis.r, pivot[2] * px))));
  return { at: add(p, scale(lb.u, -len * px)), frame: lb };
}

/** The six faces of the charge tile, sliding across it (a charged creeper's crackle, the Wither's armour). */
function chargeFaces(time: number, speed = 9): TexRect[] {
  const off = (time * speed) % 16;
  const r = subRect('charge', off, off, off + 16, off + 16);
  return [r, r, r, r, r, r];
}

/** An aura shell (blended, self-lit) over a box drawn with part(): inflate it by k. */
function auraPart(s: MeshBuilder, o: Vec3, basis: Basis, px: number, cx: number, cy: number, cz: number, w: number, h: number, d: number, faces: TexRect[], k = 1.18): void {
  const c = add(o, add(scale(basis.f, cx * px), add(scale(basis.u, cy * px), scale(basis.r, cz * px))));
  s.box(c, scale(basis.f, (d / 2) * px * k), scale(basis.u, (h / 2) * px * k), scale(basis.r, (w / 2) * px * k), faces);
}

/** An aura shell over a limb drawn with limb(). */
function auraLimb(s: MeshBuilder, o: Vec3, basis: Basis, px: number, pivot: Vec3, angle: number, w: number, h: number, d: number, faces: TexRect[], k = 1.2): void {
  const lb = pitchBasis(basis, angle);
  const p = add(o, add(scale(basis.f, pivot[0] * px), add(scale(basis.u, pivot[1] * px), scale(basis.r, pivot[2] * px))));
  const c = add(p, scale(lb.u, (-h / 2) * px));
  s.box(c, scale(lb.f, (d / 2) * px * k), scale(lb.u, (h / 2) * px * k), scale(lb.r, (w / 2) * px * k), faces);
}

/** Starts an aura pass on the blended builder (light blue, self-lit, see-through). */
function auraOn(s: MeshBuilder, alpha: number): void {
  s.flags = F_OVERLAY | F_UNLIT;
  s.alpha = alpha;
  s.emit = 1;
  s.tint = [0.75, 0.9, 1];
}

function auraOff(s: MeshBuilder): void {
  s.flags = 0;
  s.alpha = 1;
  s.emit = 0;
  s.tint = WHITE;
}

/** How far through a move (0..1). */
function prog(a: Actor): number {
  return a.actDur > 0 ? Math.min(1, a.actT / a.actDur) : 0;
}

/** Leg swing of a walker from its stride (none when still or falling dead). */
function stride(a: Actor, k: number): number {
  return Math.hypot(a.vx, a.vz) > 0.2 && a.deathT < 0 ? Math.sin(a.walkPhase * Math.PI) * k : 0;
}

// ------------------------------------------------------------------ zombies

/**
 * Zombies, husks and zombie villagers: arms held out, shambling legs, arms rising as a blow winds
 * up. Babies are half size with a big head; later nights bring iron helmets and chestplates.
 */
export function zombieModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const skin = a.kind === 'husk' ? 'husk' : a.zvillager ? 'zvillager' : 'zombie';
  const zv = a.zvillager;
  const px = (a.baby ? a.h * 2 : a.h) / (zv ? 34 : 32) * (a.baby ? 0.5 : 1);
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const swing = stride(a, a.baby ? 0.95 : 0.7);
  const legUv = zv ? uvs(skin, 0, 22, 4, 12, 4) : uvs(skin, 0, 16, 4, 12, 4);
  limb(b, o, basis, px, [0, 12, -2], swing, 4, 12, 4, legUv);
  limb(b, o, basis, px, [0, 12, 2], -swing, 4, 12, 4, legUv);
  part(b, o, basis, px, 0, 18, 0, 8, 12, zv ? 6 : 4, zv ? uvs(skin, 16, 20, 8, 12, 6) : uvs(skin, 16, 16, 8, 12, 4));
  // Arms reach forward; they rise as a blow winds up, and drop after it lands.
  const windup = a.windup > 0 && a.actDur > 0 ? (1 - a.windup / a.actDur) * 0.75 : 0;
  const reach = -Math.PI / 2 + Math.sin(time * 3 + a.x) * 0.08 + (a.attackTimer > 0.7 ? -0.35 : 0) - windup;
  const armUv = zv ? uvs(skin, 44, 22, 4, 12, 4) : uvs(skin, 40, 16, 4, 12, 4);
  const sway = Math.sin(time * 2.1 + a.z) * 0.05;
  limb(b, o, basis, px, [0, 22, -6], reach + sway, 4, 12, 4, armUv);
  limb(b, o, basis, px, [0, 22, 6], reach - sway, 4, 12, 4, armUv);
  // The head: big on a baby; a zombie villager's is long, with the villager's nose.
  const hb = pitchBasis(headBasis(a, basis), Math.sin(time * 1.3 + a.z) * 0.08);
  const hp = a.baby ? px * 1.5 : px;
  const neck = 24 * px;
  if (zv) {
    part(b, o, hb, hp, 0, neck / hp + 5, 0, 8, 10, 8, uvs(skin, 0, 0, 8, 10, 8));
    part(b, o, hb, hp, 5, neck / hp + 2, 0, 2, 4, 2, uvs(skin, 24, 0, 2, 4, 2));
  } else part(b, o, hb, hp, 0, neck / hp + 4, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
  b.flash = 0;
  // Iron armour over it (a helmet; a chestplate and pauldrons on the toughest).
  const c = L.cut;
  if (c && a.armor > 0) {
    c.flash = flashOf(a);
    c.sky = b.sky;
    c.blk = b.blk;
    const k = 1.13;
    part(c, o, hb, hp * k, 0, (neck / hp + (zv ? 5 : 4)) / k, 0, 8, zv ? 10 : 8, 8, uvs('armor', 0, 0, 8, 8, 8));
    if (a.armor >= 2) {
      part(c, o, basis, px * 1.08, 0, 18 / 1.08, 0, 8, 12, zv ? 6 : 4, uvs('armor', 16, 16, 8, 12, 4));
      for (const side of [-1, 1]) limb(c, o, basis, px * 1.16, [0, 22 / 1.16, (side * 6) / 1.16], reach + side * sway * -1, 4, 5, 4, uvs('armor', 40, 16, 4, 5, 4));
    }
    c.flash = 0;
  }
}

// ------------------------------------------------------------------ skeletons

/**
 * Skeletons and strays draw their bows (the string comes back, an arrow is nocked, the bow bends);
 * a wither skeleton carries a stone sword and raises it for the blow. A spider jockey's skeleton
 * sits astride, legs forward.
 */
export function skeletonModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const skin = a.kind === 'stray' ? 'stray' : a.kind === 'witherskel' ? 'witherskel' : 'skeleton';
  const px = a.h / 32;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const riding = a.mount !== null && a.deathT < 0;
  const swing = riding ? 0 : stride(a, 0.6);
  const legUv = uvs(skin, 0, 16, 2, 12, 2);
  const legA = riding ? -Math.PI / 2 + 0.15 : swing;
  const legB = riding ? -Math.PI / 2 + 0.15 : -swing;
  limb(b, o, basis, px, [0, 12, -2], legA, 2, 12, 2, legUv, riding ? -0.32 : 0);
  limb(b, o, basis, px, [0, 12, 2], legB, 2, 12, 2, legUv, riding ? 0.32 : 0);
  part(b, o, basis, px, 0, 18, 0, 8, 12, 4, uvs(skin, 16, 16, 8, 12, 4));
  const armUv = uvs(skin, 40, 16, 2, 12, 2);
  const hb = headBasis(a, basis);
  if (a.kind === 'witherskel') {
    // The sword arm swings up as the blow winds up, and down as it lands.
    const windup = a.windup > 0 && a.actDur > 0 ? 1 - a.windup / a.actDur : 0;
    const sword = -Math.PI / 2 - 0.25 - windup * 1.6 + (a.attackTimer > 0.8 ? 0.6 : 0);
    limb(b, o, basis, px, [0, 22, 5], sword, 2, 12, 2, armUv);
    limb(b, o, basis, px, [0, 22, -5], stride(a, 0.5) * -1 - 0.15, 2, 12, 2, armUv);
    part(b, o, hb, px, 0, 28, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
    const hand = limbEnd(o, basis, px, [0, 22, 5], sword, 11);
    const ib = itemLayer(b, L, a);
    held(ib, 'ui_sword', hand.at, hand.frame.f, hand.frame.r, a.h * 0.42, [0.52, 0.52, 0.55]);
    ib.flash = 0;
    b.flash = 0;
    return;
  }
  // The bow arm points at you; the draw arm pulls the string back to the cheek.
  const draw = a.act === 'draw' && a.deathT < 0 ? prog(a) : 0;
  const aim = -Math.PI / 2 + Math.sin(time * 2 + a.x) * 0.04 - a.headPitch * 0.8;
  limb(b, o, basis, px, [0, 22, -5], aim, 2, 12, 2, armUv, -0.25);
  limb(b, o, basis, px, [0, 22, 5], aim + 0.2 + draw * 0.35, 2, 12, 2, armUv, 0.35 + draw * 0.4);
  part(b, o, hb, px, 0, 28, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
  // The bow: three bent staves in the left hand (it bends further at full draw), its string and an arrow.
  const bowHand = limbEnd(o, basis, px, [0, 22, -5], aim, 11, -0.25).at;
  const bf = normalize(add(basis.f, scale(basis.u, -Math.sin(a.headPitch) * 0.8)));
  const bu = normalize(add(basis.u, scale(basis.f, Math.sin(a.headPitch) * 0.8)));
  const wood = [tileRect('planks_spruce')];
  const bend = 0.25 + draw * 0.25;
  const tips: Vec3[] = [];
  for (const [dy, kk] of [[-5, -bend], [0, 0], [5, bend]] as const) {
    const c = add(bowHand, add(scale(bu, dy * px), scale(bf, -Math.abs(dy) * (0.3 + draw * 0.3) * px)));
    b.box(c, scale(bf, 0.6 * px), scale(normalize(add(bu, scale(bf, kk))), 3 * px), scale(basis.r, 0.6 * px), wood);
    if (dy !== 0) tips.push(add(c, add(scale(bu, Math.sign(dy) * 2.8 * px), scale(bf, -Math.abs(dy) * 0.25 * px))));
  }
  const nock = add(bowHand, scale(bf, -(1.4 + draw * 5) * px));
  const silk = [tileRect('wool_white')];
  for (const t of tips) beam(b, t, nock, 0.012, silk, 0.012);
  if (draw > 0.15) {
    // The nocked arrow, from the string out past the bow.
    beam(b, nock, add(nock, scale(bf, 9 * px)), 0.02, [tileRect('planks_oak')], 0.02);
    b.box(add(nock, scale(bf, 9.4 * px)), scale(bf, 0.5 * px), scale(bu, 0.6 * px), scale(basis.r, 0.6 * px), [tileRect('iron_block')]);
  }
  b.flash = 0;
  // A stray's tattered hood, tunic and leg wraps.
  const c = L.cut;
  if (c && a.kind === 'stray') {
    c.flash = flashOf(a);
    c.sky = b.sky;
    c.blk = b.blk;
    part(c, o, hb, px * 1.12, 0, 28 / 1.12, 0, 8, 8, 8, uvs('stray', 32, 0, 8, 8, 8));
    part(c, o, basis, px * 1.08, 0, 18 / 1.08, 0, 8, 12, 4, uvs('stray', 16, 32, 8, 12, 4));
    limb(c, o, basis, px * 1.3, [0, 12 / 1.3, -2 / 1.3], legA, 2, 12, 2, uvs('stray', 0, 32, 2, 12, 2), riding ? -0.32 : 0);
    limb(c, o, basis, px * 1.3, [0, 12 / 1.3, 2 / 1.3], legB, 2, 12, 2, uvs('stray', 0, 32, 2, 12, 2), riding ? 0.32 : 0);
    c.flash = 0;
  }
}

// ------------------------------------------------------------------ creepers

/** Creepers: four stubby legs, swelling and flashing white as the fuse burns; charged ones crackle in a blue shell. */
export function creeperModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const fuse = Math.min(1, a.fuse / 1.5);
  // The flashes come faster as the fuse runs down.
  const flashing = a.fuse > 0 && Math.floor(time * (6 + fuse * 14)) % 2 === 0;
  const swell = 1 + (a.fuse > 0 ? fuse * fuse * 0.28 + Math.sin(time * 40) * 0.012 * fuse : 0);
  const px = (a.h / 26) * swell;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  // A golden creeper glints as it runs.
  const skin = a.golden > 0 ? 'goldcreeper' : 'creeper';
  b.flash = flashOf(a);
  if (flashing) b.emit = 0.6;
  else if (a.golden > 0) b.emit = 0.18 + Math.max(0, Math.sin(time * 5 + a.x)) * 0.25;
  const step = stride(a, a.golden > 0 ? 0.8 : 0.5);
  const leg = uvs(skin, 0, 16, 4, 6, 4);
  const legs = [[2, -2, 1], [2, 2, -1], [-2, -2, -1], [-2, 2, 1]] as const;
  for (const [fx, fz, s] of legs) limb(b, o, basis, px, [fx, 6, fz], step * s, 4, 6, 4, leg);
  part(b, o, basis, px, 0, 12, 0, 8, 12, 4, uvs(skin, 16, 16, 8, 12, 4));
  const hb = headBasis(a, basis);
  part(b, o, hb, px, 0, 22, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
  b.flash = 0;
  b.emit = 0;
  const s = L.soft;
  if (s && a.charged && a.deathT < 0) {
    auraOn(s, 0.55);
    const faces = chargeFaces(time);
    for (const [fx, fz, sg] of legs) auraLimb(s, o, basis, px, [fx, 6, fz], step * sg, 4, 6, 4, faces);
    auraPart(s, o, basis, px, 0, 12, 0, 8, 12, 4, faces);
    auraPart(s, o, hb, px, 0, 22, 0, 8, 8, 8, faces);
    auraOff(s);
  }
}

// ------------------------------------------------------------------ spiders

/** Spiders (and the small blue cave spiders): eight splayed legs stepping in alternation; a crouch before the pounce. */
export function spiderModel(b: MeshBuilder, a: Actor, time: number): void {
  const cave = a.kind === 'cavespider';
  const skin = cave ? 'cavespider' : 'spider';
  const px = (0.95 / 16) * (cave ? 0.62 : 1);
  const crouch = a.act === 'pounce' && a.deathT < 0 ? Math.sin(prog(a) * Math.PI * 0.5) : 0;
  const o: Vec3 = [a.x, a.y - crouch * 3 * px, a.z];
  let basis = bodyBasis(a);
  // Clinging to a leg (or a wall): nose up the strut.
  if (a.climb || (!a.onGround && a.vy > 2 && a.deathT < 0 && a.act !== 'pounce')) basis = pitchBasis(basis, -1.1);
  b.flash = flashOf(a);
  const moving = (Math.hypot(a.vx, a.vz) > 0.2 || a.climb !== null) && a.deathT < 0;
  const ph = a.walkPhase * Math.PI * 1.6 + time * (moving ? 0 : 0.5);
  part(b, o, basis, px, -9, 9, 0, 10, 8, 12, uvs(skin, 0, 16, 10, 8, 12));
  part(b, o, basis, px, 0, 9, 0, 6, 6, 6, uvs(skin, 32, 0, 6, 6, 6));
  const hb = a.deathT >= 0 ? basis : pitchBasis(yawBasis(a.yaw + a.headYaw * 0.5), -a.headPitch * 0.5 + (a.climb ? -1.1 : 0));
  part(b, o, hb, px, 7, 9, 0, 8, 8, 8, uvs(skin, 0, 0, 8, 8, 8));
  const legUv = uvs(skin, 0, 40, 16, 2, 2);
  for (let i = 0; i < 4; i += 1) {
    for (const side of [-1, 1]) {
      const step = moving ? Math.sin(ph + i * 1.7 + (side > 0 ? Math.PI : 0)) : 0;
      const theta = Math.PI / 2 - (i - 1.5) * 0.5 + step * 0.22;
      // Crouched, the legs splay wide and bend; mid-leap they reach forward.
      const dip = 0.42 - Math.max(0, step) * 0.3 - crouch * 0.35 + (!a.onGround && a.deathT < 0 ? 0.2 : 0);
      const hx = Math.cos(theta);
      const hz = Math.sin(theta) * side;
      const dir = add(add(scale(basis.f, hx * Math.cos(dip)), scale(basis.r, hz * Math.cos(dip))), scale(basis.u, -Math.sin(dip)));
      const pivot = add(o, add(add(scale(basis.f, (1.5 - i) * 1.4 * px), scale(basis.u, 9 * px)), scale(basis.r, side * 3 * px)));
      spar(b, pivot, dir, basis.u, px, 16, 2, 2, legUv);
    }
  }
  b.flash = 0;
}

// ------------------------------------------------------------------ phantoms

/** Phantoms: a skeletal flier on two-jointed wings; before a dive it shrieks, wings thrown up. */
export function phantomModel(b: MeshBuilder, a: Actor, time: number): void {
  const px = 1.5 / 16;
  const o: Vec3 = [a.x, a.y + 0.3, a.z];
  let basis = bodyBasis(a);
  const climb = Math.atan2(a.vy, Math.hypot(a.vx, a.vz) || 1);
  basis = pitchBasis(basis, -Math.max(-0.9, Math.min(0.6, climb)));
  const scream = a.act === 'scream' && a.deathT < 0 ? Math.sin(prog(a) * Math.PI) : 0;
  b.flash = flashOf(a);
  if (scream > 0) b.emit = scream * 0.3;
  part(b, o, basis, px, 0, 0, 0, 5, 3, 9, uvs('phantom', 0, 0, 5, 3, 9));
  const head = pitchBasis(basis, -scream * 0.5);
  part(b, o, head, px, 7, 0.5, 0, 7, 3, 5, uvs('phantom', 0, 12, 7, 3, 5));
  const tail = pitchBasis(basis, Math.sin(time * 3 + a.x) * 0.2);
  part(b, o, tail, px, -7.5, 0, 0, 3, 2, 6, uvs('phantom', 32, 0, 3, 2, 6));
  const flap = scream > 0 ? 0.9 + scream * 0.5 : Math.sin(a.walkPhase) * 0.55;
  for (const side of [-1, 1]) {
    // Inner wing from the shoulder, then the tip folding a little further on each beat.
    const out = add(scale(basis.r, side * Math.cos(flap)), scale(basis.u, Math.sin(flap)));
    const shoulder = add(o, scale(basis.r, side * 2.5 * px));
    spar(b, shoulder, out, basis.u, px, 6, 2, 9, uvs('phantom', 0, 24, 6, 2, 9));
    const tipFlap = flap * 1.6;
    const outTip = add(scale(basis.r, side * Math.cos(tipFlap)), scale(basis.u, Math.sin(tipFlap)));
    spar(b, add(shoulder, scale(out, 6 * px)), outTip, basis.u, px, 13, 1, 9, uvs('phantom', 0, 36, 13, 1, 9));
  }
  b.flash = 0;
  b.emit = 0;
}

// ================================================================== part 2: the valley's other monsters

// ------------------------------------------------------------------ more helpers

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A point in a frame, offsets in pixels along forward / up / right. */
function at(o: Vec3, basis: Basis, px: number, x: number, y: number, z: number): Vec3 {
  return add(o, add(scale(basis.f, x * px), add(scale(basis.u, y * px), scale(basis.r, z * px))));
}

/** A direction given in a frame's forward / up / right parts. */
function dirIn(basis: Basis, x: number, y: number, z: number): Vec3 {
  return normalize(add(scale(basis.f, x), add(scale(basis.u, y), scale(basis.r, z))));
}

/** Turns a frame about its up axis (positive swings the forward axis toward the right). */
function turnBasis(b: Basis, angle: number): Basis {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { f: add(scale(b.f, c), scale(b.r, s)), u: b.u, r: add(scale(b.r, c), scale(b.f, -s)) };
}

/**
 * A limb from its pivot (pixels in the frame) pointing along a world direction: a hand going to
 * the mouth, an arm folded across the chest, both raised in a spell. Returns the hand and the
 * limb's own frame (its up axis runs back up the limb, like limb()'s).
 */
function reach(b: MeshBuilder, o: Vec3, basis: Basis, px: number, pivot: Vec3, dir: Vec3, w: number, h: number, d: number, uv: TexRect[], side: Vec3 = basis.r): { at: Vec3; frame: Basis } {
  const u = scale(normalize(dir), -1);
  const r = normalize(add(side, scale(u, -dot(side, u))));
  const f = cross(u, r);
  const p = at(o, basis, px, pivot[0], pivot[1], pivot[2]);
  b.box(add(p, scale(u, (-h / 2) * px)), scale(f, (d / 2) * px), scale(u, (h / 2) * px), scale(r, (w / 2) * px), uv);
  return { at: add(p, scale(u, -(h - 1) * px)), frame: { f, u, r } };
}

/** An upright bottle sprite: its neck along `up`, its face toward `normal`. */
function bottle(b: MeshBuilder, icon: string, c: Vec3, up: Vec3, normal: Vec3, size: number, tint: Vec3): void {
  const n = normalize(normal);
  const y = normalize(add(up, scale(n, -dot(up, n))));
  const x = cross(y, n);
  b.tint = tint;
  sprite(b, icon, { x: scale(x, size), y: scale(y, size), z: scale(n, size), t: c });
  b.tint = WHITE;
}

/** A splash potion's glass, coloured by its brew (kept light enough to read as glass). */
export function potionTint(brew: string): Vec3 {
  const c = POTION_RGB[brew] ?? [1, 1, 1];
  return [0.25 + c[0] * 0.75, 0.25 + c[1] * 0.75, 0.25 + c[2] * 0.75];
}

/**
 * Where a held item goes: its sprite has see-through texels, so the cut-out layer (lit and flashed
 * like the body), or the solid builder when there is none.
 */
function itemLayer(b: MeshBuilder, L: MobLayers, a: Actor): MeshBuilder {
  const c = L.cut;
  if (!c) return b;
  litLike(c, b, a);
  return c;
}

/** Gives an overlay builder the creature's light and hit flash. */
function litLike(m: MeshBuilder, b: MeshBuilder, a: Actor): void {
  m.sky = b.sky;
  m.blk = b.blk;
  m.flash = flashOf(a);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** How high a ravager's back is (riders sit on it). */
export const RAVAGER_BACK = 2.05;

/** Where a rider's model stands: astride its ravager's back (hips `hip` pixels up), else its own feet. */
function seatOf(a: Actor, px: number, hip: number): Vec3 {
  const m = a.mount;
  if (!m || a.deathT >= 0 || m.kind !== 'ravager') return [a.x, a.y, a.z];
  return [m.x - Math.cos(m.yaw) * 0.2, m.y + RAVAGER_BACK - hip * px, m.z - Math.sin(m.yaw) * 0.2];
}

// ------------------------------------------------------------------ endermen

/**
 * Endermen: a black stick of a thing on 30-pixel limbs. Angered (stared at or struck) it trembles
 * and its jaw drops open under a lifted skull; a stolen block rides out in front in both hands;
 * prising one loose, it stoops over the hull.
 */
export function endermanModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  void L;
  const px = a.h / 51;
  const alive = a.deathT < 0;
  const scream = a.act === 'scream' && alive ? Math.min(1, prog(a) * 4) : 0;
  const angry = alive && (a.anger > 0 || scream > 0);
  const grab = a.act === 'grab' && alive ? Math.sin(Math.min(1, prog(a) * 1.3) * Math.PI * 0.5) : 0;
  // Enraged, it shakes all over.
  const shake = angry ? (scream > 0 ? 1.3 : 0.6) * px : 0;
  const o: Vec3 = [a.x + Math.sin(time * 71) * shake, a.y, a.z + Math.cos(time * 53) * shake];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const lu = uvs('enderman', 56, 0, 2, 30, 2);
  const swing = stride(a, angry ? 0.65 : 0.45);
  limb(b, o, basis, px, [0, 30, -2], swing, 2, 30, 2, lu);
  limb(b, o, basis, px, [0, 30, 2], -swing, 2, 30, 2, lu);
  // The upper body bends at the hips (over the block it is prising loose).
  const hips = at(o, basis, px, 0, 28, 0);
  const bb = pitchBasis(basis, grab * 0.55);
  part(b, hips, bb, px, 0, 6, 0, 8, 12, 4, uvs('enderman', 32, 16, 8, 12, 4));
  const carry = a.carry !== 0 && alive;
  let arm = -stride(a, 0.35);
  let roll = 0;
  if (grab > 0) arm = -0.3 - grab * 0.75;
  else if (carry) {
    arm = -0.62 + Math.sin(time * 2 + a.x) * 0.03;
    roll = 0.12;
  } else if (angry) arm = -0.22 + Math.sin(time * 7) * 0.12;
  const both = carry || grab > 0 || angry;
  limb(b, hips, bb, px, [0, 11, -5], both ? arm : -arm, 2, 30, 2, lu, -roll);
  limb(b, hips, bb, px, [0, 11, 5], arm, 2, 30, 2, lu, roll);
  // The skull: it lifts as the jaw (hinged at the back) drops open.
  const neck = at(hips, bb, px, 0, 12, 0);
  const hb = grab > 0 ? pitchBasis(bb, grab * 0.45) : headBasis(a, basis);
  const open = angry ? 0.3 + scream * 0.3 + Math.sin(time * 15) * 0.05 : 0;
  part(b, at(neck, hb, px, -4, 3, 0), pitchBasis(hb, open), px, 4, -1.5, 0, 8, 3, 8, uvs('enderman', 0, 16, 8, 3, 8));
  part(b, neck, hb, px, 0, 7 + open * 5, 0, 8, 8, 8, uvs('enderman', 0, 0, 8, 8, 8));
  b.flash = 0;
  // The stolen block, held out in front between the hands.
  if (carry) {
    const l = limbEnd(hips, bb, px, [0, 11, -5], arm, 29, -roll).at;
    const r = limbEnd(hips, bb, px, [0, 11, 5], arm, 29, roll).at;
    const c = add(scale(add(l, r), 0.5), add(scale(basis.u, 0.16), scale(basis.f, 0.06)));
    blockCube(b, a.carry, c, 0.25, a.yaw);
  }
}

// ------------------------------------------------------------------ witches

/**
 * Witches: a robe, a long hooked nose with its wart, arms folded, and the hat with its brim and
 * two bent tiers. A brew comes out to be drunk (raised to the lips, head tipped back) or thrown
 * (an overarm swing), its bottle tinted to the potion.
 */
export function witchModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  void L;
  const px = a.h / 31;
  const o: Vec3 = [a.x, a.y, a.z];
  const basis = bodyBasis(a);
  const alive = a.deathT < 0;
  b.flash = flashOf(a);
  // The robe sways as she sidles about.
  const rb = rollBasis(basis, stride(a, 0.06));
  part(b, o, rb, px, 0, 10, 0, 8, 20, 6, uvs('witch', 0, 20, 8, 20, 6));
  const p = prog(a);
  const drink = a.act === 'drink' && alive && a.potion !== '' ? p : -1;
  const toss = a.act === 'throw' && alive && a.potion !== '' ? p : -1;
  // Drinking, she tips her head back.
  const sip = drink >= 0 ? Math.min(1, drink * 3) * (drink > 0.9 ? (1 - drink) * 10 : 1) : 0;
  const hb = pitchBasis(headBasis(a, basis), -0.45 * sip);
  const neck = at(o, rb, px, 0, 20, 0);
  part(b, neck, hb, px, 0, 5, 0, 8, 10, 8, uvs('witch', 0, 0, 8, 10, 8));
  // The nose twitches; the wart rides on its tip.
  const root = at(neck, hb, px, 4, 4, 0);
  const nb = pitchBasis(hb, Math.sin(time * 2.3 + a.x) * 0.1 - 0.05);
  part(b, root, nb, px, 1, -2, 0, 2, 4, 2, uvs('witch', 24, 0, 2, 4, 2));
  part(b, root, nb, px, 2.2, -3.2, -0.6, 1, 1, 1, uvs('witch', 0, 58, 1, 1, 1));
  // The hat: brim, then two tiers and the crumpled tip, each bent a little further back.
  const brim = at(neck, hb, px, 0, 10, 0);
  part(b, brim, hb, px, 0, 0.5, 0, 10, 2, 10, uvs('witch', 0, 46, 10, 2, 10));
  const ta = rollBasis(pitchBasis(hb, -0.08), 0.04);
  const pa = at(brim, hb, px, 0, 1.5, 0);
  part(b, pa, ta, px, 0, 2, 0, 7, 4, 7, uvs('witch', 32, 28, 7, 4, 7));
  const tb = rollBasis(pitchBasis(ta, -0.22 + Math.sin(time * 1.7 + a.z) * 0.03), 0.07);
  const pb = at(pa, ta, px, -0.6, 4, 0);
  part(b, pb, tb, px, 0, 2, 0, 4, 4, 4, uvs('witch', 44, 0, 4, 4, 4));
  const tc = rollBasis(pitchBasis(tb, -0.45), 0.12);
  part(b, at(pb, tb, px, -0.8, 4, 0), tc, px, 0, 1, 0, 1, 2, 1, uvs('witch', 36, 0, 1, 2, 1));
  if (drink < 0 && toss < 0) {
    // Arms folded across the robe, the knobbly hands on top.
    part(b, at(o, rb, px, 3.6, 14.5, 0), pitchBasis(rb, -0.3), px, 0, 0, 0, 8, 4, 4, uvs('witch', 32, 20, 8, 4, 4));
    b.flash = 0;
    return;
  }
  // A potion in her right hand; the left hangs at her side.
  const armUv = uvs('witch', 40, 46, 4, 10, 4);
  limb(b, o, rb, px, [0, 18.5, -5.5], -0.15 + stride(a, 0.3), 4, 10, 4, armUv, 0.08);
  const brew = a.potion;
  const icon = brew === 'heal' ? 'potion_item' : 'splash_item';
  const tint = brew === 'heal' ? WHITE : potionTint(brew);
  const shoulder = at(o, rb, px, 0, 18.5, 5.5);
  const ib = itemLayer(b, L, a);
  if (drink >= 0) {
    // Up to the lips (the bottle upturned), then down again at the end.
    const k = Math.min(1, drink * 4) * Math.min(1, (1 - drink) * 8);
    const mouth = at(neck, hb, px, 4.5, 1.5, 0);
    const toMouth = normalize(add(add(mouth, scale(hb.f, 2 * px)), scale(shoulder, -1)));
    const hang = dirIn(rb, 0.5, -1, 0.1);
    const hand = reach(b, o, rb, px, [0, 18.5, 5.5], normalize(add(scale(hang, 1 - k), scale(toMouth, k))), 4, 10, 4, armUv);
    const up = normalize(add(scale(rb.u, 1 - k), scale(normalize(add(mouth, scale(hand.at, -1))), k)));
    bottle(ib, icon, add(hand.at, scale(up, 0.12)), up, rb.r, 0.32, tint);
  } else {
    // Overarm: back over the shoulder, then a quick swing forward to let it fly.
    const angle = toss < 0.6 ? -0.6 - (toss / 0.6) * 2.6 : -3.2 + ((toss - 0.6) / 0.4) * 2.1;
    limb(b, o, rb, px, [0, 18.5, 5.5], angle, 4, 10, 4, armUv, -0.08);
    const hand = limbEnd(o, rb, px, [0, 18.5, 5.5], angle, 9, -0.08);
    const out = normalize(add(hand.at, scale(shoulder, -1)));
    bottle(ib, icon, add(hand.at, scale(out, 0.1)), out, rb.r, 0.3, tint);
  }
  ib.flash = 0;
  b.flash = 0;
}

// ------------------------------------------------------------------ slimes

/**
 * Slimes: a jelly cube (see-through, on the blended layer) round a darker core with two eyes and
 * a mouth. It squashes down for a hop, stretches in the air and splats flat on landing; sizes
 * 1, 2 and 4 all share the model.
 */
export function slimeModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 8;
  const o: Vec3 = [a.x, a.y, a.z];
  const alive = a.deathT < 0;
  // Squash (+) and stretch (-).
  let sq = alive ? Math.sin(time * 3 + a.x) * 0.03 : 0;
  if (alive) {
    if (a.act === 'pounce') sq = 0.1 + clamp01(1 + a.aux / 0.22) * 0.28;
    else if (!a.onGround) sq = -0.22 * clamp01(Math.abs(a.vy) / 5);
    else if (a.actT > 0) sq = (a.actT / 0.3) * 0.38 * (0.75 + 0.25 * Math.cos(a.actT * 40));
  }
  const ky = 1 - sq;
  const kw = 1 + sq * 0.55;
  const base = bodyBasis(a);
  const sb: Basis = { f: scale(base.f, kw), u: scale(base.u, ky), r: scale(base.r, kw) };
  b.flash = flashOf(a);
  part(b, o, sb, px, 0, 4, 0, 6, 6, 6, uvs('slime', 0, 16, 6, 6, 6));
  const eye = uvs('slime', 32, 0, 2, 2, 2);
  part(b, o, sb, px, 2.6, 5, -2.3, 2, 2, 2, eye);
  part(b, o, sb, px, 2.6, 5, 2.3, 2, 2, 2, eye);
  part(b, o, sb, px, 3.1, 2.5, 0.5, 1, 1, 1, uvs('slime', 32, 8, 1, 1, 1));
  b.flash = 0;
  const jelly = uvs('slime', 0, 0, 8, 8, 8);
  const s = L.soft;
  if (!s) {
    // No blended layer (squashed flat under a foot): the jelly goes on solid.
    b.flash = flashOf(a);
    part(b, o, sb, px, 0, 4, 0, 8, 8, 8, jelly);
    b.flash = 0;
    return;
  }
  litLike(s, b, a);
  s.flags = F_OVERLAY;
  s.alpha = 0.5;
  part(s, o, sb, px, 0, 4, 0, 8, 8, 8, jelly);
  s.flags = 0;
  s.alpha = 1;
  s.flash = 0;
}

// ------------------------------------------------------------------ illagers

/**
 * A raid captain's ominous banner on a pole across his back, its cloth (four strips of the
 * banner tile) trailing and rippling as he goes.
 */
function captainBanner(b: MeshBuilder, o: Vec3, basis: Basis, px: number, a: Actor, time: number): void {
  const back = at(o, basis, px, -3.9, 0, 0);
  const top = add(back, scale(basis.u, 50 * px));
  const wood = [tileRect('planks_spruce')];
  beam(b, add(back, scale(basis.u, 10 * px)), top, 0.55 * px, wood);
  const bar = add(top, scale(basis.u, -1.5 * px));
  beam(b, add(bar, scale(basis.r, -6.5 * px)), add(bar, scale(basis.r, 6.5 * px)), 0.5 * px, wood, 0.5 * px, basis.f);
  const run = Math.min(1, Math.hypot(a.vx, a.vz) / 3);
  let p = add(bar, scale(basis.f, -0.9 * px));
  const strips = 4;
  const hh = (19 * px) / strips / 2;
  for (let i = 0; i < strips; i += 1) {
    const ang = 0.05 + i * (0.04 + run * 0.12) + Math.sin(time * 3.2 - i * 0.9 + a.x) * (0.03 + 0.025 * i);
    const down = add(scale(basis.u, -Math.cos(ang)), scale(basis.f, -Math.sin(ang)));
    const su = scale(down, -1);
    const n = cross(su, basis.r);
    const t = subRect('banner_ominous', 0, i * 8, 32, (i + 1) * 8);
    b.box(add(p, scale(down, hh)), scale(n, 0.15 * px), scale(su, hh), scale(basis.r, 6 * px), [t, t, null, null, null, null]);
    p = add(p, scale(down, hh * 2));
  }
}

/**
 * Pillagers and vindicators: the illagers' long grey faces and big noses. A pillager carries its
 * crossbow low, cranks it up to load (the string hauled back), then holds it level on you to
 * shoot; a vindicator walks with its arms folded and whips out its axe for the blow, raising it
 * high as the blow winds up. A captain bears the ominous banner; a rider sits its ravager.
 */
export function illagerModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  void L;
  const vin = a.kind === 'vindicator';
  const skin = vin ? 'vindicator' : 'pillager';
  const px = a.h / 34;
  const alive = a.deathT < 0;
  const riding = a.mount !== null && alive;
  const o = seatOf(a, px, 12);
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const swing = riding ? 0 : stride(a, 0.7);
  const legUv = uvs(skin, 0, 20, 4, 12, 4);
  limb(b, o, basis, px, [0, 12, -2], riding ? -Math.PI / 2 + 0.25 : swing, 4, 12, 4, legUv, riding ? -0.3 : 0);
  limb(b, o, basis, px, [0, 12, 2], riding ? -Math.PI / 2 + 0.25 : -swing, 4, 12, 4, legUv, riding ? 0.3 : 0);
  part(b, o, basis, px, 0, 18, 0, 8, 12, 6, uvs(skin, 16, 20, 8, 12, 6));
  const hb = headBasis(a, basis);
  const neck = at(o, basis, px, 0, 24, 0);
  part(b, neck, hb, px, 0, 5, 0, 8, 10, 8, uvs(skin, 0, 0, 8, 10, 8));
  part(b, neck, hb, px, 5, 2, 0, 2, 4, 2, uvs(skin, 24, 0, 2, 4, 2));
  const armUv = uvs(skin, 44, 20, 4, 12, 4);
  const sway = stride(a, 0.6);
  const ib = itemLayer(b, L, a);
  if (vin) {
    const windup = a.windup > 0 && a.actDur > 0 && alive ? 1 - a.windup / a.actDur : 0;
    const armed = alive && (a.windup > 0 || a.attackTimer > 0);
    if (!armed) {
      // Arms folded across the chest.
      reach(b, o, basis, px, [0, 22, 6], dirIn(basis, 0.62, -0.62, -0.5), 4, 12, 4, armUv);
      reach(b, o, basis, px, [0, 22, -6], dirIn(basis, 0.74, -0.55, 0.42), 4, 12, 4, armUv);
    } else {
      // The axe: up behind the head as the blow winds up, down through it as it lands.
      const follow = a.windup <= 0 && a.attackTimer > 0.75 ? clamp01((a.attackTimer - 0.75) / 0.3) : 0;
      const axe = windup > 0 ? -1.2 - windup * 1.9 : -1.15 + follow * 0.85;
      limb(b, o, basis, px, [0, 22, 6], axe, 4, 12, 4, armUv, 0.08);
      limb(b, o, basis, px, [0, 22, -6], -0.3 - sway * 0.6, 4, 12, 4, armUv, -0.05);
      const hand = limbEnd(o, basis, px, [0, 22, 6], axe, 11, 0.08);
      held(ib, 'axe_item', hand.at, hand.frame.f, hand.frame.r, a.h * 0.36);
    }
  } else {
    const load = a.act === 'draw' && alive ? prog(a) : -1;
    const aiming = alive && load < 0 && a.aux > 0;
    if (aiming) {
      // Both hands on the crossbow, held level at you.
      const aim = -Math.PI / 2 - a.headPitch * 0.9 + Math.sin(time * 2 + a.x) * 0.03;
      limb(b, o, basis, px, [0, 22, 6], aim, 4, 12, 4, armUv, 0.3);
      limb(b, o, basis, px, [0, 22, -6], aim + 0.12, 4, 12, 4, armUv, -0.55);
      const hand = limbEnd(o, basis, px, [0, 22, 6], aim, 10, 0.3);
      const along = normalize(add(basis.f, scale(basis.u, -Math.sin(a.headPitch))));
      held(ib, 'crossbow_item', hand.at, along, basis.r, a.h * 0.32);
    } else if (load >= 0) {
      // Loading: the crossbow upright in the right hand, the left hauling the string down to the latch.
      const pull = Math.sin(Math.min(1, load * 1.15) * Math.PI * 0.5);
      limb(b, o, basis, px, [0, 22, 6], -1.05, 4, 12, 4, armUv, 0.32);
      limb(b, o, basis, px, [0, 22, -6], -1.75 + pull * 0.85, 4, 12, 4, armUv, -0.62);
      const hand = limbEnd(o, basis, px, [0, 22, 6], -1.05, 10, 0.32);
      held(ib, 'crossbow_item', hand.at, dirIn(basis, 0.35, 1, -0.12), basis.r, a.h * 0.32);
    } else {
      // Carried low, pointing ahead.
      limb(b, o, basis, px, [0, 22, 6], -0.4 + sway * 0.4, 4, 12, 4, armUv, 0.05);
      limb(b, o, basis, px, [0, 22, -6], -sway, 4, 12, 4, armUv);
      const hand = limbEnd(o, basis, px, [0, 22, 6], -0.4 + sway * 0.4, 10, 0.05);
      held(ib, 'crossbow_item', hand.at, dirIn(basis, 1, -0.15, 0), basis.r, a.h * 0.3);
    }
  }
  ib.flash = 0;
  if (a.captain) captainBanner(b, o, basis, px, a, time);
  b.flash = 0;
}

// ------------------------------------------------------------------ evokers

/**
 * The evoker: an old illager in a black-and-gold robe. Arms folded as it keeps its distance; both
 * raised and spread, hands waving, as it conjures fangs or calls up its vexes.
 */
export function evokerModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  void L;
  const px = a.h / 30;
  const alive = a.deathT < 0;
  const o = seatOf(a, px, 6);
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  const rb = rollBasis(basis, a.mount ? 0 : stride(a, 0.06));
  part(b, o, rb, px, 0, 10, 0, 8, 20, 6, uvs('evoker', 0, 20, 8, 20, 6));
  const casting = alive && (a.act === 'cast' || a.act === 'fangs' || a.act === 'summon');
  // Casting, it looks up a little.
  const hb = casting ? pitchBasis(headBasis(a, basis), -0.15) : headBasis(a, basis);
  const neck = at(o, rb, px, 0, 20, 0);
  part(b, neck, hb, px, 0, 5, 0, 8, 10, 8, uvs('evoker', 0, 0, 8, 10, 8));
  part(b, neck, hb, px, 5, 2, 0, 2, 4, 2, uvs('evoker', 24, 0, 2, 4, 2));
  const armUv = uvs('evoker', 44, 20, 4, 12, 4);
  if (casting) {
    const k = Math.min(1, prog(a) * 5);
    for (const side of [-1, 1]) {
      const wave = Math.cos(time * 8 + side) * 0.15;
      const dir = add(scale(dirIn(rb, 0.1, -1, side * 0.15), 1 - k), scale(dirIn(rb, 0.3 + wave, 0.85, side * 0.62), k));
      reach(b, o, rb, px, [0, 19, side * 6], dir, 4, 12, 4, armUv);
    }
  } else {
    reach(b, o, rb, px, [0, 19, 6], dirIn(rb, 0.62, -0.62, -0.5), 4, 12, 4, armUv);
    reach(b, o, rb, px, [0, 19, -6], dirIn(rb, 0.74, -0.55, 0.42), 4, 12, 4, armUv);
  }
  b.flash = 0;
}

// ------------------------------------------------------------------ vexes

/**
 * Vexes: little winged spirits with iron swords, wings beating fast. Charging, they lean in and
 * glow red, sword raised; as their borrowed life runs out they fade away.
 */
export function vexModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  const px = a.h / 18;
  const alive = a.deathT < 0;
  const charge = a.act === 'charge' && alive;
  const fade = a.life >= 0 && a.life < 4 && alive ? Math.max(0.15, a.life / 4) : 1;
  const m = fade < 1 && L.soft ? L.soft : b;
  if (m !== b) {
    m.sky = b.sky;
    m.blk = b.blk;
    m.flags = F_OVERLAY;
    m.alpha = fade;
  }
  const o: Vec3 = [a.x, a.y + 0.05 + Math.sin(time * 3 + a.x) * 0.05, a.z];
  // Leaning into its flight.
  const lean = Math.min(0.5, Math.hypot(a.vx, a.vz) * 0.06) + (charge ? 0.25 : 0);
  const basis = alive ? pitchBasis(bodyBasis(a), lean) : bodyBasis(a);
  m.flash = flashOf(a);
  const tint: Vec3 = charge ? [1, 0.5, 0.45] : WHITE;
  m.tint = tint;
  m.emit = charge ? 0.35 : 0;
  part(m, o, basis, px, 0, 5, 0, 8, 10, 4, uvs('vex', 0, 16, 8, 10, 4));
  part(m, at(o, basis, px, 0, 10, 0), alive ? headBasis(a, basis) : basis, px, 0, 4, 0, 8, 8, 8, uvs('vex', 0, 0, 8, 8, 8));
  const armUv = uvs('vex', 24, 16, 3, 10, 3);
  const sword = charge ? -2.6 + Math.sin(time * 18) * 0.25 : -1.1 + Math.sin(time * 4 + a.z) * 0.12;
  limb(m, o, basis, px, [0, 9, 5.5], sword, 3, 10, 3, armUv, 0.1);
  limb(m, o, basis, px, [0, 9, -5.5], charge ? -0.7 : -0.3 + Math.sin(time * 3 + a.x) * 0.1, 3, 10, 3, armUv, 0.15);
  // Two wings swept back from the shoulder blades (the right one is the left turned round).
  const sweep = 0.5 + Math.sin(a.walkPhase) * 0.38;
  const wing = uvs('vex', 36, 16, 12, 10, 1);
  for (const side of [-1, 1]) {
    const wb = side < 0 ? turnBasis(basis, -sweep) : turnBasis(basis, Math.PI + sweep);
    part(m, at(o, basis, px, -2.2, 9, side), rollBasis(wb, 0.15), px, 0, -3, -6, 12, 10, 1, wing);
  }
  const hand = limbEnd(o, basis, px, [0, 9, 5.5], sword, 9, 0.1);
  const ib = m === b ? itemLayer(b, L, a) : m;
  held(ib, 'ui_sword', hand.at, hand.frame.f, hand.frame.r, a.h * 0.55, tint);
  ib.flash = 0;
  m.tint = WHITE;
  m.emit = 0;
  m.flash = 0;
  m.flags = 0;
  m.alpha = 1;
}

// ------------------------------------------------------------------ ravagers

/**
 * The ravager: a horned beast the size of a cart (laid out in blocks, not pixels: its hide is
 * stretched over a bigger frame than its sheet). It noses about as it walks, paws the ground with
 * its head down before a charge, throws its head up and its jaw open to roar, and reels, shaking
 * its head, when stunned.
 */
export function ravagerModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  void L;
  const alive = a.deathT < 0;
  const p = prog(a);
  const stunned = a.act === 'stunned' && alive;
  const roar = a.act === 'roar' && alive ? Math.sin(Math.min(1, p) * Math.PI) : 0;
  const charge = a.act === 'charge' && alive;
  const paw = charge && a.actT < 0.8;
  const gore = a.windup > 0 && a.actDur > 0 && alive ? 1 - a.windup / a.actDur : 0;
  const thrust = alive && a.windup <= 0 && a.attackTimer > 1.1 ? (a.attackTimer - 1.1) / 0.3 : 0;
  const o: Vec3 = [a.x, a.y, a.z];
  let basis = bodyBasis(a);
  if (stunned) basis = rollBasis(basis, Math.sin(time * 11) * 0.07);
  b.flash = flashOf(a);
  const swing = stride(a, charge && !paw ? 0.8 : 0.5);
  const legUv = uvs('ravager', 40, 26, 4, 8, 4);
  for (const [fx, fz, s] of [[0.72, -0.5, 1], [0.72, 0.5, -1], [-0.72, -0.5, -1], [-0.72, 0.5, 1]] as const) {
    let ang = swing * s;
    // Pawing the earth with a forefoot before the charge.
    if (paw && fx > 0 && fz > 0) ang = -0.35 - Math.max(0, Math.sin(time * 14)) * 0.65;
    limb(b, o, basis, 1, [fx, 1.04, fz], ang, 0.42, 1.04, 0.42, legUv);
  }
  part(b, o, basis, 1, -0.1, 1.5, 0, 1.5, 1.1, 2.2, uvs('ravager', 0, 26, 8, 9, 12));
  // The head on its neck: lowered to charge, flung up to roar, raised to gore then driven down.
  let pitch = 0.1 + Math.sin(time * 1.5 + a.x) * 0.04;
  if (charge) pitch = paw ? 0.5 : 0.36;
  if (gore > 0) pitch = -0.45 * gore;
  else if (thrust > 0) pitch = 0.4 * thrust;
  if (roar > 0) pitch = -0.6 * roar;
  const yaw = stunned ? Math.sin(time * 7) * 0.45 : alive ? a.headYaw * 0.4 : 0;
  const hb = pitchBasis(alive ? turnBasis(basis, yaw) : basis, pitch);
  const neck = at(o, basis, 1, 1.05, 1.62, 0);
  part(b, neck, hb, 1, -0.05, 0, 0, 0.62, 0.62, 0.75, uvs('ravager', 32, 0, 5, 5, 6));
  part(b, neck, hb, 1, 0.55, -0.02, 0, 0.88, 0.95, 0.85, uvs('ravager', 0, 0, 8, 9, 8));
  const open = roar > 0 ? 0.8 * roar : gore > 0 ? 0.3 * gore : charge ? 0.12 : Math.max(0, Math.sin(time * 0.9 + a.z)) * 0.1;
  part(b, at(neck, hb, 1, 0.2, -0.48, 0), pitchBasis(hb, open), 1, 0.38, -0.11, 0, 0.8, 0.22, 0.76, uvs('ravager', 0, 17, 8, 2, 7));
  // Horns out from the sides of the head, their tips curling up and back.
  const hornUv = uvs('ravager', 40, 40, 6, 2, 2);
  const tipUv = uvs('ravager', 56, 26, 2, 4, 2);
  for (const side of [-1, 1]) {
    const hn = rollBasis(hb, side * 0.12);
    part(b, neck, hn, 1, 0.38, 0.3, side * 0.72, 0.62, 0.2, 0.2, hornUv);
    part(b, at(neck, hn, 1, 0.38, 0.3, side * 0.96), pitchBasis(hn, -0.35), 1, 0, 0.2, 0, 0.2, 0.42, 0.2, tipUv);
  }
  b.flash = 0;
}

// ------------------------------------------------------------------ ghasts

/**
 * Ghasts: a great pale cube with nine tentacles swaying beneath. Its sorrowful closed face
 * opens (eyes red, mouth wide) as it spits a fireball.
 */
export function ghastModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number): void {
  void L;
  const px = a.h / 16;
  const alive = a.deathT < 0;
  const o: Vec3 = [a.x, a.y + (alive ? Math.sin(time * 1.2 + a.z) * 0.12 : 0), a.z];
  const basis = bodyBasis(a);
  b.flash = flashOf(a);
  part(b, o, basis, px, 0, 8, 0, 16, 16, 16, uvs('ghast', 0, 0, 16, 16, 16));
  // Shooting (or dying): the wailing face over the calm one.
  if (!alive || a.mouth > 0.12 || a.act === 'shoot') part(b, o, basis, px, 8.04, 8, 0, 16, 16, 0.06, uvs('ghast', 0, 44, 16, 16, 1));
  const tent = uvs('ghast', 0, 32, 2, 9, 2);
  // They trail behind as it drifts, and curl up as it shoots.
  const drift = Math.min(0.35, Math.hypot(a.vx, a.vz) * 0.08);
  const curl = alive ? Math.min(1, a.mouth) * 0.25 : 0.5;
  for (let i = 0; i < 9; i += 1) {
    const row = Math.floor(i / 3);
    const fx = (row - 1) * 5 + ((i % 3) - 1) * 0.6;
    const fz = ((i % 3) - 1) * 5 + (row === 1 ? 1 : 0);
    const len = 9 + ((i * 7) % 5);
    const ang = Math.sin(time * 1.6 + i * 1.3) * 0.22 + drift + (fx > 0 ? -curl : fx < 0 ? curl : 0);
    limb(b, o, basis, px, [fx, 0.5, fz], ang, 2, len, 2, tent, Math.sin(time * 1.1 + i * 2.1) * 0.15 + (fz > 0 ? -curl : fz < 0 ? curl : 0) * 0.6);
  }
  b.flash = 0;
}

// ------------------------------------------------------------------ the Wither

/**
 * The Wither: three skulls on a bar of black bone, a spine hung with ribs and a tail curling
 * under. Each head looks where its fight state says (the shots leave from witherHeads()); it
 * swells out of a blue flicker as it wakes, wears a crackling shell once armoured, rears back
 * with blazing eyes before a dash, and convulses, strobing, as it dies.
 */
export function witherModel(b: MeshBuilder, L: MobLayers, a: Actor, time: number, pose: WitherDraw): void {
  const s = a.h / 3.5;
  const g = pose.grow;
  const pb = (s / 10) * g;
  const ph = (s / 12) * g;
  const bob = Math.sin(a.walkPhase * 0.6) * 0.15 * s;
  const shake = pose.dying * 0.1 * s;
  const o: Vec3 = [a.x + Math.sin(time * 57) * shake, a.y + bob * g + Math.cos(time * 43) * shake * 0.6, a.z + Math.sin(time * 49 + 1) * shake];
  const flat = yawBasis(a.yaw);
  // Rearing back as it winds up a dash.
  const basis = pitchBasis(bodyBasis(a), -pose.tell * 0.35);
  b.flash = pose.dying > 0 ? (Math.floor(time * 14) % 2 === 0 ? 0.85 : 0.25) : flashOf(a);
  const waking = g < 1;
  const glow = waking ? 0.25 + Math.max(0, Math.sin(time * 9)) * 0.35 : 0;
  if (waking) b.tint = [0.62, 0.78, 1];
  b.emit = glow;
  const aura = pose.armored && a.deathT < 0 && L.soft ? L.soft : null;
  const faces = aura ? chargeFaces(time, 6) : null;
  if (aura) {
    auraOn(aura, 0.28);
    aura.emit = 0.45;
  }
  const piece = (org: Vec3, bs: Basis, px: number, cx: number, cy: number, cz: number, w: number, h: number, d: number, uv: TexRect[], k = 1.14): void => {
    part(b, org, bs, px, cx, cy, cz, w, h, d, uv);
    if (aura && faces) auraPart(aura, org, bs, px, cx, cy, cz, w, h, d, faces, k);
  };
  // The shoulders the heads sit on.
  piece(o, basis, pb, 0, 23.8, 0, 20, 3, 3, uvs('wither', 0, 16, 20, 3, 3));
  // The spine with its ribs, and the tail swinging under.
  const top = at(o, basis, pb, 0, 22.4, 0);
  const sb = pitchBasis(basis, 0.18 + Math.sin(time * 1.4) * 0.06);
  piece(top, sb, pb, 0, -5, 0, 3, 10, 3, uvs('wither', 0, 22, 3, 10, 3));
  const rib = uvs('wither', 12, 22, 11, 2, 2);
  for (let i = 0; i < 3; i += 1) piece(top, sb, pb, 0.5, -2.2 - i * 2.8, 0, 11 - i, 2, 2, rib);
  const tb = pitchBasis(sb, 0.55 + Math.sin(time * 1.9) * 0.15);
  piece(at(top, sb, pb, 0, -10, 0), tb, pb, 0, -3, 0, 3, 6, 3, uvs('wither', 38, 22, 3, 6, 3));
  // The heads, where the fight shoots from; eyes blazing in the dash's wind-up.
  const heads = witherHeads(a);
  b.emit = glow + pose.tell * 0.9;
  for (let i = 0; i < 3; i += 1) {
    const hp = heads[i]!;
    const d: Vec3 = [hp[0] - a.x, hp[1] - a.y - bob, hp[2] - a.z];
    const c = add(o, add(scale(basis.f, dot(d, flat.f) * g), add(scale(basis.u, dot(d, flat.u) * g), scale(basis.r, dot(d, flat.r) * g))));
    const h = pose.heads?.[i];
    let look: Basis = h ? pitchBasis(yawBasis(a.yaw + h.yaw), -h.pitch) : i === 0 ? headBasis(a, basis) : turnBasis(basis, (i === 1 ? -1 : 1) * 0.25 + Math.sin(time * 0.7 + i) * 0.15);
    if (pose.dying > 0) look = rollBasis(look, Math.sin(time * 9 + i * 2) * 0.4 * pose.dying);
    const n = i === 0 ? 8 : 6;
    piece(c, look, ph, 0, 0, 0, n, n, n, i === 0 ? uvs('wither', 0, 0, 8, 8, 8) : uvs('wither', 32, 0, 6, 6, 6), 1.1);
  }
  if (aura) auraOff(aura);
  b.tint = WHITE;
  b.emit = 0;
  b.flash = 0;
}
