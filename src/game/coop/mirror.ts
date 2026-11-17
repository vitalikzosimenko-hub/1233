// The state both co-op games share and how it travels: the host reads each field, the guest writes
// it back. Plain values go as they are; sets, maps and references to sites, monsters and giants
// become lists and ids on the way (an id is the host's number for an actor or a giant).
import type { Actor } from '../entities';
import type { Game } from '../game';
import { siteFrom, siteRef } from '../game';
import type { Giant } from '../giants';
import { guardianFrac } from '../guardians';
import { finalBossPct, type FinalBoss } from '../finalboss';
import { wardenFrac, type WardenState } from '../wardens';
import { clearSeal, type GuardianState } from '../seals';
import type { RelicId } from '../story';
import type { GuardianKind, Site } from '../terrain';

/** The host's side: ids for the things a field refers to. */
export interface Refs {
  id(o: object | null | undefined): number;
}

/** The guest's side: the mirrors those ids stand for. */
export interface Lookup {
  actor(id: number): Actor | null;
  giant(id: number): Giant | null;
}

interface Field {
  get(g: Game, r: Refs): unknown;
  set(g: Game, v: never, l: Lookup): void;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const site = (g: Game, v: unknown): Site | null => siteFrom(g.world.terrain, v);
const ref = (s: Site | null): [string, number] | null => (s ? siteRef(s) : null);

function plain<K extends keyof Game>(k: K, round?: (v: number) => number): Field {
  return {
    get: (g) => (round && typeof g[k] === 'number' ? round(g[k] as number) : g[k]),
    set: (g, v) => {
      (g as unknown as Record<string, unknown>)[k] = v;
    },
  };
}

function fill<T>(set: Set<T>, values: T[]): void {
  set.clear();
  for (const v of values) set.add(v);
}

/** Every shared field by its short name on the wire. */
export const SHARED: Record<string, Field> = {
  ph: plain('phase'),
  dy: plain('day'),
  dt: plain('dayTime', r2),
  dl: plain('dayLength'),
  ds: plain('dayStart', r4),
  pr: plain('progress', r4),
  nt: plain('nightTime', r2),
  nl: plain('nightLength'),
  nd: plain('nightDist', r2),
  sg: plain('siege'),
  ss: plain('siegeStage'),
  th: plain('nightTheme'),
  we: {
    get: (g) => [r4(g.weather.storm), r4(g.weather.blood), r4(g.weather.flash), r4(g.weather.dark)],
    set: (g, v: number[]) => {
      [g.weather.storm, g.weather.blood, g.weather.flash, g.weather.dark] = v as [number, number, number, number];
    },
  },
  bo: plain('bolt'),
  sp: plain('speed', r2),
  tr: plain('turnRate', r4),
  st: plain('steam', r2),
  bs: plain('boosting'),
  br: plain('blockReason'),
  bl: plain('blocked'),
  cr: plain('crew'),
  cro: plain('crewRoles'),
  cg: {
    get: (g) => g.cargo,
    set: (g, v: Game['cargo']) => {
      g.cargo = v;
      g.refreshHold();
    },
  },
  eb: plain('extraBunks'),
  cp: plain('craneParts'),
  sts: plain('stats'),
  fl: plain('flags'),
  qs: plain('questState'),
  rl: { get: (g) => [...g.relics], set: (g, v: RelicId[]) => fill(g.relics, v) },
  jn: { get: (g) => [...g.journal], set: (g, v: string[]) => fill(g.journal, v) },
  hs: plain('heartstones'),
  hc: plain('hornCharges'),
  ra: plain('rally', r2),
  xp: plain('xpPoints'),
  bc: plain('beacon'),
  td: plain('today'),
  bt: plain('bounty'),
  nlg: plain('nightLog'),
  pc: plain('poundCooldown', r2),
  pcm: plain('poundCooldownMax'),
  pd: plain('pound'),
  cj: plain('crewJoy', r2),
  hl: plain('heartLeft'),
  ht: plain('heartTotal'),
  oc: plain('outcome'),
  fi: plain('finale'),
  py: plain('pylons'),
  si: {
    get: (g) => g.siteIndex,
    set: (g, v: number) => {
      g.siteIndex = v;
      g.site = g.world.terrain.villages[v] ?? g.site;
    },
  },
  de: { get: (g) => ref(g.destination), set: (g, v: unknown) => void (g.destination = site(g, v)) },
  nf: { get: (g) => ref(g.nightFrom), set: (g, v: unknown) => void (g.nightFrom = site(g, v)) },
  ap: {
    get: (g) => (g.autopilot ? { x: r2(g.autopilot.x), z: r2(g.autopilot.z), site: ref(g.autopilot.site), route: g.autopilot.route, index: g.autopilot.index } : null),
    set: (g, v: { x: number; z: number; site: unknown; route: Array<[number, number]>; index: number } | null) => {
      g.autopilot = v ? { x: v.x, z: v.z, site: site(g, v.site), route: v.route, index: v.index, stuck: 0 } : null;
    },
  },
  md: plain('marchDir'),
  // The host's own hearts (the guest's HUD strip shows them).
  hhp: {
    get: (g) => [Math.ceil(g.me.player.hp), g.me.player.maxHp],
    set: (g, v: [number, number]) => {
      if (g.coopGuest) g.coopGuest.hostHp = v;
    },
  },
  inv: {
    get: (g) => [...g.inventory.entries()],
    set: (g, v: Array<[number, number]>) => {
      g.inventory.clear();
      for (const [id, n] of v) if (n > 0) g.inventory.set(id, n);
      g.ui.onInventoryChanged();
    },
  },
  ld: { get: (g) => [...g.lairsDone], set: (g, v: number[]) => fill(g.lairsDone, v) },
  tsh: { get: (g) => [...g.treasuresShown], set: (g, v: number[]) => fill(g.treasuresShown, v) },
  tf: { get: (g) => [...g.treasuresFound], set: (g, v: number[]) => fill(g.treasuresFound, v) },
  pop: { get: (g) => [...g.populated], set: (g, v: number[]) => fill(g.populated, v) },
  mk: {
    get: (g, r) => (g.mark ? { x: r2(g.mark.x), y: r2(g.mark.y), z: r2(g.mark.z), mob: r.id(g.mark.mob), giant: r.id(g.mark.giant), until: r2(g.mark.until) } : null),
    set: (g, v: { x: number; y: number; z: number; mob: number; giant: number; until: number } | null, l) => {
      g.mark = v ? { x: v.x, y: v.y, z: v.z, mob: l.actor(v.mob), giant: l.giant(v.giant), until: v.until } : null;
    },
  },
  sr: plain('star'),
  sn: plain('starNight'),
  rd: plain('raid'),
  wf: {
    get: (g, r) => (g.witherFight ? { ...g.witherFight, mob: r.id(g.witherFight.mob), dash: null } : null),
    set: (g, v: (Omit<NonNullable<Game['witherFight']>, 'mob'> & { mob: number }) | null, l) => {
      g.witherFight = v ? { ...v, mob: l.actor(v.mob), dash: null } : null;
    },
  },
  co: { get: (g, r) => r.id(g.colossus), set: (g, v: number, l) => void (g.colossus = l.giant(v)) },
  hh: plain('hoistHub'),
  fb: plain('fortressBaseY', r2),
  pg: plain('pings'),
  ct: {
    get: (g) => [...g.crewTimers.entries()].map(([k, t]) => [k, r2(t)]),
    set: (g, v: Array<[number, number]>) => {
      g.crewTimers.clear();
      for (const [k, t] of v) g.crewTimers.set(k, t);
    },
  },
  // The Long March: the seals broken (their crystal goes from the mate's world too), the lands
  // entered, the golems taken aboard, and the guardian awake (its bar as the host has it).
  sb: {
    get: (g) => [...g.sealsBroken],
    set: (g, v: number[]) => {
      for (const i of v) {
        if (g.sealsBroken.has(i)) continue;
        g.sealsBroken.add(i);
        clearSeal(g, i);
      }
    },
  },
  rs: { get: (g) => [...g.regionsSeen], set: (g, v: number[]) => fill(g.regionsSeen, v) },
  gt: { get: (g) => [...g.golemsTaken], set: (g, v: number[]) => fill(g.golemsTaken, v) },
  gd: {
    get: (g, r) => {
      const gs = g.guardian;
      return gs ? { s: gs.seal, k: gs.kind, st: gs.stage, t: r2(gs.t), m: r.id(gs.mob), gi: r.id(gs.giant), p: r4(guardianFrac(gs)) } : null;
    },
    set: (g, v: { s: number; k: GuardianKind; st: GuardianState['stage']; t: number; m: number; gi: number; p: number } | null, l) => {
      if (!v) {
        g.guardian = null;
        return;
      }
      const gs: GuardianState = g.guardian?.seal === v.s ? g.guardian : { seal: v.s, kind: v.k, stage: v.st, t: v.t, mob: null, giant: null, maxHp: 1, cd: [], phase: 0 };
      gs.stage = v.st;
      gs.t = v.t;
      gs.mob = l.actor(v.m);
      gs.giant = l.giant(v.gi);
      gs.pct = v.p;
      g.guardian = gs;
    },
  },
  // The officers, the cabinet, the gear and the bestiary.
  cmp: plain('company'),
  cur: { get: (g) => [...g.curios], set: (g, v: string[]) => fill(g.curios, v) },
  ger: plain('gear'),
  bst: plain('bestiary'),
  // The main quest, the warden awake and the last fight (their bars as the host has them).
  mq: plain('mq'),
  op: { get: (g) => [...g.opened], set: (g, v: string[]) => fill(g.opened, v) },
  wd: {
    get: (g, r) => {
      const w = g.warden;
      return w ? { e: w.exp, k: w.kind, st: w.stage, t: r2(w.t), m: r.id(w.mob), gi: r.id(w.giant), p: r4(wardenFrac(w)) } : null;
    },
    set: (g, v: { e: number; k: WardenState['kind']; st: WardenState['stage']; t: number; m: number; gi: number; p: number } | null, l) => {
      if (!v) {
        g.warden = null;
        return;
      }
      const w: WardenState = g.warden?.exp === v.e ? g.warden : { exp: v.e, kind: v.k, stage: v.st, t: v.t, mob: null, giant: null, maxHp: 1, cd: [], phase: 0, calm: 0, lastHp: 0 };
      w.stage = v.st;
      w.t = v.t;
      w.mob = l.actor(v.m);
      w.giant = l.giant(v.gi);
      w.pct = v.p;
      g.warden = w;
    },
  },
  fnl: {
    get: (g, r) => {
      const f = g.finalBoss;
      return f ? { st: f.stage, t: r2(f.t), m: r.id(f.mob), gi: r.id(f.giant), at: f.at, p: r4(finalBossPct(f)) } : null;
    },
    set: (g, v: { st: FinalBoss['stage']; t: number; m: number; gi: number; at: FinalBoss['at']; p: number } | null, l) => {
      if (!v) {
        g.finalBoss = null;
        return;
      }
      const mob = l.actor(v.m) ?? g.finalBoss?.mob;
      if (!mob) return;
      g.finalBoss = { ...(g.finalBoss ?? { maxHp: 1, colossusHp: 1, cd: [], beam: null, orbit: 0 }), stage: v.st, t: v.t, mob, giant: l.giant(v.gi), at: v.at, pct: v.p };
    },
  },
};
