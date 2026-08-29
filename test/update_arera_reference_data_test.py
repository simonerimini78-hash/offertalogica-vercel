#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "update-arera-reference-data.py"
SPEC = importlib.util.spec_from_file_location("update_arera_reference_data", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class UpdateAreraReferenceDataTest(unittest.TestCase):
    def test_parse_latest_official_placet_indices(self):
        page = """
        <html><body>
        <p>Le Offerte PLACET dell'energia elettrica prevedono un prezzo indicizzato.</p>
        <p>P_ING M monorario (€/kWh) Media mensile</p>
        <p>luglio 2026 0,157038</p>
        <p>Le Offerte PLACET di gas naturale prevedono un prezzo indicizzato.</p>
        <p>Il prezzo a copertura dei costi di approvvigionamento è pari a:</p>
        <p>P_ING M €/Smc €/GJ</p>
        <p>luglio 2026 0,606612 15,747972</p>
        </body></html>
        """
        parsed = MODULE.parse_placet_indices(page)
        self.assertAlmostEqual(parsed["pun"]["valore"], 0.157038, places=8)
        self.assertAlmostEqual(parsed["psv"]["valore"], 0.606612, places=8)
        self.assertEqual(parsed["pun"]["periodo"], "2026-07")
        self.assertEqual(parsed["psv"]["periodo"], "2026-07")
        self.assertEqual(parsed["pun"]["stato"], "ufficiale")
        self.assertEqual(parsed["psv"]["stato"], "ufficiale")


if __name__ == "__main__":
    unittest.main()
