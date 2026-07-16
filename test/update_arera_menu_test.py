#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "update-arera-menu.py"
SPEC = importlib.util.spec_from_file_location("update_arera_menu", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

NS = "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"
AXPO_LIGHT = "000099ESFFL07XXAXPOIXFIX89922607"
AXPO_GAS = "000099GSFML07XXAXPOIXFIX91292607"
ACEA_LIGHT = "000774ESFML01XXRT4D4028030000000"
OVERRIDES = MODULE.load_verified_overrides(ROOT)


def component(name: str, values: list[tuple[str, float]], unit: str) -> str:
    intervals = "".join(
        f"<IntervalloPrezzi><FASCIA_COMPONENTE>{band}</FASCIA_COMPONENTE>"
        f"<PREZZO>{value:.8f}</PREZZO><UNITA_MISURA>{unit}</UNITA_MISURA></IntervalloPrezzi>"
        for band, value in values
    )
    return f"<ComponenteImpresa><NOME>{name}</NOME>{intervals}</ComponenteImpresa>"


def offer_xml(
    *,
    code: str,
    name: str,
    customer_type: str,
    duration: int,
    components: list[str],
) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ListaOfferteMercatoLibero xmlns="{NS}">
  <offerta>
    <IdentificativiOfferta>
      <PIVA_UTENTE>01141160992</PIVA_UTENTE>
      <COD_OFFERTA>{code}</COD_OFFERTA>
    </IdentificativiOfferta>
    <DettaglioOfferta>
      <TIPO_CLIENTE>{customer_type}</TIPO_CLIENTE>
      <TIPO_OFFERTA>01</TIPO_OFFERTA>
      <DURATA>{duration}</DURATA>
      <NOME_OFFERTA>{name}</NOME_OFFERTA>
      <Contatti><URL_OFFERTA>https://example.test/offerta</URL_OFFERTA></Contatti>
    </DettaglioOfferta>
    <ValiditaOfferta>
      <DATA_INIZIO>09/07/2026_12:00:00</DATA_INIZIO>
      <DATA_FINE>20/07/2026_11:59:59</DATA_FINE>
    </ValiditaOfferta>
    {''.join(components)}
  </offerta>
</ListaOfferteMercatoLibero>
"""


def axpo_light_xml() -> str:
    return offer_xml(
        code=AXPO_LIGHT,
        name="Scegli Sereno 2.0 36 Mesi Giorno 3Fasce",
        customer_type="02",
        duration=36,
        components=[
            component("Onere Adeguamento Consumi", [("01", 0.0055)], "03"),
            component("Opzione verde", [("01", 0.005), ("02", 0.005), ("03", 0.005)], "03"),
            component("Prezzo luce", [("01", 0.12945), ("02", 0.14031), ("03", 0.11931)], "03"),
            component("Quota vendita luce", [("00", 144)], "01"),
        ],
    )


def axpo_gas_xml() -> str:
    return offer_xml(
        code=AXPO_GAS,
        name="Scegli Sereno GAS 2.0 Light",
        customer_type="02",
        duration=24,
        components=[
            component("Gestione bilanciamento", [("00", 0.045)], "04"),
            component("Gestione fornitura", [("00", 12)], "01"),
            component("Prezzo gas", [("00", 0.65654)], "04"),
            component("Quota vendita fissa", [("00", 144)], "01"),
            component("Quota vendita variabile", [("00", 0.05)], "04"),
        ],
    )


def acea_light_xml() -> str:
    return offer_xml(
        code=ACEA_LIGHT,
        name="Acea Energia Fix",
        customer_type="01",
        duration=12,
        components=[
            component("Corrispettivo per il consumo", [("00", 0.099)], "03"),
            component("Quota fissa di vendita", [("00", 111)], "01"),
        ],
    )


class UpdateAreraMenuTest(unittest.TestCase):
    def parse(self, xml: str, commodity: str, overrides=None):
        diagnostics: list[dict[str, object]] = []
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / f"PO_Offerte_{'E' if commodity == 'luce' else 'G'}_MLIBERO_20260716.xml"
            source.write_text(xml, encoding="utf-8")
            rows = MODULE.parse_offer_file(
                source,
                commodity,
                datetime(2026, 7, 16),
                overrides or {},
                diagnostics,
            )
        return rows, diagnostics

    def test_axpo_light_uses_verified_synthetic_price(self):
        rows, diagnostics = self.parse(axpo_light_xml(), "luce", OVERRIDES)
        self.assertEqual(diagnostics, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["customerType"], "business")
        self.assertEqual(rows[0]["durataMesi"], 36)
        self.assertAlmostEqual(rows[0]["prezzo"], 0.14586, places=8)
        self.assertEqual(rows[0]["quotaFissaAnnua"], 144)
        self.assertEqual(rows[0]["qualitaPrezzo"], "verificato_specifica_commerciale")
        self.assertNotAlmostEqual(rows[0]["prezzo"], 0.0666, places=4)
        required_evidence = {
            "sorgente",
            "codiceOfferta",
            "etichettaOriginale",
            "unitaMisura",
            "periodoValidita",
            "testoVicino",
        }
        self.assertTrue(rows[0]["valoriEstratti"])
        for value in rows[0]["valoriEstratti"]:
            self.assertTrue(required_evidence.issubset(value))

    def test_axpo_gas_uses_verified_synthetic_price(self):
        rows, diagnostics = self.parse(axpo_gas_xml(), "gas", OVERRIDES)
        self.assertEqual(diagnostics, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["customerType"], "business")
        self.assertEqual(rows[0]["durataMesi"], 24)
        self.assertAlmostEqual(rows[0]["prezzo"], 0.77154, places=8)
        self.assertEqual(rows[0]["quotaFissaAnnua"], 156)
        self.assertNotAlmostEqual(rows[0]["prezzo"], 0.2505, places=4)

    def test_multiband_price_is_rejected_without_verified_synthesis(self):
        rows, diagnostics = self.parse(axpo_light_xml(), "luce")
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics[0]["motivo"], "prezzo_multifascia_senza_sintesi_verificata")

    def test_acea_energia_fix_remains_unchanged(self):
        rows, diagnostics = self.parse(acea_light_xml(), "luce")
        self.assertEqual(diagnostics, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["customerType"], "privato")
        self.assertEqual(rows[0]["tipo"], "fisso")
        self.assertEqual(rows[0]["durataMesi"], 12)
        self.assertAlmostEqual(rows[0]["prezzo"], 0.099, places=8)
        self.assertEqual(rows[0]["quotaFissaAnnua"], 111)

    def test_daily_update_quarantines_wrong_axpo_values_and_keeps_last_valid(self):
        acea, _ = self.parse(acea_light_xml(), "luce")
        axpo_light, _ = self.parse(axpo_light_xml(), "luce", OVERRIDES)
        axpo_gas, _ = self.parse(axpo_gas_xml(), "gas", OVERRIDES)
        previous = {"offerte": acea, "offerteBusiness": axpo_light + axpo_gas}

        wrong_light = copy.deepcopy(axpo_light[0])
        wrong_light.update(prezzo=0.0666, qualitaPrezzo="media_fasce")
        wrong_gas = copy.deepcopy(axpo_gas[0])
        wrong_gas.update(prezzo=0.2505, qualitaPrezzo="media_fasce")
        staging = {
            "versioneDati": "arera-menu-2026-07-17",
            "aggiornatoIl": "2026-07-17",
            "statistiche": {},
            "offerte": acea,
            "offerteBusiness": [wrong_light, wrong_gas],
        }

        published, report = MODULE.validate_and_merge(staging, previous, [])
        published_business = {row["codice"]: row for row in published["offerteBusiness"]}
        self.assertAlmostEqual(published_business[AXPO_LIGHT]["prezzo"], 0.14586, places=8)
        self.assertAlmostEqual(published_business[AXPO_GAS]["prezzo"], 0.77154, places=8)
        quarantined_codes = {item["codiceOfferta"] for item in report["quarantena"]}
        self.assertEqual(quarantined_codes, {AXPO_LIGHT, AXPO_GAS})
        self.assertTrue(all(item["ultimoValidoConservato"] for item in report["quarantena"]))

    def test_business_offers_never_enter_private_catalog(self):
        acea, _ = self.parse(acea_light_xml(), "luce")
        axpo_light, _ = self.parse(axpo_light_xml(), "luce", OVERRIDES)
        staging = {
            "versioneDati": "arera-menu-2026-07-16",
            "aggiornatoIl": "2026-07-16",
            "statistiche": {},
            "offerte": acea,
            "offerteBusiness": axpo_light,
        }
        published, _ = MODULE.validate_and_merge(staging, {}, [])
        self.assertEqual([row["codice"] for row in published["offerte"]], [ACEA_LIGHT])
        self.assertEqual([row["codice"] for row in published["offerteBusiness"]], [AXPO_LIGHT])

    def test_future_value_cannot_become_main_price(self):
        acea, _ = self.parse(acea_light_xml(), "luce")
        suspicious = copy.deepcopy(acea[0])
        suspicious["provenienzaPrezzo"]["etichettaOriginale"] = "Dal 37° mese PUN + 0,011"
        self.assertIn("valore_futuro_usato_come_prezzo", MODULE.validate_candidate_row(suspicious))


if __name__ == "__main__":
    unittest.main()
