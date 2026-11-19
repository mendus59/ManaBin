// In the card dialog: what you own of the printing on show, and a form to add more.
import { useEffect, useState } from "preact/hooks";
import { CONDITIONS, FINISH_LABELS, LANGUAGES, entriesFor, type Condition, type Finish } from "../lib/collection";
import { useCollection } from "../state/collection";

interface Props {
  printingId: string;
  oracleId?: string;
  finishes?: string[];
  /** language of the printing on show; most printings are English */
  lang?: string;
  label: string;
}

export function AddToCollection({ printingId, oracleId, finishes, lang, label }: Props) {
  const col = useCollection();
  const available = (finishes?.length ? finishes : ["nonfoil"]).filter((f): f is Finish => f in FINISH_LABELS);
  const [finish, setFinish] = useState<Finish>(available[0] || "nonfoil");
  const [condition, setCondition] = useState<Condition>("NM");
  const [language, setLanguage] = useState(lang || "en");
  const [qty, setQty] = useState(1);
  const [flash, setFlash] = useState("");

  // A different printing may not come in the finish that was picked.
  useEffect(() => {
    if (!available.includes(finish)) setFinish(available[0] || "nonfoil");
    setLanguage(lang || "en");
  }, [printingId]);

  if (!oracleId) return null;
  if (!col.entries) {
    return <section class="owned-box"><p class="muted">{col.error ? "Your collection isn't available right now." : "Loading your collection…"}</p></section>;
  }

  const mine = entriesFor(col.entries, printingId);
  const owned = mine.reduce((n, [, e]) => n + e.q, 0);
  const langName = (code: string) => LANGUAGES.find(([c]) => c === code)?.[1] || code.toUpperCase();

  const add = (e: Event) => {
    e.preventDefault();
    col.add({ p: printingId, o: oracleId, f: finish, c: condition, l: language, q: qty });
    setFlash(`Added ${qty}`);
    setTimeout(() => setFlash(""), 1600);
  };

  return (
    <section class="owned-box" aria-label="Your collection">
      <h3>
        In your collection
        <span class="muted"> · {owned ? `${owned} of this printing` : "none of this printing yet"}</span>
      </h3>
      {mine.length > 0 && (
        <ul class="entries">
          {mine.map(([key, e]) => (
            <li key={key}>
              <span class="what">
                {FINISH_LABELS[e.f]} · {e.c}{e.l !== "en" ? ` · ${langName(e.l)}` : ""}{e.b ? <span class="muted"> · {e.b}</span> : null}
              </span>
              <span class="stepper">
                <button type="button" class="ghost" aria-label="Remove one" onClick={() => col.setQty(key, e.q - 1)}>−</button>
                <span class="q">{e.q}</span>
                <button type="button" class="ghost" aria-label="Add one" onClick={() => col.setQty(key, e.q + 1)}>+</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form class="add-form" onSubmit={add}>
        <select aria-label="Finish" value={finish} onChange={(e) => setFinish(e.currentTarget.value as Finish)}>
          {available.map((f) => <option key={f} value={f}>{FINISH_LABELS[f]}</option>)}
        </select>
        <select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.currentTarget.value as Condition)}>
          {CONDITIONS.map(([c, name]) => <option key={c} value={c} title={name}>{c}</option>)}
        </select>
        <select aria-label="Language" value={language} onChange={(e) => setLanguage(e.currentTarget.value)}>
          {LANGUAGES.map(([c, name]) => <option key={c} value={c}>{name}</option>)}
        </select>
        <input aria-label="Quantity" type="number" min={1} max={999} inputMode="numeric" value={qty}
          onInput={(e) => setQty(Math.max(1, Math.min(999, parseInt(e.currentTarget.value, 10) || 1)))} />
        <button type="submit" class="primary">{flash || `Add ${label}`}</button>
      </form>
    </section>
  );
}
