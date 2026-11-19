#!/usr/bin/env python3
"""Card Kingdom and MTGGoldfish prices for every printing in the card library.

Reads the library's printings (tools/build_library.py output), then fetches:

  - Card Kingdom: its public price list, one request, matched on Scryfall ID.
  - MTGGoldfish: one "All Cards" page per set (about 340 pages), matched on set code
    and collector number. Prerelease and Planeswalker-stamp promos, which MTGGoldfish
    lists under the main set, are matched to Scryfall's promo sets.

and writes, next to the library:

  prices/xx.json       {printing ID: [ck, ck_foil, ck_etched, gf, gf_foil, gf_etched]}
                       sharded like prints/ (by the first two characters of the oracle ID),
                       0 where a store has no price
  prices/manifest.json when the prices were fetched, and how many were found

    python tools/build_prices.py --library public/library
    python tools/build_prices.py --library public/library --no-goldfish

Only standard-library modules are used.
"""
import argparse
import gzip
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CK_URL = "https://api.cardkingdom.com/api/v2/pricelist"
GOLDFISH = "https://www.mtggoldfish.com"
UA = "ManaBin price updater (+https://github.com/mendus59/ManaBin)"
DELAY = 2.0  # seconds between MTGGoldfish requests
FINISHES = ("nonfoil", "foil", "etched")

# MTGGoldfish subsets to skip: no collector number, or not paper.
SKIP_SUBSETS = {"sealed", "mtgo", "arena"}
# Promos MTGGoldfish lists under the main set, and where Scryfall keeps them: (set prefix, number suffix).
PROMO_SUBSETS = {"prerelease": ("p", "s"), "pw_stamp": ("p", "p"), "pw_stamp_foil": ("p", "p")}

PROPS_RE = re.compile(r"data-react-props=\"([^\"]*card_uuid[^\"]*)\"")
SET_LINK_RE = re.compile(r'href="(/sets/[^"#?/]+)"')


def get(url, timeout=120, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                return gzip.decompress(body) if resp.headers.get("Content-Encoding") == "gzip" else body
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == tries - 1:
                raise
        except (urllib.error.URLError, OSError):
            if attempt == tries - 1:
                raise
        time.sleep(10 * (attempt + 1))


def money(value):
    try:
        n = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def load_printings(library):
    """Oracle shard and finishes for each printing, and a (set, collector number) -> printing ID index."""
    shard_of, finishes, by_number = {}, {}, {}
    for f in sorted((library / "prints").glob("*.json")):
        for prints in json.loads(f.read_text(encoding="utf-8")).values():
            for p in prints:
                shard_of[p["id"]] = f.stem
                finishes[p["id"]] = set(p.get("finishes") or ["nonfoil"])
                by_number.setdefault((p["set"], p["collector_number"]), p["id"])
    return shard_of, finishes, by_number


def card_kingdom(items, known):
    """(printing ID, finish) -> CK near-mint retail price, from the price list's `data`."""
    out = {}
    for item in items:
        sid, price = item.get("scryfall_id"), money(item.get("price_retail"))
        if not sid or not price or sid not in known:
            continue
        foil = str(item.get("is_foil")).lower() == "true"
        finish = "etched" if foil and "etched" in (item.get("variation") or "").lower() else "foil" if foil else "nonfoil"
        key = (sid, finish)
        out[key] = max(out.get(key, 0), price)
    return out


def goldfish_cards(page):
    """The cards listed on an MTGGoldfish set page, from the JSON its card table is built from."""
    m = PROPS_RE.search(page)
    if not m:
        return []
    try:
        return json.loads(html.unescape(m.group(1))).get("cards") or []
    except ValueError:
        return []


def goldfish_key(card, by_number, finishes):
    """(printing ID, finish) for one MTGGoldfish card, or None if it can't be matched."""
    subset = card.get("subset_id") or ""
    code = (card.get("set") or "").lower()
    path = ((card.get("links") or {}).get("default") or "").split("#")[0].split("/")
    if subset in SKIP_SUBSETS or not code or len(path) < 5:
        return None
    number = urllib.parse.unquote(path[3])
    candidates = [(code, number)]
    if subset in PROMO_SUBSETS:
        prefix, suffix = PROMO_SUBSETS[subset]
        candidates = [(prefix + code, number + suffix)]
    foil = card.get("foil") or card.get("finish") == "foil"
    finish = "etched" if "etched" in subset else "foil" if foil else "nonfoil"
    for key in candidates:
        pid = by_number.get(key)
        if pid and finish in finishes[pid]:
            return pid, finish
    return None


def goldfish(by_number, finishes, log=print):
    index = get(GOLDFISH + "/sets").decode("utf-8", "replace")
    sets = sorted(set(SET_LINK_RE.findall(index)))
    log(f"MTGGoldfish: {len(sets)} sets")
    out, unmatched, failed = {}, 0, []
    for n, path in enumerate(sets, start=1):
        time.sleep(DELAY)
        try:
            page = get(GOLDFISH + path + "/All+Cards", timeout=180).decode("utf-8", "replace")
        except (urllib.error.URLError, OSError) as e:
            failed.append(f"{path} ({e})")
            continue
        cards = goldfish_cards(page)
        # Main-set rows first, so a promo listed with the same number never replaces them.
        cards.sort(key=lambda c: (c.get("subset_id") or "") not in ("main_set", "main_set_foil"))
        for c in cards:
            price = money(((c.get("prices") or {}).get("paper") or {}).get("current_price"))
            if not price:
                continue
            key = goldfish_key(c, by_number, finishes)
            if key is None:
                unmatched += 1
            elif key not in out:
                out[key] = price
        if n % 25 == 0:
            log(f"  {n}/{len(sets)} sets, {len(out)} prices")
    for f in failed:
        log(f"::warning title=MTGGoldfish::Couldn't load {f}")
    log(f"MTGGoldfish: {len(out)} prices matched, {unmatched} listings not matched")
    return out, len(failed)


def write(out_dir, shard_of, ck, gf, stats):
    shards = {}
    for source, offset in ((ck, 0), (gf, 3)):
        for (pid, finish), price in source.items():
            row = shards.setdefault(shard_of[pid], {}).setdefault(pid, [0] * 6)
            row[offset + FINISHES.index(finish)] = round(price, 2)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.json"):
        old.unlink()
    for prefix, rows in shards.items():
        (out_dir / f"{prefix}.json").write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
    manifest = {"built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **stats}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--library", type=Path, default=Path("public/library"), help="folder with the built card library")
    ap.add_argument("--out", type=Path, help="where to write the price shards (default: <library>/prices)")
    ap.add_argument("--no-goldfish", action="store_true", help="skip MTGGoldfish (about 15 minutes)")
    args = ap.parse_args()

    shard_of, finishes, by_number = load_printings(args.library)
    print(f"Library: {len(shard_of)} printings")
    if not shard_of:
        sys.exit("No printings found. Build the library first (tools/build_library.py).")

    ck = card_kingdom(json.loads(get(CK_URL, timeout=300))["data"], shard_of)
    print(f"Card Kingdom: {len(ck)} prices matched")
    gf, gf_failed = ({}, 0) if args.no_goldfish else goldfish(by_number, finishes)

    if len(ck) < 1000 or (not args.no_goldfish and len(gf) < 1000):
        sys.exit("Too few prices found; a store has probably changed its format. Not writing anything.")
    m = write(args.out or args.library / "prices", shard_of, ck, gf,
              {"card_kingdom": len(ck), "mtggoldfish": len(gf), "mtggoldfish_failed_sets": gf_failed})
    print(f"Wrote prices: {m}")


if __name__ == "__main__":
    main()
