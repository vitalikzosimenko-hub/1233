// The officers in play: who has been met, how far their errand has got, who is aboard. Errands move on
// by themselves (a place reached, an item in hand, a monster down); going back to the officer ends
// one. Aboard, an officer stands a post on the deck, says something new in every land, and their
// skill is the fortress's for good. Everything is the host's: a co-op mate reads it from the mirror.
import { Actor, type ActorKind } from './entities';
import { feat } from './feats';
import type { Game } from './game';
import type { Goal } from './guide';
import { chapterNow } from './mainquest';
import type { Vec3 } from './math3d';
import { OFFICERS, officer, officerOf, type OfficerDef, type OfficerId, type Step } from './officers';
import { CAPTIVE } from './wardens';
import type { Site } from './terrain';

/** How one officer stands with you (saved). */
export interface OfficerState {
  met: boolean;
  /** The errand's step under way (steps.length: go back and tell them). */
  step: number;
  /** Counted so far on this step (monsters slain). */
  got: number;
  /** The errand is done and they are aboard. */
  done: boolean;
  /** The last chapter they have spoken about. */
  heard: number;
}

export function stateOf(g: Game, id: OfficerId): OfficerState {
  let s = g.company[id];
  if (!s) {
    s = { met: false, step: 0, got: 0, done: false, heard: -1 };
    g.company[id] = s;
  }
  return s;
}

/** An officer's skill is yours. */
export function hasOfficer(g: Game, id: OfficerId): boolean {
  return g.company[id]?.done === true;
}

function def(id: string): OfficerDef {
  return officer(id)!;
}

function stepOf(d: OfficerDef, s: OfficerState): Step | null {
  return d.steps[s.step] ?? null;
}

// ------------------------------------------------------------------ the folk in the world

/** Where an officer waits in their village (not on the well's stall). */
function waitSpot(g: Game, v: Site): [number, number] {
  const well = g.world.structures.byId.get(`v${v.index}:well`);
  const x = (well ? well.minX : v.x) - 3.5;
  const z = (well ? (well.minZ + well.maxZ + 1) / 2 : v.z) + 2.5;
  return [x, z];
}

function spawn(g: Game, d: OfficerDef, x: number, y: number, z: number): Actor {
  const a = new Actor('npc', x, y, z);
  a.npc = d.id;
  // (How a co-op mate knows whose face to draw.)
  a.tint = OFFICERS.indexOf(d);
  a.region = -4;
  a.homeX = x;
  a.homeZ = z;
  a.trader = true;
  a.yaw = Math.random() * Math.PI * 2;
  g.villagers.push(a);
  return a;
}

/** A village streams in: its officer, if they have not gone aboard. */
export function spawnVillageOfficer(g: Game, v: Site): void {
  if (g.world.terrain.version < 2) return;
  const d = officerOf(v.index);
  if (!d || hasOfficer(g, d.id) || g.villagers.some((o) => o.npc === d.id)) return;
  const [x, z] = waitSpot(g, v);
  spawn(g, d, x, g.world.groundAt(x, z), z);
}

/** Tova, in the outlaws' first cage (or, the cage open, waiting beside it until you have spoken). */
export function spawnCaged(g: Game, x: number, y: number, z: number, caged = true): void {
  const d = def('tova');
  if (hasOfficer(g, 'tova') || g.villagers.some((o) => o.npc === 'tova')) return;
  const a = spawn(g, d, x, y, z);
  a.trader = !caged;
  a.captive = caged;
  a.region = CAPTIVE;
}

/** A free deck spot with headroom, spread from the others and clear of the rail. */
function deckPost(g: Game): [number, number] | null {
  const F = g.fortress;
  const taken = g.villagers.filter((o) => o.boarded).map((o) => [o.homeX, o.homeZ] as const);
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (const k of F.cells.keys()) {
    if (Math.floor(k / 16384) - 64 !== 0) continue;
    const x = (k % 128) - 64;
    const z = (Math.floor(k / 128) % 128) - 64;
    if (F.solidAt(x, 1, z) || F.solidAt(x, 2, z) || F.hasBlock(x, 1, z)) continue;
    const spread = Math.min(6, ...taken.map(([tx, tz]) => Math.hypot(tx - x, tz - z)));
    const score = spread - Math.hypot(x - 7, z - 5) * 0.2 + Math.random() * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = [x, z];
    }
  }
  return best;
}

function standAboard(g: Game, a: Actor): boolean {
  const post = deckPost(g);
  if (!post) return false;
  a.homeX = post[0] + 0.5;
  a.homeZ = post[1] + 0.5;
  placeOnDeck(g, a);
  a.boarded = true;
  a.captive = false;
  a.trader = true;
  a.region = -4;
  return true;
}

function placeOnDeck(g: Game, a: Actor): void {
  const [x, y, z] = g.fortress.toWorld(a.homeX, 1.002, a.homeZ);
  a.x = x;
  a.y = y;
  a.z = z;
  a.vx = a.vy = a.vz = 0;
  a.standingOn = g.fortress;
  a.onGround = true;
}

/** Everyone aboard at the start of a game (Brannoc, and whoever a saved game had on deck). */
export function restoreOfficers(g: Game): void {
  // (The Long March only: the classic valley predates the crew.)
  if (g.world.terrain.version < 2) return;
  for (const d of OFFICERS) {
    if (d.village !== -1 && !hasOfficer(g, d.id)) continue;
    const a = spawn(g, d, 0, 0, 0);
    if (!standAboard(g, a)) g.villagers = g.villagers.filter((o) => o !== a);
  }
}

/** Per step: officers aboard ride the deck and turn to you; errands move on. */
export function updateOfficers(g: Game, dt: number): void {
  const F = g.fortress;
  const p = g.player;
  for (const a of g.villagers) {
    if (a.kind !== 'npc' || !a.boarded) continue;
    placeOnDeck(g, a);
    a.yaw += F.turned();
    if (Math.hypot(p.x - a.x, p.z - a.z) < 6) a.yaw = Math.atan2(p.z - a.z, p.x - a.x);
    // (The hold grew over their post: they find another.)
    if (F.solidAt(Math.floor(a.homeX), 1, Math.floor(a.homeZ))) standAboard(g, a);
  }
  if (g.coopGuest) return;
  g.errandTimer -= dt;
  if (g.errandTimer > 0) return;
  g.errandTimer = 0.4;
  for (const d of OFFICERS) {
    const s = g.company[d.id];
    if (!s?.met || s.done) continue;
    advance(g, d, s);
  }
}

function advance(g: Game, d: OfficerDef, s: OfficerState): void {
  const step = stepOf(d, s);
  if (!step) return;
  let ok = false;
  const near = (x: number, z: number, r: number): boolean => g.players().some((c) => Math.hypot(c.player.x - x, c.player.z - z) < r);
  switch (step.kind) {
    case 'go': {
      const n = g.world.terrain.nooks.find((o) => o.id === step.nook);
      if (!n) break;
      // A place with a chest: it counts once the chest is open; a stone, when you stand by it.
      const st = g.world.structures.byId.get(`n:${n.id}`);
      const chest = st?.chests[0];
      ok = chest ? g.world.lootedChests.has(g.world.chestKey(chest.x, chest.y, chest.z)) : near(n.x, n.z, 7);
      if (ok && !chest) g.lightSurvey(n.id);
      break;
    }
    case 'wreck': {
      const e = g.world.terrain.expeditions[step.exp];
      ok = e !== undefined && near(e.x, e.z, e.r * 0.8);
      break;
    }
    case 'fetch':
      ok = g.count(step.item) >= step.n;
      break;
    case 'slay':
      ok = s.got >= step.n;
      break;
    case 'crest':
      ok = g.mq.crests.includes(step.exp);
      break;
    default:
      break;
  }
  if (!ok) return;
  s.step += 1;
  s.got = 0;
  const next = stepOf(d, s);
  g.toast(next ? next.text : `${d.errand}: go back to ${d.name}`, 'journal_item');
  g.sfx('quest', 'metal', 0.7);
  g.save();
}

/** A monster down: an errand's count, and what an errand wants it to drop. */
export function officerKill(g: Game, kind: ActorKind, drop: (id: number) => void): void {
  for (const d of OFFICERS) {
    const s = g.company[d.id];
    if (!s?.met || s.done) continue;
    const step = stepOf(d, s);
    if (step?.kind === 'slay' && step.mobs.includes(kind)) {
      s.got += 1;
      g.toast(`${step.text}: ${s.got}/${step.n}`);
    } else if (step?.kind === 'fetch' && step.drop?.from.includes(kind) && g.count(step.item) < step.n && Math.random() < step.drop.chance) drop(step.item);
  }
}

// ------------------------------------------------------------------ talking

/** Talking to an officer: what they say, and what follows from it. */
export function talkTo(g: Game, a: Actor): void {
  const d = officer(a.npc);
  if (!d) return;
  const s = stateOf(g, d.id);
  if (a.captive) {
    g.deny('Get the guards down first');
    return;
  }
  const chapter = Math.min(6, chapterNow(g));
  a.yaw = Math.atan2(g.player.z - a.z, g.player.x - a.x);
  if (!s.met) {
    s.met = true;
    g.ui.talk(d.id, d.hello, 'hello');
    g.sfx('page', 'wood', 0.8);
    g.save();
    return;
  }
  if (!s.done) {
    if (s.step >= d.steps.length) {
      finishErrand(g, d, s, a);
      return;
    }
    g.ui.talk(d.id, [d.busy], 'busy');
    return;
  }
  // Aboard: this land's line, or the last one they had.
  let line: string | undefined;
  for (let c = chapter; c >= 0 && !line; c -= 1) line = d.talk[c];
  s.heard = chapter;
  g.ui.talk(d.id, [line ?? d.busy], 'aboard');
}

function finishErrand(g: Game, d: OfficerDef, s: OfficerState, a: Actor): void {
  // What the errand was about changes hands.
  for (const step of d.steps) if (step.kind === 'fetch') g.useItem(step.item, step.n);
  s.done = true;
  for (const [id, n] of d.gift) g.addItem(id, n, true);
  g.xp(40);
  g.ui.talk(d.id, d.thanks, 'joined');
  if (!a.boarded) {
    g.particles.poof(a.x, a.y + 1, a.z, 10);
    standAboard(g, a);
    g.particles.poof(a.x, a.y + 1, a.z, 10);
  }
  g.ui.banner(`${d.name.toUpperCase()} JOINS YOU`, `${d.perk}: ${d.perkText}`, 'gold');
  g.sfx('quest', 'metal', 1);
  g.celebrate(3);
  g.cheer();
  feat(g, 'officer');
  if (OFFICERS.every((o) => hasOfficer(g, o.id))) feat(g, 'company');
  g.applyPerks();
  g.save();
}

// ------------------------------------------------------------------ dawn

/** What the officers aboard do with the morning. */
export function officerDawn(g: Game): void {
  if (hasOfficer(g, 'brannoc')) for (const l of g.walker.legs) l.damage = Math.max(0, l.damage - 0.2);
  if (hasOfficer(g, 'bo')) {
    g.hunger = 20;
    g.player.hp = Math.min(g.player.maxHp, g.player.hp + 6);
    g.toast('Bo\'s breakfast: full and warm', 'stew_item');
  }
}

// ------------------------------------------------------------------ the journal and the goal line

export interface Errand {
  d: OfficerDef;
  state: OfficerState;
  /** What to do now, and where (null: nowhere in particular). */
  text: string;
  target: Vec3 | null;
}

function stepTarget(g: Game, d: OfficerDef, s: OfficerState): Vec3 | null {
  const step = stepOf(d, s);
  const T = g.world.terrain;
  if (!step) {
    // Back to them.
    const a = g.villagers.find((o) => o.npc === d.id);
    if (a) return [a.x, a.y + 2.4, a.z];
    const v = T.villages[d.village];
    return v ? [v.x, v.y + 6, v.z] : null;
  }
  if (step.kind === 'go') {
    const n = T.nooks.find((o) => o.id === step.nook);
    return n ? [n.x + 0.5, n.y + 3, n.z + 0.5] : null;
  }
  if (step.kind === 'wreck' || step.kind === 'crest') {
    const e = T.expeditions[step.exp];
    return e ? [e.x + 0.5, e.y + 4, e.z + 0.5] : null;
  }
  // The nearest of the places it lies, that nobody has opened yet.
  if (step.kind === 'fetch' && step.at) {
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (const n of T.nooks) {
      if (n.kind !== step.at) continue;
      const chest = g.world.structures.byId.get(`n:${n.id}`)?.chests[0];
      if (chest && g.world.lootedChests.has(g.world.chestKey(chest.x, chest.y, chest.z))) continue;
      const d = Math.hypot(n.x - g.player.x, n.z - g.player.z);
      if (d < bestD) {
        bestD = d;
        best = [n.x + 0.5, n.y + 3, n.z + 0.5];
      }
    }
    return best;
  }
  return null;
}

/** The errands under way. */
export function errands(g: Game): Errand[] {
  const out: Errand[] = [];
  for (const d of OFFICERS) {
    const s = g.company[d.id];
    if (!s?.met || s.done) continue;
    const step = stepOf(d, s);
    let text = step ? step.text : `Go back to ${d.name}`;
    if (step?.kind === 'fetch') text += ` (${Math.min(g.count(step.item), step.n)}/${step.n})`;
    if (step?.kind === 'slay') text += ` (${s.got}/${step.n})`;
    out.push({ d, state: s, text, target: stepTarget(g, d, s) });
  }
  return out;
}

/** An errand with something to do close by (the goal line's business when nothing is pressing). */
export function nearErrand(g: Game): Goal | null {
  const p = g.player;
  let best: Goal | null = null;
  let bestD = 130;
  for (const e of errands(g)) {
    if (!e.target) continue;
    const d = Math.hypot(e.target[0] - p.x, e.target[2] - p.z);
    if (d >= bestD) continue;
    bestD = d;
    best = { tag: e.d.errand.toUpperCase(), text: e.text, target: e.target, tone: 'quest', label: e.d.name.toUpperCase(), icon: 'journal_item' };
  }
  return best;
}

/** A word in passing: a shout from someone you have not met, one of their own otherwise. */
export function officerWord(g: Game, a: Actor): string | null {
  const d = officer(a.npc);
  if (!d) return null;
  const pool = g.company[d.id]?.met ? d.idle : ['Captain! A word?', 'You there! Is that your Strider?', 'Over here, Captain!'];
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** An officer with something to say: a new errand, one to end, a word about this land. */
export function officerCall(g: Game, a: Actor): 'new' | 'done' | 'talk' | null {
  const d = officer(a.npc);
  if (!d) return null;
  const s = g.company[d.id];
  if (!s?.met) return 'new';
  if (!s.done) return s.step >= d.steps.length ? 'done' : null;
  return s.heard < Math.min(6, chapterNow(g)) && d.talk[Math.min(6, chapterNow(g))] ? 'talk' : null;
}

