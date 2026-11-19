import { test } from "node:test";
import assert from "node:assert/strict";
import { baseline, binderTotals, priceMap, recentPrintings, recordSnapshot, unitPrice, valueChange, type Snapshot } from "./dashboard.ts";
import { entryKey, type Entry } from "./collection.ts";
import type { Card } from "./cards";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const e = (over: Partial<Entry>): Entry => ({ p: P1, o: "o1", f: "nonfoil", c: "NM", l: "en", q: 1, a: "2026-11-18", ...over });
const entries = (...list: Entry[]) => new Map(list.map((x) => [entryKey(x), x]));
const card = (id: string, prices: Record<string, string>) => ({ id, name: id, prices } as unknown as Card);

test("unit prices fall back to another finish", () => {
  assert.equal(unitPrice({ usd: "1.50", usd_foil: "4" }, "foil"), 4);
  assert.equal(unitPrice({ usd_foil: "4" }, "nonfoil"), 4);
  assert.equal(unitPrice({ usd: "2" }, "etched"), 2);
  assert.equal(unitPrice(undefined, "nonfoil"), 0);
});

test("snapshots keep one per price update and drop old ones", () => {
  let saved: Snapshot[] = [];
  saved = recordSnapshot(saved, { at: "2026-10-01T09:30:00Z", prices: { a: 1 } });
  saved = recordSnapshot(saved, { at: "2026-11-10T09:30:00Z", prices: { a: 2 } });
  saved = recordSnapshot(saved, { at: "2026-11-10T09:30:00Z", prices: { b: 3 } });
  saved = recordSnapshot(saved, { at: "2026-11-18T09:30:00Z", prices: { a: 4 } });
  assert.deepEqual(saved.map((s) => s.at), ["2026-11-10T09:30:00Z", "2026-11-18T09:30:00Z"]);
  assert.deepEqual(saved[0].prices, { a: 2, b: 3 });
});

test("the baseline is the newest update at least a week old, else the oldest earlier one", () => {
  const s = (at: string): Snapshot => ({ at, prices: {} });
  const saved = [s("2026-11-05T09:30:00Z"), s("2026-11-11T09:30:00Z"), s("2026-11-15T09:30:00Z"), s("2026-11-18T09:30:00Z")];
  assert.equal(baseline(saved, "2026-11-18T09:30:00Z")?.at, "2026-11-11T09:30:00Z");
  assert.equal(baseline(saved.slice(2), "2026-11-18T09:30:00Z")?.at, "2026-11-15T09:30:00Z");
  assert.equal(baseline(saved.slice(3), "2026-11-18T09:30:00Z"), null);
});

test("value change counts only cards that had an earlier price", () => {
  const es = entries(e({ q: 2 }), e({ p: P2, f: "foil" }), e({ p: P2, c: "LP" }));
  const by = new Map([[P1, card(P1, { usd: "3" })], [P2, card(P2, { usd: "1", usd_foil: "10" })]]);
  const before = { [`${P1}|nonfoil`]: 2, [`${P2}|foil`]: 12 };
  const { change, base, movers } = valueChange(es, by, before);
  assert.equal(change, 2 * 1 + (10 - 12));
  assert.equal(base, 4 + 12);
  assert.equal(movers.length, 2);
  assert.deepEqual(priceMap(es.values(), by), { [`${P1}|nonfoil`]: 3, [`${P2}|foil`]: 10, [`${P2}|nonfoil`]: 1 });
});

test("recent printings are newest first, one per printing", () => {
  const es = entries(e({ a: "2026-11-01" }), e({ p: P2, a: "2026-11-10" }), e({ c: "LP", a: "2026-11-12" }));
  assert.deepEqual(recentPrintings(es, 5).map((x) => [x.p, x.a]), [[P1, "2026-11-12"], [P2, "2026-11-10"]]);
});

test("binder totals add cards and value per binder", () => {
  const es = entries(e({ q: 2, b: "Trade" }), e({ p: P2 }));
  const by = new Map([[P1, card(P1, { usd: "3" })], [P2, card(P2, { usd: "1" })]]);
  const t = binderTotals(es, by);
  assert.deepEqual(t.get("Trade"), { cards: 2, value: 6 });
  assert.deepEqual(t.get(""), { cards: 1, value: 1 });
});
