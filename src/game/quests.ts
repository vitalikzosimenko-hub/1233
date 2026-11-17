// Village quests and the day-one tutorial. Every village sets one task in its woods (a lost
// strongbox, a spider nest, a raiders' camp holding one of its people); finishing it earns
// emeralds and the village's trust, and only a village that trusts you lets the crane take
// its buildings. Each village also has a trader who sells supplies for emeralds.
import { B, I } from './blocks';
import { Actor } from './entities';
import type { Game } from './game';
import type { Vec3 } from './math3d';
import { installTurret } from './fortress';
import { createGiant, type Giant, type GiantType } from './giants';
import { feat } from './feats';
import { spawnMob } from './mobs';
import { questPage, questRelic } from './story';
import { questKind, type Structure } from './structures';
import type { Site } from './terrain';
import { WANDERER_TRADES } from './folk';
import { hasOfficer } from './company';

export type QuestKind = 'fetch' | 'nest' | 'rescue';
/** active: under way; done: finished, reward waiting at the trader; claimed: rewarded. */
export type QuestState = 'active' | 'done' | 'claimed';

export interface QuestInfo {
  index: number;
  village: Site;
  camp: Site;
  kind: QuestKind;
  structure: Structure | null;
  title: string;
  task: string;
  reward: number;
}

export function questInfo(g: Game, index: number): QuestInfo | null {
  const T = g.world.terrain;
  const village = T.villages[index];
  const camp = T.camps[index];
  if (!village || !camp) return null;
  const kind = questKind(T, index);
  const structure = g.world.structures.byId.get(`q${index}`) ?? null;
  // (Down the Long March the villages pay more: the way is harder.)
  const more = T.version >= 2 ? Math.floor(index / 3) : 0;
  switch (kind) {
    case 'fetch':
      return { index, village, camp, kind, structure, title: 'The Lost Strongbox', task: 'Find the strongbox in the old shrine and bring it to the trader', reward: 4 + more };
    case 'nest':
      return { index, village, camp, kind, structure, title: 'The Spider Nest', task: 'Destroy the monster spawner in the spider nest', reward: 5 + more };
    default:
      return { index, village, camp, kind, structure, title: 'Taken by Raiders', task: 'Defeat the camp guards and free the captive villager', reward: 6 + more };
  }
}

/** A village lets the crane take its buildings once you have helped it (your home always does). */
export function trusts(g: Game, site: Site): boolean {
  if (site.kind !== 'village') return true;
  return site.index === 0 || g.questState[site.index] === 'claimed';
}

function spawnerCell(q: QuestInfo): Vec3 | null {
  const s = q.structure;
  if (!s) return null;
  for (let i = 0; i < s.count; i += 1) if (s.ids[i] === B.SPAWNER) return [s.xs[i]!, s.ys[i]!, s.zs[i]!];
  return null;
}

/** Per frame: nests breed spiders, raiders guard their camp, objectives complete. */
export function updateQuests(g: Game, dt: number): void {
  for (let index = 0; index < g.world.terrain.villages.length; index += 1) {
    const q = questInfo(g, index);
    if (!q || g.questState[index] === 'claimed') continue;
    const near = g.nearestDist(q.camp.x, q.camp.z);
    // A captive who wandered out of the streamed world is put back when the camp loads again.
    const held = g.captives.get(index);
    if (held && !g.villagers.includes(held)) g.captives.delete(index);
    if (!g.world.chunkAt(q.camp.x, q.camp.z)) continue;
    if (q.kind === 'nest') {
      const cell = spawnerCell(q);
      if (!cell) continue;
      if (g.world.get(cell[0], cell[1], cell[2]) !== B.SPAWNER) {
        g.questState[index] = 'done';
        claim(g, q);
        continue;
      }
      // The spawner breeds spiders while you are close.
      g.nestTimer -= dt;
      if (near < 26 && g.nestTimer <= 0) {
        g.nestTimer = 6;
        const alive = g.mobs.filter((m) => !m.dead && m.guardOf === `q${index}`).length;
        if (alive < 3) {
          const a = Math.random() * Math.PI * 2;
          const mob = spawnMob(g, 'spider', cell[0] + Math.cos(a) * 3, cell[2] + Math.sin(a) * 3);
          if (mob) {
            mob.guardOf = `q${index}`;
            mob.homeX = cell[0];
            mob.homeZ = cell[2];
            g.particles.smoke(mob.x, mob.cy, mob.z, 6, 0.8);
          }
        }
      }
    } else if (q.kind === 'rescue') {
      const s = q.structure;
      if (!s) continue;
      // The captive waits in the pen; the guards turn out when you come near.
      if (!g.captives.has(index) && s.villagers[0]) {
        const spot = s.villagers[0];
        const v = new Actor('villager', spot.x, spot.y, spot.z);
        v.captive = true;
        v.region = index;
        v.role = 'farmer';
        v.homeX = spot.x;
        v.homeZ = spot.z;
        g.villagers.push(v);
        g.captives.set(index, v);
      }
      if (!g.guarded.has(`q${index}`) && near < 34) {
        g.guarded.add(`q${index}`);
        const n = 3 + Math.min(3, index);
        for (let i = 0; i < n; i += 1) {
          const a = (i / n) * Math.PI * 2;
          const kind = i % 3 === 0 ? 'skeleton' : i % 3 === 1 ? 'husk' : 'zombie';
          const mob = spawnMob(g, kind, q.camp.x + Math.cos(a) * 4, q.camp.z + Math.sin(a) * 4);
          if (mob) {
            mob.guardOf = `q${index}`;
            mob.homeX = q.camp.x;
            mob.homeZ = q.camp.z;
          }
        }
        g.toast(`${q.camp.name}: raiders guard the camp!`);
      }
      const captive = g.captives.get(index);
      if (g.guarded.has(`q${index}`) && captive && captive.captive && !g.mobs.some((m) => !m.dead && m.guardOf === `q${index}`)) {
        // Guards down: the pen opens.
        captive.captive = false;
        captive.freed = true;
        for (let i = 0; i < s.count; i += 1) if (s.ids[i] === B.FENCE && g.world.get(s.xs[i]!, s.ys[i]!, s.zs[i]!) === B.FENCE) g.world.set(s.xs[i]!, s.ys[i]!, s.zs[i]!, B.AIR);
        g.toast('The guards are down! Free the captive', 'ui_villager');
      }
    } else {
      if (g.questState[index] === 'active' && g.count(I.STRONGBOX) > 0) {
        g.questState[index] = 'done';
        g.sfx('quest', 'metal', 0.8);
        g.ui.banner('STRONGBOX FOUND!', `Bring it to the trader in ${q.village.name}`, 'gold');
      }
    }
  }
}

/** You free the raiders' captive: they hurry home (or aboard, if you have a bunk). */
export function freeCaptive(g: Game, v: Actor): void {
  const index = v.region;
  // (The outlaws' captives are the Red Hawk's crew: no village's quest.)
  const q = index >= 0 ? questInfo(g, index) : null;
  v.freed = false;
  v.captive = false;
  if (index >= 0) g.questState[index] = 'done';
  if (q) claim(g, q);
  if (g.crew + g.villagers.filter((o) => o.recruited).length < g.crewCapacity()) {
    v.recruited = true;
    g.toast('Freed! They join your crew', 'ui_villager');
  } else {
    v.homeX = q?.village.x ?? v.x;
    v.homeZ = q?.village.z ?? v.z;
    g.toast('Freed! They head home', 'ui_villager');
  }
  v.vy = 5;
  g.villagerReact('quest', v.x, v.z, v);
}

/** Talking to a trader: hand over anything the quest asked for, then trade. */
export function visitTrader(g: Game, index: number): void {
  g.flags.traded = true;
  g.today.traded = true;
  const q = questInfo(g, index);
  if (q && g.questState[index] === 'done' && (q.kind !== 'fetch' || g.count(I.STRONGBOX) > 0)) turnIn(g, index);
  g.ui.openVillage(index);
}

/** Hands the strongbox (and the like) to the village trader. */
export function turnIn(g: Game, index: number): void {
  const q = questInfo(g, index);
  if (!q || g.questState[index] !== 'done') return;
  if (q.kind === 'fetch' && !g.useItem(I.STRONGBOX, 1)) return;
  claim(g, q);
}

function claim(g: Game, q: QuestInfo): void {
  if (g.questState[q.index] === 'claimed') return;
  g.questState[q.index] = 'claimed';
  g.addItem(I.EMERALD, q.reward, true);
  g.xp(30);
  g.sfx('quest', 'metal', 1);
  g.ui.banner('QUEST COMPLETE!', `+${q.reward} emeralds · ${q.village.name} trusts you: hoist what you need`, 'gold');
  g.celebrate(4);
  g.cheer();
  // Each village entrusts you with a relic of its own, and a page of the builders' story.
  const version = g.world.terrain.version;
  const relic = questRelic(version, q.index);
  if (relic) g.grantRelic(relic);
  const leaf = questPage(version, q.index);
  if (leaf) g.addPage(leaf);
  g.report('visual_feedback');
  g.save();
}

// ------------------------------------------------------------------ trader

export interface Trade {
  id: string;
  label: string;
  icon: string;
  item: number;
  count: number;
  price: number;
}

export const TRADES: Trade[] = [
  { id: 'tnt', label: '4 TNT', icon: 'tnt_side', item: I.TNT, count: 4, price: 2 },
  { id: 'iron', label: '3 Iron Ingots', icon: 'iron_ingot', item: I.IRON_INGOT, count: 3, price: 3 },
  { id: 'powder', label: '3 Gunpowder', icon: 'gunpowder', item: I.GUNPOWDER, count: 3, price: 2 },
  { id: 'wire', label: '8 Redstone Wire', icon: 'wire_item', item: B.WIRE, count: 8, price: 2 },
  { id: 'bread', label: '4 Bread', icon: 'bread', item: I.BREAD, count: 4, price: 1 },
  { id: 'ballista', label: 'Ballista', icon: 'bolt_item', item: B.BALLISTA, count: 1, price: 5 },
  { id: 'mortar', label: 'Mortar', icon: 'shell_item', item: B.MORTAR, count: 1, price: 7 },
  { id: 'bunk', label: '+1 Crew Bunk', icon: 'ui_villager', item: -1, count: 1, price: 6 },
];

/** What a trader asks of you (a quartermaster aboard beats them down a quarter). */
export function priceOf(g: Game, price: number): number {
  return hasOfficer(g, 'tova') ? Math.max(1, Math.ceil(price * 0.75)) : price;
}

/** Buys from a trader; the note says where the goods went (shown in the trader's window). */
export function buy(g: Game, id: string): { ok: boolean; note: string } {
  const wanderer = WANDERER_TRADES.find((x) => x.id === id);
  const t = wanderer ?? TRADES.find((x) => x.id === id);
  if (!t) return { ok: false, note: '' };
  if (t.id === 'bunk' && g.extraBunks >= 3) {
    g.sfx('deny');
    return { ok: false, note: 'No more room for bunks' };
  }
  const price = priceOf(g, t.price);
  if (g.count(I.EMERALD) < price) {
    g.sfx('deny');
    return { ok: false, note: `Not enough emeralds: ${price} needed, you have ${g.count(I.EMERALD)}` };
  }
  g.useItem(I.EMERALD, price);
  g.flags.traded = true;
  g.today.traded = true;
  if (wanderer) feat(g, 'trader');
  g.sfx('craft', 'metal', 0.9);
  g.report('primary_input');
  if (t.id === 'bunk') {
    g.extraBunks += 1;
    return { ok: true, note: `+1 bunk: ${g.crewCapacity()} crew can live aboard now` };
  }
  // Turrets are delivered bolted onto the deck, crewed and self-powered.
  if (t.item === B.BALLISTA || t.item === B.MORTAR) {
    const at = installTurret(g, t.item);
    if (at) {
      g.ping(at);
      return { ok: true, note: `${t.label} bolted onto your deck, ready to fire: look for the gold marker` };
    }
    g.addItem(t.item, t.count, true);
    return { ok: true, note: `No free deck spot: the ${t.label} is in your hotbar, place it on the deck` };
  }
  g.addItem(t.item, t.count, true);
  return { ok: true, note: `Bought ${t.label}: you have ${g.count(t.item)} now (hotbar)` };
}

// ------------------------------------------------------------------ building upgrades

/** What another level of a hoisted building gives. */
export const UPGRADE_PERK: Partial<Record<string, string>> = {
  house: '+1 crew bunk',
  cottage: '+1 crew bunk',
  windmill: 'March faster',
  watchtower: '+2 TNT from its armoury each dawn',
  smithy: 'Crew repair faster',
  farm: 'More bread',
};

export function upgradeCost(level: number): { gems: number; iron: number } {
  return { gems: 3 + level * 2, iron: level };
}

/** Pays the trader's craftsmen to improve one of the buildings on your deck. */
export function upgradeCargo(g: Game, i: number): boolean {
  const c = g.cargo[i];
  if (!c) return false;
  const level = c.level ?? 1;
  if (level >= 3) {
    g.deny('Already fully upgraded');
    return false;
  }
  const cost = upgradeCost(level);
  if (g.count(I.EMERALD) < cost.gems || g.count(I.IRON_INGOT) < cost.iron) {
    g.deny(`Needs ${cost.gems} emeralds and ${cost.iron} iron`);
    return false;
  }
  g.useItem(I.EMERALD, cost.gems);
  g.useItem(I.IRON_INGOT, cost.iron);
  c.level = level + 1;
  g.sfx('quest', 'metal', 0.8);
  g.toast(`Upgraded to level ${c.level}: ${UPGRADE_PERK[c.kind] ?? 'stronger'}`, 'ui_hammer');
  g.report('primary_input');
  g.save();
  return true;
}

// ------------------------------------------------------------------ the wilds

/** Where the next unfound treasure map leads (or null). */
export function treasureTarget(g: Game): { index: number; x: number; y: number; z: number } | null {
  for (const i of g.treasuresShown) {
    if (g.treasuresFound.has(i)) continue;
    const t = g.world.terrain.treasures[i];
    if (t) return { index: i, x: t[0] + 0.5, y: t[1], z: t[2] + 0.5 };
  }
  return null;
}

/** Reading a treasure map marks the next buried hoard. */
export function readTreasureMap(g: Game): void {
  const T = g.world.terrain;
  const next = T.treasures.findIndex((_, i) => !g.treasuresShown.has(i));
  if (next < 0) {
    g.toast('The map shows nothing new');
    return;
  }
  if (!g.useItem(I.TREASURE_MAP, 1)) return;
  g.treasuresShown.add(next);
  g.sfx('quest', 'metal', 0.7);
  g.ui.banner('TREASURE MAP!', 'Dig under the gravel cross for the buried hoard', 'gold');
  g.report('primary_input');
}

/** Per frame: lair giants doze until you come near; mine dens breed spiders; hoards get found. */
export function updateWilds(g: Game, dt: number): void {
  const T = g.world.terrain;
  // Giants' lairs.
  T.lairs.forEach((l, i) => {
    if (g.lairsDone.has(i) || !g.world.chunkAt(l.x, l.z)) return;
    const d = g.nearestDist(l.x, l.z);
    let giant = g.giants.find((gi) => gi.lair === i);
    if (!giant && d < 90) giant = spawnLairGiant(g, i) ?? undefined;
    if (!giant) return;
    if (giant.dead) {
      g.lairsDone.add(i);
      g.ui.banner(`${l.name.toUpperCase()} CLEARED!`, 'Loot its hoard and take its parts', 'gold');
      return;
    }
    if (giant.dormant && (d < 24 || giant.body.cells.size < (giant.startCells ?? 0))) {
      giant.dormant = false;
      g.ui.banner(`THE ${giant.name.toUpperCase()} WAKES!`, 'Leap on it and dig out its Heart', 'danger');
      g.sfx('giant', 'stone', 1.3);
    }
  });
  // Spawners in the mines.
  g.denTimer -= dt;
  if (g.denTimer <= 0) {
    g.denTimer = 7;
    T.mines.forEach((_, i) => {
      const s = g.world.structures.byId.get(`m${i}`);
      if (!s) return;
      for (let k = 0; k < s.count; k += 1) {
        if (s.ids[k] !== B.SPAWNER) continue;
        const x = s.xs[k]!;
        const y = s.ys[k]!;
        const z = s.zs[k]!;
        if (!g.players().some((c) => Math.hypot(c.player.x - x, c.player.y - y, c.player.z - z) <= 18) || g.world.get(x, y, z) !== B.SPAWNER) continue;
        if (g.mobs.filter((m) => !m.dead && m.guardOf === s.id).length >= 3) continue;
        const mob = spawnMobAt(g, 'spider', x + 0.5 + (Math.random() - 0.5) * 3, y, z + 0.5 + (Math.random() - 0.5) * 3);
        if (mob) {
          mob.guardOf = s.id;
          mob.homeX = x;
          mob.homeZ = z;
        }
      }
    });
  }
  // Treasure: found once its chest is opened.
  for (const i of g.treasuresShown) {
    if (g.treasuresFound.has(i)) continue;
    const s = g.world.structures.byId.get(`t${i}`);
    const chest = s?.chests[0];
    if (chest && g.world.lootedChests.has(g.world.chestKey(chest.x, chest.y, chest.z))) {
      g.treasuresFound.add(i);
      g.xp(20);
      g.sfx('quest', 'metal', 1);
      g.ui.banner('TREASURE FOUND!', 'The buried hoard is yours', 'gold');
      feat(g, 'hoard');
    }
  }
}

function spawnLairGiant(g: Game, i: number): Giant | null {
  const l = g.world.terrain.lairs[i];
  if (!l) return null;
  const type: GiantType = i === 0 ? 'brute' : 'warden';
  const giant = createGiant(type, l.x + 3, l.z, g.world.groundAt(l.x + 3, l.z), 1.2 + i * 0.4, -1, 0);
  giant.lair = i;
  giant.dormant = true;
  giant.startCells = giant.body.cells.size;
  giant.walker.layout(giant.body, g.world);
  g.giants.push(giant);
  return giant;
}

/** A mob at an exact spot (in a mine), unlike spawnMob which puts it on the column's top. */
function spawnMobAt(g: Game, kind: 'spider', x: number, y: number, z: number): Actor | null {
  if (g.world.solid(Math.floor(x), Math.floor(y), Math.floor(z))) return null;
  const mob = new Actor(kind, x, y, z);
  g.mobs.push(mob);
  return mob;
}
