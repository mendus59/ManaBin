// Firebase backend: a guest account per browser (when the project allows them), Google sign-in
// to sync across devices, the collection in Firestore with an offline cache, and friends.
//
// Firestore layout (see firestore.rules):
//   users/{uid}/collection/{0-f}   { entries: { <entry key>: Entry } }
//   users/{uid}/sharing/collection { viewers: [uid, ...] }   friends who may read the collection
//   profiles/{uid}                 { name, photo, code }      what friends see (never the email)
//   codes/{code}                   { uid }                    friend codes
//   friendships/{uidA_uidB}        Friendship (uids sorted)
//   users/{uid}/meta/binders       { names: [...] }           binder names, including empty ones
//   users/{uid}/meta/wishlist      { items: WishItem[] }      cards wanted, maybe for a deck
//   users/{uid}/decks/{id}         Deck (without id)          sharedWith: friends who may read it
// Entries are spread over 16 documents by the first hex digit of the printing ID, so loading
// a collection costs 16 document reads however many cards it holds.
import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider, connectAuthEmulator, getAuth, linkWithCredential, linkWithPopup, onIdTokenChanged, signInAnonymously,
  signInWithCredential, signInWithPopup, signOut, type AuthError, type User,
} from "firebase/auth";
import {
  arrayRemove, arrayUnion, collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getDocs,
  initializeFirestore, memoryLocalCache, onSnapshot, persistentLocalCache, persistentMultipleTabManager,
  query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import type { Account, Backend, Changes, Friendship, Profile, Social } from "./backend";
import { entryKey, shardOf, type Entries, type Entry } from "./collection";
import type { Deck, WishItem } from "./decks";

// A Firebase web config is public by design: it identifies the project. Access is controlled
// by firestore.rules and by the authorized domains set in the Firebase console.
const config = {
  apiKey: "AIzaSyARomzoC_hKnwZT1clu269OJOESeMKEcok",
  authDomain: "manabin-85e10.firebaseapp.com",
  projectId: "manabin-85e10",
  storageBucket: "manabin-85e10.firebasestorage.app",
  messagingSenderId: "1039322668953",
  appId: "1:1039322668953:web:fbdbdb45bbeaf9c25d3d08",
};

// `VITE_FIREBASE_EMULATOR=1 npm run build` talks to local Firebase emulators instead (for tests).
const EMULATOR = !!import.meta.env.VITE_FIREBASE_EMULATOR;

const toAccount = (u: User): Account => ({
  // A guest account linked to Google can keep empty top-level fields; the Google profile has them.
  uid: u.uid, isAnonymous: u.isAnonymous,
  name: u.displayName || u.providerData.find((d) => d.displayName)?.displayName,
  email: u.email || u.providerData.find((d) => d.email)?.email,
  photo: u.photoURL || u.providerData.find((d) => d.photoURL)?.photoURL,
});

const GUESTS_OFF = new Set(["auth/admin-restricted-operation", "auth/operation-not-allowed"]);

const friendly = (e: unknown): Error => {
  const code = (e as AuthError)?.code || "";
  if (GUESTS_OFF.has(code)) return new Error("That sign-in method isn't switched on in the Firebase console.");
  if (code === "auth/unauthorized-domain") return new Error(`Sign-in isn't allowed from ${location.hostname}. Add it to the authorized domains in the Firebase console.`);
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return new Error("Sign-in was cancelled.");
  if (code === "auth/popup-blocked") return new Error("The sign-in window was blocked. Allow pop-ups for this site and try again.");
  if (code === "permission-denied") return new Error("You don't have access to that. If it's a friend's collection, they may have stopped sharing it.");
  return e instanceof Error ? e : new Error(String(e));
};

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
export const friendshipId = (a: string, b: string) => [a, b].sort().join("_");

export function firebaseBackend(): Backend {
  const app = initializeApp(EMULATOR ? { ...config, projectId: "demo-manabin" } : config);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: EMULATOR ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  if (EMULATOR) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    // Browser tests sign in as a made-up Google user; the auth emulator accepts unsigned tokens.
    (globalThis as Record<string, unknown>).__manabinTestSignIn = async (name: string, email: string) => {
      const credential = GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, name, email_verified: true }));
      const u = auth.currentUser;
      if (u?.isAnonymous) {
        await linkWithCredential(u, credential);
        await u.reload();
      } else await signInWithCredential(auth, credential);
    };
  }

  async function write(uid: string, changes: Changes) {
    const shards = new Map<string, Record<string, unknown>>();
    const field = (shard: string) => {
      if (!shards.has(shard)) shards.set(shard, {});
      return shards.get(shard)!;
    };
    for (const key of changes.remove) field(shardOf(key))[key] = deleteField();
    for (const e of changes.set) field(shardOf(e.p))[entryKey(e)] = e;
    const batch = writeBatch(db);
    for (const [shard, entries] of shards) {
      batch.set(doc(db, "users", uid, "collection", shard), { entries }, { merge: true });
    }
    // Resolves once the server has the change; the local cache (and the UI) update right away.
    try {
      await batch.commit();
    } catch (e) {
      throw friendly(e);
    }
  }

  /** Adds `incoming` to the account's collection, summing quantities of matching entries. */
  async function mergeInto(uid: string, incoming: Entry[]) {
    const existing = await new Promise<Entries>((resolve, reject) => {
      const stop = onSnapshot(collection(db, "users", uid, "collection"), (snap) => {
        if (snap.metadata.fromCache) return; // wait for the server's copy
        stop();
        const out: Entries = new Map();
        for (const d of snap.docs) for (const [k, e] of Object.entries((d.data().entries || {}) as Record<string, Entry>)) out.set(k, e);
        resolve(out);
      }, reject);
    });
    const set = incoming.map((e) => {
      const cur = existing.get(entryKey(e));
      return cur ? { ...cur, q: cur.q + e.q } : e;
    });
    await write(uid, { set, remove: [] });
  }

  const social: Social = {
    async ensureProfile(a) {
      if (a.isAnonymous) throw new Error("Sign in with Google to use friends.");
      const ref = doc(db, "profiles", a.uid);
      const snap = await getDoc(ref);
      const name = a.name || "ManaBin player";
      if (snap.exists()) {
        const p = snap.data() as Profile;
        // Keep the name and photo in step with the Google account.
        if (p.name !== name || (p.photo || null) !== (a.photo || null)) await updateDoc(ref, { name, photo: a.photo || null });
        return { ...p, uid: a.uid, name, photo: a.photo || null };
      }
      for (let tries = 0; tries < 5; tries++) {
        const code = newCode();
        try {
          await setDoc(doc(db, "codes", code), { uid: a.uid }); // the rules refuse an existing code
        } catch {
          continue;
        }
        const p: Profile = { uid: a.uid, name, photo: a.photo || null, code };
        await setDoc(ref, { name: p.name, photo: p.photo, code, created: serverTimestamp() });
        return p;
      }
      throw new Error("Couldn't create a friend code. Try again.");
    },

    async findByCode(code) {
      const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (c.length !== 6) return null;
      const snap = await getDoc(doc(db, "codes", c));
      if (!snap.exists()) return null;
      const uid = snap.data().uid as string;
      const p = await getDoc(doc(db, "profiles", uid));
      return p.exists() ? ({ ...(p.data() as Profile), uid }) : null;
    },

    watchFriendships(uid, cb, onError) {
      return onSnapshot(query(collection(db, "friendships"), where("members", "array-contains", uid)), (snap) => {
        cb(snap.docs.map((d) => ({ ...(d.data() as Omit<Friendship, "id">), id: d.id })));
      }, (e) => onError(friendly(e)));
    },

    async request(me, them) {
      if (me.uid === them.uid) throw new Error("That's your own friend code.");
      const id = friendshipId(me.uid, them.uid);
      try {
        await setDoc(doc(db, "friendships", id), {
          members: [me.uid, them.uid].sort(), from: me.uid, status: "pending",
          names: { [me.uid]: me.name, [them.uid]: them.name },
          photos: { [me.uid]: me.photo || null, [them.uid]: them.photo || null },
          sharing: {}, created: serverTimestamp(),
        });
      } catch (e) {
        if ((e as { code?: string }).code === "permission-denied") throw new Error("You're already friends, or a request between you is waiting.");
        throw friendly(e);
      }
    },

    async accept(f) {
      await updateDoc(doc(db, "friendships", f.id), { status: "accepted" }).catch((e) => { throw friendly(e); });
    },

    async remove(f, me) {
      const other = f.members.find((m) => m !== me)!;
      // Stop sharing my collection and decks with them before the friendship goes.
      await setDoc(doc(db, "users", me, "sharing", "collection"), { viewers: arrayRemove(other) }, { merge: true });
      const shared = await getDocs(query(collection(db, "users", me, "decks"), where("sharedWith", "array-contains", other)));
      await Promise.all(shared.docs.map((d) => updateDoc(d.ref, { sharedWith: arrayRemove(other) })));
      await deleteDoc(doc(db, "friendships", f.id)).catch((e) => { throw friendly(e); });
    },

    async setSharing(f, me, on) {
      const other = f.members.find((m) => m !== me)!;
      await setDoc(doc(db, "users", me, "sharing", "collection"), { viewers: on ? arrayUnion(other) : arrayRemove(other) }, { merge: true });
      await updateDoc(doc(db, "friendships", f.id), { [`sharing.${me}`]: on }).catch((e) => { throw friendly(e); });
    },
  };

  return {
    kind: "firebase",
    social,

    onAccount(cb, onError) {
      // onIdTokenChanged (not onAuthStateChanged) also fires when a guest account is linked to Google.
      return onIdTokenChanged(auth, (u) => {
        if (u) return cb(toAccount(u));
        signInAnonymously(auth).catch((e) => {
          // Guest accounts are switched off for this project: wait for Google sign-in instead.
          if (GUESTS_OFF.has((e as AuthError).code)) cb(null);
          else onError(friendly(e));
        });
      }, (e) => onError(friendly(e)));
    },

    async signInWithGoogle(guestEntries: Entries) {
      const provider = new GoogleAuthProvider();
      const current = auth.currentUser;
      try {
        if (current?.isAnonymous) {
          try {
            // Turns the guest account into a Google account, keeping its collection.
            await linkWithPopup(current, provider);
            await current.reload();
            return { merged: 0 };
          } catch (e) {
            if ((e as AuthError).code !== "auth/credential-already-in-use") throw e;
            // This Google account already has a ManaBin collection: switch to it and add the guest's cards.
            const credential = GoogleAuthProvider.credentialFromError(e as AuthError);
            if (!credential) throw e;
            const { user } = await signInWithCredential(auth, credential);
            const incoming: Entry[] = [...guestEntries.values()];
            if (incoming.length) await mergeInto(user.uid, incoming);
            return { merged: incoming.length };
          }
        }
        await signInWithPopup(auth, provider);
        return { merged: 0 };
      } catch (e) {
        throw friendly(e);
      }
    },

    async signOut() {
      await signOut(auth); // onIdTokenChanged then starts a fresh guest account, if allowed
    },

    subscribe(uid, cb, onError) {
      return onSnapshot(collection(db, "users", uid, "collection"), { includeMetadataChanges: true }, (snap) => {
        const entries: Entries = new Map();
        for (const d of snap.docs) {
          const data = d.data().entries as Record<string, Entry> | undefined;
          for (const [k, e] of Object.entries(data || {})) entries.set(k, e);
        }
        cb(entries, snap.metadata.hasPendingWrites);
      }, (e) => onError(friendly(e)));
    },

    write,

    watchBinders(uid, cb, onError) {
      return onSnapshot(doc(db, "users", uid, "meta", "binders"), (snap) => {
        cb(((snap.data()?.names as string[]) || []).filter((n) => typeof n === "string"));
      }, (e) => onError(friendly(e)));
    },

    async setBinders(uid, names) {
      await setDoc(doc(db, "users", uid, "meta", "binders"), { names }).catch((e) => { throw friendly(e); });
    },

    watchDecks(uid, cb, onError) {
      return onSnapshot(collection(db, "users", uid, "decks"), (snap) => {
        cb(snap.docs.map((d) => toDeck(d.id, d.data())));
      }, (e) => onError(friendly(e)));
    },

    watchSharedDecks(owner, me, cb, onError) {
      return onSnapshot(query(collection(db, "users", owner, "decks"), where("sharedWith", "array-contains", me)), (snap) => {
        cb(snap.docs.map((d) => toDeck(d.id, d.data())));
      }, (e) => onError(friendly(e)));
    },

    async saveDeck(uid, deck) {
      const { id, ...data } = deck;
      // Resolves once the server has it; the local cache (and the UI) update right away.
      await setDoc(doc(db, "users", uid, "decks", id), data).catch((e) => { throw friendly(e); });
    },

    watchWishlist(uid, cb, onError) {
      return onSnapshot(doc(db, "users", uid, "meta", "wishlist"), (snap) => {
        cb(((snap.data()?.items as WishItem[]) || []).filter((w) => w && typeof w.o === "string"));
      }, (e) => onError(friendly(e)));
    },

    async setWishlist(uid, items) {
      await setDoc(doc(db, "users", uid, "meta", "wishlist"), { items }).catch((e) => { throw friendly(e); });
    },

    async deleteDeck(uid, id) {
      await deleteDoc(doc(db, "users", uid, "decks", id)).catch((e) => { throw friendly(e); });
    },
  };
}

const toDeck = (id: string, d: Record<string, unknown>): Deck => ({
  id,
  name: String(d.name || "Untitled deck"),
  format: String(d.format ?? ""),
  cards: Array.isArray(d.cards) ? (d.cards as Deck["cards"]) : [],
  sharedWith: Array.isArray(d.sharedWith) ? (d.sharedWith as string[]) : [],
  notes: typeof d.notes === "string" ? d.notes : undefined,
  updated: String(d.updated || ""),
});
