export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  /** Peak opacity of soft sprites. */
  a: number;
  gravity: number;
  drag: number;
  /** Texture and the pixel window used for debris chips (whole tile when `soft`). */
  tile: string;
  u: number;
  v: number;
  emit: number;
  /** Alpha-blended sprite (smoke, dust, mist, sparks) rather than a solid chip. */
  soft: boolean;
  spin: number;
  vspin: number;
}

const MAX_PARTICLES = 900;

export function hexRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export class Particles {
  readonly list: Particle[] = [];

  add(p: Partial<Particle> & { x: number; y: number; z: number }): void {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    const life = p.life ?? 0.6;
    this.list.push({
      vx: 0, vy: 0, vz: 0, life, max: life, size: 0.12, grow: 0, r: 1, g: 1, b: 1, a: 1,
      gravity: 18, drag: 0.5, tile: 'white', u: 0, v: 0, emit: 0, soft: false, spin: 0, vspin: 0, ...p,
    });
  }

  /** Chunks of a block's texture flying apart. */
  debris(x: number, y: number, z: number, tile: string, count: number, speed = 4, size = 0.14, life = 0.8): void {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.8);
      this.add({
        x: x + (Math.random() - 0.5) * 0.7,
        y: y + (Math.random() - 0.5) * 0.7,
        z: z + (Math.random() - 0.5) * 0.7,
        vx: Math.cos(a) * s,
        vy: Math.random() * speed * 0.9 + 1,
        vz: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.7 + Math.random() * 0.7),
        tile,
        u: Math.floor(Math.random() * 24),
        v: Math.floor(Math.random() * 24),
      });
    }
  }

  sparks(x: number, y: number, z: number, colors: string[], count: number, speed = 6, size = 0.1, life = 0.5): void {
    for (let i = 0; i < count; i += 1) {
      const [r, g, b] = hexRgb(colors[i % colors.length]!);
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.add({
        x, y, z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s + 1,
        vz: Math.sin(a) * Math.cos(e) * s,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.7 + Math.random() * 0.6),
        r, g, b, emit: 1, gravity: 9, drag: 1.2,
      });
    }
  }

  smoke(x: number, y: number, z: number, count: number, spread = 1.2, dark = false): void {
    for (let i = 0; i < count; i += 1) {
      const c = dark ? 0.2 : 0.62 + Math.random() * 0.25;
      this.add({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        z: z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 1 + Math.random() * 1.5,
        vz: (Math.random() - 0.5) * 1.5,
        life: 1 + Math.random() * 1.2,
        size: 0.45 + Math.random() * 0.45,
        grow: 0.9,
        r: c, g: c, b: c, a: dark ? 0.85 : 0.7,
        gravity: -1.2,
        drag: 1.4,
        tile: 'smoke',
        soft: true,
        spin: Math.random() * 6,
        vspin: (Math.random() - 0.5) * 1.2,
      });
    }
  }

  /** Clouds of dust (or spray, in water) kicked up by a stomping foot. */
  dust(x: number, y: number, z: number, count: number, spread: number, water: boolean): void {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 3;
      this.add({
        x: x + Math.cos(a) * spread * 0.4,
        y: y + Math.random() * 0.4,
        z: z + Math.sin(a) * spread * 0.4,
        vx: Math.cos(a) * s,
        vy: 0.6 + Math.random() * 1.6,
        vz: Math.sin(a) * s,
        life: 1.1 + Math.random() * 1.1,
        size: 0.55 + Math.random() * 0.6,
        grow: 1.1,
        r: water ? 0.85 : 0.72, g: water ? 0.92 : 0.6, b: water ? 1 : 0.45, a: water ? 0.65 : 0.55,
        gravity: -0.3,
        drag: 2.4,
        tile: water ? 'smoke' : 'dust',
        soft: true,
        spin: Math.random() * 6,
        vspin: (Math.random() - 0.5) * 0.8,
      });
    }
  }

  /** A fallen creature puffs away: a small burst of grey-white wisps (no screen-filling cloud). */
  poof(x: number, y: number, z: number, count = 10): void {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.7 + Math.random() * 1.6;
      const c = 0.78 + Math.random() * 0.2;
      this.add({
        x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.9, z: z + (Math.random() - 0.5) * 0.6,
        vx: Math.cos(a) * s, vy: 0.4 + Math.random() * 1.4, vz: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.35, size: 0.16 + Math.random() * 0.16, grow: 0.3,
        r: c, g: c, b: c, a: 0.85, gravity: -0.8, drag: 3.2, tile: 'smoke', soft: true, spin: Math.random() * 6, vspin: (Math.random() - 0.5) * 3,
      });
    }
  }

  /** Critical-hit stars bursting off a struck creature. */
  crit(x: number, y: number, z: number, count = 12): void {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.2) * Math.PI * 0.6;
      const s = 3 + Math.random() * 4;
      this.add({
        x, y, z,
        vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 1.5, vz: Math.sin(a) * Math.cos(e) * s,
        life: 0.35 + Math.random() * 0.3, size: 0.14 + Math.random() * 0.12,
        r: 1, g: 0.92, b: 0.6, a: 1, emit: 1, gravity: 6, drag: 2.2, tile: 'spark', soft: true, spin: Math.random() * 6, vspin: 8,
      });
    }
  }

  /** A shock ring racing out from a blast (or a ram, or a horn). */
  ring(x: number, y: number, z: number, size: number, r = 1, g = 0.85, b = 0.6): void {
    this.add({ x, y, z, life: 0.32, size: size * 0.3, grow: size * 5.5, r, g, b, a: 0.9, emit: 1, gravity: 0, drag: 0, tile: 'ring', soft: true });
  }

  /** The bright fireball at the heart of an explosion. */
  flash(x: number, y: number, z: number, size: number): void {
    this.add({ x, y, z, life: 0.22, size: size * 0.8, grow: size * 4, r: 1, g: 0.75, b: 0.35, a: 1, emit: 1, gravity: 0, drag: 0, tile: 'smoke', soft: true });
    for (let i = 0; i < 5; i += 1) {
      this.add({
        x: x + (Math.random() - 0.5) * size, y: y + (Math.random() - 0.5) * size, z: z + (Math.random() - 0.5) * size,
        vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3,
        life: 0.35 + Math.random() * 0.2, size: size * 0.4, grow: size * 1.5,
        r: 1, g: 0.55, b: 0.2, a: 0.9, emit: 1, gravity: -2, drag: 2, tile: 'flame', soft: true, spin: Math.random() * 6,
      });
    }
  }

  /** Spray rising where a waterfall hits its pool. */
  mist(x: number, y: number, z: number, spread: number): void {
    this.add({
      x: x + (Math.random() - 0.5) * spread, y, z: z + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 1.2, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.2,
      life: 1.6 + Math.random(), size: 0.6 + Math.random() * 0.5, grow: 0.9,
      r: 0.9, g: 0.95, b: 1, a: 0.32, gravity: -0.2, drag: 1.2, tile: 'smoke', soft: true, spin: Math.random() * 6, vspin: 0.4,
    });
  }

  /** A drifting firefly over the meadows at night. */
  firefly(x: number, y: number, z: number): void {
    this.add({
      x, y, z, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.6,
      life: 3 + Math.random() * 3, size: 0.06, r: 0.75, g: 1, b: 0.35, a: 1, emit: 1, gravity: 0, drag: 0.1, soft: true, tile: 'white',
    });
  }

  update(dt: number): void {
    const list = this.list;
    let write = 0;
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i]!;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      if (p.soft) p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      p.spin += p.vspin * dt;
      list[write] = p;
      write += 1;
    }
    list.length = write;
  }
}
