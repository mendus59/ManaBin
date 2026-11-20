// The numbers on the home dashboard: what the collection is worth, how that moved since an
// earlier price update, the biggest movers, and what was added most recently.
import type { Card } from "./cards";
import type { Entries, Entry, Finish } from "./collection";

/** USD price of one copy in a finish, falling back to another finish's price like ownedValue does. */
export function unitPrice(prices: Record<string, string> | undefined, f: Finish): number {
  const p = prices || {};
  const order = f === "foil" ? ["usd_foil", "usd", "usd_etched"] : f === "etched" ? ["usd_etched", "usd_foil", "usd"] : ["usd", "usd_foil", "usd_etched"];
  for (const k of order) if (p[k]) return parseFloat(p[k]) || 0;
  return 0;
}

/** Unit prices by "printing|finish", from the priced cards of a collection. */
export type PriceMap = Record<string, number>;

export interface Snapshot {
  /** when the prices were published (an ISO date-time), which identifies the update */
  at: string;
  prices: PriceMap;
}

// Prices update monthly, so keep about two months to always have the previous update.
const KEEP_DAYS = 70;
const KEEP_MAX = 12;
const DAY = 86400e3;

export function priceMap(entries: Iterable<Entry>, byPrinting: Map<string, Card>): PriceMap {
  const out: PriceMap = {};
  for (const e of entries) {
    const c = byPrinting.get(e.p);
    if (c) out[`${e.p}|${e.f}`] = unitPrice(c.prices, e.f);
  }
  return out;
}

/**
 * Adds today's prices to the saved snapshots: a new price update gets its own snapshot, and the
 * current one is kept up to date with cards added since. Old snapshots are dropped.
 */
export function recordSnapshot(saved: Snapshot[], now: Snapshot): Snapshot[] {
  const rest = saved.filter((s) => s.at !== now.at);
  const cur = saved.find((s) => s.at === now.at);
  const merged: Snapshot = { at: now.at, prices: { ...cur?.prices, ...now.prices } };
  const cutoff = Date.parse(now.at) - KEEP_DAYS * DAY;
  return [...rest.filter((s) => Date.parse(s.at) >= cutoff && s.at < now.at), merged]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-KEEP_MAX);
}

/**
 * The snapshot to compare today's prices with: the newest one from at least a week before,
 * or failing that the oldest earlier one. Null when there's no earlier price update yet.
 */
export function baseline(saved: Snapshot[], at: string): Snapshot | null {
  const earlier = saved.filter((s) => s.at < at).sort((a, b) => a.at.localeCompare(b.at));
  if (!earlier.length) return null;
  const weekAgo = Date.parse(at) - 7 * DAY + DAY / 2;
  const old = earlier.filter((s) => Date.parse(s.at) <= weekAgo);
  return old.length ? old[old.length - 1] : earlier[0];
}

export interface Mover { entry: Entry; card: Card; before: number; now: number; change: number }

/**
 * How the value of the cards owned now changed between two sets of prices. Cards with no earlier
 * price (added since, or unpriced then) don't count, so adding cards never shows as a gain.
 */
export function valueChange(entries: Entries, byPrinting: Map<string, Card>, before: PriceMap) {
  let change = 0;
  let base = 0;
  const byKey = new Map<string, Mover>();
  for (const e of entries.values()) {
    const card = byPrinting.get(e.p);
    const k = `${e.p}|${e.f}`;
    const then = before[k];
    if (!card || then == null || !then) continue;
    const now = unitPrice(card.prices, e.f);
    if (!now) continue;
    change += e.q * (now - then);
    base += e.q * then;
    const m = byKey.get(k);
    if (m) m.change += e.q * (now - then);
    else byKey.set(k, { entry: e, card, before: then, now, change: e.q * (now - then) });
  }
  const movers = [...byKey.values()].filter((m) => Math.abs(m.change) >= 0.01).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return { change, base, pct: base ? (change / base) * 100 : 0, movers };
}

/** The printings added most recently, newest first, one per printing. */
export function recentPrintings(entries: Entries, limit: number): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  const sorted = [...entries.values()].sort((a, b) => (b.a || "").localeCompare(a.a || ""));
  for (const e of sorted) {
    if (seen.has(e.p)) continue;
    seen.add(e.p);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Cards and value in each binder ("" = no binder), from the priced cards. */
export function binderTotals(entries: Entries, byPrinting: Map<string, Card>): Map<string, { cards: number; value: number }> {
  const out = new Map<string, { cards: number; value: number }>();
  for (const e of entries.values()) {
    const t = out.get(e.b || "") || { cards: 0, value: 0 };
    t.cards += e.q;
    t.value += e.q * unitPrice(byPrinting.get(e.p)?.prices, e.f);
    out.set(e.b || "", t);
  }
  return out;
}
