// One deck: its cards by board and type, what you own, format checks, sharing and export.
// Your own decks can be edited; a friend's shared deck is read-only.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { CardDialog } from "../components/CardDialog";
import { SignInPrompt } from "../components/SignInPrompt";
import { Symbols } from "../components/Symbols";
import { dollars, type Card } from "../lib/cards";
import { ownedByOracle } from "../lib/collection";
import {
  BOARDS, FORMATS, TYPE_GROUPS, addCard, checkDeck, deckSize, formatDecklist, missingCards, nameKey, typeGroup,
  type Board, type Deck, type DeckCard,
} from "../lib/decks";
import { download } from "../lib/transfer";
import { useCollection } from "../state/collection";
import { otherMember, useFriends } from "../state/friends";
import { cardPrice, deckValue, pageShell, useLibrary } from "./DecksView";

const GROUP_LABEL: Record<string, string> = {
  Creature: "Creatures", Planeswalker: "Planeswalkers", Battle: "Battles", Instant: "Instants", Sorcery: "Sorceries",
  Artifact: "Artifacts", Enchantment: "Enchantments", Land: "Lands", Other: "Other",
};

/** A friend's shared decks, live. */
export function useSharedDecks(owner: string | undefined) {
  const { backend, account } = useCollection();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDecks(null);
    setError(null);
    if (!owner || !backend || !account || account.isAnonymous) return;
    return backend.watchSharedDecks(owner, account.uid, (d) => setDecks(d.sort((a, b) => a.name.localeCompare(b.name))), (e) => setError(e.message));
  }, [owner, backend, account?.uid]);
  return { decks, error };
}

export function DeckView({ nav, id, owner }: { nav: ComponentChildren; id: string; owner?: string }) {
  const col = useCollection();
  const shared = useSharedDecks(owner);
  const { friendships } = useFriends();
  const { oracles, names, error, lib } = useLibrary();
  const owned = useMemo(() => (col.entries ? ownedByOracle(col.entries) : new Map<string, number>()), [col.entries]);
  const setNames = useMemo(() => {
    const out: Record<string, string> = {};
    lib?.sets.forEach((s, code) => (out[code] = s.name));
    return out;
  }, [lib]);

  const decks = owner ? shared.decks : col.decks;
  const deck = decks?.find((d) => d.id === id);
  const ownerName = owner ? friendships?.find((f) => f.members.includes(owner))?.names[owner] || "Your friend" : null;
  const back = owner ? <a href="#/friends">Back to friends</a> : <a href="#/decks">All decks</a>;

  if (col.signedOut) return pageShell(nav, <SignInPrompt why="Sign in with Google to build decks and see the ones friends share with you." />);
  if (error) return pageShell(nav, <div class="notice"><p><strong>The card library isn't available.</strong></p><p class="muted">{error}</p></div>);
  if (owner && shared.error) return pageShell(nav, <div class="notice"><p><strong>That deck isn't available.</strong></p><p>{shared.error}</p><p>{back}</p></div>);
  if (!decks || !oracles.size) return pageShell(nav, <p class="empty">Loading the deck…</p>);
  if (!deck) {
    return pageShell(nav, (
      <div class="notice">
        <p><strong>{owner ? `${ownerName} isn't sharing this deck with you.` : "That deck doesn't exist. It may have been deleted."}</strong></p>
        <p>{back}</p>
      </div>
    ));
  }
  return pageShell(nav, (
    <DeckEditor deck={deck} readOnly={!!owner} ownerName={ownerName} back={back}
      oracles={oracles} names={names} owned={owned} setNames={setNames} />
  ));
}

interface EditorProps {
  deck: Deck;
  readOnly: boolean;
  ownerName: string | null;
  back: ComponentChildren;
  oracles: Map<string, Card>;
  names: Map<string, Card>;
  owned: Map<string, number>;
  setNames: Record<string, string>;
}

function DeckEditor({ deck, readOnly, ownerName, back, oracles, names, owned, setNames }: EditorProps) {
  const col = useCollection();
  const [open, setOpen] = useState<Card | null>(null);
  const [copied, setCopied] = useState("");
  const [sure, setSure] = useState(false);

  const save = (change: Partial<Deck>) => {
    col.saveDeck({ ...deck, ...change }).catch(() => {});
  };
  const setCards = (cards: DeckCard[]) => save({ cards: cards.filter((c) => c.q > 0) });
  const update = (i: number, change: Partial<DeckCard>) => {
    const c = { ...deck.cards[i], ...change };
    const rest = deck.cards.filter((_, j) => j !== i);
    setCards(change.b ? addCard(rest, c) : deck.cards.map((x, j) => (j === i ? c : x)));
  };

  const size = deckSize(deck.cards);
  const missing = missingCards(deck.cards, owned, ["commander", "main", "side"]);
  const missingCount = missing.reduce((n, c) => n + c.q, 0);
  const missingValue = missing.reduce((n, c) => n + c.q * cardPrice(oracles.get(c.o)), 0);
  const problems = checkDeck(deck, oracles);
  const singleton = ["commander", "brawl", "oathbreaker"].includes(deck.format);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      download(`${deck.name}.txt`, text, "text/plain");
    }
  };
  const fileName = deck.name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "deck";

  return (
    <div class="deck">
      <p class="crumbs">{back}</p>
      <div class="deck-head">
        {readOnly ? (
          <h2 class="page-title">{deck.name} <span class="muted small">by {ownerName}</span></h2>
        ) : (
          <input class="deck-title" aria-label="Deck name" value={deck.name} maxLength={80}
            onChange={(e) => e.currentTarget.value.trim() && save({ name: e.currentTarget.value.trim() })} />
        )}
        <label class="source">
          <span class="muted">Format</span>
          <select aria-label="Format" value={deck.format} disabled={readOnly} onChange={(e) => save({ format: e.currentTarget.value })}>
            {FORMATS.map(([f, label]) => <option key={f} value={f}>{label}</option>)}
          </select>
        </label>
      </div>

      <div class="deck-summary">
        <span><strong>{size}</strong> card{size === 1 ? "" : "s"}{deckSize(deck.cards, ["side"]) ? ` + ${deckSize(deck.cards, ["side"])} sideboard` : ""}</span>
        <span>{dollars(deckValue(deck, oracles))}</span>
        <span class={missingCount ? "missing" : "ok"}>
          {missingCount ? `You're missing ${missingCount} card${missingCount === 1 ? "" : "s"} (${dollars(missingValue)})` : size ? "You own every card" : ""}
        </span>
      </div>

      {problems.length > 0 && (
        <ul class="deck-problems" aria-label="Format checks">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {!readOnly && <AddCard names={names} singleton={singleton} onAdd={(c) => setCards(addCard(deck.cards, c))} />}

      {BOARDS.map(([board, label]) => {
        const rows = deck.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.b === board);
        if (!rows.length) return null;
        const groups = board === "main"
          ? [...TYPE_GROUPS, "Other"].map((g) => [g, rows.filter(({ c }) => typeGroup(oracles.get(c.o)?.type_line) === g)] as const).filter(([, r]) => r.length)
          : [[label, rows] as const];
        return (
          <section class="board" key={board}>
            {board !== "main" && <h3>{label} <span class="muted">({deckSize(deck.cards, [board])})</span></h3>}
            {groups.map(([g, list]) => (
              <div class="group" key={g}>
                {board === "main" && <h4>{GROUP_LABEL[g] || g} <span class="muted">({list.reduce((n, { c }) => n + c.q, 0)})</span></h4>}
                <ul class="deck-cards">
                  {list.sort((a, b) => a.c.n.localeCompare(b.c.n)).map(({ c, i }) => {
                    const card = oracles.get(c.o);
                    const have = owned.get(c.o) || 0;
                    return (
                      <li key={`${c.o}|${c.b}|${c.p || ""}`} class={have >= c.q ? "have" : have ? "partial" : "need"}>
                        {readOnly ? <span class="q">{c.q}</span> : (
                          <span class="stepper">
                            <button type="button" class="ghost" aria-label={`One fewer ${c.n}`} onClick={() => update(i, { q: c.q - 1 })}>−</button>
                            <span class="q">{c.q}</span>
                            <button type="button" class="ghost" aria-label={`One more ${c.n}`} onClick={() => update(i, { q: c.q + 1 })}>+</button>
                          </span>
                        )}
                        <button type="button" class="linkish card-name" onClick={() => card && setOpen(card)}>{c.n}</button>
                        <span class="cost"><Symbols text={card?.mana_cost} /></span>
                        <span class="own" title={`You own ${have} ${have === 1 ? "copy" : "copies"}`}>
                          {have >= c.q ? "✓ owned" : have ? `own ${have}` : "missing"}
                        </span>
                        <span class="price">{dollars(c.q * cardPrice(card))}</span>
                        {!readOnly && (
                          <select class="move" aria-label={`Move ${c.n}`} value={c.b} onChange={(e) => update(i, { b: e.currentTarget.value as Board })}>
                            {BOARDS.map(([b, l]) => <option key={b} value={b}>{l}</option>)}
                          </select>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
      {deck.cards.length === 0 && <p class="empty">No cards yet. Add some by name above.</p>}

      <section class="deck-actions">
        <button type="button" class="ghost" disabled={!deck.cards.length} onClick={() => copy(formatDecklist(deck.cards), "list")}>
          {copied === "list" ? "Copied" : "Copy decklist"}
        </button>
        <button type="button" class="ghost" disabled={!deck.cards.length} onClick={() => download(`${fileName}.txt`, formatDecklist(deck.cards), "text/plain")}>
          Download .txt
        </button>
        <button type="button" class="ghost" disabled={!missing.length} title="The cards you'd need to buy, as a list to paste into a store's mass entry"
          onClick={() => copy(formatDecklist(missing, { boards: ["main"] }), "missing")}>
          {copied === "missing" ? "Copied" : "Copy missing cards"}
        </button>
        {!readOnly && (
          <button type="button" class={sure ? "ghost danger" : "ghost"} onClick={() => {
            if (!sure) return setSure(true);
            col.deleteDeck(deck.id).catch(() => {});
            location.hash = "#/decks";
          }}>
            {sure ? "Delete this deck?" : "Delete deck"}
          </button>
        )}
      </section>

      {!readOnly && <ShareDeck deck={deck} onChange={(sharedWith) => save({ sharedWith })} />}

      {open && (
        <CardDialog card={open} owned={false} setNames={setNames} onClose={() => setOpen(null)}
          onStep={() => {}} hasPrev={false} hasNext={false} />
      )}
    </div>
  );
}

function AddCard({ names, singleton, onAdd }: { names: Map<string, Card>; singleton: boolean; onAdd: (c: DeckCard) => void }) {
  const [text, setText] = useState("");
  const [board, setBoard] = useState<Board>("main");
  const [qty, setQty] = useState(1);
  const [flash, setFlash] = useState("");

  const matches = useMemo(() => {
    const q = nameKey(text);
    if (q.length < 2) return [];
    const starts: Card[] = [], has: Card[] = [];
    const seen = new Set<string>();
    for (const [key, c] of names) {
      if (seen.has(c.oracle_id!) || c.extra) continue;
      if (key.startsWith(q)) { starts.push(c); seen.add(c.oracle_id!); }
      else if (key.includes(q)) { has.push(c); seen.add(c.oracle_id!); }
      if (starts.length >= 8) break;
    }
    return [...starts, ...has].slice(0, 8);
  }, [text, names]);

  const add = (c: Card) => {
    onAdd({ o: c.oracle_id!, n: c.name, q: singleton && board !== "maybe" ? 1 : qty, b: board });
    setText("");
    setFlash(`Added ${c.name}`);
    setTimeout(() => setFlash(""), 1600);
  };

  return (
    <form class="add-card" onSubmit={(e) => { e.preventDefault(); if (matches[0]) add(matches[0]); }}>
      <div class="add-row">
        {!singleton && (
          <input aria-label="Copies" type="number" min={1} max={99} value={qty}
            onInput={(e) => setQty(Math.max(1, Math.min(99, parseInt(e.currentTarget.value, 10) || 1)))} />
        )}
        <input aria-label="Add a card by name" placeholder="Add a card by name…" value={text} autocomplete="off" spellcheck={false}
          onInput={(e) => setText(e.currentTarget.value)} />
        <select aria-label="Add to" value={board} onChange={(e) => setBoard(e.currentTarget.value as Board)}>
          {BOARDS.map(([b, l]) => <option key={b} value={b}>{l}</option>)}
        </select>
      </div>
      {matches.length > 0 && (
        <ul class="suggestions" role="listbox">
          {matches.map((c) => (
            <li key={c.oracle_id}>
              <button type="button" onClick={() => add(c)}>
                <span>{c.name}</span> <span class="muted small">{c.type_line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {text.length >= 2 && !matches.length && <p class="muted small">No card by that name.</p>}
      {flash && <p class="ok small" role="status">{flash}</p>}
    </form>
  );
}

function ShareDeck({ deck, onChange }: { deck: Deck; onChange: (sharedWith: string[]) => void }) {
  const col = useCollection();
  const { friendships } = useFriends();
  if (col.kind === "memory" || !col.account || col.account.isAnonymous) return null;
  const me = col.account.uid;
  const friends = (friendships || []).filter((f) => f.status === "accepted");
  return (
    <section class="panel share-deck">
      <h3>Share this deck</h3>
      {friends.length === 0 ? (
        <p class="muted">Add friends on the <a href="#/friends">Friends</a> page to share decks with them.</p>
      ) : (
        <ul class="people">
          {friends.map((f) => {
            const other = otherMember(f, me);
            const on = deck.sharedWith.includes(other);
            return (
              <li key={f.id}>
                <label class="switch">
                  <input type="checkbox" checked={on}
                    onChange={(e) => onChange(e.currentTarget.checked ? [...new Set([...deck.sharedWith, other])] : deck.sharedWith.filter((u) => u !== other))} />
                  {f.names[other] || "ManaBin player"}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
