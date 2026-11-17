import type { Vec3 } from './math3d';
import { SKIN_H, SKIN_W } from './textures';

/**
 * Vertex layout (32 bytes): position f32x3, uv u16x2 (normalised), [layer, flags, emit, extra]
 * u8x4, normal i8x4, [r, g, b, ao] u8x4, [sky light, block light, 0, 0] u8x4.
 */
export const STRIDE = 32;

/** Vertex flags. */
export const F_LEAVES = 1;
export const F_PLANT = 2;
export const F_WATER = 4;
export const F_SKIN = 8;
/** Alpha-blended decal or soft sprite: colour alpha (the ao byte) is opacity, no AO. */
export const F_OVERLAY = 16;
export const F_UNLIT = 32;
/** Vertex colour only (no texture): distant terrain, crowns, beams. */
export const F_FLAT = 64;
export const F_FALLS = 128;

/** [u0, v0, u1, v1, layer]; uv in 0..1 of a texture-array layer, or of the skin atlas when layer < 0. */
export type TexRect = readonly [number, number, number, number, number];

// Box faces as signed unit corners in BL, TL, TR, BR order seen from outside.
const BOX_FACES: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[1, -1, 1], [1, 1, 1], [1, 1, -1], [1, -1, -1]], // +x
  [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]], // -x
  [[-1, 1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1]], // +y
  [[-1, -1, -1], [-1, -1, 1], [1, -1, 1], [1, -1, -1]], // -y
  [[-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]], // +z
  [[1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, -1]], // -z
];
const BOX_AXIS = [0, 0, 1, 1, 2, 2];
const BOX_SIGN = [1, -1, 1, -1, 1, -1];

const ONE4 = [1, 1, 1, 1] as const;

function u8(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
}

function unorm16(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 65535);
}


export class MeshBuilder {
  private buf: ArrayBuffer;
  private f32: Float32Array;
  private u16: Uint16Array;
  private u8: Uint8Array;
  private i8: Int8Array;
  index: Uint32Array;
  verts = 0;
  count = 0;
  // Per-vertex state applied by quad() and box().
  flags = 0;
  emit = 0;
  /** 0..1: the red hit flash over a creature that was just struck (stored in the spare data byte). */
  flash = 0;
  tint: Vec3 = [1, 1, 1];
  /** Opacity for F_OVERLAY quads (stored in the ao byte). */
  alpha = 1;
  /** Constant light (0..1) used when a quad has no per-vertex light. */
  sky = 1;
  blk = 0;
  /**
   * The face being written (see quad): its corners, its normal, its corners' occlusion (0-3), sky
   * light (4-7) and block light (8-11), and their extra flags.
   */
  private readonly corners = new Float64Array(12);
  private readonly normal = new Float64Array(3);
  private readonly shade = new Float64Array(12);
  private readonly cornerBits = new Int32Array(4);

  constructor(quads = 1024) {
    this.buf = new ArrayBuffer(quads * 4 * STRIDE);
    this.f32 = new Float32Array(this.buf);
    this.u16 = new Uint16Array(this.buf);
    this.u8 = new Uint8Array(this.buf);
    this.i8 = new Int8Array(this.buf);
    this.index = new Uint32Array(quads * 6);
  }

  reset(): void {
    this.verts = 0;
    this.count = 0;
    this.flags = 0;
    this.emit = 0;
    this.flash = 0;
    this.tint = [1, 1, 1];
    this.alpha = 1;
    this.sky = 1;
    this.blk = 0;
  }

  /** Bytes of the written vertices. */
  vertexBytes(): Uint8Array {
    return new Uint8Array(this.buf, 0, this.verts * STRIDE);
  }

  /** What was written since `verts`/`count` were as given, copied out (see paste). */
  cut(verts: number, count: number): { v: Uint8Array; i: Uint32Array; base: number } {
    return { v: this.u8.slice(verts * STRIDE, this.verts * STRIDE), i: this.index.slice(count, this.count), base: verts };
  }

  /** Writes again what cut copied out (its indices moved to where it now lands). */
  paste(c: { v: Uint8Array; i: Uint32Array; base: number }): void {
    const n = c.v.length / STRIDE;
    if (n === 0) return;
    this.ensure(Math.max(n, Math.ceil(c.i.length / 2)));
    this.u8.set(c.v, this.verts * STRIDE);
    const shift = this.verts - c.base;
    const dst = this.index;
    let k = this.count;
    for (let j = 0; j < c.i.length; j += 1) dst[k++] = c.i[j]! + shift;
    this.verts += n;
    this.count = k;
  }

  private ensure(extra = 4): void {
    if ((this.verts + extra) * STRIDE <= this.buf.byteLength && this.count + extra * 2 <= this.index.length) return;
    let size = this.buf.byteLength * 2;
    while ((this.verts + extra) * STRIDE > size) size *= 2;
    const grown = new ArrayBuffer(size);
    new Uint8Array(grown).set(this.u8);
    this.buf = grown;
    this.f32 = new Float32Array(grown);
    this.u16 = new Uint16Array(grown);
    this.u8 = new Uint8Array(grown);
    this.i8 = new Int8Array(grown);
    const index = new Uint32Array(Math.max(this.index.length * 2, (size / STRIDE / 4) * 6));
    index.set(this.index);
    this.index = index;
  }

  /** Writes one vertex; returns its index. */
  vertex(x: number, y: number, z: number, u: number, v: number, layer: number, flags: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, ao: number, sky: number, blk: number): number {
    const o = this.verts * STRIDE;
    const fo = o >> 2;
    const ho = o >> 1;
    this.f32[fo] = x;
    this.f32[fo + 1] = y;
    this.f32[fo + 2] = z;
    this.u16[ho + 6] = unorm16(u);
    this.u16[ho + 7] = unorm16(v);
    const b8 = this.u8;
    b8[o + 16] = layer;
    b8[o + 17] = flags;
    b8[o + 18] = u8(this.emit);
    b8[o + 19] = u8(this.flash);
    this.i8[o + 20] = Math.round(nx * 127);
    this.i8[o + 21] = Math.round(ny * 127);
    this.i8[o + 22] = Math.round(nz * 127);
    this.i8[o + 23] = 0;
    b8[o + 24] = u8(r);
    b8[o + 25] = u8(g);
    b8[o + 26] = u8(b);
    b8[o + 27] = u8(ao);
    b8[o + 28] = u8(sky);
    b8[o + 29] = u8(blk);
    b8[o + 30] = 0;
    b8[o + 31] = 0;
    this.verts += 1;
    return this.verts - 1;
  }

  triangle(a: number, b: number, c: number): void {
    const ix = this.index;
    ix[this.count] = a;
    ix[this.count + 1] = b;
    ix[this.count + 2] = c;
    this.count += 3;
  }

  /**
   * Quad from 4 corners (12 numbers, BL TL TR BR seen from the front) with a face normal,
   * optional per-corner ambient occlusion and per-corner sky/block light (all 0..1).
   */
  quad(
    p: ArrayLike<number>, t: TexRect, nx: number, ny: number, nz: number,
    ao: ArrayLike<number> = ONE4, sky: ArrayLike<number> | null = null, blk: ArrayLike<number> | null = null,
    flip = false, cornerFlags: ArrayLike<number> | null = null,
  ): void {
    // (Copied into the builder's own arrays for face(), which then only ever reads those: a read
    // that has met many kinds of array boxes every number it reads. This much is inlined into
    // each caller, where its reads meet one kind.)
    const q = this.corners;
    for (let i = 0; i < 12; i += 1) q[i] = p[i]!;
    const n = this.normal;
    n[0] = nx;
    n[1] = ny;
    n[2] = nz;
    const sh = this.shade;
    const bits = this.cornerBits;
    for (let i = 0; i < 4; i += 1) {
      sh[i] = ao[i]!;
      sh[i + 4] = sky ? sky[i]! : this.sky;
      sh[i + 8] = blk ? blk[i]! : this.blk;
      bits[i] = cornerFlags ? cornerFlags[i]! : 0;
    }
    this.face(t, flip);
  }

  /** Writes the quad in `corners`, `normal`, `shade` and `cornerBits`. */
  private face(t: TexRect, flip: boolean): void {
    this.ensure();
    const skin = t[4] < 0;
    const eu = skin ? 0.02 / SKIN_W : 1e-4;
    const ev = skin ? 0.02 / SKIN_H : 1e-4;
    // (What the four corners share is packed once, and they are written here rather than
    // through vertex(): this runs for every face of every creature, every frame.)
    const u0 = unorm16(t[0] + eu);
    const v0 = unorm16(t[1] + ev);
    const u1 = unorm16(t[2] - eu);
    const v1 = unorm16(t[3] - ev);
    const layer = skin ? 0 : t[4];
    const baseFlags = this.flags | (skin ? F_SKIN : 0);
    const tint = this.tint;
    const r = u8(tint[0]);
    const g = u8(tint[1]);
    const b = u8(tint[2]);
    const emit = u8(this.emit);
    const flash = u8(this.flash);
    const n = this.normal;
    const qx = Math.round(n[0]! * 127);
    const qy = Math.round(n[1]! * 127);
    const qz = Math.round(n[2]! * 127);
    const fade = (baseFlags & F_OVERLAY) !== 0 ? this.alpha : 1;
    const p = this.corners;
    const sh = this.shade;
    const bits = this.cornerBits;
    const f32 = this.f32;
    const u16 = this.u16;
    const b8 = this.u8;
    const i8 = this.i8;
    const v = this.verts;
    for (let i = 0; i < 4; i += 1) {
      const o = (v + i) * STRIDE;
      const fo = o >> 2;
      const ho = o >> 1;
      f32[fo] = p[i * 3]!;
      f32[fo + 1] = p[i * 3 + 1]!;
      f32[fo + 2] = p[i * 3 + 2]!;
      u16[ho + 6] = i < 2 ? u0 : u1;
      u16[ho + 7] = i === 0 || i === 3 ? v1 : v0;
      b8[o + 16] = layer;
      b8[o + 17] = baseFlags | bits[i]!;
      b8[o + 18] = emit;
      b8[o + 19] = flash;
      i8[o + 20] = qx;
      i8[o + 21] = qy;
      i8[o + 22] = qz;
      i8[o + 23] = 0;
      b8[o + 24] = r;
      b8[o + 25] = g;
      b8[o + 26] = b;
      b8[o + 27] = u8(fade * sh[i]!);
      b8[o + 28] = u8(sh[i + 4]!);
      b8[o + 29] = u8(sh[i + 8]!);
      b8[o + 30] = 0;
      b8[o + 31] = 0;
    }
    this.verts = v + 4;
    const ix = this.index;
    const c = this.count;
    if (flip) {
      ix[c] = v; ix[c + 1] = v + 3; ix[c + 2] = v + 1;
      ix[c + 3] = v + 1; ix[c + 4] = v + 3; ix[c + 5] = v + 2;
    } else {
      ix[c] = v; ix[c + 1] = v + 3; ix[c + 2] = v + 2;
      ix[c + 3] = v; ix[c + 4] = v + 2; ix[c + 5] = v + 1;
    }
    this.count += 6;
  }

  /** Re-maps positions and normals of the vertices written since vertex `from`. */
  transformSince(from: number, pos: (p: Vec3) => Vec3, normal: (n: Vec3) => Vec3): void {
    for (let v = from; v < this.verts; v += 1) {
      const o = v * STRIDE;
      const fo = o >> 2;
      const p = pos([this.f32[fo]!, this.f32[fo + 1]!, this.f32[fo + 2]!]);
      this.f32[fo] = p[0];
      this.f32[fo + 1] = p[1];
      this.f32[fo + 2] = p[2];
      const n = normal([this.i8[o + 20]! / 127, this.i8[o + 21]! / 127, this.i8[o + 22]! / 127]);
      this.i8[o + 20] = Math.round(n[0] * 127);
      this.i8[o + 21] = Math.round(n[1] * 127);
      this.i8[o + 22] = Math.round(n[2] * 127);
    }
  }

  /**
   * Oriented box: centre c and half-axis vectors ax, ay, az (right-handed).
   * Face order of textures: +x, -x, +y, -y, +z, -z. A null face is skipped.
   */
  box(c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, faces: ReadonlyArray<TexRect | null>): void {
    // (Written straight into face()'s arrays: no occlusion, the builder's light, no extra flags.)
    const p = this.corners;
    const sh = this.shade;
    for (let i = 0; i < 4; i += 1) {
      sh[i] = 1;
      sh[i + 4] = this.sky;
      sh[i + 8] = this.blk;
      this.cornerBits[i] = 0;
    }
    const lx = Math.sqrt(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]) || 1;
    const ly = Math.sqrt(ay[0] * ay[0] + ay[1] * ay[1] + ay[2] * ay[2]) || 1;
    const lz = Math.sqrt(az[0] * az[0] + az[1] * az[1] + az[2] * az[2]) || 1;
    for (let f = 0; f < 6; f += 1) {
      const tex = faces.length === 1 ? faces[0]! : faces[f];
      if (!tex) continue;
      const face = BOX_FACES[f]!;
      for (let i = 0; i < 4; i += 1) {
        const k = face[i]!;
        const sx = k[0];
        const sy = k[1];
        const sz = k[2];
        p[i * 3] = c[0] + ax[0] * sx + ay[0] * sy + az[0] * sz;
        p[i * 3 + 1] = c[1] + ax[1] * sx + ay[1] * sy + az[1] * sz;
        p[i * 3 + 2] = c[2] + ax[2] * sx + ay[2] * sy + az[2] * sz;
      }
      const axis = BOX_AXIS[f]!;
      const a = axis === 0 ? ax : axis === 1 ? ay : az;
      const l = axis === 0 ? lx : axis === 1 ? ly : lz;
      const s = BOX_SIGN[f]!;
      const n = this.normal;
      n[0] = (a[0] / l) * s;
      n[1] = (a[1] / l) * s;
      n[2] = (a[2] / l) * s;
      this.face(tex, false);
    }
  }
}

export class GpuMesh {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  count = 0;
  bytes = 0;
  private capV = 0;
  private capI = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ibo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, true, STRIDE, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, STRIDE, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.BYTE, true, STRIDE, 20);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.UNSIGNED_BYTE, true, STRIDE, 24);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.UNSIGNED_BYTE, true, STRIDE, 28);
    gl.bindVertexArray(null);
  }

  upload(b: MeshBuilder, dynamic = false): void {
    this.uploadBytes(b.vertexBytes(), b.index.subarray(0, b.count), dynamic);
  }

  /** The same from bytes built elsewhere (a worker's). */
  uploadBytes(vbytes: Uint8Array, ibytes: Uint32Array, dynamic = false): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (dynamic) {
      // Streamed every frame: grow the store geometrically and update in place.
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      if (vbytes.byteLength > this.capV) {
        this.capV = Math.max(vbytes.byteLength, this.capV * 2, 4096);
        gl.bufferData(gl.ARRAY_BUFFER, this.capV, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vbytes);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      if (ibytes.byteLength > this.capI) {
        this.capI = Math.max(ibytes.byteLength, this.capI * 2, 4096);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.capI, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, ibytes);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vbytes, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ibytes, gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    this.count = ibytes.length;
    this.bytes = vbytes.byteLength + ibytes.byteLength;
  }

  draw(): void {
    if (this.count === 0) return;
    const gl = this.gl;
    // (Left bound: every mesh and pass binds its own before drawing or touching its buffers.)
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteVertexArray(this.vao);
  }
}

// ------------------------------------------------------------------ shaders

const VERTEX_IN = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in uvec4 aData;
layout(location=3) in vec4 aNormal;
layout(location=4) in vec4 aColor;
layout(location=5) in vec4 aLight;
uniform vec3 uOffset;
// Body turn (identity for the world): world = uRot * local + uOffset.
uniform mat3 uRot;
uniform float uTime;
uniform float uWave;
uniform vec2 uWind;
// Leaves rustle and plants sway in the wind (shader-pack style).
vec3 sway(vec3 p, uint flags) {
  if ((flags & 1u) != 0u) {
    float t = uTime * 1.7 + p.x * 0.6 + p.z * 0.45 + p.y * 0.3;
    p.x += (sin(t) * 0.028 + sin(t * 2.3) * 0.012) * uWind.x;
    p.z += (cos(t * 0.8) * 0.028) * uWind.x;
    p.y += sin(t * 1.3) * 0.012 * uWind.x;
  }
  if ((flags & 2u) != 0u) {
    float s = sin(uTime * 1.9 + p.x * 0.7 + p.z * 0.4) + 0.4 * sin(uTime * 3.7 + p.z);
    p.x += s * 0.07 * uWind.y;
    p.z += cos(uTime * 1.5 + p.z * 0.6) * 0.05 * uWind.y;
  }
  return p;
}
`;

/** Sky gradient shared by the sky, fog and reflections so they always agree. Linear HDR. */
const SKY_COLOR = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uGlowCol;
uniform float uSunset;
// Gradient plus the warm band along the horizon on the sun's side (no halo).
vec3 skyBase(vec3 d) {
  float h = d.y;
  // The horizon colour hugs the horizon; most of the dome is the deeper zenith colour.
  vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-max(h, 0.0) * 5.5));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.3, h));
  vec2 hd = normalize(d.xz + vec2(1e-4));
  vec2 hs = normalize(uSunDir.xz + vec2(1e-4));
  float side = pow(max(dot(hd, hs), 0.0), 2.5);
  float band = exp(-abs(h - 0.03) * 6.0) * (0.15 + 0.85 * side);
  return mix(col, uGlowCol * 0.8, clamp(uSunset * band, 0.0, 1.0) * 0.7);
}
// The sun's halo (Mie scattering around the disc).
vec3 sunHalo(vec3 d) {
  float sd = max(dot(d, uSunDir), 0.0);
  return uGlowCol * (pow(sd, 8.0) * 0.18 + pow(sd, 60.0) * 0.35 + pow(sd, 600.0) * 1.2);
}
vec3 skyColor(vec3 d) {
  return skyBase(d) + sunHalo(d);
}
`;

/** Height fog with sky-coloured aerial perspective (distant hills fade into a warm haze). */
const FOG = `
uniform vec3 uCamera;
uniform vec4 uFog;
uniform vec3 uFogTint;
uniform float uFogTintAmt;
uniform float uFar;
float fogAmount(vec3 world) {
  vec3 d = world - uCamera;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float b = uFog.y;
  float a = uFog.x * exp(-(uCamera.y - uFog.z) * b);
  float k = dir.y * b;
  float integ = abs(k) > 1e-4 ? (1.0 - exp(-dist * k)) / k : dist;
  float amount = min(1.0 - exp(-a * integ), uFog.w);
  return max(amount, smoothstep(uFar * 0.72, uFar, dist));
}
vec3 fogColor(vec3 world) {
  vec3 dir = normalize(world - uCamera);
  vec3 d = normalize(vec3(dir.x, max(dir.y, -0.05) * 0.5 + 0.03, dir.z));
  return mix(skyBase(d) * 0.92 + sunHalo(d) * 0.3, uFogTint, uFogTintAmt);
}
`;

const LIGHTING = `
uniform sampler2DShadow uShadowMap;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
uniform vec3 uLightDir;
uniform vec3 uSunCol;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uTorch;
uniform float uMinLight;
uniform float uGlow;
float skyCurve(float l) {
  return l * l * (0.35 + 0.65 * l);
}
float blockCurve(float l) {
  float b = l * l;
  return b * b * 0.8 + b * 0.12;
}
float shadowFactor(vec4 sc) {
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  vec2 o = uShadowTexel * 0.85;
  float s = texture(uShadowMap, vec3(p.xy + vec2(-o.x, -o.y), p.z))
    + texture(uShadowMap, vec3(p.xy + vec2(o.x, -o.y), p.z))
    + texture(uShadowMap, vec3(p.xy + vec2(-o.x, o.y), p.z))
    + texture(uShadowMap, vec3(p.xy + vec2(o.x, o.y), p.z));
  vec2 e = min(p.xy, 1.0 - p.xy);
  return mix(1.0, s * 0.25, smoothstep(0.0, 0.08, min(e.x, e.y)));
}
// Diffuse light reaching a surface: sky ambient (hemisphere), sun with shadows, torchlight.
vec3 lightAt(vec3 n, vec3 geoN, float skyL, float blkL, float ao, vec4 shadowCoord, out float sunVis) {
  float sky = skyCurve(skyL);
  vec3 amb = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5) * sky * ao;
  float ndl = max(dot(n, uLightDir), 0.0) * smoothstep(-0.05, 0.15, dot(geoN, uLightDir));
  float gate = smoothstep(0.55, 0.93, skyL);
  float sh = uShadowOn > 0.5 ? shadowFactor(shadowCoord) : 1.0;
  sunVis = sh * gate;
  vec3 L = amb + uSunCol * ndl * sunVis * mix(1.0, ao, 0.35);
  float flick = 0.94 + 0.06 * sin(uTime * 7.0 + shadowCoord.x * 31.0) * sin(uTime * 3.1);
  vec3 torch = uTorch * blockCurve(blkL) * (0.55 + 0.45 * ao) * flick;
  L += torch;
  return max(L, vec3(uMinLight) * ao);
}
`;

const VERTEX_LIGHTS = `
uniform int uLightCount;
uniform vec4 uLights[8];
uniform vec3 uLightColors[8];
vec3 pointLights(vec3 world) {
  vec3 L = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uLightCount) break;
    vec3 d = uLights[i].xyz - world;
    float a = clamp(1.0 - length(d) / uLights[i].w, 0.0, 1.0);
    L += uLightColors[i] * a * a;
  }
  return L;
}
`;

const VARYINGS = `
vec2 vUV;
flat float vLayer;
flat uint vFlags;
vec4 vColor;
vec2 vLight;
vec3 vWorld;
vec3 vNormal;
float vEmit;
float vFlash;
vec4 vShadow;
vec3 vDyn;
float vFog;
vec3 vFogCol;
`;

function varyings(dir: 'in' | 'out'): string {
  return VARYINGS.trim().split('\n').map((line) => (line.startsWith('flat ') ? `flat ${dir} ${line.slice(5)}` : `${dir} ${line}`)).join('\n');
}

export const MAIN_VS = `#version 300 es
${VERTEX_IN}
${VERTEX_LIGHTS}
${SKY_COLOR}
${FOG}
uniform mat4 uViewProj;
uniform mat4 uShadowMat;
uniform float uShadowBias;
${varyings('out')}
void main() {
  vec3 world = uRot * aPos + uOffset;
  if (uWave > 0.5) world = sway(world, aData.y);
  vWorld = world;
  vNormal = uRot * aNormal.xyz;
  vUV = aUV;
  vLayer = float(aData.x);
  vFlags = aData.y;
  vEmit = float(aData.z) / 255.0;
  vFlash = float(aData.w) / 255.0;
  vColor = aColor;
  vLight = aLight.xy;
  vShadow = uShadowMat * vec4(world + vNormal * uShadowBias, 1.0);
  vDyn = pointLights(world);
  vFog = fogAmount(world);
  vFogCol = fogColor(world);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const COTANGENT = `
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
  return mat3(T * invmax, B * invmax, N);
}
`;

/**
 * Block and model shading. The opaque variant never discards, so early depth testing (and
 * hidden-surface removal on tile GPUs) can skip everything behind the nearest surface.
 */
function mainFS(cutout: boolean, lite = false): string {
  return `#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;
uniform sampler2DArray uBlocks;
uniform sampler2DArray uMaterials;
uniform sampler2D uSkins;
uniform float uTime;
uniform float uNormalMaps;
uniform float uSpecular;
uniform vec3 uCamera;
${SKY_COLOR}
${LIGHTING}
${COTANGENT}
${varyings('in')}
out vec4 outColor;
void main() {
  bool skin = (vFlags & 8u) != 0u;
  bool flat_ = (vFlags & 64u) != 0u;
  vec4 t = flat_ ? vec4(1.0) : skin ? texture(uSkins, vUV) : texture(uBlocks, vec3(vUV, vLayer));
  bool overlay = (vFlags & 16u) != 0u;
  float alpha = overlay ? t.a * vColor.a : 1.0;
  ${cutout ? 'if (overlay ? alpha < 0.01 : t.a < 0.5) discard;' : ''}
  vec3 albedo = t.rgb * vColor.rgb;
  // A struck creature flashes red (Minecraft's hurt overlay), bright enough to read at night.
  albedo = mix(albedo, vec3(0.95, 0.1, 0.07), vFlash * 0.62);
  if ((vFlags & 32u) != 0u) {
    vec3 c = albedo * (1.0 + vEmit * 4.0);
    outColor = vec4(mix(c, vFogCol, vFog * 0.6), alpha);
    return;
  }
  vec3 geoN = normalize(vNormal);
  if (!gl_FrontFacing && ((vFlags & 3u) != 0u || overlay)) geoN = -geoN;
  vec3 N = geoN;
  float spec = 0.0;
  float glow = 0.0;
  if (${lite ? 'false' : '!skin && !flat_'}) {
    vec4 m = texture(uMaterials, vec3(vUV, vLayer));
    spec = m.z * uSpecular;
    glow = m.w;
    if (uNormalMaps > 0.5 && !overlay) {
      vec3 tn = vec3(m.xy * 2.0 - 1.0, 0.0);
      tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
      N = normalize(cotangentFrame(geoN, vWorld, vUV) * tn);
    }
  }
  // Skins carry their glow in alpha (eyes that shine in the dark): 1 opaque, 0.53 fully lit.
  if (skin) glow = clamp((1.0 - t.a) * 2.15, 0.0, 1.0);
  float ao = overlay ? 1.0 : vColor.a;
  float sunVis;
  vec3 L = lightAt(N, geoN, vLight.x, vLight.y, ao, vShadow, sunVis) + vDyn;
  vec3 col = albedo * L;
  if (spec > 0.0) {
    vec3 V = normalize(uCamera - vWorld);
    vec3 H = normalize(uLightDir + V);
    float sp = pow(max(dot(N, H), 0.0), mix(24.0, 220.0, spec)) * (spec * 2.2);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col += uSunCol * sp * sunVis;
    col += skyColor(reflect(-V, N)) * fres * spec * 0.35 * skyCurve(vLight.x);
  }
  // Self-lit texels (lantern glass, fire, redstone) glow; never darker than they are lit.
  col = mix(col, max(col, albedo * uGlow), glow);
  col += albedo * vEmit * 3.0;
  col += vec3(0.5, 0.04, 0.02) * vFlash;
  col = mix(col, vFogCol, vFog);
  outColor = vec4(col, alpha);
}`;
}

export const MAIN_FS = mainFS(true);
export const MAIN_OPAQUE_FS = mainFS(false);
/** Software rasterisers: no material maps or specular (the frame must stay interactive). */
export const MAIN_LITE_FS = mainFS(true, true);
export const MAIN_OPAQUE_LITE_FS = mainFS(false, true);

/** Translucent water and waterfalls: sky reflections, sun glints, depth-based colour and foam. */
export const WATER_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;
uniform sampler2DArray uBlocks;
uniform sampler2D uDepth;
uniform sampler2D uMeshed;
uniform vec2 uDepthSize;
uniform vec2 uNearFar;
uniform float uTime;
uniform float uHasDepth;
uniform float uLodMask;
uniform vec2 uWorldSize;
${SKY_COLOR}
${FOG}
${LIGHTING}
${varyings('in')}
out vec4 outColor;
float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}
float waveH(vec2 p) {
  return sin(p.x * 0.9 + uTime * 1.3) * 0.5 + sin(p.y * 1.2 - uTime * 1.1) * 0.5
    + sin((p.x + p.y) * 2.1 + uTime * 2.3) * 0.25 + sin((p.x - p.y) * 3.3 - uTime * 2.9) * 0.12;
}
void main() {
  if (uLodMask > 0.5 && texture(uMeshed, vWorld.xz / uWorldSize).r > 0.5) discard;
  bool falls = (vFlags & 128u) != 0u;
  vec3 V = normalize(uCamera - vWorld);
  float viewDist = length(uCamera - vWorld);
  if (falls) {
    vec2 uv = vec2(vUV.x, vUV.y * 0.5 - uTime * 1.6);
    vec4 t = texture(uBlocks, vec3(fract(uv), vLayer));
    vec4 t2 = texture(uBlocks, vec3(fract(uv * vec2(1.0, 0.7) + vec2(0.37, -uTime * 0.9)), vLayer));
    vec3 c = (t.rgb + t2.rgb) * 0.5 * vColor.rgb;
    float sunVis;
    vec3 L = lightAt(vec3(0.0, 0.4, 0.9), vec3(0.0, 0.0, 1.0), vLight.x, vLight.y, 1.0, vShadow, sunVis);
    vec3 col = c * (L + 0.25 * uSkyAmb) + vDyn * c;
    col = mix(col, fogColor(vWorld), fogAmount(vWorld));
    outColor = vec4(col, 0.82);
    return;
  }
  bool top = vNormal.y > 0.5;
  vec3 n = normalize(vNormal);
  if (top) {
    vec2 p = vWorld.xz;
    float e = 0.15;
    float h0 = waveH(p);
    float hx = waveH(p + vec2(e, 0.0));
    float hz = waveH(p + vec2(0.0, e));
    float k = 0.06 * smoothstep(90.0, 10.0, viewDist);
    n = normalize(vec3((h0 - hx) / e * k, 1.0, (h0 - hz) / e * k));
    vec4 tex = texture(uBlocks, vec3(fract(p * 0.25 + vec2(uTime * 0.02, uTime * 0.013)), vLayer));
    n = normalize(n + vec3((tex.r - 0.5) * 0.08, 0.0, (tex.g - 0.5) * 0.08));
  }
  // Water thickness from the scene depth behind it: clear shallows, dark depths, foam lines.
  float thick = 4.0;
  if (uHasDepth > 0.5) {
    float sceneD = linearDepth(texture(uDepth, gl_FragCoord.xy / uDepthSize).r);
    float waterD = linearDepth(gl_FragCoord.z);
    thick = max(0.0, sceneD - waterD);
  }
  float sunVis;
  vec3 L = lightAt(vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), vLight.x, vLight.y, 1.0, vShadow, sunVis);
  // Murky water (the swamp's, the black pools') hides its bottom: deep from the first block.
  // (Distant water carries its own colour, not a tint: it stays as it was.)
  float murk = uLodMask > 0.5 ? 0.0 : clamp(1.0 - vColor.b, 0.0, 1.0);
  vec3 deep = vec3(0.012, 0.05, 0.085) * vColor.rgb;
  vec3 shallow = vec3(0.07, 0.24, 0.26) * vColor.rgb * (1.0 - 0.45 * murk);
  vec3 body = mix(shallow, deep, smoothstep(0.0, 4.5 - 3.5 * murk, thick)) * (L + vDyn) * 2.2;
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, n), 0.0), 5.0);
  vec3 r = reflect(-V, n);
  r.y = abs(r.y);
  vec3 refl = skyColor(r) * mix(0.25, 1.0, skyCurve(vLight.x)) * min(vec3(1.0), vColor.rgb * 1.15);
  vec3 col = mix(body, refl, top ? fres : 0.1);
  vec3 H = normalize(uLightDir + V);
  col += uSunCol * pow(max(dot(n, H), 0.0), 380.0) * 7.0 * sunVis * (top ? 1.0 : 0.0);
  float foam = top ? (1.0 - smoothstep(0.0, 0.55, thick)) * (0.55 + 0.45 * sin(uTime * 2.0 + vWorld.x * 3.0 + vWorld.z * 2.0)) : 0.0;
  col = mix(col, vec3(0.9, 0.95, 1.0) * (L + 0.1), foam * 0.6);
  float alpha = top ? mix(0.55 + 0.38 * murk, 0.97, max(fres, smoothstep(0.0, 3.0, thick))) : 0.8;
  alpha = max(alpha, foam * 0.7);
  col += vEmit * 0.0;
  col = mix(col, fogColor(vWorld), fogAmount(vWorld));
  outColor = vec4(col, alpha);
}`;

/**
 * Distant terrain, hidden where real chunks are drawn: block steps in their own colours (occlusion
 * in the colour's alpha), each face lit as an open block face is. Lava and magma light themselves.
 * (A face is hidden by the chunk its own column stands in: a step up from the real blocks' edge
 * still shows.)
 */
export const LOD_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2D uMeshed;
uniform sampler2DArray uBlocks;
uniform float uTime;
uniform vec2 uWorldSize;
${SKY_COLOR}
${FOG}
uniform vec3 uLightDir;
uniform vec3 uSunCol;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform float uGlow;
${varyings('in')}
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  if (texture(uMeshed, (vWorld.xz - n.xz * 0.5) / uWorldSize).r > 0.5) discard;
  bool water = (vFlags & 4u) != 0u;
  vec3 albedo = vColor.rgb * vColor.rgb;
  float ao = vColor.a;
  vec3 L = mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5) * ao + uSunCol * max(dot(n, uLightDir), 0.0) * 0.92 * mix(1.0, ao, 0.35);
  vec3 col = albedo * L;
  col = mix(col, max(col, albedo * uGlow), vEmit);
  if (water) {
    vec3 V = normalize(uCamera - vWorld);
    float fres = 0.02 + 0.98 * pow(1.0 - max(V.y, 0.0), 5.0);
    vec3 r = reflect(-V, vec3(0.0, 1.0, 0.0));
    col = mix(vec3(0.02, 0.07, 0.11) * L * 2.0, skyColor(r), fres);
    vec3 H = normalize(uLightDir + V);
    col += uSunCol * pow(max(H.y, 0.0), 300.0) * 3.0;
  }
  col = mix(col, fogColor(vWorld), fogAmount(vWorld));
  outColor = vec4(col, 1.0);
}`;

export const DEPTH_VS = `#version 300 es
${VERTEX_IN}
uniform mat4 uViewProj;
out vec2 vUV;
flat out float vLayer;
flat out uint vFlags;
void main() {
  vec3 world = uRot * aPos + uOffset;
  if (uWave > 0.5) world = sway(world, aData.y);
  vUV = aUV;
  vLayer = float(aData.x);
  vFlags = aData.y;
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

export const DEPTH_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uBlocks;
uniform sampler2D uSkins;
in vec2 vUV;
flat in float vLayer;
flat in uint vFlags;
void main() {
  if ((vFlags & (4u | 16u | 32u | 128u)) != 0u) discard;
  if ((vFlags & 64u) != 0u) return;
  vec4 tb = texture(uBlocks, vec3(vUV, vLayer));
  vec4 ts = texture(uSkins, vUV);
  if (((vFlags & 8u) != 0u ? ts.a : tb.a) < 0.5) discard;
}`;

export const FULLSCREEN_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vNdc;
out vec2 vUV;
void main() {
  vNdc = P[gl_VertexID];
  vUV = P[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(P[gl_VertexID], 0.9999, 1.0);
}`;

/** Sky dome: gradient, sun and moon, stars, and a layer of lit, drifting clouds. */
export const SKY_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uBlocks;
uniform sampler2D uNoise;
${SKY_COLOR}
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uTan;
uniform float uStars;
uniform float uTime;
uniform vec4 uSun;
uniform vec3 uSunTint;
uniform vec4 uMoon;
uniform vec3 uMoonTint;
uniform vec3 uCamPos;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudCover;
uniform float uClouds;
uniform float uAurora;
in vec2 vNdc;
out vec4 outColor;
vec4 disc(vec3 d, vec3 s, float size, float layer) {
  float k = dot(d, s);
  if (k <= 0.0) return vec4(0.0);
  vec3 a = normalize(cross(s, abs(s.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 b = cross(a, s);
  vec2 uv = vec2(dot(d, a), dot(d, b)) / k / size * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return textureLod(uBlocks, vec3(uv, layer), 0.0);
}
float n2(vec2 p) {
  return textureLod(uNoise, p / 256.0, 0.0).r;
}
// Northern lights: curtains of green fading to violet at their tops, hung high over the north,
// rippling slowly along their length, combed into fine vertical rays.
vec3 aurora(vec3 d) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float f = float(i) / 7.0;
    vec2 p = d.xz / max(d.y, 0.05) * (0.42 + f * 0.09);
    float warp = n2(p * 14.0 + vec2(uTime * 0.35, 3.0)) * 2.0 - 1.0;
    float s = 0.5 + 0.5 * sin(p.x * 2.4 + p.y * 0.8 + warp * 2.6 + uTime * 0.05);
    float curtain = pow(s, 18.0);
    float rays = 0.5 + 0.5 * n2(vec2(p.x * 160.0 + p.y * 40.0, uTime * 3.0));
    vec3 c = mix(vec3(0.12, 1.0, 0.5), vec3(0.6, 0.25, 1.0), f * f);
    acc += c * curtain * (0.45 + 0.55 * rays) * (1.0 - f * 0.7);
  }
  return acc / 7.0 * smoothstep(0.06, 0.38, d.y) * (1.0 - smoothstep(0.7, 1.0, d.y));
}
float cloudDensity(vec2 p) {
  vec2 w = vec2(uTime * 0.05, uTime * 0.02);
  float d = n2(p * 0.55 + w) * 0.52 + n2(p * 1.2 - w * 0.6) * 0.26 + n2(p * 2.5 + w * 0.3) * 0.14 + n2(p * 5.1) * 0.08;
  return smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.2, d);
}
void main() {
  vec3 d = normalize(uForward + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y);
  vec3 col = skyColor(d);
  if (uStars > 0.0 && d.y > 0.0) {
    vec3 q = floor(d * 210.0);
    float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h > 0.9965) {
      float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + h * 4.0) + h * 91.0);
      col += vec3(0.9, 0.93, 1.0) * uStars * twinkle * smoothstep(0.0, 0.25, d.y) * 1.6;
    }
  }
  if (uAurora > 0.001 && d.y > 0.06) col += aurora(d) * uAurora * 1.6;
  vec4 sun = disc(d, uSun.xyz, 0.075, uSun.w);
  col += sun.rgb * uSunTint * sun.a * 18.0;
  vec4 moon = disc(d, uMoon.xyz, 0.06, uMoon.w);
  col = mix(col, moon.rgb * uMoonTint * 2.4, moon.a * clamp(length(uMoonTint), 0.0, 1.0));
  // Cloud layer: a noise sheet high over the valley, brighter towards the sun.
  if (uClouds > 0.5 && d.y > 0.015) {
    float t = (300.0 - uCamPos.y) / d.y;
    vec2 p = (uCamPos.xz + d.xz * t) * 0.055;
    float dens = cloudDensity(p);
    if (dens > 0.001) {
      // Light the puffs from the sun's side: thinner towards the sun means brighter.
      float toward = cloudDensity(p + normalize(uSunDir.xz + vec2(1e-4)) * 0.35);
      float lit = clamp(1.0 - toward * 1.1 + (1.0 - dens) * 0.45, 0.0, 1.0);
      float sd = max(dot(d, uSunDir), 0.0);
      vec3 cc = mix(uCloudShade, uCloudLit, lit * lit * (3.0 - 2.0 * lit)) + uGlowCol * (pow(sd, 4.0) * 0.5 + pow(sd, 24.0) * 1.0) * (1.0 - dens * 0.6);
      float fade = smoothstep(0.015, 0.16, d.y) * (1.0 - smoothstep(2500.0, 7000.0, t));
      col = mix(col, cc, dens * fade * 0.95);
    }
  }
  outColor = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ post processing

/** Bright pass: keeps only what should bloom (and downsamples by 2). */
export const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uScale;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec3 c = texture(uSrc, vUV + uTexel * vec2(-0.5, -0.5)).rgb + texture(uSrc, vUV + uTexel * vec2(0.5, -0.5)).rgb
    + texture(uSrc, vUV + uTexel * vec2(-0.5, 0.5)).rgb + texture(uSrc, vUV + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25 * uScale;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  outColor = vec4(min(c * k, vec3(60.0)), 1.0);
}`;

/** 13-tap downsample (Call of Duty: Advanced Warfare style). */
export const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUV + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(uSrc, vUV + t * vec2(0.0, -2.0)).rgb;
  vec3 c = texture(uSrc, vUV + t * vec2(2.0, -2.0)).rgb;
  vec3 d = texture(uSrc, vUV + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(uSrc, vUV).rgb;
  vec3 f = texture(uSrc, vUV + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(uSrc, vUV + t * vec2(-2.0, 2.0)).rgb;
  vec3 h = texture(uSrc, vUV + t * vec2(0.0, 2.0)).rgb;
  vec3 i = texture(uSrc, vUV + t * vec2(2.0, 2.0)).rgb;
  vec3 j = texture(uSrc, vUV + t * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture(uSrc, vUV + t * vec2(1.0, -1.0)).rgb;
  vec3 l = texture(uSrc, vUV + t * vec2(-1.0, 1.0)).rgb;
  vec3 m = texture(uSrc, vUV + t * vec2(1.0, 1.0)).rgb;
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  outColor = vec4(o, 1.0);
}`;

/** 9-tap tent upsample, blended additively onto the next larger level. */
export const UP_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(uSrc, vUV + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUV + vec2(0.0, -t.y)).rgb * 2.0 + texture(uSrc, vUV + vec2(t.x, -t.y)).rgb
    + texture(uSrc, vUV + vec2(-t.x, 0.0)).rgb * 2.0 + texture(uSrc, vUV).rgb * 4.0 + texture(uSrc, vUV + vec2(t.x, 0.0)).rgb * 2.0
    + texture(uSrc, vUV + vec2(-t.x, t.y)).rgb + texture(uSrc, vUV + vec2(0.0, t.y)).rgb * 2.0 + texture(uSrc, vUV + vec2(t.x, t.y)).rgb;
  outColor = vec4(s / 16.0, 1.0);
}`;

/** Crepuscular rays: radial blur of the visible sky towards the sun. */
export const RAYS_FS = `#version 300 es
precision highp float;
uniform sampler2D uDepth;
uniform sampler2D uScene;
uniform vec2 uSunUV;
uniform float uSunVis;
uniform float uDensity;
uniform float uThreshold;
in vec2 vUV;
out vec4 outColor;
void main() {
  if (uSunVis <= 0.001) {
    outColor = vec4(0.0);
    return;
  }
  vec2 delta = (vUV - uSunUV) * (uDensity / 40.0);
  vec2 uv = vUV;
  float decay = 1.0;
  vec3 acc = vec3(0.0);
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  uv -= delta * jitter;
  for (int i = 0; i < 40; i++) {
    uv -= delta;
    vec2 c = clamp(uv, vec2(0.0), vec2(1.0));
    float sky = step(0.99995, texture(uDepth, c).r);
    // Only the sun and its bright halo shine through gaps, not the whole sky.
    vec3 s = texture(uScene, c).rgb;
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    acc += s * (max(l - uThreshold, 0.0) / max(l, 1e-3)) * sky * decay;
    decay *= 0.965;
  }
  outColor = vec4(min(acc / 40.0 * uSunVis * 1.6, vec3(8.0)), 1.0);
}`;

/** Final grade: bloom + rays, exposure, ACES filmic curve, warmth, vignette, dither. */
export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform float uBloomAmt;
uniform float uRaysAmt;
uniform vec3 uRaysCol;
uniform float uExposure;
uniform float uSaturation;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uVignette;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uHurt;
uniform float uLdrScale;
in vec2 vUV;
out vec4 outColor;
vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec3 c = texture(uScene, vUV).rgb;
  c = uLdrScale > 0.0 ? c * c * uLdrScale : c;
  c += texture(uBloom, vUV).rgb * uBloomAmt;
  c += texture(uRays, vUV).rgb * uRaysCol * uRaysAmt;
  c *= uExposure;
  // The filmic curve per channel bleaches bright colours (sun on sand turns white); blended with
  // the same curve on the brightest channel, which keeps their hue.
  float m = max(max(c.r, c.g), c.b);
  vec3 hue = c * (aces(vec3(m)).r / max(m, 1e-4));
  c = mix(aces(c), hue, 0.6);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = c * uGain + uLift * (1.0 - c);
  c = mix(c, c * uTint, uTintAmt);
  vec2 p = vUV - 0.5;
  float v = smoothstep(0.35, 0.95, length(p * vec2(1.0, 1.15)) * 1.25);
  c *= 1.0 - v * uVignette;
  c = mix(c, vec3(0.75, 0.05, 0.03), uHurt * v * 0.9);
  c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  // Ordered dither against banding in the sky gradient.
  vec2 q = mod(gl_FragCoord.xy, 4.0);
  c += (mod(q.x * 2.0 + q.y * 3.0, 4.0) / 4.0 - 0.375) / 255.0;
  outColor = vec4(c, 1.0);
}`;

/** Plain copy (used to blit the hand-drawn HUD-less scene when post is off). */
export const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
in vec2 vUV;
out vec4 outColor;
void main() {
  outColor = texture(uSrc, vUV);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(program)}`);
  return program;
}

/** A program plus a lazily filled uniform-location cache. */
export class Program {
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  /**
   * The last value sent to each uniform. A program keeps its uniforms between uses, so a value
   * that has not changed is not sent again (most of a frame's uniforms: the fog, the sun, the
   * texture units), and one the shader does not use is not sent at all: fewer calls into the GPU
   * process, which a phone pays for on every one.
   */
  private readonly last = new Map<string, Float32Array>();

  constructor(gl: WebGL2RenderingContext, vs: string, fs: string) {
    this.gl = gl;
    this.program = createProgram(gl, vs, fs);
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, l);
    }
    return l;
  }

  /** The uniform's location, or null when it need not be sent (unused, or already holding these values). */
  private send(name: string, n: number, a: number, b = 0, c = 0, d = 0): WebGLUniformLocation | null {
    const l = this.loc(name);
    if (l === null) return null;
    let v = this.last.get(name);
    if (!v) {
      v = new Float32Array(4).fill(Number.NaN);
      this.last.set(name, v);
    } else if (v[0] === Math.fround(a) && (n < 2 || v[1] === Math.fround(b)) && (n < 3 || v[2] === Math.fround(c)) && (n < 4 || v[3] === Math.fround(d))) return null;
    v[0] = a;
    v[1] = b;
    v[2] = c;
    v[3] = d;
    return l;
  }

  /** The same for a matrix (compared in full: most change every frame, a model's often does not). */
  private sendMatrix(name: string, m: Float32Array): WebGLUniformLocation | null {
    const l = this.loc(name);
    if (l === null) return null;
    const v = this.last.get(name);
    if (v && v.length === m.length) {
      let same = true;
      for (let i = 0; i < m.length; i += 1) {
        if (v[i] !== m[i]) {
          same = false;
          break;
        }
      }
      if (same) return null;
      v.set(m);
    } else this.last.set(name, Float32Array.from(m));
    return l;
  }

  f1(name: string, v: number): void {
    const l = this.send(name, 1, v);
    if (l) this.gl.uniform1f(l, v);
  }

  f2(name: string, a: number, b: number): void {
    const l = this.send(name, 2, a, b);
    if (l) this.gl.uniform2f(l, a, b);
  }

  f3(name: string, v: ArrayLike<number>): void {
    const l = this.send(name, 3, v[0]!, v[1]!, v[2]!);
    if (l) this.gl.uniform3f(l, v[0]!, v[1]!, v[2]!);
  }

  f4(name: string, a: number, b: number, c: number, d: number): void {
    const l = this.send(name, 4, a, b, c, d);
    if (l) this.gl.uniform4f(l, a, b, c, d);
  }

  i1(name: string, v: number): void {
    const l = this.send(name, 1, v);
    if (l) this.gl.uniform1i(l, v);
  }

  m4(name: string, m: Float32Array): void {
    const l = this.sendMatrix(name, m);
    if (l) this.gl.uniformMatrix4fv(l, false, m);
  }

  m3(name: string, m: Float32Array): void {
    const l = this.sendMatrix(name, m);
    if (l) this.gl.uniformMatrix3fv(l, false, m);
  }

  /** A vec4 array (compared in full, like a matrix). */
  v4(name: string, a: Float32Array): void {
    const l = this.sendMatrix(name, a);
    if (l) this.gl.uniform4fv(l, a);
  }

  /** A vec3 array. */
  v3(name: string, a: Float32Array): void {
    const l = this.sendMatrix(name, a);
    if (l) this.gl.uniform3fv(l, a);
  }
}
