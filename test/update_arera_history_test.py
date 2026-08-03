import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "update-arera-history.py"
SPEC = importlib.util.spec_from_file_location("update_arera_history", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def catalog(day, rows, pun=0.10, psv=0.40):
    return {
        "versioneDati": f"arera-menu-{day}",
        "aggiornatoIl": day,
        "fonte": "ARERA test",
        "indiciUsati": {"pun": pun, "psv": psv},
        "offerte": rows,
        "offerteBusiness": [],
        "offerteDual": [],
        "offerteDualBusiness": [],
    }


def offer(code="ABC", price=0.15, kind="fisso", commodity="luce", fee=120):
    return {
        "providerKey": "test",
        "providerLabel": "Test Energia",
        "fornitore": "Test Energia",
        "commodity": commodity,
        "tipo": kind,
        "nome": "Offerta Casa",
        "codice": code,
        "dataInizio": "01/01/2026_00:00:00",
        "dataFine": "31/12/2026_23:59:59",
        "customerType": "privato",
        "durataMesi": 12,
        "prezzo": price,
        "quotaFissaAnnua": fee,
        "qualitaPrezzo": "prezzo_esplicito",
    }


class HistoryTests(unittest.TestCase):
    def test_first_run(self):
        result = MODULE.merge_catalog(catalog("2026-08-03", [offer()]), {})
        self.assertEqual(result["statistics"]["totalOffers"], 1)
        self.assertTrue(result["offers"][0]["active"])

    def test_missing_offer_is_retained(self):
        first = MODULE.merge_catalog(catalog("2026-08-03", [offer()]), {})
        second = MODULE.merge_catalog(catalog("2026-08-04", [offer(code="XYZ")]), first)
        by_code = {item["offerCode"]: item for item in second["offers"]}
        self.assertFalse(by_code["ABC"]["active"])
        self.assertTrue(by_code["XYZ"]["active"])

    def test_fixed_price_change_creates_version(self):
        first = MODULE.merge_catalog(catalog("2026-08-03", [offer(price=0.15)]), {})
        second = MODULE.merge_catalog(catalog("2026-08-04", [offer(price=0.16)]), first)
        self.assertEqual(len(second["offers"][0]["versions"]), 2)

    def test_variable_index_change_does_not_create_contract_version(self):
        first = MODULE.merge_catalog(
            catalog("2026-08-03", [offer(price=0.12, kind="variabile")], pun=0.10), {}
        )
        second = MODULE.merge_catalog(
            catalog("2026-08-04", [offer(price=0.13, kind="variabile")], pun=0.11), first
        )
        self.assertEqual(len(second["offers"][0]["versions"]), 1)

    def test_variable_spread_change_creates_version(self):
        first = MODULE.merge_catalog(
            catalog("2026-08-03", [offer(price=0.12, kind="variabile")], pun=0.10), {}
        )
        second = MODULE.merge_catalog(
            catalog("2026-08-04", [offer(price=0.14, kind="variabile")], pun=0.11), first
        )
        self.assertEqual(len(second["offers"][0]["versions"]), 2)


if __name__ == "__main__":
    unittest.main()
