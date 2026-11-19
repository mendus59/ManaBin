// Your decks: the list, a new deck, and importing a decklist.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SignInPrompt } from "../components/SignInPrompt";
import type { Card } from "../lib/cards";
import { dollars } from "../lib/cards";
import { ownedByOracle } from "../lib/collection";
import { loadLibrary, type Library } from "../lib/data";
import { FORMATS, deckSize, missingCards, nameIndex, newDeckId, parseDecklist, resolveLines, type Deck, type ParsedLine } from "../lib/decks";
import { useCollection } from "../state/collection";

/** The library with lookups by oracle ID and by name, loaded once. */
export function useLibrary() {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadLibrary().then(setLib).catch((e) => setError(String(e)));
  }, []);
  const oracles = useMemo(() => new Map((lib?.cards || []).map((c) => [c.oracle_id!, c])), [lib]);
  const names = useMemo(() => nameIndex(lib?.cards || []), [lib]);
  return { lib, error, oracles, names };
}

/** USD price of one copy of a card: its preferred printing's if known, else the cheapest printing's. */
export const cardPrice = (c: Card | undefined) => (c ? c.min_usd ?? (parseFloat(c.prices?.usd || c.prices?.usd_foil || "") || 0) : 0);

export const deckValue = (deck: Deck, oracles: Map<string, Card>) =>
  deck.cards.reduce((n, c) => n + (c.b === "maybe" ? 0 : c.q * cardPrice(oracles.get(c.o))), 0);

export function pageShell(nav: ComponentChildren, body: ComponentChildren, cls = "") {
  return (
    <>
      <header class="top"><div class="wrap"><div class="title-row"><div class="brand"><h1>ManaBin</h1>{nav}</div></div></div></header>
      <main class={`wrap decks ${cls}`}>{body}</main>
    </>
  );
}

export function DecksView({ nav }: { nav: ComponentChildren }) {
  const col = useCollection();
  const { oracles, names, error } = useLibrary();
  const [dialog, setDialog] = useState(false);
  const owned = useMemo(() => (col.entries ? ownedByOracle(col.entries) : new Map<string, number>()), [col.entries]);

  if (col.signedOut) return pageShell(nav, <SignInPrompt why="Sign in with Google to build decks and share them with friends." />);
  if (error) return pageShell(nav, <div class="notice"><p><strong>The card library isn't available.</strong></p><p class="muted">{error}</p></div>);
  if (!col.decks || !oracles.size) return pageShell(nav, <p class="empty">Loading your decks…</p>);

  return pageShell(nav, (
    <>
      <div class="toolbar">
        <h2 class="page-title">Decks</h2>
        <span class="actions">
          <a class="ghost button" href="#/wishlist">Wishlist{col.wishlist?.length ? ` (${col.wishlist.length})` : ""}</a>
          <button type="button" class="primary" onClick={() => setDialog(true)}>New deck</button>
        </span>
      </div>
      {col.decks.length === 0 ? (
        <div class="notice empty-collection">
          <p><strong>No decks yet.</strong></p>
          <p>Start a deck from scratch, or paste a decklist from Moxfield, Archidekt, MTGGoldfish or MTG Arena. ManaBin marks the cards you already own.</p>
          <button type="button" class="primary" onClick={() => setDialog(true)}>New deck</button>
        </div>
      ) : (
        <ul class="deck-list">
          {col.decks.map((d) => {
            const size = deckSize(d.cards, ["commander", "main"]);
            const missing = missingCards(d.cards, owned, ["commander", "main"]).reduce((n, c) => n + c.q, 0);
            const commander = d.cards.filter((c) => c.b === "commander").map((c) => c.n).join(" & ");
            return (
              <li key={d.id}>
                <a href={`#/decks/${d.id}`}>
                  <span class="deck-name">{d.name}</span>
                  <span class="muted">
                    {FORMATS.find(([f]) => f === d.format)?.[1] || "No format"}{commander ? ` · ${commander}` : ""} · {size} card{size === 1 ? "" : "s"}
                  </span>
                  <span class="deck-stats">
                    <span class={missing ? "missing" : "ok"}>{missing ? `${missing} missing` : size ? "All owned" : ""}</span>
                    <span>{dollars(deckValue(d, oracles))}</span>
                    {d.sharedWith.length > 0 && <span class="muted">Shared with {d.sharedWith.length}</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {dialog && <NewDeckDialog names={names} onClose={() => setDialog(false)} />}
    </>
  ));
}

function NewDeckDialog({ names, onClose }: { names: Map<string, Card>; onClose: () => void }) {
  const col = useCollection();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState("commander");
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current!.showModal(); }, []);

  const parsed = useMemo(() => {
    if (!list.trim()) return null;
    const { lines, problems } = parseDecklist(list, { singleton: ["commander", "brawl", "oathbreaker"].includes(format) });
    const { cards, unknown } = resolveLines(lines, names);
    return { cards, unknown, problems };
  }, [list, format, names]);

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const commander = parsed?.cards.find((c) => c.b === "commander")?.n;
    const deck: Deck = {
      id: newDeckId(), name: name.trim() || commander || "Untitled deck", format,
      cards: parsed?.cards || [], sharedWith: [], updated: "",
    };
    // The local copy updates at once; the save reaches the server in the background (or when back online).
    const saving = col.saveDeck(deck);
    let failed = false;
    saving.catch((err) => { failed = true; setError((err as Error).message); setBusy(false); });
    await Promise.race([saving, new Promise((r) => setTimeout(r, 300))]).catch(() => {});
    if (failed || !dialog.current?.open) return;
    location.hash = `#/decks/${deck.id}`;
    onClose();
  };

  const describe = (l: ParsedLine) => `Line ${l.line}: ${l.q} ${l.name}`;
  return (
    <dialog ref={dialog} class="small-dialog" aria-label="New deck" onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
      <form class="dlg-body deck-form" onSubmit={create}>
        <button type="button" class="close ghost" aria-label="Close" onClick={() => dialog.current!.close()}>✕</button>
        <h2>New deck</h2>
        <label>Name<input value={name} maxLength={80} placeholder="e.g. Goblin tribal" onInput={(e) => setName(e.currentTarget.value)} /></label>
        <label>Format
          <select value={format} onChange={(e) => setFormat(e.currentTarget.value)}>
            {FORMATS.map(([f, label]) => <option key={f} value={f}>{label}</option>)}
          </select>
        </label>
        <label>Decklist <span class="muted">(optional; paste from Moxfield, Archidekt, MTGGoldfish or Arena)</span>
          <textarea rows={10} value={list} spellcheck={false} placeholder={"Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring\n1x Goblin Matron (CMM) 220"}
            onInput={(e) => setList(e.currentTarget.value)} />
        </label>
        {parsed && (
          <div class="preview">
            <p>{parsed.cards.reduce((n, c) => n + c.q, 0)} cards matched{parsed.unknown.length ? `, ${parsed.unknown.length} not found` : ""}.</p>
            {(parsed.unknown.length > 0 || parsed.problems.length > 0) && (
              <ul class="problems">
                {parsed.unknown.map((l) => <li key={l.line}>{describe(l)} (no card with that name)</li>)}
                {parsed.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
        )}
        {error && <p class="error">{error}</p>}
        <div class="dlg-actions">
          <button type="submit" class="primary" disabled={busy}>{busy ? "Creating…" : parsed?.cards.length ? "Create deck" : "Create empty deck"}</button>
        </div>
      </form>
    </dialog>
  );
}
