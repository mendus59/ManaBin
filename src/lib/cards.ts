// Helpers shared by every view that shows cards.

/** A Scryfall-shaped card. Library cards and shared-collection cards both use this shape. */
export interface Card {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name?: string;
  collector_number: string;
  rarity: string;
  type_line?: string;
  mana_cost?: string;
  oracle_text?: string;
  card_faces?: CardFace[];
  image_uris?: Record<string, string>;
  /** Library cards: "f" = one image, "fb" = front and back. Images are built from the ID. */
  img?: "f" | "fb";
  prices?: Record<string, string>;
  legalities: Record<string, string>;
  owned?: { qty: number; foil: number; etched: number } | null;
  finishes?: string[];
  print_sets?: string[];
  prints?: number;
  scryfall_uri?: string;
  [key: string]: any;
}

export interface CardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  image_uris?: Record<string, string>;
}

/** One printing of a card, from library/prints/xx.json. */
export interface Printing {
  id: string;
  set: string;
  collector_number: string;
  rarity: string;
  released_at?: string;
  artist?: string;
  lang?: string;
  border_color?: string;
  frame?: string;
  frame_effects?: string[];
  full_art?: boolean;
  promo?: boolean;
  promo_types?: string[];
  finishes?: string[];
  flavor_name?: string;
  prices: Record<string, string>;
  img?: "f" | "fb";
}

export interface SetInfo {
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  count: number;
  icon?: string;
}

export type ImageSize = "small" | "normal" | "large";

/** Image URLs for each face of a card or printing. */
export function images(c: { id: string; image_uris?: Record<string, string>; card_faces?: CardFace[]; img?: string }, size: ImageSize): string[] {
  if (c.image_uris) return [c.image_uris[size] || c.image_uris.normal];
  const faces = (c.card_faces || [])
    .map((f) => f.image_uris && (f.image_uris[size] || f.image_uris.normal))
    .filter((u): u is string => !!u);
  if (faces.length) return faces;
  if (c.img && c.id) {
    const url = (face: string) => `https://cards.scryfall.io/${size}/${face}/${c.id[0]}/${c.id[1]}/${c.id}.jpg`;
    return c.img === "fb" ? [url("front"), url("back")] : [url("front")];
  }
  return [];
}

export const scryfallUrl = (c: { set: string; collector_number: string; scryfall_uri?: string }) =>
  (c.scryfall_uri || "").replace(/\?utm_source=api$/, "") ||
  `https://scryfall.com/card/${c.set}/${encodeURIComponent(c.collector_number)}`;

export const money = (n: number | null | undefined) => (n == null ? "" : "$" + n.toFixed(2));
export const dollars = (n: number) =>
  "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : "");

/** USD value of every copy owned, pricing each finish separately (falling back to another finish's price). */
export function ownedValue(c: Card): number {
  if (!c.owned) return 0;
  const p = c.prices || {};
  const price = (...keys: string[]) => {
    for (const k of keys) if (p[k]) return parseFloat(p[k]);
    return 0;
  };
  const nonfoil = c.owned.qty - c.owned.foil - c.owned.etched;
  return nonfoil * price("usd", "usd_foil", "usd_etched")
    + c.owned.foil * price("usd_foil", "usd", "usd_etched")
    + c.owned.etched * price("usd_etched", "usd_foil", "usd");
}
