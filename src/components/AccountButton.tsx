// Header control showing who is signed in, with Google sign-in for guests.
import { useState } from "preact/hooks";
import { useCollection } from "../state/collection";

export function AccountButton() {
  const col = useCollection();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const a = col.account;

  if (col.kind === "memory") return <span class="account muted" title="This build keeps your collection in this browser only">Saved in this browser</span>;
  if (!a) return <span class="account muted">{col.error ? "Offline" : "Connecting…"}</span>;

  if (a.isAnonymous) {
    return (
      <span class="account">
        <span class="muted" title="Your collection is saved to a guest account on this device">Guest</span>
        <button type="button" class="ghost small" disabled={busy}
          title="Keep your collection in your Google account and use it on any device"
          onClick={async () => {
            setBusy(true);
            setNote(await col.signIn());
            setBusy(false);
          }}>
          {busy ? "Signing in…" : "Sign in with Google"}
        </button>
        {note && <span class="toast" role="status" onClick={() => setNote(null)}>{note}</span>}
      </span>
    );
  }

  return (
    <details class="account menu">
      <summary title={a.email || undefined}>
        {a.photo ? <img src={a.photo} alt="" referrerpolicy="no-referrer" /> : null}
        <span>{a.name || a.email || "Signed in"}</span>
        {col.pending && <span class="muted" title="Changes are saved on this device and will sync when you're online"> · syncing</span>}
      </summary>
      <div class="menu-body">
        <p class="muted">{a.email}</p>
        <button type="button" class="ghost" onClick={() => col.signOut()}>Sign out</button>
        <p class="muted small">Signing out leaves your collection in your Google account. This device starts a new, empty guest collection.</p>
      </div>
    </details>
  );
}
