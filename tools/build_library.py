#!/usr/bin/env python3
"""Build the full card library that the app searches.

Downloads Scryfall's "Default Cards" bulk file (every printing, about 500 MB)
and writes slim, static JSON files the site loads:

    <out>/manifest.json    when it was built, from which Scryfall file, which sets it covers
    <out>/cards.json       one entry per unique card (oracle card), for search and browsing
    <out>/sets.json        every set with its name, type, release date, icon and size
    <out>/prints/xx.json   every printing, sharded by the first two hex digits of the
                           card's oracle ID, loaded when you open a card
    <out>/ids/xx.json      printing ID -> oracle ID, sharded by the first two hex digits of
                           the printing ID, used to import collections that list printings

    python tools/build_library.py                          # download and build into public/library
    python tools/build_library.py --bulk default-cards.json --sets sets.json   # offline
    python tools/build_library.py --out some/dir

Card data and images belong to Scryfall and Wizards of the Coast; images are not
copied, the app loads them from Scryfall's image CDN. Only standard-library
modules are used.
"""
import argparse
import gzip
import json
import shutil
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "public" / "library"
CACHE = ROOT / ".cache"
UA = "manabin/1.0 (+https://github.com/mendus59/manabox-viewer)"

# Digital-only printings are left out of the library. Tokens, emblems, art cards and other
# extras are kept, so collections that hold them import fully, but marked `extra` so search
# hides them unless asked (like Scryfall's include:extras).
SKIP_SET_TYPES = {"alchemy"}
EXTRA_LAYOUTS = {"token", "double_faced_token", "emblem", "art_series"}
EXTRA_SET_TYPES = {"token", "memorabilia", "minigame"}

# Oracle-level fields (the same on every printing).
ORACLE_FIELDS = [
    "oracle_id", "name", "layout", "mana_cost", "cmc", "type_line", "oracle_text",
    "power", "toughness", "loyalty", "defense", "colors", "color_identity",
    "color_indicator", "keywords", "produced_mana", "reserved", "game_changer", "edhrec_rank",
]
FACE_FIELDS = [
    "name", "mana_cost", "type_line", "oracle_text", "power", "toughness",
    "loyalty", "defense", "colors", "color_indicator",
]
# Printing-level fields: what tells one edition or art apart, and its price.
PRINT_FIELDS = [
    "id", "set", "collector_number", "rarity", "lang", "released_at", "artist",
    "border_color", "frame", "frame_effects", "full_art", "textless", "promo",
    "promo_types", "finishes", "variation", "watermark", "flavor_name",
]
PRICE_KEYS = ["usd", "usd_foil", "usd_etched", "eur", "eur_foil", "tix"]
# Set types whose printings make a good "face" for a card in search results.
MAIN_SET_TYPES = {"core", "expansion", "masters", "draft_innovation", "commander", "starter", "duel_deck", "eternal"}


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001 - network errors of every kind get a retry
            if attempt == 4:
                raise
            print(f"  retrying {url}: {e}")
            time.sleep(2 ** attempt)


def bulk_file_url(info):
    """The bulk file's download link. Scryfall has renamed fields before, so look for any data.scryfall.io link."""
    for key in ("download_uri", "download_url", "compressed_uri", "uri_compressed"):
        if isinstance(info.get(key), str) and "data.scryfall.io" in info[key]:
            return info[key]
    for value in info.values():
        if isinstance(value, str) and "data.scryfall.io" in value:
            return value
    raise RuntimeError(f"No download link in Scryfall's bulk-data response (fields: {', '.join(sorted(info))})")


def download_bulk():
    """Download the Default Cards bulk file (cached by its timestamp). Returns (path, updated_at)."""
    info = json.loads(get("https://api.scryfall.com/bulk-data/default-cards"))
    print("Scryfall bulk-data fields: " + ", ".join(f"{k}={v}" for k, v in sorted(info.items()) if k != "description"))
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"default-cards-{info['updated_at'][:19].replace(':', '')}.json"
    if not path.exists():
        size = info.get("size") or info.get("compressed_size")
        print(f"Downloading {size / 1e6:.0f} MB of card data from Scryfall" if size else "Downloading card data from Scryfall")
        req = urllib.request.Request(bulk_file_url(info), headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        tmp = path.with_suffix(".part")
        with urllib.request.urlopen(req, timeout=600) as resp, open(tmp, "wb") as f:
            while chunk := resp.read(1 << 20):
                f.write(chunk)
        # The file may come gzip-compressed (by name or by Content-Encoding); store it plain.
        with open(tmp, "rb") as f:
            gzipped = f.read(2) == b"\x1f\x8b"
        if gzipped:
            plain = path.with_suffix(".unzip")
            with gzip.open(tmp, "rb") as src, open(plain, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            tmp.unlink()
            tmp = plain
        tmp.replace(path)
        for old in CACHE.glob("default-cards-*.json"):
            if old != path:
                old.unlink()
    return path, info["updated_at"]


def iter_bulk(path):
    """Yield every card in a bulk file.

    Scryfall's bulk files usually hold one card per line, which lets us read 500 MB without
    loading it all at once. If a file isn't laid out that way, fall back to reading it whole.
    """
    count = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip().rstrip(",")
            if not line or line in ("[", "]"):
                continue
            try:
                card = json.loads(line) if line.startswith("{") else None
            except json.JSONDecodeError:
                card = None
            if card is None:
                if count:
                    raise ValueError(f"Unexpected line in {path} after {count} cards: {line[:80]}")
                break
            count += 1
            yield card
        else:
            return
    print("Bulk file isn't one card per line; reading it whole")
    with open(path, encoding="utf-8") as f:
        yield from json.load(f)


def pick(source, fields):
    return {k: source[k] for k in fields if source.get(k) not in (None, "", [], False)}


def image_kind(card):
    """'f' = one image, 'fb' = front and back images (transform/MDFC cards), None = no image."""
    if card.get("image_status") == "missing":
        return None
    faces = card.get("card_faces") or []
    if len(faces) > 1 and all(f.get("image_uris") for f in faces):
        return "fb"
    return "f" if card.get("image_uris") or faces else None


def keep(card):
    return (
        card.get("set_type") not in SKIP_SET_TYPES
        and not card.get("digital")
        and "paper" in (card.get("games") or ["paper"])
    )


def face_score(p):
    """Higher is a better printing to represent the card in results (like Scryfall's default)."""
    effects = set(p.get("frame_effects") or [])
    return (
        p.get("lang") == "en",
        p.get("_set_type") in MAIN_SET_TYPES,
        not p.get("promo"),
        not p.get("variation"),
        p.get("border_color") in ("black", "white"),
        not effects & {"showcase", "extendedart", "etched", "inverted"},
        not p.get("full_art"),
        bool(p.get("_img")),
        p.get("released_at", ""),
    )


def build(bulk_path, sets_api, out, bulk_updated):
    oracles = {}
    prints = defaultdict(list)
    set_info = {}
    skipped = 0

    print(f"Reading {bulk_path}")
    for card in iter_bulk(bulk_path):
        if not keep(card):
            skipped += 1
            continue
        faces = card.get("card_faces") or []
        oid = card.get("oracle_id") or (faces[0].get("oracle_id") if faces else None)
        if not oid:
            skipped += 1
            continue

        if oid not in oracles:
            o = pick(card, ORACLE_FIELDS)
            o["oracle_id"] = oid
            if card.get("layout") in EXTRA_LAYOUTS or card.get("set_type") in EXTRA_SET_TYPES:
                o["extra"] = True
            if faces:
                o["card_faces"] = [pick(f, FACE_FIELDS) for f in faces]
            o["legalities"] = {k: v for k, v in (card.get("legalities") or {}).items() if v != "not_legal"}
            oracles[oid] = o

        p = pick(card, PRINT_FIELDS)
        p["prices"] = pick(card.get("prices") or {}, PRICE_KEYS)
        img = image_kind(card)
        if img:
            p["img"] = img
        if card.get("lang") == "en":
            p.pop("lang", None)  # English is the default; saves space
        p["_set_type"] = card.get("set_type")
        prints[oid].append(p)

        s = set_info.setdefault(card["set"], {
            "code": card["set"], "name": card.get("set_name"), "set_type": card.get("set_type"),
            "released_at": card.get("released_at"), "count": 0,
        })
        s["count"] += 1

    # Merge in what only the /sets endpoint knows: icons, parent sets, and sets with no printings yet.
    for s in sets_api:
        if s["code"] in set_info:
            set_info[s["code"]].update({
                "name": s["name"], "released_at": s.get("released_at") or set_info[s["code"]]["released_at"],
                "icon": s.get("icon_svg_uri", "").split("?")[0] or None,
                "parent": s.get("parent_set_code"),
            })
    sets = sorted(set_info.values(), key=lambda s: (s.get("released_at") or "", s["code"]), reverse=True)
    for s in sets:
        for k in [k for k, v in s.items() if v is None]:
            del s[k]

    cards = []
    shards = defaultdict(dict)
    ids = defaultdict(dict)
    for oid, o in oracles.items():
        ps = prints[oid]
        best = max(ps, key=lambda p: face_score({**p, "_img": p.get("img"), "lang": p.get("lang", "en")}))
        card = dict(o)
        for k in ("id", "set", "collector_number", "rarity", "released_at", "artist", "border_color",
                  "frame", "frame_effects", "full_art", "promo", "promo_types", "finishes", "prices", "img"):
            if k in best:
                card[k] = best[k]
        card["set_name"] = set_info[best["set"]]["name"]
        card["set_type"] = best["_set_type"]
        card["print_sets"] = sorted({p["set"] for p in ps})
        card["prints"] = len(ps)
        usd = [float(v) for p in ps for k, v in p["prices"].items() if k.startswith("usd")]
        if usd:
            card["min_usd"] = min(usd)
        cards.append(card)
        for p in ps:
            p.pop("_set_type", None)
            ids[p["id"][:2]][p["id"]] = oid
        ps.sort(key=lambda p: (p.get("released_at", ""), p["set"], p["collector_number"]), reverse=True)
        shards[oid[:2]][oid] = ps

    cards.sort(key=lambda c: c["name"])

    out.mkdir(parents=True, exist_ok=True)
    for sub in ("prints", "ids"):
        (out / sub).mkdir(exist_ok=True)
        for old in (out / sub).glob("*.json"):
            old.unlink()

    def write(path, data):
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        return path.stat().st_size

    size = write(out / "cards.json", cards)
    write(out / "sets.json", sets)
    for prefix, data in shards.items():
        size += write(out / "prints" / f"{prefix}.json", data)
    for prefix, data in ids.items():
        size += write(out / "ids" / f"{prefix}.json", data)

    # A set counts as covered once it has been out for two days, so a set released today is
    # checked again tomorrow in case Scryfall's bulk file hadn't picked it up yet.
    settled = (date.today() - timedelta(days=2)).isoformat()
    covered = sorted({s["code"] for s in sets_api if (s.get("released_at") or "9999") <= settled}
                     | {s["code"] for s in sets if (s.get("released_at") or "9999") <= settled})
    manifest = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "bulk_updated_at": bulk_updated,
        "cards": len(cards),
        "printings": sum(len(v) for v in prints.values()),
        "sets": len(sets),
        # The newest main set out today, not a token or promo set released alongside it.
        "newest_set": next((s["code"] for s in sets if (s.get("released_at") or "9999") <= date.today().isoformat()
                            and s.get("set_type") not in EXTRA_SET_TYPES | {"promo"}), None),
        "covered_sets": covered,
    }
    write(out / "manifest.json", manifest)
    print(f"Wrote {out}: {manifest['cards']} cards, {manifest['printings']} printings, "
          f"{manifest['sets']} sets, {skipped} skipped, {size / 1e6:.1f} MB")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bulk", type=Path, help="use a local Default Cards bulk file instead of downloading")
    parser.add_argument("--sets", type=Path, help="use a local copy of Scryfall's /sets response")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output folder (default {DEFAULT_OUT.relative_to(ROOT)})")
    args = parser.parse_args()

    if args.bulk:
        bulk_path, updated = args.bulk, datetime.fromtimestamp(args.bulk.stat().st_mtime, timezone.utc).isoformat()
    else:
        bulk_path, updated = download_bulk()
    if args.sets:
        sets_api = json.loads(args.sets.read_text(encoding="utf-8"))["data"]
    elif args.bulk:
        sets_api = []
    else:
        sets_api = json.loads(get("https://api.scryfall.com/sets"))["data"]
    build(bulk_path, sets_api, args.out, updated)


if __name__ == "__main__":
    sys.exit(main())
