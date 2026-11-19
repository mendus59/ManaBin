// Scanning cards with the camera: continuous scanning into a pending list, fixing each card's
// finish, condition or printing with a tap, then saving the lot to a binder.
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SignInPrompt } from "../components/SignInPrompt";
import { images, type Card, type Printing, type SetInfo } from "../lib/cards";
import { CONDITIONS, FINISH_LABELS, LANGUAGES, today, type Condition, type Finish } from "../lib/collection";
import { loadPrintings, loadSets } from "../lib/data";
import { grab, readText, startReader } from "../lib/ocr";
import { addPending, nameMatcher, pickPrinting, readCollectorLine, toEntries, type NameMatch, type PendingCard } from "../lib/scan";
import { useCollection } from "../state/collection";
import { pageShell, useLibrary } from "./DecksView";

const PENDING_KEY = "manabin-scan-pending";
const BINDER_KEY = "manabin-scan-binder";
const SOUND_KEY = "manabin-scan-sound";

const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the list just won't survive a reload */ }
  },
};

const newId = () => Math.random().toString(36).slice(2, 10);

/** A pending card for this printing, with the finish and language the scan suggests. */
function pendingFor(card: Card, printing: Printing, sure: boolean, hint?: { lang?: string }): PendingCard {
  const finishes = (printing.finishes || ["nonfoil"]).filter((f) => f in FINISH_LABELS);
  const f = (finishes.includes("nonfoil") ? "nonfoil" : finishes[0] || "nonfoil") as Finish;
  return {
    id: newId(), o: card.oracle_id!, n: card.name, p: printing.id, set: printing.set, num: printing.collector_number,
    img: printing.img, finishes, f, c: "NM", l: hint?.lang || printing.lang || "en", q: 1, sure,
  };
}

export function ScanView({ nav }: { nav: ComponentChildren }) {
  const col = useCollection();
  const { lib, error } = useLibrary();
  const [pending, setPendingState] = useState<PendingCard[]>(() => store.get(PENDING_KEY, []));
  const [binder, setBinderState] = useState<string>(() => store.get(BINDER_KEY, ""));
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const [sets, setSets] = useState<Map<string, SetInfo>>(new Map());
  const match = useMemo(() => (lib ? nameMatcher(lib.cards) : null), [lib]);

  useEffect(() => { loadSets().then(setSets); }, []);

  const setPending = (f: (cur: PendingCard[]) => PendingCard[]) =>
    setPendingState((cur) => { const next = f(cur); store.set(PENDING_KEY, next); return next; });
  const setBinder = (b: string) => { setBinderState(b); store.set(BINDER_KEY, b); };

  const add = (item: PendingCard) => { setSaved(""); setPending((cur) => addPending(cur, item)); };
  const update = (id: string, patch: Partial<PendingCard>) =>
    setPending((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)).filter((x) => x.q > 0));

  const total = pending.reduce((n, x) => n + x.q, 0);
  const save = async () => {
    if (!total) return;
    setSaving(true);
    try {
      await col.importEntries(toEntries(pending, binder, today()), "merge");
      if (binder && !col.binders.includes(binder)) await col.addBinder(binder);
      setPending(() => []);
      setSaved(`Saved ${total} card${total === 1 ? "" : "s"}${binder ? ` to ${binder}` : " to your collection"}.`);
    } catch {
      // the error banner says what went wrong; the list stays so nothing is lost
    }
    setSaving(false);
  };

  if (error) return pageShell(nav, <div class="notice"><p><strong>The card library isn't available.</strong></p><p class="muted">{error}</p></div>);

  return pageShell(nav, (
    <>
      <div class="toolbar"><h2 class="page-title">Scan cards</h2></div>
      <div class="scan-layout">
        <div class="scan-left">
          {match ? <Camera match={match} onScan={add} onRefine={(id, patch) => update(id, patch)} /> : <p class="empty">Loading the card library…</p>}
          {match && <TypeName match={match} onAdd={add} />}
        </div>
        <div class="scan-right">
          <div class="pending-head">
            <h3>Scanned <span class="muted">· {total} card{total === 1 ? "" : "s"}</span></h3>
            {pending.length > 0 && <button type="button" class="ghost small" onClick={() => setPending(() => [])}>Clear</button>}
          </div>
          {saved && <p class="saved-note" role="status">{saved} <a href="#/collection">See your collection</a></p>}
          {pending.length === 0 ? (
            <p class="muted">Cards you scan show up here. Tap one to fix its printing, finish or condition, then save them all to a binder.</p>
          ) : (
            <ul class="pending">
              {pending.map((x) => <PendingRow key={x.id} item={x} sets={sets} onChange={(patch) => update(x.id, patch)} />)}
            </ul>
          )}
          {pending.length > 0 && (col.signedOut ? (
            <SignInPrompt compact why="Sign in with Google to save these cards." />
          ) : (
            <div class="save-bar">
              <BinderPick value={binder} binders={col.binders} onChange={setBinder} />
              <button type="button" class="primary" disabled={saving || !col.entries} onClick={save}>
                {saving ? "Saving…" : `Save ${total} card${total === 1 ? "" : "s"}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  ), "scan-page");
}

// ---------- the camera ----------

/** Where the name bar and the collector line sit on a card, as fractions of its width and height. */
// Both are generous, so a card held a little off the guide still reads.
const NAME_BOX = { x: 0.02, y: 0, w: 0.82, h: 0.16 };
const INFO_BOX = { x: 0, y: 0.875, w: 0.62, h: 0.125 };

type CameraState = "off" | "starting" | "on" | "denied" | "unsupported";

function Camera({ match, onScan, onRefine }: {
  match: (text: string) => NameMatch | null;
  onScan: (item: PendingCard) => void;
  onRefine: (id: string, patch: Partial<PendingCard>) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<CameraState>(() => (typeof navigator.mediaDevices?.getUserMedia === "function" ? "off" : "unsupported"));
  const [status, setStatus] = useState("");
  const [last, setLast] = useState<{ name: string; sure: boolean } | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [sound, setSound] = useState(() => store.get(SOUND_KEY, true));
  const stream = useRef<MediaStream | null>(null);
  const live = useRef(false);
  const cb = useRef({ match, onScan, onRefine, sound });
  cb.current = { match, onScan, onRefine, sound };

  const stop = () => {
    live.current = false;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setTorch(null);
  };
  useEffect(() => stop, []);
  // Stop the camera when the app goes to the background; start it again on return.
  useEffect(() => {
    const onVis = () => { if (document.hidden && live.current) { stop(); setState("off"); setStatus("Paused. Tap Start scanning to carry on."); } };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const start = async () => {
    setState("starting");
    setStatus("Starting the camera…");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      stream.current = s;
      const track = s.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      if (caps.focusMode?.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
      setTorch(caps.torch ? false : null);
      const v = video.current!;
      v.srcObject = s;
      await v.play().catch(() => {});
      setState("on");
      setStatus("Getting the text reader ready…");
      await startReader((what, p) => setStatus(what.startsWith("loading") ? `Getting the text reader ready… ${Math.round(p * 100)}%` : "Getting the text reader ready…"));
      live.current = true;
      setStatus("Hold a card inside the frame, name at the top.");
      loop();
    } catch (e) {
      stop();
      const name = (e as DOMException).name;
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "off");
      setStatus(name === "NotAllowedError" ? "" : `Couldn't start scanning: ${(e as Error).message || e}`);
    }
  };

  const toggleTorch = () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch == null) return;
    track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).then(() => setTorch(!torch)).catch(() => setTorch(null));
  };

  /** The guide frame in video pixels (the video fills its box with object-fit: cover). */
  const cardRect = () => {
    const v = video.current!, g = guide.current!;
    const vr = v.getBoundingClientRect(), gr = g.getBoundingClientRect();
    const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
    const offX = (vr.width - v.videoWidth * scale) / 2, offY = (vr.height - v.videoHeight * scale) / 2;
    return { x: (gr.left - vr.left - offX) / scale, y: (gr.top - vr.top - offY) / scale, w: gr.width / scale, h: gr.height / scale };
  };
  const region = (card: ReturnType<typeof cardRect>, b: typeof NAME_BOX) => ({ x: card.x + b.x * card.w, y: card.y + b.y * card.h, w: b.w * card.w, h: b.h * card.h });

  const loop = async () => {
    const nameCanvas = document.createElement("canvas");
    const infoCanvas = document.createElement("canvas");
    let locked: string | null = null;      // the card in the frame, already added
    let lockedItem: { id: string; tries: number; prints: Printing[] } | null = null;
    let misses = 0;
    let seen: string[] = [];
    let lastSet: string | undefined;
    while (live.current) {
      const v = video.current;
      if (!v || !v.videoWidth) { await new Promise((r) => setTimeout(r, 200)); continue; }
      try {
        const card = cardRect();
        const { text } = await readText(grab(v, region(card, NAME_BOX), 128, nameCanvas), "block");
        if (!live.current) break;
        const m = cb.current.match(text);
        // For testing: set window.__manabinScanDebug = true to log what the reader sees.
        const dbg = (globalThis as { __manabinScanDebug?: { crops: string[] } | true }).__manabinScanDebug;
        if (dbg) {
          console.log("[scan]", JSON.stringify(text), m ? `${m.card.name} ${m.score.toFixed(2)}` : "-");
          if (dbg !== true) dbg.crops[0] = nameCanvas.toDataURL();
        }
        if (!m) {
          if (++misses >= 2) { locked = null; lockedItem = null; seen = []; }
        } else {
          misses = 0;
          const o = m.card.oracle_id!;
          if (o === locked) {
            // Still the same card: read the collector line again if the printing is a guess.
            if (lockedItem && lockedItem.tries < 3) {
              lockedItem.tries++;
              const line = readCollectorLine((await readText(grab(v, region(card, INFO_BOX), 200, infoCanvas, true), "sparse")).text);
              const pick = pickPrinting(lockedItem.prints, line, lastSet);
              if (pick?.sure) {
                const item = pendingFor(m.card, pick.printing, true, line);
                cb.current.onRefine(lockedItem.id, { p: item.p, set: item.set, num: item.num, img: item.img, finishes: item.finishes, f: item.f, l: item.l, sure: true });
                setLast({ name: m.card.name, sure: true });
                lastSet = pick.printing.set;
                lockedItem = null;
              }
            }
          } else {
            seen = [...seen.slice(-2), o];
            if (m.score >= 0.97 || seen.filter((x) => x === o).length >= 2) {
              const [line, prints] = await Promise.all([
                readText(grab(v, region(card, INFO_BOX), 200, infoCanvas, true), "sparse").then((r) => {
                  if (dbg) {
                    console.log("[scan] info", JSON.stringify(r.text));
                    if (dbg !== true) dbg.crops[1] = infoCanvas.toDataURL();
                  }
                  return readCollectorLine(r.text);
                }),
                loadPrintings(o),
              ]);
              const pick = pickPrinting(prints, line, lastSet);
              if (pick && live.current) {
                const item = pendingFor(m.card, pick.printing, pick.sure, line);
                cb.current.onScan(item);
                if (pick.sure) lastSet = pick.printing.set;
                locked = o;
                lockedItem = pick.sure ? null : { id: item.id, tries: 0, prints };
                setLast({ name: m.card.name, sure: pick.sure });
                setStatus("added. Next card!");
                navigator.vibrate?.(40);
                if (cb.current.sound) beep();
              }
            }
          }
        }
      } catch (e) {
        setStatus(`Reading failed: ${(e as Error).message || e}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  return (
    <div class="camera">
      <div class={`viewfinder ${state}`}>
        <video ref={video} playsInline muted autoPlay />
        <div class="guide" ref={guide} aria-hidden="true"><span class="guide-name" /><span class="guide-info" /></div>
        {state !== "on" && state !== "starting" && (
          <div class="viewfinder-msg">
            {state === "unsupported" && <p>This browser can't use the camera. Type card names below instead.</p>}
            {state === "denied" && <p>Camera access is blocked. Allow the camera for this site in your browser settings, then try again.</p>}
            {state !== "unsupported" && <button type="button" class="primary" onClick={start}>Start scanning</button>}
          </div>
        )}
      </div>
      <div class="camera-bar">
        <p class="scan-status" role="status" aria-live="polite">
          {last && <span class={last.sure ? "last sure" : "last"}>{last.name}</span>}
          {status}
        </p>
        <span class="actions">
          {torch != null && <button type="button" class="ghost small" aria-pressed={torch} onClick={toggleTorch}>{torch ? "Light off" : "Light"}</button>}
          <button type="button" class="ghost small" aria-pressed={sound} onClick={() => { setSound(!sound); store.set(SOUND_KEY, !sound); }}>{sound ? "Sound on" : "Sound off"}</button>
          {state === "on" && <button type="button" class="ghost small" onClick={() => { stop(); setState("off"); setStatus(""); }}>Stop</button>}
        </span>
      </div>
    </div>
  );
}

let audio: AudioContext | null = null;
function beep() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.12);
  } catch { /* no sound available */ }
}

// ---------- typing a name instead ----------

function TypeName({ match, onAdd }: { match: (text: string) => NameMatch | null; onAdd: (item: PendingCard) => void }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const submit = async (e: Event) => {
    e.preventDefault();
    const m = match(text);
    if (!m) { setNote(`No card called “${text.trim()}”.`); return; }
    const pick = pickPrinting(await loadPrintings(m.card.oracle_id!), null);
    if (!pick) { setNote(`No printings of ${m.card.name} in the library.`); return; }
    onAdd(pendingFor(m.card, pick.printing, false));
    setNote("");
    setText("");
  };
  return (
    <form class="type-name" onSubmit={submit}>
      <input type="search" aria-label="Card name" placeholder="Or type a card name" value={text} autoComplete="off"
        onInput={(e) => setText(e.currentTarget.value)} />
      <button type="submit" class="ghost" disabled={!text.trim()}>Add</button>
      {note && <span class="muted">{note}</span>}
    </form>
  );
}

// ---------- the pending list ----------

function PendingRow({ item: x, sets, onChange }: { item: PendingCard; sets: Map<string, SetInfo>; onChange: (p: Partial<PendingCard>) => void }) {
  const [open, setOpen] = useState(false);
  const [prints, setPrints] = useState<Printing[] | null>(null);
  useEffect(() => { if (open && !prints) loadPrintings(x.o).then(setPrints); }, [open]);
  const img = images({ id: x.p, img: x.img }, "small")[0];
  const setName = sets.get(x.set)?.name || x.set.toUpperCase();
  const finishes = (x.finishes?.length ? x.finishes : ["nonfoil"]) as Finish[];

  const choose = (p: Printing) => {
    const fs = (p.finishes || ["nonfoil"]).filter((f) => f in FINISH_LABELS);
    onChange({ p: p.id, set: p.set, num: p.collector_number, img: p.img, finishes: fs, f: (fs.includes(x.f) ? x.f : fs[0] || "nonfoil") as Finish, sure: true });
  };

  return (
    <li class={`pending-row${open ? " open" : ""}`}>
      <button type="button" class="pending-main" aria-expanded={open} onClick={() => setOpen(!open)}>
        {img ? <img src={img} alt="" loading="lazy" width={46} height={64} /> : <span class="noimg" />}
        <span class="pending-text">
          <strong>{x.n}</strong>
          <span class="muted">
            {setName} · #{x.num}{x.f !== "nonfoil" ? ` · ${FINISH_LABELS[x.f]}` : ""}{x.c !== "NM" ? ` · ${x.c}` : ""}{x.l !== "en" ? ` · ${x.l.toUpperCase()}` : ""}
          </span>
          {!x.sure && <span class="check-me">Check the printing</span>}
        </span>
      </button>
      <span class="stepper">
        <button type="button" class="ghost" aria-label={`One fewer ${x.n}`} onClick={() => onChange({ q: x.q - 1 })}>−</button>
        <span class="q">{x.q}</span>
        <button type="button" class="ghost" aria-label={`One more ${x.n}`} onClick={() => onChange({ q: x.q + 1 })}>+</button>
      </span>
      {open && (
        <div class="pending-edit">
          <label>Printing
            {prints ? (
              <select value={x.p} onChange={(e) => { const p = prints.find((y) => y.id === e.currentTarget.value); if (p) choose(p); }}>
                {prints.map((p) => (
                  <option key={p.id} value={p.id}>
                    {sets.get(p.set)?.name || p.set.toUpperCase()} ({p.set.toUpperCase()}) #{p.collector_number}
                    {p.promo ? " · promo" : ""}{p.frame_effects?.includes("showcase") ? " · showcase" : ""}{p.full_art ? " · full art" : ""}
                    {p.border_color === "borderless" ? " · borderless" : ""}{p.released_at ? ` · ${p.released_at.slice(0, 4)}` : ""}
                  </option>
                ))}
              </select>
            ) : <select disabled><option>Loading…</option></select>}
          </label>
          <span class="seg" role="group" aria-label="Finish">
            {finishes.map((f) => (
              <button key={f} type="button" class={x.f === f ? "on" : ""} aria-pressed={x.f === f} onClick={() => onChange({ f })}>{FINISH_LABELS[f]}</button>
            ))}
          </span>
          <label>Condition
            <select value={x.c} onChange={(e) => onChange({ c: e.currentTarget.value as Condition })}>
              {CONDITIONS.map(([c, name]) => <option key={c} value={c}>{c} · {name}</option>)}
            </select>
          </label>
          <label>Language
            <select value={x.l} onChange={(e) => onChange({ l: e.currentTarget.value })}>
              {LANGUAGES.map(([c, name]) => <option key={c} value={c}>{name}</option>)}
            </select>
          </label>
          {!x.sure && <button type="button" class="ghost small" onClick={() => onChange({ sure: true })}>Printing is right</button>}
          <button type="button" class="ghost small danger" onClick={() => onChange({ q: 0 })}>Remove</button>
        </div>
      )}
    </li>
  );
}

function BinderPick({ value, binders, onChange }: { value: string; binders: string[]; onChange: (b: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const options = value && !binders.includes(value) ? [...binders, value] : binders;
  if (creating) {
    return (
      <form class="new-binder" onSubmit={(e) => { e.preventDefault(); const n = name.trim().slice(0, 60); if (n) onChange(n); setCreating(false); setName(""); }}>
        <input aria-label="New binder name" placeholder="Binder name" value={name} autoFocus onInput={(e) => setName(e.currentTarget.value)} />
        <button type="submit" class="ghost" disabled={!name.trim()}>OK</button>
        <button type="button" class="ghost" onClick={() => setCreating(false)}>Cancel</button>
      </form>
    );
  }
  return (
    <select aria-label="Binder to save to" value={value} onChange={(e) => {
      const v = e.currentTarget.value;
      if (v === "\u0000new") setCreating(true);
      else onChange(v);
    }}>
      <option value="">No binder</option>
      {options.map((b) => <option key={b} value={b}>{b}</option>)}
      <option value={"\u0000new"}>New binder…</option>
    </select>
  );
}
