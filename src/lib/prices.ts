// Store prices: TCGplayer (from Scryfall, on each printing) plus Card Kingdom and MTGGoldfish
// (from library/prices/xx.json, written weekly by tools/build_prices.py).
import type { Card } from "./cards";

/** [ck, ck_foil, ck_etched, gf, gf_foil, gf_etched], 0 where the store has no price. */
export type StorePrices = number[];

export const SOURCES = [
  ["highest", "Highest price"],
  ["tcgplayer", "TCGplayer"],
  ["cardkingdom", "Card Kingdom"],
  ["mtggoldfish", "MTGGoldfish"],
] as const;
export type PriceSource = (typeof SOURCES)[number][0];

const SOURCE_KEY = "manabin-price-source";

/** The price source chosen on My collection, remembered in this browser. */
export function savedSource(): PriceSource {
  try {
    const s = localStorage.getItem(SOURCE_KEY);
    if (SOURCES.some(([k]) => k === s)) return s as PriceSource;
  } catch { /* storage blocked */ }
  return "highest";
}

export function saveSource(s: PriceSource) {
  try { localStorage.setItem(SOURCE_KEY, s); } catch { /* private window: keep it for this visit */ }
}

export const FINISH_KEYS = ["usd", "usd_foil", "usd_etched"] as const;

/** Each store's USD price for one printing, by finish (nonfoil, foil, etched). */
export function storeRows(tcg: Record<string, string> | undefined, store: StorePrices | undefined) {
  const t = FINISH_KEYS.map((k) => parseFloat(tcg?.[k] || "") || 0);
  return [
    { store: "TCGplayer", source: "tcgplayer" as const, prices: t },
    { store: "Card Kingdom", source: "cardkingdom" as const, prices: store ? store.slice(0, 3) : [0, 0, 0] },
    { store: "MTGGoldfish", source: "mtggoldfish" as const, prices: store ? store.slice(3, 6) : [0, 0, 0] },
  ];
}

/**
 * USD prices for a printing from the chosen source. A store that doesn't list a finish falls
 * back to TCGplayer, so a card never drops to $0 just because one store lacks it.
 */
export function pricesFrom(tcg: Record<string, string> | undefined, store: StorePrices | undefined, source: PriceSource): Record<string, string> {
  const rows = storeRows(tcg, store);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tcg || {})) if (!(FINISH_KEYS as readonly string[]).includes(k)) out[k] = v;
  FINISH_KEYS.forEach((k, i) => {
    const v = source === "highest"
      ? Math.max(...rows.map((r) => r.prices[i]))
      : rows.find((r) => r.source === source)!.prices[i] || rows[0].prices[i];
    if (v) out[k] = v.toFixed(2);
  });
  return out;
}

/** A collection card priced from the chosen source; its TCGplayer prices are kept in `tcg_prices`. */
export function withSource(c: Card, store: StorePrices | undefined, source: PriceSource): Card {
  const tcg: Record<string, string> | undefined = c.tcg_prices || c.prices;
  return { ...c, tcg_prices: tcg, prices: source === "tcgplayer" ? tcg : pricesFrom(tcg, store, source) };
}
