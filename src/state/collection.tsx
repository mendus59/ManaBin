// App-wide collection state: the signed-in account, its entries, and the actions that change them.
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getBackend, type Account, type Backend, type Social } from "../lib/backend";
import { entryKey, moveChanges, today, type Entries, type Entry } from "../lib/collection";
import type { Deck } from "../lib/decks";

export interface CollectionState {
  account: Account | null;
  /** true once we know nobody is signed in (guest accounts are off, so Google sign-in is needed) */
  signedOut: boolean;
  backend: Backend | null;
  social: Social | null;
  entries: Entries | null;
  /** local changes not yet saved to the server */
  pending: boolean;
  error: string | null;
  kind: Backend["kind"] | null;
  add(e: Omit<Entry, "a" | "q"> & { q?: number }): void;
  setQty(key: string, q: number): void;
  /** Binder names: saved ones plus any that entries use, sorted. */
  binders: string[];
  addBinder(name: string): Promise<void>;
  /** Moves entries to a binder ("" = no binder), joining entries that end up the same. */
  moveEntries(keys: string[], binder: string): Promise<void>;
  /** Removes a binder from the list; its cards move to no binder. */
  deleteBinder(name: string): Promise<void>;
  decks: Deck[] | null;
  saveDeck(deck: Deck): Promise<void>;
  deleteDeck(id: string): Promise<void>;
  importEntries(entries: Entry[], mode: "merge" | "replace"): Promise<void>;
  signIn(): Promise<string | null>;
  signOut(): Promise<void>;
  dismissError(): void;
}

const Ctx = createContext<CollectionState | null>(null);

export function useCollection(): CollectionState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useCollection needs a <CollectionProvider>");
  return s;
}

export function CollectionProvider({ children }: { children: ComponentChildren }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [known, setKnown] = useState(false);
  const [entries, setEntries] = useState<Entries | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBinders, setSavedBinders] = useState<string[]>([]);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const latest = useRef<Entries>(new Map());
  latest.current = entries || new Map();

  useEffect(() => {
    let stop = () => {};
    getBackend()
      .then((b) => {
        setBackend(b);
        stop = b.onAccount((a) => {
          // Token refreshes call back with the same account; only a real change re-renders.
          setAccount((cur) => (cur && a && cur.uid === a.uid && cur.isAnonymous === a.isAnonymous && cur.name === a.name ? cur : a));
          setKnown(true);
        }, (e) => setError(e.message));
      })
      .catch((e) => setError(`Couldn't start saving: ${e.message || e}`));
    return () => stop();
  }, []);

  useEffect(() => {
    if (!backend || !account) { setEntries(null); return; }
    setEntries(null);
    return backend.subscribe(account.uid, (e, p) => { setEntries(e); setPending(p); }, (e) => setError(e.message));
  }, [backend, account?.uid]);

  useEffect(() => {
    setSavedBinders([]);
    setDecks(null);
    if (!backend || !account) return;
    const stopBinders = backend.watchBinders(account.uid, setSavedBinders, (e) => setError(e.message));
    const stopDecks = backend.watchDecks(account.uid, (d) => setDecks(d.sort((a, b) => a.name.localeCompare(b.name))), (e) => setError(e.message));
    return () => { stopBinders(); stopDecks(); };
  }, [backend, account?.uid]);

  const binders = useMemo(() => {
    const names = new Set(savedBinders);
    for (const e of entries?.values() || []) if (e.b) names.add(e.b);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [savedBinders, entries]);

  const state = useMemo<CollectionState>(() => {
    const write = (set: Entry[], remove: string[]) => {
      if (!backend || !account) {
        const e = new Error(known ? "Sign in with Google to save cards to your collection." : "Still connecting. Try again in a moment.");
        setError(e.message);
        return Promise.reject(e);
      }
      const p = backend.write(account.uid, { set, remove });
      p.catch((e) => setError(e.message));
      return p;
    };
    const need = () => {
      if (backend && account) return { backend, uid: account.uid };
      const e = new Error(known ? "Sign in with Google to save to your account." : "Still connecting. Try again in a moment.");
      setError(e.message);
      throw e;
    };
    const fail = (e: unknown) => {
      setError((e as Error).message);
      throw e;
    };
    return {
      account, entries, pending, error, kind: backend?.kind ?? null, binders, decks,
      signedOut: known && !account, backend, social: backend?.social ?? null,
      add(partial) {
        const e: Entry = { ...partial, q: partial.q ?? 1, a: today() } as Entry;
        const cur = latest.current.get(entryKey(e));
        write([cur ? { ...cur, q: cur.q + e.q } : e], []).catch(() => {});
      },
      setQty(key, q) {
        const cur = latest.current.get(key);
        if (!cur) return;
        (q > 0 ? write([{ ...cur, q }], []) : write([], [key])).catch(() => {});
      },
      async importEntries(incoming, mode) {
        const base = mode === "replace" ? new Map<string, Entry>() : latest.current;
        const merged = new Map<string, Entry>();
        for (const e of incoming) {
          const k = entryKey(e);
          const cur = merged.get(k) || base.get(k);
          merged.set(k, cur ? { ...cur, q: cur.q + e.q } : e);
        }
        const remove = mode === "replace" ? [...latest.current.keys()].filter((k) => !merged.has(k)) : [];
        // Writes go in chunks so one import can't exceed Firestore's batch limits.
        const set = [...merged.values()];
        const CHUNK = 2000;
        for (let i = 0; i < Math.max(set.length, remove.length); i += CHUNK) {
          await write(set.slice(i, i + CHUNK), remove.slice(i, i + CHUNK));
        }
      },
      async addBinder(name) {
        const n = name.trim().slice(0, 60);
        if (!n || binders.includes(n)) return;
        const { backend: b, uid } = need();
        await b.setBinders(uid, [...savedBinders, n].sort((x, y) => x.localeCompare(y))).catch(fail);
      },
      async moveEntries(keys, binder) {
        const b = binder.trim() || undefined;
        const { set, remove } = moveChanges(latest.current, keys, b);
        if (!set.length && !remove.length) return;
        const CHUNK = 2000;
        for (let i = 0; i < Math.max(set.length, remove.length); i += CHUNK) {
          await write(set.slice(i, i + CHUNK), remove.slice(i, i + CHUNK));
        }
        if (b && !savedBinders.includes(b)) await this.addBinder(b);
      },
      async deleteBinder(name) {
        const keys = [...latest.current].filter(([, e]) => e.b === name).map(([k]) => k);
        if (keys.length) await this.moveEntries(keys, "");
        const { backend: b, uid } = need();
        await b.setBinders(uid, savedBinders.filter((x) => x !== name)).catch(fail);
      },
      async saveDeck(deck) {
        const { backend: b, uid } = need();
        await b.saveDeck(uid, { ...deck, updated: new Date().toISOString() }).catch(fail);
      },
      async deleteDeck(id) {
        const { backend: b, uid } = need();
        await b.deleteDeck(uid, id).catch(fail);
      },
      async signIn() {
        if (!backend) return null;
        try {
          const { merged } = await backend.signInWithGoogle(latest.current);
          return merged ? `Signed in. Added ${merged} entries from this device to your collection.` : null;
        } catch (e) {
          setError((e as Error).message);
          return null;
        }
      },
      async signOut() {
        await backend?.signOut();
      },
      dismissError() {
        setError(null);
      },
    };
  }, [backend, account, known, entries, pending, error, binders, savedBinders, decks]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
