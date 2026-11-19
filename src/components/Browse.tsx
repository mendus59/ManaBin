// Search, filter and browse a list of cards: the card library or a collection.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { compile, ownedPrice, sortCards, SORTS } from "../lib/search.js";
import { createFilters } from "../lib/filters.js";
import { cap, dollars, images, money, ownedValue, type Card } from "../lib/cards";
import { CardDialog } from "./CardDialog";
import { SearchHelp } from "./SearchHelp";
import { Symbols } from "./Symbols";

const PAGE_SIZE = 120;

const SORT_LABELS: [string, string][] = [
  ["name", "Name"], ["set", "Set / number"], ["released", "Release date"], ["mv", "Mana value"],
  ["color", "Color"], ["rarity", "Rarity"], ["usd", "Price (USD)"], ["power", "Power"],
  ["toughness", "Toughness"], ["edhrec", "EDHREC rank"], ["artist", "Artist"], ["qty", "Quantity owned"],
];

export interface BrowseProps {
  nav: ComponentChildren;
  title: string;
  cards: Card[];
  /** Collection mode shows quantities, owned value and finish badges. */
  owned: boolean;
  setNames?: Record<string, string>;
  headerRight?: ComponentChildren;
  /** shown above the filters, e.g. import/export buttons */
  toolbar?: ComponentChildren;
  /** shown instead of "No cards match" when there are no cards at all */
  empty?: ComponentChildren;
  /** copies owned per oracle ID, for "owned" badges in the library */
  ownedCounts?: Map<string, number>;
  footer?: ComponentChildren;
  scope: string;
  placeholder: string;
  examples: string[];
}

export function Browse(props: BrowseProps) {
  const { cards, owned } = props;
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [query, setQuery] = useState(params.get("q") || "");
  const [input, setInput] = useState(query);
  const [sort, setSort] = useState(params.get("order") || "name");
  const [dir, setDir] = useState<string | null>(params.get("dir"));
  const [view, setView] = useState(params.get("view") === "list" ? "list" : "grid");
  const [filterTick, setFilterTick] = useState(0);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);

  const filtersBody = useRef<HTMLDivElement>(null);
  const filtersBox = useRef<HTMLDetailsElement>(null);
  const filters = useMemo(() => createFilters(), []);
  const filterApi = useRef<{ clear(): void; update(cards: Card[], setNames?: Record<string, string>): void } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    filterApi.current = filters.init({
      container: filtersBody.current, cards, params, setNames: props.setNames,
      onChange: () => setFilterTick((t) => t + 1),
    });
    // Start with the panel collapsed on phones unless the link already has filters applied.
    if (matchMedia("(max-width: 700px)").matches && !filters.activeCount()) filtersBox.current!.open = false;
    setFilterTick((t) => t + 1);
  }, []);
  const firstCards = useRef(cards);
  useEffect(() => {
    if (cards !== firstCards.current) filterApi.current?.update(cards, props.setNames);
  }, [cards, props.setNames]);

  // Debounce typing so big searches don't run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(t);
  }, [input]);

  const result = useMemo(() => {
    const compiled = compile(query);
    const order = compiled.order || sort;
    const effectiveDir = compiled.dir || dir || (SORTS as any)[order].dir;
    const filterTest = filters.predicate();
    // Like Scryfall, the library hides tokens, emblems and other extras unless the search asks for them.
    const extras = owned || /\binclude:extras\b|\b(is|t|type):(token|emblem|extra)\b/i.test(query);
    const list = sortCards(cards.filter((c: Card) => (extras || !c.extra) && compiled.test(c) && filterTest(c)), order, effectiveDir) as Card[];
    return { list, order, effectiveDir, warnings: compiled.warnings as string[] };
  }, [cards, query, sort, dir, filterTick]);

  useEffect(() => setShown(PAGE_SIZE), [result]);

  // Keep the URL in sync so searches can be shared.
  useEffect(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (sort !== "name") p.set("order", sort);
    if (dir) p.set("dir", dir);
    if (view !== "grid") p.set("view", view);
    filters.writeParams(p);
    const qs = p.toString();
    history.replaceState(null, "", (qs ? "?" + qs : location.pathname) + location.hash);
  }, [query, sort, dir, view, filterTick]);

  // Load more results as the end of the list scrolls into view.
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setShown((n) => n + PAGE_SIZE);
    }, { rootMargin: "1200px" });
    io.observe(sentinel.current!);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!openId && e.key === "/" && document.activeElement !== searchBox.current) {
        e.preventDefault();
        searchBox.current!.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [openId]);

  const { list } = result;
  // Track the open card by ID, so it stays put when the list changes underneath it.
  const open = openId ? list.findIndex((c) => c.id === openId) : -1;
  const setOpen = (i: number | ((i: number) => number)) => {
    const n = typeof i === "function" ? i(open) : i;
    setOpenId(n >= 0 && list[n] ? list[n].id : null);
  };
  const page = list.slice(0, shown);
  const nFilters = filters.activeCount();

  const total = owned ? cards.length : cards.reduce((n, c) => n + (c.extra ? 0 : 1), 0);
  let status = `${list.length.toLocaleString()} of ${total.toLocaleString()} cards`;
  if (owned) {
    const copies = (cs: Card[]) => cs.reduce((n, c) => n + (c.owned?.qty || 0), 0);
    status = list.length === cards.length
      ? `${cards.length.toLocaleString()} cards (${copies(cards).toLocaleString()} copies)`
      : `${status} (${copies(list).toLocaleString()} copies) · ${dollars(list.reduce((n, c) => n + ownedValue(c), 0))}`;
  } else if (list.length === total) {
    status = `${total.toLocaleString()} cards`;
  }

  const runExample = (q: string) => { setInput(q); setQuery(q); };

  const onListMove = (e: MouseEvent) => {
    const el = preview.current!;
    const row = view === "list" && (e.target as HTMLElement).closest<HTMLElement>("tr[data-i]");
    if (!row || !matchMedia("(hover: hover)").matches) { el.style.display = "none"; return; }
    const src = images(list[+row.dataset.i!], "normal")[0];
    if (!src) return;
    if (el.dataset.src !== src) {
      el.innerHTML = `<img src="${src}" alt="">`;
      el.dataset.src = src;
    }
    const w = 244, h = 340;
    el.style.left = (e.clientX + 24 + w > innerWidth ? e.clientX - w - 24 : e.clientX + 24) + "px";
    el.style.top = Math.min(e.clientY - 40, innerHeight - h - 10) + "px";
    el.style.display = "block";
  };

  return (
    <>
      <header class="top">
        <div class="wrap">
          <div class="title-row">
            <div class="brand">
              <h1>ManaBin</h1>
              {props.nav}
            </div>
            {props.headerRight}
          </div>
          <form class="search" role="search" onSubmit={(e) => e.preventDefault()}>
            <input
              ref={searchBox}
              id="q"
              type="search"
              placeholder={props.placeholder}
              autocomplete="off"
              spellcheck={false}
              aria-label={`Search ${props.title}`}
              value={input}
              onInput={(e) => setInput(e.currentTarget.value)}
            />
            <div class="controls">
              <label>Sort
                <select value={result.order} onChange={(e) => { setSort(e.currentTarget.value); setDir(null); }}>
                  {SORT_LABELS.filter(([k]) => owned || k !== "qty").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <button type="button" class="ghost" title="Toggle sort direction"
                onClick={() => setDir(result.effectiveDir === "asc" ? "desc" : "asc")}>
                {result.effectiveDir === "desc" ? "↓ Desc" : "↑ Asc"}
              </button>
              <div class="seg" role="group" aria-label="View">
                <button type="button" class={view === "grid" ? "on" : ""} onClick={() => setView("grid")}>Images</button>
                <button type="button" class={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
              </div>
            </div>
          </form>
          <div class="status-row">
            <p id="status" aria-live="polite">{status}</p>
            <SearchHelp examples={props.examples} scope={props.scope} onExample={runExample} />
          </div>
          <ul class="warnings">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      </header>

      <main class="wrap">
        {props.toolbar}
        <details ref={filtersBox} class="filters" open>
          <summary>
            <span class="ftitle">Filters <span class="count">{nFilters || ""}</span></span>
            <button type="button" class="linkish" hidden={!nFilters}
              onClick={(e) => { e.preventDefault(); filterApi.current?.clear(); }}>Clear filters</button>
          </summary>
          <div ref={filtersBody} class="filters-body" />
        </details>

        {!list.length && (cards.length || !props.empty ? <p class="empty">No cards match that search.</p> : props.empty)}
        {list.length > 0 && view === "grid" && (
          <div class="grid">
            {page.map((c, i) => (
              <Tile key={c.id} card={c} owned={owned} have={c.oracle_id ? props.ownedCounts?.get(c.oracle_id) : 0} onOpen={() => setOpen(i)} />
            ))}
          </div>
        )}
        {list.length > 0 && view === "list" && (
          <table class="list" onMouseMove={onListMove} onMouseLeave={() => (preview.current!.style.display = "none")}>
            <thead>
              <tr>
                {owned && <th class="num">Qty</th>}
                <th>Name</th><th>Cost</th><th class="hide-sm">Type</th>
                <th>Set</th><th class="hide-sm">#</th><th class="hide-sm">Rarity</th><th class="num">Price</th>
              </tr>
            </thead>
            <tbody>
              {page.map((c, i) => (
                <tr key={c.id} data-i={i} onClick={() => setOpen(i)}>
                  {owned && <td class="num">{c.owned?.qty}</td>}
                  <td class="name">{c.name}{owned && c.owned?.foil ? <span class="foil-dot">foil</span> : null}</td>
                  <td><Symbols text={c.mana_cost || (c.card_faces || []).map((f) => f.mana_cost).filter(Boolean).join(" // ")} /></td>
                  <td class="hide-sm">{c.type_line}</td>
                  <td class="set" title={c.set_name}>{c.set}</td>
                  <td class="hide-sm">{c.collector_number}</td>
                  <td class="hide-sm">{cap(c.rarity)}</td>
                  <td class="num">{money(ownedPrice(c, "usd"))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div ref={sentinel} />
      </main>

      <footer class="wrap foot">{props.footer}</footer>
      <div ref={preview} id="hover-preview" aria-hidden="true" />

      {open >= 0 && list[open] && (
        <CardDialog
          card={list[open]}
          owned={owned}
          setNames={props.setNames}
          onClose={() => setOpen(-1)}
          onStep={(d) => setOpen((i) => Math.min(list.length - 1, Math.max(0, i + d)))}
          hasPrev={open > 0}
          hasNext={open < list.length - 1}
        />
      )}
    </>
  );
}

function Tile({ card: c, owned, have, onOpen }: { card: Card; owned: boolean; have?: number; onOpen: () => void }) {
  const [face, setFace] = useState(0);
  const imgs = images(c, "normal");
  const o = c.owned;
  return (
    <div class="tile">
      <button type="button" class="tile-img" title={c.name} onClick={onOpen}>
        {imgs.length ? <img loading="lazy" src={imgs[face % imgs.length]} alt={c.name} /> : <span class="placeholder">{c.name}</span>}
      </button>
      <div class="badges">
        {owned && o && o.qty > 1 && <span class="badge">×{o.qty}</span>}
        {owned && o && o.foil > 0 && <span class="badge foil">{o.foil < o.qty ? o.foil + " " : ""}Foil</span>}
        {owned && o && o.etched > 0 && <span class="badge foil">Etched</span>}
        {!owned && have ? <span class="badge have" title={`You own ${have}`}>Own {have}</span> : null}
      </div>
      {imgs.length > 1 && (
        <button type="button" class="flip" title="Flip card" aria-label="Flip card" onClick={() => setFace((f) => f + 1)}>⟲</button>
      )}
    </div>
  );
}
