// The Commander builder beside a deck: suggestions (EDHREC and your own cards), deck stats,
// and what the missing cards cost at each store.
import { useEffect, useMemo, useState } from "preact/hooks";
import { dollars, type Card } from "../lib/cards";
import { cheapestByStore } from "../lib/data";
import type { Deck, DeckCard } from "../lib/decks";
import { missingCards, nameKey } from "../lib/decks";
import {
  ROLES, ROLE_TARGETS, deckStats, edhrecSlug, fitsIdentity, parseEdhrec, roles, suggestFromCollection,
  type EdhrecCard, type Role, type Suggestion,
} from "../lib/edh";

const edhrecCache = new Map<string, Promise<EdhrecCard[]>>();

/** EDHREC's recommendations for a commander. Unofficial: their public page data, which may change or go away. */
function loadEdhrec(slug: string): Promise<EdhrecCard[]> {
  let p = edhrecCache.get(slug);
  if (!p) {
    p = fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`)
      .then((r) => {
        if (r.status === 404) throw new Error("EDHREC has no page for this commander yet.");
        if (!r.ok) throw new Error(`EDHREC answered ${r.status}.`);
        return r.json();
      })
      .then(parseEdhrec, (e) => {
        throw e instanceof TypeError ? new Error("EDHREC couldn't be reached. Check your connection, or try again later.") : e;
      });
    p.catch(() => edhrecCache.delete(slug));
    edhrecCache.set(slug, p);
  }
  return p;
}

interface Props {
  deck: Deck;
  oracles: Map<string, Card>;
  names: Map<string, Card>;
  owned: Map<string, number>;
  readOnly: boolean;
  onAdd: (c: DeckCard) => void;
  onWish: (cards: DeckCard[]) => void;
  onOpen: (c: Card) => void;
}

export function DeckBuilder(props: Props) {
  const singleton = ["commander", "brawl", "oathbreaker"].includes(props.deck.format);
  const [tab, setTab] = useState<"suggest" | "stats" | "buy">(singleton && !props.readOnly ? "suggest" : "stats");
  return (
    <section class="panel builder">
      <div class="seg builder-tabs" role="tablist">
        {singleton && !props.readOnly && <button type="button" role="tab" aria-selected={tab === "suggest"} class={tab === "suggest" ? "on" : ""} onClick={() => setTab("suggest")}>Suggestions</button>}
        <button type="button" role="tab" aria-selected={tab === "stats"} class={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>Stats</button>
        <button type="button" role="tab" aria-selected={tab === "buy"} class={tab === "buy" ? "on" : ""} onClick={() => setTab("buy")}>Buy missing</button>
      </div>
      {tab === "suggest" && <Suggestions {...props} />}
      {tab === "stats" && <Stats {...props} />}
      {tab === "buy" && <BuyMissing {...props} />}
    </section>
  );
}

// ---------- suggestions ----------

function Suggestions({ deck, oracles, names, owned, onAdd, onWish, onOpen }: Props) {
  const commanders = deck.cards.filter((c) => c.b === "commander").map((c) => oracles.get(c.o)).filter(Boolean) as Card[];
  const [source, setSource] = useState<"collection" | "edhrec">("collection");
  const [role, setRole] = useState<Role | "">("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [shown, setShown] = useState(30);
  const [edhrec, setEdhrec] = useState<{ cards?: EdhrecCard[]; error?: string } | null>(null);
  const slug = edhrecSlug(commanders.map((c) => c.name));
  const inDeck = useMemo(() => new Set(deck.cards.filter((c) => c.b !== "maybe").map((c) => c.o)), [deck.cards]);

  useEffect(() => {
    setEdhrec(null);
    if (source !== "edhrec" || !commanders.length) return;
    let live = true;
    loadEdhrec(slug).then((cards) => live && setEdhrec({ cards }), (e) => live && setEdhrec({ error: (e as Error).message || "EDHREC couldn't be reached." }));
    return () => { live = false; };
  }, [source, slug]);
  useEffect(() => setShown(30), [source, role, ownedOnly, slug]);

  const list: Suggestion[] = useMemo(() => {
    if (!commanders.length) return [];
    if (source === "collection") return suggestFromCollection(commanders, owned, oracles, inDeck, 400);
    const identity = new Set(commanders.flatMap((c) => c.color_identity || []));
    return (edhrec?.cards || []).flatMap((e) => {
      const card = names.get(nameKey(e.name));
      if (!card || inDeck.has(card.oracle_id!) || !fitsIdentity(card, identity)) return [];
      return [{ card, reason: e.section, inclusion: e.inclusion, synergy: e.synergy, section: e.section, owned: owned.get(card.oracle_id!) || 0 }];
    });
  }, [source, edhrec, commanders.map((c) => c.oracle_id).join(), owned, oracles, inDeck]);

  const filtered = list.filter((s) => (!role || roles(s.card).has(role)) && (!ownedOnly || s.owned > 0));

  if (!commanders.length) {
    return <p class="muted">Choose a commander first: add a card with <strong>Add to: Commander</strong> above. Suggestions then follow its colors and themes.</p>;
  }
  return (
    <div class="suggest">
      <div class="suggest-controls">
        <label class="source">
          <span class="muted">From</span>
          <select value={source} onChange={(e) => setSource(e.currentTarget.value as "collection" | "edhrec")}>
            <option value="collection">Your collection</option>
            <option value="edhrec">EDHREC</option>
          </select>
        </label>
        <label class="source">
          <span class="muted">Role</span>
          <select value={role} onChange={(e) => setRole(e.currentTarget.value as Role | "")}>
            <option value="">Any</option>
            {ROLES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
          </select>
        </label>
        {source === "edhrec" && (
          <label class="switch"><input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.currentTarget.checked)} /> Only cards I own</label>
        )}
      </div>
      <p class="muted small">
        {source === "collection"
          ? `Cards you own in ${commanders.map((c) => c.name).join(" and ")}'s colors, ranked by what they share with it and how widely they're played.`
          : <>What other {commanders.map((c) => c.name).join(" and ")} decks play, from <a href={`https://edhrec.com/commanders/${slug}`} target="_blank" rel="noopener">EDHREC</a>. Unofficial, so it may stop working.</>}
      </p>
      {source === "edhrec" && !edhrec && <p class="empty">Asking EDHREC…</p>}
      {source === "edhrec" && edhrec?.error && <p class="error">{edhrec.error}</p>}
      {filtered.length === 0 && (source === "collection" || edhrec?.cards) && <p class="muted">Nothing to suggest{role ? " for that role" : ""}.</p>}
      <ul class="suggest-list">
        {filtered.slice(0, shown).map((s) => (
          <li key={s.card.oracle_id} class={s.owned ? "have" : "need"}>
            <button type="button" class="linkish card-name" onClick={() => onOpen(s.card)}>{s.card.name}</button>
            <span class="why muted small">
              {s.inclusion != null ? `${Math.round(s.inclusion * 100)}% of decks${s.synergy ? ` · synergy ${s.synergy > 0 ? "+" : ""}${Math.round(s.synergy * 100)}%` : ""}` : s.reason}
            </span>
            <span class="own">{s.owned ? "✓ owned" : "not owned"}</span>
            <span class="actions">
              <button type="button" class="ghost small" onClick={() => onAdd({ o: s.card.oracle_id!, n: s.card.name, q: 1, b: "main" })}>Add</button>
              {!s.owned && <button type="button" class="ghost small" title="Add to your wishlist for this deck" onClick={() => onWish([{ o: s.card.oracle_id!, n: s.card.name, q: 1, b: "main" }])}>Wishlist</button>}
            </span>
          </li>
        ))}
      </ul>
      {filtered.length > shown && <button type="button" class="ghost" onClick={() => setShown((n) => n + 30)}>Show more ({filtered.length - shown} left)</button>}
    </div>
  );
}

// ---------- stats ----------

const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

function Stats({ deck, oracles }: Props) {
  const st = deckStats(deck.cards, oracles);
  const top = Math.max(1, ...st.curve);
  const colors = Object.keys(COLOR_NAMES).filter((c) => st.pips[c] || st.sources[c]);
  const pipTotal = colors.reduce((n, c) => n + st.pips[c], 0);
  const commanderLike = ["commander", "brawl", "oathbreaker"].includes(deck.format);
  const gc = st.gameChangers.length;
  return (
    <div class="stats">
      <div>
        <h4>Mana curve <span class="muted small">(average {st.averageMv.toFixed(2)}, lands left out)</span></h4>
        <div class="curve" role="img" aria-label={`Mana curve: ${st.curve.map((n, i) => `${n} at ${i === 7 ? "7+" : i}`).join(", ")}`}>
          {st.curve.map((n, i) => (
            <div class="bar" key={i}>
              <span class="n">{n || ""}</span>
              <span class="fill" style={{ height: `${(n / top) * 100}%` }} />
              <span class="mv">{i === 7 ? "7+" : i}</span>
            </div>
          ))}
        </div>
      </div>
      {colors.length > 0 && (
        <div>
          <h4>Colors</h4>
          <table class="mini">
            <thead><tr><th></th><th>Cost symbols</th><th>Sources</th></tr></thead>
            <tbody>
              {colors.map((c) => (
                <tr key={c}>
                  <td>{COLOR_NAMES[c]}</td>
                  <td>{st.pips[c]}{pipTotal ? <span class="muted"> ({Math.round((st.pips[c] / pipTotal) * 100)}%)</span> : null}</td>
                  <td>{st.sources[c]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="muted small">Sources are cards that can make that color (lands, rocks, dorks).</p>
        </div>
      )}
      <div>
        <h4>Roles</h4>
        <table class="mini">
          <tbody>
            {ROLES.map(([r, l]) => (
              <tr key={r}>
                <td>{l}</td>
                <td>{st.roles[r]}</td>
                <td class="muted small">{commanderLike && ROLE_TARGETS[r] ? (st.roles[r] < ROLE_TARGETS[r]! ? `usually ${ROLE_TARGETS[r]}+` : "✓") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="muted small">Roles are guessed from each card's rules text.</p>
      </div>
      {commanderLike && (
        <div>
          <h4>Game Changers: {gc}</h4>
          <p class="muted small">
            {gc === 0 ? "None, so this deck can fit Brackets 1–2." : gc <= 3 ? "Up to three fits Bracket 3." : "More than three means Bracket 4 or higher."}
          </p>
          {gc > 0 && <p class="small">{st.gameChangers.join(", ")}</p>}
        </div>
      )}
    </div>
  );
}

// ---------- buying missing cards ----------

const STORES = ["TCGplayer", "Card Kingdom", "MTGGoldfish"];

function BuyMissing({ deck, owned, oracles, onWish, readOnly }: Props) {
  const missing = useMemo(() => missingCards(deck.cards, owned, ["commander", "main", "side"]), [deck.cards, owned]);
  const [prices, setPrices] = useState<Map<string, number[]> | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    let live = true;
    setPrices(null);
    cheapestByStore(missing.map((c) => c.o)).then((p) => live && setPrices(p));
    return () => { live = false; };
  }, [missing.map((c) => `${c.o}:${c.q}`).join()]);

  if (!missing.length) return <p class="ok">You own every card in this deck.</p>;
  const totals = [0, 1, 2].map((i) => missing.reduce((n, c) => n + c.q * (prices?.get(c.o)?.[i] || 0), 0));
  const lowest = (o: string) => {
    const found = (prices?.get(o) || []).filter((v) => v > 0);
    return found.length ? Math.min(...found) : 0;
  };
  const best = missing.reduce((n, c) => n + c.q * lowest(c.o), 0);
  return (
    <div class="buy">
      <p class="muted small">The cheapest printing of each card you don't own (or don't own enough of), at each store. Prices are for non-foil copies.</p>
      <div class="table-scroll">
        <table class="mini buy-table">
          <thead><tr><th>Card</th><th>Need</th>{STORES.map((s) => <th key={s}>{s}</th>)}</tr></thead>
          <tbody>
            {missing.sort((a, b) => a.n.localeCompare(b.n)).map((c) => {
              const p = prices?.get(c.o);
              const low = lowest(c.o);
              return (
                <tr key={c.o}>
                  <td>{c.n}{!oracles.get(c.o) && <span class="muted"> (unknown)</span>}</td>
                  <td>{c.q}</td>
                  {[0, 1, 2].map((i) => <td key={i} class={p && p[i] && p[i] === low ? "low" : ""}>{p ? (p[i] ? dollars(p[i] * c.q) : "–") : "…"}</td>)}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><th>Total</th><th>{missing.reduce((n, c) => n + c.q, 0)}</th>{totals.map((t, i) => <th key={i}>{prices ? dollars(t) : "…"}</th>)}</tr>
          </tfoot>
        </table>
      </div>
      {prices && <p class="small">Buying each card wherever it's cheapest: <strong>{dollars(best)}</strong>. A store's total leaves out cards it doesn't list.</p>}
      {!readOnly && (
        <button type="button" class="ghost" disabled={added} onClick={() => { onWish(missing); setAdded(true); }}>
          {added ? "Added to your wishlist" : "Add all missing cards to my wishlist"}
        </button>
      )}
    </div>
  );
}
