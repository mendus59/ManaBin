// The landing page: a welcome for visitors who aren't signed in, and a dashboard of your
// collection, decks and binders for everyone with an account (guests included).
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ImportDialog } from "../components/ImportDialog";
import { dollars, images, ownedValue, type Card, type Printing } from "../lib/cards";
import { collectionCards, totalCopies, ownedByOracle, type Entries } from "../lib/collection";
import { baseline, binderTotals, priceMap, recentPrintings, recordSnapshot, valueChange, type Snapshot } from "../lib/dashboard";
import { loadManifest, loadPriceManifest, loadPrintings, loadSets, loadStorePrices, type Manifest } from "../lib/data";
import { deckSize, FORMATS, missingCards } from "../lib/decks";
import { SOURCES, savedSource, withSource } from "../lib/prices";
import { useCollection } from "../state/collection";
import { deckValue, useLibrary } from "./DecksView";

/** Opens another section with a search already filled in (the search lives in the query string). */
function openSearch(route: string, q: string) {
  history.pushState(null, "", `${location.pathname}?q=${encodeURIComponent(q)}#/${route}`);
  dispatchEvent(new HashChangeEvent("hashchange"));
}
const searchLink = (route: string, q: string) => (e: Event) => {
  e.preventDefault();
  openSearch(route, q);
};

const shortDay = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function shell(nav: ComponentChildren, body: ComponentChildren) {
  return (
    <>
      <header class="top"><div class="wrap"><div class="title-row"><div class="brand"><h1>ManaBin</h1>{nav}</div></div></div></header>
      <main class="wrap home">{body}</main>
    </>
  );
}

function CardSearch({ big, label }: { big?: boolean; label: string }) {
  const [q, setQ] = useState("");
  return (
    <form class={`home-search${big ? " big" : ""}`} role="search"
      onSubmit={(e) => { e.preventDefault(); openSearch("library", q.trim()); }}>
      <input type="search" value={q} aria-label={label} placeholder={label} autocomplete="off" spellcheck={false}
        onInput={(e) => setQ(e.currentTarget.value)} />
      <button type="submit" class="primary">Search</button>
    </form>
  );
}

export function HomeView({ nav }: { nav: ComponentChildren }) {
  const col = useCollection();
  return col.account ? <Dashboard nav={nav} /> : <Welcome nav={nav} />;
}

/* ---------------- signed out ---------------- */

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={d} /></svg>
);
const FEATURES: [string, string, string][] = [
  ["M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "Scan cards with your phone",
    "Install ManaBin on your phone, point the camera at a card, then fix the printing, finish or condition and save it."],
  ["M7 3h10v18H7zM4 6v12M20 6v12", "Every card and printing",
    "Search the full paper card library with Scryfall-style syntax, and pick the exact printing and art you own."],
  ["M3 7h7l2 2h9v10H3zM3 7V5h6", "Binders and ManaBox import",
    "Sort cards into binders, bring in a ManaBox CSV export, and export your collection again any time."],
  ["M5 4h9v14H5zM10 8h9v12h-9", "Decks and a Commander builder",
    "Paste a decklist or build from scratch, see what you're missing, and get Commander suggestions from EDHREC."],
  ["M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3S9.5 10.5 12 11s4.5 1.8 4.5 3.5-2 3-4.5 3-4.5-1.3-4.5-3", "Prices from three stores",
    "Value your collection and decks with TCGplayer, Card Kingdom or MTGGoldfish prices, and keep a wishlist."],
  ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.8c2 .7 3.2 2.6 3.5 5.2", "Share with friends",
    "Your collection is private and syncs across devices. Share it, or chosen decks, with the friends you pick."],
];

function Welcome({ nav }: { nav: ComponentChildren }) {
  const col = useCollection();
  const [busy, setBusy] = useState(false);
  const [lib, setLib] = useState<{ m: Manifest; newest?: string } | null>(null);
  useEffect(() => {
    Promise.all([loadManifest(), loadSets()]).then(([m, sets]) => m && setLib({ m, newest: m.newest_set ? sets.get(m.newest_set)?.name : undefined }));
  }, []);
  const connecting = !col.signedOut;

  return shell(nav, (
    <>
      <section class="hero">
        <div class="hero-text">
          <h2>Your Magic collection, decks and prices in one free app.</h2>
          <p>ManaBin keeps track of every card you own, down to the printing, finish and condition. Scan cards with your phone, sort them into binders, build decks from what you have, and see what it's all worth.</p>
          <div class="hero-actions">
            {col.kind !== "memory" && (
              <button type="button" class="primary big-button" disabled={busy || connecting}
                onClick={async () => { setBusy(true); await col.signIn(); setBusy(false); }}>
                {busy ? "Signing in…" : connecting ? "Connecting…" : "Sign in with Google to start"}
              </button>
            )}
            <a class="ghost button big-button" href="#/library">Browse every card</a>
          </div>
        </div>
        <div class="hero-fan" aria-hidden="true">
          <span class="fan-card c1" /><span class="fan-card c2" /><span class="fan-card c3" />
        </div>
      </section>

      <section class="home-panel">
        <h3>Look up a card</h3>
        <CardSearch big label="Search every card, e.g.  t:dragon c:r mv<=5" />
        {lib && (
          <p class="muted small">
            {lib.m.cards.toLocaleString()} cards and {lib.m.printings.toLocaleString()} printings from {lib.m.sets.toLocaleString()} sets
            {lib.newest ? `, through ${lib.newest}` : ""}. No account needed to search.
          </p>
        )}
      </section>

      <section class="features" aria-label="What ManaBin does">
        {FEATURES.map(([d, title, body]) => (
          <div class="feature" key={title}>
            <span class="feature-icon">{icon(d)}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </section>

      <footer class="foot muted">
        <p>Free, with no ads. Sign in with Google to save a collection; it stays private unless you share it. Card data and images from <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>. Magic: The Gathering is © Wizards of the Coast.</p>
      </footer>
    </>
  ));
}

/* ---------------- signed in ---------------- */

/** The cards owned, priced from the chosen source, plus what's still loading. */
function usePricedCollection(entries: Entries | null) {
  const { lib, error, oracles } = useLibrary();
  const [printings, setPrintings] = useState<Map<string, Printing[]>>(new Map());
  const [store, setStore] = useState<Map<string, number[]> | null>(null);
  const [source] = useState(savedSource);

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

  useEffect(() => {
    if (!entries) return;
    if (source === "tcgplayer" || !entries.size) { setStore(new Map()); return; }
    let live = true;
    loadStorePrices([...new Set([...entries.values()].map((e) => e.o))]).then((sp) => live && setStore(sp));
    return () => { live = false; };
  }, [entries]);

  const setNames = useMemo(() => {
    const out: Record<string, string> = {};
    lib?.sets.forEach((s, code) => (out[code] = s.name));
    return out;
  }, [lib]);

  const byPrinting = useMemo(() => {
    if (!lib || !entries) return null;
    const list = collectionCards(entries, oracles, printings, setNames).map((c) => withSource(c, store?.get(c.id), source));
    return new Map(list.map((c) => [c.id, c]));
  }, [lib, entries, printings, store, oracles]);

  const ready = !!byPrinting && !!store && !!entries && [...entries.values()].every((e) => printings.has(e.o));
  return { lib, error, oracles, byPrinting, ready, source };
}

/** Saves this device's view of today's prices, and returns the earlier prices to compare with. */
function usePriceHistory(uid: string | undefined, source: string, ready: boolean, entries: Entries | null, byPrinting: Map<string, Card> | null) {
  const [at, setAt] = useState<string | null>(null);
  const [base, setBase] = useState<Snapshot | null | undefined>(undefined);
  useEffect(() => {
    Promise.all([loadManifest(), loadPriceManifest()]).then(([m, pm]) => {
      const stamps = [m?.built_at, source === "tcgplayer" ? undefined : pm?.built_at].filter((s): s is string => !!s);
      setAt(stamps.sort().pop() || null);
    });
  }, []);
  useEffect(() => {
    if (!ready || !uid || !at || !entries || !byPrinting) return;
    const key = `manabin-price-history-${uid}-${source}`;
    let saved: Snapshot[] = [];
    try { saved = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* storage blocked or bad data */ }
    if (!Array.isArray(saved)) saved = [];
    setBase(baseline(saved, at));
    try { localStorage.setItem(key, JSON.stringify(recordSnapshot(saved, { at, prices: priceMap(entries.values(), byPrinting) }))); } catch { /* full or blocked */ }
  }, [ready, uid, at, entries, byPrinting]);
  return { at, base };
}

function Dashboard({ nav }: { nav: ComponentChildren }) {
  const col = useCollection();
  const entries = col.entries;
  const { error, oracles, byPrinting, ready, source } = usePricedCollection(entries);
  const { base } = usePriceHistory(col.account?.uid, source, ready, entries, byPrinting);
  const [importing, setImporting] = useState(false);

  const value = useMemo(() => [...(byPrinting?.values() || [])].reduce((n, c) => n + ownedValue(c), 0), [byPrinting]);
  const change = useMemo(() => (base && entries && byPrinting ? valueChange(entries, byPrinting, base.prices) : null), [base, entries, byPrinting]);
  const recent = useMemo(() => (entries ? recentPrintings(entries, 12) : []), [entries]);
  const binders = useMemo(() => (entries && byPrinting ? binderTotals(entries, byPrinting) : new Map()), [entries, byPrinting]);
  const owned = useMemo(() => (entries ? ownedByOracle(entries) : new Map<string, number>()), [entries]);
  const decks = useMemo(() => [...(col.decks || [])].sort((a, b) => (b.updated || "").localeCompare(a.updated || "")), [col.decks]);

  const first = col.account?.isAnonymous ? null : (col.account?.name || "").split(" ")[0];
  const copies = entries ? totalCopies(entries) : 0;
  const unique = entries ? new Set([...entries.values()].map((e) => e.o)).size : 0;
  const sourceName = SOURCES.find(([s]) => s === source)![1];

  const actions = (
    <nav class="quick" aria-label="Quick actions">
      <a class="quick-btn" href="#/scan">{icon(FEATURES[0][0])}<span>Scan cards</span></a>
      <a class="quick-btn" href="#/library">{icon("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5M11 8v6M8 11h6")}<span>Add a card</span></a>
      <a class="quick-btn" href="#/decks/new">{icon("M5 4h9v14H5zM16 11h6M19 8v6")}<span>New deck</span></a>
      <button type="button" class="quick-btn" onClick={() => setImporting(true)}>{icon("M12 3v12M7 10l5 5 5-5M4 19h16")}<span>Import CSV</span></button>
    </nav>
  );

  const head = (
    <div class="dash-head">
      <h2 class="page-title">{first ? `Welcome back, ${first}` : "Your ManaBin"}</h2>
      <CardSearch label="Search every card" />
    </div>
  );

  if (error) {
    return shell(nav, <>{head}{actions}<div class="notice"><p><strong>The card library isn't available.</strong></p><p class="muted">{error}</p></div></>);
  }

  if (entries && entries.size === 0) {
    return shell(nav, (
      <>
        {head}
        {actions}
        <div class="notice empty-collection">
          <p><strong>Your collection is empty.</strong></p>
          <p>Scan cards with your phone, find a card in <a href="#/library">Browse</a> and add the printing you own, or import a ManaBox CSV export. Your value, recent additions and price changes will show up here.</p>
          <button type="button" class="primary" onClick={() => setImporting(true)}>Import a ManaBox CSV</button>
        </div>
        {decks.length > 0 && <DeckPanel decks={decks} oracles={oracles} owned={owned} />}
        {importing && <ImportDialog onClose={() => setImporting(false)} />}
      </>
    ));
  }

  const changeTile = !ready ? (
    <Tile label="Price change" value="…" />
  ) : change && base ? (
    <Tile label={`Since ${shortDay(base.at)}`} value={`${change.change >= 0 ? "+" : "−"}${dollars(Math.abs(change.change))}`}
      cls={change.change > 0.005 ? "up" : change.change < -0.005 ? "down" : ""}
      note={change.base ? `${change.pct >= 0 ? "+" : "−"}${Math.abs(change.pct).toFixed(1)}% on cards you owned then` : undefined} />
  ) : (
    <Tile label="Price change" value="Starts today" note="Price changes appear here after the next price update." />
  );

  return shell(nav, (
    <>
      {head}
      {actions}
      <section class="tiles" aria-label="Collection summary">
        <Tile label="Collection value" value={ready ? dollars(value) : "…"} note={source === "highest" ? "Highest store price for each card" : `${sourceName} prices`} cls="accent" href="#/collection" />
        {changeTile}
        <Tile label="Cards" value={copies.toLocaleString()} note={`${unique.toLocaleString()} different`} href="#/collection" />
        <Tile label="Decks" value={(col.decks?.length ?? 0).toLocaleString()} note={col.wishlist?.length ? `${col.wishlist.length} on your wishlist` : "Build one from your cards"} href="#/decks" />
      </section>

      <div class="dash-grid">
        <section class="home-panel">
          <div class="panel-head"><h3>Recently added</h3><a href="#/collection">See all</a></div>
          {!entries || !byPrinting ? <p class="muted">Loading…</p> : (
            <ul class="recent">
              {recent.map((e) => {
                const c = byPrinting.get(e.p);
                if (!c) return null;
                const img = images(c, "small")[0];
                return (
                  <li key={e.p}>
                    <a href="#/collection" title={`${c.name} (${c.set_name})`} onClick={searchLink("collection", `!"${c.name}"`)}>
                      {img ? <img src={img} alt={c.name} loading="lazy" /> : <span class="noimg">{c.name}</span>}
                      <span class="muted small">{shortDay(e.a)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section class="home-panel">
          <div class="panel-head"><h3>Biggest price moves</h3>{base && <span class="muted small">since {shortDay(base.at)}</span>}</div>
          {!change ? (
            <p class="muted">{ready ? "ManaBin starts tracking your cards' prices on this device today. The cards that rose or fell the most will show here after the next price update." : "Loading…"}</p>
          ) : !change.movers.length ? (
            <p class="muted">No price changes on your cards yet.</p>
          ) : (
            <ul class="movers">
              {change.movers.slice(0, 6).map((m) => (
                <li key={`${m.entry.p}|${m.entry.f}`}>
                  <a href="#/collection" onClick={searchLink("collection", `!"${m.card.name}"`)}>{m.card.name}</a>
                  <span class="muted small">{m.card.set_name}{m.entry.f !== "nonfoil" ? ` · ${m.entry.f}` : ""}</span>
                  <span class="mv">{dollars(m.before)} → {dollars(m.now)}</span>
                  <span class={m.change > 0 ? "up" : "down"}>{m.change > 0 ? "+" : "−"}{dollars(Math.abs(m.change))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DeckPanel decks={decks} oracles={oracles} owned={owned} />

        <section class="home-panel">
          <div class="panel-head"><h3>Binders</h3><a href="#/collection">Open collection</a></div>
          {!binders.size ? <p class="muted">Loading…</p> : (
            <ul class="rows">
              {[...binders].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1)).map(([name, t]) => (
                <li key={name || "-"}>
                  <span>{name || <em class="muted">No binder</em>}</span>
                  <span class="muted small">{t.cards.toLocaleString()} card{t.cards === 1 ? "" : "s"}</span>
                  <span>{ready ? dollars(t.value) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <footer class="foot muted">
        <p>Price changes compare today's prices ({source === "highest" ? "the highest store price" : sourceName}) with the ones this device saw on an earlier day, for the cards you owned then. Change the price source on <a href="#/collection">My collection</a>.</p>
      </footer>
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  ));
}

function Tile({ label, value, note, cls = "", href }: { label: string; value: string; note?: string; cls?: string; href?: string }) {
  const body = (
    <>
      <span class="tile-label">{label}</span>
      <span class={`tile-value ${cls}`}>{value}</span>
      {note && <span class="tile-note">{note}</span>}
    </>
  );
  return href ? <a class="tile" href={href}>{body}</a> : <div class="tile">{body}</div>;
}

function DeckPanel({ decks, oracles, owned }: { decks: NonNullable<ReturnType<typeof useCollection>["decks"]>; oracles: Map<string, Card>; owned: Map<string, number> }) {
  return (
    <section class="home-panel">
      <div class="panel-head"><h3>Decks</h3><a href="#/decks">All decks</a></div>
      {!decks.length ? (
        <p class="muted">No decks yet. <a href="#/decks/new">Start one</a> from scratch or paste a decklist, and ManaBin marks the cards you own.</p>
      ) : (
        <ul class="rows">
          {decks.slice(0, 6).map((d) => {
            const size = deckSize(d.cards, ["commander", "main"]);
            const missing = missingCards(d.cards, owned, ["commander", "main"]).reduce((n, c) => n + c.q, 0);
            return (
              <li key={d.id}>
                <a href={`#/decks/${d.id}`}>{d.name}</a>
                <span class="muted small">{FORMATS.find(([f]) => f === d.format)?.[1] || "No format"} · {size} cards</span>
                <span class={missing ? "missing" : "ok"}>{missing ? `${missing} missing` : size ? "All owned" : ""}</span>
                <span>{oracles.size ? dollars(deckValue(d, oracles)) : ""}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
