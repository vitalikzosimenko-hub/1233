// The Heart Seals of the Long March. Six walls of green crystal bar the valley, one where each land
// gives way to the next; the Citadel's Heart feeds each through a guardian. Come near a seal and
// its guardian wakes (a boss fight that holds back the dawn); bring it down and the seal shatters,
// the crystal rains off the wall and the way into the next land is open. Until then the fortress
// cannot pass, and anyone who climbs over is hurled back by the Heart's power.
import { EXPEDITIONS, sealAnswers } from './mainquest';
import { I } from './blocks';
import { feat } from './feats';
import type { Game } from './game';
import type { Giant } from './giants';
import { beginGuardian, guardianAlive, guardianFalls, guardianFrac, guardianLeave, updateGuardian } from './guardians';
import type { Actor } from './entities';
import type { GuardianKind, SealSite } from './terrain';
import { clamp } from './rng';

/** How each guardian is announced and what it is called on its bar. */
export const GUARDIANS: Record<GuardianKind, { title: string; name: string; sub: string; lesson: string }> = {
  queen: { title: 'THE BROOD QUEEN', name: 'The Brood Queen', sub: 'She gnaws at the legs and breeds her young: shoot her off them!', lesson: 'boss_queen' },
  dune: { title: 'THE DUNE TITAN', name: 'The Dune Titan', sub: 'It hurls boulders of sandstone: break its glowing Heart!', lesson: 'boss_dune' },
  slime: { title: 'THE SLIME KING', name: 'The Slime King', sub: 'It leaps onto the deck and splits as it breaks: knock it down!', lesson: 'boss_slime' },
  ravager: { title: 'THE RAVAGER KING', name: 'The Ravager King', sub: 'It rams the legs while its warlord casts: bring the beast down!', lesson: 'boss_ravager' },
  frost: { title: 'THE FROST TITAN', name: 'The Frost Titan', sub: 'Its breath freezes the fortress in its tracks: break its Heart!', lesson: 'boss_frost' },
  magma: { title: 'THE MAGMA TITAN', name: 'The Magma Titan', sub: 'It hurls fire and calls blazes: bat its fireballs back!', lesson: 'boss_magma' },
};

/**
 * What each guardian leaves behind: a lasting power for the fortress (it holds as long as its seal
 * stays broken, so a saved game or a co-op mate always agrees on it).
 */
export const TROPHIES: Record<GuardianKind, { name: string; icon: string; perk: string }> = {
  queen: { name: 'Queen\'s Silk', icon: 'cobweb', perk: 'The legs are bound in her silk: they take a third less damage' },
  dune: { name: 'Sandstone Plating', icon: 'chiseled_sandstone', perk: 'The hull is plated with its stone: blocks take a fifth less damage' },
  slime: { name: 'Slime Springs', icon: 'ui_stomp', perk: 'The legs bounce back: STOMP recharges much faster' },
  ravager: { name: 'Ravager Horn', icon: 'ui_boom', perk: 'Bolted to the bow: ramming a giant hits twice as hard' },
  frost: { name: 'Frost Heart', icon: 'blue_ice', perk: 'It keeps the crew\'s hands cool: repairs go half again as fast' },
  magma: { name: 'Magma Core', icon: 'magma', perk: 'Turret shells burn: they hit a third harder' },
};

/** Whether the fortress carries a guardian's trophy (its seal is broken). */
export function hasTrophy(g: Game, kind: GuardianKind): boolean {
  for (const s of g.world.terrain.seals) if (s.guardian === kind && g.sealsBroken.has(s.index)) return true;
  return false;
}

export interface GuardianState {
  seal: number;
  kind: GuardianKind;
  stage: 'rise' | 'fight' | 'dying';
  /** Seconds in the stage. */
  t: number;
  /** The guardian itself: a creature, or a giant. */
  mob: Actor | null;
  giant: Giant | null;
  /** Its health when it rose (the bar is measured against it). */
  maxHp: number;
  /** Spare timers each guardian uses its own way (its moves' cooldowns), and the thresholds passed. */
  cd: number[];
  phase: number;
  /** A creature guardian's health when last hurt, and the seconds since (see keepInFight). */
  lastHp?: number;
  calm?: number;
  /** (A co-op mate's copy: its bar as the host has it.) */
  pct?: number;
}

/** Seconds a guardian holds out through one night before it draws back (see updateSeals). */
const GUARDIAN_NIGHT_LIMIT = 300;

/** The first seal still standing east of the fortress, if any. */
export function sealAhead(g: Game): SealSite | null {
  const T = g.world.terrain;
  const [x] = g.fortress.centre();
  for (const s of T.seals) if (!g.sealsBroken.has(s.index) && s.x > x - 40) return s;
  return null;
}

/** The first seal still standing anywhere (the land beyond it is locked). */
export function firstSealed(g: Game): SealSite | null {
  for (const s of g.world.terrain.seals) if (!g.sealsBroken.has(s.index)) return s;
  return null;
}

/** Whether an unbroken seal bars a fortress hull centred at x (radius r). */
export function sealBars(g: Game, x: number, r: number): boolean {
  for (const s of g.world.terrain.seals) {
    if (g.sealsBroken.has(s.index)) continue;
    if (x < s.x && x + r > s.x - 3) return true;
  }
  return false;
}

/** Whether a point lies past a seal still standing (in a land that is still locked). */
export function lockedAt(g: Game, x: number): boolean {
  const s = firstSealed(g);
  return s !== null && x > s.x;
}

/** Puts the broken seals out of the world (the generator skips them; loaded crystal goes). */
export function applySeals(g: Game): void {
  for (const i of g.sealsBroken) {
    if (!g.world.hoisted.has(`seal${i}`)) clearSeal(g, i);
  }
}

/** One seal out of the world: no longer generated, and its crystal gone from the loaded land. */
export function clearSeal(g: Game, i: number): void {
  const id = `seal${i}`;
  g.world.hoisted.add(id);
  const st = g.world.structures.byId.get(id);
  if (st) g.world.clearStructure(st);
}

/** Per step (the host's world): guardians wake and fight, seals shatter, the Heart's power repels. */
export function updateSeals(g: Game, dt: number): void {
  const T = g.world.terrain;
  if (T.seals.length === 0) return;
  // Over the wall on foot: the seal's power hurls you back.
  g.eachPlayer((p) => {
    if (p.dead) return;
    for (const s of T.seals) {
      if (g.sealsBroken.has(s.index) || p.x < s.x + 0.6 || p.x > s.x + 14) continue;
      p.vx = -9;
      p.vy = Math.max(p.vy, 6);
      p.onGround = false;
      p.standingOn = null;
      p.x = Math.min(p.x, s.x + 0.4);
      g.sfx('zap', 'glass', 0.8, 1.3);
      g.particles.sparks(s.x, p.y + 1, p.z, ['#4cff8a', '#b8ffd0', '#ffffff'], 18, 5, 0.1, 0.6);
      g.toast('The Heart Seal hurls you back! Its guardian must fall first');
    }
  });
  const gs = g.guardian;
  if (gs) {
    const s = T.seals[gs.seal]!;
    const [fx] = g.fortress.centre();
    // Walked away: it goes back to its post (and wakes afresh when you return).
    if (gs.stage !== 'dying' && fx < s.x - 220) {
      guardianLeave(g, gs);
      g.guardian = null;
      g.toast('The guardian withdraws behind its seal');
      return;
    }
    gs.t += dt;
    if (gs.stage === 'rise' && gs.t > 2.4) {
      gs.stage = 'fight';
      gs.t = 0;
    }
    // A night-long stand-off: at the fifth minute the guardian draws back behind its seal to lick
    // its wounds, letting the dawn come. It stays there through the day (time to arm up) and
    // rises again, whole, on the next night's march.
    if (gs.stage === 'fight' && g.phase === 'night' && gs.t > GUARDIAN_NIGHT_LIMIT && guardianAlive(gs)) {
      guardianLeave(g, gs);
      g.guardian = null;
      g.guardianRest = g.day + 1;
      g.particles.ring(s.x - 30, s.y + 2, s.z, 14, 0.4, 1, 0.55);
      g.ui.banner('THE GUARDIAN WITHDRAWS', 'It will rise again on the next night\'s march: arm the fortress!', 'night');
      g.sfx('horn', 'stone', 0.6, 0.6);
      return;
    }
    if (gs.stage === 'fight') {
      updateGuardian(g, gs, dt);
      if (!guardianAlive(gs)) {
        gs.stage = 'dying';
        gs.t = 0;
        guardianFalls(g, gs);
        g.renderer.shake(0.8);
        g.sfxAt('bossdeath', s.x, s.y + 6, s.z, 1);
      }
    } else if (gs.stage === 'dying' && gs.t > 2.2) {
      g.guardian = null;
      breakSeal(g, gs.seal);
    }
    return;
  }
  // The fortress comes up to a seal: its guardian wakes (unless it is resting from a stand-off, or
  // the land's crest is not aboard: without it the seal cannot be touched).
  const s = sealAhead(g);
  if (!s || g.phase === 'title' || g.siege) return;
  if (g.day < g.guardianRest || (g.day === g.guardianRest && g.phase === 'day')) return;
  const [fx, , fz] = g.fortressCentre();
  if (s.x - fx < 95 && Math.abs(fz - s.z) < 160) {
    if (sealAnswers(g, s.index)) wakeGuardian(g, s);
    else if (g.time - g.sealNote > 20) {
      g.sealNote = g.time;
      const info = EXPEDITIONS[s.index];
      const crest = g.mq.crests.includes(s.index);
      g.ui.banner(s.name.toUpperCase(), crest ? 'It waits for the Builders\' Key: reforge the six crests at the Forge in Mount Cinder' : info ? `It will not answer without the ${info.crest}: find ${info.strider} at ${g.world.terrain.expeditions[s.index]?.name ?? 'her wreck'}` : 'It will not answer yet', 'night');
    }
  }
}

function wakeGuardian(g: Game, s: SealSite): void {
  const info = GUARDIANS[s.guardian];
  const gs: GuardianState = { seal: s.index, kind: s.guardian, stage: 'rise', t: 0, mob: null, giant: null, maxHp: 1, cd: [3, 6, 9, 12], phase: 0 };
  beginGuardian(g, gs, s);
  g.guardian = gs;
  g.ui.banner(info.title, info.sub, 'danger');
  g.sfx('horn', 'stone', 0.9, 0.7);
  g.renderer.shake(0.5);
  g.crewSay('guardian');
  g.report('game_started');
}

/** The guardian is down: the seal shatters and the next land opens. */
export function breakSeal(g: Game, index: number): void {
  if (g.sealsBroken.has(index)) return;
  const T = g.world.terrain;
  const s = T.seals[index]!;
  const region = T.regions[s.region]!;
  g.sealsBroken.add(index);
  // Crystal raining off the wall where you can see it, a flash and a shock ring.
  const p = g.player;
  for (let k = 0; k < 90; k += 1) {
    const z = clamp(p.z + (Math.random() - 0.5) * 120, s.z - 160, s.z + 160);
    const ground = g.world.groundAt(s.x, z);
    const y = ground + 1 + Math.random() * 12;
    g.particles.debris(s.x + 0.5, y, z, 'seal_crystal', 2, 6);
  }
  g.particles.ring(s.x, s.y + 4, s.z, 22, 0.3, 1, 0.55);
  g.particles.sparks(s.x, s.y + 10, s.z, ['#4cff8a', '#b8ffd0', '#ffffff'], 60, 12, 0.16, 1.4);
  g.light({ x: s.x, y: s.y + 8, z: s.z, r: 40, color: [0.4, 1.4, 0.6], life: 1.6, max: 1.6 });
  g.sfxAt('shatter', s.x, s.y + 6, s.z, 1, 1, 220);
  g.renderer.shake(1);
  g.buzz(160);
  applySeals(g);
  // The guardian's hoard and the Heart's splinter.
  g.addItem(I.HEARTSTONE, 1, true);
  g.addItem(I.EMERALD, 8 + index * 2, true);
  g.addItem(I.TNT, 10, true);
  g.xp(40 + index * 10);
  g.stats.giants += 1;
  const trophy = TROPHIES[s.guardian];
  g.ui.banner('THE SEAL SHATTERS!', `The way into ${region.name} is open · Trophy: ${trophy.name}`, 'gold');
  g.toast(`TROPHY · ${trophy.name}: ${trophy.perk}`, trophy.icon);
  g.celebrate(5);
  g.cheer();
  g.crewSay('seal');
  feat(g, 'seal');
  if (g.sealsBroken.size >= T.seals.length) feat(g, 'allseals');
  g.addPage(`seal_${s.guardian}`, true);
  g.save();
}

/** The guardian's bar over the screen (null when no guardian is up). */
export function guardianBar(g: Game): { title: string; sub: string; pct: number } | null {
  const gs = g.guardian;
  if (!gs) return null;
  const info = GUARDIANS[gs.kind];
  if (gs.stage === 'rise') return { title: info.title, sub: 'AWAKENING', pct: clamp(gs.t / 2.4, 0, 1) };
  if (gs.stage === 'dying') return { title: info.title, sub: 'THE SEAL CRACKS', pct: 0 };
  return { title: info.title, sub: g.world.terrain.seals[gs.seal]!.name.toUpperCase(), pct: gs.pct ?? guardianFrac(gs) };
}

/**
 * The fortress walks into a land for the first time: a banner and the land's fanfare at once, its
 * chapter card when there is a moment to read it (at dawn, if it is night).
 */
export function updateLands(g: Game): void {
  const T = g.world.terrain;
  if (T.version < 2 || (g.phase !== 'day' && g.phase !== 'night')) return;
  const [x] = g.fortress.centre();
  const i = T.regionIndex(x);
  if (g.regionsSeen.has(i)) return;
  g.regionsSeen.add(i);
  feat(g, 'wanderer');
  // (The first land is home: no card for it, it is in the journal.)
  if (i === 0) return;
  const land = T.regions[i]!;
  g.ui.banner(land.name.toUpperCase(), `Chapter ${i + 1} of ${T.regions.length} · a new land, new monsters`, 'gold');
  g.sfx('chapter', 'wood', 1);
  if (g.phase === 'night') g.deferChapter(i);
  else g.ui.story('chapter', String(i));
}

/** A guardian fight is on (it holds back the dawn and brings its own music). */
export function guardianActive(g: Game): boolean {
  return g.guardian !== null;
}
