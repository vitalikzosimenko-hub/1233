// Ground streaming in, meshed off the main thread. The main thread copies a section with its
// border (copySection) and posts it; the worker meshes it with the very same code (meshCopied)
// and transfers the vertex and index bytes back, so the main thread only uploads them. A phone
// marching through new land no longer stalls a frame on each chunk. (Edits are meshed at once on
// the main thread: a block mined or placed shows the same frame.)
import { MeshBuilder } from './gl';
import { meshCopied, useLands, type MeshOut } from './mesher';
import { Terrain } from './terrain';
import { adoptLayers } from './textures';

interface InitMsg {
  type: 'init';
  seed: number;
  version: number;
  /** Texture-array layers, as the main thread numbered them. */
  layers: Array<[string, number]>;
}

interface Section {
  /** Which section, and which copy of it (a newer one may be on its way). */
  key: number;
  ver: number;
  ox: number;
  oy: number;
  oz: number;
  ids: Uint8Array;
  sky: Uint8Array;
  blk: Uint8Array;
  meta: Int8Array;
}

/** A chunk's sections, in one message (they go back in one too). */
interface MeshMsg {
  type: 'mesh';
  items: Section[];
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<InitMsg | MeshMsg>) => void) | null; postMessage(msg: unknown, transfer: Transferable[]): void };

const out: MeshOut = { opaque: new MeshBuilder(16384), cutout: new MeshBuilder(8192), water: new MeshBuilder(2048) };

/** A builder's bytes, copied to exact size for the transfer. */
function bytes(b: MeshBuilder): { v: Uint8Array; i: Uint32Array } {
  return { v: b.vertexBytes().slice(), i: b.index.slice(0, b.count) };
}

let ready = false;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    adoptLayers(msg.layers);
    useLands(new Terrain(msg.seed, msg.version));
    ready = true;
    return;
  }
  if (!ready) return;
  const replies = [];
  const buffers: ArrayBuffer[] = [];
  for (const item of msg.items) {
    meshCopied(item, out);
    const o = bytes(out.opaque);
    const c = bytes(out.cutout);
    const w = bytes(out.water);
    // (The copy's arrays go back too: the main thread copies the next section into them.)
    replies.push({ key: item.key, ver: item.ver, ov: o.v, oi: o.i, cv: c.v, ci: c.i, wv: w.v, wi: w.i, ids: item.ids, sky: item.sky, blk: item.blk, meta: item.meta });
    buffers.push(o.v.buffer as ArrayBuffer, o.i.buffer as ArrayBuffer, c.v.buffer as ArrayBuffer, c.i.buffer as ArrayBuffer, w.v.buffer as ArrayBuffer, w.i.buffer as ArrayBuffer);
    buffers.push(item.ids.buffer as ArrayBuffer, item.sky.buffer as ArrayBuffer, item.blk.buffer as ArrayBuffer, item.meta.buffer as ArrayBuffer);
  }
  scope.postMessage(replies, buffers);
};
