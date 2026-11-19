import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionCards, entryKey, mergeEntries, moveChanges, ownedByOracle, type Entry } from "./collection.ts";
import { collectionCsv, parseBackup, parseCsv, parseManaBoxCsv, rowsToEntries, makeBackup } from "./transfer.ts";
import type { Card, Printing } from "./cards";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const O = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const e = (over: Partial<Entry>): Entry => ({ p: P1, o: O, f: "nonfoil", c: "NM", l: "en", q: 1, a: "2026-11-18", ...over });

test("merging adds quantities of matching entries only", () => {
  const base = new Map([[entryKey(e({ q: 2 })), e({ q: 2 })]]);
  const out = mergeEntries(base, [e({ q: 3 }), e({ f: "foil" })]);
  assert.equal(out.size, 2);
  assert.equal(out.get(entryKey(e({})))!.q, 5);
  assert.equal(ownedByOracle(out).get(O), 6);
});

test("entries become one card per printing with finish counts", () => {
  const entries = mergeEntries(new Map(), [e({ q: 2 }), e({ f: "foil", c: "LP" }), e({ p: P2, f: "etched" })]);
  const oracle = { id: P1, oracle_id: O, name: "Bolt", set: "m11", collector_number: "1", rarity: "common", legalities: {} } as Card;
  const prints: Printing[] = [
    { id: P1, set: "m11", collector_number: "149", rarity: "common", prices: { usd: "1.00" } },
    { id: P2, set: "sld", collector_number: "7", rarity: "rare", prices: { usd_etched: "9.00" } },
  ];
  const cards = collectionCards(entries, new Map([[O, oracle]]), new Map([[O, prints]]), { m11: "Magic 2011" });
  assert.equal(cards.length, 2);
  const m11 = cards.find((c) => c.set === "m11")!;
  assert.deepEqual(m11.owned, { qty: 3, foil: 1, etched: 0 });
  assert.equal(m11.set_name, "Magic 2011");
  assert.equal(m11.collector_number, "149");
});

test("CSV parsing handles quotes, commas and newlines", () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n'), [["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
});

const MANABOX = `Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency
"Bolt, the Card",m11,Magic 2011,149,foil,common,2,1,${P1},1.25,false,false,lightly_played,ja,USD
Mystery,xxx,X,1,normal,common,1,2,,0,false,false,near_mint,en,USD
Gone,yyy,Y,1,normal,common,1,3,${P2},0,false,false,near_mint,en,USD
`;

test("ManaBox CSV import keeps printing, finish, condition, language and price", () => {
  const parsed = parseManaBoxCsv(MANABOX);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.problems.length, 1); // no Scryfall ID
  const { entries, unknown } = rowsToEntries(parsed.rows, new Map([[P1, O]]), true);
  assert.equal(unknown.length, 1);
  assert.deepEqual({ ...entries[0], a: "" }, { p: P1, o: O, f: "foil", c: "LP", l: "ja", q: 2, pp: 1.25, a: "" });
});

test("CSV export round-trips through the importer", () => {
  const card = { id: P1, name: "Bolt, the Card", set: "m11", set_name: "Magic 2011", collector_number: "149", rarity: "common", legalities: {} } as Card;
  const csv = collectionCsv([e({ q: 4, f: "etched", c: "HP", l: "de", pp: 3, b: "Trade" })], new Map([[P1, card]]));
  const back = rowsToEntries(parseManaBoxCsv(csv).rows, new Map([[P1, O]]), true).entries[0];
  assert.deepEqual({ ...back, a: "" }, { p: P1, o: O, f: "etched", c: "HP", l: "de", q: 4, pp: 3, b: "Trade", a: "" });
});

test("JSON backup round-trips and rejects other files", () => {
  const entries = [e({ q: 2 }), e({ p: P2 })];
  assert.deepEqual(parseBackup(JSON.stringify(makeBackup(entries))), entries);
  assert.throws(() => parseBackup('{"cards": []}'));
});

test("moving entries to a binder joins matching entries there", () => {
  const a = e({ q: 2 }), b = e({ q: 1, b: "Trade" }), c = e({ f: "foil" });
  const entries = new Map([a, b, c].map((x) => [entryKey(x), x]));
  const out = moveChanges(entries, [entryKey(a), entryKey(c)], "Trade");
  assert.deepEqual(out.remove.sort(), [entryKey(a), entryKey(c)].sort());
  assert.deepEqual(out.set.map((x) => `${x.f} ${x.q} ${x.b}`).sort(), ["foil 1 Trade", "nonfoil 3 Trade"]);
  assert.deepEqual(moveChanges(entries, [entryKey(b)], "Trade"), { set: [], remove: [] });
  // Moving back to no binder
  const back = moveChanges(entries, [entryKey(b)], undefined);
  assert.deepEqual(back.remove, [entryKey(b)]);
  assert.equal(back.set[0].q, 3);
});
