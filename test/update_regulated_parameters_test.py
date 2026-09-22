#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "update-regulated-parameters.py"
SPEC = importlib.util.spec_from_file_location("update_regulated_parameters", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class UpdateRegulatedParametersTest(unittest.TestCase):
    def test_parse_arera_electricity_network_2026(self):
        page = """
        <html><body>
        <table>
        <tr><td>2025</td><td>2.280,00</td><td>1.906,33</td><td>2.508,00</td><td>1,189</td></tr>
        <tr><td>2026</td><td>2.304,00</td><td>1.954,48</td><td>2.352,00</td><td>1,190</td></tr>
        </table>
        </body></html>
        """
        parsed = MODULE.parse_electricity_network_tariffs(page, 2026)
        self.assertAlmostEqual(parsed["s1EurPodAnno"], 23.04)
        self.assertAlmostEqual(parsed["misEurPodAnno"], 19.5448)
        self.assertAlmostEqual(parsed["s2EurKwAnno"], 23.52)
        self.assertAlmostEqual(parsed["s3EurKwh"], 0.0119)

    def test_discovers_official_domestic_xlsx(self):
        page = '''<a href="/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx">qui</a>'''
        url = MODULE.discover_xlsx_url(page, MODULE.ARERA_EE_CONSUMER_URL, "elettrico")
        self.assertEqual(
            url,
            "https://www.arera.it/fileadmin/area_operatori/prezzi_e_tariffe/Corrispettivi_libero_elettrico_domestico_2026.xlsx",
        )

    def test_discovers_current_adm_pdf_by_anchor_text(self):
        page = """
        <a href="/altro-documento.pdf">Altro documento</a>
        <a href="/accise/aliquote-18-09-2026.pdf">Aliquote nazionali - Aggiornamento al 18 settembre 2026 - pdf</a>
        """
        url, label = MODULE.discover_adm_current_pdf(page, MODULE.ADM_EXCISE_URL)
        self.assertEqual(url, "https://www.adm.gov.it/accise/aliquote-18-09-2026.pdf")
        self.assertEqual(label, "18 settembre 2026")

    def test_guarded_source_blocks_changed_document(self):
        state = {"version": 1, "sources": {}}
        first = MODULE.guarded_source(
            state,
            "x",
            "https://example.test/a.xlsx",
            b"versione-1",
            label="fonte test",
            accept_changed=False,
        )
        self.assertEqual(first, "baseline")
        same = MODULE.guarded_source(
            state,
            "x",
            "https://example.test/a.xlsx",
            b"versione-1",
            label="fonte test",
            accept_changed=False,
        )
        self.assertEqual(same, "unchanged")
        with self.assertRaises(RuntimeError):
            MODULE.guarded_source(
                state,
                "x",
                "https://example.test/a.xlsx",
                b"versione-2",
                label="fonte test",
                accept_changed=False,
            )

    def test_network_update_recomputes_only_network_derived_totals(self):
        params = {
            "parametriCalcolo": {
                "componentiRegolate": {
                    "luce": {"fissaAnnua": 1, "potenzaEurKwAnno": 1, "variabileEurUnita": 1}
                },
                "componentiRegolateMeta": {
                    "periodoRete": "2026",
                    "valoriLuce2026": {
                        "s1EurPodAnno": 1,
                        "s2EurKwAnno": 1,
                        "s3EurKwh": 0.01,
                        "asosEurKwh": 0.031515,
                        "arimEurKwh": 0.001638,
                        "uc3EurKwh": 0.002760,
                        "uc6EurKwAnno": 0.1988,
                        "uc6EurKwh": 0.000070,
                    },
                },
            }
        }
        changed = MODULE.update_network_values(
            params,
            {"s1EurPodAnno": 23.04, "misEurPodAnno": 19.5448, "s2EurKwAnno": 23.52, "s3EurKwh": 0.0119},
            2026,
        )
        self.assertTrue(changed)
        luce = params["parametriCalcolo"]["componentiRegolate"]["luce"]
        self.assertAlmostEqual(luce["fissaAnnua"], 23.04)
        self.assertAlmostEqual(luce["potenzaEurKwAnno"], 23.7188)
        self.assertAlmostEqual(luce["variabileEurUnita"], 0.047883)


if __name__ == "__main__":
    unittest.main()
