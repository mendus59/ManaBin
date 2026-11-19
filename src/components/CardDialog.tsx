// Card details: rules text, the printing shown, its prices, and every other printing of the card.
import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { cap, images, scryfallUrl, type Card, type CardFace, type Printing } from "../lib/cards";
import { loadPrintings, loadStorePrices } from "../lib/data";
import { storeRows } from "../lib/prices";
import { AddToCollection } from "./AddToCollection";
import { Symbols } from "./Symbols";

const LEGAL_FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "commander", "pauper", "brawl", "historic", "timeless"];
const OTHER_PRICES: [string, string, string][] = [["eur", "€", ""], ["eur_foil", "€", " foil"], ["tix", "", " tix"]];
const FINISH_SUFFIX = ["", " foil", " etched"];

interface Props {
  card: Card;
  owned: boolean;
  setNames?: Record<string, string>;
  onClose: () => void;
  onStep: (delta: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/** Short description of what makes a printing look different: frame treatments, borders, promos. */
export function variantLabel(p: Printing): string {
  const bits: string[] = [];
  const fx = p.frame_effects || [];
  if (p.border_color === "borderless") bits.push("Borderless");
  if (fx.includes("showcase")) bits.push("Showcase");
  if (fx.includes("extendedart")) bits.push("Extended art");
  if (fx.includes("etched")) bits.push("Etched");
  if (fx.includes("inverted")) bits.push("Inverted");
  if (p.full_art) bits.push("Full art");
  if (p.frame && Number(p.frame) < 2003) bits.push(p.frame === "1993" || p.frame === "1997" ? "Old frame" : "");
  for (const t of p.promo_types || []) {
    if (["serialized", "textured", "galaxyfoil", "surgefoil", "halofoil", "confettifoil", "raisedfoil", "stepandcompleat", "oilslick", "neonink", "gilded", "ripplefoil", "fracturefoil", "doublerainbow"].includes(t)) {
      bits.push(t === "stepandcompleat" ? "Step-and-compleat" : cap(t.replace(/foil$/, " foil")));
    }
  }
  if (p.promo && !bits.length) bits.push("Promo");
  if (p.lang && p.lang !== "en") bits.push(p.lang.toUpperCase());
  return bits.filter(Boolean).join(" · ");
}

function Face({ f, typeLine }: { f: CardFace; typeLine?: string }) {
  const stats = f.power != null ? `${f.power}/${f.toughness}`
    : f.loyalty != null ? `Loyalty: ${f.loyalty}`
    : f.defense != null ? `Defense: ${f.defense}` : "";
  return (
    <section class="face">
      <h2><span>{f.name}</span><span><Symbols text={f.mana_cost} /></span></h2>
      <div class="type">{f.type_line || typeLine}</div>
      <div class="oracle">{(f.oracle_text || "").split("\n").map((line, i) => <p key={i}><Symbols text={line} /></p>)}</div>
      {f.flavor_text && <p class="flavor">{f.flavor_text}</p>}
      {stats && <p class="stats">{stats}</p>}
    </section>
  );
}

export function CardDialog({ card: c, owned, setNames, onClose, onStep, hasPrev, hasNext }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [printings, setPrintings] = useState<Printing[] | null>(null);
  const [store, setStore] = useState<Map<string, number[]> | null>(null);
  const [picked, setPicked] = useState<string>(c.id);
  const [face, setFace] = useState(0);

  useEffect(() => {
    if (!dialog.current!.open) dialog.current!.showModal();
  }, []);

  useEffect(() => {
    setPicked(c.id);
    setFace(0);
    setPrintings(null);
    if (!c.oracle_id) return;
    let live = true;
    loadPrintings(c.oracle_id).then((ps) => live && setPrintings(ps));
    loadStorePrices([c.oracle_id]).then((sp) => live && setStore(sp));
    return () => { live = false; };
  }, [c]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && hasNext) onStep(1);
      if (e.key === "ArrowLeft" && hasPrev) onStep(-1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [hasNext, hasPrev, onStep]);

  // The printing on show: the card itself, or one picked from the printings list.
  // In a collection the card's prices may come from another store; `tcg_prices` keeps TCGplayer's.
  const p = picked === c.id ? null : printings?.find((x) => x.id === picked) || null;
  const shown = p
    ? { ...c, ...p, image_uris: undefined, card_faces: c.card_faces?.map((f) => ({ ...f, image_uris: undefined })), scryfall_uri: undefined, lang: p.lang || "en" }
    : c;
  const imgs = images(shown, "large");
  const setName = (code: string) => setNames?.[code] || (code === c.set ? c.set_name : undefined) || code.toUpperCase();
  const faces: CardFace[] = c.card_faces && !c.oracle_text ? c.card_faces : [c as unknown as CardFace];
  const tcg: Record<string, string> | undefined = p ? p.prices : c.tcg_prices || c.prices;
  const storePrices = storeRows(tcg, store?.get(shown.id))
    .filter((row) => row.prices.some(Boolean))
    .map((row) => ({ ...row, text: row.prices.map((v, i) => (v ? `$${v.toFixed(2)}${FINISH_SUFFIX[i]}` : "")).filter(Boolean).join(" · ") }));
  const other = OTHER_PRICES.filter(([k]) => tcg?.[k]).map(([k, pre, post]) => `${pre}${tcg![k]}${post}`).join(" · ");
  const legal = LEGAL_FORMATS.filter((f) => c.legalities[f]);
  const o = c.owned;
  const finishes = o ? [
    o.qty - o.foil - o.etched ? `${o.qty - o.foil - o.etched} non-foil` : "",
    o.foil ? `${o.foil} foil` : "",
    o.etched ? `${o.etched} etched` : "",
  ].filter(Boolean).join(", ") : "";

  return (
    <dialog
      ref={dialog}
      aria-label={`${c.name} details`}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current!.close()}
    >
      <div class="dlg">
        <button type="button" class="close ghost" aria-label="Close" onClick={() => dialog.current!.close()}>✕</button>
        <div class="dlg-img">
          {imgs.length > 0 && <img src={imgs[face % imgs.length]} alt={c.name} />}
          {imgs.length > 1 && (
            <button type="button" class="flip" title="Flip card" aria-label="Flip card" onClick={() => setFace((f) => f + 1)}>⟲</button>
          )}
        </div>
        <div class="dlg-info">
          {faces.map((f) => <Face key={f.name} f={f} typeLine={c.type_line} />)}
          <dl class="meta">
            <dt>Printing</dt>
            <dd>
              {setName(shown.set)} ({shown.set.toUpperCase()}) #{shown.collector_number} · {cap(shown.rarity)}
              {p && variantLabel(p) ? ` · ${variantLabel(p)}` : ""}
            </dd>
            {owned && o && <><dt>Owned</dt><dd>{o.qty} ({finishes})</dd></>}
            {shown.artist && <><dt>Artist</dt><dd>{shown.artist}</dd></>}
            {storePrices.map((row) => (
              <Fragment key={row.source}><dt>{row.store}</dt><dd>{row.text}</dd></Fragment>
            ))}
            {other && <><dt>Cardmarket, MTGO</dt><dd>{other}</dd></>}
            {legal.length > 0 && (
              <>
                <dt>Legal</dt>
                <dd class="legal">
                  {legal.map((f) => (
                    <span key={f} class={c.legalities[f]} title={c.legalities[f]}>
                      {cap(f)}{c.legalities[f] === "legal" ? "" : ` (${c.legalities[f]})`}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>

          {printings && printings.length > 0 && (
            <details class="printings" open={!owned}>
              <summary>{printings.length} printing{printings.length === 1 ? "" : "s"}</summary>
              <ul>
                {printings.map((x) => {
                  const label = variantLabel(x);
                  const usd = x.prices.usd || x.prices.usd_foil || x.prices.usd_etched;
                  return (
                    <li key={x.id}>
                      <button type="button" class={(p ? p.id : c.id) === x.id ? "on" : ""} onClick={() => { setPicked(x.id); setFace(0); }}>
                        <span class="pset">{x.set.toUpperCase()} #{x.collector_number}</span>
                        <span class="pname">{setName(x.set)}{label ? <small> · {label}</small> : null}</span>
                        <span class="pprice">{usd ? `$${usd}` : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <AddToCollection
            printingId={shown.id}
            oracleId={c.oracle_id}
            finishes={shown.finishes}
            lang={shown.lang}
            label={`${shown.set.toUpperCase()} #${shown.collector_number}`}
          />

          <div class="dlg-nav">
            <button type="button" class="ghost" disabled={!hasPrev} onClick={() => onStep(-1)}>← Prev</button>
            <a href={scryfallUrl(shown)} target="_blank" rel="noopener">View on Scryfall ↗</a>
            <button type="button" class="ghost" disabled={!hasNext} onClick={() => onStep(1)}>Next →</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
