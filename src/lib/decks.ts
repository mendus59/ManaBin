// Decks: the stored shape, reading and writing decklists, grouping and format checks.
import type { Card } from "./cards";

export type Board = "commander" | "main" | "side" | "maybe";
export const BOARDS: [Board, string][] = [["commander", "Commander"], ["main", "Main deck"], ["side", "Sideboard"], ["maybe", "Maybeboard"]];

/** One line of a deck: some copies of a card (any printing unless `p` names one). */
export interface DeckCard {
  /** oracle ID */
  o: string;
  /** card name, kept so a decklist can be shown and exported before the library loads */
  n: string;
  q: number;
  b: Board;
  /** preferred printing ID */
  p?: string;
}

export interface Deck {
  id: string;
  name: string;
  /** a Scryfall legality key ("commander", "modern"...) or "" for no format */
  format: string;
  cards: DeckCard[];
  /** friends (user IDs) who may see the deck */
  sharedWith: string[];
  notes?: string;
  /** ISO time of the last change */
  updated: string;
}

export const FORMATS: [string, string][] = [
  ["commander", "Commander"], ["standard", "Standard"], ["pioneer", "Pioneer"], ["modern", "Modern"], ["legacy", "Legacy"],
  ["vintage", "Vintage"], ["pauper", "Pauper"], ["brawl", "Brawl"], ["oathbreaker", "Oathbreaker"], ["", "No format"],
];

export const newDeckId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);

/** Adds copies of a card to a board, joining an existing line for the same card and printing. */
export function addCard(cards: DeckCard[], add: DeckCard): DeckCard[] {
  const i = cards.findIndex((c) => c.o === add.o && c.b === add.b && (c.p || "") === (add.p || ""));
  if (i < 0) return [...cards, add];
  return cards.map((c, j) => (j === i ? { ...c, q: c.q + add.q } : c));
}

export const deckSize = (cards: DeckCard[], boards: Board[] = ["commander", "main"]) =>
  cards.reduce((n, c) => n + (boards.includes(c.b) ? c.q : 0), 0);

// ---------- decklists ----------

export interface ParsedLine {
  q: number;
  name: string;
  board: Board;
  set?: string;
  number?: string;
  foil?: boolean;
  line: number;
}

const SECTION: [RegExp, Board][] = [
  [/^(commanders?|command zone|cmdr)$/i, "commander"],
  [/^(deck|main|mainboard|main deck)$/i, "main"],
  [/^(sideboard|side|sb|companion)$/i, "side"],
  [/^(maybeboard|maybe|considering)$/i, "maybe"],
];

function boardFromTags(tags: string): Board | null {
  const t = tags.toLowerCase();
  if (/commander/.test(t)) return "commander";
  if (/maybe/.test(t)) return "maybe";
  if (/sideboard/.test(t)) return "side";
  return null;
}

/**
 * Reads a decklist as exported by Moxfield, Archidekt, MTGGoldfish, MTG Arena or typed by hand:
 *   1 Sol Ring
 *   1x Sol Ring (C21) 263 *F* [Ramp]
 *   SB: 2 Duress
 * with optional section headings (Commander, Deck, Sideboard, Maybeboard; "//" comments allowed).
 */
export function parseDecklist(text: string, opts: { singleton?: boolean } = {}): { lines: ParsedLine[]; problems: string[] } {
  const lines: ParsedLine[] = [];
  const problems: string[] = [];
  let board: Board = "main";
  let headed = false;
  let blankAfterCards = false;
  // Lines of a trailing group after a blank line, with no heading: a sideboard (Arena, MTGGoldfish)
  // or, in a Commander-style deck, the commander.
  let tail: ParsedLine[] | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    let s = raw.trim();
    if (!s) {
      if (lines.length) blankAfterCards = true;
      return;
    }
    // Headings: "Sideboard", "// Sideboard", "Sideboard:", "Commander (1)"
    const heading = s.replace(/^\/\/\s*/, "").replace(/:$/, "").replace(/\s*\(\d+\)$/, "").trim();
    const section = SECTION.find(([re]) => re.test(heading));
    if (section) {
      board = section[1];
      headed = true;
      blankAfterCards = false;
      tail = null;
      return;
    }
    if (s.startsWith("//") || s.startsWith("#")) return;
    let lineBoard = board;
    if (/^SB:\s*/i.test(s)) {
      lineBoard = "side";
      s = s.replace(/^SB:\s*/i, "");
    } else if (blankAfterCards && !headed && board === "main") {
      tail = [];
      blankAfterCards = false;
    }
    const m = s.match(/^(\d+)\s*x?\s+(.+)$/i);
    let q = 1;
    let rest = s;
    if (m) {
      q = parseInt(m[1], 10);
      rest = m[2];
    }
    // Archidekt categories: [Ramp], [Commander{top}]
    const tags = rest.match(/\[([^\]]*)\]/g)?.join(" ") || "";
    const tagBoard = tags && boardFromTags(tags);
    if (tagBoard) lineBoard = tagBoard;
    rest = rest.replace(/\s*\[[^\]]*\]/g, "").replace(/\s*\^[^^]*\^/g, "");
    const foil = /\*(F|E|foil|etched)\*/i.test(rest);
    if (/\*CMDR\*/i.test(rest)) lineBoard = "commander";
    rest = rest.replace(/\s*\*[^*]+\*/g, "").trim();
    // Set and number: "(C21) 263", "(c21) 263a", "[C21]" handled above
    let set: string | undefined, number: string | undefined;
    const sm = rest.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([^\s]+))?$/);
    if (sm) {
      rest = sm[1];
      set = sm[2].toLowerCase();
      number = sm[3];
    }
    const name = rest.trim();
    if (!name || q < 1) {
      problems.push(`Line ${i + 1}: couldn't read "${raw.trim()}"`);
      return;
    }
    const parsed: ParsedLine = { q, name, board: lineBoard, set, number, foil: foil || undefined, line: i + 1 };
    lines.push(parsed);
    if (tail && lineBoard === "main") tail.push(parsed);
  });
  const t = tail as ParsedLine[] | null; // assigned inside the loop above
  if (t && t.length && t.length < lines.length) {
    const n = t.reduce((sum, l) => sum + l.q, 0);
    const to: Board = opts.singleton ? (n <= 2 ? "commander" : "main") : "side";
    for (const l of t) l.board = to;
  }
  return { lines, problems };
}

/** Lowercase name without punctuation differences, for matching typed names to cards. */
export const nameKey = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Name index of the library: full names, and each face of a double-faced card. */
export function nameIndex(cards: Card[]): Map<string, Card> {
  const out = new Map<string, Card>();
  for (const c of cards) {
    if (!c.oracle_id) continue;
    const keys = [c.name, ...(c.name.includes(" // ") ? c.name.split(" // ") : []), ...(c.card_faces?.map((f) => f.name) || [])];
    for (const k of keys) {
      const key = nameKey(k);
      const cur = out.get(key);
      // Prefer real cards over tokens and other extras of the same name.
      if (!cur || (cur.extra && !c.extra)) out.set(key, c);
    }
  }
  return out;
}

/** A decklist as text, Moxfield style: "1 Name", with Commander/Sideboard/Maybeboard sections. */
export function formatDecklist(cards: DeckCard[], opts: { boards?: Board[] } = {}): string {
  const boards = opts.boards || BOARDS.map(([b]) => b);
  const out: string[] = [];
  for (const [b, label] of BOARDS) {
    if (!boards.includes(b)) continue;
    const lines = cards.filter((c) => c.b === b).sort((x, y) => x.n.localeCompare(y.n)).map((c) => `${c.q} ${c.n}`);
    if (!lines.length) continue;
    if (out.length || b !== "main") out.push(...(out.length ? [""] : []), label);
    out.push(...lines);
  }
  return out.join("\n") + "\n";
}

// ---------- grouping and checks ----------

export const TYPE_GROUPS = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"] as const;

/** The group a card is listed under in a deck: its first main type, in the usual order. */
export function typeGroup(typeLine: string | undefined): string {
  const front = (typeLine || "").split(" // ")[0];
  return TYPE_GROUPS.find((t) => front.includes(t)) || "Other";
}

const SINGLETON = new Set(["commander", "brawl", "oathbreaker"]);
const BASIC = /^Basic\b|^Basic Snow/;

/** Problems with a deck for its format: size, copies, legality, color identity. */
export function checkDeck(deck: Deck, cards: Map<string, Card>): string[] {
  const f = deck.format;
  if (!f) return [];
  const out: string[] = [];
  const inDeck = deck.cards.filter((c) => c.b === "main" || c.b === "commander");
  const size = deckSize(deck.cards);
  const commanders = deck.cards.filter((c) => c.b === "commander");
  if (f === "commander" && size !== 100) out.push(`Commander decks have exactly 100 cards, commander included; this one has ${size}.`);
  else if (f === "brawl" && size !== 60 && size !== 100) out.push(`Brawl decks have 60 cards (100 in Historic Brawl); this one has ${size}.`);
  else if (!SINGLETON.has(f) && size < 60) out.push(`${f[0].toUpperCase() + f.slice(1)} decks have at least 60 cards; this one has ${size}.`);
  if (SINGLETON.has(f) && !commanders.length) out.push("No commander chosen yet.");
  if (!SINGLETON.has(f) && deckSize(deck.cards, ["side"]) > 15) out.push("Sideboards hold at most 15 cards.");

  const copies = new Map<string, number>();
  for (const c of [...inDeck, ...(SINGLETON.has(f) ? [] : deck.cards.filter((x) => x.b === "side"))]) copies.set(c.o, (copies.get(c.o) || 0) + c.q);
  const identity = new Set(commanders.flatMap((c) => cards.get(c.o)?.color_identity || []));
  const off: string[] = [];
  for (const [o, n] of copies) {
    const card = cards.get(o);
    if (!card) continue;
    const any = /A deck can have any number of cards named/.test(card.oracle_text || "");
    const basic = BASIC.test(card.type_line || "");
    const limit = SINGLETON.has(f) ? 1 : 4;
    if (n > limit && !basic && !any) out.push(`${card.name}: ${n} copies (at most ${limit}).`);
    const legal = card.legalities?.[f];
    if (legal && legal !== "legal" && !(legal === "restricted" && n === 1)) out.push(`${card.name} is ${legal === "restricted" ? "restricted (1 copy)" : legal.replace("_", " ")} in ${f}.`);
    else if (!legal) out.push(`${card.name} isn't legal in ${f}.`);
    if (SINGLETON.has(f) && commanders.length && (card.color_identity || []).some((x: string) => !identity.has(x))) off.push(card.name);
  }
  if (off.length) out.push(`Outside the commander's colors: ${off.slice(0, 8).join(", ")}${off.length > 8 ? ` and ${off.length - 8} more` : ""}.`);
  return out;
}

/** Decklist lines matched to library cards by name; lines with names the library doesn't know come back in `unknown`. */
export function resolveLines(lines: ParsedLine[], index: Map<string, Card>): { cards: DeckCard[]; unknown: ParsedLine[] } {
  let cards: DeckCard[] = [];
  const unknown: ParsedLine[] = [];
  for (const l of lines) {
    const c = index.get(nameKey(l.name));
    if (!c?.oracle_id) unknown.push(l);
    else cards = addCard(cards, { o: c.oracle_id, n: c.name, q: l.q, b: l.board });
  }
  return { cards, unknown };
}

/** Copies of each card a deck needs beyond what is owned (owned copies count once per deck). */
export function missingCards(cards: DeckCard[], owned: Map<string, number>, boards: Board[] = ["commander", "main", "side"]): DeckCard[] {
  const need = new Map<string, DeckCard>();
  for (const c of cards) {
    if (!boards.includes(c.b)) continue;
    const cur = need.get(c.o);
    need.set(c.o, cur ? { ...cur, q: cur.q + c.q } : { ...c, b: "main", p: undefined });
  }
  return [...need.values()].map((c) => ({ ...c, q: c.q - Math.min(c.q, owned.get(c.o) || 0) })).filter((c) => c.q > 0);
}
