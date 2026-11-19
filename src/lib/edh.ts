// Commander deck building: card roles, commander eligibility, deck stats and suggestions.
import type { Card } from "./cards";
import type { DeckCard } from "./decks";

export type Role = "ramp" | "draw" | "removal" | "wipe" | "tutor" | "land";
export const ROLES: [Role, string][] = [
  ["ramp", "Ramp"], ["draw", "Card draw"], ["removal", "Removal"], ["wipe", "Board wipes"], ["tutor", "Tutors"], ["land", "Lands"],
];
/** What a typical Commander deck runs of each role, as a rough guide. */
export const ROLE_TARGETS: Partial<Record<Role, number>> = { ramp: 10, draw: 10, removal: 8, wipe: 3, land: 36 };

const front = (c: Card) => (c.card_faces && !c.oracle_text ? c.card_faces[0] : c);
const textOf = (c: Card) => (c.oracle_text || (c.card_faces || []).map((f) => f.oracle_text || "").join("\n")).toLowerCase();
const typeOf = (c: Card) => (front(c).type_line || c.type_line || "");

/** The jobs a card does in a deck, guessed from its rules text. */
export function roles(c: Card): Set<Role> {
  const out = new Set<Role>();
  const t = textOf(c);
  const type = typeOf(c);
  if (/\bLand\b/.test(type)) {
    out.add("land");
    return out;
  }
  if (/add \{|add one mana|add (two|three) mana|mana of any (one )?colou?r/.test(t) && !/creature you control/.test(t.split("add")[0] || "")) out.add("ramp");
  if (/search your library for (a|up to (two|three)) (basic )?(land|forest|plains|island|swamp|mountain)/.test(t)
    || /put (a|up to two) (basic )?land cards? .*onto the battlefield/.test(t)) out.add("ramp");
  if (/draws? (a|two|three|four|x|that many|cards equal) cards?|draw cards equal|draw a card for each/.test(t)) out.add("draw");
  if (/(destroy|exile) target (creature|artifact|enchantment|planeswalker|permanent|nonland permanent|creature or planeswalker)/.test(t)
    || /deals? (\d+|x) damage to (any target|target creature)/.test(t)
    || /return target (creature|nonland permanent) to its owner's hand/.test(t)
    || /counter target spell/.test(t)) out.add("removal");
  if (/(destroy|exile) (all|each) (other )?(creatures|nonland permanents|permanents|artifacts|enchantments)/.test(t)
    || /all creatures get -\d+\/-\d+/.test(t) || /deals? \d+ damage to each creature/.test(t)) out.add("wipe");
  if (/search your library for an? (card|creature card|instant|sorcery|artifact card|enchantment card)(?! named)/.test(t) && !out.has("ramp")) out.add("tutor");
  return out;
}

/** Whether a card can lead a Commander deck. */
export function canBeCommander(c: Card): boolean {
  const type = typeOf(c);
  const t = textOf(c);
  if (c.legalities?.commander === "banned") return false;
  return (/\bLegendary\b/.test(type) && /\bCreature\b/.test(type)) || /can be your commander/.test(t)
    || (/\bLegendary\b/.test(type) && /\bBackground\b/.test(type));
}

/** True if every color of the card's identity is in `identity`. */
export const fitsIdentity = (c: Card, identity: Set<string>) => (c.color_identity || []).every((x: string) => identity.has(x));

export const deckIdentity = (cards: DeckCard[], oracles: Map<string, Card>) =>
  new Set(cards.filter((c) => c.b === "commander").flatMap((c) => oracles.get(c.o)?.color_identity || []));

export interface DeckStats {
  /** cards by mana value, 0..7 (7 = 7+), lands left out */
  curve: number[];
  averageMv: number;
  /** colored mana symbols in costs, by color */
  pips: Record<string, number>;
  /** cards (lands and others) that can make each color */
  sources: Record<string, number>;
  roles: Record<Role, number>;
  gameChangers: string[];
}

const COLORS = ["W", "U", "B", "R", "G"];

export function deckStats(cards: DeckCard[], oracles: Map<string, Card>): DeckStats {
  const curve = new Array(8).fill(0);
  const pips: Record<string, number> = Object.fromEntries(COLORS.map((c) => [c, 0]));
  const sources: Record<string, number> = Object.fromEntries(COLORS.map((c) => [c, 0]));
  const roleCount = Object.fromEntries(ROLES.map(([r]) => [r, 0])) as Record<Role, number>;
  const gameChangers: string[] = [];
  let mvTotal = 0, spells = 0;
  for (const dc of cards) {
    if (dc.b !== "main" && dc.b !== "commander") continue;
    const c = oracles.get(dc.o);
    if (!c) continue;
    const r = roles(c);
    r.forEach((x) => (roleCount[x] += dc.q));
    if (c.game_changer) gameChangers.push(c.name);
    for (const color of c.produced_mana || []) if (color in sources) sources[color] += dc.q;
    if (r.has("land")) continue;
    const mv = Math.round(c.cmc || 0);
    curve[Math.min(7, mv)] += dc.q;
    mvTotal += mv * dc.q;
    spells += dc.q;
    const cost = (front(c).mana_cost || c.mana_cost || "") as string;
    for (const sym of cost.match(/\{[^}]+\}/g) || []) for (const color of COLORS) if (sym.includes(color)) pips[color] += dc.q;
  }
  return { curve, averageMv: spells ? mvTotal / spells : 0, pips, sources, roles: roleCount, gameChangers };
}

// ---------- suggestions ----------

export interface Suggestion {
  card: Card;
  /** why it's suggested */
  reason: string;
  /** EDHREC: share of this commander's decks that play it (0..1) */
  inclusion?: number;
  /** EDHREC: how much more often this commander plays it than other decks of its colors */
  synergy?: number;
  section?: string;
  owned: number;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) || []);

/**
 * Cards from your collection that fit the commander: in its colors, legal, not in the deck yet.
 * Ranked by how much they share with the commander (creature types it names, keywords, words
 * in its text), then by EDHREC rank (how widely the card is played in Commander overall).
 */
export function suggestFromCollection(
  commanders: Card[], owned: Map<string, number>, oracles: Map<string, Card>, inDeck: Set<string>, limit = 200,
): Suggestion[] {
  if (!commanders.length) return [];
  const identity = new Set(commanders.flatMap((c) => c.color_identity || []));
  const cmdText = commanders.map(textOf).join("\n");
  const cmdWords = words(cmdText);
  const cmdKeywords = new Set(commanders.flatMap((c) => (c.keywords || []).map((k: string) => k.toLowerCase())));
  const scored: { s: Suggestion; score: number }[] = [];
  for (const [o, n] of owned) {
    if (n <= 0 || inDeck.has(o)) continue;
    const c = oracles.get(o);
    if (!c || c.extra || commanders.includes(c) || !fitsIdentity(c, identity)) continue;
    if (c.legalities?.commander !== "legal") continue;
    let score = 0;
    const reasons: string[] = [];
    const subtypes = (typeOf(c).split("—")[1] || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tribe = subtypes.find((t) => t.length > 2 && new RegExp(`\\b${t}s?\\b`).test(cmdText));
    if (tribe) { score += 30; reasons.push(`a ${tribe[0].toUpperCase() + tribe.slice(1)}`); }
    const kw = (c.keywords || []).map((k: string) => k.toLowerCase()).filter((k: string) => cmdKeywords.has(k) || cmdWords.has(k));
    if (kw.length) { score += 12 * kw.length; reasons.push(`shares ${kw.slice(0, 2).join(", ")}`); }
    const shared = [...words(textOf(c))].filter((w) => cmdWords.has(w) && !STOP.has(w)).length;
    score += Math.min(shared, 8) * 2;
    const r = roles(c);
    if (r.size && !r.has("land")) reasons.push(ROLES.find(([x]) => r.has(x))![1].toLowerCase());
    const rank = c.edhrec_rank ?? 30000;
    score += Math.max(0, 20 - rank / 1000);
    scored.push({ score, s: { card: c, reason: reasons.join(" · ") || (rank < 2000 ? "a Commander staple" : "fits the colors"), owned: n } });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.s);
}

const STOP = new Set(["that", "this", "with", "your", "each", "when", "whenever", "then", "from", "into", "until", "turn", "creature", "creatures", "card", "cards", "target", "control", "player", "that's", "have", "less", "more", "other", "under", "they", "their", "its", "those", "where", "time", "only", "costs", "cost", "mana", "battlefield", "graph", "enters", "may", "would", "instead", "does", "were", "been", "able", "among", "onto", "without", "number", "equal", "spell", "spells"]);

/** EDHREC's slug for a commander page: "Krenko, Mob Boss" → "krenko-mob-boss"; partners are joined. */
export function edhrecSlug(names: string[]): string {
  const one = (n: string) => n.split(" // ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’,.!?"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return names.map(one).sort().join("-");
}

export interface EdhrecCard { name: string; section: string; inclusion: number; synergy: number }

/** The recommendation lists on an EDHREC commander page (json.edhrec.com/pages/commanders/<slug>.json). */
export function parseEdhrec(json: unknown): EdhrecCard[] {
  const lists = (json as { container?: { json_dict?: { cardlists?: unknown[] } } })?.container?.json_dict?.cardlists;
  if (!Array.isArray(lists)) return [];
  const out: EdhrecCard[] = [];
  const seen = new Set<string>();
  for (const l of lists as { header?: string; cardviews?: { name?: string; num_decks?: number; potential_decks?: number; synergy?: number }[] }[]) {
    for (const v of l.cardviews || []) {
      if (!v.name || seen.has(v.name)) continue;
      seen.add(v.name);
      out.push({
        name: v.name, section: l.header || "Cards",
        inclusion: v.potential_decks ? (v.num_decks || 0) / v.potential_decks : 0,
        synergy: v.synergy || 0,
      });
    }
  }
  return out;
}
