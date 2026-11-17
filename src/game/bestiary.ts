// The Bestiary: every monster you have brought down, how many, and what the crew has learned about it.
// (Who it is shows only once one has fallen.)
import type { ActorKind } from './entities';

export interface Beast {
  kind: ActorKind;
  name: string;
  text: string;
}

export const BESTIARY: readonly Beast[] = [
  { kind: 'zombie', name: 'Zombie', text: 'Slow, and never alone. They climb the legs if you let them. Sunrise finishes what your sword does not.' },
  { kind: 'skeleton', name: 'Skeleton', text: 'Bows at any range. Close the distance, or get a wall between you.' },
  { kind: 'creeper', name: 'Creeper', text: 'Walks up to your cannons and goes off. Hit it first, or be somewhere else.' },
  { kind: 'spider', name: 'Spider', text: 'Goes straight up the legs. A stomp shakes them off.' },
  { kind: 'cavespider', name: 'Cave Spider', text: 'Small and poisonous. It breeds in old mines until someone breaks its cage.' },
  { kind: 'phantom', name: 'Phantom', text: 'Dives out of the night sky. Crossbows and ballistae bring it down.' },
  { kind: 'husk', name: 'Husk', text: 'The desert\'s dead. One touch and you are hungry for an hour.' },
  { kind: 'witch', name: 'Witch', text: 'Throws brews and drinks the good ones herself. Rush her.' },
  { kind: 'slime', name: 'Slime', text: 'Every piece that comes off wants to live. Keep hitting the small ones.' },
  { kind: 'drowned', name: 'Drowned', text: 'Rises from the fen with a trident and throws it true.' },
  { kind: 'bogged', name: 'Bogged', text: 'A skeleton grown over with mushrooms. Its arrows are poisoned.' },
  { kind: 'pillager', name: 'Pillager', text: 'An outlaw with a crossbow. They come in bands and they want your emeralds.' },
  { kind: 'vindicator', name: 'Vindicator', text: 'An outlaw with an axe, and no interest in talking. Heavy blows, slow to turn.' },
  { kind: 'evoker', name: 'Evoker', text: 'Calls fangs out of the ground and vexes out of the air. Strike while it casts.' },
  { kind: 'vex', name: 'Vex', text: 'Flies through walls and dies quickly. Kill the one who called it.' },
  { kind: 'ravager', name: 'Ravager', text: 'A beast bred for war. It charges the legs, and it does not stop for much.' },
  { kind: 'breeze', name: 'Breeze', text: 'Living wind. It blows you clean off the deck. Its charges make good throwing.' },
  { kind: 'stray', name: 'Stray', text: 'A skeleton of the snowfields. Its arrows slow you down.' },
  { kind: 'polarbear', name: 'Polar Bear', text: 'It was here first. It hits like a falling wall, and it can run.' },
  { kind: 'blaze', name: 'Blaze', text: 'A burning thing that hovers and throws fire. Bolts bring it down.' },
  { kind: 'magmacube', name: 'Magma Cube', text: 'A slime that swam in lava. It is at home in the lakes and splits when struck.' },
  { kind: 'ghast', name: 'Ghast', text: 'A great weeping cloud that spits fireballs. Bat them back at it.' },
  { kind: 'enderman', name: 'Enderman', text: 'Steps aside from anything shot at it, and steals blocks off your hull. Fight it hand to hand.' },
  { kind: 'witherskel', name: 'Wither Skeleton', text: 'Black bones, a stone sword, and a touch that drains your hearts.' },
  { kind: 'queen', name: 'The Brood Queen', text: 'Mother of the Greenvale spiders. She held the first seal.' },
  { kind: 'wither', name: 'The Wither', text: 'Three skulls and a hatred of the sun. It holds back the dawn until it falls.' },
  { kind: 'veyra', name: 'Veyra, the Heart-Architect', text: 'The greatest of the Builders. She went in after the Heart, and held it for forty years.' },
];
