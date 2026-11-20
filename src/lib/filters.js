// Point-and-click filters shown above the results. They combine (AND) with the search box.
import { ownedPrice } from "./search.js";


const SYMBOL = (s) => `https://svgs.scryfall.io/card-symbols/${s}.svg`;
const COLORS = [["W", "White"], ["U", "Blue"], ["B", "Black"], ["R", "Red"], ["G", "Green"], ["C", "Colorless"]];
const TYPES = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land", "Battle", "Legendary"];
const MANA_VALUES = ["0", "1", "2", "3", "4", "5", "6", "7+"];
const RARITIES = [["common", "Common"], ["uncommon", "Uncommon"], ["rare", "Rare"], ["mythic", "Mythic"], ["special", "Special"], ["bonus", "Bonus"]];
const FORMATS = ["commander", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "brawl", "historic", "timeless", "oathbreaker", "paupercommander", "premodern", "oldschool"];
const FORMAT_LABELS = { paupercommander: "Pauper Commander", oldschool: "Old School" };
const COLOR_MODES = [["include", "Including"], ["exact", "Exactly"], ["atmost", "At most"]];

/** Creates an independent filter panel, so the library and a collection keep their own state. */
export function createFilters() {
  const state = {
    colors: new Set(), colorMode: "include",
    identity: new Set(), identityMode: "atmost",
    types: new Set(), typeMode: "any",
    subtype: "", sets: new Set(),
    mv: new Set(), rarity: new Set(),
    format: "", finish: "",
    priceMin: "", priceMax: "",
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  // Split type lines ("Legendary Creature — Elf Druid // Land") into type words and subtypes.
  function prepareTypes(c) {
    const lines = (c.card_faces || []).map((f) => f.type_line).filter(Boolean);
    if (!lines.length) lines.push(...(c.type_line || "").split(" // "));
    const types = new Set(), subtypes = new Set();
    for (const line of lines) {
      const [left, right] = line.split("—");
      left.trim().split(/\s+/).forEach((w) => w && types.add(w.toLowerCase()));
      (right || "").trim().split(/\s+/).forEach((w) => w && subtypes.add(w));
    }
    c._f = { types, subtypes: new Set([...subtypes].map((s) => s.toLowerCase())), subtypeNames: subtypes };
  }

  function colorTest(selected, mode, getSet) {
    if (!selected.size) return null;
    const want = new Set([...selected].filter((x) => x !== "C"));
    return (c) => {
      const have = getSet(c);
      if (!want.size) return have.size === 0; // only "Colorless" picked
      const superset = [...want].every((x) => have.has(x));
      const subset = [...have].every((x) => want.has(x));
      if (mode === "exact") return superset && subset;
      if (mode === "atmost") return subset;
      return superset;
    };
  }

  function predicate() {
    const tests = [
      colorTest(state.colors, state.colorMode, (c) => c._s.colors),
      colorTest(state.identity, state.identityMode, (c) => c._s.identity),
    ];
    if (state.types.size) {
      const types = [...state.types];
      tests.push(state.typeMode === "all"
        ? (c) => types.every((t) => c._f.types.has(t))
        : (c) => types.some((t) => c._f.types.has(t)));
    }
    if (state.subtype) {
      const st = state.subtype.trim().toLowerCase();
      tests.push((c) => c._f.subtypes.has(st));
    }
    if (state.sets.size) {
      const sets = state.sets;
      tests.push((c) => sets.has(c.set) || (c.print_sets || []).some((s) => sets.has(s)));
    }
    if (state.mv.size) {
      tests.push((c) => {
        const mv = Math.floor(c.cmc || 0);
        return state.mv.has(mv >= 7 ? "7+" : String(mv));
      });
    }
    if (state.rarity.size) tests.push((c) => state.rarity.has(c.rarity));
    if (state.format) tests.push((c) => ["legal", "restricted"].includes(c.legalities[state.format]));
    const finishes = (c) => c.finishes || ["nonfoil"];
    if (state.finish === "foil") {
      tests.push((c) => (c.owned ? c.owned.foil + c.owned.etched > 0 : finishes(c).some((f) => f !== "nonfoil")));
    }
    if (state.finish === "nonfoil") {
      tests.push((c) => (c.owned ? c.owned.qty > c.owned.foil + c.owned.etched : finishes(c).includes("nonfoil")));
    }
    const min = parseFloat(state.priceMin), max = parseFloat(state.priceMax);
    if (!Number.isNaN(min) || !Number.isNaN(max)) {
      tests.push((c) => {
        const p = ownedPrice(c, "usd");
        return p != null && (Number.isNaN(min) || p >= min) && (Number.isNaN(max) || p <= max);
      });
    }
    const active = tests.filter(Boolean);
    return active.length ? (c) => active.every((t) => t(c)) : () => true;
  }

  function activeCount() {
    return [state.colors.size, state.identity.size, state.types.size, state.subtype, state.sets.size, state.mv.size,
      state.rarity.size, state.format, state.finish, state.priceMin || state.priceMax].filter(Boolean).length;
  }

  // ---------- URL params ----------

  // "fs" used to hold one set code; a comma-separated list reads the same way, so old links still work.
  const SET_PARAMS = { colors: "fc", identity: "fi", types: "ft", mv: "fmv", rarity: "fr", sets: "fs" };
  const VALUE_PARAMS = {
    colorMode: "fcm", identityMode: "fim", typeMode: "ftm", subtype: "fst",
    format: "ffmt", finish: "ff", priceMin: "pmin", priceMax: "pmax",
  };
  const DEFAULTS = { colorMode: "include", identityMode: "atmost", typeMode: "any" };

  function readParams(p) {
    for (const [k, name] of Object.entries(SET_PARAMS)) {
      const v = p.get(name);
      const values = v ? v.split(",").filter(Boolean) : [];
      // Colors are stored as uppercase symbols, everything else lowercase.
      state[k] = new Set(values.map((x) => (k === "colors" || k === "identity" ? x.toUpperCase() : x.toLowerCase())));
    }
    for (const [k, name] of Object.entries(VALUE_PARAMS)) state[k] = p.get(name) || DEFAULTS[k] || "";
  }

  function writeParams(p) {
    for (const [k, name] of Object.entries(SET_PARAMS)) if (state[k].size) p.set(name, [...state[k]].join(","));
    for (const [k, name] of Object.entries(VALUE_PARAMS)) if (state[k] && state[k] !== DEFAULTS[k]) p.set(name, state[k]);
  }

  // ---------- UI ----------

  const chip = (group, value, label, title) =>
    `<button type="button" class="chip${state[group].has(value) ? " on" : ""}" data-group="${group}" data-value="${esc(value)}"
      aria-pressed="${state[group].has(value)}"${title ? ` title="${esc(title)}"` : ""}>${label}</button>`;
  const select = (field, options) =>
    `<select data-field="${field}">${options.map(([v, l]) => `<option value="${esc(v)}"${state[field] === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const colorChips = (group) => COLORS.map(([s, name]) =>
    chip(group, s, `<img class="sym" src="${SYMBOL(s)}" alt="${name}">`, name)).join("");

  let setLabels = new Map();
  const setLabel = (code) => setLabels.get(code) || code.toUpperCase();
  function setSummary() {
    const n = state.sets.size;
    if (!n) return "All sets";
    if (n === 1) return esc(setLabel([...state.sets][0]));
    return `${n} sets`;
  }
  const setChips = () => [...state.sets].map((code) =>
    `<button type="button" class="chip on" data-set-remove="${esc(code)}" title="Remove ${esc(setLabel(code))}">${esc(code.toUpperCase())} <span aria-hidden="true">×</span></button>`).join("");
  /** Refreshes the set summary, chips and checkboxes without redrawing, so the open list keeps its place. */
  function syncSets(container) {
    const pick = container.querySelector(".setpick");
    if (!pick) return;
    pick.querySelector("summary").innerHTML = setSummary();
    container.querySelector(".setchips").innerHTML = setChips();
    container.querySelector("[data-sets-clear]").hidden = !state.sets.size;
    pick.querySelectorAll("input[data-set]").forEach((box) => (box.checked = state.sets.has(box.dataset.set)));
  }

  function render(container, cards, setNames) {
    const sets = new Map(), subtypes = new Map(), rarities = new Set();
    for (const c of cards) {
      for (const code of c.print_sets || [c.set]) {
        const s = sets.get(code) || { name: (setNames && setNames[code]) || (code === c.set ? c.set_name : code), n: 0 };
        s.n++;
        sets.set(code, s);
      }
      c._f.subtypeNames.forEach((t) => subtypes.set(t, (subtypes.get(t) || 0) + 1));
      rarities.add(c.rarity);
    }
    // Keep chosen sets listed even when the current cards have none from them, so they can be unticked.
    for (const code of state.sets) if (!sets.has(code)) sets.set(code, { name: (setNames && setNames[code]) || code.toUpperCase(), n: 0 });
    setLabels = new Map([...sets].map(([code, s]) => [code, s.name]));
    const setRows = [...sets].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([code, s]) =>
      `<label class="setrow" data-search="${esc(`${s.name} ${code}`.toLowerCase())}">
        <input type="checkbox" data-set="${esc(code)}"${state.sets.has(code) ? " checked" : ""}>
        <span class="setname">${esc(s.name)} <span class="setcode">${esc(code.toUpperCase())}</span></span>
        <span class="setn">${s.n}</span></label>`).join("");
    const subtypeOptions = [...subtypes].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([t, n]) => `<option value="${esc(t)}">${n} card${n === 1 ? "" : "s"}</option>`).join("");

    container.innerHTML = `
      <div class="fgroup">
        <div class="fhead"><span>Color</span>${select("colorMode", COLOR_MODES)}</div>
        <div class="chips">${colorChips("colors")}</div>
      </div>
      <div class="fgroup">
        <div class="fhead"><span>Color identity</span>${select("identityMode", COLOR_MODES)}</div>
        <div class="chips">${colorChips("identity")}</div>
      </div>
      <div class="fgroup">
        <div class="fhead"><span>Mana value</span></div>
        <div class="chips">${MANA_VALUES.map((v) => chip("mv", v, v)).join("")}</div>
      </div>
      <div class="fgroup wide">
        <div class="fhead"><span>Type</span>${select("typeMode", [["any", "Any of"], ["all", "All of"]])}</div>
        <div class="chips">${TYPES.map((t) => chip("types", t.toLowerCase(), t)).join("")}</div>
      </div>
      <div class="fgroup">
        <div class="fhead"><label for="f-subtype">Subtype</label></div>
        <input id="f-subtype" type="search" list="f-subtypes" data-field="subtype" value="${esc(state.subtype)}" placeholder="e.g. Elf, Equipment, Saga" autocomplete="off">
        <datalist id="f-subtypes">${subtypeOptions}</datalist>
      </div>
      <div class="fgroup">
        <div class="fhead"><span>Set</span><button type="button" class="linkish" data-sets-clear${state.sets.size ? "" : " hidden"}>Clear</button></div>
        <details class="setpick">
          <summary>${setSummary()}</summary>
          <div class="setpop">
            <input type="search" data-set-search placeholder="Search sets" aria-label="Search sets" autocomplete="off">
            <div class="setlist">${setRows}</div>
          </div>
        </details>
        <div class="chips setchips">${setChips()}</div>
      </div>
      <div class="fgroup">
        <div class="fhead"><span>Rarity</span></div>
        <div class="chips">${RARITIES.filter(([r]) => rarities.has(r)).map(([r, l]) => chip("rarity", r, l)).join("")}</div>
      </div>
      <div class="fgroup">
        <div class="fhead"><span>Legal in</span></div>
        ${select("format", [["", "Any format"], ...FORMATS.map((f) => [f, FORMAT_LABELS[f] || cap(f)])])}
      </div>
      <div class="fgroup">
        <div class="fhead"><span>Finish</span></div>
        ${select("finish", [["", "Foil and non-foil"], ["foil", "Foil only"], ["nonfoil", "Non-foil only"]])}
      </div>
      <div class="fgroup">
        <div class="fhead"><span>Price (USD)</span></div>
        <div class="range">
          <input type="number" min="0" step="0.5" inputmode="decimal" data-field="priceMin" value="${esc(state.priceMin)}" placeholder="Min" aria-label="Minimum price">
          <span>–</span>
          <input type="number" min="0" step="0.5" inputmode="decimal" data-field="priceMax" value="${esc(state.priceMax)}" placeholder="Max" aria-label="Maximum price">
        </div>
      </div>`;
  }

  function init({ container, cards, params, onChange, setNames }) {
    cards.forEach((c) => c._f || prepareTypes(c));
    readParams(params);
    render(container, cards, setNames);

    container.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-set-remove]");
      if (remove || e.target.closest("[data-sets-clear]")) {
        remove ? state.sets.delete(remove.dataset.setRemove) : state.sets.clear();
        syncSets(container);
        onChange();
        return;
      }
      const b = e.target.closest(".chip");
      if (!b) return;
      const set = state[b.dataset.group];
      const v = b.dataset.value;
      set.has(v) ? set.delete(v) : set.add(v);
      b.classList.toggle("on", set.has(v));
      b.setAttribute("aria-pressed", set.has(v));
      onChange();
    });
    let debounce;
    const onField = (e) => {
      if (e.target.dataset.set) {
        if (e.type !== "change") return;
        e.target.checked ? state.sets.add(e.target.dataset.set) : state.sets.delete(e.target.dataset.set);
        syncSets(container);
        onChange();
        return;
      }
      if (e.target.matches("[data-set-search]")) {
        const q = e.target.value.trim().toLowerCase();
        container.querySelectorAll(".setrow").forEach((row) => (row.hidden = !!q && !row.dataset.search.includes(q)));
        return;
      }
      const field = e.target.dataset.field;
      if (!field) return;
      state[field] = e.target.value;
      clearTimeout(debounce);
      debounce = setTimeout(onChange, e.target.tagName === "SELECT" ? 0 : 150);
    };
    container.addEventListener("input", onField);
    container.addEventListener("change", onField);

    return {
      clear() {
        readParams(new URLSearchParams());
        render(container, cards, setNames);
        onChange();
      },
      /** Redraws the options (sets, subtypes, rarities) for a new list of cards, keeping the choices made. */
      update(newCards, newSetNames) {
        cards = newCards;
        setNames = newSetNames;
        cards.forEach((c) => c._f || prepareTypes(c));
        if (!container.contains(document.activeElement)) render(container, cards, setNames);
      },
    };
  }

  return { init, predicate, activeCount, writeParams };

}
