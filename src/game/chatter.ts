// Voices of the valley: villagers greet you as you pass, the trader calls out, your crew chats on
// the deck by day and shouts warnings in the fight, and everyone cheers the big moments. Each line
// is a speech bubble over the speaker's head with a little murmur, never more than a few at once.
import { officerWord } from './company';
import { atCraneControls, hobSpot } from './crane';
import type { Actor, VillagerRole } from './entities';
import type { Game } from './game';
import type { Zone } from './terrain';
import type { Vec3 } from './math3d';
import { clamp } from './rng';

export type BubbleKind = 'talk' | 'shout' | 'cheer';

export type CrewEvent =
  | 'giant' | 'climbers' | 'core' | 'lull' | 'final' | 'dawn' | 'giantDown' | 'squash' | 'ram' | 'stomp'
  | 'hoist' | 'star' | 'phantom' | 'storm' | 'blood' | 'stowaway' | 'howl' | 'wave' | 'march' | 'wish' | 'glide' | 'welcome'
  | 'raid' | 'ravager' | 'wither' | 'witherArmor' | 'charge' | 'blight' | 'ghast' | 'sapper' | 'enderman' | 'thief' | 'witch'
  | 'drowned' | 'breeze' | 'bear' | 'blaze' | 'guardian' | 'seal'
  | 'heave' | 'cleanLift' | 'steady' | 'onMark' | 'offMark' | 'bombAway' | 'bombHit';

const CREW: Record<CrewEvent, { lines: string[]; kind: BubbleKind; gap: number }> = {
  giant: { lines: ['GIANT AHEAD!', 'That one\'s BIG!', 'Aim for its glowing heart!'], kind: 'shout', gap: 30 },
  climbers: { lines: ['They\'re climbing the legs!', 'Shake them off, Captain!', 'Something\'s on leg two!'], kind: 'shout', gap: 35 },
  core: { lines: ['The Core! Protect the Core!', 'Core\'s hit! Bring iron!'], kind: 'shout', gap: 30 },
  lull: { lines: ['Phew... reload, everyone.', 'Quick, patch the hull!', 'Anyone got a sandwich?'], kind: 'talk', gap: 40 },
  final: { lines: ['HERE THEY COME!', 'All hands! ALL HANDS!', 'For Oakbrook!'], kind: 'shout', gap: 60 },
  wave: { lines: ['Here they come...', 'Eyes on the legs!', 'Man the guns!'], kind: 'shout', gap: 40 },
  dawn: { lines: ['WE MADE IT!', 'Sunrise! Hooray!', 'I can see roofs!'], kind: 'cheer', gap: 60 },
  giantDown: { lines: ['TIMBER!', 'Down it goes!', 'HA! Got it!'], kind: 'cheer', gap: 15 },
  squash: { lines: ['Ha! Pancake!', 'Splat!', 'Mind your step, monsters!', 'Squish!', 'Who ordered pancakes?'], kind: 'shout', gap: 14 },
  ram: { lines: ['HOLD ON!', 'Ramming speed!', 'Brace! BRACE!'], kind: 'shout', gap: 12 },
  stomp: { lines: ['Everybody jump!', 'BOOM!', 'Hold your hats!'], kind: 'shout', gap: 12 },
  hoist: { lines: ['Welcome aboard!', 'More room for us!', 'Nice house!', 'I call the top bunk!'], kind: 'cheer', gap: 10 },
  star: { lines: ['Ooh, a shooting star!', 'Look up! Make a wish!'], kind: 'shout', gap: 20 },
  wish: { lines: ['What did you wish for?', 'It came true!'], kind: 'talk', gap: 20 },
  phantom: { lines: ['Look up! PHANTOMS!', 'Something in the sky!'], kind: 'shout', gap: 60 },
  storm: { lines: ['Lightning! Stay low!', 'I\'m not touching the mast tonight.'], kind: 'talk', gap: 90 },
  blood: { lines: ['The moon... it\'s RED...', 'I don\'t like this moon.'], kind: 'talk', gap: 90 },
  stowaway: { lines: ['Is that a CHICKEN?', 'Eggs for breakfast!', 'Welcome aboard, little one.'], kind: 'talk', gap: 20 },
  howl: { lines: ['Pip\'s singing again.', 'Good boy, Pip!', 'Awoooo!'], kind: 'talk', gap: 60 },
  march: { lines: ['Onward!', 'Off we go!', 'Next stop: the next village!'], kind: 'talk', gap: 60 },
  glide: { lines: ['Look! A flying captain!', 'Is that... a chicken glider?'], kind: 'shout', gap: 30 },
  welcome: { lines: ['Welcome back, Captain!', 'Wipe your boots!', 'Did you bring snacks?', 'There you are!'], kind: 'talk', gap: 90 },
  raid: { lines: ['That horn... ILLAGERS!', 'RAID! To the guns!', 'They\'ve come for us!'], kind: 'shout', gap: 40 },
  ravager: { lines: ['A RAVAGER! Mind the legs!', 'Brace for the beast!', 'It\'s charging the feet!'], kind: 'shout', gap: 25 },
  wither: { lines: ['What IS that?!', 'Three heads?!', 'The sky... it\'s gone dark!'], kind: 'shout', gap: 60 },
  witherArmor: { lines: ['Bolts are bouncing off!', 'Swords and TNT, Captain!', 'It\'s coming down on us!'], kind: 'shout', gap: 40 },
  charge: { lines: ['It\'s CHARGING!', 'Steam! It\'s coming fast!', 'Brace for impact!'], kind: 'shout', gap: 20 },
  blight: { lines: ['The blight... smell that?', 'Something\'s wrong out here.', 'Stay close to the Core tonight.'], kind: 'talk', gap: 90 },
  ghast: { lines: ['A GHAST! Watch for fireballs!', 'Bat them back, Captain!', 'Fire in the sky!'], kind: 'shout', gap: 50 },
  sapper: { lines: ['Creeper at the feet!', 'They\'re blowing the legs!', 'Kill it before it pops!'], kind: 'shout', gap: 25 },
  enderman: { lines: ['Don\'t look at it!', 'You LOOKED at it!', 'It\'s angry now...'], kind: 'shout', gap: 40 },
  thief: { lines: ['It took a BLOCK!', 'Thief! Get our block back!', 'Hey! That was my bunk wall!'], kind: 'shout', gap: 20 },
  witch: { lines: ['A witch! Watch for potions!', 'Smash her bottles!'], kind: 'shout', gap: 60 },
  drowned: { lines: ['Out of the water! DROWNED!', 'Tridents! Heads down!', 'The pools are moving!'], kind: 'shout', gap: 70 },
  breeze: { lines: ['BREEZE! Hold onto something!', 'Wind charge incoming!', 'Grab the rail!'], kind: 'shout', gap: 60 },
  bear: { lines: ['BEAR! Big one!', 'It\'s after the feet!', 'Don\'t pet that one, Pip!'], kind: 'shout', gap: 70 },
  blaze: { lines: ['Fire in the smoke! BLAZES!', 'Ballistas up! They fly!', 'Something\'s burning out there!'], kind: 'shout', gap: 60 },
  guardian: { lines: ['THE GUARDIAN WAKES!', 'That\'s what holds the seal?!', 'Bring it down and the wall falls!'], kind: 'shout', gap: 20 },
  seal: { lines: ['THE SEAL IS BROKEN!', 'The way is open!', 'Onward, to the next land!'], kind: 'cheer', gap: 20 },
  // Working the crane.
  heave: { lines: ['Take the strain!', 'Heave! HEAVE!', 'She\'s coming up!', 'Mind the roots!'], kind: 'shout', gap: 16 },
  cleanLift: { lines: ['Clean pull!', 'Roots and all!', 'Look at it come up!'], kind: 'cheer', gap: 8 },
  steady: { lines: ['Easy... easy...', 'Steady it, Captain!', 'Watch the swing!', 'Mind your heads!', 'Against the swing, Captain!'], kind: 'shout', gap: 12 },
  onMark: { lines: ['Right on the mark!', 'Fits like a glove!', 'Not a block out of place!'], kind: 'cheer', gap: 8 },
  offMark: { lines: ['Bit wobbly, Captain!', 'Close enough!', 'It\'ll hold. Probably.'], kind: 'talk', gap: 10 },
  bombAway: { lines: ['Look out below!', 'Bombs away!', 'FIRE IN THE HOLE!'], kind: 'shout', gap: 6 },
  bombHit: { lines: ['Right on their heads!', 'Ha! Got a whole bunch!', 'Special delivery!'], kind: 'cheer', gap: 6 },
};

/** What the crane's work has Old Hob (the crane hand at its mast) call out first, if he can be seen. */
const HOB_CALLS = new Set<CrewEvent>(['heave', 'cleanLift', 'steady', 'onMark', 'offMark', 'bombAway', 'bombHit']);

/** Old Hob's word to a captain at the crane's controls, by day and by night. */
const HOB_DAY = [
  'Crane\'s ready, Captain. Look at a house and I\'ll fetch it.',
  'Lean against the swing. Never chase it.',
  'I hung the cranes on all twelve Striders, you know.',
  'Mind the hook. It bites.',
  'A soft landing keeps the soup in the pot.',
  'Two TNT and I\'ll hook a crate on for you.',
];
const HOB_NIGHT = [
  'Climbers on the legs! Shall I hook a crate on?',
  'Swing it out, watch the red ring, let it go!',
  'Lead them, Captain: the crate swings with the rope.',
];

/** Over Old Hob's head (he stands by the mast; the fortress carries him along). */
function hobHead(g: Game): () => Vec3 | null {
  return () => {
    const at = hobSpot(g);
    return at ? [at[0], at[1] + 2.45, at[2]] : null;
  };
}

/** Idle talk on the deck by day, and the nervous kind at night. */
const CREW_DAY = [
  'Lovely day for a march.', 'Who left TNT on the stairs?', 'Pip stole my sandwich again.', 'The Core is humming a tune.',
  'Can we get a bigger deck?', 'Is it my turn at the helm?', 'Hrmm.', 'Anyone seen my hat?', 'My old house walks now. Neat.',
  'Wool makes thrusters, you know.', 'I polished the cannon. Twice.', 'Do giants dream?', 'Hmm hmm hmm...',
];
const CREW_NIGHT = ['Keep your eyes on the legs!', 'Hold steady...', 'I hear them out there...', 'Who\'s on the cannon?', 'Stay close to the Core!', 'Steady, steady...'];

/** What villagers say as you pass, by their trade (a few lines more once the village trusts you). */
const GREET: Record<VillagerRole, string[]> = {
  villager: ['Is that a walking HOUSE?', 'Hrmm! Visitors!', 'My grandma rode a Strider once.', 'Ooh, can I steer?', 'Mind the flowers!', 'Good luck out there, Captain!', 'Hrmm. Hrmm!'],
  farmer: ['Mind the wheat, Captain!', 'Hens lay best when nobody stomps.', 'Those feet! Not my carrots!', 'Shear a sheep: wool makes thrusters!', 'Hold a hen and jump. Trust me.'],
  smith: ['Bring me iron, I\'ll patch anything.', 'That leg squeaks, Captain.', 'Hrmm. Fine rivets on that hull.', 'Keep your sword sharp.'],
  trader: ['Emeralds! TNT! Bunks!', 'Psst. Want a ballista?', 'Come, come! Best prices!', 'Fresh TNT, barely used!'],
};

const REACT: Record<'hen' | 'shear' | 'hoist' | 'recruit' | 'quest' | 'farewell', { farmer?: string[]; any: string[] }> = {
  hen: { farmer: ['Hey! That\'s Henrietta!', 'Bring her back by supper!', 'She pecks, you know.'], any: ['Is that... a chicken?', 'Ha! Hold on tight!'] },
  shear: { farmer: ['Nice cut! Mind the ears.', 'Wool for thrusters? Clever!'], any: ['Ooh, fluffy!', 'Nice haircut!'] },
  hoist: { any: ['My HOUSE!', 'Bring it back in one piece!', 'Wave goodbye, Grandpa!', 'Mind the flowerpots!'] },
  recruit: { any: ['Aye aye, Captain!', 'To the fortress!', 'Finally, an adventure!', 'I\'ll fetch my hat!'] },
  quest: { any: ['You did it!', 'Hooray for the Captain!', 'Thank you!'] },
  farewell: { any: ['Good luck, Captain!', 'Come back safe!', 'Bye, Pip!', 'Give them a stomp for us!'] },
};

/** What the folk of each land have on their minds (mixed in with their trade's lines). */
const LAND_GREET: Partial<Record<Zone, string[]>> = {
  desert: ['Water? You brought water?', 'Hot enough for you, Captain?', 'The husks come out of the dunes at night.', 'Sand in everything. Everything!'],
  swamp: ['Mind the mud, Captain!', 'The frogs sing all night long.', 'Something moves under the pools...', 'Hrmm. Damp today. Damp every day.'],
  badlands: ['Hold your hat: the wind has teeth here.', 'Outlaws in the canyons, Captain.', 'Breezes! They blow the washing away!', 'Red rock, red dust, red sunsets.'],
  snow: ['Brrr! Come in, come in!', 'A bear took my fish again.', 'The lights in the sky? Pretty, aren\'t they?', 'Strays shoot ice. Wrap up warm!'],
  ember: ['It never stops smoking here.', 'Mind the lava, Captain!', 'Blazes in the smoke. Keep your head down.', 'We haven\'t seen the sun in years.'],
  blight: ['Nothing grows here anymore.', 'The Citadel watches us, Captain.', 'Break its Heart. Please.', 'Hrmm... hurry.'],
};

/** The wandering trader's patter. */
const WANDERER_GREET = ['Rare wares, Captain! Only today!', 'Totems! Pearls! Heartstones!', 'From far down the valley!', 'My llamas need a rest.', 'Psst. Wind charges. Very windy.'];

/** Your crew's idle talk in each land, by day. */
const CREW_LAND: Partial<Record<Zone, string[]>> = {
  desert: ['Is the deck melting?', 'I\'d trade my bunk for a cold drink.', 'Cactus. More cactus.'],
  swamp: ['Something just touched my foot.', 'It smells like old boots here.', 'Are those frogs... singing?'],
  badlands: ['Look at those rocks!', 'Hold onto the rail: wind!', 'Red dust in my sandwich.'],
  snow: ['Who took my scarf?', 'My nose is frozen.', 'Snowball fight after the march?'],
  ember: ['I can\'t see the sun.', 'The cannon\'s warm without firing.', 'Don\'t step in the glowy bits.'],
  blight: ['I don\'t like this place.', 'Almost there, Captain.', 'Keep the Core close tonight.'],
};

const VOICE: Record<VillagerRole, number> = { villager: 1.06, farmer: 0.96, smith: 0.82, trader: 1 };

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** Time of the last line said (bubbles keep a short gap), and when each crew shout was last heard. */
let lastLine = -99;
const heard = new Map<string, number>();
let idleTimer = 20;
/** When Old Hob last had a word for you at the crane. */
let hobLast = -99;
let ambientTimer = 1;

/** A point on screen (and not behind you)? */
function onScreen(g: Game, at: Vec3): boolean {
  const s = g.renderer.project(at);
  const r = g.renderer;
  return s !== null && s.x > 24 && s.x < r.cssW - 24 && s.y > r.cssH * 0.08 && s.y < r.cssH * 0.92;
}

function speak(g: Game, at: () => Vec3 | null, text: string, kind: BubbleKind, rate: number): boolean {
  const pos = at();
  if (!pos || !onScreen(g, pos)) return false;
  g.ui.say(at, text, kind);
  const p = g.player;
  const d = Math.hypot(pos[0] - p.x, pos[1] - p.y, pos[2] - p.z);
  g.sfx('villager', 'flesh', clamp(0.75 - d / 30, 0.12, 0.7), rate);
  lastLine = g.time;
  return true;
}

/** Over a villager's head (it walks on, the bubble follows). */
function headOf(a: Actor): () => Vec3 | null {
  return () => (a.dead ? null : [a.x, a.y + a.h + 0.45, a.z]);
}

/** Over one of your crew on the deck (posts move with the fortress). */
function crewAt(g: Game, i: number): () => Vec3 | null {
  return () => {
    const post = g.crewPosts[i];
    if (!post || i >= g.crew) return null;
    return g.fortress.toWorld(post.x + 0.5, post.y + 2.35, post.z + 0.5);
  };
}

/** Your crew members who could be seen saying something right now (nearest first). */
function visibleCrew(g: Game): number[] {
  const p = g.player;
  const out: Array<{ i: number; d: number }> = [];
  for (let i = 0; i < Math.min(g.crew, g.crewPosts.length); i += 1) {
    const at = crewAt(g, i)();
    if (!at) continue;
    const d = Math.hypot(at[0] - p.x, at[2] - p.z);
    if (d > 28 || !onScreen(g, at)) continue;
    out.push({ i, d });
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.i);
}

/** A crew member shouts about what is happening (each kind of shout keeps its own gap). */
export function crewSay(g: Game, event: CrewEvent): void {
  const c = CREW[event];
  if (g.time - (heard.get(event) ?? -99) < c.gap || g.time - lastLine < 1.2) return;
  // The crane's work: Old Hob calls it, when he is in sight.
  if (HOB_CALLS.has(event) && speak(g, hobHead(g), pick(c.lines), c.kind, 0.74)) {
    heard.set(event, g.time);
    return;
  }
  const crew = visibleCrew(g);
  if (crew.length === 0) return;
  // Not always the same one: one of the nearest few.
  const i = crew[Math.floor(Math.random() * Math.min(3, crew.length))]!;
  if (speak(g, crewAt(g, i), pick(c.lines), c.kind, 0.85 + Math.random() * 0.3)) heard.set(event, g.time);
}

/** A villager near (x, z) reacts to what you just did (farmers first, for their animals). */
export function villagerReact(g: Game, kind: keyof typeof REACT, x: number, z: number, who: Actor | null = null): void {
  const r = REACT[kind];
  let v = who;
  if (!v) {
    let best = kind === 'farewell' ? 40 : 14;
    for (const o of g.villagers) {
      if (o.recruited || o.captive) continue;
      // (Waving you off: only one you could see.)
      if (kind === 'farewell' && !onScreen(g, [o.x, o.y + o.h + 0.45, o.z])) continue;
      const d = Math.hypot(o.x - x, o.z - z) - (o.role === 'farmer' && r.farmer ? 6 : 0);
      if (d < best) {
        best = d;
        v = o;
      }
    }
  }
  if (!v) return;
  const lines = v.role === 'farmer' && r.farmer ? r.farmer : r.any;
  if (speak(g, headOf(v), pick(lines), kind === 'recruit' || kind === 'quest' || kind === 'farewell' ? 'cheer' : 'talk', VOICE[v.role])) v.chat = g.time;
}

/** Everyone cheers: a whoop from the crew (hopping for joy) and the villagers about, HOORAY! over a few heads. */
export function cheer(g: Game, loud = true): void {
  g.sfx('cheer', 'flesh', loud ? 0.85 : 0.6);
  g.crewJoy = 1.5;
  const words = ['HOORAY!', 'HUZZAH!', 'YEAH!', 'WOOHOO!', 'BRAVO!'];
  let n = 0;
  for (const i of visibleCrew(g).slice(0, 2)) {
    const at = crewAt(g, i);
    if (at()) g.ui.say(at, pick(words), 'cheer');
    n += 1;
  }
  const p = g.player;
  for (const v of g.villagers) {
    if (n >= 3) break;
    if (v.recruited || v.captive || Math.hypot(v.x - p.x, v.z - p.z) > 20) continue;
    const at = headOf(v);
    const pos = at();
    if (!pos || !onScreen(g, pos)) continue;
    g.ui.say(at, pick(words), 'cheer');
    v.vy = Math.max(v.vy, 4);
    v.onGround = false;
    n += 1;
  }
  lastLine = g.time;
}

/** Greetings in the villages, the trader's calls, and the crew's idle talk (checked every second). */
export function updateChatter(g: Game, dt: number): void {
  ambientTimer -= dt;
  idleTimer -= dt;
  if (ambientTimer > 0) return;
  ambientTimer = 1;
  if (g.player.dead || !g.isPlaying() || g.time - lastLine < 3.5) return;
  const p = g.player;
  // Villagers you come close to (and can see) say something; the trader calls from further off.
  if (g.phase === 'day') {
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const v of g.villagers) {
      // (Golems keep their own counsel.)
      const officer = v.kind === 'npc';
      if (v.recruited || v.kind === 'golem' || g.time - v.chat < (officer ? 80 : 30)) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (Math.abs(v.y - p.y) > 4 || d > (officer ? 9 : v.trader ? 14 : v.captive ? 11 : 7)) continue;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (best && Math.random() < 0.6) {
      const v = best;
      const land = LAND_GREET[g.world.terrain.zone(v.x, v.z)];
      const line = v.captive ? pick(['Help! Over here!', 'Get me out of here!', 'Psst! Captain!'])
        : v.kind === 'npc' ? officerWord(g, v) ?? ''
        : v.freed ? pick(['You came! Thank you!', 'Take me home!'])
        : v.kind === 'wtrader' ? pick(WANDERER_GREET)
        : land && !v.trader && g.world.terrain.version >= 2 && Math.random() < 0.45 ? pick(land)
        : pick(GREET[v.trader ? 'trader' : v.role]);
      if (speak(g, headOf(v), line, v.captive ? 'shout' : 'talk', VOICE[v.trader ? 'trader' : v.role])) {
        v.chat = g.time;
        return;
      }
    }
  }
  // Old Hob has a word for a captain who comes to the crane's controls.
  if (!g.craneDrop && !g.hoist && g.time - hobLast > 45 && atCraneControls(g)) {
    const night = g.phase === 'night';
    if (speak(g, hobHead(g), pick(night ? HOB_NIGHT : HOB_DAY), night ? 'shout' : 'talk', 0.74)) {
      hobLast = g.time;
      return;
    }
  }
  // Your crew, chatting on the deck while you are aboard.
  const aboard = p.standingOn === g.fortress || g.helm;
  if (!aboard || idleTimer > 0) return;
  idleTimer = g.phase === 'night' ? 26 + Math.random() * 18 : 38 + Math.random() * 30;
  const crew = visibleCrew(g);
  if (crew.length === 0) return;
  const i = pick(crew.slice(0, 3));
  const land = g.phase === 'day' && g.world.terrain.version >= 2 ? CREW_LAND[g.world.terrain.zone(p.x, p.z)] : undefined;
  speak(g, crewAt(g, i), pick(g.phase === 'night' ? CREW_NIGHT : land && Math.random() < 0.4 ? land : CREW_DAY), 'talk', 0.85 + Math.random() * 0.3);
}
