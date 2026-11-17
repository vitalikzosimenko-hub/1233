// The world map shown at the helm: shaded terrain painted once per world, with live markers
// for the fortress, the builder, villages, ruins, the Citadel and the planned route.
import { B } from './blocks';
import { errands, hasOfficer } from './company';
import type { Game } from './game';
import { tr } from './i18n';
import { makeCanvas } from './textures';
import { SEA, WX, WZ, type Terrain } from './terrain';

function clampX(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The map is painted in tiles of TILE blocks, S blocks to a pixel, as the view first needs them. */
const TILE = 256;
const S = 4;
const TP = TILE / S;
const cache = new WeakMap<Terrain, Map<number, HTMLCanvasElement>>();

/** The great landmarks' ground on the map. */
const MARKS = new Map<number, [number, number, number]>([
  [B.SNOW, [240, 246, 252]], [B.STONE, [136, 136, 142]], [B.PACKED_ICE, [150, 196, 240]], [B.BLUE_ICE, [96, 160, 238]],
  [B.ASH, [108, 104, 106]], [B.BASALT, [62, 60, 66]], [B.BLACKSTONE, [40, 36, 42]], [B.MAGMA, [214, 92, 30]],
]);

/** Map colour of a column (by its region and biome) before relief shading. */
export function mapColor(T: Terrain, x: number, z: number, v: number, slope: number): [number, number, number] {
  const mark = T.landmarkGround(x, z, v, slope > 1.2);
  if (mark) {
    if (T.lavaLevel(x, z, v) >= v) return [255, 120, 30];
    return MARKS.get(mark.top) ?? [232, 238, 244];
  }
  if (T.blackWater(x, z) && v < SEA) return [20, 34, 32];
  const info = T.column(x, z, v, slope * 2);
  if (v < SEA) return info.zone === 'snow' ? [170, 196, 226] : info.zone === 'swamp' ? [52, 84, 70] : info.zone === 'ember' ? [226, 92, 30] : [52, 96, 178];
  const plain = info.biome !== 'peak' && info.biome !== 'river' && info.biome !== 'beach';
  if (info.zone === 'desert' && plain) return slope > 0.7 ? [168, 104, 70] : [222, 202, 140];
  if (info.zone === 'snow' && info.biome !== 'river' && info.biome !== 'beach') return slope > 0.8 ? [140, 140, 146] : [232, 238, 244];
  if (info.zone === 'blight' && plain) return slope > 0.7 ? [110, 104, 112] : [96, 78, 108];
  if (info.zone === 'swamp' && plain) return slope > 0.7 ? [86, 92, 70] : [72, 102, 52];
  if (info.zone === 'badlands' && plain) return slope > 0.6 ? [176, 90, 46] : [196, 116, 62];
  if (info.zone === 'ember' && plain) return slope > 0.7 ? [58, 54, 62] : [92, 86, 88];
  switch (info.biome) {
    case 'beach':
    case 'river':
      return [214, 198, 140];
    case 'peak':
      return [236, 242, 248];
    case 'mountain':
      return slope > 0.7 ? [128, 126, 124] : [96, 128, 78];
    case 'taiga':
      return [56, 96, 70];
    case 'forest':
      return [64, 118, 46];
    case 'birch':
      return [112, 150, 70];
    default:
      return [118, 168, 72];
  }
}

function paintTile(T: Terrain, ti: number, tj: number): HTMLCanvasElement {
  const canvas = makeCanvas(TP, TP);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TP, TP);
  const N = TP + 1;
  const h = new Float32Array(N * N);
  const x0 = ti * TILE;
  const z0 = tj * TILE;
  for (let j = 0; j < N; j += 1) for (let i = 0; i < N; i += 1) h[j * N + i] = T.height(x0 + i * S + S / 2, z0 + j * S + S / 2);
  for (let j = 0; j < TP; j += 1) {
    for (let i = 0; i < TP; i += 1) {
      const v = h[j * N + i]!;
      const hx = h[j * N + i + 1]! - v;
      const hz = h[(j + 1) * N + i]! - v;
      const slope = Math.hypot(hx, hz) / S;
      const c = mapColor(T, x0 + i * S, z0 + j * S, v, slope);
      const shade = Math.max(0.55, Math.min(1.3, 1 - (hx + hz) * 0.09));
      const o = (j * TP + i) * 4;
      img.data[o] = Math.min(255, c[0] * shade);
      img.data[o + 1] = Math.min(255, c[1] * shade);
      img.data[o + 2] = Math.min(255, c[2] * shade);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** One painted tile of the world map (painted the first time it is wanted). */
function mapTile(T: Terrain, ti: number, tj: number): HTMLCanvasElement {
  let tiles = cache.get(T);
  if (!tiles) {
    tiles = new Map();
    cache.set(T, tiles);
  }
  const key = tj * 4096 + ti;
  let c = tiles.get(key);
  if (!c) {
    c = paintTile(T, ti, tj);
    tiles.set(key, c);
  }
  return c;
}

/** Paints the map of the world around a point ahead of time (a few tiles; the rest as needed). */
export function warmMap(T: Terrain, x: number, z: number): void {
  const ti = Math.floor(x / TILE);
  const tj = Math.floor(z / TILE);
  for (let dj = -1; dj <= 1; dj += 1) {
    for (let di = -1; di <= 2; di += 1) {
      const i = ti + di;
      const j = tj + dj;
      if (i >= 0 && j >= 0 && i * TILE < WX && j * TILE < WZ) mapTile(T, i, j);
    }
  }
}

/** Where the map's window sits: its middle and how wide it is, in blocks (null: on the fortress). */
export interface MapLook {
  x: number;
  z: number;
  span: number;
}

export const MAP_SPANS = { min: 220, max: 1800 } as const;

/** The part of the world a map canvas shows: the valley band around the fortress, or where you dragged it. */
export function mapView(g: Game, W: number, H: number, look: MapLook | null = null): { x0: number; z0: number; k: number } {
  const T = g.world.terrain;
  const fc = g.fortressCentre();
  const span = look?.span ?? 760;
  const spanZ = (span * H) / W;
  const cx = look?.x ?? fc[0] + span * 0.15;
  const cz = look?.z ?? T.centerZ(fc[0]);
  const x0 = Math.max(0, Math.min(Math.max(0, WX - span), cx - span / 2));
  const z0 = Math.max(0, Math.min(Math.max(0, WZ - spanZ), cz - spanZ / 2));
  return { x0, z0, k: W / span };
}

/** Draws the map with live markers into a canvas of any size (viewed around the action). */
export function drawMap(canvas: HTMLCanvasElement, g: Game, highlight: string | null, look: MapLook | null = null): void {
  const T = g.world.terrain;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const { x0, z0, k } = mapView(g, W, H, look);
  const fc = g.fortressCentre();
  ctx.imageSmoothingEnabled = false;
  const span = W / k;
  const spanZ = (span * H) / W;
  ctx.fillStyle = '#20242a';
  ctx.fillRect(0, 0, W, H);
  for (let tj = Math.max(0, Math.floor(z0 / TILE)); tj * TILE < Math.min(WZ, z0 + spanZ); tj += 1) {
    for (let ti = Math.max(0, Math.floor(x0 / TILE)); ti * TILE < Math.min(WX, x0 + span); ti += 1) {
      // (Overlapping each tile by a hair hides the seams the canvas scaling leaves.)
      ctx.drawImage(mapTile(T, ti, tj), (ti * TILE - x0) * k, (tj * TILE - z0) * k, TILE * k + 1, TILE * k + 1);
    }
  }
  const P = (x: number, z: number): [number, number] => [(x - x0) * k, (z - z0) * k];
  const label = (english: string, x: number, y: number, color: string, size = Math.max(10, Math.round(W / 34))): void => {
    const text = tr(english);
    ctx.font = `bold ${size}px Verdana, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    // (Kept inside the canvas: a name at the edge slides in rather than being cut off.)
    const half = ctx.measureText(text).width / 2 + 3;
    const cx = half * 2 < W ? clampX(x, half, W - half) : x;
    ctx.strokeText(text, cx, y);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, y);
  };
  // The Long March: past the first Heart Seal still standing the land lies under a veil.
  const sealed = T.seals.find((s) => !g.sealsBroken.has(s.index)) ?? null;
  const veil = sealed ? Math.max(0, P(sealed.x, 0)[0]) : W;
  if (veil < W) {
    ctx.fillStyle = 'rgba(8, 12, 20, 0.55)';
    ctx.fillRect(veil, 0, W - veil, H);
  }
  // The valley trail and its waterfalls.
  ctx.strokeStyle = 'rgba(120, 90, 50, 0.85)';
  ctx.lineWidth = Math.max(1.5, k * 6);
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  let started = false;
  for (let x = Math.max(T.startX, Math.floor(x0 / 8) * 8); x <= Math.min(T.endX, x0 + span + 8); x += 8) {
    const [px, pz] = P(x, T.centerZ(x));
    if (!started) ctx.moveTo(px, pz);
    else ctx.lineTo(px, pz);
    started = true;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#e8f4ff';
  for (const f of T.falls) {
    const [px, pz] = P(f.x, f.z);
    if (px > -4 && pz > -4 && px < W + 4 && pz < H + 4) ctx.fillRect(px - 1.5, pz - 1.5, 3, 3);
  }
  // The seals across the valley (a faint scar once broken), and each land's name over its stretch.
  for (const s of T.seals) {
    const [px, pz] = P(s.x, s.z);
    if (px < -40 || px > W + 40) continue;
    const st = g.world.structures.byId.get(`seal${s.index}`);
    const za = P(s.x, st ? st.minZ : s.z - 120)[1];
    const zb = P(s.x, st ? st.maxZ : s.z + 120)[1];
    const broken = g.sealsBroken.has(s.index);
    ctx.strokeStyle = broken ? 'rgba(120, 255, 170, 0.4)' : '#5cff9a';
    ctx.lineWidth = broken ? 1.5 : Math.max(3, k * 4);
    if (broken) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, za);
    ctx.lineTo(px, zb);
    ctx.stroke();
    ctx.setLineDash([]);
    if (broken) continue;
    ctx.fillStyle = '#b8ffd0';
    ctx.strokeStyle = '#0a3a1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, pz - 9);
    ctx.lineTo(px + 5, pz);
    ctx.lineTo(px, pz + 9);
    ctx.lineTo(px - 5, pz);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    label(s.name.toUpperCase(), px, pz + 22, '#9ff0b8', Math.max(9, Math.round(W / 40)));
  }
  if (T.version >= 2) {
    T.regions.forEach((r, i) => {
      const a = Math.max(r.x0, x0);
      const b = Math.min(T.regions[i + 1]?.x0 ?? WX, x0 + span);
      if (b - a < 90) return;
      const locked = sealed !== null && r.x0 > sealed.x;
      label(`${i + 1}. ${r.name.toUpperCase()}${locked ? ' · SEALED' : ''}`, (((a + b) / 2) - x0) * k, Math.max(14, Math.round(W / 26)), locked ? '#9aa4b0' : '#ffe9a8', Math.max(10, Math.round(W / 32)));
    });
  }
  // The crew's course: from the fortress along the rest of the route, and the mark.
  const a = g.autopilot;
  if (a) {
    ctx.strokeStyle = '#ffd23a';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const [sx, sz] = P(fc[0], fc[2]);
    ctx.moveTo(sx, sz);
    for (let i = a.index; i < a.route.length; i += 1) {
      const [px, pz] = P(a.route[i]![0], a.route[i]![1]);
      ctx.lineTo(px, pz);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const [mx, mz] = P(a.x, a.z);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(mx - 6, mz - 6);
    ctx.lineTo(mx + 6, mz + 6);
    ctx.moveTo(mx + 6, mz - 6);
    ctx.lineTo(mx - 6, mz + 6);
    ctx.stroke();
  }
  for (const s of T.sites()) {
    const [px, pz] = P(s.x, s.z);
    if (px < -40 || pz < -40 || px > W + 40 || pz > H + 40) continue;
    const hot = highlight === s.name;
    // (Beyond a standing seal: only a grey mark, the name unknown until the way is open.)
    const hidden = sealed !== null && s.x > sealed.x && s.kind !== 'citadel';
    if (s.kind === 'village') {
      ctx.fillStyle = hot ? '#ffffff' : hidden ? '#8a8f96' : '#ffd23a';
      ctx.fillRect(px - 5, pz - 5, 10, 10);
      ctx.strokeStyle = '#3a2410';
      ctx.lineWidth = 2;
      ctx.strokeRect(px - 5, pz - 5, 10, 10);
      if (!hidden) label(s.name, px, pz - 9, hot ? '#ffffff' : '#ffe9a8');
    } else if (s.kind === 'castle') {
      ctx.fillStyle = hot ? '#ffffff' : hidden ? '#8a8f96' : '#c0a0ff';
      ctx.beginPath();
      ctx.moveTo(px, pz - 7);
      ctx.lineTo(px + 6, pz + 5);
      ctx.lineTo(px - 6, pz + 5);
      ctx.closePath();
      ctx.fill();
      if (!hidden) label(s.name, px, pz - 10, hot ? '#ffffff' : '#e0d0ff');
    } else {
      ctx.fillStyle = '#40ff60';
      ctx.beginPath();
      ctx.arc(px, pz, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0a2a10';
      ctx.lineWidth = 2;
      ctx.stroke();
      label('CITADEL', px, pz - 12, '#a8ffb8');
    }
  }
  // The expeditions: a gold crest while its Strider's crest is out there, grey once it is won.
  for (const e of T.expeditions) {
    const [px, pz] = P(e.x, e.z);
    if (px < -40 || pz < -40 || px > W + 40 || pz > H + 40) continue;
    const won = g.mq.crests.includes(e.index);
    const hidden = sealed !== null && e.x > sealed.x;
    const hot = highlight === e.name;
    ctx.fillStyle = hot ? '#ffffff' : won ? '#9a9a9a' : hidden ? '#8a8f96' : '#ffb030';
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - 7, pz - 7);
    ctx.lineTo(px + 7, pz - 7);
    ctx.lineTo(px + 7, pz + 1);
    ctx.lineTo(px, pz + 8);
    ctx.lineTo(px - 7, pz + 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (!hidden) label(e.name, px, pz - 11, hot ? '#ffffff' : won ? '#c8c8c8' : '#ffd890');
  }
  // The lost stashes, once Wren is aboard (a chest; grey when opened).
  if (hasOfficer(g, 'wren')) {
    for (const n of T.nooks) {
      if (n.kind !== 'stash') continue;
      const [px, pz] = P(n.x, n.z);
      if (px < -8 || pz < -8 || px > W + 8 || pz > H + 8) continue;
      if (sealed !== null && n.x > sealed.x) continue;
      const st = g.world.structures.byId.get(`n:${n.id}`);
      const c = st?.chests[0];
      const open = c ? g.world.lootedChests.has(g.world.chestKey(c.x, c.y, c.z)) : false;
      ctx.fillStyle = open ? '#8a8a8a' : '#c88a30';
      ctx.fillRect(px - 5, pz - 4, 10, 8);
      ctx.fillStyle = open ? '#5a5a5a' : '#ffe07a';
      ctx.fillRect(px - 1, pz - 2, 2, 3);
      ctx.strokeStyle = '#2a1a08';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px - 5, pz - 4, 10, 8);
    }
  }
  // Where the errands under way lead: a gold star.
  for (const e of errands(g)) {
    if (!e.target) continue;
    const [px, pz] = P(e.target[0], e.target[2]);
    if (px < -10 || pz < -10 || px > W + 10 || pz > H + 10) continue;
    ctx.fillStyle = '#ffd23a';
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 9 : 4;
      ctx.lineTo(px + Math.cos(a) * r, pz + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Quest camps: a gold diamond while their village still needs help, grey once done.
  for (const camp of T.camps) {
    const [px, pz] = P(camp.x, camp.z);
    if (px < -20 || pz < -20 || px > W + 20 || pz > H + 20) continue;
    const done = g.questState[camp.index] === 'claimed';
    ctx.fillStyle = done ? '#9a9a9a' : '#ffd23a';
    ctx.strokeStyle = '#3a2410';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, pz - 6);
    ctx.lineTo(px + 6, pz);
    ctx.lineTo(px, pz + 6);
    ctx.lineTo(px - 6, pz);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // The fortress (its hull, turned to its heading, with a bow arrow) and you (an arrow).
  const F = g.fortress;
  const [fx, fz] = P(fc[0], fc[2]);
  const hl = Math.max(7, ((F.maxX - F.minX + 1) / 2) * k);
  const hw = Math.max(5, ((F.maxZ - F.minZ + 1) / 2) * k);
  ctx.save();
  ctx.translate(fx, fz);
  ctx.rotate(F.yaw);
  ctx.fillStyle = '#ff5a3a';
  ctx.fillRect(-hl, -hw, hl * 2, hw * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(-hl, -hw, hl * 2, hw * 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(hl + 7, 0);
  ctx.lineTo(hl + 1, -4);
  ctx.lineTo(hl + 1, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const [ux, uz] = P(g.player.x, g.player.z);
  ctx.save();
  ctx.translate(ux, uz);
  ctx.rotate(g.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
