// Where the collection is stored. The app uses Firebase (Firestore + Auth); tests and local
// development can use an in-browser store instead by building with VITE_STORE=memory.
import type { Entries, Entry } from "./collection";
import type { Deck, WishItem } from "./decks";

export interface Account {
  uid: string;
  /** Guest accounts are created automatically when the Firebase project allows them. */
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

/** What other ManaBin users can see about you: never your email. */
export interface Profile {
  uid: string;
  name: string;
  photo?: string | null;
  /** short code friends type in (or follow as a link) to add you */
  code: string;
}

export interface Friendship {
  id: string;
  members: [string, string];
  /** who sent the request */
  from: string;
  status: "pending" | "accepted";
  names: Record<string, string>;
  photos?: Record<string, string | null>;
  /** sharing[uid] = true when that member shares their collection with the other */
  sharing?: Record<string, boolean>;
}

export interface Social {
  /** Your public profile, created on first use. Needs a Google account. */
  ensureProfile(a: Account): Promise<Profile>;
  findByCode(code: string): Promise<Profile | null>;
  watchFriendships(uid: string, cb: (f: Friendship[]) => void, onError: (e: Error) => void): () => void;
  request(me: Profile, them: Profile): Promise<void>;
  accept(f: Friendship): Promise<void>;
  /** Declines a request, cancels one you sent, or removes a friend (and stops sharing both ways). */
  remove(f: Friendship, me: string): Promise<void>;
  setSharing(f: Friendship, me: string, on: boolean): Promise<void>;
}

export interface Backend {
  /**
   * Calls back with the signed-in account. A guest account is created if the project allows
   * them; otherwise it calls back with null until the user signs in with Google.
   */
  onAccount(cb: (a: Account | null) => void, onError: (e: Error) => void): () => void;
  /** Signs in with Google. A guest's collection carries over; returns how many entries were merged into an existing account. */
  signInWithGoogle(guestEntries: Entries): Promise<{ merged: number }>;
  signOut(): Promise<void>;
  /** Live view of a collection: your own, or a friend's that they share with you. `pending` is true while local changes haven't reached the server. */
  subscribe(uid: string, cb: (entries: Entries, pending: boolean) => void, onError: (e: Error) => void): () => void;
  write(uid: string, changes: Changes): Promise<void>;
  /** Binder names, including empty binders (cards name their binder in `Entry.b`). */
  watchBinders(uid: string, cb: (names: string[]) => void, onError: (e: Error) => void): () => void;
  setBinders(uid: string, names: string[]): Promise<void>;
  /** Your decks, live. */
  watchDecks(uid: string, cb: (decks: Deck[]) => void, onError: (e: Error) => void): () => void;
  /** A friend's decks that they share with you, live. */
  watchSharedDecks(owner: string, me: string, cb: (decks: Deck[]) => void, onError: (e: Error) => void): () => void;
  saveDeck(uid: string, deck: Deck): Promise<void>;
  watchWishlist(uid: string, cb: (items: WishItem[]) => void, onError: (e: Error) => void): () => void;
  setWishlist(uid: string, items: WishItem[]): Promise<void>;
  deleteDeck(uid: string, id: string): Promise<void>;
  readonly kind: "firebase" | "memory";
  /** Friends and sharing; only the Firebase backend has them. */
  readonly social?: Social;
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
    watchBinders(_uid, cb) {
      return watchKey<string[]>("manabin-memory-binders", [], cb);
    },
    async setBinders(_uid, names) {
      putKey("manabin-memory-binders", names);
    },
    watchDecks(_uid, cb) {
      return watchKey<Deck[]>("manabin-memory-decks", [], cb);
    },
    watchSharedDecks() {
      return () => {};
    },
    watchWishlist(_uid, cb) {
      return watchKey<WishItem[]>("manabin-memory-wishlist", [], cb);
    },
    async setWishlist(_uid, items) {
      putKey("manabin-memory-wishlist", items);
    },
    async saveDeck(_uid, deck) {
      const decks = getKey<Deck[]>("manabin-memory-decks", []).filter((d) => d.id !== deck.id);
      putKey("manabin-memory-decks", [...decks, deck]);
    },
    async deleteDeck(_uid, id) {
      putKey("manabin-memory-decks", getKey<Deck[]>("manabin-memory-decks", []).filter((d) => d.id !== id));
    },
  };
}

// Small localStorage-backed values with change listeners, for the memory backend.
const keyListeners = new Map<string, Set<(v: unknown) => void>>();
function getKey<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function putKey(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked
  }
  keyListeners.get(key)?.forEach((cb) => cb(value));
}
function watchKey<T>(key: string, fallback: T, cb: (v: T) => void): () => void {
  if (!keyListeners.has(key)) keyListeners.set(key, new Set());
  const set = keyListeners.get(key)!;
  const listener = (v: unknown) => cb(v as T);
  set.add(listener);
  queueMicrotask(() => cb(getKey(key, fallback)));
  return () => set.delete(listener);
}
