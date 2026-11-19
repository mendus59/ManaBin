// Firebase backend: an automatic guest account per browser, optional Google sign-in to sync
// across devices, and the collection in Firestore with an offline cache in IndexedDB.
//
// Firestore layout (see firestore.rules):
//   users/{uid}/collection/{0-f}   { entries: { <entry key>: Entry } }
// Entries are spread over 16 documents by the first hex digit of the printing ID, so loading
// a collection costs 16 document reads however many cards it holds.
import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider, getAuth, linkWithPopup, onAuthStateChanged, signInAnonymously,
  signInWithCredential, signInWithPopup, signOut, type AuthError, type User,
} from "firebase/auth";
import {
  collection, deleteField, doc, initializeFirestore, onSnapshot, persistentLocalCache,
  persistentMultipleTabManager, writeBatch,
} from "firebase/firestore";
import type { Account, Backend, Changes } from "./backend";
import { entryKey, shardOf, type Entries, type Entry } from "./collection";

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

const toAccount = (u: User): Account => ({
  uid: u.uid, isAnonymous: u.isAnonymous, name: u.displayName, email: u.email, photo: u.photoURL,
});

const friendly = (e: unknown): Error => {
  const code = (e as AuthError)?.code || "";
  if (code === "auth/admin-restricted-operation" || code === "auth/operation-not-allowed") {
    return new Error("Sign-in isn't switched on for this site yet. In the Firebase console, enable the Anonymous and Google sign-in providers.");
  }
  if (code === "auth/unauthorized-domain") return new Error(`Sign-in isn't allowed from ${location.hostname}. Add it to the authorized domains in the Firebase console.`);
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return new Error("Sign-in was cancelled.");
  if (code === "auth/popup-blocked") return new Error("The sign-in window was blocked. Allow pop-ups for this site and try again.");
  if (code === "permission-denied") return new Error("The server refused access to this collection. Check the Firestore rules.");
  return e instanceof Error ? e : new Error(String(e));
};

export function firebaseBackend(): Backend {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });

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

  return {
    kind: "firebase",

    onAccount(cb, onError) {
      return onAuthStateChanged(auth, (u) => {
        if (u) cb(toAccount(u));
        else signInAnonymously(auth).catch((e) => onError(friendly(e)));
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
      await signOut(auth); // onAuthStateChanged then creates a fresh guest account
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
  };

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
}
