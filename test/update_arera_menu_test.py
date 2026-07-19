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
    piva: str = "01141160992",
    offer_type: str = "01",
) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ListaOfferteMercatoLibero xmlns="{NS}">
  <offerta>
    <IdentificativiOfferta>
      <PIVA_UTENTE>{piva}</PIVA_UTENTE>
      <COD_OFFERTA>{code}</COD_OFFERTA>
    </IdentificativiOfferta>
    <DettaglioOfferta>
      <TIPO_CLIENTE>{customer_type}</TIPO_CLIENTE>
      <TIPO_OFFERTA>{offer_type}</TIPO_OFFERTA>
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


def dual_xml(*, code: str, light_code: str, gas_code: str, name: str = "Energia Lunghissima") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ListaOfferteMercatoLibero xmlns="{NS}">
  <offerta>
    <IdentificativiOfferta>
      <PIVA_UTENTE>02356770988</PIVA_UTENTE>
      <COD_OFFERTA>{code}</COD_OFFERTA>
    </IdentificativiOfferta>
    <DettaglioOfferta>
      <TIPO_CLIENTE>01</TIPO_CLIENTE>
      <TIPO_OFFERTA>01</TIPO_OFFERTA>
      <DURATA>24</DURATA>
      <NOME_OFFERTA>{name}</NOME_OFFERTA>
      <Contatti><URL_OFFERTA>https://www.illumia.it/offerta-dual</URL_OFFERTA></Contatti>
    </DettaglioOfferta>
    <ValiditaOfferta>
      <DATA_INIZIO>09/07/2026_12:00:00</DATA_INIZIO>
      <DATA_FINE>20/07/2026_11:59:59</DATA_FINE>
    </ValiditaOfferta>
    <OffertaDual>
      <OFFERTE_CONGIUNTE_EE>{light_code}</OFFERTE_CONGIUNTE_EE>
      <OFFERTE_CONGIUNTE_GAS>{gas_code}</OFFERTE_CONGIUNTE_GAS>
    </OffertaDual>
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

    def test_illumia_dual_uses_exact_d_references(self):
        light_code = "000155DSFML04XXZZ05103Z260711E01"
        gas_code = "000155DSFML04XXZZZZ05102Z260711G"
        light_xml = offer_xml(
            code=light_code,
            name="Energia Lunghissima Luce",
            customer_type="01",
            duration=24,
            piva="02356770988",
            components=[
                component("Prezzo base", [("01", 0.099)], "03"),
                component("CV quota fissa", [("00", 84)], "01"),
            ],
        )
        gas_xml = offer_xml(
            code=gas_code,
            name="Energia Lunghissima Gas",
            customer_type="01",
            duration=24,
            piva="02356770988",
            components=[
                component("Prezzo base", [("00", 0.49)], "04"),
                component("CV quota fissa", [("00", 84)], "01"),
            ],
        )
        light_rows, _ = self.parse(light_xml, "luce")
        gas_rows, _ = self.parse(gas_xml, "gas")
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "PO_Offerte_D_MLIBERO_20260716.xml"
            source.write_text(
                dual_xml(
                    code="000155DSFML01XX05103SFMX05102SFM",
                    light_code=light_code,
                    gas_code=gas_code,
                ),
                encoding="utf-8",
            )
            diagnostics: list[dict[str, object]] = []
            rows = MODULE.parse_dual_file(source, light_rows, gas_rows, datetime(2026, 7, 16), diagnostics)
        self.assertEqual(diagnostics, [])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["codiceOffertaLuce"], light_code)
        self.assertEqual(rows[0]["codiceOffertaGas"], gas_code)
        self.assertEqual(rows[0]["luce"]["codice"], light_code)
        self.assertEqual(rows[0]["gas"]["codice"], gas_code)
        self.assertAlmostEqual(rows[0]["luce"]["prezzo"], 0.099, places=8)
        self.assertAlmostEqual(rows[0]["gas"]["prezzo"], 0.49, places=8)

    def test_dual_does_not_mix_different_references(self):
        light_rows, _ = self.parse(acea_light_xml(), "luce")
        gas_rows, _ = self.parse(axpo_gas_xml(), "gas", OVERRIDES)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "PO_Offerte_D_MLIBERO_20260716.xml"
            source.write_text(
                dual_xml(code="000155DINVALID", light_code=ACEA_LIGHT, gas_code=AXPO_GAS),
                encoding="utf-8",
            )
            diagnostics: list[dict[str, object]] = []
            rows = MODULE.parse_dual_file(source, light_rows, gas_rows, datetime(2026, 7, 16), diagnostics)
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics[0]["motivo"], "fornitore_componenti_dual_non_coerente")

    def test_eco_is_recognised_only_by_000742_seller_code(self):
        false_eco = offer_xml(
            code="999999ESFML01XXENERGIACORRENTE",
            name="Energia Corrente Casa",
            customer_type="01",
            duration=12,
            piva="99999999999",
            components=[
                component("Prezzo energia", [("00", 0.08)], "03"),
                component("Quota fissa", [("00", 100)], "01"),
            ],
        )
        rows, diagnostics = self.parse(false_eco, "luce")
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics, [])

        true_eco = offer_xml(
            code="000742ESVOL01XXSOLESPEC260930D01",
            name="E.CO LUCE SOLE SPECIAL",
            customer_type="01",
            duration=12,
            piva="03672520404",
            offer_type="02",
            components=[
                component("Spread", [("00", 0.0055)], "03"),
                component("Corrispettivo di commercializzazione", [("00", 126)], "01"),
            ],
        )
        rows, diagnostics = self.parse(true_eco, "luce")
        self.assertEqual(diagnostics, [])
        self.assertEqual(rows[0]["providerKey"], "eco")
        self.assertAlmostEqual(rows[0]["prezzo"], MODULE.PUN_FALLBACK + 0.0055, places=8)
        self.assertNotAlmostEqual(rows[0]["prezzo"], 0.0055, places=8)

    def test_commercial_offer_name_wins_over_corporate_seller_identity(self):
        nen_xml = offer_xml(
            code="029748ESFML01XX260709LD10X000000",
            name="NeN Dieci Luce",
            customer_type="01",
            duration=12,
            piva="10879560968",
            components=[
                component("Prezzo energia", [("00", 0.105)], "03"),
                component("Quota fissa", [("00", 120)], "01"),
            ],
        )
        rows, diagnostics = self.parse(nen_xml, "luce")
        self.assertEqual(diagnostics, [])
        self.assertEqual(rows[0]["providerKey"], "nen")

        vivi_xml = offer_xml(
            code="000652GSFML02XXVIVIATTDFFX170726",
            name="VIVIattivo Fix Lucegas",
            customer_type="01",
            duration=12,
            piva="13149000153",
            components=[
                component("Prezzo gas", [("00", 0.52)], "04"),
                component("Quota fissa", [("00", 108)], "01"),
            ],
        )
        rows, diagnostics = self.parse(vivi_xml, "gas")
        self.assertEqual(diagnostics, [])
        self.assertEqual(rows[0]["providerKey"], "vivi")

    def test_plenitude_identity_and_current_price_labels_are_recognised(self):
        plenitude_light = offer_xml(
            code="026160ESFML51XXLFIXA24VBAS130726",
            name="Fixa Time 24 Luce",
            customer_type="01",
            duration=24,
            piva="12300020158",
            components=[
                component("Corrispettivo Luce", [("01", 0.11)], "03"),
                component("Commercializzazione e vendita fissa", [("00", 144)], "01"),
            ],
        )
        rows, diagnostics = self.parse(plenitude_light, "luce")
        self.assertEqual(diagnostics, [])
        self.assertEqual(rows[0]["providerKey"], "eni")
        self.assertAlmostEqual(rows[0]["prezzo"], 0.11, places=8)

        union_gas = offer_xml(
            code="031639GSFML01XXUNIONTEST000000",
            name="Union Gas Casa",
            customer_type="01",
            duration=12,
            piva="03163990611",
            components=[
                component("Prezzo gas", [("00", 0.5)], "04"),
                component("Quota fissa", [("00", 120)], "01"),
            ],
        )
        rows, diagnostics = self.parse(union_gas, "gas")
        self.assertEqual(rows, [])
        self.assertEqual(diagnostics, [])

    def test_current_arera_primary_price_labels_are_accepted(self):
        cases = (
            ("Prezzo Componente Materia Prima Gas", "gas", "04", 0.49),
            ("Prezzo fisso energia - Energiefixpreis", "luce", "03", 0.1027),
            ("Prezzo quota energia", "luce", "03", 0.139),
            ("Componente sostitutiva materia prima gas", "gas", "04", 0.6),
            ("Prezzo", "luce", "03", 0.1364),
        )
        for index, (label, commodity, unit, expected) in enumerate(cases):
            with self.subTest(label=label):
                xml = offer_xml(
                    code=f"000129{'E' if commodity == 'luce' else 'G'}SFMLTEST{index:02d}",
                    name=f"Octopus test {index}",
                    customer_type="01",
                    duration=12,
                    piva="01771990445",
                    components=[
                        component(label, [("00", expected)], unit),
                        component("Quota fissa", [("00", 84)], "01"),
                    ],
                )
                rows, diagnostics = self.parse(xml, commodity)
                self.assertEqual(diagnostics, [])
                self.assertAlmostEqual(rows[0]["prezzo"], expected, places=8)

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
