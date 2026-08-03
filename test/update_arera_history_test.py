import json
import tempfile
import unittest
from pathlib import Path
import importlib.util


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "update-arera-history.py"
SPEC = importlib.util.spec_from_file_location("update_arera_history", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def catalog(day, rows, pun=0.10, psv=0.40, dual=None):
    return {
        "versioneDati": f"arera-menu-{day}",
        "aggiornatoIl": day,
        "fonte": "ARERA test",
        "indiciUsati": {"pun": pun, "psv": psv},
        "offerte": rows,
        "offerteBusiness": [],
        "offerteDual": dual or [],
        "offerteDualBusiness": [],
    }


def offer(code="ABC", name="Offerta Casa", commodity="luce", price=0.15, fee=120, kind="fisso"):
    return {
        "providerKey": "test",
        "providerLabel": "Test Energia",
        "fornitore": "Test Energia",
        "commodity": commodity,
        "tipo": kind,
        "nome": name,
        "codice": code,
        "dataInizio": "01/01/2026_00:00:00",
        "dataFine": "31/12/2026_23:59:59",
        "customerType": "privato",
        "durataMesi": 12,
        "prezzo": price,
        "quotaFissaAnnua": fee,
        "qualitaPrezzo": "prezzo_esplicito",
        "url": "https://example.test/offerta",
        "fonte": f"ARERA - {code}",
    }


class HistoryTests(unittest.TestCase):
    def test_first_run_creates_active_record(self):
        result = MODULE.merge_catalog(catalog("2026-08-03", [offer()]), {})
        self.assertEqual(result["statistics"]["totalOffers"], 1)
        self.assertEqual(result["statistics"]["activeOffers"], 1)
        record = result["offers"][0]
        self.assertTrue(record["active"])
        self.assertEqual(record["firstSeen"], "2026-08-03")
        self.assertEqual(record["lastSeen"], "2026-08-03")
        self.assertEqual(len(record["versions"]), 1)

    def test_missing_offer_is_retained_as_inactive(self):
        first = MODULE.merge_catalog(catalog("2026-08-03", [offer()]), {})
        second = MODULE.merge_catalog(catalog("2026-08-04", [offer(code="XYZ")]), first)
        by_code = {item["offerCode"]: item for item in second["offers"]}
        self.assertFalse(by_code["ABC"]["active"])
        self.assertTrue(by_code["XYZ"]["active"])
        self.assertEqual(by_code["ABC"]["lastSeen"], "2026-08-03")

    def test_changed_conditions_add_version(self):
        first = MODULE.merge_catalog(catalog("2026-08-03", [offer(price=0.15)]), {})
        second = MODULE.merge_catalog(catalog("2026-08-04", [offer(price=0.16)]), first)
        record = second["offers"][0]
        self.assertEqual(len(record["versions"]), 2)
        self.assertEqual(record["versions"][-1]["price"], 0.16)

    def test_identical_conditions_do_not_duplicate_version(self):
        first = MODULE.merge_catalog(catalog("2026-08-03", [offer()]), {})
        second = MODULE.merge_catalog(catalog("2026-08-04", [offer()]), first)
        self.assertEqual(len(second["offers"][0]["versions"]), 1)
        self.assertEqual(second["offers"][0]["lastSeen"], "2026-08-04")

    def test_variable_offer_derives_index_and_spread(self):
        row = offer(commodity="gas", price=0.52, kind="variabile")
        result = MODULE.merge_catalog(catalog("2026-08-03", [row], psv=0.40), {})
        version = result["offers"][0]["versions"][0]
        self.assertEqual(version["indexName"], "PSV")
        self.assertAlmostEqual(version["spreadEstimate"], 0.12)

    def test_atomic_main_writes_both_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data").mkdir()
            (root / "data" / "offerte-arera-menu.json").write_text(
                json.dumps(catalog("2026-08-03", [offer()])),
                encoding="utf-8",
            )
            current = MODULE.read_json(root / "data" / "offerte-arera-menu.json")
            history = MODULE.merge_catalog(current, {})
            body = MODULE.json_text(history)
            MODULE.atomic_write_many({
                root / "data" / "offerte-arera-history.json": body,
                root / "public" / "data" / "offerte-arera-history.json": body,
            })
            self.assertTrue((root / "data" / "offerte-arera-history.json").exists())
            self.assertTrue((root / "public" / "data" / "offerte-arera-history.json").exists())


if __name__ == "__main__":
    unittest.main()
