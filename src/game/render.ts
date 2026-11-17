import { swordOf } from './gear';
import { B, I } from './blocks';
import { tiltApply, type BlockBody } from './body';
import type { Game } from './game';
import {
  BRIGHT_FS, COMPOSITE_FS, DEPTH_FS, DEPTH_VS, DOWN_FS, FULLSCREEN_VS, GpuMesh, LOD_FS, MAIN_FS, MAIN_LITE_FS, MAIN_OPAQUE_FS, MAIN_OPAQUE_LITE_FS, MAIN_VS,
  MeshBuilder, Program, RAYS_FS, SKY_FS, UP_FS, WATER_FS,
} from './gl';
import { computeBodyLight, type BodyLight } from './light';
import { buildLodTile, buildLodTrees, LOD_TILE, LOD_TILES_X, LOD_TILES_Z, measureFaceColors, NEAR_COLS, useFaceColors, type LodTile, type LodTrees } from './lod';
import { cross, forward, frustumPlanes, lookDirUp, mat4, multiply, normalize, ortho, perspective, sphereVisible, type Vec3 } from './math3d';
import { copySection, meshBody, meshSection, SECTION_CELLS, sectionEmpty, useLands, type MeshOut } from './mesher';
import { buildDynamic, type DynamicOut } from './dynamic';
import { heldChute, heldHen, heldItem, mySkin } from './models';
import { bodyShown, fromShoulder } from './perspective';
import { clamp, mulberry32 } from './rng';
import { applyWeather, environment, type Env } from './sky';
import type { Terrain } from './terrain';
import { buildSkinAtlas, colorMips, layerCount, layerOf, layerTable, materialMips, MIP_LEVELS, SKIN_H, SKIN_W, TEX } from './textures';
import { CHUNKS_X, CHUNKS_Z, CS, SECTIONS, sectionKey, WX, WY, WZ, type World } from './world';

/** View distance options (chunks of real blocks before the distant terrain takes over). */
export const VIEW_RADII = [5, 7, 10];
/** ULTRA: everything. HIGH: no MSAA. FAST: no shadows, rays or normal maps, lower resolution. */
export type Quality = 'ultra' | 'high' | 'fast';
const QUALITY_KEY = 'block-fortress-graphics-v2';
const VIEW_KEY = 'block-fortress-view-v1';
const FPS_KEY = 'block-fortress-fps-v1';
/** The tier the frame-time watchdog had to step down to (kept while the player has not picked one). */
const AUTO_KEY = 'block-fortress-graphics-auto-v1';
const RANK: Record<Quality, number> = { fast: 0, high: 1, ultra: 2 };
/** Phone and tablet GPUs of old enough a family to need every pixel saved. */
const WEAK_GPU = /Mali-(T\d|G[0-5]\d\b)|Adreno \(TM\) ([1-5]\d\d|6[0-2]\d)\b|PowerVR/i;
/** gl.DEPTH_ATTACHMENT and gl.COLOR_ATTACHMENT0, for invalidateFramebuffer. */
const DEPTH_ONLY = [0x8d00];
const COLOR_ONLY = [0x8ce0];

interface SectionMesh {
  key: number;
  sx: number;
  sy: number;
  sz: number;
  x: number;
  y: number;
  z: number;
  opaque: GpuMesh | null;
  cutout: GpuMesh | null;
  water: GpuMesh | null;
  dirty: boolean;
  /** Which copy of it was last sent to be meshed (a reply for an older one is out of date). */
  ver: number;
  /** Its distance from the eye this frame (for drawing near to far). */
  d: number;
}

/** A section meshed by the mesh worker (see mesh-worker.ts); they come back a chunk at a time. */
interface MeshReply {
  key: number;
  ver: number;
  ov: Uint8Array;
  oi: Uint32Array;
  cv: Uint8Array;
  ci: Uint32Array;
  wv: Uint8Array;
  wi: Uint32Array;
  /** The copy's own arrays, sent back to be used again. */
  ids: Uint8Array;
  sky: Uint8Array;
  blk: Uint8Array;
  meta: Int8Array;
}

interface BodyEntry {
  out: { opaque: GpuMesh; cutout: GpuMesh };
  version: number;
  light: BodyLight;
}

interface LodGpu {
  x: number;
  z: number;
  minY: number;
  maxY: number;
  /** Blocks to a side of its columns. */
  cols: number;
  ground: GpuMesh;
  water: GpuMesh | null;
  /** Its stand-in trees, kept while the view is near enough to show them (null: none there). */
  trees: GpuMesh | null;
  treesBuilt: boolean;
}

/** A tile built by the distant terrain's worker (see lod-worker.ts). */
interface LodReply {
  type: 'land' | 'trees';
  ti: number;
  tj: number;
  cols?: number;
  minY: number;
  maxY: number;
  gv: Uint8Array;
  gi: Uint32Array;
  wv?: Uint8Array;
  wi?: Uint32Array;
}

/** Tiles on their way from the worker at once (few, so the order keeps up with the view). */
const LOD_IN_FLIGHT = 3;
/** Sections out with the mesh worker at once: enough to keep it busy, few enough that an edit sent
 * after them (a block mined) comes back within a frame or two. */
const MESH_IN_FLIGHT = 10;

interface PointLight {
  p: Vec3;
  r: number;
  c: Vec3;
  /** A light on a moving body: that body already carries it in its own light field. */
  body?: boolean;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

/** Optional per-pass GPU timings (EXT_disjoint_timer_query_webgl2), for tuning only. */
class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: Array<{ name: string; q: WebGLQuery }> = [];
  private current: { name: string; q: WebGLQuery } | null = null;
  readonly ms = new Map<string, number>();

  constructor(gl: WebGL2RenderingContext, enabled: boolean) {
    this.gl = gl;
    this.ext = enabled ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
  }

  begin(name: string): void {
    if (!this.ext) return;
    this.end();
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.current = { name, q };
  }

  end(): void {
    if (!this.ext || !this.current) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.current);
    this.current = null;
  }

  collect(): void {
    if (!this.ext) return;
    const gl = this.gl;
    this.pending = this.pending.filter((p) => {
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) return true;
      const ns = Number(gl.getQueryParameter(p.q, gl.QUERY_RESULT));
      const prev = this.ms.get(p.name) ?? ns / 1e6;
      this.ms.set(p.name, prev * 0.8 + (ns / 1e6) * 0.2);
      gl.deleteQuery(p.q);
      return false;
    });
  }
}

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const rot3 = new Float32Array(9);
/** A chunk and its four sides, as dx, dz pairs. */
const SELF_AND_SIDES = [0, 0, 1, 0, -1, 0, 0, 1, 0, -1];
/** setLights' uniform arrays (8 lights). */
const lightPos = new Float32Array(32);
const lightColor = new Float32Array(24);

/** Sets the model transform of a body (turn about its pivot) or the identity for the world. */
function setModel(p: Program, body: BlockBody | null, jitter = 0): void {
  if (!body) {
    p.m3('uRot', IDENTITY3);
    p.f3('uOffset', [0, 0, 0]);
    return;
  }
  const c = body.c;
  const s = body.s;
  // (Scaled about the pivot and the base when the body is drawn smaller than it is.)
  const k = body.drawScale;
  rot3[0] = c * k;
  rot3[1] = 0;
  rot3[2] = s * k;
  rot3[3] = 0;
  rot3[4] = k;
  rot3[5] = 0;
  rot3[6] = -s * k;
  rot3[7] = 0;
  rot3[8] = c * k;
  // world = R * L + O + P - R * P (plus a drawn-only nudge: a giant rearing back, then lunging).
  const ox = body.x + body.px - k * (c * body.px - s * body.pz) + jitter + body.nudge[0];
  const oz = body.z + body.pz - k * (s * body.px + c * body.pz) + body.nudge[2];
  const oy = body.y + body.nudge[1];
  const up = body.tilt;
  if (up[1] >= 0.99999) {
    p.m3('uRot', rot3);
    p.f3('uOffset', [ox, oy, oz]);
    return;
  }
  // Leaning (a load on the crane): turned about its hook, T * (R * L + O - Q) + Q.
  const q = body.tiltAt;
  for (let col = 0; col < 3; col += 1) {
    const v = tiltApply(up, [rot3[col * 3]!, rot3[col * 3 + 1]!, rot3[col * 3 + 2]!]);
    tilt3[col * 3] = v[0];
    tilt3[col * 3 + 1] = v[1];
    tilt3[col * 3 + 2] = v[2];
  }
  p.m3('uRot', tilt3);
  const o = tiltApply(up, [ox - q[0], oy - q[1], oz - q[2]]);
  p.f3('uOffset', [o[0] + q[0], o[1] + q[1], o[2] + q[2]]);
}

const tilt3 = new Float32Array(9);

function smooth(e0: number, e1: number, v: number): number {
  const t = clamp((v - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A chunk whose ground is not known yet: nothing is culled under it. */
const NO_FLOOR = -1;

/** The lowest top of ground in a chunk and the four beside it. */
function chunkFloor(w: World, cx: number, cz: number): number {
  let low = NO_FLOOR;
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = cx + dx;
    const z = cz + dz;
    if (x < 0 || z < 0 || x >= CHUNKS_X || z >= CHUNKS_Z) continue;
    const top = w.chunks[z * CHUNKS_X + x]?.top;
    if (!top) return NO_FLOOR;
    for (let i = 0; i < top.length; i += 1) if (top[i]! < low) low = top[i]!;
  }
  return low;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private main!: Program;
  private opaque!: Program;
  private water!: Program;
  private depth!: Program;
  private sky!: Program;
  private lod!: Program;
  private bright!: Program;
  private down!: Program;
  private up!: Program;
  private rays!: Program;
  private composite!: Program;
  private emptyVao!: WebGLVertexArrayObject;
  private blocksTex!: WebGLTexture;
  private materialsTex!: WebGLTexture;
  private skinsTex!: WebGLTexture;
  private noiseTex!: WebGLTexture;
  private meshedTex!: WebGLTexture;
  private readonly meshedMap = new Uint8Array(CHUNKS_X * CHUNKS_Z);
  private meshedDirty = true;
  private shadowTex: WebGLTexture | null = null;
  private shadowFbo: WebGLFramebuffer | null = null;
  private shadowSize = 2048;
  private shadowTexSize = 0;
  private hdr = false;
  private colorFormat = 0;
  private scene: Target | null = null;
  private sceneDepth: WebGLRenderbuffer | null = null;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColor: WebGLRenderbuffer | null = null;
  private msaaDepth: WebGLRenderbuffer | null = null;
  private depthTex: WebGLTexture | null = null;
  private depthFbo: WebGLFramebuffer | null = null;
  private bloom: Target[] = [];
  private raysT: Target | null = null;
  /** Software path: the graded image at scene resolution, blitted up to the canvas. */
  private ldrT: Target | null = null;
  private targetW = 0;
  private targetH = 0;
  private targetSamples = -1;
  private anisotropy = 0;
  private maxSamples = 0;
  /** Software rasterisers (CI, GPU-less machines) run the cheapest settings. */
  software = false;
  /** The GPU's own name (WEBGL_debug_renderer_info): old phone GPUs get the fewest pixels. */
  gpuName = '';
  /** Touch-first device: no MSAA, smaller shadow map by default. */
  mobile = false;
  /**
   * FAST on a GPU with room to spare (anything but a software rasteriser or an old phone GPU): the
   * fortress, giants, the crane's load and the creatures cast sun shadows (the terrain does not, the
   * expensive part of a shadow pass), and blocks keep their normal maps.
   */
  private get fastPlus(): boolean {
    return this.quality === 'fast' && !this.plainFast && !this.software && !WEAK_GPU.test(this.gpuName);
  }

  /** The watchdog found even FAST's extras too much here: plain FAST from now on (remembered). */
  private plainFast = false;
  dpr = 1;
  cssW = 1;
  cssH = 1;
  devW = 1;
  devH = 1;
  /** Index into VIEW_RADII. */
  zoom = 1;
  quality: Quality = 'high';
  /** Whether the player picked the tier themselves (the watchdog's step-downs are then not kept). */
  private picked = false;
  private renderScale = 1;
  private maxScale = 1;
  private minScale = 0.5;
  private screenW = 1;
  private screenH = 1;
  /** Most frames a second this device is asked for (phones can settle for 30 to run cooler). */
  fpsCap = 60;
  private readonly proj = mat4();
  private readonly handProj = mat4();
  private readonly view = mat4();
  private readonly viewProj = mat4();
  private readonly shadowView = mat4();
  private readonly shadowProj = mat4();
  private readonly shadowVP = mat4();
  private planes: Float32Array = new Float32Array(24);
  private vfov = 1.2;
  private aspect = 1;
  private near = 0.05;
  private far = 900;
  private readonly sections = new Map<number, SectionMesh>();
  /** The lowest ground in each meshed chunk and the four round it: whatever is below cannot be seen from the open air. */
  private readonly floors = new Int16Array(CHUNKS_X * CHUNKS_Z);
  private readonly bodies = new Map<BlockBody, BodyEntry>();
  private lodTiles: LodGpu[] = [];
  /** Built distant-terrain tiles by index (tj * LOD_TILES_X + ti); built lazily, nearest first. */
  private readonly lodMap = new Map<number, LodGpu>();
  private lodWorker: Worker | null = null;
  /** Requests out with the worker (see updateLod's keys). */
  private readonly lodWaiting = new Set<number>();
  /** Distant-terrain work still to do (tiles, steps, trees) as of the last update. */
  private lodPending = 0;
  /**
   * Where the distant terrain was last looked over, the frames since, and whether to look again at
   * once (a tile came back: more can be asked for). Looking over every tile is not done each frame.
   */
  private lodScanX = Number.NaN;
  private lodScanZ = Number.NaN;
  private lodScanAge = 0;
  private lodScanSoon = true;
  /** Ground streaming in is meshed by this worker (null: on this thread). */
  private meshWorker: Worker | null = null;
  /** Sections out with it: key → the version of the copy sent. */
  private readonly meshOut = new Map<number, number>();
  /** Chunk columns coming in through it: chunk index → the sections still to come back. */
  private readonly chunkOut = new Map<number, Set<number>>();
  private meshVer = 0;
  /** Arrays for copying sections out to the worker (they come back with its replies). */
  private readonly meshPool: Array<{ ids: Uint8Array; sky: Uint8Array; blk: Uint8Array; meta: Int8Array }> = [];
  /** Sections meshed on this thread and by the worker (diagnostics). */
  private meshedHere = 0;
  private meshedAway = 0;
  private world: World | null = null;
  private readonly out: MeshOut = { opaque: new MeshBuilder(16384), cutout: new MeshBuilder(8192), water: new MeshBuilder(2048) };
  private readonly dynOut: DynamicOut = {
    opaque: new MeshBuilder(8192),
    cutout: new MeshBuilder(1024),
    overlay: new MeshBuilder(1024),
    soft: new MeshBuilder(2048),
  };
  private dyn!: GpuMesh;
  private dynCut!: GpuMesh;
  private overlay!: GpuMesh;
  private soft!: GpuMesh;
  private held!: GpuMesh;
  private readonly heldB = new MeshBuilder(512);
  /** What the held tool was last built from (see drawHand); empty when it must be built again. */
  private heldKey: Array<number | string | undefined> = [];
  private shakeAmt = 0;
  private shadowWait = 0;
  private shadowFresh = false;
  private time = 0;
  eye: Vec3 = [0, 0, 0];
  cam = { f: [1, 0, 0] as Vec3, u: [0, 1, 0] as Vec3, r: [0, 0, 1] as Vec3 };
  private lost = false;
  /** 0..1 through the arm's chop (repeating while you dig or strike): the hand's, and your figure's in third person. */
  swingT = 0;
  private equipT = 0;
  private lastHeld: number | null | undefined = undefined;
  private frameEma = 16;
  private lastFrame = 0;
  private slowMs = 0;
  private quickMs = 0;
  private playMs = 0;
  /** Where the mouse rests over the view (view coordinates), when it is free. */
  hover: { x: number; y: number } | null = null;
  /** Last frame's environment (HUD and audio read it). */
  env: Env = environment(0.4);
  private timer!: GpuTimer;
  /** How far off the distant trees are still drawn (beyond it thick woods are a tint on the hills). */
  private get woodsReach(): number {
    if (this.quality === 'ultra') return Infinity;
    return this.quality === 'fast' ? 240 : this.mobile ? 320 : 520;
  }

  /**
   * How far off (to a tile's middle) the distant terrain's columns are 2 blocks wide; twice as wide
   * out to twice as far, and so on (each about as wide on screen), up to 8 (16 on a phone or FAST).
   */
  private get stepsReach(): number {
    return this.quality === 'fast' ? 160 : this.mobile ? 220 : this.quality === 'ultra' ? 400 : 340;
  }

  private get widestCols(): number {
    return this.quality === 'fast' || this.mobile ? NEAR_COLS * 8 : NEAR_COLS * 4;
  }

  /** Column size of the distant terrain's steps d blocks off (without the worker, the widest). */
  private lodCols(d: number): number {
    const widest = this.widestCols;
    if (!this.lodWorker) return widest;
    let cols = NEAR_COLS;
    for (let r = this.stepsReach; d >= r && cols < widest; r *= 2) cols *= 2;
    return cols;
  }

  /** The blocks' mean colours, which the distant terrain is painted with (measured once). */
  private faceColors: Float32Array | null = null;

  /** Chunk distance of the drawn real blocks. */
  get viewRadius(): number {
    if (this.software) return 3;
    return VIEW_RADII[this.zoom]! - (this.quality === 'fast' ? 1 : 0);
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.sections.clear();
      this.meshOut.clear();
      this.chunkOut.clear();
      // (Every chunk is meshed again: none of the old meshes survived the loss.)
      this.meshedMap.fill(0);
      this.meshedDirty = true;
      this.floors.fill(NO_FLOOR);
      this.bodies.clear();
      this.lodTiles = [];
      this.lodMap.clear();
      this.shadowTex = null;
      this.shadowFbo = null;
      this.scene = null;
      this.targetW = 0;
      this.init();
    });
  }

  init(): void {
    const gl = this.gl;
    const info0 = gl.getExtension('WEBGL_debug_renderer_info');
    const name0 = String(info0 ? gl.getParameter(info0.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    let forced0 = false;
    try {
      forced0 = new URLSearchParams(window.location.search).has('gfx');
    } catch {
      forced0 = false;
    }
    const lite = /swiftshader|llvmpipe|software|basic render/i.test(name0) && !forced0;
    this.main = new Program(gl, MAIN_VS, lite ? MAIN_LITE_FS : MAIN_FS);
    this.opaque = new Program(gl, MAIN_VS, lite ? MAIN_OPAQUE_LITE_FS : MAIN_OPAQUE_FS);
    this.water = new Program(gl, MAIN_VS, WATER_FS);
    this.depth = new Program(gl, DEPTH_VS, DEPTH_FS);
    this.sky = new Program(gl, FULLSCREEN_VS, SKY_FS);
    this.lod = new Program(gl, MAIN_VS, LOD_FS);
    this.bright = new Program(gl, FULLSCREEN_VS, BRIGHT_FS);
    this.down = new Program(gl, FULLSCREEN_VS, DOWN_FS);
    this.up = new Program(gl, FULLSCREEN_VS, UP_FS);
    this.rays = new Program(gl, FULLSCREEN_VS, RAYS_FS);
    this.composite = new Program(gl, FULLSCREEN_VS, COMPOSITE_FS);
    this.emptyVao = gl.createVertexArray()!;
    let timing = false;
    try {
      timing = new URLSearchParams(window.location.search).has('gputime');
    } catch {
      timing = false;
    }
    this.timer = new GpuTimer(gl, timing);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    this.software = /swiftshader|llvmpipe|software|basic render/i.test(rendererName);
    this.gpuName = rendererName;
    this.maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0;
    this.hdr = Boolean(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.colorFormat = this.hdr ? gl.RGBA16F : gl.RGBA8;
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.anisotropy = aniso ? Math.min(8, Number(gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 0) : 0;

    // Block colours: sRGB texture array with hand-built mips (linear-light averaging).
    const layers = layerCount();
    this.blocksTex = this.arrayTexture(gl.SRGB8_ALPHA8, colorMips(), layers);
    this.materialsTex = this.arrayTexture(gl.RGBA8, materialMips(), layers);
    if (aniso && this.anisotropy > 1 && !this.software) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blocksTex);
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.materialsTex);
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy);
    }

    this.skinsTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.skinsTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, SKIN_W, SKIN_H);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SKIN_W, SKIN_H, gl.RGBA, gl.UNSIGNED_BYTE, buildSkinAtlas());
    this.nearest(gl.TEXTURE_2D, false);

    // Tileable value noise for the clouds.
    const N = 256;
    const noise = new Uint8Array(N * N);
    const rng = mulberry32(9137);
    const lattice = new Float32Array(32 * 32).map(() => rng());
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        const fx = (x / N) * 32;
        const fy = (y / N) * 32;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number): number => lattice[(j & 31) * 32 + (i & 31)]!;
        const v = at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy) + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
        noise[y * N + x] = Math.round(v * 255);
      }
    }
    this.noiseTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, N, N);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.UNSIGNED_BYTE, noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // Which chunks are drawn as real blocks (the distant terrain hides itself there).
    this.meshedTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.meshedTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, CHUNKS_X, CHUNKS_Z);
    this.nearest(gl.TEXTURE_2D, false);
    this.meshedDirty = true;

    this.dyn = new GpuMesh(gl);
    this.dynCut = new GpuMesh(gl);
    this.overlay = new GpuMesh(gl);
    this.soft = new GpuMesh(gl);
    this.held = new GpuMesh(gl);
    this.heldKey = [];
    try {
      const saved = window.localStorage.getItem(QUALITY_KEY);
      if (saved === 'ultra' || saved === 'high' || saved === 'fast') {
        this.quality = saved;
        this.picked = true;
      } else {
        this.quality = this.defaultQuality();
        // A machine that could not keep up last time starts where it settled.
        const learned = window.localStorage.getItem(AUTO_KEY);
        if ((learned === 'high' || learned === 'fast') && RANK[learned] < RANK[this.quality]) this.quality = learned;
        if (learned === 'plain') {
          this.quality = 'fast';
          this.plainFast = true;
        }
      }
    } catch {
      this.quality = this.defaultQuality();
    }
    if (this.software) {
      this.quality = 'fast';
      this.zoom = 0;
    }
    // Test override (?gfx=ultra|high|fast): full settings even on a software rasteriser.
    let forced = '';
    try {
      forced = new URLSearchParams(window.location.search).get('gfx') ?? '';
    } catch {
      forced = '';
    }
    if (forced === 'ultra' || forced === 'high' || forced === 'fast') {
      this.software = false;
      this.quality = forced;
      this.zoom = 1;
    }
    // Distant terrain looks after the horizon now: a phone keeps its real blocks close by default,
    // a computer at ULTRA draws them as far as they go.
    try {
      const view = Number(window.localStorage.getItem(VIEW_KEY) ?? (this.mobile ? 0 : this.quality === 'ultra' ? 2 : 1));
      if (!forced && !this.software && (view === 0 || view === 1 || view === 2)) this.zoom = view;
      const fps = Number(window.localStorage.getItem(FPS_KEY));
      if (fps === 30 || fps === 60) this.fpsCap = fps;
    } catch {
      if (this.mobile && !forced) this.zoom = 0;
    }
    this.applyQuality();
  }

  /**
   * The tier a player who has not picked one starts at: a phone or tablet runs FAST (steady frames,
   * a cool battery; HIGH and ULTRA are a tap away in the menu), a computer starts at ULTRA. The
   * frame-time watchdog steps down when frames run long either way, and remembers it.
   */
  private defaultQuality(): Quality {
    if (this.software || this.mobile) return 'fast';
    return 'ultra';
  }

  private arrayTexture(format: number, mips: Uint8Array[], layers: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, MIP_LEVELS, format, TEX, TEX, layers);
    mips.forEach((data, level) => {
      const size = TEX >> level;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, 0, size, size, layers, gl.RGBA, gl.UNSIGNED_BYTE, data);
    });
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, this.software ? gl.NEAREST_MIPMAP_NEAREST : gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  private nearest(target: number, repeat: boolean): void {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  }

  resize(viewportWidth: number, viewportHeight: number, pixelWidth: number, pixelHeight: number, dpr: number): void {
    this.cssW = viewportWidth;
    this.cssH = viewportHeight;
    this.dpr = dpr;
    this.screenW = pixelWidth;
    this.screenH = pixelHeight;
    this.applyQuality();
  }

  setZoom(level: number): void {
    this.zoom = ((level % VIEW_RADII.length) + VIEW_RADII.length) % VIEW_RADII.length;
    this.lodScanSoon = true;
    try {
      window.localStorage.setItem(VIEW_KEY, String(this.zoom));
    } catch {
      // ignore
    }
  }

  setFpsCap(fps: 30 | 60): void {
    this.fpsCap = fps;
    try {
      window.localStorage.setItem(FPS_KEY, String(fps));
    } catch {
      // ignore
    }
  }

  /** Diagnostics for tooling: smoothed frame time and the current render settings. */
  stats(): Record<string, unknown> {
    let tris = 0;
    let bytes = 0;
    for (const s of this.sections.values()) {
      for (const m of [s.opaque, s.cutout, s.water]) {
        if (!m) continue;
        tris += m.count / 3;
        bytes += m.bytes;
      }
    }
    let lodBytes = 0;
    let woods = 0;
    let lodTris = 0;
    const cols: Record<number, number> = {};
    for (const t of this.lodTiles) {
      lodBytes += t.ground.bytes + (t.water?.bytes ?? 0) + (t.trees?.bytes ?? 0);
      if (t.trees) woods += 1;
      cols[t.cols] = (cols[t.cols] ?? 0) + 1;
      // (What a frame draws of it: the tiles in view, their trees while near enough.)
      if (this.lodTileVisible(t)) lodTris += (t.ground.count + (t.trees && Math.hypot(t.x + LOD_TILE / 2 - this.eye[0], t.z + LOD_TILE / 2 - this.eye[2]) < this.woodsReach ? t.trees.count : 0)) / 3;
    }
    return {
      frameMs: Math.round(this.frameEma * 10) / 10, scale: this.renderScale, quality: this.quality, fastPlus: this.fastPlus, software: this.software, hdr: this.hdr,
      shadowSize: this.shadowSize, sections: this.sections.size, tris: Math.round(tris), meshMB: Math.round(bytes / 1e5) / 10, view: this.viewRadius,
      lod: { tiles: this.lodTiles.length, cols, woods, tris: Math.round(lodTris), MB: Math.round(lodBytes / 1e5) / 10, worker: this.lodWorker !== null, waiting: this.lodWaiting.size, pending: this.lodPending },
      fpsCap: this.fpsCap, canvas: [this.canvas.width, this.canvas.height], zoom: this.zoom, mobile: this.mobile, gpuName: this.gpuName,
      meshing: { here: this.meshedHere, worker: this.meshedAway, out: this.meshOut.size, chunks: this.chunkOut.size, on: this.meshWorker !== null },
      gpu: Object.fromEntries([...this.timer.ms.entries()].map(([k, v]) => [k, Math.round(v * 10) / 10])),
    };
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.picked = true;
    // (A tier chosen by hand starts with all it offers; the watchdog may still trim it.)
    this.plainFast = false;
    try {
      window.localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      // ignore
    }
    this.applyQuality();
  }

  /** Scene resolution cap: about 2 device pixels per CSS pixel (1.5 HIGH, 1 FAST, a little more on a current phone, less on software GL). */
  private applyQuality(): void {
    const fast = this.mobile && !WEAK_GPU.test(this.gpuName) ? 1.25 : 1;
    const cap = this.software ? 0.42 : this.quality === 'fast' ? fast : this.quality === 'high' ? 1.5 : 2;
    const fit = Math.min(1, cap / Math.max(1, this.dpr));
    // A phone's canvas is only as big as the picture it will hold: no full-size final pass, no
    // full-size frame buffers in memory. Everywhere else the picture is scaled up inside it.
    const k = this.mobile ? fit : 1;
    const w = Math.max(1, Math.round(this.screenW * k));
    const h = Math.max(1, Math.round(this.screenH * k));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.devW = w;
    this.devH = h;
    this.maxScale = this.mobile ? 1 : fit;
    // (Never softer than most of a pixel per CSS pixel.)
    this.minScale = Math.min(this.maxScale, Math.max(0.5, (0.8 * this.cssW) / w));
    this.renderScale = this.maxScale;
    this.shadowSize = this.software || this.mobile ? 1024 : this.quality === 'ultra' ? 2048 : 1536;
    // (The distant terrain's steps and trees reach as far as the tier says.)
    this.lodScanSoon = true;
    this.slowMs = 0;
    this.quickMs = 0;
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.4, Math.max(this.shakeAmt, amount));
  }

  /** Whether a sphere is inside the camera's view (as of the last updateCamera). */
  inView(x: number, y: number, z: number, r: number): boolean {
    return sphereVisible(this.planes, x, y, z, r);
  }

  /** Ray from the eye through a point of the view (touch/mouse targeting; view coordinates, see view.ts). */
  screenRay(x: number, y: number, game: Game): { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number } {
    const nx = (x / Math.max(1, this.cssW)) * 2 - 1;
    const ny = 1 - (y / Math.max(1, this.cssH)) * 2;
    const tanY = Math.tan(this.vfov / 2);
    const tanX = tanY * this.aspect;
    const f = forward(game.yaw, game.pitch);
    const r = normalize(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    const d = normalize([f[0] + r[0] * nx * tanX + u[0] * ny * tanY, f[1] + r[1] * nx * tanX + u[1] * ny * tanY, f[2] + r[2] * nx * tanX + u[2] * ny * tanY]);
    const [ox, oy, oz] = game.eye();
    return fromShoulder(game, { ox, oy, oz, dx: d[0], dy: d[1], dz: d[2] });
  }

  /** Projects a world point to client coordinates (null when behind the camera). */
  project(p: Vec3): { x: number; y: number } | null {
    const m = this.viewProj;
    const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
    const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
    const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
    if (w <= 0.01) return null;
    return { x: ((x / w) * 0.5 + 0.5) * this.cssW, y: (1 - ((y / w) * 0.5 + 0.5)) * this.cssH };
  }

  updateCamera(dt: number, game: Game): void {
    this.time += dt;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    const s = this.shakeAmt * this.shakeAmt * 0.12;
    const e = game.eye();
    this.eye = [e[0] + (Math.random() - 0.5) * s, e[1] + (Math.random() - 0.5) * s, e[2] + (Math.random() - 0.5) * s];
    // Recoil kicks the view up a touch; a blow rolls it, and the helm view leans out of turns.
    const f = forward(game.yaw, game.pitch + game.viewKick);
    const flat = normalize(cross(f, [0, 1, 0]));
    const level = cross(flat, f);
    const roll = game.hurtTilt - game.turnRate * 0.14 * game.camPull + game.chuteRoll;
    const up: Vec3 = Math.abs(roll) < 1e-4 ? [0, 1, 0] : normalize([
      level[0] * Math.cos(roll) + flat[0] * Math.sin(roll),
      level[1] * Math.cos(roll) + flat[1] * Math.sin(roll),
      level[2] * Math.cos(roll) + flat[2] * Math.sin(roll),
    ]);
    lookDirUp(this.view, this.eye, f, up);
    this.aspect = this.devW / Math.max(1, this.devH);
    // Portrait screens keep a ~70 degree horizontal view; the vertical one grows (capped).
    this.vfov = clamp(2 * Math.atan(Math.tan((74 * Math.PI) / 360) / this.aspect), (58 * Math.PI) / 180, (98 * Math.PI) / 180) * game.fov;
    this.near = 0.05;
    this.far = 1100;
    perspective(this.proj, this.vfov, this.aspect, this.near, this.far);
    const handFov = this.aspect >= 1 ? (70 * Math.PI) / 180 : 2 * Math.atan(Math.tan((35 * Math.PI) / 180) / this.aspect);
    perspective(this.handProj, handFov, this.aspect, 0.02, 10);
    if (this.aspect < 1) this.handProj[9] = Math.min(0.25, (1 / this.aspect - 1) * 0.15);
    multiply(this.viewProj, this.proj, this.view);
    this.planes = frustumPlanes(this.viewProj);
    const r = normalize(cross(f, up));
    this.cam = { f, r, u: cross(r, f) };
    if (game.mining.swing > 0 || this.swingT > 0) {
      this.swingT += dt * 3.4;
      if (this.swingT >= 1) this.swingT = game.mining.swing > 0 ? this.swingT - 1 : 0;
    }
    // (A hen in your arms, or both hands on the parachute's toggles, count as something held.)
    const held = game.carried ? -1 : game.player.chute > 0 ? -2 : game.heldItem();
    if (held !== this.lastHeld) {
      if (this.lastHeld !== undefined) this.equipT = 1;
      this.lastHeld = held;
    }
    this.equipT = Math.max(0, this.equipT - dt * 4);
  }

  // ------------------------------------------------------------------ world & distant terrain

  /** Binds a new world: drops every cached mesh and builds the distant terrain. */
  setWorld(world: World): void {
    for (const s of this.sections.values()) this.disposeSection(s);
    this.sections.clear();
    for (const b of this.bodies.values()) {
      b.out.opaque.dispose();
      b.out.cutout.dispose();
    }
    this.bodies.clear();
    for (const t of this.lodTiles) this.disposeLod(t);
    this.lodTiles = [];
    this.lodMap.clear();
    this.world = world;
    this.floors.fill(NO_FLOOR);
    this.meshedMap.fill(0);
    this.meshedDirty = true;
    useLands(world.terrain);
    this.startLodWorker(world.terrain);
    this.startMeshWorker(world.terrain);
  }

  /** Meshes ground streaming in off this thread from now on (this thread does it without one). */
  private startMeshWorker(t: Terrain): void {
    this.meshWorker?.terminate();
    this.meshWorker = null;
    this.meshOut.clear();
    this.chunkOut.clear();
    try {
      const worker = new Worker(new URL('./mesh-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<MeshReply[]>) => {
        if (worker !== this.meshWorker) return;
        for (const m of e.data) {
          this.meshArrived(m);
          if (this.meshPool.length < MESH_IN_FLIGHT * 2 && m.ids.length === SECTION_CELLS) this.meshPool.push({ ids: m.ids, sky: m.sky, blk: m.blk, meta: m.meta });
        }
      };
      worker.onerror = () => {
        if (worker !== this.meshWorker) return;
        // (Whatever was out with it is meshed here instead.)
        this.meshWorker = null;
        for (const key of this.meshOut.keys()) {
          const s = this.sections.get(key);
          if (s) s.dirty = true;
        }
        this.meshOut.clear();
        this.chunkOut.clear();
      };
      worker.postMessage({ type: 'init', seed: t.seed, version: t.version, layers: layerTable() });
      this.meshWorker = worker;
    } catch {
      this.meshWorker = null;
    }
  }

  /** A section back from the mesh worker: uploaded (unless it changed again since), and its chunk shown once all of it is in. */
  private meshArrived(m: MeshReply): void {
    if (this.meshOut.get(m.key) === m.ver) this.meshOut.delete(m.key);
    const s = this.sections.get(m.key);
    if (!s || s.ver !== m.ver || this.lost) return;
    s.opaque = this.storeBytes(s.opaque, m.ov, m.oi);
    s.cutout = this.storeBytes(s.cutout, m.cv, m.ci);
    s.water = this.storeBytes(s.water, m.wv, m.wi);
    const ci = s.sz * CHUNKS_X + s.sx;
    const left = this.chunkOut.get(ci);
    if (!left) return;
    left.delete(m.key);
    if (left.size === 0) {
      this.chunkOut.delete(ci);
      if (this.world) this.chunkMeshed(this.world, s.sx, s.sz);
    }
  }

  /** A chunk column is meshed: its ground bounds what is drawn, and the distant terrain gives way to it. */
  private chunkMeshed(w: World, cx: number, cz: number): void {
    // (Its ground also bounds the four beside it, which may have been meshed before it came in.)
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = cx + dx;
      const z = cz + dz;
      if (x >= 0 && z >= 0 && x < CHUNKS_X && z < CHUNKS_Z) this.floors[z * CHUNKS_X + x] = chunkFloor(w, x, z);
    }
    const ci = cz * CHUNKS_X + cx;
    if (!this.meshedMap[ci]) {
      this.meshedMap[ci] = 255;
      this.meshedDirty = true;
    }
  }

  /** Sends a chunk's sections to the mesh worker in one message (each is drawn as it was until it comes back). */
  private postSections(w: World, list: SectionMesh[]): void {
    const items = [];
    const buffers: ArrayBuffer[] = [];
    for (const s of list) {
      this.meshVer += 1;
      s.ver = this.meshVer;
      const c = copySection(w, s.sx, s.sy, s.sz, this.meshPool.pop());
      this.meshOut.set(s.key, s.ver);
      this.meshedAway += 1;
      items.push({ key: s.key, ver: s.ver, ...c });
      buffers.push(c.ids.buffer as ArrayBuffer, c.sky.buffer as ArrayBuffer, c.blk.buffer as ArrayBuffer, c.meta.buffer as ArrayBuffer);
    }
    this.meshWorker!.postMessage({ type: 'mesh', items }, buffers);
  }

  /** Builds the distant terrain in the background from now on (the main thread does it without one). */
  private startLodWorker(t: Terrain): void {
    this.lodWorker?.terminate();
    this.lodWorker = null;
    this.lodWaiting.clear();
    if (this.software) return;
    this.faceColors ??= measureFaceColors();
    useFaceColors(this.faceColors);
    try {
      const worker = new Worker(new URL('./lod-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<LodReply>) => {
        if (worker === this.lodWorker) this.lodArrived(e.data);
      };
      worker.onerror = () => {
        if (worker !== this.lodWorker) return;
        this.lodWorker = null;
        this.lodWaiting.clear();
      };
      const layers = ['white', 'water_flow'].map((name) => [name, layerOf(name)]);
      worker.postMessage({ type: 'init', seed: t.seed, version: t.version, layers, colors: this.faceColors });
      this.lodWorker = worker;
    } catch {
      this.lodWorker = null;
    }
  }

  private lodArrived(m: LodReply): void {
    this.lodScanSoon = true;
    const i = m.tj * LOD_TILES_X + m.ti;
    this.lodWaiting.delete(i * 2 + (m.type === 'trees' ? 1 : 0));
    if (this.lost) return;
    if (m.type === 'land') {
      const have = this.lodMap.get(i);
      const cols = m.cols ?? this.widestCols;
      if (have && have.cols === cols) return;
      const ground = new GpuMesh(this.gl);
      ground.uploadBytes(m.gv, m.gi);
      let water: GpuMesh | null = null;
      if (m.wi && m.wv && m.wi.length > 0) {
        water = new GpuMesh(this.gl);
        water.uploadBytes(m.wv, m.wi);
      }
      // (A tile changing its column size keeps its trees.)
      if (have) {
        have.ground.dispose();
        have.water?.dispose();
        have.ground = ground;
        have.water = water;
        have.cols = cols;
        have.minY = m.minY;
        have.maxY = Math.max(m.maxY, have.trees ? have.maxY : -Infinity);
        return;
      }
      this.lodMap.set(i, { x: m.ti * LOD_TILE, z: m.tj * LOD_TILE, minY: m.minY, maxY: m.maxY, cols, ground, water, trees: null, treesBuilt: false });
      this.lodTiles = [...this.lodMap.values()];
      return;
    }
    const t = this.lodMap.get(i);
    if (!t || t.treesBuilt) return;
    t.treesBuilt = true;
    if (m.gi.length === 0) return;
    t.trees = new GpuMesh(this.gl);
    t.trees.uploadBytes(m.gv, m.gi);
    t.maxY = Math.max(t.maxY, m.maxY);
  }

  private disposeLod(t: LodGpu): void {
    t.ground.dispose();
    t.water?.dispose();
    t.trees?.dispose();
  }

  private uploadLod(tile: LodTile): LodGpu {
    const gl = this.gl;
    const ground = new GpuMesh(gl);
    ground.upload(tile.ground);
    let water: GpuMesh | null = null;
    if (tile.water.count > 0) {
      water = new GpuMesh(gl);
      water.upload(tile.water);
    }
    return { x: tile.x, z: tile.z, minY: tile.minY, maxY: tile.maxY, cols: tile.cols, ground, water, trees: null, treesBuilt: false };
  }

  private uploadTrees(t: LodGpu, trees: LodTrees): void {
    t.treesBuilt = true;
    if (trees.mesh.count === 0) return;
    t.trees = new GpuMesh(this.gl);
    t.trees.upload(trees.mesh);
    t.maxY = Math.max(t.maxY, trees.maxY);
  }

  /**
   * Distant terrain around the camera: tiles within sight are built (nearest and look-ahead
   * first) in columns as wide as their distance asks, their trees while near enough to be drawn,
   * and what falls far behind is let go. The worker builds them in the background; without it (or
   * while loading, `now`) this thread builds the widest columns within a time budget, and the
   * worker (if there is one) brings the finer ones after.
   */
  private updateLod(budgetMs: number, now = false): void {
    const w = this.world;
    if (!w || this.software) return;
    const ex = this.eye[0];
    const ez = this.eye[2];
    // (Looked over again when a tile came back, the eye has gone some way, or every half second;
    // without a worker, every frame while there is work: this thread builds it.)
    this.lodScanAge += 1;
    const moved = Math.hypot(ex - this.lodScanX, ez - this.lodScanZ);
    if (!now && !this.lodScanSoon && !(moved >= 8) && this.lodScanAge < 30 && (this.lodWorker || this.lodPending === 0)) return;
    this.lodScanSoon = false;
    this.lodScanAge = 0;
    this.lodScanX = ex;
    this.lodScanZ = ez;
    const reach = this.far + LOD_TILE;
    const woods = this.woodsReach;
    // (key: tile index * 2, plus 1 for its trees)
    const todo: Array<{ key: number; ti: number; tj: number; d: number; cols: number }> = [];
    let changed = false;
    for (let tj = 0; tj < LOD_TILES_Z; tj += 1) {
      for (let ti = 0; ti < LOD_TILES_X; ti += 1) {
        const i = tj * LOD_TILES_X + ti;
        const dx = ti * LOD_TILE + LOD_TILE / 2 - ex;
        const dz = tj * LOD_TILE + LOD_TILE / 2 - ez;
        const d = Math.hypot(dx, dz);
        const have = this.lodMap.get(i);
        if (have && d > reach + LOD_TILE * 3) {
          this.disposeLod(have);
          this.lodMap.delete(i);
          changed = true;
          continue;
        }
        // (Trees are built a tile ahead of the woods' reach and kept a little past it: no flicker.)
        if (have?.treesBuilt && d > woods + LOD_TILE * 2) {
          have.trees?.dispose();
          have.trees = null;
          have.treesBuilt = false;
        }
        const ahead = (dx * this.cam.f[0] + dz * this.cam.f[2]) / Math.max(1, d);
        const rank = d - ahead * 160;
        // (Finer columns are kept a little past their reach once built: no flicker at the edge.)
        let cols = this.lodCols(d);
        if (have && have.cols < cols) cols = this.lodCols(d - LOD_TILE / 2);
        if (!have) {
          if (d <= reach) todo.push({ key: i * 2, ti, tj, d: rank, cols });
        } else {
          if (have.cols !== cols) todo.push({ key: i * 2, ti, tj, d: rank, cols });
          if (!have.treesBuilt && d < woods + LOD_TILE) todo.push({ key: i * 2 + 1, ti, tj, d: rank, cols });
        }
      }
    }
    todo.sort((a, b) => a.d - b.d);
    this.lodPending = todo.length;
    const start = performance.now();
    for (const t of todo) {
      const i = t.key >> 1;
      const have = this.lodMap.get(i);
      // The worker builds everything it can; this thread only what must show now (the land in its
      // widest columns, and trees).
      if (this.lodWorker && (!now || (have && !(t.key & 1)))) {
        if (this.lodWaiting.size >= LOD_IN_FLIGHT || this.lodWaiting.has(t.key)) continue;
        this.lodWaiting.add(t.key);
        this.lodWorker.postMessage({ type: t.key & 1 ? 'trees' : 'land', ti: t.ti, tj: t.tj, cols: t.cols });
        continue;
      }
      if (performance.now() - start > budgetMs) continue;
      if (t.key & 1) {
        if (have && !have.treesBuilt) this.uploadTrees(have, buildLodTrees(w.terrain, t.ti, t.tj));
      } else if (!have) {
        this.lodMap.set(i, this.uploadLod(buildLodTile(w.terrain, t.ti, t.tj, this.widestCols)));
        changed = true;
      }
    }
    if (changed) this.lodTiles = [...this.lodMap.values()];
  }

  private disposeSection(s: SectionMesh): void {
    s.opaque?.dispose();
    s.cutout?.dispose();
    s.water?.dispose();
  }

  private store(mesh: GpuMesh | null, b: MeshBuilder): GpuMesh | null {
    if (b.count === 0) {
      mesh?.dispose();
      return null;
    }
    const m = mesh ?? new GpuMesh(this.gl);
    m.upload(b);
    return m;
  }

  /** The same from a worker's bytes. */
  private storeBytes(mesh: GpuMesh | null, v: Uint8Array, i: Uint32Array): GpuMesh | null {
    if (i.length === 0) {
      mesh?.dispose();
      return null;
    }
    const m = mesh ?? new GpuMesh(this.gl);
    m.uploadBytes(v, i);
    return m;
  }

  /** Chunk is lit and so are its four neighbours (seams mesh correctly). */
  private chunkReady(w: World, cx: number, cz: number): boolean {
    for (let k = 0; k < 10; k += 2) {
      const x = cx + SELF_AND_SIDES[k]!;
      const z = cz + SELF_AND_SIDES[k + 1]!;
      if (x < 0 || z < 0 || x >= CHUNKS_X || z >= CHUNKS_Z) continue;
      const c = w.chunks[z * CHUNKS_X + x];
      if (!c || !c.lit) return false;
    }
    return true;
  }

  /**
   * Meshes the chunks in range that need it, nearest and look-ahead first: by the mesh worker when
   * there is one (and `sync` is not asked for: the loading screen meshes here, all at once), else
   * here within the budget. A chunk coming in is drawn once all of it is back; a section that
   * changed is drawn as it was until its new mesh comes (a frame or two).
   */
  private updateSections(w: World, budgetMs: number, sync = false): void {
    for (const key of w.dirty) {
      const s = this.sections.get(key);
      if (s) s.dirty = true;
    }
    w.dirty.clear();
    for (const ci of w.dropped) {
      const cx = ci % CHUNKS_X;
      const cz = Math.floor(ci / CHUNKS_X);
      for (let sy = 0; sy < SECTIONS; sy += 1) {
        const key = sectionKey(cx, sy, cz);
        const s = this.sections.get(key);
        if (s) {
          this.disposeSection(s);
          this.sections.delete(key);
        }
      }
      this.chunkOut.delete(ci);
      if (this.meshedMap[ci]) {
        this.meshedMap[ci] = 0;
        this.meshedDirty = true;
      }
    }
    w.dropped.clear();
    const R = this.viewRadius;
    const ecx = Math.floor(this.eye[0] / CS);
    const ecz = Math.floor(this.eye[2] / CS);
    const todo: Array<{ cx: number; cz: number; d: number }> = [];
    for (let dz = -R; dz <= R; dz += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (R + 0.5) * (R + 0.5)) continue;
        const cx = ecx + dx;
        const cz = ecz + dz;
        if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) continue;
        const ci = cz * CHUNKS_X + cx;
        // (A chunk coming in through the worker waits for it.)
        if (this.chunkOut.has(ci)) continue;
        let need = this.meshedMap[ci] === 0;
        if (!need) {
          for (let sy = 0; sy < SECTIONS && !need; sy += 1) if (this.sections.get(sectionKey(cx, sy, cz))?.dirty) need = true;
        }
        if (!need || !this.chunkReady(w, cx, cz)) continue;
        // Look-ahead chunks first, then by distance.
        const ahead = (dx * this.cam.f[0] + dz * this.cam.f[2]) / Math.max(1, Math.sqrt(d2));
        todo.push({ cx, cz, d: d2 - ahead * 3 });
      }
    }
    todo.sort((a, b) => a.d - b.d);
    const start = performance.now();
    const worker = sync ? null : this.meshWorker;
    const fresh = (s: SectionMesh | undefined, key: number, cx: number, sy: number, cz: number): SectionMesh => {
      if (s) return s;
      const n: SectionMesh = { key, sx: cx, sy, sz: cz, x: cx * CS + 8, y: sy * 16 + 8, z: cz * CS + 8, opaque: null, cutout: null, water: null, dirty: true, ver: 0, d: 0 };
      this.sections.set(key, n);
      return n;
    };
    for (const t of todo) {
      const ci = t.cz * CHUNKS_X + t.cx;
      const unmeshed = this.meshedMap[ci] === 0;
      if (worker) {
        // (The chunk goes whole: copying it out is quick. Time and the worker's queue are minded
        // between chunks.)
        if (this.meshOut.size >= MESH_IN_FLIGHT || performance.now() - start > Math.min(budgetMs, 2)) break;
        const sent = new Set<number>();
        const list: SectionMesh[] = [];
        for (let sy = 0; sy < SECTIONS; sy += 1) {
          const key = sectionKey(t.cx, sy, t.cz);
          const was = this.sections.get(key);
          if (was && !was.dirty) continue;
          const s = fresh(was, key, t.cx, sy, t.cz);
          s.dirty = false;
          if (sectionEmpty(w, t.cx, sy, t.cz)) {
            this.disposeSection(s);
            s.opaque = s.cutout = s.water = null;
            this.meshVer += 1;
            s.ver = this.meshVer;
            continue;
          }
          list.push(s);
          sent.add(key);
        }
        if (list.length > 0) this.postSections(w, list);
        if (unmeshed) {
          if (sent.size > 0) this.chunkOut.set(ci, sent);
          else this.chunkMeshed(w, t.cx, t.cz);
        }
        continue;
      }
      let out = false;
      for (let sy = 0; sy < SECTIONS; sy += 1) {
        const key = sectionKey(t.cx, sy, t.cz);
        const was = this.sections.get(key);
        if (was && !was.dirty) continue;
        // Out of time: the rest waits for the next frame (a section at a time, not a whole chunk,
        // so a phone never stalls on one). A chunk shows once all of it is meshed.
        if (performance.now() - start > budgetMs) {
          out = true;
          break;
        }
        const s = fresh(was, key, t.cx, sy, t.cz);
        s.dirty = false;
        this.meshVer += 1;
        s.ver = this.meshVer;
        if (sectionEmpty(w, t.cx, sy, t.cz)) {
          this.disposeSection(s);
          s.opaque = s.cutout = s.water = null;
          continue;
        }
        meshSection(w, t.cx, sy, t.cz, this.out);
        this.meshedHere += 1;
        s.opaque = this.store(s.opaque, this.out.opaque);
        s.cutout = this.store(s.cutout, this.out.cutout);
        s.water = this.store(s.water, this.out.water);
      }
      if (out) break;
      this.chunkMeshed(w, t.cx, t.cz);
    }
    // Forget chunks that fell out of range.
    for (const s of this.sections.values()) {
      if (Math.max(Math.abs(s.sx - ecx), Math.abs(s.sz - ecz)) > R + 2) {
        this.disposeSection(s);
        this.sections.delete(s.key);
        const ci = s.sz * CHUNKS_X + s.sx;
        this.chunkOut.delete(ci);
        if (this.meshedMap[ci]) {
          this.meshedMap[ci] = 0;
          this.meshedDirty = true;
        }
      }
    }
    if (this.meshedDirty) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.meshedTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, CHUNKS_X, CHUNKS_Z, gl.RED, gl.UNSIGNED_BYTE, this.meshedMap);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      this.meshedDirty = false;
    }
  }

  /** Meshes the area around the camera up front (loading screen / new world). */
  prebuild(game: Game, budgetMs = 2500): void {
    this.updateCamera(0, game);
    if (game.world !== this.world) this.setWorld(game.world);
    this.updateSections(game.world, budgetMs, true);
    this.updateLod(budgetMs / 3, true);
  }

  /** Fraction (0..1) of the in-range chunks that are drawn as real blocks. */
  meshedFraction(): number {
    const R = this.viewRadius;
    const ecx = Math.floor(this.eye[0] / CS);
    const ecz = Math.floor(this.eye[2] / CS);
    let total = 0;
    let done = 0;
    for (let dz = -R; dz <= R; dz += 1) {
      for (let dx = -R; dx <= R; dx += 1) {
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        const cx = ecx + dx;
        const cz = ecz + dz;
        if (cx < 0 || cz < 0 || cx >= CHUNKS_X || cz >= CHUNKS_Z) continue;
        total += 1;
        if (this.meshedMap[cz * CHUNKS_X + cx]) done += 1;
      }
    }
    return total ? done / total : 1;
  }

  private bodyEntry(body: BlockBody): BodyEntry {
    let entry = this.bodies.get(body);
    if (!entry || entry.version !== body.version) {
      const light = computeBodyLight(body);
      meshBody(body, light, this.out);
      if (!entry) {
        entry = { out: { opaque: new GpuMesh(this.gl), cutout: new GpuMesh(this.gl) }, version: body.version, light };
        this.bodies.set(body, entry);
      }
      entry.out.opaque.upload(this.out.opaque);
      entry.out.cutout.upload(this.out.cutout);
      entry.version = body.version;
      entry.light = light;
    }
    return entry;
  }

  /** Light field of a body (for lighting things that stand on it). */
  bodyLight(body: BlockBody): BodyLight | null {
    return this.bodies.get(body)?.light ?? null;
  }

  // ------------------------------------------------------------------ render targets

  private makeTarget(w: number, h: number, format: number, filter: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  private freeTarget(t: Target | null): void {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  private ensureTargets(): void {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.devW * this.renderScale));
    const h = Math.max(1, Math.round(this.devH * this.renderScale));
    const samples = this.quality === 'ultra' && !this.software && this.dpr < 1.75 ? Math.min(4, this.maxSamples) : 0;
    if (w === this.targetW && h === this.targetH && samples === this.targetSamples && this.scene) return;
    this.freeTarget(this.scene);
    for (const t of this.bloom) this.freeTarget(t);
    this.freeTarget(this.raysT);
    if (this.sceneDepth) gl.deleteRenderbuffer(this.sceneDepth);
    if (this.msaaFbo) gl.deleteFramebuffer(this.msaaFbo);
    if (this.msaaColor) gl.deleteRenderbuffer(this.msaaColor);
    if (this.msaaDepth) gl.deleteRenderbuffer(this.msaaDepth);
    if (this.depthTex) gl.deleteTexture(this.depthTex);
    if (this.depthFbo) gl.deleteFramebuffer(this.depthFbo);
    this.msaaFbo = this.msaaColor = this.msaaDepth = null;
    this.scene = this.makeTarget(w, h, this.colorFormat, gl.LINEAR);
    this.sceneDepth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepth);
    if (samples > 1) {
      this.msaaFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
      this.msaaColor = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, this.colorFormat, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColor);
      this.msaaDepth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteFramebuffer(this.msaaFbo);
        this.msaaFbo = null;
      }
    }
    // A copy of the opaque depth for water thickness and the sun rays.
    this.depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
    this.nearest(gl.TEXTURE_2D, false);
    this.depthFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depthTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    // Bloom mip chain from half resolution down.
    this.bloom = [];
    const start = this.quality === 'fast' ? 2 : 1;
    let bw = Math.max(1, w >> start);
    let bh = Math.max(1, h >> start);
    const levels = this.quality === 'fast' ? 3 : 6;
    for (let i = 0; i < levels && bw >= 2 && bh >= 2; i += 1) {
      this.bloom.push(this.makeTarget(bw, bh, this.colorFormat, gl.LINEAR));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    this.raysT = this.makeTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), this.colorFormat, gl.LINEAR);
    this.freeTarget(this.ldrT);
    this.ldrT = this.software ? this.makeTarget(w, h, gl.RGBA8, gl.LINEAR) : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targetW = w;
    this.targetH = h;
    this.targetSamples = samples;
  }

  private ensureShadowMap(): void {
    if (this.shadowTex && this.shadowFbo && this.shadowTexSize === this.shadowSize) return;
    const gl = this.gl;
    if (this.shadowTex) gl.deleteTexture(this.shadowTex);
    if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
    const size = this.shadowSize;
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowTexSize = size;
  }

  // ------------------------------------------------------------------ frame

  /** Lowers the scene resolution when frames run long, and recovers when there is headroom. */
  private adaptResolution(game: Game): void {
    const now = performance.now();
    const ms = this.lastFrame ? Math.min(250, now - this.lastFrame) : 16;
    this.lastFrame = now;
    if (!game.isPlaying()) return;
    this.frameEma += (ms - this.frameEma) * 0.08;
    this.playMs += ms;
    if (this.playMs < 4000) return;
    if (this.frameEma > 30) {
      this.slowMs += ms;
      this.quickMs = 0;
      if (this.slowMs > 2500 && this.mobile && this.fastPlus) {
        // A phone struggling: FAST's extras (the shadows of what moves, the normal maps) go before
        // the picture's sharpness does.
        this.plainFast = true;
        if (!this.picked) {
          try {
            window.localStorage.setItem(AUTO_KEY, 'plain');
          } catch {
            // ignore
          }
        }
        this.slowMs = 0;
      } else if (this.slowMs > 2500 && this.renderScale > this.minScale) {
        this.renderScale = Math.max(this.minScale, this.renderScale - 0.1);
        this.slowMs = 0;
      } else if (this.slowMs > 5000 && this.quality !== 'fast') {
        // Still struggling at the lowest resolution: step the effects down (and start there next
        // time, unless the player chose the tier: theirs is only lowered for this session).
        this.quality = this.quality === 'ultra' ? 'high' : 'fast';
        if (this.quality === 'fast' && this.zoom > 0) this.zoom -= 1;
        if (!this.picked) {
          try {
            window.localStorage.setItem(AUTO_KEY, this.quality);
          } catch {
            // ignore
          }
        }
        this.applyQuality();
        this.renderScale = Math.max(this.minScale, this.maxScale * 0.8);
        this.slowMs = 0;
      } else if (this.slowMs > 5000 && this.fastPlus) {
        // FAST and still struggling at the lowest resolution: its extras go (the shadows of what
        // moves, the normal maps) before the frame rate does.
        this.plainFast = true;
        if (!this.picked) {
          try {
            window.localStorage.setItem(AUTO_KEY, 'plain');
          } catch {
            // ignore
          }
        }
        this.slowMs = 0;
      } else if (this.slowMs > 8000 && this.mobile && this.fpsCap > 30) {
        // Nothing left to give up: a steady 30 is kinder than a stuttering 40, and runs cooler.
        this.fpsCap = 30;
        this.slowMs = 0;
      }
    } else if (this.frameEma < 15) {
      this.quickMs += ms;
      this.slowMs = 0;
      if (this.quickMs > 6000 && this.renderScale < this.maxScale) {
        this.renderScale = Math.min(this.maxScale, this.renderScale + 0.05);
        this.quickMs = 0;
      }
    } else {
      this.slowMs = 0;
      this.quickMs = 0;
    }
  }

  render(game: Game): void {
    if (this.lost || !game.world) return;
    const gl = this.gl;
    const w = game.world;
    if (w !== this.world) this.setWorld(w);
    this.adaptResolution(game);
    const env = applyWeather(environment(game.clock()), game.weather, game.region);
    this.env = env;
    this.updateSections(w, game.isPlaying() ? 5 : 12);
    this.updateLod(game.isPlaying() ? 2.5 : 6);
    const live: BlockBody[] = [game.fortress, ...game.giants.filter((g) => !g.dead).map((g) => g.body), ...(game.hoist ? [game.hoist.cargo] : [])].filter((b) => b.cells.size > 0);
    for (const body of live) this.bodyEntry(body);
    for (const [body, entry] of this.bodies) {
      if (!live.includes(body)) {
        entry.out.opaque.dispose();
        entry.out.cutout.dispose();
        this.bodies.delete(body);
      }
    }
    buildDynamic(game, this, this.dynOut);
    this.dyn.upload(this.dynOut.opaque, true);
    this.dynCut.upload(this.dynOut.cutout, true);
    this.overlay.upload(this.dynOut.overlay, true);
    this.soft.upload(this.dynOut.soft, true);
    const eyeId = w.get(Math.floor(this.eye[0]), Math.floor(this.eye[1]), Math.floor(this.eye[2]));
    const underwater = eyeId === B.WATER || eyeId === B.FALLING_WATER;
    const lights = this.lightsFor(game, env);
    const R = this.viewRadius * CS;

    // ---- sun shadow map
    this.timer.collect();
    const shadows = (this.quality !== 'fast' || this.fastPlus) && env.shadows;
    this.timer.begin('shadow');
    // (A phone redraws them every third frame while the fortress stands: nothing out there moves
    // fast enough to tell. Marching, the deck would slide under its own shadows: every frame.)
    this.shadowWait -= 1;
    if (shadows && (this.shadowWait <= 0 || !this.shadowFresh)) {
      this.renderShadows(env, live, this.fastPlus);
      this.shadowFresh = true;
      this.shadowWait = this.mobile && !game.fortress.moving && !game.hoist && !game.craneDrop ? 3 : 1;
    } else if (!shadows) this.shadowFresh = false;
    this.timer.begin('opaque');

    // ---- scene
    this.ensureTargets();
    const scene = this.scene!;
    const drawFbo = this.msaaFbo ?? scene.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, drawFbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.clearColor(env.horizon[0], env.horizon[1], env.horizon[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.bindWorldTextures(shadows);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    const main = this.main;
    const opaque = this.opaque;
    opaque.use();
    this.worldUniforms(opaque, env, lights, shadows, underwater);
    // Opaque sections near to far, then the double-sided cut-outs.
    const ey = Math.floor(this.eye[1]);
    const inTheOpen = ey >= WY || (ey >= 0 && w.skyAt(Math.floor(this.eye[0]), ey, Math.floor(this.eye[2])) >= 8);
    const visible: SectionMesh[] = [];
    for (const s of this.sections.values()) {
      if (!s.opaque && !s.cutout && !s.water) continue;
      const dx = s.x - this.eye[0];
      const dz = s.z - this.eye[2];
      if (dx * dx + dz * dz > (R + 20) * (R + 20)) continue;
      const ci = s.sz * CHUNKS_X + s.sx;
      if (!this.meshedMap[ci]) continue;
      const floor = this.floors[ci]!;
      if (inTheOpen && floor > 0 && s.y + 8 < floor) continue;
      if (!sphereVisible(this.planes, s.x, s.y, s.z, 14)) continue;
      const ey = s.y - this.eye[1];
      s.d = dx * dx + ey * ey + dz * dz;
      visible.push(s);
    }
    visible.sort((a, b) => a.d - b.d);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    for (const s of visible) s.opaque?.draw();
    // Bodies carry their own torchlight: only the transient lights are added.
    this.setLights(opaque, lights, false);
    for (const body of live) {
      const jitter = body.shake > 0 ? (Math.random() - 0.5) * body.shake * 0.3 : 0;
      setModel(opaque, body, jitter);
      this.bodies.get(body)!.out.opaque.draw();
    }
    this.setLights(opaque, lights);
    setModel(opaque, null);
    this.dyn.draw();
    gl.disable(gl.CULL_FACE);
    main.use();
    this.worldUniforms(main, env, lights, shadows, underwater);
    for (const s of visible) s.cutout?.draw();
    this.setLights(main, lights, false);
    for (const body of live) {
      setModel(main, body);
      this.bodies.get(body)!.out.cutout.draw();
    }
    this.setLights(main, lights);
    setModel(main, null);
    this.dynCut.draw();
    gl.enable(gl.CULL_FACE);

    // ---- distant terrain
    this.timer.begin('lod');
    const lod = this.lod;
    lod.use();
    this.worldUniforms(lod, env, [], false, underwater);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.meshedTex);
    lod.i1('uMeshed', 4);
    lod.f2('uWorldSize', WX, WZ);
    gl.activeTexture(gl.TEXTURE0);
    if (!this.software) {
      const woods = this.woodsReach;
      for (const t of this.lodTiles) {
        if (!this.lodTileVisible(t)) continue;
        t.ground.draw();
        if (t.trees && Math.hypot(t.x + LOD_TILE / 2 - this.eye[0], t.z + LOD_TILE / 2 - this.eye[2]) < woods) t.trees.draw();
      }
    }

    // ---- sky last among opaque things: its shader only runs where nothing was drawn
    this.timer.begin('sky');
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    const sky = this.sky;
    sky.use();
    this.skyUniforms(sky, env);
    const tanY = Math.tan(this.vfov / 2);
    sky.f3('uForward', this.cam.f);
    sky.f3('uRight', this.cam.r);
    sky.f3('uUp', this.cam.u);
    sky.f2('uTan', tanY * this.aspect, tanY);
    sky.f1('uStars', env.stars);
    sky.f1('uTime', this.time);
    sky.i1('uBlocks', 0);
    sky.i1('uNoise', 5);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.activeTexture(gl.TEXTURE0);
    sky.f4('uSun', env.sunDir[0], env.sunDir[1], env.sunDir[2], layerOf('sun'));
    sky.f3('uSunTint', env.sunTint);
    sky.f4('uMoon', -env.sunDir[0], -env.sunDir[1], -env.sunDir[2], layerOf('moon'));
    sky.f3('uMoonTint', env.moonTint);
    sky.f3('uCamPos', this.eye);
    sky.f3('uCloudLit', env.cloudLit);
    sky.f3('uCloudShade', env.cloudShade);
    sky.f1('uCloudCover', env.cloudCover);
    sky.f1('uClouds', this.software ? 0 : 1);
    // The northern lights over the snow, on clear nights.
    sky.f1('uAurora', this.software ? 0 : clamp(env.stars, 0, 1) * game.region.snow * (1 - game.weather.storm));
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);

    // ---- opaque depth for the water and the rays
    if (this.quality !== 'fast' || visible.some((s) => s.water)) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.depthFbo);
      gl.blitFramebuffer(0, 0, scene.w, scene.h, 0, 0, scene.w, scene.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, drawFbo);
    }

    // ---- water, far to near
    this.timer.begin('water');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    const water = this.water;
    water.use();
    this.worldUniforms(water, env, lights, shadows, underwater);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    water.i1('uDepth', 4);
    water.f2('uDepthSize', scene.w, scene.h);
    water.f2('uNearFar', this.near, this.far);
    water.f1('uHasDepth', 1);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.meshedTex);
    water.i1('uMeshed', 5);
    water.f2('uWorldSize', WX, WZ);
    gl.activeTexture(gl.TEXTURE0);
    water.f1('uLodMask', 1);
    if (!this.software) for (const t of this.lodTiles) if (t.water && this.lodTileVisible(t)) t.water.draw();
    water.f1('uLodMask', 0);
    for (let i = visible.length - 1; i >= 0; i -= 1) visible[i]!.water?.draw();

    // ---- decals (cracks, outline, creature shadows) and soft particles
    main.use();
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -2);
    this.overlay.draw();
    gl.disable(gl.POLYGON_OFFSET_FILL);
    this.soft.draw();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);

    // ---- first-person hand
    this.timer.begin('hand');
    if (game.isPlaying() && !game.player.dead && game.camPull < 0.2 && !bodyShown(game)) this.drawHand(game, env);
    this.timer.begin('post');

    // ---- resolve, bloom, rays and the final grade
    // (The scene's depth is finished with: a tiled phone GPU need not write it back to memory.)
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, DEPTH_ONLY);
    if (this.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.fbo);
      gl.blitFramebuffer(0, 0, scene.w, scene.h, 0, 0, scene.w, scene.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.emptyVao);
    if (!this.software) this.postBloom(env);
    const raysOn = this.quality !== 'fast' && !this.software && env.rays > 0.01 && this.postRays(env);
    if (this.ldrT) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ldrT.fbo);
      gl.viewport(0, 0, this.ldrT.w, this.ldrT.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.devW, this.devH);
    }
    const comp = this.composite;
    comp.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    comp.i1('uScene', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloom[0]!.tex);
    comp.i1('uBloom', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.raysT!.tex);
    comp.i1('uRays', 2);
    comp.f1('uBloomAmt', this.software ? 0 : env.bloom * (game.phase === 'title' ? 1.2 : 1));
    comp.f1('uRaysAmt', raysOn ? env.rays : 0);
    comp.f3('uRaysCol', env.raysCol);
    comp.f1('uExposure', env.exposure * (underwater ? 0.8 : 1));
    comp.f1('uSaturation', env.saturation);
    comp.f3('uLift', env.lift);
    comp.f3('uGain', env.gain);
    comp.f1('uVignette', 0.32);
    comp.f3('uTint', [0.45, 0.75, 1]);
    comp.f1('uTintAmt', underwater ? 0.6 : 0);
    // A blow flashes the edges red; low on hearts they pulse with the heartbeat.
    const pl = game.player;
    const struck = pl.hurt > 0 ? clamp(pl.hurt / 0.35, 0, 1) * 0.7 : 0;
    const low = !pl.dead && game.isPlaying() && pl.hp <= 6 ? (pl.hp <= 3 ? 0.42 : 0.26) * (0.6 + 0.4 * Math.sin(this.time * (pl.hp <= 3 ? 8.7 : 6))) : 0;
    comp.f1('uHurt', Math.max(struck, low));
    comp.f1('uLdrScale', this.hdr ? 0 : 0);
    this.timer.begin('composite');
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.ldrT) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ldrT.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, this.ldrT.w, this.ldrT.h, 0, 0, this.devW, this.devH, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.timer.end();
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private lodTileVisible(t: LodGpu): boolean {
    const cx = t.x + LOD_TILE / 2;
    const cz = t.z + LOD_TILE / 2;
    const cy = (t.minY + t.maxY) / 2;
    const r = Math.hypot(LOD_TILE / 2, LOD_TILE / 2, (t.maxY - t.minY) / 2);
    const d = Math.hypot(cx - this.eye[0], cz - this.eye[2]);
    if (d - r > this.far) return false;
    // Entirely inside the real-block area: nothing of it would survive the discard.
    if (d + r < (this.viewRadius - 1.5) * CS) return false;
    return sphereVisible(this.planes, cx, cy, cz, r);
  }

  private bindWorldTextures(shadows: boolean): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blocksTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.skinsTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, shadows ? this.shadowTex : null);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.materialsTex);
    gl.activeTexture(gl.TEXTURE0);
  }

  private postBloom(env: Env): void {
    const gl = this.gl;
    const scene = this.scene!;
    const chain = this.bloom;
    // Bright pass at half resolution.
    const b = this.bright;
    b.use();
    gl.bindFramebuffer(gl.FRAMEBUFFER, chain[0]!.fbo);
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, COLOR_ONLY);
    gl.viewport(0, 0, chain[0]!.w, chain[0]!.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    b.i1('uSrc', 0);
    b.f2('uTexel', 1 / scene.w, 1 / scene.h);
    b.f1('uThreshold', 0.85 + env.daylight * 0.35);
    b.f1('uScale', env.exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const d = this.down;
    d.use();
    for (let i = 1; i < chain.length; i += 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, chain[i]!.fbo);
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, COLOR_ONLY);
      gl.viewport(0, 0, chain[i]!.w, chain[i]!.h);
      gl.bindTexture(gl.TEXTURE_2D, chain[i - 1]!.tex);
      d.i1('uSrc', 0);
      d.f2('uTexel', 1 / chain[i - 1]!.w, 1 / chain[i - 1]!.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    const u = this.up;
    u.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = chain.length - 1; i > 0; i -= 1) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, chain[i - 1]!.fbo);
      gl.viewport(0, 0, chain[i - 1]!.w, chain[i - 1]!.h);
      gl.bindTexture(gl.TEXTURE_2D, chain[i]!.tex);
      u.i1('uSrc', 0);
      u.f2('uTexel', 1 / chain[i]!.w, 1 / chain[i]!.h);
      u.f1('uRadius', 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  /** Renders the god-ray buffer; false when the sun is too far off screen to matter. */
  private postRays(env: Env): boolean {
    const gl = this.gl;
    const s: Vec3 = [this.eye[0] + env.sunDir[0] * 500, this.eye[1] + env.sunDir[1] * 500, this.eye[2] + env.sunDir[2] * 500];
    const m = this.viewProj;
    const x = m[0]! * s[0] + m[4]! * s[1] + m[8]! * s[2] + m[12]!;
    const y = m[1]! * s[0] + m[5]! * s[1] + m[9]! * s[2] + m[13]!;
    const w = m[3]! * s[0] + m[7]! * s[1] + m[11]! * s[2] + m[15]!;
    const facing = env.sunDir[0] * this.cam.f[0] + env.sunDir[1] * this.cam.f[1] + env.sunDir[2] * this.cam.f[2];
    if (w <= 0 || facing < 0.05) return false;
    const u = (x / w) * 0.5 + 0.5;
    const v = (y / w) * 0.5 + 0.5;
    const vis = smooth(0.05, 0.5, facing) * (1 - smooth(0.9, 1.6, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2));
    if (vis <= 0.01) return false;
    const t = this.raysT!;
    const r = this.rays;
    r.use();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
    r.i1('uDepth', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.scene!.tex);
    r.i1('uScene', 1);
    r.f2('uSunUV', u, v);
    r.f1('uSunVis', vis);
    r.f1('uDensity', 0.9);
    r.f1('uThreshold', 1.6);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  private skyUniforms(p: Program, env: Env): void {
    p.f3('uZenith', env.zenith);
    p.f3('uHorizon', env.horizon);
    p.f3('uSunDir', env.sunDir);
    p.f3('uGlowCol', env.glow);
    p.f1('uSunset', env.sunset);
  }

  private worldUniforms(p: Program, env: Env, lights: PointLight[], shadows: boolean, underwater: boolean): void {
    this.skyUniforms(p, env);
    p.i1('uBlocks', 0);
    p.i1('uSkins', 1);
    p.i1('uShadowMap', 2);
    p.i1('uMaterials', 3);
    p.m4('uViewProj', this.viewProj);
    p.m4('uShadowMat', this.shadowVP);
    p.f1('uShadowOn', shadows ? 1 : 0);
    p.f1('uShadowBias', this.shadowSize >= 2048 ? 0.05 : 0.07);
    p.f2('uShadowTexel', 1 / this.shadowSize, 1 / this.shadowSize);
    setModel(p, null);
    p.f3('uCamera', this.eye);
    p.f1('uTime', this.time);
    p.f1('uWave', 1);
    p.f2('uWind', 1, 1);
    p.f3('uLightDir', env.lightDir);
    p.f3('uSunCol', env.sunCol);
    p.f3('uSkyAmb', env.skyAmb);
    p.f3('uGroundAmb', env.groundAmb);
    // Warm torchlight, held a little lower at night when the exposure rises.
    const torch = 1.15 / Math.max(1, env.exposure * 0.75);
    p.f3('uTorch', [1.0 * torch, 0.55 * torch, 0.22 * torch]);
    p.f1('uMinLight', 0.006);
    p.f1('uGlow', env.glowStrength);
    p.f1('uNormalMaps', this.quality === 'fast' && !this.fastPlus ? 0 : 1);
    p.f1('uSpecular', this.quality === 'fast' ? 0.5 : 1);
    p.f1('uFar', this.far);
    if (underwater) {
      p.f4('uFog', 0.18, 0.0, this.eye[1], 0.97);
      p.f3('uFogTint', [0.02, 0.08, 0.14]);
      p.f1('uFogTintAmt', 1);
    } else {
      p.f4('uFog', env.fogDensity, 0.018, 58, 0.92);
      p.f3('uFogTint', env.fogTint);
      p.f1('uFogTintAmt', env.fogTintAmt);
    }
    this.setLights(p, lights);
  }

  /** Up to 8 point lights (without the ones bodies carry when `bodies` is false). */
  private setLights(p: Program, lights: PointLight[], bodies = true): void {
    const lp = lightPos;
    const lc = lightColor;
    lp.fill(0);
    lc.fill(0);
    let n = 0;
    for (const l of lights) {
      if (n === 8) break;
      if (!bodies && l.body) continue;
      lp[n * 4] = l.p[0];
      lp[n * 4 + 1] = l.p[1];
      lp[n * 4 + 2] = l.p[2];
      lp[n * 4 + 3] = l.r;
      lc[n * 3] = l.c[0];
      lc[n * 3 + 1] = l.c[1];
      lc[n * 3 + 2] = l.c[2];
      n += 1;
    }
    p.i1('uLightCount', n);
    p.v4('uLights', lp);
    p.v3('uLightColors', lc);
  }

  /** Dynamic lights: TNT in flight, explosions, giant hearts, your lantern at night. */
  private lightsFor(game: Game, env: Env): PointLight[] {
    const out: PointLight[] = [];
    const k = clamp(1.25 - env.daylight, 0.2, 1);
    for (const pr of game.projectiles) out.push({ p: [pr.x, pr.y, pr.z], r: 4, c: [1.6 * k, 0.9 * k, 0.35 * k] });
    for (const mob of game.mobs) if (mob.fuse > 0) out.push({ p: [mob.x, mob.cy, mob.z], r: 3 + mob.fuse, c: [1.2, 1.2, 1.2] });
    for (const l of game.lights) {
      const f = clamp(l.life / l.max, 0, 1);
      out.push({ p: [l.x, l.y, l.z], r: l.r, c: [l.color[0] * f * 2.2, l.color[1] * f * 2.2, l.color[2] * f * 2.2] });
    }
    if (env.daylight < 0.6 && !game.player.dead) out.push({ p: [this.eye[0], this.eye[1] - 0.2, this.eye[2]], r: 7.5, c: [0.55 * (1 - env.daylight), 0.42 * (1 - env.daylight), 0.25 * (1 - env.daylight)] });
    const e = this.eye;
    const score = (l: PointLight): number => Math.hypot(l.p[0] - e[0], l.p[1] - e[1], l.p[2] - e[2]) - l.r;
    out.sort((a, b) => score(a) - score(b));
    return out.slice(0, 8);
  }

  /**
   * Orthographic depth map from the sun, centred ahead of the eye and snapped to its texels. `light`:
   * only what moves casts (the fortress, giants, the load, creatures), over a tighter square.
   */
  private renderShadows(env: Env, live: BlockBody[], light = false): void {
    const gl = this.gl;
    this.ensureShadowMap();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    const extent = light ? 32 : this.quality === 'ultra' ? 56 : 44;
    const L = env.lightDir;
    const c: Vec3 = [this.eye[0] + this.cam.f[0] * extent * 0.35, this.eye[1], this.eye[2] + this.cam.f[2] * extent * 0.35];
    const eye: Vec3 = [c[0] + L[0] * 160, c[1] + L[1] * 160, c[2] + L[2] * 160];
    lookDirUp(this.shadowView, eye, [-L[0], -L[1], -L[2]], Math.abs(L[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]);
    const texel = (2 * extent) / this.shadowSize;
    this.shadowView[12] = Math.round(this.shadowView[12]! / texel) * texel;
    this.shadowView[13] = Math.round(this.shadowView[13]! / texel) * texel;
    ortho(this.shadowProj, -extent, extent, -extent, extent, 1, 340);
    multiply(this.shadowVP, this.shadowProj, this.shadowView);
    const planes = frustumPlanes(this.shadowVP);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.2, 3);
    const depth = this.depth;
    depth.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blocksTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.skinsTex);
    gl.activeTexture(gl.TEXTURE0);
    depth.i1('uBlocks', 0);
    depth.i1('uSkins', 1);
    depth.m4('uViewProj', this.shadowVP);
    setModel(depth, null);
    depth.f1('uTime', this.time);
    depth.f1('uWave', 1);
    depth.f2('uWind', 1, 1);
    // (The light map leaves the terrain out: the skylight already darkens what a cliff or a roof
    // overhangs, and a phone's frame has better uses for its ground pass.)
    if (!light) {
      for (const s of this.sections.values()) {
        if (!s.opaque && !s.cutout) continue;
        const ci = s.sz * CHUNKS_X + s.sx;
        if (!this.meshedMap[ci]) continue;
        const floor = this.floors[ci]!;
        if (floor > 0 && s.y + 8 < floor) continue;
        if (!sphereVisible(planes, s.x, s.y, s.z, 14)) continue;
        s.opaque?.draw();
        s.cutout?.draw();
      }
    }
    for (const body of live) {
      setModel(depth, body);
      const e = this.bodies.get(body)!;
      e.out.opaque.draw();
      e.out.cutout.draw();
    }
    setModel(depth, null);
    this.dyn.draw();
    this.dynCut.draw();
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.CULL_FACE);
  }

  private drawHand(game: Game, env: Env): void {
    const gl = this.gl;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const p = game.player;
    const moving = Math.hypot(p.vx, p.vz) > 0.5 && p.onGround;
    const bx = moving ? Math.sin(p.walkPhase * Math.PI) * 0.025 : 0;
    const by = moving ? -Math.abs(Math.cos(p.walkPhase * Math.PI)) * 0.025 : 0;
    const [sky, blk] = game.lightAt(this.eye[0], this.eye[1] - 0.3, this.eye[2]);
    const b = this.heldB;
    // Holding a hen she is in both arms (flapping like mad while you float down); under the
    // parachute both hands are on its toggles; else the tool.
    let offset: Vec3 = [0, 0, 0];
    if (game.carried || p.chute > 0) {
      b.reset();
      b.sky = sky;
      b.blk = blk;
      if (game.carried) heldHen(b, p.onGround || p.climbing ? 0 : 1, this.time, this.equipT * this.equipT, bx, by, this.aspect < 1 ? 0.3 : 0.04);
      else heldChute(b, clamp(game.chuteRoll / 0.07, -1, 1), this.time, this.equipT * this.equipT, this.aspect);
      this.held.upload(b, true);
      this.heldKey = [];
    } else {
      // The tool is built only when something about it changes (its walking bob moves it whole,
      // by the model offset).
      const item = game.heldItem();
      const icon = item === I.SWORD ? swordOf(game).icon : undefined;
      // (Smaller on a phone: held sideways its low view would be a third tool; upright, a quarter.)
      const k = this.mobile ? (this.aspect < 1 ? 0.8 : 0.72) : this.aspect < 1 ? 0.86 : 1;
      const key = [item ?? -1, icon, mySkin(), this.swingT, this.equipT, sky, blk, k];
      const last = this.heldKey;
      if (key.length !== last.length || key.some((v, i) => v !== last[i])) {
        b.reset();
        b.sky = sky;
        b.blk = blk;
        heldItem(b, item, this.swingT, this.equipT * this.equipT, 0, 0, icon, k);
        this.held.upload(b, true);
        this.heldKey = key;
      }
      offset = [bx, by, 0];
    }
    // View-space lighting: rotate the light direction into the camera frame.
    const v = this.view;
    const rot = (L: Vec3): Vec3 => [v[0]! * L[0] + v[4]! * L[1] + v[8]! * L[2], v[1]! * L[0] + v[5]! * L[1] + v[9]! * L[2], v[2]! * L[0] + v[6]! * L[1] + v[10]! * L[2]];
    const main = this.main;
    main.use();
    main.m4('uViewProj', this.handProj);
    main.f3('uCamera', [0, 0, 0]);
    setModel(main, null);
    main.f3('uOffset', offset);
    main.f4('uFog', 0, 0, 0, 0);
    main.f1('uFar', 1e9);
    main.f1('uShadowOn', 0);
    main.f1('uWave', 0);
    main.f3('uLightDir', rot(env.lightDir));
    main.i1('uLightCount', 0);
    main.f1('uNormalMaps', 0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this.held.draw();
  }
}
