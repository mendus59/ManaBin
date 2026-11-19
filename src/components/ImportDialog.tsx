// Import a ManaBox CSV export or a ManaBin JSON backup into the collection.
import { useEffect, useRef, useState } from "preact/hooks";
import { lookupOracleIds } from "../lib/data";
import type { Entry } from "../lib/collection";
import { parseBackup, parseManaBoxCsv, rowsToEntries } from "../lib/transfer";
import { useCollection } from "../state/collection";

interface Preview {
  file: string;
  entries: Entry[];
  copies: number;
  problems: string[];
  binders: number;
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const col = useCollection();
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => { dialog.current!.showModal(); }, []);

  async function read(file: File) {
    setError(null);
    setDone(null);
    setPreview(null);
    setBusy("Reading the file…");
    try {
      const text = await file.text();
      let entries: Entry[], problems: string[] = [];
      if (/\.json$/i.test(file.name) || text.trimStart().startsWith("{")) {
        entries = parseBackup(text);
      } else {
        const parsed = parseManaBoxCsv(text);
        problems = parsed.problems;
        setBusy("Matching cards to the library…");
        const ids = await lookupOracleIds(parsed.rows.map((r) => r.printingId));
        const result = rowsToEntries(parsed.rows, ids, true);
        entries = result.entries;
        for (const r of result.unknown.slice(0, 20)) problems.push(`Line ${r.line}: ${r.name || r.printingId} isn't in the card library, skipped.`);
        if (result.unknown.length > 20) problems.push(`…and ${result.unknown.length - 20} more not in the library.`);
      }
      if (!entries.length && !problems.length) problems.push("No cards found in this file.");
      setPreview({
        file: file.name, entries, problems,
        copies: entries.reduce((n, e) => n + e.q, 0),
        binders: new Set(entries.map((e) => e.b).filter(Boolean)).size,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!preview) return;
    setBusy("Saving…");
    try {
      await col.importEntries(preview.entries, mode);
      setDone(`Imported ${preview.copies.toLocaleString()} cards from ${preview.file}.`);
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const existing = col.entries?.size || 0;

  return (
    <dialog ref={dialog} class="small-dialog" aria-label="Import cards" onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current!.close()}>
      <div class="dlg-body">
        <button type="button" class="close ghost" aria-label="Close" onClick={() => dialog.current!.close()}>✕</button>
        <h2>Import cards</h2>
        <p class="muted">
          Choose a ManaBox CSV export (in ManaBox: Collection → ⋯ → Export → CSV) or a ManaBin JSON backup.
          The exact printing, finish, condition, language, purchase price and binder of each card are kept.
        </p>
        <label class="file">
          <input type="file" accept=".csv,.json,text/csv,application/json"
            onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) read(f); }} />
        </label>

        {busy && <p role="status">{busy}</p>}
        {error && <p class="error" role="alert">{error}</p>}
        {done && <p class="ok" role="status">{done}</p>}

        {preview && (
          <div class="preview">
            <p>
              <strong>{preview.copies.toLocaleString()} cards</strong> in {preview.entries.length.toLocaleString()} lines
              {preview.binders ? `, from ${preview.binders} binder${preview.binders === 1 ? "" : "s"}` : ""}.
            </p>
            {preview.problems.length > 0 && (
              <details>
                <summary>{preview.problems.length} line{preview.problems.length === 1 ? "" : "s"} skipped</summary>
                <ul class="problems">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            {existing > 0 && (
              <fieldset class="mode">
                <label><input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} /> Add to my collection</label>
                <label><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace my collection</label>
              </fieldset>
            )}
            <button type="button" class="primary" disabled={!preview.entries.length || !!busy} onClick={run}>
              {mode === "replace" && existing ? "Replace collection" : "Import"}
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
