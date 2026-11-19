// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, ownedPrice, prepare } from "./search.js";

const bolt = prepare({
  id: "a", name: "Lightning Bolt", set: "m11", print_sets: ["lea", "m11"], collector_number: "149", rarity: "common",
  mana_cost: "{R}", cmc: 1, type_line: "Instant", oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"], color_identity: ["R"], finishes: ["nonfoil", "foil"], prices: { usd: "1.50", usd_foil: "4.00" },
  legalities: { commander: "legal", modern: "legal" },
});
const owned = prepare({ ...bolt, _s: undefined, owned: { qty: 3, foil: 3, etched: 0 } });
const elf = prepare({
  id: "b", name: "Llanowar Elves", set: "dom", collector_number: "168", rarity: "common", mana_cost: "{G}", cmc: 1,
  type_line: "Creature — Elf Druid", oracle_text: "{T}: Add {G}.", power: "1", toughness: "1", colors: ["G"],
  color_identity: ["G"], finishes: ["nonfoil"], prices: { usd: "0.25" }, legalities: { commander: "legal" },
});
const hits = (q, cards = [bolt, elf]) => cards.filter(compile(q).test).map((c) => c.name);

test("basic terms", () => {
  assert.deepEqual(hits("t:creature"), ["Llanowar Elves"]);
  assert.deepEqual(hits("c:r mv<=1"), ["Lightning Bolt"]);
  assert.deepEqual(hits('o:"3 damage" or t:elf'), ["Lightning Bolt", "Llanowar Elves"]);
  assert.deepEqual(hits("-c:g f:modern"), ["Lightning Bolt"]);
});

test("library cards match any set they were printed in", () => {
  assert.deepEqual(hits("s:lea"), ["Lightning Bolt"]);
  assert.deepEqual(hits("-s:lea"), ["Llanowar Elves"]);
});

test("finish and price look at the printing for library cards", () => {
  assert.deepEqual(hits("is:foil"), ["Lightning Bolt"]);
  assert.equal(ownedPrice(bolt, "usd"), 1.5);
  assert.deepEqual(hits("qty>=1"), []);
});

test("collection cards use the copies owned", () => {
  assert.equal(ownedPrice(owned, "usd"), 4);
  assert.deepEqual(hits("qty>=3", [owned]), ["Lightning Bolt"]);
  assert.deepEqual(hits("is:nonfoil", [owned]), []);
});

test("unknown keywords warn instead of failing", () => {
  const c = compile("frobnicate:3 t:instant");
  assert.equal(c.warnings.length, 1);
  assert.deepEqual([bolt, elf].filter(c.test).map((x) => x.name), ["Lightning Bolt"]);
});
