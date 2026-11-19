// A collection: your own (with import and export), or a friend's that they share with you (read-only).
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Browse } from "../components/Browse";
import { ImportDialog } from "../components/ImportDialog";
import { dollars, ownedValue, type Card, type Printing } from "../lib/cards";
import { collectionCards, totalCopies, type Entries } from "../lib/collection";
import { loadLibrary, loadPriceManifest, loadPrintings, loadStorePrices, type Library } from "../lib/data";
import { SOURCES, withSource, type PriceSource } from "../lib/prices";
import { prepare } from "../lib/search.js";
import { collectionCsv, download, makeBackup } from "../lib/transfer";
import { SignInPrompt } from "../components/SignInPrompt";
import { BinderBar, MoveShown, inBinder, type BinderFilter } from "../components/Binders";
import { useCollection } from "../state/collection";
import { useFriends } from "../state/friends";

const stamp = () => new Date().toISOString().slice(0, 10);

const SOURCE_KEY = "manabin-price-source";
function savedSource(): PriceSource {
  try {
    const s = localStorage.getItem(SOURCE_KEY);
    if (SOURCES.some(([k]) => k === s)) return s as PriceSource;
  } catch { /* storage blocked */ }
  return "highest";
}

/** A friend's collection, live, while they share it with you. */
function useFriendEntries(uid: string | undefined) {
  const { backend, account } = useCollection();
  const [entries, setEntries] = useState<Entries | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEntries(null);
    setError(null);
    if (!uid || !backend || !account || account.isAnonymous) return;
    return backend.subscribe(uid, (e) => setEntries(e), (e) => setError(e.message));
  }, [uid, backend, account?.uid]);
  return { entries, error };
}

export function CollectionView({ nav, friendUid }: { nav: ComponentChildren; friendUid?: string }) {
  const col = useCollection();
  const friend = useFriendEntries(friendUid);
  const { friendships } = useFriends();
  const friendship = friendUid ? friendships?.find((f) => f.status === "accepted" && f.members.includes(friendUid)) : undefined;
  const friendName = friendship?.names[friendUid!] || "Your friend";
  const entries = friendUid ? friend.entries : col.entries;
  const loadError = friendUid ? friend.error : col.error;
  const [lib, setLib] = useState<Library | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [printings, setPrintings] = useState<Map<string, Printing[]>>(new Map());
  const [importing, setImporting] = useState(false);
  const [store, setStore] = useState<Map<string, number[]>>(new Map());
  const [source, setSource] = useState<PriceSource>(savedSource);
  const [pricesAt, setPricesAt] = useState<string | null>(null);
  const [binder, setBinder] = useState<BinderFilter>(null);
  // Your own collection can be narrowed to one binder; a friend's is shown whole.
  const shownEntries = useMemo(() => (entries && !friendUid ? inBinder(entries, binder) : entries), [entries, binder, friendUid]);

  useEffect(() => {
    loadPriceManifest().then((m) => m && setPricesAt(new Date(m.built_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })));
  }, []);
  const pickSource = (s: PriceSource) => {
    setSource(s);
    try { localStorage.setItem(SOURCE_KEY, s); } catch { /* private window: keep it for this visit */ }
  };
  const sourceName = SOURCES.find(([s]) => s === source)![1];
  const sourcePicker = (
    <label class="source" title="Which store's prices to value cards with">
      <span class="muted">Prices</span>
      <select value={source} onChange={(e) => pickSource(e.currentTarget.value as PriceSource)}>
        {SOURCES.map(([s, name]) => <option key={s} value={s}>{name}</option>)}
      </select>
    </label>
  );
  const priceNote = {
    highest: "Prices are the highest of TCGplayer market, Card Kingdom retail and MTGGoldfish for each card.",
    tcgplayer: "Prices are TCGplayer market prices via Scryfall.",
    cardkingdom: "Prices are Card Kingdom retail, or TCGplayer where Card Kingdom doesn't list a card.",
    mtggoldfish: "Prices are from MTGGoldfish, or TCGplayer where MTGGoldfish doesn't list a card.",
  }[source] + (pricesAt && source !== "tcgplayer" ? ` Card Kingdom and MTGGoldfish prices from ${pricesAt}.` : "");
  const totalTitle = `${sourceName} price for each copy owned`;

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
    if (!entries) return;
    const need = [...new Set([...entries.values()].map((e) => e.o))].filter((o) => !printings.has(o));
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
  }, [entries]);

  // Card Kingdom and MTGGoldfish prices for the cards owned (cached by shard too).
  useEffect(() => {
    if (!entries?.size) return;
    let live = true;
    loadStorePrices([...new Set([...entries.values()].map((e) => e.o))]).then((sp) => live && setStore(sp));
    return () => { live = false; };
  }, [entries]);

  const cards = useMemo<Card[] | null>(() => {
    if (!lib || !shownEntries) return null;
    const list = collectionCards(shownEntries, oracles, printings, setNames).map((c) => withSource(c, store.get(c.id), source));
    list.forEach((c) => prepare(c));
    return list;
  }, [lib, shownEntries, printings, oracles, store, source]);

  const byPrinting = useMemo(() => new Map((cards || []).map((c) => [c.id, c])), [cards]);
  const value = useMemo(() => (cards || []).reduce((n, c) => n + ownedValue(c), 0), [cards]);
  const loadingPrintings = !!entries && [...entries.values()].some((e) => !printings.has(e.o));

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
  if (col.signedOut || (friendUid && col.account?.isAnonymous)) {
    return header(<SignInPrompt why={friendUid ? "Sign in with Google to see collections your friends share with you." : "Sign in with Google to keep a collection, import a ManaBox CSV, and use it on any device."} />);
  }
  if (friendUid && friendships && !friendship?.sharing?.[friendUid]) {
    return header(
      <div class="notice">
        <p><strong>{friendship ? `${friendName} isn't sharing their collection with you.` : "This person isn't on your friends list."}</strong></p>
        <p><a href="#/friends">Back to friends</a></p>
      </div>,
    );
  }
  if (!cards) {
    return header(
      loadError && !entries
        ? <div class="notice"><p><strong>{friendUid ? `${friendName}'s collection couldn't be loaded.` : "Your collection couldn't be loaded."}</strong></p><p>{loadError}</p></div>
        : <p class="empty">{friendUid ? `Loading ${friendName}'s collection…` : "Loading your collection…"}</p>,
    );
  }

  const n = totalCopies(shownEntries!);
  const counts = (
    <span class="muted">
      {n.toLocaleString()} card{n === 1 ? "" : "s"} · {shownEntries!.size.toLocaleString()} line{shownEntries!.size === 1 ? "" : "s"}
      {loadingPrintings && " · loading card details…"}
    </span>
  );

  if (friendUid) {
    return (
      <Browse
        nav={nav}
        title={`${friendName}'s collection`}
        cards={cards}
        owned={true}
        setNames={setNames}
        scope={`${friendName}'s collection`}
        placeholder={`Search ${friendName}'s collection, e.g.  t:dragon c:r mv<=5`}
        examples={["t:legendary t:creature", "is:foil order:usd", "qty>=4", "usd>10"]}
        headerRight={<p class="total" title={totalTitle}>Total value <strong>{dollars(value)}</strong></p>}
        toolbar={<div class="toolbar">{counts}<span class="actions">{sourcePicker}<a class="ghost button" href="#/friends">Back to friends</a></span></div>}
        empty={<div class="notice empty-collection"><p><strong>{friendName}'s collection is empty.</strong></p></div>}
        footer={<p>Shared with you by {friendName}. {priceNote}</p>}
      />
    );
  }

  const toolbar = (
    <div class="toolbar">
      {counts}
      <span class="actions">
        {sourcePicker}
        <button type="button" class="ghost" onClick={() => setImporting(true)}>Import</button>
        <button type="button" class="ghost" disabled={!n}
          onClick={() => download(`manabin-${binder ? binder.replace(/[^\w-]+/g, "-").toLowerCase() : "collection"}-${stamp()}.csv`, collectionCsv(shownEntries!.values(), byPrinting), "text/csv")}>
          Export CSV
        </button>
        <button type="button" class="ghost" disabled={!totalCopies(entries!)}
          onClick={() => download(`manabin-backup-${stamp()}.json`, JSON.stringify(makeBackup(entries!.values())), "application/json")}>
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
        headerRight={<p class="total" title={totalTitle}>Total value <strong>{dollars(value)}</strong></p>}
        toolbar={<>{toolbar}{col.kind && <BinderBar value={binder} onChange={setBinder} />}</>}
        shownTools={(shown) => <MoveShown shown={shown} entries={shownEntries!} />}
        empty={binder !== null ? (
          <div class="notice empty-collection">
            <p><strong>{binder ? `The binder "${binder}" is empty.` : "Every card is in a binder."}</strong></p>
            <p>Choose <em>All cards</em>, search for the cards you want, and move them here with <em>Move the cards shown</em>, or pick a binder when you add a card.</p>
          </div>
        ) : (
          <div class="notice empty-collection">
            <p><strong>Your collection is empty.</strong></p>
            <p>Open any card in the <a href="#/library">Card library</a> and add the exact printing you own, or import a ManaBox CSV export.</p>
            <button type="button" class="primary" onClick={() => setImporting(true)}>Import a ManaBox CSV</button>
          </div>
        )}
        footer={
          <p>
            {col.account?.isAnonymous === false
              ? "Saved to your Google account and available on any device you sign in on."
              : col.kind === "memory"
                ? "Saved in this browser only."
                : "Saved to a guest account on this device. Sign in with Google to keep it safe and use it on other devices."}
            {" "}{priceNote}
          </p>
        }
      />
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}
