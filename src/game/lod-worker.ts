// Distant terrain off the main thread. The worker rebuilds the same pure terrain from the seed
// and builds LOD tiles (the land in steps of a given column size, or its stand-in trees) on
// request, transferring the vertex and index bytes back; the main thread only uploads them.
import type { MeshBuilder } from './gl';
import { buildLodTile, buildLodTrees, useFaceColors } from './lod';
import { useLands } from './mesher';
import { Terrain } from './terrain';
import { adoptLayers } from './textures';

interface InitMsg {
  type: 'init';
  seed: number;
  /** The world's layout (see Terrain). */
  version: number;
  /** Texture-array layers of the textures the tiles use, as the main thread numbered them. */
  layers: Array<[string, number]>;
  /** The blocks' mean colours (see measureFaceColors). */
  colors: Float32Array;
}

interface TileMsg {
  type: 'land' | 'trees';
  ti: number;
  tj: number;
  /** Blocks to a side of the land's columns. */
  cols: number;
}

let terrain: Terrain | null = null;

const scope = self as unknown as { onmessage: ((e: MessageEvent<InitMsg | TileMsg>) => void) | null; postMessage(msg: unknown, transfer: Transferable[]): void };

/** A builder's bytes, copied to exact size for the transfer. */
function bytes(b: MeshBuilder): { v: Uint8Array; i: Uint32Array } {
  return { v: b.vertexBytes().slice(), i: b.index.slice(0, b.count) };
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    adoptLayers(msg.layers);
    useFaceColors(msg.colors);
    terrain = new Terrain(msg.seed, msg.version);
    useLands(terrain);
    return;
  }
  if (!terrain) return;
  if (msg.type === 'land') {
    const t = buildLodTile(terrain, msg.ti, msg.tj, msg.cols);
    const g = bytes(t.ground);
    const w = bytes(t.water);
    scope.postMessage({ type: 'land', ti: msg.ti, tj: msg.tj, cols: t.cols, minY: t.minY, maxY: t.maxY, gv: g.v, gi: g.i, wv: w.v, wi: w.i }, [g.v.buffer, g.i.buffer, w.v.buffer, w.i.buffer]);
    return;
  }
  const t = buildLodTrees(terrain, msg.ti, msg.tj);
  const m = bytes(t.mesh);
  scope.postMessage({ type: 'trees', ti: msg.ti, tj: msg.tj, maxY: t.maxY, gv: m.v, gi: m.i }, [m.v.buffer, m.i.buffer]);
};
