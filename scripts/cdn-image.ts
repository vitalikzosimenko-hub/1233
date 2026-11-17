// @ts-nocheck
// Shared build plugin for Vite game templates.
// Source of truth: src/game_templates/_shared/cdn-image.ts
// Copies are written by src/game_templates/_ci/sync-cdn-image.mjs.
// 2d_combos keeps scripts/cdn-localize.ts, which also rewrites atlas JSON and KTX2.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

const MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_HOSTS = ["cdn.combos.fun"];

export interface CompressedImage {
  bytes: Uint8Array;
  ext: string;
}

export interface CdnImageDeps {
  download: (url: string) => Promise<Uint8Array>;
  emitFile: (asset: { fileName: string; source: Uint8Array }) => string;
  compressImage?: (input: Uint8Array, ext: string) => Promise<CompressedImage>;
  hosts?: readonly string[];
}

interface Literal {
  start: number;
  end: number;
  value: string;
}

interface ScanState {
  code: string;
  i: number;
  literals: Literal[];
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

/** Keep WebP only when it is a smaller non-empty payload. */
export function selectCompressedImage(
  original: Uint8Array,
  webp: Uint8Array,
  fallbackExt: string,
): CompressedImage {
  if (webp.byteLength > 0 && webp.byteLength < original.byteLength) {
    return { bytes: webp, ext: "webp" };
  }
  return { bytes: original, ext: fallbackExt };
}

export function isCdnImageModule(id: string): boolean {
  const file = id.split("?", 1)[0] ?? id;
  if (file.includes("\0") || file.includes("node_modules")) return false;
  return /\.(?:[cm]?[jt]sx?)$/.test(file);
}

export function cdnImagePlugin(options: CdnImageDeps = {}): Plugin {
  let cacheDir = "";
  const inflight = new Map<string, Promise<Uint8Array>>();
  const hosts = hostSet(options.hosts);

  return {
    name: "cdn-image",
    apply: "build" as const,
    enforce: "post" as const,
    configResolved(config: { root: string }) {
      cacheDir = path.join(config.root, "node_modules/.cache/cdn-image");
    },
    async transform(this: {
      emitFile(asset: { type: "asset"; fileName: string; source: Uint8Array }): string;
    }, code: string, id: string) {
      if (!isCdnImageModule(id)) return null;
      const result = await localizeCdnImageSource(code, {
        hosts: options.hosts,
        compressImage: options.compressImage,
        download: options.download ?? ((url) => downloadCached(url, cacheDir, hosts, inflight)),
        emitFile: (asset) =>
          this.emitFile({
            type: "asset",
            fileName: asset.fileName,
            source: asset.source,
          }),
      });
      if (!result.changed) return null;
      return { code: result.code, map: null };
    },
  };
}

export async function localizeCdnImageSource(
  code: string,
  deps: CdnImageDeps,
): Promise<{ code: string; changed: boolean }> {
  const hosts = hostSet(deps.hosts);
  const literals = collectLiterals(code).filter((literal) => {
    return imageExtension(literal.value, hosts) !== null && !isModuleSpecifier(code, literal.start);
  });
  if (literals.length === 0) return { code, changed: false };

  const downloaded = new Map<string, Uint8Array>();
  await Promise.all(
    [...new Set(literals.map((literal) => literal.value))].map(async (url) => {
      try {
        const bytes = await deps.download(url);
        if (bytes.byteLength === 0) {
          throw new Error(`[cdn-image] ${url} is empty`);
        }
        if (bytes.byteLength > MAX_BYTES) {
          throw new Error(`[cdn-image] ${url} exceeds ${MAX_BYTES} bytes`);
        }
        downloaded.set(url, bytes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("[cdn-image]")) throw error;
        throw new Error(`[cdn-image] failed to download ${url}: ${message}`);
      }
    }),
  );

  const compress = deps.compressImage ?? defaultCompressImage;
  const compressed = new Map<string, CompressedImage>();
  const files = new Map<string, string>();
  const replacements: Replacement[] = [];
  for (const literal of literals) {
    let image = compressed.get(literal.value);
    if (!image) {
      const ext = imageExtension(literal.value, hosts);
      if (!ext) continue;
      image = await compress(downloaded.get(literal.value)!, ext);
      compressed.set(literal.value, image);
    }
    const hash = createHash("sha256").update(image.bytes).digest("hex").slice(0, 16);
    const fileName = `assets/cdn/${hash}.${image.ext}`;
    let referenceId = files.get(fileName);
    if (!referenceId) {
      referenceId = deps.emitFile({ fileName, source: image.bytes });
      files.set(fileName, referenceId);
    }
    replacements.push({
      start: literal.start,
      end: literal.end,
      text: `import.meta.ROLLUP_FILE_URL_${referenceId}`,
    });
  }

  return { code: applyReplacements(code, replacements), changed: replacements.length > 0 };
}

async function defaultCompressImage(input: Uint8Array, ext: string): Promise<CompressedImage> {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;
  const webp = await sharp(input, { failOn: "none" }).webp({ quality: 80, alphaQuality: 80 }).toBuffer();
  return selectCompressedImage(input, webp, ext);
}

function hostSet(hosts?: readonly string[]): Set<string> {
  return new Set((hosts ?? DEFAULT_HOSTS).map((host) => host.toLowerCase()));
}

function imageExtension(value: string, hosts: ReadonlySet<string>): string | null {
  if (value.length === 0 || value.length > 2048 || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") return null;
  if (!hosts.has(host)) return null;
  const ext = path.posix.extname(url.pathname).slice(1).toLowerCase();
  if (ext !== "png" && ext !== "jpg" && ext !== "jpeg") return null;
  return ext === "jpeg" ? "jpg" : ext;
}

function isModuleSpecifier(code: string, start: number): boolean {
  let index = start;
  while (index > 0 && /\s/.test(code[index - 1] ?? "")) index -= 1;
  if (code[index - 1] === "(") index -= 1;
  while (index > 0 && /\s/.test(code[index - 1] ?? "")) index -= 1;
  let wordStart = index;
  while (wordStart > 0 && /[A-Za-z0-9_$]/.test(code[wordStart - 1] ?? "")) wordStart -= 1;
  const word = code.slice(wordStart, index);
  return word === "import" || word === "export" || word === "from" || word === "require";
}

function collectLiterals(code: string): Literal[] {
  const state: ScanState = { code, i: 0, literals: [] };
  scan(state, false);
  return state.literals;
}

function scan(state: ScanState, inExpression: boolean): void {
  let depth = inExpression ? 1 : 0;
  while (state.i < state.code.length) {
    const current = state.code[state.i] ?? "";
    const next = state.code[state.i + 1] ?? "";
    if (current === "/" && next === "/") {
      state.i += 2;
      while (state.i < state.code.length && state.code[state.i] !== "\n") state.i += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      state.i += 2;
      const end = state.code.indexOf("*/", state.i);
      state.i = end < 0 ? state.code.length : end + 2;
      continue;
    }
    if (current === "'" || current === '"') {
      readQuoted(state, current);
      continue;
    }
    if (current === "`") {
      readTemplate(state);
      continue;
    }
    if (inExpression && current === "{") {
      depth += 1;
      state.i += 1;
      continue;
    }
    if (inExpression && current === "}") {
      depth -= 1;
      state.i += 1;
      if (depth === 0) return;
      continue;
    }
    state.i += 1;
  }
}

function readQuoted(state: ScanState, quote: string): void {
  const start = state.i;
  let i = start + 1;
  let value = "";
  let skip = false;
  while (i < state.code.length) {
    const current = state.code[i] ?? "";
    if (current === "\\") {
      skip = true;
      i += 2;
      continue;
    }
    if (current === "\n" || current === "\r") {
      state.i = i;
      return;
    }
    if (current === quote) {
      if (!skip) state.literals.push({ start, end: i + 1, value });
      state.i = i + 1;
      return;
    }
    value += current;
    i += 1;
  }
  state.i = i;
}

function readTemplate(state: ScanState): void {
  const start = state.i;
  state.i += 1;
  let plain = true;
  let chunk = "";
  while (state.i < state.code.length) {
    const current = state.code[state.i] ?? "";
    if (current === "\\") {
      plain = false;
      state.i += 2;
      continue;
    }
    if (current === "`") {
      if (plain) state.literals.push({ start, end: state.i + 1, value: chunk });
      state.i += 1;
      return;
    }
    if (current === "$" && state.code[state.i + 1] === "{") {
      plain = false;
      state.i += 2;
      scan(state, true);
      chunk = "";
      continue;
    }
    chunk += current;
    state.i += 1;
  }
}

function applyReplacements(code: string, replacements: Replacement[]): string {
  const ordered = [...replacements].sort((left, right) => right.start - left.start);
  let next = code;
  for (const replacement of ordered) {
    next = next.slice(0, replacement.start) + replacement.text + next.slice(replacement.end);
  }
  return next;
}

async function downloadCached(
  url: string,
  cacheDir: string,
  hosts: ReadonlySet<string>,
  inflight: Map<string, Promise<Uint8Array>>,
): Promise<Uint8Array> {
  const pending = inflight.get(url);
  if (pending) return pending;
  const task = readOrFetch(url, cacheDir, hosts);
  inflight.set(url, task);
  try {
    return await task;
  } catch (error) {
    inflight.delete(url);
    throw error;
  }
}

async function readOrFetch(
  url: string,
  cacheDir: string,
  hosts: ReadonlySet<string>,
): Promise<Uint8Array> {
  const file = path.join(cacheDir, createHash("sha256").update(url).digest("hex"));
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "user-agent": "combos-template-builder" },
  });
  if (!response.ok) {
    throw new Error(`[cdn-image] failed to download ${url}: ${response.status}`);
  }
  const finalURL = new URL(response.url);
  if (finalURL.protocol !== "https:" || !hosts.has(finalURL.hostname.toLowerCase())) {
    throw new Error(`[cdn-image] ${url} redirected to ${response.url}`);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) {
    throw new Error(`[cdn-image] ${url} exceeds ${MAX_BYTES} bytes`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_BYTES) {
    throw new Error(`[cdn-image] ${url} exceeds ${MAX_BYTES} bytes`);
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, body);
  return body;
}
