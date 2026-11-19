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

export interface SharedCollection {
  generated?: string;
  prices_updated?: string;
  cards: Card[];
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

let shared: Promise<SharedCollection> | null = null;

/** The published collection (public/shared/collection.json, built from a ManaBox export). */
export function loadShared(): Promise<SharedCollection> {
  shared ??= getJson<SharedCollection>("shared/collection.json");
  shared.catch(() => { shared = null; });
  return shared;
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
