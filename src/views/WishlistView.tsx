// Cards you want but don't own yet, with the cheapest price at each store.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { SignInPrompt } from "../components/SignInPrompt";
import { dollars } from "../lib/cards";
import { ownedByOracle } from "../lib/collection";
import { cheapestByStore } from "../lib/data";
import { formatDecklist, type WishItem } from "../lib/decks";
import { download } from "../lib/transfer";
import { useCollection } from "../state/collection";
import { pageShell } from "./DecksView";

const STORES = ["TCGplayer", "Card Kingdom", "MTGGoldfish"];

export function WishlistView({ nav }: { nav: ComponentChildren }) {
  const col = useCollection();
  const items = col.wishlist;
  const owned = useMemo(() => (col.entries ? ownedByOracle(col.entries) : new Map<string, number>()), [col.entries]);
  const [prices, setPrices] = useState<Map<string, number[]> | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!items?.length) return;
    let live = true;
    cheapestByStore(items.map((w) => w.o)).then((p) => live && setPrices(p));
    return () => { live = false; };
  }, [items?.map((w) => w.o).join()]);

  if (col.signedOut) return pageShell(nav, <SignInPrompt why="Sign in with Google to keep a wishlist." />);
  if (!items) return pageShell(nav, <p class="empty">Loading your wishlist…</p>);

  const deckName = (id?: string) => (id ? col.decks?.find((d) => d.id === id)?.name : undefined);
  const groups = new Map<string, WishItem[]>();
  for (const w of [...items].sort((a, b) => a.n.localeCompare(b.n))) {
    const k = w.d && deckName(w.d) ? w.d : "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(w);
  }
  const change = (w: WishItem, q: number) =>
    col.setWishlist(items.map((x) => (x === w ? { ...x, q } : x))).catch(() => {});
  const got = items.filter((w) => (owned.get(w.o) || 0) >= w.q);
  const totals = [0, 1, 2].map((i) => items.reduce((n, w) => n + w.q * (prices?.get(w.o)?.[i] || 0), 0));
  const asDeckCards = items.map((w) => ({ o: w.o, n: w.n, q: w.q, b: "main" as const }));

  return pageShell(nav, (
    <>
      <p class="crumbs"><a href="#/decks">All decks</a></p>
      <div class="toolbar">
        <h2 class="page-title">Wishlist</h2>
        {items.length > 0 && (
          <span class="actions">
            <button type="button" class="ghost" onClick={async () => {
              const text = formatDecklist(asDeckCards, { boards: ["main"] });
              try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
              catch { download("manabin-wishlist.txt", text, "text/plain"); }
            }}>{copied ? "Copied" : "Copy list"}</button>
            {got.length > 0 && (
              <button type="button" class="ghost" title="Remove the cards you now own enough copies of"
                onClick={() => col.setWishlist(items.filter((w) => !got.includes(w))).catch(() => {})}>
                Remove {got.length} you now own
              </button>
            )}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div class="notice empty-collection">
          <p><strong>Your wishlist is empty.</strong></p>
          <p>In a deck, use <em>Wishlist</em> on a suggestion, or <em>Buy missing → Add all missing cards to my wishlist</em>.</p>
        </div>
      ) : (
        <div class="table-scroll">
          <table class="mini wish-table">
            <thead><tr><th>Card</th><th>Want</th><th>Own</th>{STORES.map((s) => <th key={s}>{s}</th>)}<th></th></tr></thead>
            {[...groups].map(([d, list]) => (
              <tbody key={d}>
                <tr class="group-row"><th colSpan={7}>{d ? <a href={`#/decks/${d}`}>For {deckName(d)}</a> : "Not for a deck"}</th></tr>
                {list.map((w) => {
                  const p = prices?.get(w.o);
                  const have = owned.get(w.o) || 0;
                  return (
                    <tr key={`${w.o}|${w.d || ""}`} class={have >= w.q ? "got" : ""}>
                      <td>{w.n}</td>
                      <td>
                        <span class="stepper">
                          <button type="button" class="ghost" aria-label={`One fewer ${w.n}`} onClick={() => change(w, w.q - 1)}>−</button>
                          <span class="q">{w.q}</span>
                          <button type="button" class="ghost" aria-label={`One more ${w.n}`} onClick={() => change(w, w.q + 1)}>+</button>
                        </span>
                      </td>
                      <td>{have >= w.q ? "✓" : have}</td>
                      {[0, 1, 2].map((i) => <td key={i}>{p ? (p[i] ? dollars(p[i] * w.q) : "–") : "…"}</td>)}
                      <td><button type="button" class="ghost small" aria-label={`Remove ${w.n}`} onClick={() => change(w, 0)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
            <tfoot><tr><th>Total</th><th>{items.reduce((n, w) => n + w.q, 0)}</th><th></th>{totals.map((t, i) => <th key={i}>{prices ? dollars(t) : "…"}</th>)}<th></th></tr></tfoot>
          </table>
        </div>
      )}
      <p class="muted small">Prices are each store's cheapest non-foil printing. Cards you now own enough of are marked ✓.</p>
    </>
  ));
}
