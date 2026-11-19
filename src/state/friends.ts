// Your public profile and friendships, live. Only the Firebase backend has friends.
import { useEffect, useState } from "preact/hooks";
import type { Friendship, Profile } from "../lib/backend";
import { useCollection } from "./collection";

export interface FriendsState {
  me: Profile | null;
  /** null until the first snapshot arrives */
  friendships: Friendship[] | null;
  error: string | null;
}

export function useFriends(): FriendsState {
  const { social, account } = useCollection();
  const [me, setMe] = useState<Profile | null>(null);
  const [friendships, setFriendships] = useState<Friendship[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const google = !!account && !account.isAnonymous;

  useEffect(() => {
    setMe(null);
    setFriendships(null);
    setError(null);
    if (!social || !account || !google) return;
    let live = true;
    social.ensureProfile(account).then((p) => live && setMe(p), (e) => live && setError((e as Error).message));
    const stop = social.watchFriendships(account.uid, (f) => live && setFriendships(f), (e) => live && setError(e.message));
    return () => { live = false; stop(); };
  }, [social, account?.uid, google]);

  return { me, friendships, error };
}

export const otherMember = (f: Friendship, me: string) => f.members.find((m) => m !== me)!;
