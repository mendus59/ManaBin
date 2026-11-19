// Loads the static data files published with the site.
import type { Card, Printing, SetInfo } from "./cards";

const base = import.meta.env.BASE_URL;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface Manifest {
  built_at: string;
  bulk_updated_at: string;
  cards: number;
  printings: number;
  sets: number;
  newest_set: string | null;
}

export interface Library {
  manifest: Manifest;
  cards: Card[];
  sets: Map<string, SetInfo>;
}

let library: Promise<Library> | null = null;

/** The full card library (built by tools/build_library.py). Cached after the first call. */
export function loadLibrary(): Promise<Library> {
  library ??= (async () => {
    const [manifest, cards, sets] = await Promise.all([
      getJson<Manifest>("library/manifest.json"),
      getJson<Card[]>("library/cards.json"),
      getJson<SetInfo[]>("library/sets.json"),
    ]);
    return { manifest, cards, sets: new Map(sets.map((s) => [s.code, s])) };
  })();
  library.catch(() => { library = null; });
  return library;
}

let sets: Promise<Map<string, SetInfo>> | null = null;

/** Just the set list, for views that don't need the whole library. Empty if the library isn't built. */
export function loadSets(): Promise<Map<string, SetInfo>> {
  sets ??= getJson<SetInfo[]>("library/sets.json")
    .then((list) => new Map(list.map((s) => [s.code, s])))
    .catch(() => new Map());
  return sets;
}

const shards = new Map<string, Promise<Record<string, Printing[]>>>();

/** Every printing of a card, newest first. Empty if the library isn't built. */
export async function loadPrintings(oracleId: string): Promise<Printing[]> {
  const prefix = oracleId.slice(0, 2);
  let shard = shards.get(prefix);
  if (!shard) {
    shard = getJson<Record<string, Printing[]>>(`library/prints/${prefix}.json`);
    shards.set(prefix, shard);
    shard.catch(() => shards.delete(prefix));
  }
  try {
    return (await shard)[oracleId] || [];
  } catch {
    return [];
  }
}

const idShards = new Map<string, Promise<Record<string, string>>>();

/** Oracle ID for each printing ID, for importing lists of printings. Unknown IDs are left out. */
export async function lookupOracleIds(printingIds: string[]): Promise<Map<string, string>> {
  const prefixes = [...new Set(printingIds.map((id) => id.slice(0, 2)))];
  const out = new Map<string, string>();
  await Promise.all(prefixes.map(async (prefix) => {
    let shard = idShards.get(prefix);
    if (!shard) {
      shard = getJson<Record<string, string>>(`library/ids/${prefix}.json`).catch(() => ({}));
      idShards.set(prefix, shard);
    }
    const map = await shard;
    for (const id of printingIds) if (id.startsWith(prefix) && map[id]) out.set(id, map[id]);
  }));
  return out;
}

const priceShards = new Map<string, Promise<Record<string, number[]>>>();

/**
 * Card Kingdom and MTGGoldfish prices for every printing of these cards, by printing ID.
 * Empty when the price job hasn't run yet.
 */
export async function loadStorePrices(oracleIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  await Promise.all([...new Set(oracleIds.map((o) => o.slice(0, 2)))].map(async (prefix) => {
    let shard = priceShards.get(prefix);
    if (!shard) {
      shard = getJson<Record<string, number[]>>(`library/prices/${prefix}.json`).catch(() => ({}));
      priceShards.set(prefix, shard);
    }
    for (const [id, p] of Object.entries(await shard)) out.set(id, p);
  }));
  return out;
}

export interface PriceManifest { built_at: string; card_kingdom: number; mtggoldfish: number }

let priceManifest: Promise<PriceManifest | null> | null = null;

/** When the store prices were fetched, or null if they never have been. */
export function loadPriceManifest(): Promise<PriceManifest | null> {
  priceManifest ??= getJson<PriceManifest>("library/prices/manifest.json").catch(() => null);
  return priceManifest;
}

/**
 * The cheapest non-foil price (foil where a card has no non-foil) of any printing of each card,
 * at each store: [TCGplayer, Card Kingdom, MTGGoldfish], 0 where a store has none.
 */
export async function cheapestByStore(oracleIds: string[]): Promise<Map<string, number[]>> {
  const ids = [...new Set(oracleIds)];
  const [store, printings] = await Promise.all([
    loadStorePrices(ids),
    Promise.all(ids.map(async (o) => [o, await loadPrintings(o)] as const)),
  ]);
  const out = new Map<string, number[]>();
  for (const [o, ps] of printings) {
    const best = [0, 0, 0];
    const take = (i: number, v: number) => { if (v > 0 && (!best[i] || v < best[i])) best[i] = v; };
    for (const p of ps) {
      take(0, parseFloat(p.prices?.usd || "") || parseFloat(p.prices?.usd_foil || "") || 0);
      const s = store.get(p.id);
      if (s) {
        take(1, s[0] || s[1]);
        take(2, s[3] || s[4]);
      }
    }
    out.set(o, best);
  }
  return out;
}
