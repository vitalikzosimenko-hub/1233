import { B, I, blockDef, itemDef, ITEMS, RECIPES, type Recipe } from './blocks';
import { kx, ky, kz, type BlockBody } from './body';
import { checkGiantIntegrity, fireCannon, killGiant, loadCannon, MAGAZINE, throwPearl, throwTnt, throwWindCharge, turretKind, usesTnt } from './combat';
import type { Actor, ItemDrop } from './entities';
import type { Vec3 } from './math3d';
import { checkFortressIntegrity, F_MAX, F_MAX_BLOCKS, F_MIN } from './fortress';
import { atCraneControls, craneBeat, craneTap, DROP_TNT, hoistCheck, startCraneDrop, startHoist } from './crane';
import { REACH, dist3, materialOf, type Game, type Ray, type Target } from './game';
import { hostile, meleeMob, recruit, repairLeg } from './mobs';
import { rayBox, raycastGrid, type GridHit } from './raycast';
import { fireCrossbow, fireGrapple, socketHeartstone, throwBreaker } from './relics';
import { petPet } from './pet';
import { pickUpHen, setDownHen, shearSheep } from './animals';
import { offeredExit } from './chute';
import { HOIST_INFO, type Structure } from './structures';
import { DIRS } from './world';
import { GOLEM_PRICE, takeGolem } from './folk';
import { crestChestAt, EXPEDITIONS, grantCrest, mainQuestOn, reforge, sealedChest, wardenBeaten } from './mainquest';
import { curioIn, findCurio, setDone } from './curios';
import { landMetal } from './gear';

const MELEE = 4.5;
const RECRUIT = 8;
/** How far the crane can be aimed at a building from the builder's eye. */
const HOIST_SIGHT = 48;

export interface Stations {
  table: boolean;
  furnace: boolean;
}

export interface Pick {
  block: Target | null;
  actor: Actor | null;
  actorDist: number;
}

function bodyHit(kind: 'fortress' | 'giant', body: BlockBody, h: GridHit, giant: Target['giant']): Target {
  return { kind, body, giant, x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, dist: h.dist, id: body.blockAt(h.x, h.y, h.z), sig: `${kind[0]}${h.x},${h.y},${h.z}` };
}

/** The part of a cell a non-cube block actually fills (null: the whole cell). */
function shapeBox(id: number, meta: number): [number, number, number, number, number, number] | null {
  const def = blockDef(id);
  switch (def.shape) {
    case 'wire':
      return [0, 0, 0, 1, 0.1, 1];
    case 'torch':
      return [0.35, 0, 0.35, 0.65, 0.7, 0.65];
    case 'lantern':
      return meta === 1 ? [0.28, 0.2, 0.28, 0.72, 1, 0.72] : [0.28, 0, 0.28, 0.72, 0.62, 0.72];
    case 'chain':
      return [0.35, 0, 0.35, 0.65, 1, 0.65];
    case 'fence':
      return [0.3, 0, 0.3, 0.7, 1, 0.7];
    case 'crop':
      return [0.05, 0, 0.05, 0.95, 0.9, 0.95];
    case 'ladder':
    case 'vine': {
      const t = 0.18;
      switch (meta) {
        case 0:
          return [1 - t, 0, 0, 1, 1, 1];
        case 1:
          return [0, 0, 0, t, 1, 1];
        case 2:
          return [0, 0, 1 - t, 1, 1, 1];
        case 3:
          return [0, 0, 0, 1, 1, t];
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/** Ray against a cell, honouring the block's real shape. */
function hitsCell(ox: number, oy: number, oz: number, r: Ray, x: number, y: number, z: number, id: number, meta: number): boolean {
  const box = shapeBox(id, meta);
  if (!box) return true;
  return rayBox(ox, oy, oz, r.dx, r.dy, r.dz, x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5]) !== null;
}

/** A ray in a body's own (turned) frame; distances along it are unchanged. */
function localRay(body: BlockBody, r: Ray): Ray {
  const [ox, oy, oz] = body.toLocal(r.ox, r.oy, r.oz);
  const [dx, dz] = body.dirToLocal(r.dx, r.dz);
  return { ox, oy, oz, dx, dy: r.dy, dz };
}

/** The first world block along a ray (walking bodies ignored): what the crane can reach over the rail. */
function pickWorld(g: Game, r: Ray, reach: number): Target | null {
  const w = g.world;
  const wh = raycastGrid(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, reach, (x, y, z) => {
    if (!w.inBounds(x, y, z)) return false;
    const id = w.get(x, y, z);
    return blockDef(id).pickable && hitsCell(r.ox, r.oy, r.oz, r, x, y, z, id, w.getMeta(x, y, z));
  });
  return wh ? { kind: 'world', body: null, giant: null, x: wh.x, y: wh.y, z: wh.z, nx: wh.nx, ny: wh.ny, nz: wh.nz, dist: wh.dist, id: w.get(wh.x, wh.y, wh.z), sig: `w${wh.x},${wh.y},${wh.z}` } : null;
}

/**
 * The building the crane would lift for a view ray: the one it looks at (over your own rail), or
 * failing that the hoistable building nearest the line of sight (a forgiving aim).
 */
export function hoistAim(g: Game, ray: Ray): Structure | null {
  const direct = hoistTarget(g, pickWorld(g, ray, HOIST_SIGHT));
  if (direct) return direct;
  // The near-miss allowance is for the deck by day, looking down over the rail at the houses below.
  if (g.player.standingOn !== g.fortress || g.phase !== 'day' || ray.dy > -0.12) return null;
  let best: Structure | null = null;
  let bestA = 0.2;
  for (const s of g.world.structures.all) {
    if (!HOIST_INFO[s.kind] || g.world.hoisted.has(s.id)) continue;
    const cx = (s.minX + s.maxX + 1) / 2 - ray.ox;
    const cy = (s.floorY + s.maxY + 1) / 2 - ray.oy;
    const cz = (s.minZ + s.maxZ + 1) / 2 - ray.oz;
    const d = Math.hypot(cx, cy, cz);
    if (d > HOIST_SIGHT || d < 2) continue;
    // A wider cone for big buildings close by.
    const size = Math.max(s.maxX - s.minX, s.maxZ - s.minZ, s.maxY - s.floorY) / 2;
    const a = Math.acos(Math.max(-1, Math.min(1, (cx * ray.dx + cy * ray.dy + cz * ray.dz) / d))) - Math.atan(size / d) * 0.7;
    if (a < bestA) {
      bestA = a;
      best = s;
    }
  }
  return best;
}

/** First block and first creature along a ray. Water and plants do not stop it. */
export function pick(g: Game, r: Ray, reach = REACH): Pick {
  let block: Target | null = null;
  const w = g.world;
  const wh = raycastGrid(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, reach, (x, y, z) => {
    if (!w.inBounds(x, y, z)) return false;
    const id = w.get(x, y, z);
    return blockDef(id).pickable && hitsCell(r.ox, r.oy, r.oz, r, x, y, z, id, w.getMeta(x, y, z));
  });
  if (wh) block = { kind: 'world', body: null, giant: null, x: wh.x, y: wh.y, z: wh.z, nx: wh.nx, ny: wh.ny, nz: wh.nz, dist: wh.dist, id: w.get(wh.x, wh.y, wh.z), sig: `w${wh.x},${wh.y},${wh.z}` };
  const F = g.fortress;
  const fr = localRay(F, r);
  const fh = raycastGrid(fr.ox, fr.oy, fr.oz, fr.dx, fr.dy, fr.dz, reach, (x, y, z) => {
    const c = F.get(x, y, z);
    return c !== undefined && hitsCell(fr.ox, fr.oy, fr.oz, fr, x, y, z, c.id, c.dir);
  });
  if (fh && (!block || fh.dist < block.dist)) block = bodyHit('fortress', F, fh, null);
  for (const giant of g.giants) {
    if (giant.dead) continue;
    const b = giant.body;
    const gr = localRay(b, r);
    const gh = raycastGrid(gr.ox, gr.oy, gr.oz, gr.dx, gr.dy, gr.dz, reach, (x, y, z) => b.hasBlock(x, y, z));
    if (gh && (!block || gh.dist < block.dist)) block = bodyHit('giant', b, gh, giant);
  }
  let actor: Actor | null = null;
  let actorDist = Infinity;
  const actors = g.pet ? [...g.mobs, ...g.villagers, ...g.animals, g.pet.a] : [...g.mobs, ...g.villagers, ...g.animals];
  for (const a of actors) {
    if (a.dead || a.recruited) continue;
    const pad = a.kind === 'chicken' ? 0.25 : 0.15;
    const d = rayBox(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, a.x - a.hw - pad, a.y, a.z - a.hw - pad, a.x + a.hw + pad, a.y + a.h + 0.1, a.z + a.hw + pad);
    if (d !== null && d < actorDist && d <= (a.kind === 'villager' || a.kind === 'npc' || a.kind === 'wolf' ? RECRUIT : MELEE)) {
      actor = a;
      actorDist = d;
    }
  }
  return { block, actor, actorDist };
}

export function targetCenter(t: Target): { x: number; y: number; z: number } {
  if (t.body) return t.body.cellCenter(t.x, t.y, t.z);
  return { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 };
}

/**
 * The monster a tap or press means to strike: the one under the ray, else (thumbs are not
 * crosshairs) the nearest one within reach close to the ray with nothing solid in between.
 */
export function meleeTarget(g: Game, r: Ray): Actor | null {
  const hit = pick(g, r, RECRUIT);
  if (hit.actor && hostile(hit.actor) && hit.actorDist <= MELEE && (!hit.block || hit.actorDist < hit.block.dist)) return hit.actor;
  let best: Actor | null = null;
  let bestScore = Infinity;
  for (const m of g.mobs) {
    if (m.dead) continue;
    const dx = m.x - r.ox;
    const dy = m.cy - r.oy;
    const dz = m.z - r.oz;
    const d = Math.hypot(dx, dy, dz);
    if (d > MELEE + 0.4 || d < 0.15) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * r.dx + dy * r.dy + dz * r.dz) / d)));
    // A wider cone for whatever is right in your face.
    if (angle > 0.24 + Math.max(0, 2.6 - d) * 0.14) continue;
    if (raycastGrid(r.ox, r.oy, r.oz, dx / d, dy / d, dz / d, d - 0.4, (x, y, z) => g.world.solid(x, y, z))) continue;
    const score = angle * 3 + d * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

/** Item granted when a body block is salvaged whole. */
function salvageItem(id: number): number | null {
  if (ITEMS.has(id) && itemDef(id).place !== null) return id;
  const drop = blockDef(id).drops[0];
  return drop ? drop[0] : null;
}

// ------------------------------------------------------------------ mining

export function updateMining(g: Game, dt: number): void {
  const r = g.holdRay;
  const p = g.player;
  if (!r || p.dead || g.leap || !g.isPlaying()) {
    g.mining.target = null;
    g.mining.progress = 0;
    return;
  }
  // Held on the guns (or at the helm): every turret fires as it reloads.
  if (g.gunner || g.helm) {
    fireCannon(g, r);
    g.mining.target = null;
    return;
  }
  // Holding with the crossbow keeps shooting as fast as it reloads.
  if (g.selected === I.CROSSBOW && g.mode === 'mine') {
    if (g.bowCooldown <= 0) fireCrossbow(g, r);
    g.mining.target = null;
    return;
  }
  const foe = meleeTarget(g, r);
  if (foe) {
    meleeMob(g, foe);
    g.mining.target = null;
    return;
  }
  const hit = pick(g, r);
  const t = hit.block;
  if (!t) {
    g.mining.target = null;
    g.mining.progress = 0;
    return;
  }
  if (!g.mining.target || g.mining.target.sig !== t.sig || g.mining.target.id !== t.id) {
    g.mining.target = t;
    g.mining.progress = 0;
  }
  const def = blockDef(t.id);
  g.mining.blocked = !Number.isFinite(def.hardness) || t.id === B.HELM;
  if (g.mining.blocked) {
    if (t.id === B.CORE) g.deny('The Engine Core cannot be removed');
    return;
  }
  // The sword cuts webs in a blink but is a poor pick.
  const tool = g.wieldsSword() ? (t.id === B.COBWEB ? 6 : 0.45) : 1;
  g.mining.progress += (dt * tool) / Math.max(0.05, def.hardness * (1 - Math.min(0.3, g.level() * 0.015)));
  g.mining.swing = 0.2;
  g.digFx -= dt;
  if (g.digFx <= 0) {
    g.digFx = 0.14;
    const c = targetCenter(t);
    const [nx, nz] = t.body ? t.body.dirToWorld(t.nx, t.nz) : [t.nx, t.nz];
    g.sfx('dig', materialOf(t.id), 0.8);
    g.particles.debris(c.x + nx * 0.55, c.y + t.ny * 0.55, c.z + nz * 0.55, def.tiles.side, 2, 2, 0.08, 0.35);
  }
  if (g.mining.progress >= 1) {
    completeMining(g, t);
    g.mining.target = null;
    g.mining.progress = 0;
  }
}

export function completeMining(g: Game, t: Target): void {
  const def = blockDef(t.id);
  const c = targetCenter(t);
  g.stats.mined += 1;
  g.flags.mined += 1;
  g.particles.debris(c.x, c.y, c.z, def.tiles.side, 12, 3.5);
  g.sfx('break', materialOf(t.id));
  g.report('visual_feedback');
  g.report('primary_input');
  if (t.kind === 'world') {
    if (t.id === B.CHEST) {
      lootChest(g, t.x, t.y, t.z);
      return;
    }
    if (t.id === B.CITADEL_HEART) {
      g.heartHit(t.x, t.y, t.z);
      return;
    }
    for (const [item, min, max] of def.drops) g.addItem(item, min + Math.floor(Math.random() * (max - min + 1)));
    if (t.id === B.COAL_ORE || t.id === B.IRON_ORE || t.id === B.REDSTONE_ORE) g.xp(2);
    g.world.set(t.x, t.y, t.z, B.AIR);
    if (t.id === B.DISPENSER) g.ui.banner('WATCHTOWER CANNON!', 'Bolt it onto your fortress', 'gold');
    if (t.id === B.WINDMILL_HUB) g.ui.banner('WINDMILL THRUSTER!', 'Power it to march faster', 'gold');
  } else if (t.kind === 'fortress') {
    const id = g.fortress.removeBlock(t.x, t.y, t.z);
    g.addItem(salvageItem(id) ?? id, 1);
    checkFortressIntegrity(g);
  } else if (t.giant) {
    const giant = t.giant;
    const id = giant.body.removeBlock(t.x, t.y, t.z);
    if (id === B.GIANT_HEART) {
      for (const [item, min] of def.drops) g.addItem(item, min);
      killGiant(g, giant, false);
      return;
    }
    const item = salvageItem(id);
    if (item !== null) g.addItem(item, 1);
    if (id === B.CANNON || id === B.THRUSTER || id === B.IRON_BLOCK) g.toast(`STOLEN: ${blockDef(id).name}!`, itemDef(item ?? id).icon);
    giant.body.shake = 0.15;
    checkGiantIntegrity(g, giant);
  }
}

function lootChest(g: Game, x: number, y: number, z: number): void {
  // A captain's chest: shut while what guards it stands; the crest lies in it.
  const crest = crestChestAt(g, x, y, z);
  if (crest >= 0 && mainQuestOn(g) && !wardenBeaten(g, crest)) {
    g.deny(`${EXPEDITIONS[crest]!.wardenName} holds this chest shut: bring it down first`);
    return;
  }
  if (crest >= 0 && mainQuestOn(g)) {
    grantCrest(g, crest);
    g.addItem(I.VEYRA_NOTE, 1);
  }
  const loot = g.world.lootAt(x, y, z);
  g.flags.looted += 1;
  for (const [id, n] of loot) g.addItem(id, n);
  g.world.markLooted(x, y, z);
  g.world.set(x, y, z, B.AIR);
  g.addItem(B.PLANKS, 2, true);
  const s = g.world.structureAt(x, y, z);
  // Old chests hold a little of their land's metal; the canyon's relics find a little more.
  const metal = g.world.terrain.version >= 2 ? landMetal(g.world.terrain.zone(x, z)) : null;
  if (metal !== null && loot.length > 0) g.addItem(metal, 1 + Math.floor(Math.random() * 2));
  if (setDone(g, 3)) g.addItem(I.EMERALD, 2, true);
  const curio = s?.id.startsWith('n:stash') ? curioIn(g, s.id.slice(2)) : null;
  if (curio) findCurio(g, curio);
  else g.ui.banner('LOOT!', loot.length ? 'Abandoned supplies salvaged' : 'Someone got here first', 'gold');
  g.xp(5);
  journalFrom(g, x, y, z);
}

/** Old keeps and mines keep pages of the builders' journal among their supplies. */
export function journalFrom(g: Game, x: number, y: number, z: number): void {
  const s = g.world.structureAt(x, y, z);
  if (s?.kind === 'castle') g.addPage('ruins');
  else if (s?.kind === 'mine') g.addPage('mine');
}

// ------------------------------------------------------------------ context actions

export interface ContextAction {
  label: string;
  run: () => void;
  /** Done by this device itself even as a co-op guest (it moves only its own player). */
  local?: boolean;
}

/** The building a world target belongs to, when the crane could lift it. */
function hoistTarget(g: Game, t: Target | null): Structure | null {
  if (!t || t.kind !== 'world') return null;
  const s = g.world.structureAt(t.x, t.y, t.z);
  if (!s || !HOIST_INFO[s.kind]) return null;
  return s;
}

/** What "use" (E, right click, the action button) would do for the crosshair target. */
export function contextAction(g: Game): ContextAction | null {
  if (!g.isPlaying() || g.player.dead || g.leap || g.overSide) return null;
  // The crane waits on whoever lifted: heave it out of the ground, or let it down over its place.
  const beat = craneBeat(g);
  if (beat) return { label: beat === 'heave' ? 'HEAVE!' : beat === 'bomb' ? 'DROP TNT!' : 'DROP!', run: () => craneTap(g) };
  // (At the crane's controls while the crew hooks the crate on: nothing else to do.)
  if (g.craneDrop?.by === g.cx) return null;
  if (g.helm) return { label: 'LEAVE HELM', run: () => g.leaveHelm() };
  if (g.gunner) return { label: 'LEAVE GUNS', run: () => g.leaveGuns() };
  // A hen in your arms: the button puts her down (or, pushing against the rail, she flaps you down).
  if (g.carried) {
    if (offeredExit(g)) return { label: 'JUMP DOWN', run: () => g.jumpDown(), local: true };
    return { label: 'SET DOWN HEN', run: () => setDownHen(g) };
  }
  const ray = g.viewRay();
  const near = pick(g, ray, RECRUIT);
  if (near.actor && near.actor.kind === 'villager' && (!near.block || near.actorDist < near.block.dist)) {
    const v = near.actor;
    return { label: v.trader ? 'TRADE' : v.freed ? 'FREE CAPTIVE' : v.captive ? 'GUARDED' : 'RECRUIT', run: () => recruit(g, v) };
  }
  if (near.actor && near.actor.kind === 'npc' && (!near.block || near.actorDist < near.block.dist)) {
    const v = near.actor;
    return { label: v.captive ? 'GUARDED' : 'TALK', run: () => recruit(g, v) };
  }
  if (near.actor && near.actor.kind === 'wolf' && near.actorDist < 4 && (!near.block || near.actorDist < near.block.dist)) return { label: `PET ${g.pet?.name.toUpperCase() ?? 'PIP'}`, run: () => petPet(g) };
  // The new folk: the wandering trader's wares; a village golem that may come aboard.
  const folk = near.actor && (!near.block || near.actorDist < near.block.dist) ? near.actor : null;
  if (folk && folk.kind === 'wtrader') return { label: 'TRADE', run: () => g.ui.openWanderer() };
  if (folk && folk.kind === 'golem' && !folk.boarded && near.actorDist < 6) return { label: `TAKE GOLEM ABOARD · ${GOLEM_PRICE}◆`, run: () => takeGolem(g, folk) };
  const animal = near.actor && (near.actor.kind === 'chicken' || near.actor.kind === 'sheep') && near.actorDist < 4 && (!near.block || near.actorDist < near.block.dist) ? near.actor : null;
  if (animal?.kind === 'chicken') return { label: 'PICK UP HEN', run: () => pickUpHen(g, animal) };
  if (animal) return { label: animal.wool >= 1 ? 'SHEAR SHEEP' : 'PAT SHEEP', run: () => shearSheep(g, animal) };
  const t = near.block && near.block.dist <= REACH ? near.block : null;
  if (t && t.kind === 'fortress') {
    if (t.id === B.CANNON || t.id === B.MORTAR) {
      const key = g.cellKey(t.x, t.y, t.z);
      const s = g.fortress.cannons.get(key);
      if (s && s.ammo < MAGAZINE) return { label: 'LOAD TNT', run: () => void loadCannon(g, key) };
    }
    if (t.id === B.HELM && !g.helm) return { label: 'TAKE HELM', run: () => g.takeHelm() };
    if (t.id === B.CORE) {
      if (g.count(I.HEARTSTONE) > 0) return { label: 'SOCKET HEARTSTONE', run: () => socketHeartstone(g) };
      const c = g.fortress.cells.get(g.cellKey(t.x, t.y, t.z));
      if (c && c.hp < c.maxHp - 1) return { label: 'REPAIR CORE', run: () => repairCore(g) };
    }
  }
  if (t && (t.id === B.CRAFTING_TABLE || t.id === B.FURNACE)) return { label: 'CRAFT', run: () => g.ui.openWorkshop() };
  if (t && t.kind === 'world' && t.id === B.CHEST) {
    const { x, y, z } = t;
    return { label: sealedChest(g, x, y, z) ? 'SEALED' : crestChestAt(g, x, y, z) >= 0 ? 'OPEN THE CHEST' : 'LOOT', run: () => lootChest(g, x, y, z) };
  }
  // The Builders' anvil: six crests go in, one Key comes out.
  if (t && t.kind === 'world' && t.id === B.ANVIL) return g.mq.key ? null : { label: 'REFORGE THE CRESTS', run: () => void reforge(g) };
  // Pushing against the deck's rail over a long drop: over the side (the parachute opens by itself).
  if (offeredExit(g)) return { label: 'JUMP DOWN', run: () => g.jumpDown(), local: true };
  // Standing at a cannon (looking anywhere): top up its magazine.
  const manned = g.mannedCannon();
  if (manned && usesTnt(turretKind(g.fortress, manned.key))) {
    const s = g.fortress.cannons.get(manned.key);
    if (s && s.ammo < MAGAZINE && g.count(I.TNT) > 0) return { label: 'LOAD TNT', run: () => void loadCannon(g, manned.key) };
  }
  // Co-op: by a turret, take the guns (your mate steers, you fire).
  if (manned && g.coopLive && !g.otherGunner()) return { label: 'MAN THE GUNS', run: () => g.takeGuns() };
  // Buildings further away: the crane (it reaches over your rail; a near miss still counts).
  const s = hoistAim(g, ray);
  if (s) {
    const check = hoistCheck(g, s);
    const label = HOIST_INFO[s.kind]!.label.toUpperCase();
    if (check.ok) return { label: `HOIST ${label}`, run: () => void startHoist(g, s) };
    // Say why it cannot be lifted yet (tapping repeats the full reason).
    if (check.why) {
      const short = check.why.startsWith('Too far') ? 'TOO FAR' : check.why.startsWith('The hold is full') ? 'HOLD FULL' : check.why.includes('busy') ? 'CRANE BUSY' : check.why.includes('part with') ? 'NOT YET' : 'TOO HEAVY';
      return { label: `${label}: ${short}`, run: () => g.deny(check.why) };
    }
  }
  // Standing by the crane's mast: swing a TNT crate out over the monsters.
  if (atCraneControls(g) && !g.hoist && !g.craneDrop) {
    if (g.craneDropCool > 0) return { label: 'CRANE: NEXT CRATE...', run: () => g.deny('The crew is still hooking on the next crate') };
    return { label: `CRANE DROP · ${DROP_TNT} TNT`, run: () => void startCraneDrop(g) };
  }
  // Standing by the wheel (looking anywhere else): take the helm.
  if (g.nearHelm()) return { label: 'TAKE HELM', run: () => g.takeHelm() };
  // By a damaged leg (over its hip on the deck, or at its foot): patch it up.
  const leg = legInReach(g);
  if (leg >= 0) return { label: 'REPAIR LEG', run: () => repairLegAt(g, leg) };
  if (g.hunger < 18 && g.count(I.BREAD) > 0 && g.heldItem() === I.BREAD) return { label: 'EAT', run: () => g.eat() };
  return null;
}

// ------------------------------------------------------------------ repairs

/** The most damaged fortress leg within reach (its hip from the deck, or its foot and knee). */
export function legInReach(g: Game): number {
  const p = g.player;
  if (p.dead) return -1;
  const W = g.walker;
  const F = g.fortress;
  let best = -1;
  let worst = 0.08;
  W.legs.forEach((l, i) => {
    if (l.damage <= worst) return;
    const hip = W.hipWorld(F, l);
    const knee = W.knee(F, l, hip);
    const onDeck = Math.hypot(p.x - hip[0], p.z - hip[2]) < 4.5 && p.y > hip[1] - 1 && p.y < hip[1] + 4;
    const atFoot = dist3(p.x, p.cy, p.z, l.foot[0], l.foot[1] + 1, l.foot[2]) < 3.2 || dist3(p.x, p.cy, p.z, knee[0], knee[1], knee[2]) < 3.2;
    if (!onDeck && !atFoot) return;
    worst = l.damage;
    best = i;
  });
  return best;
}

/** Iron and a hammer: a leg is mended most of the way. */
export function repairLegAt(g: Game, i: number): void {
  if (!g.useItem(I.IRON_INGOT, 1)) {
    g.deny('Repairs need an Iron Ingot (smelt iron ore at a furnace)');
    return;
  }
  repairLeg(g, i, 0.6);
  const l = g.walker.legs[i];
  if (l) {
    const hip = g.walker.hipWorld(g.fortress, l);
    const knee = g.walker.knee(g.fortress, l, hip);
    g.particles.sparks(knee[0], knee[1], knee[2], ['#ffd040', '#ffffff'], 16, 4, 0.1, 0.5);
  }
  g.sfx('craft', 'metal', 1);
  g.toast('Leg repaired', 'ui_hammer');
  g.report('primary_input');
}

export function repairCore(g: Game): void {
  const key = g.coreKey();
  const c = key === null ? null : g.fortress.cells.get(key);
  if (!c || key === null) return;
  if (!g.useItem(I.IRON_INGOT, 1)) {
    g.deny('Repairs need an Iron Ingot (smelt iron ore at a furnace)');
    return;
  }
  c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.35);
  const q = g.fortress.cellCenter(kx(key), ky(key), kz(key));
  g.particles.sparks(q.x, q.y, q.z, ['#ffd040', '#ff4030', '#ffffff'], 18, 4, 0.1, 0.5);
  g.sfx('craft', 'metal', 1);
  g.toast(`Engine Core repaired (${Math.round((c.hp / c.maxHp) * 100)}%)`, 'ui_hammer');
  g.report('primary_input');
}

// ------------------------------------------------------------------ tapping / right click

export function tapAction(g: Game, r: Ray): void {
  const hit = pick(g, r, RECRUIT);
  const t = hit.block;
  if (hit.actor && (!t || hit.actorDist < t.dist) && (hit.actor.kind === 'villager' || hit.actor.kind === 'npc')) {
    recruit(g, hit.actor);
    return;
  }
  if (hit.actor && (!t || hit.actorDist < t.dist) && hit.actor.kind === 'wolf') {
    petPet(g);
    return;
  }
  // A hen to scoop up, a sheep to shear (or pat).
  if (hit.actor && (!t || hit.actorDist < t.dist) && hit.actorDist < 4.5 && (hit.actor.kind === 'chicken' || hit.actor.kind === 'sheep')) {
    if (hit.actor.kind === 'chicken') pickUpHen(g, hit.actor);
    else shearSheep(g, hit.actor);
    return;
  }
  // Relics in hand: the hook flies, the crossbow shoots, a Heartbreaker is thrown.
  if (g.mode === 'mine') {
    if (g.selected === I.GRAPPLE) {
      fireGrapple(g, r);
      return;
    }
    if (g.selected === I.CROSSBOW) {
      fireCrossbow(g, r);
      return;
    }
    if (g.selected === I.BREAKER) {
      throwBreaker(g, r);
      return;
    }
    if (g.selected === I.PEARL) {
      throwPearl(g, r);
      return;
    }
    if (g.selected === I.WIND_CHARGE) {
      throwWindCharge(g, r);
      return;
    }
  }
  if (hit.actor && (!t || hit.actorDist < t.dist) && hostile(hit.actor)) {
    meleeMob(g, hit.actor);
    return;
  }
  if (g.selected === I.BREAD) {
    g.eat();
    return;
  }
  // TNT in hand: load the turret you tap, otherwise throw it.
  if (g.selected === I.TNT && g.mode === 'mine') {
    if (t && t.kind === 'fortress' && t.dist <= REACH && (t.id === B.CANNON || t.id === B.MORTAR)) loadCannon(g, g.cellKey(t.x, t.y, t.z));
    else throwTnt(g, r);
    return;
  }
  // Sword or pick in hand: a monster close to where you tapped takes the blow.
  if (g.mode === 'mine') {
    const foe = meleeTarget(g, r);
    if (foe) {
      meleeMob(g, foe);
      return;
    }
  }
  if (!t || t.dist > REACH) {
    if (g.mode === 'build') g.deny('Too far: move closer to build');
    else swingAir(g);
    return;
  }
  if (g.mode !== 'build' || g.selected === null) {
    if (t.id === B.CRAFTING_TABLE || t.id === B.FURNACE) g.ui.openWorkshop();
    else if (t.kind === 'world' && t.id === B.CHEST) lootChest(g, t.x, t.y, t.z);
    else if (t.kind === 'world' && t.id === B.ANVIL && !g.mq.key) reforge(g);
    else if (t.kind === 'fortress' && (t.id === B.CANNON || t.id === B.MORTAR)) loadCannon(g, g.cellKey(t.x, t.y, t.z));
    else if (t.kind === 'fortress' && t.id === B.HELM) g.takeHelm();
    return;
  }
  tryPlace(g, t);
}

/** A swing at thin air: the arm still moves and the blade still whooshes (as in Minecraft). */
function swingAir(g: Game): void {
  if (g.attackCooldown > 0) return;
  g.attackCooldown = 0.22;
  g.mining.swing = 0.25;
  g.sfx('swing', 'wood', g.wieldsSword() ? 0.7 : 0.45);
}

function actorBlocks(g: Game, x0: number, y0: number, z0: number): boolean {
  for (const a of [g.player, ...g.mobs, ...g.villagers, ...g.animals]) {
    if (a.dead) continue;
    if (a.x + a.hw > x0 + 0.02 && a.x - a.hw < x0 + 0.98 && a.z + a.hw > z0 + 0.02 && a.z - a.hw < z0 + 0.98 && a.y + a.h > y0 + 0.02 && a.y < y0 + 0.98) return true;
  }
  return false;
}

/** Whether a body has a block in the world cell (x0, y0, z0) (sampled: bodies may be turned). */
function bodyOccupies(body: BlockBody, x0: number, y0: number, z0: number): boolean {
  for (const [ox, oz] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]] as const) {
    for (const oy of [0.1, 0.9]) {
      const [x, y, z] = body.cellAt(x0 + ox, y0 + oy, z0 + oz);
      if (body.hasBlock(x, y, z)) return true;
    }
  }
  return false;
}

function worldOccupies(g: Game, x0: number, y0: number, z0: number): boolean {
  for (let y = Math.floor(y0 + 0.02); y <= Math.floor(y0 + 0.98); y += 1) {
    for (let z = Math.floor(z0 + 0.02); z <= Math.floor(z0 + 0.98); z += 1) {
      for (let x = Math.floor(x0 + 0.02); x <= Math.floor(x0 + 0.98); x += 1) if (!blockDef(g.world.get(x, y, z)).replaceable) return true;
    }
  }
  return false;
}

/** Facing for stairs and front-faced blocks: towards the builder (in the grid's own frame). */
function facingFor(g: Game, place: number, yaw: number): number {
  const def = blockDef(place);
  if (def.shape !== 'stairs' && def.tiles.front === null) return 0;
  const [fx, , fz] = [Math.cos(yaw), 0, Math.sin(yaw)];
  // Front faces look back at the builder; stairs rise away from them.
  if (def.shape === 'stairs') return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 0 : 1) : (fz > 0 ? 2 : 3);
  return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 0) : (fz > 0 ? 3 : 2);
}

function tryPlace(g: Game, t: Target): void {
  const id = g.selected!;
  const place = itemDef(id).place;
  if (place === null || g.count(id) <= 0) return;
  if (t.kind === 'giant') {
    g.deny('Bolt parts onto your own fortress');
    return;
  }
  // Machines only work as part of the fortress.
  if (t.kind !== 'fortress' && (place === B.CANNON || place === B.BALLISTA || place === B.MORTAR || place === B.THRUSTER)) {
    g.deny('Turrets and thrusters only work bolted onto your fortress deck');
    return;
  }
  const def = blockDef(place);
  // Ladders, torches and vines lean on the block that was tapped; lanterns stand or hang.
  let dir = facingFor(g, place, t.body ? g.yaw - t.body.yaw : g.yaw);
  if (place === B.LADDER || place === B.TORCH || place === B.REDSTONE_TORCH) {
    dir = DIRS.findIndex(([dx, dy, dz]) => dx === -t.nx && dy === -t.ny && dz === -t.nz);
    if (place === B.LADDER && (dir < 0 || t.ny !== 0)) {
      g.deny('Ladders go on walls');
      return;
    }
    if (place !== B.LADDER && (dir < 0 || t.ny < 0)) {
      g.deny('Torches go on top of or beside blocks');
      return;
    }
  }
  if (place === B.LANTERN) dir = t.ny < 0 ? 1 : 0;
  const cx = t.x + t.nx;
  const cy = t.y + t.ny;
  const cz = t.z + t.nz;
  const F = g.fortress;
  let wx: number;
  let wy: number;
  let wz: number;
  if (t.kind === 'fortress') {
    if (cx < F_MIN[0] || cx > F_MAX[0] || cy < F_MIN[1] || cy > F_MAX[1] || cz < F_MIN[2] || cz > F_MAX[2]) {
      g.deny('Too far from the Engine Core to bolt on');
      return;
    }
    if (F.cells.size - g.holdSize() >= F_MAX_BLOCKS) {
      g.deny('Your fortress is at its maximum size');
      return;
    }
    if (F.hasBlock(cx, cy, cz)) return;
    // The world cell under the new block's centre (the deck may be turned).
    const [mx, my, mz] = F.toWorld(cx + 0.5, cy + 0.5, cz + 0.5);
    wx = Math.floor(mx);
    wy = Math.floor(my);
    wz = Math.floor(mz);
    if (worldOccupies(g, wx, wy, wz)) {
      g.deny('Terrain is in the way');
      return;
    }
  } else {
    if (!g.world.inBounds(cx, cy, cz) || !blockDef(g.world.get(cx, cy, cz)).replaceable) return;
    wx = cx;
    wy = cy;
    wz = cz;
    if (bodyOccupies(F, wx, wy, wz)) return;
  }
  for (const giant of g.giants) {
    if (!giant.dead && bodyOccupies(giant.body, wx, wy, wz)) return;
  }
  if (def.solid && actorBlocks(g, wx, wy, wz)) {
    g.deny('Something is standing there');
    return;
  }
  if (t.kind === 'fortress') {
    F.setBlock(cx, cy, cz, place, undefined, Math.max(0, dir));
  } else {
    g.world.set(cx, cy, cz, place, dir >= 0 && (def.shape !== 'cube' || def.tiles.front !== null || place === B.LANTERN) ? dir : -1);
  }
  g.useItem(id, 1);
  g.stats.placed += 1;
  g.mining.swing = 0.2;
  g.sfx('place', materialOf(place));
  g.particles.debris(wx + 0.5, wy + 0.5, wz + 0.5, def.tiles.side, 4, 1.5, 0.08, 0.3);
  g.report('primary_input');
  g.report('visual_feedback');
  if (t.kind !== 'fortress') return;
  if (place === B.CANNON || place === B.THRUSTER || place === B.MORTAR) {
    if (place === B.THRUSTER) g.flags.thrusterPlaced = true;
    else g.flags.cannonPlaced = true;
    if (!F.poweredMachines.has(g.cellKey(cx, cy, cz))) g.toast('Needs power: lay Redstone Wire from the Engine Core to it');
    else g.toast(`${def.name} online!`);
  } else if (place === B.BALLISTA) {
    g.flags.cannonPlaced = true;
    g.toast('Ballista ready: it needs no power and no ammo');
  }
  if (place === B.WIRE) {
    const counts = g.machineCounts();
    if (counts.total > 0 && counts.powered === counts.total && F.poweredWires.has(g.cellKey(cx, cy, cz))) g.toast('All machines powered!');
  }
}

// ------------------------------------------------------------------ crafting

export function stationsNearby(g: Game): Stations {
  const p = g.player;
  const cx = p.x;
  const cy = p.y + 1;
  const cz = p.z;
  let table = false;
  let furnace = false;
  const r = 4;
  for (let y = Math.floor(cy - r); y <= Math.floor(cy + r); y += 1) {
    for (let z = Math.floor(cz - r); z <= Math.floor(cz + r); z += 1) {
      for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x += 1) {
        const id = g.world.get(x, y, z);
        if (id === B.CRAFTING_TABLE) table = true;
        else if (id === B.FURNACE) furnace = true;
      }
    }
  }
  const F = g.fortress;
  for (const [key, c] of F.cells) {
    if (c.id !== B.CRAFTING_TABLE && c.id !== B.FURNACE) continue;
    const q = F.cellCenter(kx(key), ky(key), kz(key));
    if (dist3(q.x, q.y, q.z, cx, cy, cz) <= r + 0.5) {
      if (c.id === B.CRAFTING_TABLE) table = true;
      else furnace = true;
    }
  }
  return { table, furnace };
}

export function recipeStatus(g: Game, recipe: Recipe, stations: Stations): { ok: boolean; station: boolean; missing: boolean } {
  const station = recipe.station === 'none' || (recipe.station === 'table' ? stations.table : stations.furnace);
  const missing = recipe.inputs.some(([id, n]) => g.count(id) < n);
  return { ok: station && !missing, station, missing };
}

export function craft(g: Game, recipeId: string): boolean {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return false;
  const status = recipeStatus(g, recipe, stationsNearby(g));
  if (!status.station) {
    g.deny(recipe.station === 'table' ? 'Stand near a Crafting Table' : 'Stand near a Furnace');
    return false;
  }
  if (status.missing) {
    g.deny('Not enough materials');
    return false;
  }
  for (const [id, n] of recipe.inputs) g.useItem(id, n);
  g.addItem(recipe.out, recipe.count, true);
  g.stats.crafted += 1;
  g.sfx('craft');
  g.toast(`Crafted ${recipe.count}x ${itemDef(recipe.out).name}`, itemDef(recipe.out).icon);
  g.report('primary_input');
  g.xp(1);
  return true;
}

// ------------------------------------------------------------------ drops & debris

export function spawnDrop(g: Game, id: number, count: number, x: number, y: number, z: number): void {
  if (count <= 0) return;
  g.drops.push({ id, count, x, y, z, vx: (Math.random() - 0.5) * 3, vy: 3 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, age: 0 });
}

export function updateDrops(g: Game, dt: number): void {
  const F = g.fortress;
  const fc = g.fortressCentre();
  const crewReach = g.fortressRadius() + 22;
  const players = g.players();
  const pulled = new Set<ItemDrop>();
  for (const d of g.drops) {
    d.age += dt;
    // The nearer player gets it (the shared hold fills either way; the pickup is theirs to see).
    let ctx = players[0]!;
    if (players.length > 1) {
      let best = Infinity;
      for (const c of players) {
        if (c.player.dead) continue;
        const dd = Math.hypot(c.player.x - d.x, c.player.y + 0.9 - d.y, c.player.z - d.z);
        if (dd < best) {
          best = dd;
          ctx = c;
        }
      }
    }
    if (g.withCtx(ctx, () => pullDrop(g, d, dt, F, fc, crewReach))) pulled.add(d);
  }
  settleDrops(g, dt, pulled);
}

/** Flies a drop to the acting player when it is close enough to pick up. Returns true if it did. */
function pullDrop(g: Game, d: ItemDrop, dt: number, F: BlockBody, fc: Vec3, crewReach: number): boolean {
  const p = g.player;
  const cx = p.x;
  const cy = p.y + 0.9;
  const cz = p.z;
  // Aboard, the crew passes you whatever lands on (or near) the fortress.
  const aboard = p.standingOn === F || g.helm || g.gunner;
  {
    const dx = cx - d.x;
    const dy = cy - d.y;
    const dz = cz - d.z;
    const distance = Math.hypot(dx, dy, dz);
    const crew = aboard && d.age > 1.2 && Math.hypot(d.x - fc[0], d.z - fc[2]) < crewReach;
    if (!p.dead && d.age > 0.45 && (distance < 6 || crew) && g.isPlaying()) {
      const pull = (crew && distance > 6 ? 60 : 30) * dt;
      d.vx = (d.vx + (dx / distance) * pull) * 0.92;
      d.vy = (d.vy + (dy / distance) * pull) * 0.92;
      d.vz = (d.vz + (dz / distance) * pull) * 0.92;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.on = null;
      if (distance < 1) {
        g.ui.flyItem(d.id, d.x, d.y, d.z);
        g.own(() => g.addItem(d.id, d.count));
        g.sfx('pickup', 'stone', 1, 0.9 + Math.random() * 0.25);
        d.age = Infinity;
      }
      return true;
    }
  }
  return false;
}

/** Drops nobody is pulling in: they fall, settle and ride the deck. */
function settleDrops(g: Game, dt: number, pulled: Set<ItemDrop>): void {
  const F = g.fortress;
  for (const d of g.drops) {
    if (d.age === Infinity || pulled.has(d)) continue;
    // Resting on the deck: carried along as the fortress walks and turns.
    if (d.on) {
      const [x, y, z] = F.toWorld(d.on[0], d.on[1], d.on[2]);
      d.x = x;
      d.y = y;
      d.z = z;
      if (F.solidAt(Math.floor(d.on[0]), Math.floor(d.on[1] - 0.3), Math.floor(d.on[2]))) {
        if (d.age > 120) d.age = Infinity;
        continue;
      }
      d.on = null;
    }
    d.vy = Math.max(-20, d.vy - 24 * dt);
    d.vx *= 1 - Math.min(1, dt * 2);
    d.vz *= 1 - Math.min(1, dt * 2);
    const nx = d.x + d.vx * dt;
    const nz = d.z + d.vz * dt;
    if (!g.world.solid(Math.floor(nx), Math.floor(d.y + 0.1), Math.floor(nz)) && !F.solidAtWorld(nx, d.y + 0.1, nz)) {
      d.x = nx;
      d.z = nz;
    }
    const ny = d.y + d.vy * dt;
    if (d.vy < 0 && F.solidAtWorld(d.x, ny - 0.15, d.z)) {
      // Landed on the fortress: remember where, in its frame.
      const [lx, ly, lz] = F.toLocal(d.x, ny - 0.15, d.z);
      d.on = [lx, Math.floor(ly) + 1.15, lz];
      d.vx = d.vy = d.vz = 0;
    } else if (d.vy < 0 && g.world.solid(Math.floor(d.x), Math.floor(ny - 0.15), Math.floor(d.z))) {
      d.y = Math.floor(ny - 0.15) + 1.15;
      d.vy = 0;
    } else {
      d.y = ny;
    }
    if (d.age > 120) d.age = Infinity;
  }
  g.drops = g.drops.filter((d) => d.age !== Infinity && d.y > -10);
}

export function updateFalling(g: Game, dt: number): void {
  for (const f of g.falling) {
    f.age += dt;
    f.vy = Math.max(-30, f.vy - 28 * dt);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    f.rot += f.vr * dt;
    if ((f.vy < 0 && g.world.solid(Math.floor(f.x), Math.floor(f.y - 0.4), Math.floor(f.z))) || f.age > 6) {
      g.particles.debris(f.x, f.y, f.z, blockDef(f.id).tiles.side, 6, 3);
      if (f.drop) {
        const item = salvageItem(f.id);
        if (item !== null) spawnDrop(g, item, 1, f.x, f.y + 0.3, f.z);
      }
      f.age = Infinity;
    }
  }
  g.falling = g.falling.filter((f) => f.age !== Infinity);
}
