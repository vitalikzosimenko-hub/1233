// The game's languages. Its copy is written in English; each other language is a dictionary keyed by
// the English text (src/game/lang/<code>.json, catalogued by scripts/i18n-extract.ts), where `{0}`,
// `{1}`... stand for the parts filled in at runtime ("Day {0}").
//
// Text is translated where it reaches the screen. The interface writes through setText / setHTML
// (translated at once, so layout measures the real words) and a MutationObserver over the interface
// catches anything else as it appears. Every text node remembers its English source, so switching
// language re-translates the whole screen in place. Canvas text calls tr() itself.
//
// Matching a finished string ("NIGHT 3 · THUNDERSTORM · 45%") against the dictionary: an exact key,
// the same key in capitals or lower case (names the code re-cased), a pattern with its slots filled in
// (each slot's text translated in turn: "· THUNDERSTORM" is a key of its own), or its parts: the
// pieces between " · ", a line in quotes, a full stop, a trailing number or clock, a leading separator,
// the things in a list.

export type Lang = 'en' | 'es' | 'pt' | 'id' | 'zh' | 'hi';

/** The languages offered, by their own names (and the short form the title's switch shows). */
export const LANGS: ReadonlyArray<{ code: Lang; name: string; short: string; html: string }> = [
  { code: 'en', name: 'English', short: 'EN', html: 'en' },
  { code: 'es', name: 'Español', short: 'ES', html: 'es' },
  { code: 'pt', name: 'Português', short: 'PT', html: 'pt-BR' },
  { code: 'id', name: 'Bahasa Indonesia', short: 'ID', html: 'id' },
  { code: 'zh', name: '中文', short: '中文', html: 'zh-CN' },
  { code: 'hi', name: 'हिंदी', short: 'हिंदी', html: 'hi' },
];

const KEY = 'block-fortress-lang';

/** The few words shown before any dictionary has loaded. */
const EARLY: Partial<Record<Lang, string>> = { es: 'Cargando...', pt: 'Carregando...', id: 'Memuat...', zh: '加载中...', hi: 'लोड हो रहा है...' };

const LOADERS = import.meta.glob<{ default: Record<string, string> }>('./lang/*.json');

interface Pattern {
  /** Slots matched as short as they can be, and (when that leaves one untranslated) as long. */
  re: RegExp;
  greedy: RegExp;
  out: string;
  /** Literal characters (the more, the more specific). */
  weight: number;
}

interface Compiled {
  exact: Map<string, string>;
  /** Keys in lower case, for text the code upper-cased ("SUNSCORCH DESERT"). */
  folded: Map<string, string>;
  /** Patterns by their first word (and those that open with a slot). */
  byHead: Map<string, Pattern[]>;
  open: Pattern[];
}

let lang: Lang = 'en';
let compiled: Compiled | null = null;
const cache = new Map<string, string>();
/** Strings with letters that found no translation (a debugging aid: see __bfI18n). */
const misses = new Set<string>();
const listeners = new Set<() => void>();

const SLOT = /\{(\d+)\}/g;
/** Text worth looking up has a word in it (not "45m", "3/7", a key letter). */
const WORDY = /\p{L}{2}/u;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function headWord(s: string): string {
  return s.slice(0, s.search(/[\s{]|$/)).toLowerCase();
}

function isUpper(s: string): boolean {
  return /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(dict: Record<string, string>): Compiled {
  const exact = new Map<string, string>();
  const folded = new Map<string, string>();
  const byHead = new Map<string, Pattern[]>();
  const open: Pattern[] = [];
  for (const [rawKey, value] of Object.entries(dict)) {
    const key = norm(rawKey);
    if (!key || !value) continue;
    if (!key.includes('{')) {
      exact.set(key, value);
      if (!folded.has(key.toLowerCase())) folded.set(key.toLowerCase(), value);
      continue;
    }
    // Slots match lazily (and may be empty: "NIGHT {0}{1}" with no theme); a space beside a slot may
    // be missing (the slot was markup, or empty at the end of the text). Of two slots run together the
    // first is never the empty one ("NIGHT 1 · 6%": the 1 is the night, not the theme).
    const parts = key.split(SLOT);
    let src = '^';
    let weight = 0;
    for (let i = 0; i < parts.length; i += 1) {
      if (i % 2 === 0) {
        let lit = escape(parts[i]!);
        if (i > 0) lit = lit.replace(/^ /, ' ?');
        if (i < parts.length - 1) lit = lit.replace(/ $/, ' ?');
        src += lit;
        weight += parts[i]!.length;
      } else src += parts[i + 1] === '' && i + 2 < parts.length ? `(?<s${parts[i]}>.+?)` : `(?<s${parts[i]}>.*?)`;
    }
    let pattern: Pattern;
    try {
      pattern = { re: new RegExp(`${src}$`, 'u'), greedy: new RegExp(`${src.replace(/>\.([*+])\?\)/g, '>.$1)')}$`, 'u'), out: value, weight };
    } catch {
      continue; // (a key naming the same slot twice)
    }
    // (A first word run into a slot, "+{0} emeralds", has no fixed first word to file it under.)
    if (key[key.search(/[\s{]|$/)] === '{') open.push(pattern);
    else {
      const head = headWord(key);
      const list = byHead.get(head) ?? [];
      list.push(pattern);
      byHead.set(head, list);
    }
  }
  const bySpecificity = (a: Pattern, b: Pattern): number => b.weight - a.weight;
  for (const list of byHead.values()) list.sort(bySpecificity);
  open.sort(bySpecificity);
  return { exact, folded, byHead, open };
}

function locale(): string {
  return LANGS.find((l) => l.code === lang)?.html ?? 'en';
}

/** A pattern's translation with its slots filled in (and how many slots with words stayed English). */
function fill(c: Compiled, p: Pattern, m: RegExpExecArray, depth: number): { text: string; misses: number } {
  const slots = m.groups ?? {};
  let misses = 0;
  const text = p.out.replace(SLOT, (_, n: string) => {
    const v = slots[`s${n}`] ?? '';
    const t = translate(c, v, depth + 1);
    if (t === null && WORDY.test(v)) misses += 1;
    return t ?? v;
  });
  // (A slot may take in the space beside it as well, which the translation already has.)
  return { text: text.replace(/ {2,}/g, ' '), misses };
}

function viaPattern(c: Compiled, s: string, depth: number): string | undefined {
  const tryList = (list: Pattern[] | undefined): string | undefined => {
    if (!list) return undefined;
    for (const p of list) {
      const m = p.re.exec(s);
      if (!m) continue;
      const first = fill(c, p, m, depth);
      // ("Castle ruins · loot · 117 blocks": the first slot is the longer one.)
      const g = first.misses > 0 ? p.greedy.exec(s) : null;
      if (g) {
        const second = fill(c, p, g, depth);
        if (second.misses < first.misses) return second.text;
      }
      return first.text;
    }
    return undefined;
  };
  return tryList(c.byHead.get(headWord(s))) ?? tryList(c.open);
}

const QUOTES: Record<string, string> = { '“': '”', '"': '"', '«': '»', '‘': '’' };
const ZH_STOPS: Record<string, string> = { '.': '。', '!': '！', '?': '？', ':': '：' };

/** A sentence's closing marks in the language's own punctuation (Chinese full width; Hindi ends on the danda). */
function closing(marks: string): string {
  if (lang === 'zh') return marks.replace(/[.!?:]/g, (p) => ZH_STOPS[p]!);
  if (lang === 'hi' && marks === '.') return '।';
  return marks;
}

/** A string cut at a separator, each piece on its own (after " · " a piece may be held with its dot: "· SEALED"). */
function viaSplit(c: Compiled, s: string, sep: string, depth: number): string | undefined {
  const at = s.indexOf(sep);
  if (at < 0) return undefined;
  const pieces = sep === ': ' ? [s.slice(0, at), s.slice(at + sep.length)] : s.split(sep);
  let any = false;
  const out = pieces.map((piece, i) => {
    let t = translate(c, piece, depth + 1);
    if (t === null && i > 0 && sep === ' · ') t = translate(c, `· ${piece}`, depth + 1)?.replace(/^\s*·\s*/, '') ?? null;
    if (t !== null) any = true;
    return t ?? piece;
  });
  if (!any) return undefined;
  // (Chinese takes its own full-width colon, and its enumeration comma between the things in a list.)
  return out.join(lang === 'zh' && sep === ': ' ? '：' : lang === 'zh' && sep === ', ' ? '、' : sep);
}

/** Pieces of a string the dictionary does not hold whole: quotes, " · " parts, a full stop, figures, a list. */
function viaParts(c: Compiled, s: string, depth: number): string | undefined {
  // “A line in quotes”.
  const close = QUOTES[s[0]!];
  if (close && s.length > 2 && s.endsWith(close)) {
    const inner = translate(c, s.slice(1, -1), depth + 1);
    if (inner !== null) return s[0] + inner + close;
  }
  // "DAY 3 · MORNING 5:28": each piece on its own.
  const dotted = viaSplit(c, s, ' · ', depth);
  if (dotted !== undefined) return dotted;
  // A sentence and its full stop.
  const stop = /^(.*\p{L}.*?)([.!?:…]+)$/u.exec(s);
  if (stop) {
    const head = translate(c, stop[1]!, depth + 1);
    if (head !== null) return /[.!?:…。！？：।]$/u.test(head) ? head : head + closing(stop[2]!);
  }
  // "Furnace (not near)": the words, then the aside.
  const aside = /^(.*\S)\s+(\([^()]*\))$/u.exec(s);
  if (aside) {
    const head = translate(c, aside[1]!, depth + 1);
    const tail = translate(c, aside[2]!, depth + 1);
    if (head !== null || tail !== null) return `${head ?? aside[1]!} ${tail ?? aside[2]!}`;
  }
  // "AFTERNOON 5:28", "Stonewater 238m": the words, then the figures.
  const tail = /^(.*?\p{L}.*?)(\s*[\d:.,%+×x/()\-−m]*\d[\d:.,%+×x/()\-−m]*)$/u.exec(s);
  if (tail) {
    const head = translate(c, tail[1]!, depth + 1);
    if (head !== null) return head + tail[2]!;
  }
  // "· THUNDERSTORM", ", +2 bread", "(not near)": a separator, then the words.
  const lead = /^([·,:;+\-–—(]+\s*)(.+)$/u.exec(s);
  if (lead) {
    const rest = translate(c, lead[2]!, depth + 1);
    if (rest !== null) return lead[1]! + rest;
  }
  // "3 Cannons, 2 Emeralds, a Heartstone": each thing in the list on its own.
  const list = viaSplit(c, s, ', ', depth);
  if (list !== undefined) return list;
  // "3 Dirt": the figures, then the words.
  const figures = /^(\d[\d:.,%×x/]*\s*)(\p{L}.*)$/u.exec(s);
  if (figures) {
    const rest = translate(c, figures[2]!, depth + 1);
    if (rest !== null) return figures[1]! + rest;
  }
  // "Poison: hurts you": either side.
  return viaSplit(c, s, ': ', depth);
}

function translate(c: Compiled, raw: string, depth: number): string | null {
  const s = norm(raw);
  if (!s || !WORDY.test(s) || depth > 6) return null;
  let t = c.exact.get(s);
  // The code upper-cases names for headings ("SUNSCORCH DESERT") and lower-cases them inside
  // sentences ("Hoist the house onto your deck"): the same entry, in the same case.
  if (t === undefined && isUpper(s)) {
    const f = c.folded.get(s.toLowerCase());
    if (f !== undefined) t = f.toLocaleUpperCase(locale());
  }
  if (t === undefined && !/\p{Lu}/u.test(s)) {
    const f = c.folded.get(s);
    if (f !== undefined) t = f.toLocaleLowerCase(locale());
  }
  if (t === undefined) t = viaPattern(c, s, depth);
  if (t === undefined) t = viaParts(c, s, depth);
  if (t === undefined) return null;
  t = t.trim();
  const lead = /^\s*/.exec(raw)![0];
  const trail = /\s*$/.exec(raw)![0];
  return lead + t + trail;
}

/** The text in the current language (unchanged in English, or when the dictionary lacks it). */
export function tr(text: string): string {
  const c = compiled;
  if (lang === 'en' || !c || !text) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  let out = translate(c, text, 0);
  if (out === null && WORDY.test(text) && misses.size < 2000) misses.add(norm(text));
  // (A sentence filled into "{0} · {1}" keeps no full stop before the dot in Chinese or Hindi.)
  if (out !== null && (lang === 'zh' || lang === 'hi')) out = out.replace(/[。।](\s*·)/gu, '$1');
  if (cache.size > 5000) cache.clear();
  cache.set(text, out ?? text);
  return out ?? text;
}

export function currentLang(): Lang {
  return lang;
}

export function langName(code: Lang = lang): string {
  return LANGS.find((l) => l.code === code)?.name ?? code;
}

function isLang(v: string | null | undefined): v is Lang {
  return LANGS.some((l) => l.code === v);
}

/** Compass points in the current language (the helm's heading: N, NE, E...). */
const COMPASS: Partial<Record<Lang, Record<string, string>>> = {
  es: { N: 'N', NE: 'NE', E: 'E', SE: 'SE', S: 'S', SW: 'SO', W: 'O', NW: 'NO' },
  pt: { N: 'N', NE: 'NE', E: 'L', SE: 'SE', S: 'S', SW: 'SO', W: 'O', NW: 'NO' },
  id: { N: 'U', NE: 'TL', E: 'T', SE: 'TG', S: 'S', SW: 'BD', W: 'B', NW: 'BL' },
  zh: { N: '北', NE: '东北', E: '东', SE: '东南', S: '南', SW: '西南', W: '西', NW: '西北' },
  hi: { N: 'उ', NE: 'उ-पू', E: 'पू', SE: 'द-पू', S: 'द', SW: 'द-प', W: 'प', NW: 'उ-प' },
};

export function compass(point: string): string {
  return COMPASS[lang]?.[point] ?? point;
}

/** The language to start in: ?lang=, the player's choice, else the device's own language. */
export function detectLang(): Lang {
  try {
    const forced = new URLSearchParams(window.location.search).get('lang');
    if (isLang(forced)) return forced;
    const saved = window.localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    // storage may be unavailable
  }
  return deviceLang();
}

/** The device's own language, of those the game speaks (English otherwise). */
export function deviceLang(): Lang {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of prefs) {
    const l = (raw ?? '').toLowerCase();
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('pt')) return 'pt';
    // ('in' is the old code for Indonesian, still sent by some devices.)
    if (l === 'id' || l.startsWith('id-') || l === 'in' || l.startsWith('in-')) return 'id';
    if (l === 'hi' || l.startsWith('hi-')) return 'hi';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

async function dictionary(code: Lang): Promise<Record<string, string> | null> {
  const load = LOADERS[`./lang/${code}.json`];
  if (!load) return null;
  return (await load()).default;
}

/** Fetches a language's dictionary ahead of a likely switch (the title's other language). */
export function prefetchLang(code: Lang): void {
  if (code === 'en') return;
  dictionary(code).catch(() => {
    // fetched again when chosen
  });
}

let switching = 0;

/**
 * Switches language: loads its dictionary, re-translates everything on screen and (when the player
 * chose it) remembers the choice. Resolves false if the dictionary could not be loaded.
 */
export async function setLang(code: Lang, remember = false): Promise<boolean> {
  const seq = ++switching;
  const early = document.getElementById('boot-loading');
  if (early) early.textContent = EARLY[code] ?? 'Loading...';
  let next: Compiled | null = null;
  if (code !== 'en') {
    try {
      const dict = await dictionary(code);
      if (!dict) return false;
      next = compile(dict);
    } catch {
      return false;
    }
  }
  // (A later choice made while this one loaded wins.)
  if (seq !== switching) return false;
  lang = code;
  compiled = next;
  cache.clear();
  misses.clear();
  if (remember) {
    try {
      window.localStorage.setItem(KEY, code);
    } catch {
      // the choice lasts this session only
    }
  }
  document.documentElement.lang = locale();
  if (root) retranslate(root);
  for (const fn of listeners) fn();
  return true;
}

/** Called after every language switch (to redraw what is drawn, not written: the map). */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ------------------------------------------------------------------ the screen

/** The English source of each text node we translated, and what we wrote into it. */
const sources = new WeakMap<Text, string>();
const outputs = new WeakMap<Text, string>();
/** The same for translated attributes. */
const attrSources = new WeakMap<Element, Map<string, { src: string; out: string }>>();
/** What setText last asked of an element (the English), and what it wrote. */
const elText = new WeakMap<Element, { src: string; out: string }>();

const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CANVAS', 'svg']);

let root: HTMLElement | null = null;
let observer: MutationObserver | null = null;

/** Inside an element marked translate="no" (codes, names, what the player typed). */
function untranslatable(node: Node): boolean {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!el?.closest('[translate="no"], svg, canvas, textarea');
}

function visitText(n: Text): void {
  const data = n.data;
  if (outputs.get(n) === data) return;
  if (!WORDY.test(data) || untranslatable(n)) return;
  sources.set(n, data);
  const out = tr(data);
  outputs.set(n, out);
  if (out !== data) n.data = out;
}

function attribute(el: Element, name: string): void {
  const value = el.getAttribute(name);
  if (value === null) return;
  const memo = attrSources.get(el) ?? new Map<string, { src: string; out: string }>();
  const prev = memo.get(name);
  if (prev && prev.out === value) return;
  if (untranslatable(el)) return;
  const out = tr(value);
  memo.set(name, { src: value, out });
  attrSources.set(el, memo);
  if (out !== value) el.setAttribute(name, out);
}

/** Translates every text node and attribute under an element (now). */
export function translateTree(el: Element): void {
  if (lang === 'en' || untranslatable(el)) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      if (node.nodeType === 1) {
        const e = node as Element;
        if (SKIP_TAGS.has(e.tagName) || e.getAttribute('translate') === 'no') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 3) visitText(node as Text);
    else for (const name of ATTRS) if ((node as Element).hasAttribute(name)) attribute(node as Element, name);
  }
}

/** Every text node back to its English source, then into the current language. */
function retranslate(el: Element): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node: Node | null = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const n = node as Text;
      const src = sources.get(n);
      if (src !== undefined && outputs.get(n) === n.data) n.data = src;
      outputs.delete(n);
      visitText(n);
    } else {
      const e = node as Element;
      const memo = attrSources.get(e);
      if (memo) {
        for (const [name, m] of memo) if (e.getAttribute(name) === m.out) e.setAttribute(name, m.src);
        memo.clear();
      }
      const set = elText.get(e);
      if (set) set.out = untranslatable(e) ? set.src : tr(set.src);
      for (const name of ATTRS) if (e.hasAttribute(name)) attribute(e, name);
    }
  }
  observer?.takeRecords();
}

function apply(records: MutationRecord[]): void {
  if (lang === 'en') return;
  for (const r of records) {
    if (r.type === 'characterData') visitText(r.target as Text);
    else if (r.type === 'attributes' && r.attributeName) attribute(r.target as Element, r.attributeName);
    else {
      for (const n of r.addedNodes) {
        if (!n.isConnected) continue;
        if (n.nodeType === 3) visitText(n as Text);
        else if (n.nodeType === 1) translateTree(n as Element);
      }
    }
  }
}

/** Starts translating the interface under `el` (everything already there, and all that follows). */
export function watch(el: HTMLElement): void {
  root = el;
  observer?.disconnect();
  observer = new MutationObserver(apply);
  observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ATTRS });
  translateTree(el);
}

/** Translates whatever was written since the last pass, now (before layout measures it). */
export function flushText(): void {
  if (observer) apply(observer.takeRecords());
}

/**
 * Sets an element's text (English), shown translated. Does nothing when it already shows it;
 * true when it changed (the caller may need to re-measure).
 */
export function setText(el: Element, text: string): boolean {
  const memo = elText.get(el);
  if (memo && memo.src === text && el.textContent === memo.out) return false;
  const out = untranslatable(el) ? text : tr(text);
  el.textContent = out;
  elText.set(el, { src: text, out });
  const n = el.firstChild;
  if (n && n.nodeType === 3) {
    sources.set(n as Text, text);
    outputs.set(n as Text, out);
  }
  return true;
}

/** A text node (English) shown translated. */
export function makeText(text: string): Text {
  const out = tr(text);
  const n = document.createTextNode(out);
  sources.set(n, text);
  outputs.set(n, out);
  return n;
}

/** Changes a text node's text (English), shown translated. */
export function setData(n: Text, text: string): void {
  const out = untranslatable(n) ? text : tr(text);
  sources.set(n, text);
  outputs.set(n, out);
  if (n.data !== out) n.data = out;
}

/** Sets an element's markup (English copy inside), translated at once. */
export function setHTML(el: Element, html: string): void {
  el.innerHTML = html;
  translateTree(el);
}

/** Debugging: what has been shown untranslated in this language (window.__bfI18n). */
export function i18nDebug(): { lang: Lang; misses: () => string[]; tr: (s: string) => string; use: (code: Lang, dict: Record<string, string>) => void } {
  return {
    lang,
    misses: () => [...misses],
    tr,
    use: (code, dict) => {
      lang = code;
      compiled = compile(dict);
      cache.clear();
      misses.clear();
      if (root) retranslate(root);
      for (const fn of listeners) fn();
    },
  };
}
