#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock


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
    data_inizio: str = "09/07/2026_12:00:00",
    data_fine: str = "20/07/2026_11:59:59",
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
      <DATA_INIZIO>{data_inizio}</DATA_INIZIO>
      <DATA_FINE>{data_fine}</DATA_FINE>
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
        data_inizio="14/07/2026_12:00:00",
        components=[
            component("Gestione bilanciamento", [("00", 0.045)], "04"),
            component("Onere Adeguamento Consumi", [("00", 0.020)], "04"),
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

    def validated(self, private_rows, business_rows=(), previous=None, diagnostics=None):
        staging = {
            "schemaVersion": 93,
            "versioneDati": "arera-menu-v93-2026-07-16",
            "aggiornatoIl": "2026-07-16",
            "statistiche": {},
            "offerte": list(private_rows),
            "offerteBusiness": list(business_rows),
        }
        return MODULE.validate_staging_catalog(
            staging,
            previous or {},
            diagnostics or [],
            enforce_minimum=False,
        )

    def test_axpo_light_uses_verified_synthetic_price(self):
        rows, diagnostics = self.parse(axpo_light_xml(), "luce", OVERRIDES)
        self.assertEqual(diagnostics, [])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["customerType"], "business")
        self.assertEqual(row["durataMesi"], 36)
        self.assertAlmostEqual(row["prezzo"], 0.14586, places=8)
        self.assertEqual(row["quotaFissaAnnua"], 144)
        self.assertEqual(row["qualitaPrezzo"], "verificato_specifica_commerciale")
        self.assertNotAlmostEqual(row["prezzo"], 0.0666, places=4)
        required_evidence = {
            "sorgente",
            "codiceOfferta",
            "etichettaOriginale",
            "unitaMisura",
            "periodoValidita",
            "testoVicino",
        }
        self.assertTrue(row["valoriEstratti"])
        for value in row["valoriEstratti"]:
            self.assertTrue(required_evidence.issubset(value))

    def test_axpo_gas_uses_verified_synthetic_price(self):
        rows, diagnostics = self.parse(axpo_gas_xml(), "gas", OVERRIDES)
        self.assertEqual(diagnostics, [])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["customerType"], "business")
        self.assertEqual(row["durataMesi"], 24)
        self.assertAlmostEqual(row["prezzo"], 0.77154, places=8)
        self.assertEqual(row["quotaFissaAnnua"], 156)
        self.assertNotAlmostEqual(row["prezzo"], 0.2505, places=4)

    def test_multiband_price_is_quarantined_without_verified_synthesis(self):
        rows, diagnostics = self.parse(axpo_light_xml(), "luce")
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics[0]["motivo"], "prezzo_multifascia_senza_sintesi_verificata")

    def test_acea_energia_fix_remains_unchanged(self):
        rows, diagnostics = self.parse(acea_light_xml(), "luce")
        self.assertEqual(diagnostics, [])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["customerType"], "privato")
        self.assertEqual(row["tipo"], "fisso")
        self.assertEqual(row["durataMesi"], 12)
        self.assertAlmostEqual(row["prezzo"], 0.099, places=8)
        self.assertEqual(row["quotaFissaAnnua"], 111)

    def test_wrong_daily_axpo_values_are_quarantined_without_selective_fallback(self):
        acea, _ = self.parse(acea_light_xml(), "luce")
        valid_light, _ = self.parse(axpo_light_xml(), "luce", OVERRIDES)
        valid_gas, _ = self.parse(axpo_gas_xml(), "gas", OVERRIDES)
        previous = {"offerte": acea, "offerteBusiness": valid_light + valid_gas}

        wrong_light = copy.deepcopy(valid_light[0])
        wrong_light.update(prezzo=0.0666, qualitaPrezzo="media_fasce")
        wrong_gas = copy.deepcopy(valid_gas[0])
        wrong_gas.update(prezzo=0.2505, qualitaPrezzo="media_fasce")
        published, report = self.validated(acea, [wrong_light, wrong_gas], previous=previous)

        self.assertEqual(published["offerteBusiness"], [])
        self.assertEqual(report["offertePrecedentiRipescate"], 0)
        quarantined_codes = {item["codiceOfferta"] for item in report["quarantena"]}
        self.assertEqual(quarantined_codes, {AXPO_LIGHT, AXPO_GAS})
        self.assertTrue(all(not item["ultimoValidoConservato"] for item in report["quarantena"]))

    def test_expired_or_absent_previous_offer_is_not_republished(self):
        acea, _ = self.parse(acea_light_xml(), "luce")
        old = copy.deepcopy(acea[0])
        old["codice"] = "000774ESFML01XXEXPIRED0000000001"
        old["dataFine"] = "01/07/2026_23:59:59"
        published, report = self.validated(acea, previous={"offerte": [old], "offerteBusiness": []})
        self.assertEqual([row["codice"] for row in published["offerte"]], [ACEA_LIGHT])
        self.assertEqual(report["offertePrecedentiRipescate"], 0)

    def test_business_offers_never_enter_private_catalog(self):
        acea, _ = self.parse(acea_light_xml(), "luce")
        axpo_light, _ = self.parse(axpo_light_xml(), "luce", OVERRIDES)
        published, _ = self.validated(acea, axpo_light)
        self.assertEqual([row["codice"] for row in published["offerte"]], [ACEA_LIGHT])
        self.assertEqual([row["codice"] for row in published["offerteBusiness"]], [AXPO_LIGHT])

    def test_future_value_cannot_become_main_price(self):
        acea, _ = self.parse(acea_light_xml(), "luce")
        suspicious = copy.deepcopy(acea[0])
        suspicious["provenienzaPrezzo"]["etichettaOriginale"] = "Dal 37° mese PUN + 0,011"
        self.assertIn("valore_futuro_usato_come_prezzo", MODULE.validate_candidate_row(suspicious))

    def test_partner_metadata_rejects_economic_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data").mkdir()
            (root / "data" / "partner-metadata.json").write_text(
                json.dumps({
                    "versione": "test",
                    "routes": [{
                        "routeId": "bad",
                        "providerKey": "eon",
                        "url": "https://example.test",
                        "namePatterns": ["offerta"],
                        "prezzoLuce": 0.01,
                    }],
                }),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "Campi partner non ammessi|Campo economico non ammesso"):
                MODULE.load_partner_metadata(root)

    def test_optional_dual_xml_cannot_block_complete_light_and_gas_download(self):
        links = {
            "E": "https://example.test/PO_Offerte_E_MLIBERO_20260716.xml",
            "G": "https://example.test/PO_Offerte_G_MLIBERO_20260716.xml",
            "D": "https://example.test/PO_Offerte_D_MLIBERO_20260716.xml",
        }
        with tempfile.TemporaryDirectory() as tmp:
            def fake_download(url, target):
                if "_D_" in url:
                    raise MODULE.urllib.error.URLError("dual non disponibile")
                target.write_text("<xml />", encoding="utf-8")

            with mock.patch.object(MODULE, "download_file", side_effect=fake_download):
                files = MODULE.download_link_set(links, Path(tmp))
        self.assertEqual(set(files), {"E", "G"})

    def test_atomic_publish_rolls_back_every_target_after_interruption(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            targets = [
                root / "data" / "offerte-arera-menu.json",
                root / "public" / "data" / "offerte-arera-menu.json",
                root / "data" / "arera-update-report.json",
                root / "public" / "data" / "arera-update-report.json",
            ]
            for index, target in enumerate(targets):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps({"old": index}), encoding="utf-8")
            before = {target: target.read_bytes() for target in targets}
            real_replace = MODULE.os.replace
            replacements = 0

            def interrupted_replace(source, destination):
                nonlocal replacements
                if ".rollback." not in str(source):
                    replacements += 1
                    if replacements == 2:
                        raise OSError("interruzione simulata")
                return real_replace(source, destination)

            with mock.patch.object(MODULE.os, "replace", side_effect=interrupted_replace):
                with self.assertRaisesRegex(OSError, "interruzione simulata"):
                    MODULE.atomic_publish_catalog(
                        root,
                        {"schemaVersion": 93, "offerte": [], "offerteBusiness": []},
                        {"schemaVersion": 93, "pubblicazioneAutorizzata": True},
                    )
            self.assertEqual({target: target.read_bytes() for target in targets}, before)


if __name__ == "__main__":
    unittest.main()
