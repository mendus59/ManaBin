// The signed-in user's own collection: every printing they own, with import and export.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Browse } from "../components/Browse";
import { ImportDialog } from "../components/ImportDialog";
import { dollars, ownedValue, type Card, type Printing } from "../lib/cards";
import { collectionCards, totalCopies } from "../lib/collection";
import { loadLibrary, loadPrintings, type Library } from "../lib/data";
import { prepare } from "../lib/search.js";
import { collectionCsv, download, makeBackup } from "../lib/transfer";
import { useCollection } from "../state/collection";

const stamp = () => new Date().toISOString().slice(0, 10);

export function CollectionView({ nav }: { nav: ComponentChildren }) {
  const col = useCollection();
  const [lib, setLib] = useState<Library | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [printings, setPrintings] = useState<Map<string, Printing[]>>(new Map());
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    loadLibrary().then(setLib).catch((e) => setLibError(String(e)));
  }, []);

  const oracles = useMemo(() => new Map((lib?.cards || []).map((c) => [c.oracle_id!, c])), [lib]);
  const setNames = useMemo(() => {
    const out: Record<string, string> = {};
    lib?.sets.forEach((s, code) => (out[code] = s.name));
    return out;
  }, [lib]);

  // Load the printings of every card owned (cached, so only new cards cost a request).
  useEffect(() => {
    if (!col.entries) return;
    const need = [...new Set([...col.entries.values()].map((e) => e.o))].filter((o) => !printings.has(o));
    if (!need.length) return;
    let live = true;
    Promise.all(need.map(async (o) => [o, await loadPrintings(o)] as const)).then((loaded) => {
      if (!live) return;
      setPrintings((cur) => {
        const next = new Map(cur);
        for (const [o, ps] of loaded) next.set(o, ps);
        return next;
      });
    });
    return () => { live = false; };
  }, [col.entries]);

  const cards = useMemo<Card[] | null>(() => {
    if (!lib || !col.entries) return null;
    const list = collectionCards(col.entries, oracles, printings, setNames);
    list.forEach((c) => prepare(c));
    return list;
  }, [lib, col.entries, printings, oracles]);

  const byPrinting = useMemo(() => new Map((cards || []).map((c) => [c.id, c])), [cards]);
  const value = useMemo(() => (cards || []).reduce((n, c) => n + ownedValue(c), 0), [cards]);
  const loadingPrintings = !!col.entries && [...col.entries.values()].some((e) => !printings.has(e.o));

  const header = (body: ComponentChildren) => (
    <>
      <header class="top"><div class="wrap"><div class="title-row"><div class="brand"><h1>ManaBin</h1>{nav}</div></div></div></header>
      <main class="wrap">{body}</main>
    </>
  );

  if (libError) {
    return header(
      <div class="notice">
        <p><strong>The card library isn't available,</strong> so your collection can't be shown yet.</p>
        <p class="muted">{libError}</p>
      </div>,
    );
  }
  if (!cards) {
    return header(
      col.error && !col.entries
        ? <div class="notice"><p><strong>Your collection couldn't be loaded.</strong></p><p>{col.error}</p></div>
        : <p class="empty">Loading your collection…</p>,
    );
  }

  const n = totalCopies(col.entries!);
  const toolbar = (
    <div class="toolbar">
      <span class="muted">
        {n.toLocaleString()} card{n === 1 ? "" : "s"} · {col.entries!.size.toLocaleString()} line{col.entries!.size === 1 ? "" : "s"}
        {loadingPrintings && " · loading card details…"}
      </span>
      <span class="actions">
        <button type="button" class="ghost" onClick={() => setImporting(true)}>Import</button>
        <button type="button" class="ghost" disabled={!n}
          onClick={() => download(`manabin-collection-${stamp()}.csv`, collectionCsv(col.entries!.values(), byPrinting), "text/csv")}>
          Export CSV
        </button>
        <button type="button" class="ghost" disabled={!n}
          onClick={() => download(`manabin-backup-${stamp()}.json`, JSON.stringify(makeBackup(col.entries!.values())), "application/json")}>
          Back up (JSON)
        </button>
      </span>
    </div>
  );

  return (
    <>
      <Browse
        nav={nav}
        title="your collection"
        cards={cards}
        owned={true}
        setNames={setNames}
        scope="your collection"
        placeholder="Search your collection, e.g.  t:dragon c:r mv<=5"
        examples={["t:legendary t:creature", "is:foil order:usd", "qty>=4", "usd>10"]}
        headerRight={<p class="total" title="TCGplayer market price for each copy owned">Total value <strong>{dollars(value)}</strong></p>}
        toolbar={toolbar}
        empty={
          <div class="notice empty-collection">
            <p><strong>Your collection is empty.</strong></p>
            <p>Open any card in the <a href="#/library">Card library</a> and add the exact printing you own, or import a ManaBox CSV export.</p>
            <button type="button" class="primary" onClick={() => setImporting(true)}>Import a ManaBox CSV</button>
          </div>
        }
        footer={
          <p>
            {col.account?.isAnonymous === false
              ? "Saved to your Google account and available on any device you sign in on."
              : col.kind === "memory"
                ? "Saved in this browser only."
                : "Saved to a guest account on this device. Sign in with Google to keep it safe and use it on other devices."}
            {" "}Prices are TCGplayer market prices via Scryfall.
          </p>
        }
      />
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}
