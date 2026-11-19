// App-wide collection state: the signed-in account, its entries, and the actions that change them.
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getBackend, type Account, type Backend, type Social } from "../lib/backend";
import { entryKey, today, type Entries, type Entry } from "../lib/collection";

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
    return {
      account, entries, pending, error, kind: backend?.kind ?? null,
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
  }, [backend, account, known, entries, pending, error]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
