// Chunk generation off the main thread. The worker rebuilds the same pure terrain and
// structure tables from the seed, generates natural chunk content on request and transfers
// the arrays back; the main thread replays player edits and lights the chunk.
import { buildStructures, type Structure } from './structures';
import { Terrain } from './terrain';
import { generateRaw, type GenSource } from './worldgen';
import { CHUNKS_X } from './world';

interface InitMsg {
  type: 'init';
  seed: number;
  /** The world's layout (see Terrain). */
  version: number;
}

interface GenMsg {
  type: 'gen';
  cx: number;
  cz: number;
  /** Sent when it has grown since the last request. */
  hoisted?: string[];
}

let source: (GenSource & { hoisted: Set<string> }) | null = null;

const scope = self as unknown as { onmessage: ((e: MessageEvent<InitMsg | GenMsg>) => void) | null; postMessage(msg: unknown, transfer: Transferable[]): void };

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const terrain = new Terrain(msg.seed, msg.version);
    const structures = buildStructures(terrain);
    const hoisted = new Set<string>();
    source = {
      terrain,
      structures,
      hoisted,
      structuresIn(cx: number, cz: number): Structure[] {
        return (structures.byChunk.get(cz * CHUNKS_X + cx) ?? []).filter((s) => !hoisted.has(s.id));
      },
    };
    return;
  }
  if (!source) return;
  if (msg.hoisted) {
    source.hoisted.clear();
    for (const id of msg.hoisted) source.hoisted.add(id);
  }
  const c = generateRaw(source, msg.cx, msg.cz);
  const meta = new Int32Array(c.meta.size * 2);
  let i = 0;
  for (const [k, v] of c.meta) {
    meta[i] = k;
    meta[i + 1] = v;
    i += 2;
  }
  const blocks = c.blocks;
  const ground = c.ground;
  const top = c.top;
  scope.postMessage({ type: 'chunk', cx: msg.cx, cz: msg.cz, blocks, ground, top, meta }, [blocks.buffer, ground.buffer, top.buffer, meta.buffer]);
};
