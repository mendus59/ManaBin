// Binder controls for My collection: pick a binder to show, make or delete one, and move cards.
import { useEffect, useState } from "preact/hooks";
import type { Card } from "../lib/cards";
import type { Entries } from "../lib/collection";
import { useCollection } from "../state/collection";

/** null = every binder, "" = cards in no binder */
export type BinderFilter = string | null;

export function inBinder(entries: Entries, binder: BinderFilter): Entries {
  if (binder === null) return entries;
  return new Map([...entries].filter(([, e]) => (e.b || "") === binder));
}

export function BinderBar({ value, onChange }: { value: BinderFilter; onChange: (b: BinderFilter) => void }) {
  const col = useCollection();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [sure, setSure] = useState(false);
  useEffect(() => setSure(false), [value]);

  const copies = new Map<string, number>();
  for (const e of col.entries?.values() || []) copies.set(e.b || "", (copies.get(e.b || "") || 0) + e.q);
  const count = (b: string) => (copies.get(b) || 0).toLocaleString();

  return (
    <div class="binders">
      <label class="source">
        <span class="muted">Binder</span>
        <select aria-label="Binder" value={value === null ? "\u0000all" : value}
          onChange={(e) => onChange(e.currentTarget.value === "\u0000all" ? null : e.currentTarget.value)}>
          <option value={"\u0000all"}>All cards</option>
          <option value="">No binder ({count("")})</option>
          {col.binders.map((b) => <option key={b} value={b}>{b} ({count(b)})</option>)}
        </select>
      </label>
      {adding ? (
        <form class="inline-form" onSubmit={async (e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return;
          await col.addBinder(n).catch(() => {});
          setAdding(false);
          setName("");
          onChange(n);
        }}>
          <input aria-label="New binder name" placeholder="Binder name" maxLength={60} value={name} autoFocus
            onInput={(e) => setName(e.currentTarget.value)} />
          <button type="submit" class="primary" disabled={!name.trim()}>Add</button>
          <button type="button" class="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      ) : (
        <button type="button" class="ghost" onClick={() => setAdding(true)}>New binder</button>
      )}
      {value && (
        <button type="button" class={sure ? "ghost danger" : "ghost"}
          title="Delete the binder. Its cards stay in your collection, in no binder."
          onClick={async () => {
            if (!sure) return setSure(true);
            await col.deleteBinder(value).catch(() => {});
            onChange(null);
          }}>
          {sure ? `Delete "${value}"? Cards stay` : "Delete binder"}
        </button>
      )}
    </div>
  );
}

/** "Move these N cards to <binder>", for the cards a search shows. */
export function MoveShown({ shown, entries }: { shown: Card[]; entries: Entries }) {
  const col = useCollection();
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const ids = new Set(shown.map((c) => c.id));
  const keys = [...entries].filter(([, e]) => ids.has(e.p)).map(([k]) => k);
  const copies = [...entries.values()].reduce((n, e) => n + (ids.has(e.p) ? e.q : 0), 0);
  if (!keys.length) return null;
  return (
    <div class="move-shown">
      <span class="muted">Move the {copies.toLocaleString()} card{copies === 1 ? "" : "s"} shown to</span>
      <select aria-label="Move to binder" value={to ?? "\u0000"} onChange={(e) => setTo(e.currentTarget.value === "\u0000" ? null : e.currentTarget.value)}>
        <option value={"\u0000"}>choose a binder…</option>
        <option value="">No binder</option>
        {col.binders.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <button type="button" class="ghost" disabled={to === null || busy} onClick={async () => {
        setBusy(true);
        await col.moveEntries(keys, to!).then(() => setDone(`Moved to ${to || "no binder"}`), () => {});
        setBusy(false);
        setTimeout(() => setDone(""), 2000);
      }}>
        {busy ? "Moving…" : done || "Move"}
      </button>
    </div>
  );
}
