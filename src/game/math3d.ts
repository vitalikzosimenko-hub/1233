// Minimal column-major 4x4 matrix helpers for the WebGL renderer.
export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function ortho(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

/** Unit view direction: yaw 0 looks along +X, positive pitch looks up. */
export function forward(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return [c * Math.cos(yaw), Math.sin(pitch), c * Math.sin(yaw)];
}

/** Horizontal right-hand vector for a yaw. */
export function rightOf(yaw: number): Vec3 {
  return [-Math.sin(yaw), 0, Math.cos(yaw)];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** View matrix for a camera at eye looking along dir (world up = +Y). */
export function lookDir(out: Mat4, eye: Vec3, dir: Vec3): Mat4 {
  return lookDirUp(out, eye, dir, [0, 1, 0]);
}

/** View matrix with an explicit up hint (for cameras that may look straight down). */
export function lookDirUp(out: Mat4, eye: Vec3, dir: Vec3, upHint: Vec3): Mat4 {
  const f = normalize(dir);
  const s = normalize(cross(f, upHint));
  const u = cross(s, f);
  out[0] = s[0];
  out[1] = u[0];
  out[2] = -f[0];
  out[3] = 0;
  out[4] = s[1];
  out[5] = u[1];
  out[6] = -f[1];
  out[7] = 0;
  out[8] = s[2];
  out[9] = u[2];
  out[10] = -f[2];
  out[11] = 0;
  out[12] = -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]);
  out[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
  out[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
  out[15] = 1;
  return out;
}

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const r = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      r[col * 4 + row] = sum;
    }
  }
  out.set(r);
  return out;
}

/** Frustum planes (a, b, c, d) extracted from a view-projection matrix. */
export function frustumPlanes(m: Mat4): Float32Array {
  const p = new Float32Array(24);
  const rows = [
    [m[3]! + m[0]!, m[7]! + m[4]!, m[11]! + m[8]!, m[15]! + m[12]!],
    [m[3]! - m[0]!, m[7]! - m[4]!, m[11]! - m[8]!, m[15]! - m[12]!],
    [m[3]! + m[1]!, m[7]! + m[5]!, m[11]! + m[9]!, m[15]! + m[13]!],
    [m[3]! - m[1]!, m[7]! - m[5]!, m[11]! - m[9]!, m[15]! - m[13]!],
    [m[3]! + m[2]!, m[7]! + m[6]!, m[11]! + m[10]!, m[15]! + m[14]!],
    [m[3]! - m[2]!, m[7]! - m[6]!, m[11]! - m[10]!, m[15]! - m[14]!],
  ];
  rows.forEach((r, i) => {
    const l = Math.hypot(r[0]!, r[1]!, r[2]!) || 1;
    for (let k = 0; k < 4; k += 1) p[i * 4 + k] = r[k]! / l;
  });
  return p;
}

export function sphereVisible(planes: Float32Array, x: number, y: number, z: number, r: number): boolean {
  for (let i = 0; i < 6; i += 1) {
    if (planes[i * 4]! * x + planes[i * 4 + 1]! * y + planes[i * 4 + 2]! * z + planes[i * 4 + 3]! < -r) return false;
  }
  return true;
}
