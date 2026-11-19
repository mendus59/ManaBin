import { test } from "node:test";
import assert from "node:assert/strict";
import { pricesFrom, withSource } from "./prices.ts";
import type { Card } from "./cards";

const tcg = { usd: "1.00", usd_foil: "3.00", eur: "0.90" };
const store = [1.5, 2.5, 0, 0.8, 0, 0];

test("highest takes the top price of each finish", () => {
  assert.deepEqual(pricesFrom(tcg, store, "highest"), { usd: "1.50", usd_foil: "3.00", eur: "0.90" });
});

test("a store's price, falling back to TCGplayer where it has none", () => {
  assert.deepEqual(pricesFrom(tcg, store, "cardkingdom"), { usd: "1.50", usd_foil: "2.50", eur: "0.90" });
  assert.deepEqual(pricesFrom(tcg, store, "mtggoldfish"), { usd: "0.80", usd_foil: "3.00", eur: "0.90" });
  assert.deepEqual(pricesFrom(tcg, undefined, "mtggoldfish"), { usd: "1.00", usd_foil: "3.00", eur: "0.90" });
});

test("switching source keeps the TCGplayer prices to switch back to", () => {
  const c = { id: "x", prices: tcg } as unknown as Card;
  const ck = withSource(c, store, "cardkingdom");
  assert.equal(ck.prices!.usd, "1.50");
  assert.equal(withSource(ck, store, "tcgplayer").prices!.usd, "1.00");
});
