import { test } from "node:test";
import assert from "node:assert/strict";
import { addPending, nameMatcher, normalizeName, pickPrinting, readCollectorLine, toEntries, type PendingCard } from "./scan.ts";
import type { Card, Printing } from "./cards";

const cards = [
  { oracle_id: "bolt", name: "Lightning Bolt" },
  { oracle_id: "ajani", name: "Ajani, the Greathearted" },
  { oracle_id: "opt", name: "Opt" },
  { oracle_id: "fire", name: "Fire // Ice" },
  { oracle_id: "delver", name: "Delver of Secrets // Insectile Aberration" },
  { oracle_id: "tok", name: "Goblin", extra: true },
  { oracle_id: "gob", name: "Goblin Guide" },
  { oracle_id: "lim", name: "Lim-Dûl's Vault" },
] as Card[];
const match = nameMatcher(cards);
const hit = (t: string) => match(t)?.card.oracle_id ?? null;

test("names read by the camera match the right card", () => {
  assert.equal(normalizeName("Lim-Dûl’s Vault"), "lim duls vault");
  assert.equal(hit("Lightning Bolt"), "bolt");
  assert.equal(hit("Lightnirg Bo1t"), "bolt");
  assert.equal(hit("Ajani, the Greathearted @ ©"), "ajani");
  assert.equal(hit("Ajani the Greatheartecl"), "ajani");
  assert.equal(hit("Delver of Secrets"), "delver");
  assert.equal(hit("Fire"), "fire");
  assert.equal(hit("Lim-Dul's Vault"), "lim");
  assert.equal(hit("Opt"), "opt");
  assert.equal(hit("Goblin Guide"), "gob");
});

test("short or garbled reads don't match", () => {
  assert.equal(hit("Oqt"), null);
  assert.equal(hit("~~ ."), null);
  assert.equal(hit("Xqzvw Plorbit"), null);
  assert.equal(hit(""), null);
});

test("the collector line", () => {
  assert.deepEqual(readCollectorLine("0184/0264 R\nWAR • EN  Chase Stone"), { number: "184", sets: ["WAR", "CHASE", "STONE"], lang: "en" });
  const star = readCollectorLine("0233 C\nMB2 ★ EN Some Artist");
  assert.equal(star.number, "233");
  assert.equal(star.sets[0], "MB2");
  // Misread separators, as seen from the camera
  assert.deepEqual(readCollectorLine("WAR +EN Christopher Moeller").sets[0], "WAR");
  assert.deepEqual(readCollectorLine("MB2 JEN Christopher Moeller").sets[0], "MB2");
  const gk1 = readCollectorLine("057C\nGK1+EN Christopher Moeller");
  assert.deepEqual([gk1.number, gk1.sets[0], gk1.lang], ["57", "GK1", "en"]);
  assert.equal(readCollectorLine("O45/2O1 U\nMOM * JA").number, "45");
  assert.equal(readCollectorLine("O45/2O1 U\nMOM * JA").lang, "ja");
  assert.deepEqual(readCollectorLine("blurry").sets, []);
});

const p = (id: string, set: string, n: string, extra: Partial<Printing> = {}) =>
  ({ id, set, collector_number: n, rarity: "c", prices: {}, finishes: ["nonfoil", "foil"], ...extra }) as Printing;
const prints = [p("a", "m21", "199"), p("b", "2xm", "117"), p("c", "pm21", "199p", { promo: true }), p("d", "m10", "146")];

test("picking the printing", () => {
  assert.deepEqual(pickPrinting(prints, readCollectorLine("0117/0332 C\n2XM • EN")), { printing: prints[1], sure: true });
  assert.deepEqual(pickPrinting(prints, readCollectorLine("0146/0249 C\nMlO • EN")), { printing: prints[3], sure: false });
  // A number alone counts when it's in the set scanned last.
  assert.deepEqual(pickPrinting(prints, readCollectorLine("0146 C"), "m10"), { printing: prints[3], sure: true });
  // Nothing read: the set scanned last, then the newest regular printing.
  assert.deepEqual(pickPrinting(prints, null, "2xm"), { printing: prints[1], sure: false });
  assert.deepEqual(pickPrinting([prints[2], ...prints], null), { printing: prints[0], sure: false });
  assert.equal(pickPrinting([], null), null);
});

test("pending scans become collection entries", () => {
  const item = (id: string, pr: string, f: "nonfoil" | "foil" = "nonfoil"): PendingCard =>
    ({ id, o: "bolt", n: "Lightning Bolt", p: pr, set: "m10", num: "146", f, c: "NM", l: "en", q: 1, sure: true });
  let list = addPending([], item("1", "d"));
  list = addPending(list, item("2", "d"));
  list = addPending(list, item("3", "d", "foil"));
  assert.deepEqual(list.map((x) => `${x.id} ${x.q} ${x.f}`), ["3 1 foil", "1 2 nonfoil"]);
  const entries = toEntries(list, "Trade binder", "2026-11-19");
  assert.deepEqual(entries, [
    { p: "d", o: "bolt", f: "foil", c: "NM", l: "en", q: 1, b: "Trade binder", a: "2026-11-19" },
    { p: "d", o: "bolt", f: "nonfoil", c: "NM", l: "en", q: 2, b: "Trade binder", a: "2026-11-19" },
  ]);
  assert.equal(toEntries(list, "", "2026-11-19")[0].b, undefined);
});
