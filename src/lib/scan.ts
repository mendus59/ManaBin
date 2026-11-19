// Card scanning: turning what the camera reads into a card and an exact printing.
import type { Card, Printing } from "./cards";
import type { Condition, Entry, Finish } from "./collection";

/** A scanned card waiting to be saved, as shown in the pending list. */
export interface PendingCard {
  id: string;
  /** oracle ID, name, printing ID, set code and collector number */
  o: string;
  n: string;
  p: string;
  set: string;
  num: string;
  img?: "f" | "fb";
  finishes?: string[];
  f: Finish;
  c: Condition;
  l: string;
  q: number;
  /** false when the printing is a guess the user should check */
  sure: boolean;
}

const samePile = (a: PendingCard, b: PendingCard) => a.p === b.p && a.f === b.f && a.c === b.c && a.l === b.l;

/** Adds a scan to the top of the list, or one more copy to a matching scan already there. */
export function addPending(list: PendingCard[], item: PendingCard): PendingCard[] {
  const i = list.findIndex((x) => samePile(x, item));
  if (i < 0) return [item, ...list];
  const merged = { ...list[i], q: list[i].q + item.q };
  return [merged, ...list.slice(0, i), ...list.slice(i + 1)];
}

/** The collection entries for a pending list, joining identical scans. */
export function toEntries(list: PendingCard[], binder: string, date: string): Entry[] {
  const out: Entry[] = [];
  for (const x of list) {
    if (x.q <= 0) continue;
    const e: Entry = { p: x.p, o: x.o, f: x.f, c: x.c, l: x.l, q: x.q, b: binder || undefined, a: date };
    const same = out.find((y) => y.p === e.p && y.f === e.f && y.c === e.c && y.l === e.l);
    if (same) same.q += e.q;
    else out.push(e);
  }
  if (!binder) for (const e of out) delete e.b;
  return out;
}

/** Lowercase letters, digits and single spaces; accents dropped, so OCR text and names compare fairly. */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Edit distance, giving up (returning max + 1) once it can't stay within `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export interface NameMatch { card: Card; score: number }

interface IndexEntry { key: string; card: Card }

/**
 * Finds the card whose name the camera read. Matches whole names and the front face of
 * double-faced and split cards, forgiving a few misread letters and junk the reader picks up
 * after the name (usually the mana cost).
 */
export function nameMatcher(cards: Card[]) {
  const entries: IndexEntry[] = [];
  const exact = new Map<string, Card>();
  const put = (name: string, card: Card) => {
    const key = normalizeName(name);
    if (key.length < 2) return;
    const cur = exact.get(key);
    // A real card beats a token or other extra with the same name.
    if (!cur || (cur.extra && !card.extra)) {
      if (!cur) entries.push({ key, card });
      else entries[entries.findIndex((e) => e.key === key)] = { key, card };
      exact.set(key, card);
    }
  };
  for (const c of cards) {
    put(c.name, c);
    if (c.name.includes(" // ")) for (const face of c.name.split(" // ")) put(face, c);
  }

  /** Lowest score accepted, by name length: short names must be read exactly. */
  const needed = (len: number) => (len <= 4 ? 1 : len <= 7 ? 0.84 : len <= 12 ? 0.78 : 0.72);

  /** The best match on any line of the text (the reader may pick up a line of art or the frame too). */
  return function match(text: string): NameMatch | null {
    let best: NameMatch | null = null;
    for (const line of text.split("\n")) {
      const m = matchLine(line);
      if (m && (!best || m.score > best.score)) best = m;
    }
    return best;
  };

  function matchLine(line: string): NameMatch | null {
    const read = normalizeName(line);
    if (read.length < 3) return null;
    // Try the whole line, then with up to three trailing words dropped (mana symbols read as letters).
    const words = read.split(" ");
    const tries: [string, number][] = [];
    for (let drop = 0; drop <= Math.min(3, words.length - 1); drop++) tries.push([words.slice(0, words.length - drop).join(" "), drop * 0.03]);
    // ...and with one leading word dropped, for a stray mark read before the name.
    if (words.length > 1 && words[0].length <= 2) tries.push([words.slice(1).join(" "), 0.03]);

    let best: NameMatch | null = null;
    for (const [t, penalty] of tries) {
      const hit = exact.get(t);
      if (hit) {
        const score = 1 - penalty;
        if (!best || score > best.score) best = { card: hit, score };
      }
    }
    if (best && best.score === 1) return best;
    for (const [t, penalty] of tries) {
      if (t.length < 3) continue;
      const max = Math.floor(t.length * 0.3);
      for (const e of entries) {
        const d = distance(t, e.key, max);
        if (d > max) continue;
        const score = 1 - d / Math.max(t.length, e.key.length) - penalty;
        if (score < needed(e.key.length)) continue;
        if (!best || score > best.score || (score === best.score && best.card.extra && !e.card.extra)) best = { card: e.card, score };
      }
    }
    return best;
  }
}

export interface CollectorLine {
  /** collector number as printed, leading zeros dropped */
  number?: string;
  /** set codes that might be on the card, uppercase, best guess first */
  sets: string[];
  /** language code ("en", "ja"...) */
  lang?: string;
}

const LANG_CODES: Record<string, string> = {
  EN: "en", ES: "es", SP: "es", FR: "fr", DE: "de", IT: "it", PT: "pt", JP: "ja", JA: "ja", KO: "ko", KR: "ko",
  RU: "ru", CS: "zhs", CT: "zht", ZHS: "zhs", ZHT: "zht", PH: "ph",
};

/**
 * Reads the small print at the bottom left of a modern card, such as
 * "0123/0281 R" over "DMU • EN  Artist Name", or "0045 U" over "MOM ★ EN". (The star marks a
 * foil, but it's too small to tell from the dot reliably, so the finish is left to the user.)
 */
export function readCollectorLine(text: string): CollectorLine {
  const out: CollectorLine = { sets: [] };
  const t = text.toUpperCase().replace(/[|]/g, "I");
  // The number: digits (read leniently: O for 0, I or L for 1), optionally "/total".
  const num = t.match(/(?:^|[^A-Z0-9])([0-9OIL]{1,4})\s?\/\s?[0-9OIL]{1,4}(?![0-9])/)
    || t.match(/(?:^|[^A-Z0-9])([0-9OIL]{2,4})\s*[CURMLSTP](?![A-Z0-9])/)
    || t.match(/(?:^|[^A-Z0-9])(\d{1,4})(?![A-Z0-9\/])/);
  if (num && /\d/.test(num[1])) {
    const n = num[1].replace(/O/g, "0").replace(/[IL]/g, "1").replace(/^0+(?=\d)/, "");
    out.number = n;
  }
  // "SET • EN": the set code sits before a dot or star and a language code.
  // The separator is often misread (as +, * or J), so allow any one character there.
  const setLang = t.match(/\b([A-Z0-9]{3,5})\s*[^A-Z0-9\s]?\s*J?(EN|ES|SP|FR|DE|IT|PT|JP|JA|KO|KR|RU|CS|CT|PH)\b/);
  if (setLang) {
    out.sets.push(setLang[1]);
    out.lang = LANG_CODES[setLang[2]];
  }
  for (const w of t.match(/\b[A-Z0-9]{3,5}\b/g) || []) if (!out.sets.includes(w) && /[A-Z]/.test(w)) out.sets.push(w);
  return out;
}

export interface PrintingPick {
  printing: Printing;
  /** true when the bottom line matched it; false when it's a guess the user should check */
  sure: boolean;
}

/**
 * The printing a scan most likely shows. The collector number and set code decide it when the
 * camera read them; otherwise the set of the last card scanned (cards are usually scanned a set
 * at a time), then the newest regular printing.
 */
export function pickPrinting(prints: Printing[], line: CollectorLine | null, lastSet?: string): PrintingPick | null {
  if (!prints.length) return null;
  const sets = (line?.sets || []).map((s) => s.toLowerCase());
  let best: Printing | null = null;
  let bestScore = 0;
  for (const p of prints) {
    let score = 0;
    const setAt = sets.indexOf(p.set);
    if (setAt >= 0) score += setAt === 0 ? 3 : 2;
    if (line?.number && p.collector_number.replace(/^0+(?=\d)/, "").toUpperCase() === line.number) score += 2;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  // A set code alone, or a number alone in the set scanned last, is good enough to be sure of.
  if (best && bestScore >= 3) return { printing: best, sure: true };
  if (best && bestScore === 2 && line?.number && best.set === lastSet) return { printing: best, sure: true };
  const regular = (p: Printing) => !p.promo && p.border_color !== "gold" && (p.finishes || []).some((f) => f === "nonfoil" || f === "foil");
  const inLast = lastSet ? prints.find((p) => p.set === lastSet) : undefined;
  return { printing: best || inLast || prints.find(regular) || prints[0], sure: false };
}
