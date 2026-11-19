// Where the collection is stored. The app uses Firebase (Firestore + Auth); tests and local
// development can use an in-browser store instead by building with VITE_STORE=memory.
import type { Entries, Entry } from "./collection";

export interface Account {
  uid: string;
  /** Guest accounts are created automatically; signing in with Google keeps their data. */
  isAnonymous: boolean;
  name?: string | null;
  email?: string | null;
  photo?: string | null;
}

export interface Changes {
  set: Entry[];
  /** entry keys to delete */
  remove: string[];
}

export interface Backend {
  /** Calls back with the signed-in account (a guest account is created if needed). */
  onAccount(cb: (a: Account | null) => void, onError: (e: Error) => void): () => void;
  /** Signs in with Google. A guest's collection carries over; returns how many entries were merged into an existing account. */
  signInWithGoogle(guestEntries: Entries): Promise<{ merged: number }>;
  signOut(): Promise<void>;
  /** Live view of the account's collection. `pending` is true while local changes haven't reached the server. */
  subscribe(uid: string, cb: (entries: Entries, pending: boolean) => void, onError: (e: Error) => void): () => void;
  write(uid: string, changes: Changes): Promise<void>;
  /** Short description for the UI, e.g. "Saved to your Google account". */
  readonly kind: "firebase" | "memory";
}

export async function getBackend(): Promise<Backend> {
  if (import.meta.env.VITE_STORE === "memory") return memoryBackend();
  const { firebaseBackend } = await import("./firebase");
  return firebaseBackend();
}

/** Keeps the collection in this browser's localStorage. Used for tests and offline development. */
function memoryBackend(): Backend {
  const KEY = "manabin-memory-store";
  const account: Account = { uid: "local", isAnonymous: true };
  const listeners = new Set<(e: Entries, pending: boolean) => void>();
  const read = (): Entries => {
    try {
      return new Map(JSON.parse(localStorage.getItem(KEY) || "[]"));
    } catch {
      return new Map();
    }
  };
  let entries = read();
  return {
    kind: "memory",
    onAccount(cb) {
      queueMicrotask(() => cb(account));
      return () => {};
    },
    async signInWithGoogle() {
      throw new Error("Google sign-in isn't available in this build.");
    },
    async signOut() {},
    subscribe(_uid, cb) {
      listeners.add(cb);
      queueMicrotask(() => cb(entries, false));
      return () => listeners.delete(cb);
    },
    async write(_uid, changes) {
      const { entryKey } = await import("./collection");
      entries = new Map(entries);
      for (const k of changes.remove) entries.delete(k);
      for (const e of changes.set) entries.set(entryKey(e), e);
      try {
        localStorage.setItem(KEY, JSON.stringify([...entries]));
      } catch {
        // storage full or blocked: keep working in memory
      }
      listeners.forEach((cb) => cb(entries, false));
    },
  };
}
