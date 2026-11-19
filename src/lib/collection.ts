// The user's collection: entries, how they're keyed, and how they turn into browsable cards.
import type { Card, Printing } from "./cards";

export type Finish = "nonfoil" | "foil" | "etched";
export type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

/**
 * One line of the collection: some copies of one printing in one finish, condition and language.
 * Short field names keep the stored documents small.
 */
export interface Entry {
  /** Scryfall printing ID */
  p: string;
  /** Scryfall oracle ID */
  o: string;
  f: Finish;
  c: Condition;
  /** language code, Scryfall style ("en", "ja", "zhs"...) */
  l: string;
  q: number;
  /** binder name (binders arrive in a later phase; imports keep ManaBox's binder names) */
  b?: string;
  /** purchase price in USD, per copy */
  pp?: number;
  /** date added, YYYY-MM-DD */
  a: string;
}

export const CONDITIONS: [Condition, string][] = [
  ["NM", "Near mint"], ["LP", "Lightly played"], ["MP", "Moderately played"], ["HP", "Heavily played"], ["DMG", "Damaged"],
];

export const LANGUAGES: [string, string][] = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
  ["ja", "Japanese"], ["ko", "Korean"], ["ru", "Russian"], ["zhs", "Simplified Chinese"], ["zht", "Traditional Chinese"],
  ["he", "Hebrew"], ["la", "Latin"], ["grc", "Ancient Greek"], ["ar", "Arabic"], ["sa", "Sanskrit"], ["ph", "Phyrexian"],
];

export const FINISH_LABELS: Record<Finish, string> = { nonfoil: "Non-foil", foil: "Foil", etched: "Etched" };

export const entryKey = (e: Pick<Entry, "p" | "f" | "c" | "l" | "b">) => [e.p, e.f, e.c, e.l, e.b || ""].join("|");

/** Entries are stored in 16 documents, by the first hex digit of the printing ID. */
export const shardOf = (printingId: string) => printingId[0].toLowerCase();

export const today = () => new Date().toISOString().slice(0, 10);

export type Entries = Map<string, Entry>;

/** Adds quantities of `incoming` into `base` (same key = same printing, finish, condition, language, binder). */
export function mergeEntries(base: Entries, incoming: Iterable<Entry>): Entries {
  const out = new Map(base);
  for (const e of incoming) {
    const k = entryKey(e);
    const cur = out.get(k);
    out.set(k, cur ? { ...cur, q: cur.q + e.q, pp: cur.pp ?? e.pp } : { ...e });
  }
  return out;
}

export function totalCopies(entries: Entries): number {
  let n = 0;
  for (const e of entries.values()) n += e.q;
  return n;
}

/** Copies owned of each oracle card, for "owned" badges in the library. */
export function ownedByOracle(entries: Entries): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries.values()) out.set(e.o, (out.get(e.o) || 0) + e.q);
  return out;
}

/**
 * One browsable card per printing owned, in the same shape as the shared collection
 * (a Scryfall-style card with an `owned` count), so search, filters and value all work.
 */
export function collectionCards(entries: Entries, oracles: Map<string, Card>, printings: Map<string, Printing[]>, setNames: Record<string, string>): Card[] {
  const byPrinting = new Map<string, Card>();
  for (const e of entries.values()) {
    let card = byPrinting.get(e.p);
    if (!card) {
      const oracle = oracles.get(e.o);
      const printing = printings.get(e.o)?.find((x) => x.id === e.p);
      if (!oracle || !printing) continue;
      card = {
        ...oracle,
        ...printing,
        set_name: setNames[printing.set] || printing.set.toUpperCase(),
        print_sets: undefined,
        prints: undefined,
        min_usd: undefined,
        _s: undefined,
        _f: undefined,
        owned: { qty: 0, foil: 0, etched: 0 },
      } as Card;
      byPrinting.set(e.p, card);
    }
    card.owned!.qty += e.q;
    if (e.f === "foil") card.owned!.foil += e.q;
    if (e.f === "etched") card.owned!.etched += e.q;
  }
  return [...byPrinting.values()];
}

/** Entries the collection holds for one printing, sorted for display. */
export function entriesFor(entries: Entries, printingId: string): [string, Entry][] {
  const order = (e: Entry) => `${["nonfoil", "foil", "etched"].indexOf(e.f)}${CONDITIONS.findIndex(([c]) => c === e.c)}${e.l}${e.b || ""}`;
  return [...entries].filter(([, e]) => e.p === printingId).sort((a, b) => order(a[1]).localeCompare(order(b[1])));
}
