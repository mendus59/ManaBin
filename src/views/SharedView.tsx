// The published collection (public/shared/collection.json), built from a ManaBox export.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Browse } from "../components/Browse";
import { SHARED_COLLECTION_NAME } from "../config";
import { dollars, ownedValue } from "../lib/cards";
import { loadSets, loadShared, type SharedCollection } from "../lib/data";
import { prepare } from "../lib/search.js";

const day = (d: string) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function SharedView({ nav }: { nav: ComponentChildren }) {
  const [data, setData] = useState<SharedCollection | null>(null);
  const [setNames, setSetNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadShared()
      .then((d) => {
        d.cards.forEach((c) => c._s || prepare(c));
        setData(d);
      })
      .catch((e) => setError(String(e)));
    loadSets().then((sets) => {
      const out: Record<string, string> = {};
      sets.forEach((s, code) => (out[code] = s.name));
      setSetNames(out);
    });
  }, []);

  const total = useMemo(() => (data ? data.cards.reduce((n, c) => n + ownedValue(c), 0) : 0), [data]);

  if (!data) {
    return (
      <>
        <header class="top"><div class="wrap"><div class="title-row"><div class="brand"><h1>ManaBin</h1>{nav}</div></div></div></header>
        <main class="wrap">{error ? <p class="notice">Couldn't load the collection: {error}</p> : <p class="empty">Loading…</p>}</main>
      </>
    );
  }

  return (
    <Browse
      nav={nav}
      title={SHARED_COLLECTION_NAME}
      cards={data.cards}
      owned={true}
      setNames={setNames}
      scope="this collection"
      placeholder="Search with Scryfall syntax, e.g.  t:dragon c:r mv<=5"
      examples={["t:legendary t:creature id:golgari", 'o:"draw a card" mv<=2', "is:foil order:usd", "(t:goblin or t:elf) -c:g"]}
      headerRight={
        <p class="total" title="Highest of TCGplayer, Card Kingdom and MTGGoldfish for each copy owned">
          Total value <strong>{dollars(total)}</strong>
        </p>
      }
      footer={
        <p>
          {data.generated && `Collection updated ${day(data.generated)}. `}
          {data.prices_updated && `Prices updated ${day(data.prices_updated)} (highest of TCGplayer, Card Kingdom and MTGGoldfish). `}
          Card data and images from <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>.
          Magic: The Gathering is © Wizards of the Coast.
        </p>
      }
    />
  );
}
