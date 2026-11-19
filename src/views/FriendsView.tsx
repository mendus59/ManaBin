// Friends: your friend code, adding friends, requests, and sharing your collection with them.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { SignInPrompt } from "../components/SignInPrompt";
import type { Friendship, Profile } from "../lib/backend";
import { useCollection } from "../state/collection";
import { otherMember, useFriends } from "../state/friends";

const inviteLink = (code: string) => `${location.origin}${location.pathname}#/friends/add/${code}`;

function Avatar({ name, photo }: { name: string; photo?: string | null }) {
  return photo
    ? <img class="avatar" src={photo} alt="" referrerpolicy="no-referrer" />
    : <span class="avatar" aria-hidden="true">{(name || "?").slice(0, 1).toUpperCase()}</span>;
}

export function FriendsView({ nav, addCode }: { nav: ComponentChildren; addCode: string }) {
  const col = useCollection();
  const page = (body: ComponentChildren) => (
    <>
      <header class="top"><div class="wrap"><div class="title-row"><div class="brand"><h1>ManaBin</h1>{nav}</div></div></div></header>
      <main class="wrap friends">{body}</main>
    </>
  );

  if (col.kind === "memory") return page(<div class="notice"><p>Friends need the Firebase build of ManaBin.</p></div>);
  if (col.signedOut || col.account?.isAnonymous) {
    return page(<SignInPrompt why="Sign in with Google to add friends and share your collection with them." />);
  }
  if (!col.account) return page(<p class="empty">Connecting…</p>);
  return page(<Friends uid={col.account.uid} addCode={addCode} />);
}

function Friends({ uid, addCode }: { uid: string; addCode: string }) {
  const { social } = useCollection();
  const { me, friendships, error } = useFriends();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = (id: string, fn: () => Promise<void>) => async () => {
    setBusy(id);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    }
    setBusy(null);
  };

  if (error) return <div class="notice"><p><strong>Friends aren't available right now.</strong></p><p>{error}</p></div>;
  if (!me || !friendships || !social) return <p class="empty">Loading your friends…</p>;

  const incoming = friendships.filter((f) => f.status === "pending" && f.from !== uid);
  const outgoing = friendships.filter((f) => f.status === "pending" && f.from === uid);
  const friends = friendships.filter((f) => f.status === "accepted")
    .sort((a, b) => (a.names[otherMember(a, uid)] || "").localeCompare(b.names[otherMember(b, uid)] || ""));
  const nameOf = (f: Friendship) => f.names[otherMember(f, uid)] || "ManaBin player";
  const photoOf = (f: Friendship) => f.photos?.[otherMember(f, uid)];

  return (
    <div class="friends-grid">
      <section class="panel">
        <h2>Your friend code</h2>
        <p class="friend-code" aria-label="Your friend code">{me.code}</p>
        <p class="muted">Friends add you with this code, or with your invite link. They see your name and picture, never your email.</p>
        <CopyButton text={inviteLink(me.code)} label="Copy invite link" />
      </section>

      <AddFriend me={me} initial={addCode} friendships={friendships} />

      {actionError && <p class="error" role="alert">{actionError}</p>}

      {incoming.length > 0 && (
        <section class="panel">
          <h2>Friend requests</h2>
          <ul class="people">
            {incoming.map((f) => (
              <li key={f.id}>
                <Avatar name={nameOf(f)} photo={photoOf(f)} />
                <span class="who">{nameOf(f)}</span>
                <span class="actions">
                  <button type="button" class="primary" disabled={!!busy} onClick={act(f.id, () => social.accept(f))}>Accept</button>
                  <button type="button" class="ghost" disabled={!!busy} onClick={act(f.id, () => social.remove(f, uid))}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="panel wide">
        <h2>Friends</h2>
        {friends.length === 0 ? (
          <p class="muted">No friends yet. Send someone your invite link, or add them with their code.</p>
        ) : (
          <ul class="people">
            {friends.map((f) => {
              const other = otherMember(f, uid);
              const theyShare = !!f.sharing?.[other];
              const iShare = !!f.sharing?.[uid];
              return (
                <li key={f.id}>
                  <Avatar name={nameOf(f)} photo={photoOf(f)} />
                  <span class="who">
                    {nameOf(f)}
                    <span class="muted small">{theyShare ? " · shares their collection with you" : " · isn't sharing their collection"}</span>
                  </span>
                  <span class="actions">
                    {theyShare && <a class="ghost button" href={`#/friends/${encodeURIComponent(other)}`}>View collection</a>}
                    <ShareToggle on={iShare} disabled={!!busy} onChange={(on) => act(f.id, () => social.setSharing(f, uid, on))()} />
                    <RemoveButton disabled={!!busy} onRemove={act(f.id, () => social.remove(f, uid))} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p class="muted small">Decks can be shared with friends one by one once decks arrive.</p>
      </section>

      {outgoing.length > 0 && (
        <section class="panel">
          <h2>Requests you sent</h2>
          <ul class="people">
            {outgoing.map((f) => (
              <li key={f.id}>
                <Avatar name={nameOf(f)} photo={photoOf(f)} />
                <span class="who">{nameOf(f)} <span class="muted small">· waiting</span></span>
                <span class="actions">
                  <button type="button" class="ghost" disabled={!!busy} onClick={act(f.id, () => social.remove(f, uid))}>Cancel</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddFriend({ me, initial, friendships }: { me: Profile; initial: string; friendships: Friendship[] }) {
  const { social } = useCollection();
  const [code, setCode] = useState(initial);
  const [found, setFound] = useState<Profile | null>(null);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);

  const lookUp = async (c: string) => {
    setFound(null);
    setStatus({});
    if (!c.trim()) return;
    setBusy(true);
    try {
      const p = await social!.findByCode(c);
      if (!p) setStatus({ error: "No one has that friend code. Check it and try again." });
      else if (p.uid === me.uid) setStatus({ error: "That's your own friend code." });
      else setFound(p);
    } catch (e) {
      setStatus({ error: (e as Error).message });
    }
    setBusy(false);
  };

  // An invite link fills in the code and looks it up straight away.
  useEffect(() => {
    if (initial) {
      setCode(initial);
      lookUp(initial);
    }
  }, [initial]);

  const existing = found && friendships.find((f) => f.members.includes(found.uid));

  return (
    <section class="panel">
      <h2>Add a friend</h2>
      <form class="add-friend" onSubmit={(e) => { e.preventDefault(); lookUp(code); }}>
        <input aria-label="Friend code" placeholder="Friend code, e.g. K7Q2MX" value={code} maxLength={12}
          autocapitalize="characters" spellcheck={false}
          onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} />
        <button type="submit" class="ghost" disabled={busy || !code.trim()}>{busy && !found ? "Looking…" : "Find"}</button>
      </form>
      {found && (
        <div class="found">
          <Avatar name={found.name} photo={found.photo} />
          <span class="who">{found.name}</span>
          {existing ? (
            <span class="muted">{existing.status === "accepted" ? "Already your friend" : "Request waiting"}</span>
          ) : (
            <button type="button" class="primary" disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await social!.request(me, found);
                  setStatus({ ok: `Request sent to ${found.name}.` });
                  setFound(null);
                  setCode("");
                  if (location.hash.startsWith("#/friends/add")) history.replaceState(null, "", location.pathname + "#/friends");
                } catch (e) {
                  setStatus({ error: (e as Error).message });
                }
                setBusy(false);
              }}>
              Send friend request
            </button>
          )}
        </div>
      )}
      {status.error && <p class="error">{status.error}</p>}
      {status.ok && <p class="ok">{status.ok}</p>}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" class="ghost" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      } catch {
        prompt("Copy this link:", text);
      }
    }}>
      {done ? "Copied" : label}
    </button>
  );
}

function RemoveButton({ onRemove, disabled }: { onRemove: () => void; disabled: boolean }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(t);
  }, [sure]);
  return (
    <button type="button" class={sure ? "ghost danger" : "ghost"} disabled={disabled}
      onClick={() => (sure ? onRemove() : setSure(true))}>
      {sure ? "Remove friend?" : "Remove"}
    </button>
  );
}

/** Shows the new setting straight away, and the saved one once the change lands (or fails). */
function ShareToggle({ on, disabled, onChange }: { on: boolean; disabled: boolean; onChange: (on: boolean) => Promise<void> }) {
  const [want, setWant] = useState<boolean | null>(null);
  return (
    <label class="switch" title="Let this friend see your collection">
      <input type="checkbox" checked={want ?? on} disabled={disabled}
        onChange={async (e) => {
          const next = e.currentTarget.checked;
          setWant(next);
          await onChange(next);
          setWant(null);
        }} />
      Share my collection
    </label>
  );
}
