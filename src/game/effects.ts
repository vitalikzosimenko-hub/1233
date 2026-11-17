// Status effects on the captain, as in Minecraft: poison and wither drain hearts (poison never
// kills), slowness and weakness sap legs and blows, a husk's hunger empties the belly, and the good
// ones (regeneration, strength, resistance) come from a totem, a beacon or a wish. The HUD shows
// each one's icon and the seconds left; hearts turn green under poison and black under wither.
import { setDone } from './curios';
import type { Game } from './game';
import { hasOfficer } from './company';
import { coatOf } from './gear';

export type EffectId = 'poison' | 'wither' | 'slowness' | 'weakness' | 'hunger' | 'regen' | 'strength' | 'resistance' | 'omen' | 'hero' | 'beacon' | 'swift' | 'fireward' | 'frostward';

export interface Effect {
  /** Seconds left (Infinity: until something ends it). */
  t: number;
  level: number;
  /** For the damage-over-time ones: seconds to the next tick. */
  tick: number;
}

export interface EffectDef {
  name: string;
  icon: string;
  /** Harmful (cleared by a totem, shown in red). */
  bad: boolean;
  /** Particle colour that swirls off whoever has it. */
  color: string;
  text: string;
}

export const EFFECTS: Record<EffectId, EffectDef> = {
  poison: { name: 'Poison', icon: 'fx_poison', bad: true, color: '#4e9331', text: 'Loses hearts (never the last one)' },
  wither: { name: 'Wither', icon: 'fx_wither', bad: true, color: '#352a27', text: 'Loses hearts: it can kill!' },
  slowness: { name: 'Slowness', icon: 'fx_slowness', bad: true, color: '#5a6c81', text: 'Moves slowly' },
  weakness: { name: 'Weakness', icon: 'fx_weakness', bad: true, color: '#484d48', text: 'Hits weaker' },
  hunger: { name: 'Hunger', icon: 'fx_hunger', bad: true, color: '#587653', text: 'Gets hungry fast' },
  regen: { name: 'Regeneration', icon: 'fx_regen', bad: false, color: '#cd5cab', text: 'Heals over time' },
  strength: { name: 'Strength', icon: 'fx_strength', bad: false, color: '#932423', text: 'Hits harder' },
  resistance: { name: 'Resistance', icon: 'fx_resistance', bad: false, color: '#99453a', text: 'Takes less damage' },
  omen: { name: 'Bad Omen', icon: 'fx_omen', bad: true, color: '#0b6138', text: 'The illagers will RAID tonight' },
  hero: { name: 'Hero of the Village', icon: 'fx_hero', bad: false, color: '#44ff44', text: 'Traders sell for less' },
  beacon: { name: 'Beacon', icon: 'fx_beacon', bad: false, color: '#c8f0ff', text: 'Regeneration and strength aboard' },
  swift: { name: 'Swiftness', icon: 'fx_swift', bad: false, color: '#7cafc6', text: 'Runs faster' },
  fireward: { name: 'Fire Ward', icon: 'fx_fireward', bad: false, color: '#e49a3a', text: 'Fire and lava cannot touch you' },
  frostward: { name: 'Frost Ward', icon: 'fx_frostward', bad: false, color: '#a8e0ff', text: 'Frost cannot slow you' },
};

/** Gives (or tops up) an effect: the longer duration and the higher level win. */
export function addEffect(g: Game, id: EffectId, seconds: number, level = 1): void {
  if (g.player.dead && EFFECTS[id].bad) return;
  // (The frost ward, and a hunter's boots.)
  if (id === 'slowness' && (g.effects.has('frostward') || hasOfficer(g, 'yrsa'))) return;
  const e = g.effects.get(id);
  if (e) {
    e.t = Math.max(e.t, seconds);
    e.level = Math.max(e.level, level);
  } else {
    g.effects.set(id, { t: seconds, level, tick: id === 'poison' ? 1.25 / level : id === 'wither' ? 2 / level : id === 'regen' ? 2.5 / level : 1 });
    g.ui.effectsChanged();
  }
}

export function hasEffect(g: Game, id: EffectId): boolean {
  return g.effects.has(id);
}

export function effectLevel(g: Game, id: EffectId): number {
  return g.effects.get(id)?.level ?? 0;
}

export function clearEffect(g: Game, id: EffectId): void {
  if (g.effects.delete(id)) g.ui.effectsChanged();
}

/** Clears the harmful ones (a totem of undying, a respawn); the omen and the hero's welcome stay. */
export function clearBadEffects(g: Game): void {
  let changed = false;
  for (const id of [...g.effects.keys()]) {
    if (!EFFECTS[id].bad || id === 'omen') continue;
    g.effects.delete(id);
    changed = true;
  }
  if (changed) g.ui.effectsChanged();
}

/** How fast you walk under the effects (slowness takes 15% a level, as in Minecraft). */
export function speedFactor(g: Game): number {
  const quick = (g.effects.has('swift') ? 1.3 : 1) * (setDone(g, 1) ? 1.08 : 1);
  return (1 - Math.min(0.6, effectLevel(g, 'slowness') * 0.15)) * quick;
}

/** Melee damage under the effects: strength adds, weakness takes away. */
export function meleeBonus(g: Game, base: number): number {
  const s = effectLevel(g, 'strength') + (g.effects.has('beacon') ? 1 : 0);
  return Math.max(1, base + s * 3 - effectLevel(g, 'weakness') * 4);
}

/** Damage taken under the effects (resistance blunts every blow by a fifth a level). */
export function damageFactor(g: Game): number {
  return (1 - Math.min(0.6, effectLevel(g, 'resistance') * 0.2)) * (1 - coatOf(g).power);
}

/** Per step: effects run down, drain or heal, and leave a swirl of their colour about you. */
export function updateEffects(g: Game, dt: number, hurt: (amount: number) => void): void {
  if (g.effects.size === 0) return;
  const p = g.player;
  let changed = false;
  for (const [id, e] of g.effects) {
    e.t -= dt;
    if (e.t <= 0) {
      g.effects.delete(id);
      changed = true;
      continue;
    }
    if (p.dead) continue;
    e.tick -= dt;
    if (e.tick > 0) continue;
    if (id === 'poison') {
      e.tick = 1.25 / e.level;
      // (The fen's relics: it wears off quicker.)
      if (setDone(g, 2)) e.t -= 1.25;
      // Poison never takes the last heart.
      if (p.hp > 1) hurt(1);
    } else if (id === 'wither') {
      e.tick = 2 / e.level;
      hurt(1);
    } else if (id === 'regen' || id === 'beacon') {
      e.tick = id === 'beacon' ? 3 : 2.5 / e.level;
      if (p.hp < p.maxHp && (id === 'regen' || p.standingOn === g.fortress || g.helm)) p.hp = Math.min(p.maxHp, p.hp + 1);
    } else if (id === 'hunger') {
      e.tick = 3.2 / e.level;
      g.hunger = Math.max(0, g.hunger - 1);
    } else e.tick = 1;
  }
  if (changed) g.ui.effectsChanged();
}

/** The effects for the HUD, the bad ones first. */
export function effectList(g: Game): Array<{ id: EffectId; def: EffectDef; t: number; level: number }> {
  const out = [...g.effects.entries()].map(([id, e]) => ({ id, def: EFFECTS[id], t: e.t, level: e.level }));
  return out.sort((a, b) => Number(b.def.bad) - Number(a.def.bad));
}
