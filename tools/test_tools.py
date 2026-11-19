"""Tests for the library tools. Run with: python -m unittest discover tools"""
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_library  # noqa: E402
from check_sets import decide  # noqa: E402

TODAY = date(2026, 11, 18)


def s(code, released, **kw):
    return {"code": code, "name": code.upper(), "set_type": "expansion", "released_at": released, "card_count": 100, **kw}


class DecideTests(unittest.TestCase):
    manifest = {"built_at": "2026-11-10T00:00:00+00:00", "covered_sets": ["old"]}

    def test_no_manifest_rebuilds(self):
        self.assertTrue(decide(None, [s("old", "2020-01-01")], TODAY)[0])

    def test_current_library_does_nothing(self):
        rebuild, _, _, upcoming = decide(self.manifest, [s("old", "2020-01-01"), s("new", "2027-01-01")], TODAY)
        self.assertFalse(rebuild)
        self.assertEqual([x["code"] for x in upcoming], ["new"])

    def test_released_set_triggers_rebuild(self):
        rebuild, reasons, released, _ = decide(self.manifest, [s("old", "2020-01-01"), s("new", "2026-11-18")], TODAY)
        self.assertTrue(rebuild)
        self.assertEqual([x["code"] for x in released], ["new"])

    def test_digital_and_token_sets_are_ignored(self):
        sets = [s("old", "2020-01-01"), s("ydig", "2026-11-01", digital=True), s("tnew", "2026-11-01", set_type="token")]
        self.assertFalse(decide(self.manifest, sets, TODAY)[0])

    def test_old_build_refreshes(self):
        self.assertTrue(decide({**self.manifest, "built_at": "2026-10-01T00:00:00+00:00"}, [s("old", "2020-01-01")], TODAY)[0])


def card(cid, oid, name, set_code, released, **kw):
    return {"id": cid, "oracle_id": oid, "name": name, "set": set_code, "set_name": set_code.upper(),
            "set_type": "expansion", "released_at": released, "collector_number": "1", "rarity": "common",
            "lang": "en", "games": ["paper"], "layout": "normal", "type_line": "Instant", "finishes": ["nonfoil"],
            "image_uris": {"normal": "x"}, "prices": {"usd": "1.00"}, "legalities": {"modern": "legal", "standard": "not_legal"}, **kw}


class BuildTests(unittest.TestCase):
    def test_build(self):
        oid = "ab" + "0" * 34
        cards = [
            card("1", oid, "Bolt", "lea", "1993-08-05", border_color="black", prices={"usd": "400.00"}),
            card("2", oid, "Bolt", "m11", "2010-07-16", border_color="black", prices={"usd": "1.00"}),
            card("3", oid, "Bolt", "sld", "2023-01-01", border_color="borderless", promo=True),
            card("4", "cd" + "0" * 34, "Token", "tm11", "2010-07-16", layout="token"),
            card("5", "ef" + "0" * 34, "Arena Only", "ymid", "2021-12-09", digital=True),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            bulk = Path(tmp) / "bulk.json"
            bulk.write_text("[\n" + ",\n".join(json.dumps(c) for c in cards) + "\n]\n")
            out = Path(tmp) / "out"
            m = build_library.build(bulk, [], out, "2026-11-18")
            lib = json.loads((out / "cards.json").read_text())
            self.assertEqual(m["cards"], 2)  # Bolt, plus the token as an extra; the digital card is dropped
            self.assertEqual(m["printings"], 4)
            self.assertEqual([c["name"] for c in lib if c.get("extra")], ["Token"])
            bolt = lib[0]
            self.assertEqual(bolt["set"], "m11")  # newest regular printing, not the promo
            self.assertEqual(bolt["print_sets"], ["lea", "m11", "sld"])
            self.assertEqual(bolt["min_usd"], 1.0)
            self.assertNotIn("standard", bolt["legalities"])
            prints = json.loads((out / "prints" / "ab.json").read_text())[oid]
            self.assertEqual([p["set"] for p in prints], ["sld", "m11", "lea"])
            self.assertEqual(prints[0]["img"], "f")
            self.assertEqual(json.loads((out / "ids" / "3.json").read_text()), {"3": oid})


class BulkFormatTests(unittest.TestCase):
    def test_reads_one_line_and_compact_files(self):
        cards = [{"id": "1", "name": "A"}, {"id": "2", "name": "B, with comma"}]
        with tempfile.TemporaryDirectory() as tmp:
            lines = Path(tmp) / "lines.json"
            lines.write_text("[\n" + ",\n".join(json.dumps(c) for c in cards) + "\n]\n")
            compact = Path(tmp) / "compact.json"
            compact.write_text(json.dumps(cards))
            self.assertEqual(list(build_library.iter_bulk(lines)), cards)
            self.assertEqual(list(build_library.iter_bulk(compact)), cards)

    def test_finds_download_link(self):
        self.assertEqual(build_library.bulk_file_url({"uri": "https://api.scryfall.com/x", "download_uri": "https://data.scryfall.io/a.json"}),
                         "https://data.scryfall.io/a.json")
        self.assertEqual(build_library.bulk_file_url({"uri": "https://api.scryfall.com/x", "new_name": "https://data.scryfall.io/a.json.gz"}),
                         "https://data.scryfall.io/a.json.gz")
        with self.assertRaises(RuntimeError):
            build_library.bulk_file_url({"uri": "https://api.scryfall.com/x"})


if __name__ == "__main__":
    unittest.main()
