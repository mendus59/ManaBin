#!/usr/bin/env python3
"""Decide whether the card library needs rebuilding, and list upcoming sets.

Run daily by .github/workflows/library.yml. Compares Scryfall's set list with the
manifest of the last library build and rebuilds when:

  - a set has been released that the last build didn't cover, or
  - the last build is more than 30 days old (picks up new printings and errata), or
  - there is no previous build, or --force is given.

Writes `rebuild=true|false` to $GITHUB_OUTPUT and a table of upcoming sets to
$GITHUB_STEP_SUMMARY when those are set, so the Actions run page shows what's coming.

    python tools/check_sets.py --manifest manifest.json
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_library import EXTRA_SET_TYPES, SKIP_SET_TYPES, get  # noqa: E402

REFRESH_DAYS = 30


def decide(manifest, sets, today, force=False):
    """Returns (rebuild, reasons, released_new, upcoming)."""
    iso = today.isoformat()
    # Token and other extra sets don't trigger a rebuild on their own; they come along with their main set.
    paper = [s for s in sets if not s.get("digital") and s.get("set_type") not in SKIP_SET_TYPES | EXTRA_SET_TYPES]
    upcoming = sorted((s for s in paper if (s.get("released_at") or "") > iso), key=lambda s: s["released_at"])
    reasons = []
    if force:
        reasons.append("run by hand with force")
    if not manifest:
        reasons.append("no previous library build")
        return True, reasons, [], upcoming
    covered = set(manifest.get("covered_sets") or [])
    released_new = [s for s in paper if (s.get("released_at") or "9999") <= iso and s["code"] not in covered
                    and s.get("card_count", 0) > 0]
    if released_new:
        reasons.append("new sets released: " + ", ".join(f"{s['name']} ({s['code'].upper()})" for s in released_new))
    built = datetime.fromisoformat(manifest["built_at"]).date()
    if today - built > timedelta(days=REFRESH_DAYS):
        reasons.append(f"last build was {(today - built).days} days ago")
    return bool(reasons), reasons, released_new, upcoming


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, help="manifest.json from the last build (missing = never built)")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    manifest = None
    if args.manifest and args.manifest.exists() and args.manifest.stat().st_size:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    sets = json.loads(get("https://api.scryfall.com/sets"))["data"]
    today = datetime.now(timezone.utc).date()
    rebuild, reasons, _, upcoming = decide(manifest, sets, today, args.force)

    print("Rebuild: " + ("yes, " + "; ".join(reasons) if rebuild else "no, library is current"))
    soon = [s for s in upcoming if s["released_at"] <= (today + timedelta(days=120)).isoformat()]
    for s in soon:
        print(f"  upcoming {s['released_at']}  {s['code'].upper():6} {s['name']}")

    if out := os.environ.get("GITHUB_OUTPUT"):
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"rebuild={'true' if rebuild else 'false'}\n")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a", encoding="utf-8") as f:
            f.write("## Card library\n\n")
            f.write(("**Rebuilding:** " + "; ".join(reasons)) if rebuild else "Library is current, nothing to do.")
            if manifest:
                f.write(f"\n\nLast build {manifest['built_at']}: {manifest['cards']:,} cards, "
                        f"{manifest['printings']:,} printings, newest set {str(manifest.get('newest_set')).upper()}.")
            f.write("\n\n### Upcoming sets (next 120 days)\n\n")
            if soon:
                f.write("| Release | Code | Set | Type |\n|---|---|---|---|\n")
                for s in soon:
                    f.write(f"| {s['released_at']} | {s['code'].upper()} | {s['name']} | {s['set_type']} |\n")
            else:
                f.write("None announced on Scryfall yet.\n")


if __name__ == "__main__":
    sys.exit(main())
