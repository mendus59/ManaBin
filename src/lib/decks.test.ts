import { test } from "node:test";
import assert from "node:assert/strict";
import { addCard, checkDeck, formatDecklist, missingCards, nameIndex, nameKey, parseDecklist, resolveLines, typeGroup, type Deck } from "./decks.ts";
import type { Card } from "./cards";

const brief = (text: string, singleton = false) =>
  parseDecklist(text, { singleton }).lines.map((l) => `${l.q} ${l.name} ${l.board}${l.set ? ` ${l.set}#${l.number}` : ""}${l.foil ? " foil" : ""}`);

test("plain, Moxfield and Archidekt lines", () => {
  assert.deepEqual(brief("1 Sol Ring\n2x Counterspell (MH2) 267 *F*\nLightning Bolt\n1x Arcane Signet (cmr) 297 [Ramp]"), [
    "1 Sol Ring main", "2 Counterspell main mh2#267 foil", "1 Lightning Bolt main", "1 Arcane Signet main cmr#297",
  ]);
});

test("sections, SB: lines and Archidekt categories", () => {
  assert.deepEqual(brief("Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n\nSideboard:\n1 Duress\nSB: 1 Negate\n// Maybeboard\n1 Opt"), [
    "1 Atraxa, Praetors' Voice commander", "1 Sol Ring main", "1 Duress side", "1 Negate side", "1 Opt maybe",
  ]);
  assert.deepEqual(brief("1x Atraxa, Praetors' Voice [Commander{top}]\n1x Opt [Maybeboard{noDeck}]"), ["1 Atraxa, Praetors' Voice commander", "1 Opt maybe"]);
});

test("a trailing group after a blank line is the sideboard, or a singleton deck's commander", () => {
  assert.deepEqual(brief("4 Opt\n4 Island\n\n2 Negate"), ["4 Opt main", "4 Island main", "2 Negate side"]);
  assert.deepEqual(brief("1 Sol Ring\n1 Island\n\n1 Atraxa, Praetors' Voice", true), ["1 Sol Ring main", "1 Island main", "1 Atraxa, Praetors' Voice commander"]);
});

test("names match whole cards and single faces", () => {
  const cards = [
    { oracle_id: "a", name: "Fire // Ice" },
    { oracle_id: "b", name: "Delver of Secrets // Insectile Aberration" },
    { oracle_id: "t", name: "Goblin", extra: true },
    { oracle_id: "g", name: "Goblin" },
  ] as Card[];
  const idx = nameIndex(cards);
  assert.equal(idx.get(nameKey("fire // ice"))!.oracle_id, "a");
  assert.equal(idx.get(nameKey("Delver of Secrets"))!.oracle_id, "b");
  assert.equal(idx.get(nameKey("Goblin"))!.oracle_id, "g");
  assert.equal(nameKey("Lim-Dûl’s Vault"), "lim-dul's vault");
});

test("formatting and adding cards", () => {
  let cards = addCard([], { o: "a", n: "Sol Ring", q: 1, b: "main" });
  cards = addCard(cards, { o: "a", n: "Sol Ring", q: 1, b: "main" });
  cards = addCard(cards, { o: "c", n: "Atraxa", q: 1, b: "commander" });
  assert.equal(cards.length, 2);
  assert.equal(formatDecklist(cards), "Commander\n1 Atraxa\n\nMain deck\n2 Sol Ring\n");
  assert.equal(formatDecklist(cards, { boards: ["main"] }), "2 Sol Ring\n");
  assert.equal(typeGroup("Legendary Artifact Creature — Golem"), "Creature");
  assert.equal(typeGroup("Basic Land — Island"), "Land");
});

test("commander checks", () => {
  const lib = new Map<string, Card>([
    ["cmd", { oracle_id: "cmd", name: "Krenko", color_identity: ["R"], type_line: "Legendary Creature", legalities: { commander: "legal" } } as unknown as Card],
    ["ring", { oracle_id: "ring", name: "Sol Ring", color_identity: [], type_line: "Artifact", legalities: { commander: "legal" } } as unknown as Card],
    ["opt", { oracle_id: "opt", name: "Opt", color_identity: ["U"], type_line: "Instant", legalities: { commander: "legal" } } as unknown as Card],
    ["mtn", { oracle_id: "mtn", name: "Mountain", color_identity: ["R"], type_line: "Basic Land — Mountain", legalities: { commander: "legal" } } as unknown as Card],
  ]);
  const deck: Deck = {
    id: "d", name: "Goblins", format: "commander", sharedWith: [], updated: "",
    cards: [
      { o: "cmd", n: "Krenko", q: 1, b: "commander" }, { o: "ring", n: "Sol Ring", q: 2, b: "main" },
      { o: "opt", n: "Opt", q: 1, b: "main" }, { o: "mtn", n: "Mountain", q: 96, b: "main" },
    ],
  };
  assert.deepEqual(checkDeck(deck, lib), ["Sol Ring: 2 copies (at most 1).", "Outside the commander's colors: Opt."]);
  assert.deepEqual(checkDeck({ ...deck, format: "" }, lib), []);
});

test("resolving a list and finding what's missing", () => {
  const idx = nameIndex([{ oracle_id: "r", name: "Sol Ring" }, { oracle_id: "o", name: "Opt" }] as Card[]);
  const { lines } = parseDecklist("2 sol ring\n1 Opt\n1 Not A Card\nSB: 2 Opt");
  const { cards, unknown } = resolveLines(lines, idx);
  assert.deepEqual(cards.map((c) => `${c.q} ${c.n} ${c.b}`), ["2 Sol Ring main", "1 Opt main", "2 Opt side"]);
  assert.deepEqual(unknown.map((l) => l.name), ["Not A Card"]);
  assert.deepEqual(missingCards(cards, new Map([["r", 1], ["o", 5]])).map((c) => `${c.q} ${c.n}`), ["1 Sol Ring"]);
});
