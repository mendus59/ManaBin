// Shown in place of the collection, friends and the add-to-collection form when nobody is signed in.
import { useState } from "preact/hooks";
import { useCollection } from "../state/collection";

export function SignInPrompt({ why, compact }: { why: string; compact?: boolean }) {
  const col = useCollection();
  const [busy, setBusy] = useState(false);
  const button = (
    <button type="button" class="primary" disabled={busy}
      onClick={async () => {
        setBusy(true);
        await col.signIn();
        setBusy(false);
      }}>
      {busy ? "Signing in…" : "Sign in with Google"}
    </button>
  );
  if (compact) return <p class="sign-in-inline"><span class="muted">{why}</span> {button}</p>;
  return (
    <div class="notice empty-collection">
      <p><strong>Sign in to continue.</strong></p>
      <p>{why}</p>
      {button}
    </div>
  );
}
