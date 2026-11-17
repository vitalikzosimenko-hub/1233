// The main quest: "The Eleven Striders". The Heart was the Builders' own Hearthstone, grown by Master
// Architect Veyra to make the Striders walk by themselves; it learned to want, and took the Citadel and
// Veyra with it. Eleven Striders marched east to stop it and never came back. Each land's wreck holds
// its captain's log and a Strider Crest (a key to that land's Heart Seal: its guardian only answers
// to one), and every wreck has something guarding it. Six crests, reforged at the Builders' Forge in
// Mount Cinder, make the Builders' Key: the only thing that opens the Heart's last shell. Behind it
// waits what the Heart kept of Veyra.
//
// One chapter per land: find its expedition (march there, or walk the fortress over by day), beat
// what guards the wreck, open the captain's chest for the crest, then break the land's seal.
import { B, I } from './blocks';
import { feat } from './feats';
import type { Game } from './game';
import type { Goal } from './guide';
import type { Vec3 } from './math3d';
import { crestStructureId } from './landmarks';
import { page, type Page } from './story';
import type { ExpeditionId, ExpeditionSite, Site } from './terrain';

/** The main quest as it stands (saved). */
export interface MainQuest {
  /** The backstory has been told (the quest is under way). */
  begun: boolean;
  /** Expeditions whose warden is beaten, whose crest is in hand, whose site the fortress reached. */
  wardens: number[];
  crests: number[];
  reached: number[];
  /** The Builders' Key is forged. */
  key: boolean;
  /** Veyra is beaten (the epilogue follows). */
  won: boolean;
}

export function newMainQuest(): MainQuest {
  return { begun: false, wardens: [], crests: [], reached: [], key: false, won: false };
}

/** What a wreck guards. */
export type WardenKind = 'hollow' | 'pharaoh' | 'hag' | 'warlord' | 'yeti' | 'forgegolem';

export interface ExpeditionInfo {
  id: ExpeditionId;
  /** Chapter title and the Strider that lies there. */
  chapter: string;
  strider: string;
  captain: string;
  crest: string;
  /** Crest icon (texture) and colour. */
  icon: string;
  color: string;
  warden: WardenKind;
  wardenName: string;
  /** How the warden is fought (its lesson line). */
  wardenHow: string;
  /** Where to go, and what to do there before the warden shows itself. */
  find: string;
  search: string;
  /** Chapter card text and art (2:1) and the boss card (tut art). */
  text: string;
  art: string;
  boss: string;
}

export const EXPEDITIONS: readonly ExpeditionInfo[] = [
  {
    id: 'meadow', chapter: 'The Eleven', strider: 'the Bramble', captain: 'Captain Rowan', crest: 'Crest of the Bramble', icon: 'crest_0', color: '#5fd068',
    warden: 'hollow', wardenName: 'The Hollow Strider', wardenHow: 'The Heart took the Bramble\'s dead legs: it walks again. Fire on its glowing Heart, ram it at FULL STEAM.',
    find: 'Find the wreck of the Bramble in the Whispering Meadows',
    search: 'Search the wreck of the Bramble',
    text: 'A broad meadow basin beyond the valley wall, poppies to the knee. In the middle lies the first of the Eleven, the Bramble, broken across the back. Something green still glows inside her.',
    art: 'story/exp-meadow.webp', boss: 'tut/boss_hollow.webp',
  },
  {
    id: 'pyramid', chapter: 'The Sun King\'s Vault', strider: 'the Sunstrider', captain: 'Captain Saffi', crest: 'Crest of the Sunstrider', icon: 'crest_1', color: '#ffcf3a',
    warden: 'pharaoh', wardenName: 'The Pharaoh Husk', wardenHow: 'The old king of the pyramid woke when the Heart\'s light touched him. He calls husks out of the sand: keep moving, strike between his blows.',
    find: 'Find the Sun Pyramid in the dunes',
    search: 'Go into the Sun Pyramid',
    text: 'A sea of dunes behind the desert\'s southern hills, and in it the Sun Pyramid, older than the Builders. The Sunstrider\'s legs stick out of the sand beside it. Her crest went inside.',
    art: 'story/exp-pyramid.webp', boss: 'tut/boss_pharaoh.webp',
  },
  {
    id: 'lagoon', chapter: 'The Drowned Coven', strider: 'the Mire Lily', captain: 'Tam Brannoc', crest: 'Crest of the Mire Lily', icon: 'crest_2', color: '#3fd0b8',
    warden: 'hag', wardenName: 'The Bog Hag', wardenHow: 'Her three cauldrons keep her alive: smash them (they glow green), then bring her down. She blinks from hut to hut.',
    find: 'Find the Black Lagoon and its coven',
    search: 'Go to the coven\'s huts',
    text: 'A black lagoon deep in the fen, its huts on stilts strung together with rope walks. The witches who live there serve the Heart. Under the water lies the Mire Lily, Elder Brannoc\'s son\'s Strider.',
    art: 'story/exp-lagoon.webp', boss: 'tut/boss_hag.webp',
  },
  {
    id: 'fort', chapter: 'Outlaw Country', strider: 'the Red Hawk', captain: 'Captain Vesna', crest: 'Crest of the Red Hawk', icon: 'crest_3', color: '#ff7a3a',
    warden: 'warlord', wardenName: 'The Evoker Warlord', wardenHow: 'He raises rows of snapping fangs and sends vexes after you. Free his captives, then strike him while he casts.',
    find: 'Find the Outlaw Fort on its mesa',
    search: 'Free the outlaws\' captives',
    text: 'Up a ramp onto a mesa in the canyons: the outlaws\' fort, its gate made of a Strider\'s broken legs. Villagers shout from cages in the yard.',
    art: 'story/exp-fort.webp', boss: 'tut/boss_warlord.webp',
  },
  {
    id: 'frostpeak', chapter: 'Frostpeak', strider: 'the Winter Lark', captain: 'Captain Ilja', crest: 'Crest of the Winter Lark', icon: 'crest_4', color: '#8ad8ff',
    warden: 'yeti', wardenName: 'The Yeti of Frostpeak', wardenHow: 'It hurls ice and charges down the slope. Keep your footing on the path, shoot it as it comes.',
    find: 'Find Frostpeak, the great snow mountain',
    search: 'Climb Frostpeak to the Winter Lark (follow the cairns)',
    text: 'The tallest mountain of the north, its path winding up past stone cairns. Near the top, frozen into the glacier, the Winter Lark still has her lanterns lit.',
    art: 'story/exp-frostpeak.webp', boss: 'tut/boss_yeti.webp',
  },
  {
    id: 'cinder', chapter: 'The Builders\' Forge', strider: 'the Ember Queen', captain: 'Captain Orla', crest: 'Crest of the Ember Queen', icon: 'crest_5', color: '#ff5a2a',
    warden: 'forgegolem', wardenName: 'The Forge Golem', wardenHow: 'Veyra\'s guardian of the forge. It slams the ground and hurls fire: dodge the shockwaves, hit it from behind.',
    find: 'Find Mount Cinder, the volcano',
    search: 'Climb Mount Cinder\'s path to the crater',
    text: 'A volcano over the ash plains, a path winding up to its smoking crater. On an island in its lava lake stands the Builders\' Forge, and the golem Veyra left to guard it.',
    art: 'story/exp-cinder.webp', boss: 'tut/boss_forge.webp',
  },
];

/** The backstory, told when the quest begins (portrait art, a line each). */
export const SAGA_OPENING: Array<{ art: string; text: string }> = [
  { art: 'story/hearthstone.webp', text: 'Long ago, Master Architect Veyra grew a living crystal heart, the Hearthstone, to make the Striders walk by themselves. Every Engine Core is a splinter of it, yours too.' },
  { art: 'story/eleven.webp', text: 'But the Hearthstone learned to want. It swallowed the Builders\' great workshop in the east, the Citadel, and Veyra with it. Eleven Striders marched east to stop it. None came back.' },
  { art: 'story/wreck.webp', text: 'Their wrecks lie across the lands, each with its captain\'s log and a Strider Crest: a key to that land\'s Heart Seal. Find the crests, Captain. Six of them, forged together, can break the Heart.' },
];

/** The Key is forged. */
export const SAGA_FORGE = { art: 'story/forge.webp', text: 'Six crests in the Builders\' Forge, and out of the fire comes one: the Builders\' Key. Set into the Heart, it will remember what it was made for.' };

/** The Heart breaks, and what it kept rises. */
export const SAGA_VEYRA = { art: 'story/veyra.webp', text: 'The Heart\'s shell cracks open around the Key, and something rises from the shards: the shape of a woman in crystal and black stone. Veyra, the Heart-Architect. The Heart wears her like armour.' };

/** After the last fight. */
export const SAGA_EPILOGUE = { art: 'story/epilogue.webp', text: '"Thank you, Captain," says the light as it fades. "Tell them I am sorry. Take the Hearthstone home: it only ever wanted to walk." The splinter in your Engine Core beats quietly now. The Strider turns west, for home.' };

/** Each captain's log: its journal page (see story.ts). */
export function logPage(i: number): Page | null {
  const e = EXPEDITIONS[i];
  return e ? page(`log_${e.id}`) ?? null : null;
}

// ------------------------------------------------------------------ queries

export function hasCrest(g: Game, i: number): boolean {
  return g.mq.crests.includes(i);
}

export function wardenBeaten(g: Game, i: number): boolean {
  return g.mq.wardens.includes(i);
}

/** The world has the expeditions (the Long March). */
export function mainQuestOn(g: Game): boolean {
  return g.world.terrain.expeditions.length > 0;
}

/** The crest chest of an expedition (world cell), if its structure stands. */
export function crestChest(g: Game, i: number): Vec3 | null {
  const e = g.world.terrain.expeditions[i];
  if (!e) return null;
  const s = g.world.structures.byId.get(crestStructureId(e));
  const c = s?.chests[0];
  return c ? [c.x, c.y, c.z] : null;
}

/** The expedition a chest is the crest chest of (or -1). */
export function crestChestAt(g: Game, x: number, y: number, z: number): number {
  const T = g.world.terrain;
  for (let i = 0; i < T.expeditions.length; i += 1) {
    const c = crestChest(g, i);
    if (c && c[0] === x && c[1] === y && c[2] === z) return i;
  }
  return -1;
}

/** A chest the crest is still sealed in (its warden stands): no opening it, no blasting it. */
export function sealedChest(g: Game, x: number, y: number, z: number): boolean {
  const i = crestChestAt(g, x, y, z);
  return i >= 0 && !wardenBeaten(g, i) && mainQuestOn(g);
}

/** Whether a Heart Seal's guardian will answer (its land's crest is in hand; the last wants the Key forged). */
export function sealAnswers(g: Game, sealIndex: number): boolean {
  if (!mainQuestOn(g)) return true;
  if (sealIndex === EXPEDITIONS.length - 1 && !g.mq.key) return false;
  return hasCrest(g, sealIndex);
}

/** The expedition whose basin you or the fortress are in (or -1). */
export function expeditionHere(g: Game): number {
  const [fx, , fz] = g.fortressCentre();
  const p = g.player;
  for (const e of g.world.terrain.expeditions) {
    if (Math.hypot(fx - e.x, fz - e.z) < e.r * 1.1 || Math.hypot(p.x - e.x, p.z - e.z) < e.r) return e.index;
  }
  return -1;
}

/** The fortress waits in an expedition's basin (no dusk, no march) until its crest is in your hands. */
export function marchHolds(g: Game): boolean {
  if (!mainQuestOn(g) || !g.mq.begun) return false;
  const i = expeditionHere(g);
  return i >= 0 && i === chapterNow(g) && !hasCrest(g, i);
}

/** A crest chest that must not be lost (under a blast, under the fortress's feet). */
export function crestSafe(g: Game, x: number, y: number, z: number): boolean {
  const i = crestChestAt(g, x, y, z);
  return i >= 0 && mainQuestOn(g) && !hasCrest(g, i);
}

/** The chapter under way: the first land whose seal still stands (6: the Heart). */
export function chapterNow(g: Game): number {
  const T = g.world.terrain;
  for (let i = 0; i < T.seals.length; i += 1) if (!g.sealsBroken.has(i)) return i;
  return T.seals.length;
}

/** Where an expedition's warden waits (world). */
export function wardenSpot(g: Game, e: ExpeditionSite): Vec3 {
  switch (e.id) {
    case 'pyramid':
      return [e.x + 0.5, e.y + 1, e.z + 0.5];
    case 'lagoon':
      return [e.x + 0.5, 48, e.z + 0.5];
    case 'fort':
      return [e.x + 0.5, e.y + 17, e.z + e.side * 9.5 + 0.5];
    case 'cinder':
      return [e.summit![0] + 0.5, e.summit![1] + 1, e.summit![2] + 0.5];
    default: {
      // The wreck itself (its cabin, where the captain's chest is).
      const c = crestChest(g, e.index);
      return c ? [c[0] + 0.5, c[1] + 1, c[2] + 0.5] : [e.x + 0.5, e.y + 3, e.z + 0.5];
    }
  }
}

/** The march's next stop for the quest: this land's expedition, while its crest is still out there. */
export function questStop(g: Game): Site | null {
  if (!mainQuestOn(g) || !g.mq.begun) return null;
  const T = g.world.terrain;
  const c = chapterNow(g);
  const e = T.expeditions[c];
  if (!e || hasCrest(g, c)) return null;
  // (Already standing in its basin: no march needed.)
  const [fx, , fz] = g.fortressCentre();
  if (Math.hypot(fx - e.park[0], fz - e.park[1]) < 30) return null;
  return e.site;
}

// ------------------------------------------------------------------ the objective

/** The main quest's objective right now (the HUD's quest line and gold marker), or null. */
export function mainObjective(g: Game): Goal | null {
  if (!mainQuestOn(g) || !g.mq.begun || g.mq.won) return null;
  const T = g.world.terrain;
  const c = chapterNow(g);
  const tag = c < EXPEDITIONS.length ? `CH ${c + 1} · ${EXPEDITIONS[c]!.chapter.toUpperCase()}` : 'CH 7 · THE HEART';
  if (c >= T.expeditions.length) {
    if (!g.mq.key) {
      const missing = EXPEDITIONS.filter((_, i) => !hasCrest(g, i)).map((e) => e.crest);
      if (missing.length > 0) return { tag, text: `Find the missing crests: ${missing.join(', ')}`, target: null, tone: 'quest', icon: 'crest_0' };
      const forge = forgeAnvil(g);
      return { tag, text: 'Reforge the six crests at the Builders\' Forge', target: forge, tone: 'quest', label: 'THE FORGE', icon: 'builders_key' };
    }
    const cit = T.citadel;
    return { tag, text: 'March on the Citadel and break the Heart', target: [cit.x + 0.5, cit.y + 30, cit.z + 0.5], tone: 'quest', label: 'THE HEART', icon: 'builders_key' };
  }
  const e = T.expeditions[c]!;
  const info = EXPEDITIONS[c]!;
  const site: Vec3 = [e.x + 0.5, e.y + 4, e.z + 0.5];
  if (!hasCrest(g, c)) {
    const here = g.mq.reached.includes(c);
    if (!here) return { tag, text: info.find, target: site, tone: 'quest', label: e.name.toUpperCase(), icon: info.icon, note: 'At dusk the fortress marches there' };
    if (!wardenBeaten(g, c)) {
      if (g.warden) return { tag, text: `Defeat ${info.wardenName}`, target: null, tone: 'danger', icon: info.icon };
      return { tag, text: info.search, target: wardenSpot(g, e), tone: 'quest', label: info.strider.toUpperCase(), icon: info.icon };
    }
    const chest = crestChest(g, c);
    return { tag, text: `Open ${info.captain}'s chest: the ${info.crest}`, target: chest ? [chest[0] + 0.5, chest[1] + 1.2, chest[2] + 0.5] : site, tone: 'quest', label: 'THE CREST', icon: info.icon };
  }
  if (c === 5 && !g.mq.key && EXPEDITIONS.every((_, i) => hasCrest(g, i))) {
    return { tag, text: 'Reforge the six crests at the Builders\' Forge', target: forgeAnvil(g), tone: 'quest', label: 'THE FORGE', icon: 'builders_key' };
  }
  const seal = T.seals[c]!;
  return { tag, text: `Break the ${seal.name}: its guardian answers to the crest`, target: [seal.x + 0.5, seal.y + 14, seal.z + 0.5], tone: 'quest', label: seal.name.toUpperCase(), icon: info.icon };
}

/** The Builders' anvil in Mount Cinder's forge (world cell, raised for the marker). */
export function forgeAnvil(g: Game): Vec3 | null {
  const e = g.world.terrain.expeditions.find((x) => x.id === 'cinder');
  if (!e) return null;
  const s = g.world.structures.byId.get(`x${e.index}:forge`);
  if (!s) return null;
  for (let i = 0; i < s.count; i += 1) if (s.ids[i] === B.ANVIL) return [s.xs[i]! + 0.5, s.ys[i]! + 1.5, s.zs[i]! + 0.5];
  return null;
}

// ------------------------------------------------------------------ progress

/**
 * Per step: the quest begins (the backstory, at the first dawn after the first night, or at once in a
 * game saved before it), expeditions are reached (their chapter card), crests already won along a
 * road travelled before the quest existed are found.
 */
export function updateMainQuest(g: Game): void {
  if (!mainQuestOn(g) || g.coopGuest) return;
  const mq = g.mq;
  if (!mq.begun) {
    if (g.phase !== 'day' || g.modal !== 'none' || g.intro) return;
    if (g.stats.nights < 1 && g.sealsBroken.size === 0) return;
    beginMainQuest(g);
    return;
  }
  if (g.phase !== 'day' && g.phase !== 'night') return;
  const T = g.world.terrain;
  const [fx, , fz] = g.fortressCentre();
  const p = g.player;
  T.expeditions.forEach((e, i) => {
    if (mq.reached.includes(i)) return;
    const near = Math.hypot(fx - e.x, fz - e.z) < e.r * 1.05 || Math.hypot(p.x - e.x, p.z - e.z) < e.r * 0.8;
    if (!near) return;
    mq.reached.push(i);
    const info = EXPEDITIONS[i]!;
    g.ui.banner(e.name.toUpperCase(), `${info.chapter}: ${info.search}`, 'gold');
    g.sfx('chapter', 'wood', 1);
    if (g.phase === 'night') g.deferSaga('expedition', String(i));
    else g.ui.story('expedition', String(i));
    g.save();
  });
}

/** The quest begins: the backstory cards; crests of lands left behind before it began are found. */
export function beginMainQuest(g: Game): void {
  const mq = g.mq;
  mq.begun = true;
  // (A game saved past some seals: their crests turned up along the road it travelled.)
  let found = 0;
  for (const i of g.sealsBroken) {
    if (i >= EXPEDITIONS.length || mq.crests.includes(i)) continue;
    mq.crests.push(i);
    if (!mq.wardens.includes(i)) mq.wardens.push(i);
    const log = logPage(i);
    if (log) g.journal.add(log.id);
    found += 1;
  }
  // (Every seal already behind it: the Key was forged along the way too.)
  if (g.sealsBroken.size >= g.world.terrain.seals.length) mq.key = true;
  for (let k = 0; k < SAGA_OPENING.length; k += 1) g.ui.story('saga', `open${k}`);
  // The first land's own card closes the opening: where the road begins, what walks it, and the
  // seal at its end with the guardian that holds it (home has no card of its own otherwise).
  const T = g.world.terrain;
  if (T.version >= 2 && T.regionIndex(g.fortressCentre()[0]) === 0) g.ui.story('chapter', '0');
  g.addPage('eleven', false, true);
  if (found > 0) g.toast(`Strider Crests salvaged from the lands behind you: ${found}`, 'crest_0');
  g.save();
}

/** The crest is taken from the captain's chest: its card, the captain's log, a fanfare. */
export function grantCrest(g: Game, i: number): void {
  const mq = g.mq;
  if (mq.crests.includes(i)) return;
  mq.crests.push(i);
  if (!mq.wardens.includes(i)) mq.wardens.push(i);
  const info = EXPEDITIONS[i]!;
  const log = logPage(i);
  if (log) g.journal.add(log.id);
  g.ui.story('crest', String(i));
  g.sfx('relic', 'metal', 1);
  g.celebrate(3);
  g.xp(60);
  g.addItem(I.EMERALD, 6 + i * 2, true);
  const seal = g.world.terrain.seals[i];
  g.toast(seal ? `${info.crest}: now the ${seal.name} will answer` : info.crest, info.icon);
  if (mq.crests.length >= EXPEDITIONS.length) feat(g, 'crests');
  g.save();
}

/** At the Builders' anvil with all six crests: the Key. */
export function reforge(g: Game): boolean {
  const mq = g.mq;
  if (mq.key) return false;
  const missing = EXPEDITIONS.filter((_, i) => !hasCrest(g, i));
  if (missing.length > 0) {
    g.deny(`The anvil wants all six crests (missing: ${missing.map((e) => e.crest).join(', ')})`);
    return false;
  }
  mq.key = true;
  const at = forgeAnvil(g);
  if (at) {
    g.particles.ring(at[0], at[1], at[2], 6, 1, 0.8, 0.3);
    g.particles.sparks(at[0], at[1], at[2], ['#ffd23a', '#ffffff', '#ff8a2a', '#8ad8ff', '#5fd068'], 70, 9, 0.14, 1.2);
    g.light({ x: at[0], y: at[1] + 1, z: at[2], r: 30, color: [1.4, 1.1, 0.5], life: 1.6, max: 1.6 });
  }
  g.renderer.shake(0.6);
  g.sfx('relic', 'metal', 1.2);
  g.sfx('clank', 'metal', 1);
  g.buzz(120);
  g.ui.story('saga', 'forge');
  g.ui.banner('THE BUILDERS\' KEY!', 'It can open the Heart\'s last shell. On to the Citadel!', 'gold');
  g.celebrate(6);
  g.xp(120);
  g.save();
  return true;
}
