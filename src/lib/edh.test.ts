import { test } from "node:test";
import assert from "node:assert/strict";
import { canBeCommander, deckStats, edhrecSlug, parseEdhrec, roles, suggestFromCollection } from "./edh.ts";
import type { Card } from "./cards";

const card = (o: string, name: string, type: string, text = "", extra: Partial<Card> = {}) =>
  ({ oracle_id: o, name, type_line: type, oracle_text: text, color_identity: [], legalities: { commander: "legal" }, cmc: 0, ...extra }) as unknown as Card;

test("roles from rules text", () => {
  const r = (text: string, type = "Sorcery") => [...roles(card("x", "X", type, text))].sort().join(",");
  assert.equal(r("{T}: Add {C}{C}.", "Artifact"), "ramp");
  assert.equal(r("Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."), "ramp");
  assert.equal(r("Draw two cards."), "draw");
  assert.equal(r("Destroy target creature. Its controller gains 3 life."), "removal");
  assert.equal(r("Destroy all creatures. They can't be regenerated."), "wipe");
  assert.equal(r("Search your library for a card, put that card into your hand, then shuffle."), "tutor");
  assert.equal(r("{T}: Add {G}.", "Basic Land — Forest"), "land");
});

test("commanders", () => {
  assert.ok(canBeCommander(card("k", "Krenko", "Legendary Creature — Goblin Warrior")));
  assert.ok(canBeCommander(card("t", "Teferi", "Legendary Planeswalker — Teferi", "Teferi, Temporal Archmage can be your commander.")));
  assert.ok(!canBeCommander(card("g", "Goblin Guide", "Creature — Goblin Scout")));
});

test("EDHREC slugs and pages", () => {
  assert.equal(edhrecSlug(["Krenko, Mob Boss"]), "krenko-mob-boss");
  assert.equal(edhrecSlug(["Atraxa, Praetors' Voice"]), "atraxa-praetors-voice");
  assert.equal(edhrecSlug(["Thrasios, Triton Hero", "Tymna the Weaver"]), "thrasios-triton-hero-tymna-the-weaver");
  const page = { container: { json_dict: { cardlists: [
    { header: "Top Cards", cardviews: [{ name: "Sol Ring", num_decks: 90, potential_decks: 100, synergy: 0.01 }] },
    { header: "Creatures", cardviews: [{ name: "Sol Ring" }, { name: "Goblin Matron", num_decks: 30, potential_decks: 100, synergy: 0.4 }] },
  ] } } };
  assert.deepEqual(parseEdhrec(page).map((c) => `${c.name} ${c.section} ${c.inclusion}`), ["Sol Ring Top Cards 0.9", "Goblin Matron Creatures 0.3"]);
  assert.deepEqual(parseEdhrec({}), []);
});

test("suggestions from the collection fit the commander", () => {
  const krenko = card("k", "Krenko, Mob Boss", "Legendary Creature — Goblin Warrior", "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.", { color_identity: ["R"] });
  const matron = card("m", "Goblin Matron", "Creature — Goblin", "When this creature enters, you may search your library for a Goblin card.", { color_identity: ["R"], edhrec_rank: 3000 });
  const ring = card("r", "Sol Ring", "Artifact", "{T}: Add {C}{C}.", { edhrec_rank: 1 });
  const opt = card("o", "Opt", "Instant", "Scry 1. Draw a card.", { color_identity: ["U"] });
  const banned = card("b", "Banned Thing", "Artifact", "", { legalities: { commander: "banned" } });
  const oracles = new Map([krenko, matron, ring, opt, banned].map((c) => [c.oracle_id!, c]));
  const owned = new Map([["k", 1], ["m", 1], ["r", 2], ["o", 4], ["b", 1]]);
  const s = suggestFromCollection([krenko], owned, oracles, new Set());
  assert.deepEqual(s.map((x) => x.card.name), ["Goblin Matron", "Sol Ring"]);
  assert.match(s[0].reason, /Goblin/);
  assert.deepEqual(suggestFromCollection([krenko], owned, oracles, new Set(["m"])).map((x) => x.card.name), ["Sol Ring"]);
});

test("deck stats", () => {
  const oracles = new Map([
    ["a", card("a", "Bear", "Creature — Bear", "", { cmc: 2, mana_cost: "{1}{G}" })],
    ["b", card("b", "Forest", "Basic Land — Forest", "({T}: Add {G}.)", { produced_mana: ["G"] })],
    ["c", card("c", "Big", "Creature — Dinosaur", "", { cmc: 9, mana_cost: "{7}{G}{G}", game_changer: true })],
  ]);
  const st = deckStats([{ o: "a", n: "Bear", q: 2, b: "main" }, { o: "b", n: "Forest", q: 10, b: "main" }, { o: "c", n: "Big", q: 1, b: "main" }], oracles);
  assert.deepEqual(st.curve, [0, 0, 2, 0, 0, 0, 0, 1]);
  assert.equal(st.pips.G, 4);
  assert.equal(st.sources.G, 10);
  assert.equal(st.roles.land, 10);
  assert.deepEqual(st.gameChangers, ["Big"]);
  assert.equal(st.averageMv.toFixed(2), "4.33");
});
