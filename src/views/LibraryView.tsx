// Every Magic card, one entry per card, with all of its printings in the card dialog.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Browse } from "../components/Browse";
import { loadLibrary, type Library } from "../lib/data";
import { prepare } from "../lib/search.js";

const day = (d: string) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function LibraryView({ nav }: { nav: ComponentChildren }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLibrary()
      .then((l) => {
        l.cards.forEach((c) => c._s || prepare(c));
        setLib(l);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const setNames = useMemo(() => {
    const out: Record<string, string> = {};
    lib?.sets.forEach((s, code) => (out[code] = s.name));
    return out;
  }, [lib]);

  if (!lib) {
    return (
      <>
        <header class="top"><div class="wrap"><div class="title-row"><div class="brand"><h1>ManaBin</h1>{nav}</div></div></div></header>
        <main class="wrap">
          {error ? (
            <div class="notice">
              <p><strong>The card library isn't available.</strong></p>
              <p>On the live site it is built by the <em>Card library</em> workflow. Locally, run <code>python tools/build_library.py</code> first.</p>
              <p class="muted">{error}</p>
            </div>
          ) : (
            <p class="empty">Loading the card library…</p>
          )}
        </main>
      </>
    );
  }

  const newest = lib.manifest.newest_set ? lib.sets.get(lib.manifest.newest_set) : undefined;
  return (
    <Browse
      nav={nav}
      title="the card library"
      cards={lib.cards}
      owned={false}
      setNames={setNames}
      scope="every Magic card printed on paper"
      placeholder="Search every card, e.g.  t:dragon c:r mv<=5"
      examples={["t:legendary t:creature id:golgari", 'o:"draw a card" mv<=2', "s:lea", "is:commander f:commander usd<1"]}
      headerRight={newest && <p class="total" title="Newest set in the library">Newest set <strong>{newest.name}</strong></p>}
      footer={
        <p>
          {lib.manifest.cards.toLocaleString()} cards and {lib.manifest.printings.toLocaleString()} printings from {lib.manifest.sets.toLocaleString()} sets,
          updated {day(lib.manifest.built_at)}. Prices are TCGplayer market prices via Scryfall.
          Card data and images from <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>.
          Magic: The Gathering is © Wizards of the Coast.
        </p>
      }
    />
  );
}
