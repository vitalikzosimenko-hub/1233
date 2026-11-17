// Collects the game's user-visible English copy into a catalog for translation, and reports what
// each language file in src/game/lang is missing. Run: node_modules/.bin/tsx scripts/i18n-extract.ts [out.json]
//
// It reads plain strings, template literals (each `${...}` becomes {0}, {1}... in order), string
// concatenations, and inside HTML templates the text between tags plus aria-label / placeholder /
// title values. The game translates the same shapes on screen (see src/game/i18n.ts).
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript') as typeof import('typescript');
type Node = import('typescript').Node;
type SourceFile = import('typescript').SourceFile;

const GAME = path.join(ROOT, 'src/game');
/** Files with no player-facing copy (textures, meshing, pixel art, transport). */
const SKIP = /(^audio|^paint|creature-.*-skin|^player-skin|^textures|^gl\.ts|^mesher|^light|^lod|^math3d|^rng|^physics|^raycast|^walker|^body|^gen-worker|^worldgen|^font|^hud-icons|^render|^input|^runtime|^session|^i18n|^lang)/;

/** Copy assembled at runtime from parts the scan cannot see whole. */
const EXTRA: string[] = [
  ...['Sand', 'Mire', 'Canyon', 'Ice', 'Cinder'].flatMap((s) => ['Brute', 'Warden', 'Titan', 'Colossus'].map((k) => `${s} ${k}`)),
  'Loading...',
  // Key caps (coach.ts) and labels set as attributes.
  'SPACE', 'MOUSE', 'WHEEL', 'CLICK', 'RIGHT CLICK', 'Pause', 'Move', 'Language',
  // The hens' eggs (game.ts: "Your 2 hens laid eggs").
  'hen', '{0} hens',
  // Words filled into sentences ("pick one and tap to throw it").
  'tap', 'Space',
  // The graphics setting (render.ts's quality names, upper-cased in the pause menu).
  'FAST', 'HIGH', 'ULTRA',
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'lang') out.push(...files(p));
    } else if (f.endsWith('.ts') && !SKIP.test(f)) out.push(p);
  }
  return out;
}

/** Properties whose string values are code (ids, keys, art), never shown as written. */
const SKIP_PROPS = new Set(['rows', 'icon', 'art', 'id', 'kind', 'tex', 'tile', 'tiles', 'key', 'lesson', 'zone', 'type', 'role', 'station', 'sfx', 'material', 'guardian', 'home', 'cls', 'tone', 'event', 'sound', 'skin', 'shape', 'tint', 'color', 'out', 'page', 'relic', 'art2', 'act', 'potion', 'effect']);

/** String methods whose string arguments are probes, not copy. */
const INSPECT = new Set(['startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf', 'split', 'replace', 'replaceAll', 'match', 'matchAll', 'test', 'getItem', 'setItem', 'removeItem', 'getElementById', 'querySelector', 'querySelectorAll', 'closest', 'getAttribute', 'setAttribute', 'hasAttribute', 'toggle', 'add', 'remove', 'contains', 'addEventListener', 'removeEventListener', 'get', 'has', 'set', 'delete', 'getContext', 'play', 'sfx', 'sfxAt', 'loop', 'ear', 'playMusic', 'ambience', 'report', 'reportEvent', 'registerAction', 'feat', 'lessonSeen', 'crewSay', 'villagerReact', 'remote', 'send', 'call', 'addPage', 'grantRelic', 'story', 'iconURL', 'artURL', 'tex', 'tileRect', 'subRect', 'uvs', 'hasRelic', 'findBlock', 'region', 'debris', 'particles']);

/** Key names and alphabets that look like words. */
const NOT_COPY = /^(Key[A-Z]|Digit\d|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Shift(Left|Right)?|Control(Left|Right)?|[0-9A-Z]{20,})$/;

type Piece = { lit: string } | { expr: true };
const catalog = new Map<string, Set<string>>();

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const CLASSY = /^[a-z0-9][a-z0-9_-]*( [a-z0-9][a-z0-9_-]*)*$/;
const WORDY = /\b(the|a|an|to|of|and|you|your|is|it|in|on|at|for|with|by|from|no|not|out|up|off|tap|hold|press|or)\b/;
/** The stylesheet's class names: lower-case words that are all class names are a class list. */
const CLASSES = new Set([...readFileSync(path.join(GAME, 'ui.css'), 'utf8').matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]!));
const classList = (bare: string): boolean => bare.split(' ').every((w) => CLASSES.has(w) || /[-_\d]/.test(w) || w.length <= 2);
function looksLikeCopy(k: string): boolean {
  const bare = k.replace(/\{\d+\}/g, '').trim();
  if ((bare.match(/\p{L}/gu)?.length ?? 0) < 2) return false;
  if (/^[.#][\w-]+([ .#:>[]|$)|^\[[\w-]+[\]=~^$*|]|^\{"|\bpx\b|\d+px|rgba?\(|^#[0-9a-f]{3,8}$|https?:|\.(webp|png|mp3|ts|json)\b|^data:|^\/|=>|\bvar\(|\bcalc\(|\burl\(|^[a-z]+\/[a-z+.-]+$/i.test(bare)) return false;
  // One lower-case word is an identifier, unless it carries a value ("{0} blocks", "from {0}").
  const word = /^[a-z][a-zA-Z0-9]*$/.test(bare) && !(k !== bare && / /.test(k.trim()) && /^[a-z]{2,}$/.test(bare));
  if (word || /^[a-z0-9_:.-]+$/.test(bare) && !(k !== bare && / /.test(k.trim()) && /^[a-z]{2,}$/.test(bare))) return false;
  if (CLASSY.test(bare) && !WORDY.test(bare) && (classList(bare) || (!bare.includes(' ') && k === bare))) return false;
  if (/^[A-Z.]{3,}$/.test(bare) && /\./.test(bare)) return false;
  // (A CSS transform: "rotate({0}deg)".)
  if (/^(rotate|translate|scale|matrix|skew)[XYZ3d]*\(/.test(bare)) return false;
  // (An SVG path's data: drawing commands and numbers.)
  if (/^[MmLlHhVvCcSsQqTtAaZz\d\s.,-]+$/.test(bare) && /\d/.test(bare)) return false;
  return true;
}

function addRun(pieces: Piece[], where: string): void {
  let key = '';
  let n = 0;
  for (const p of pieces) key += 'lit' in p ? decode(p.lit) : `{${n++}}`;
  key = normalize(key);
  if (!key || NOT_COPY.test(key) || !looksLikeCopy(key)) return;
  if (!catalog.has(key)) catalog.set(key, new Set());
  catalog.get(key)!.add(where);
}

/** Text between tags, and translatable attribute values, of an HTML-bearing template. */
function htmlRuns(pieces: Piece[], where: string): void {
  type Tok = { c: string } | { e: true };
  const toks: Tok[] = [];
  for (const p of pieces) {
    if ('lit' in p) for (const c of p.lit) toks.push({ c });
    else toks.push({ e: true });
  }
  let inTag = false;
  let run: Piece[] = [];
  let tagBuf = '';
  let quote = '';
  let attrName = '';
  let attrRun: Piece[] | null = null;
  const flush = (): void => {
    if (run.length) addRun(run, where);
    run = [];
  };
  const push = (list: Piece[], c: string): void => {
    const last = list[list.length - 1];
    if (last && 'lit' in last) last.lit += c;
    else list.push({ lit: c });
  };
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]!;
    if (!inTag) {
      if ('c' in t && t.c === '<') {
        const nx = toks[i + 1];
        if (nx && 'c' in nx && /[a-zA-Z/!]/.test(nx.c)) {
          flush();
          inTag = true;
          tagBuf = '';
          continue;
        }
      }
      if ('e' in t) run.push({ expr: true });
      else push(run, t.c);
      continue;
    }
    if ('e' in t) {
      if (attrRun) attrRun.push({ expr: true });
      continue;
    }
    const c = t.c;
    if (quote) {
      if (c === quote) {
        if (attrRun && /^(aria-label|placeholder|title)$/i.test(attrName)) addRun(attrRun, where);
        attrRun = null;
        quote = '';
      } else if (attrRun) push(attrRun, c);
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      attrName = tagBuf.match(/([a-zA-Z-]+)\s*=\s*$/)?.[1] ?? '';
      attrRun = [];
      continue;
    }
    if (c === '>') {
      inTag = false;
      continue;
    }
    tagBuf += c;
  }
  flush();
}

function hasHtml(pieces: Piece[]): boolean {
  return /<\/?[a-zA-Z!][^>]*>|<[a-zA-Z]+[\s>]/.test(pieces.map((p) => ('lit' in p ? p.lit : '\u0000')).join(''));
}

function isStringy(node: Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

function piecesOf(node: Node): Piece[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ lit: node.text }];
  if (ts.isTemplateExpression(node)) {
    const out: Piece[] = [{ lit: node.head.text }];
    for (const span of node.templateSpans) out.push({ expr: true }, { lit: span.literal.text });
    return out;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...(piecesOf(node.left) ?? [{ expr: true }]), ...(piecesOf(node.right) ?? [{ expr: true }])];
  }
  if (ts.isParenthesizedExpression(node)) return piecesOf(node.expression);
  return null;
}

function plusWithString(node: Node): boolean {
  if (isStringy(node)) return true;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return plusWithString(node.left) || plusWithString(node.right);
  if (ts.isParenthesizedExpression(node)) return plusWithString(node.expression);
  return false;
}

function scan(file: string): void {
  const sf: SourceFile = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const rel = path.relative(GAME, file);
  const at = (n: Node): string => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const take = (n: Node): void => {
    const p = piecesOf(n);
    if (!p) return;
    if (hasHtml(p)) htmlRuns(p, at(n));
    else addRun(p, at(n));
  };
  const visit = (node: Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    // Text the code inspects (msg.startsWith('Too far')) or keys it asks about is not shown as written.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && INSPECT.has(node.expression.name.text)) {
      visit(node.expression.expression);
      node.arguments.forEach((a) => { if (!isStringy(a)) visit(a); });
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      // (Ids, art keys, texture names and pixel-art rows are code, not copy.)
      const name = node.name.getText(sf).replace(/['"]/g, '');
      if (SKIP_PROPS.has(name) && !ts.isObjectLiteralExpression(node.initializer)) return;
      return visit(node.initializer);
    }
    if (ts.isCaseClause(node)) return node.statements.forEach(visit);
    if (ts.isBinaryExpression(node)) {
      const k = node.operatorToken.kind;
      if (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken) {
        if (!isStringy(node.left)) visit(node.left);
        if (!isStringy(node.right)) visit(node.right);
        return;
      }
      if (k === ts.SyntaxKind.PlusToken && plusWithString(node)) {
        take(node);
        const inner = (n: Node): void => {
          if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            inner(n.left);
            inner(n.right);
          } else if (ts.isTemplateExpression(n)) n.templateSpans.forEach((s) => visit(s.expression));
          else if (!isStringy(n)) visit(n);
        };
        inner(node);
        return;
      }
    }
    if (isStringy(node)) {
      take(node);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    node.forEachChild(visit);
  };
  visit(sf);
}

for (const f of files(GAME)) scan(f);
for (const k of EXTRA) if (!catalog.has(k)) catalog.set(k, new Set(['(runtime)']));

const entries = [...catalog.entries()].map(([k, w]) => ({ k, at: [...w].slice(0, 3) }));
const out = process.argv[2];
if (out) writeFileSync(out, JSON.stringify(entries, null, 1));
console.log(`${entries.length} strings`);
// What each language still lacks.
for (const f of existsSync(path.join(GAME, 'lang')) ? readdirSync(path.join(GAME, 'lang')) : []) {
  if (!f.endsWith('.json')) continue;
  const dict = JSON.parse(readFileSync(path.join(GAME, 'lang', f), 'utf8')) as Record<string, string>;
  const missing = entries.filter((e) => !(e.k in dict));
  console.log(`${f}: ${Object.keys(dict).length} entries, ${missing.length} missing`);
  for (const e of missing.slice(0, 40)) console.log(`  - ${JSON.stringify(e.k)} (${e.at[0]})`);
}
