// Import and export: ManaBox CSV and ManaBin's own JSON backup.
import type { Card } from "./cards";
import { today, type Condition, type Entry, type Finish } from "./collection.ts";

// ---------- CSV ----------

/** Parses CSV with quoted fields (RFC 4180), returning rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

// ---------- ManaBox ----------

const MANABOX_CONDITIONS: Record<string, Condition> = {
  mint: "NM", near_mint: "NM", excellent: "LP", lightly_played: "LP", light_played: "LP",
  good: "MP", moderately_played: "MP", played: "HP", heavily_played: "HP", poor: "DMG", damaged: "DMG",
};
const CONDITION_TO_MANABOX: Record<Condition, string> = {
  NM: "near_mint", LP: "excellent", MP: "good", HP: "played", DMG: "poor",
};

export interface ImportRow {
  line: number;
  name: string;
  printingId: string;
  finish: Finish;
  condition: Condition;
  language: string;
  qty: number;
  purchasePrice?: number;
  binder?: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  problems: string[];
}

/** Reads a ManaBox CSV export (or a ManaBin CSV export, which uses the same columns). */
export function parseManaBoxCsv(text: string): ParsedImport {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], problems: ["The file is empty."] };
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const idx = {
    id: col("Scryfall ID"), name: col("Name"), foil: col("Foil"), qty: col("Quantity"), cond: col("Condition"),
    lang: col("Language"), price: col("Purchase price"), binder: col("Binder Name"),
  };
  if (idx.id < 0) return { rows: [], problems: ['This doesn\'t look like a ManaBox export: there is no "Scryfall ID" column.'] };
  const rows: ImportRow[] = [], problems: string[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] || "").trim() : "");
    const id = get("id").toLowerCase();
    const name = get("name");
    if (!/^[0-9a-f-]{36}$/.test(id)) { problems.push(`Line ${line}: no Scryfall ID for ${name || "a card"}, skipped.`); return; }
    const foil = get("foil").toLowerCase();
    const qty = parseInt(get("qty") || "1", 10);
    const price = parseFloat(get("price"));
    rows.push({
      line, name, printingId: id,
      finish: foil === "foil" ? "foil" : foil === "etched" ? "etched" : "nonfoil",
      condition: MANABOX_CONDITIONS[get("cond").toLowerCase().replace(/[\s-]+/g, "_")] || "NM",
      language: (get("lang") || "en").toLowerCase(),
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      purchasePrice: Number.isFinite(price) && price > 0 ? price : undefined,
      binder: get("binder") || undefined,
    });
  });
  return { rows, problems };
}

/** Turns parsed rows into entries, using `oracleIds` (printing ID -> oracle ID) from the library. */
export function rowsToEntries(rows: ImportRow[], oracleIds: Map<string, string>, keepBinders: boolean): { entries: Entry[]; unknown: ImportRow[] } {
  const entries: Entry[] = [], unknown: ImportRow[] = [];
  const added = today();
  for (const r of rows) {
    const o = oracleIds.get(r.printingId);
    if (!o) { unknown.push(r); continue; }
    const e: Entry = { p: r.printingId, o, f: r.finish, c: r.condition, l: r.language, q: r.qty, a: added };
    if (r.purchasePrice) e.pp = r.purchasePrice;
    if (keepBinders && r.binder) e.b = r.binder;
    entries.push(e);
  }
  return { entries, unknown };
}

/** A ManaBox-compatible CSV of the collection. `cards` supplies names and set details by printing ID. */
export function collectionCsv(entries: Iterable<Entry>, cards: Map<string, Card>): string {
  const rows: unknown[][] = [[
    "Name", "Set code", "Set name", "Collector number", "Foil", "Rarity", "Quantity", "Scryfall ID",
    "Purchase price", "Condition", "Language", "Binder Name",
  ]];
  for (const e of entries) {
    const c = cards.get(e.p);
    rows.push([
      c?.name || "", c?.set || "", c?.set_name || "", c?.collector_number || "",
      e.f === "nonfoil" ? "normal" : e.f, c?.rarity || "", e.q, e.p,
      e.pp ?? "", CONDITION_TO_MANABOX[e.c], e.l, e.b || "",
    ]);
  }
  return toCsv(rows);
}

// ---------- JSON backup ----------

export interface Backup {
  app: "manabin";
  version: 1;
  exported: string;
  entries: Entry[];
}

export const makeBackup = (entries: Iterable<Entry>): Backup =>
  ({ app: "manabin", version: 1, exported: new Date().toISOString(), entries: [...entries] });

export function parseBackup(text: string): Entry[] {
  const data = JSON.parse(text);
  if (data?.app !== "manabin" || !Array.isArray(data.entries)) throw new Error("This isn't a ManaBin backup file.");
  return data.entries.filter((e: Entry) => e && typeof e.p === "string" && typeof e.o === "string" && e.q > 0)
    .map((e: Entry) => ({ ...e, f: e.f || "nonfoil", c: e.c || "NM", l: e.l || "en", a: e.a || today() }));
}

/** Starts a download of `text` as a file. */
export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
