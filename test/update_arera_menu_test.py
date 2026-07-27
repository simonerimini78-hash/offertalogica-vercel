#!/usr/bin/env python3
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest import mock
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



def write_text_pdf(path: Path, lines: list[str]) -> None:
    def escape_pdf(value: str) -> str:
        return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    commands = ["BT", "/F1 12 Tf", "72 760 Td", "14 TL"]
    for index, line in enumerate(lines):
        if index:
            commands.append("T*")
        commands.append(f"({escape_pdf(line)}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii"))
        output.extend(body)
        output.extend(b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    )
    path.write_bytes(output)


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
    def test_previous_month_reference_uses_last_completed_month(self):
        self.assertEqual(
            MODULE.previous_month_reference(datetime(2026, 7, 27)),
            (2026, 6, "2026-06", "Giugno 2026"),
        )
        self.assertEqual(
            MODULE.previous_month_reference(datetime(2027, 1, 3)),
            (2026, 12, "2026-12", "Dicembre 2026"),
        )

    def test_gme_links_are_discovered_from_public_pages(self):
        listing = """
        <html><body>
          <a href="/Home/AvvisieComunicati/AvvisieComunicatiME?id=7595">
            Dati di sintesi elettrico - Giugno 2026
          </a>
        </body></html>
        """
        detail = """
        <html><body><div>14/07/2026</div>
          <a href="/Portals/0/Documents/it-IT//202606_Dati_di_sintesi_mensile.pdf">
            Dati di sintesi elettrico - Giugno 2026
          </a>
        </body></html>
        """
        notice = MODULE.find_exact_link(
            listing,
            MODULE.GME_ELECTRIC_NOTICES_URL,
            "Dati di sintesi elettrico - Giugno 2026",
        )
        self.assertEqual(
            notice,
            "https://gme.mercatoelettrico.org/Home/AvvisieComunicati/AvvisieComunicatiME?id=7595",
        )
        document = MODULE.find_pdf_link(
            detail,
            notice,
            "Dati di sintesi elettrico - Giugno 2026",
        )
        self.assertEqual(
            document,
            "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT//202606_Dati_di_sintesi_mensile.pdf",
        )
        self.assertEqual(MODULE.publication_date_from_page(detail), "2026-07-14")

    def test_gme_baseload_is_parsed_and_converted(self):
        text = """
        €/MWh 2026 2025 % Assoluta
        Baseload 132,50 111,78 +18,5% +20,72
        Mercato del Giorno Prima
        Giugno 2026
        """
        eur_mwh, eur_kwh = MODULE.parse_gme_pun_text(text, "Giugno 2026")
        self.assertEqual(eur_mwh, 132.50)
        self.assertEqual(eur_kwh, 0.13250)

    def test_download_previous_month_pun_runs_complete_pipeline(self):
        listing = b"""
        <html><body><a href="/Home/AvvisieComunicati/AvvisieComunicatiME?id=7595">
        Dati di sintesi elettrico - Giugno 2026</a></body></html>
        """
        detail = b"""
        <html><body><div>14/07/2026</div>
        <a href="/Portals/0/Documents/it-IT//202606_Dati_di_sintesi_mensile.pdf">
        Dati di sintesi elettrico - Giugno 2026</a></body></html>
        """
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "gme.pdf"
            write_text_pdf(
                pdf,
                [
                    "Baseload 132,50 111,78 +18,5% +20,72",
                    "Mercato del Giorno Prima",
                    "Giugno 2026",
                ],
            )
            pdf_bytes = pdf.read_bytes()

        responses = [
            (listing, MODULE.GME_ELECTRIC_NOTICES_URL, "text/html"),
            (
                detail,
                "https://gme.mercatoelettrico.org/Home/AvvisieComunicati/AvvisieComunicatiME?id=7595",
                "text/html",
            ),
            (
                pdf_bytes,
                "https://gme.mercatoelettrico.org/Portals/0/Documents/it-IT//202606_Dati_di_sintesi_mensile.pdf",
                "application/pdf",
            ),
        ]
        with mock.patch.object(MODULE, "fetch_url", side_effect=responses):
            snapshot = MODULE.download_previous_month_pun(datetime(2026, 7, 27))

        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["periodo"], "2026-06")
        self.assertEqual(snapshot["periodoLabel"], "Giugno 2026")
        self.assertEqual(snapshot["pubblicatoIl"], "2026-07-14")
        self.assertEqual(snapshot["valoreOriginale"], 132.50)
        self.assertEqual(snapshot["valore"], 0.13250)
        self.assertEqual(snapshot["stato"], "ufficiale")

    def test_missing_monthly_publication_keeps_previous_index(self):
        listing = b"<html><body><a href='/other'>Altro avviso</a></body></html>"
        with mock.patch.object(
            MODULE,
            "fetch_url",
            return_value=(listing, MODULE.GME_ELECTRIC_NOTICES_URL, "text/html"),
        ):
            self.assertIsNone(MODULE.download_previous_month_pun(datetime(2026, 7, 1)))

    def test_missing_publication_after_grace_period_is_an_error(self):
        listing = b"<html><body><a href='/other'>Altro avviso</a></body></html>"
        with mock.patch.object(
            MODULE,
            "fetch_url",
            return_value=(listing, MODULE.GME_ELECTRIC_NOTICES_URL, "text/html"),
        ):
            with self.assertRaisesRegex(RuntimeError, "oltre la finestra di attesa"):
                MODULE.download_previous_month_pun(datetime(2026, 7, 27))

    def test_gme_parser_rejects_wrong_month_or_missing_baseload(self):
        with self.assertRaisesRegex(ValueError, "Periodo GME inatteso"):
            MODULE.parse_gme_pun_text(
                "Baseload 132,50 Mercato del Giorno Prima Maggio 2026",
                "Giugno 2026",
            )
        with self.assertRaisesRegex(ValueError, "Baseload non trovato"):
            MODULE.parse_gme_pun_text(
                "Mercato del Giorno Prima Giugno 2026 Picco 130,34",
                "Giugno 2026",
            )

    def test_pdftotext_extracts_real_first_page_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "gme.pdf"
            write_text_pdf(
                pdf,
                [
                    "Baseload 132,50 111,78 +18,5% +20,72",
                    "Mercato del Giorno Prima",
                    "Giugno 2026",
                ],
            )
            text = MODULE.extract_first_page_pdf_text(pdf)
        eur_mwh, eur_kwh = MODULE.parse_gme_pun_text(text, "Giugno 2026")
        self.assertEqual(eur_mwh, 132.50)
        self.assertEqual(eur_kwh, 0.13250)

    def test_pun_snapshot_updates_only_pun_and_preserves_gas_indices(self):
        parameters = {
            "versioneDati": "old",
            "aggiornatoIl": "2026-07-03",
            "parametriCalcolo": {"perditeReteLuceVariabile": 1.102},
            "indiciMercato": {
                "pun": {"label": "PUN", "valore": 0.119351258, "unita": "eur_kwh"},
                "psv": {"label": "PSV", "valore": 0.504419055, "unita": "eur_smc"},
                "psbg": {"label": "PSBG", "valore": 0.504419055, "unita": "eur_smc"},
            },
        }
        snapshot = {
            "label": "PUN Index GME",
            "valore": 0.1325,
            "unita": "eur_kwh",
            "periodo": "2026-06",
            "periodoLabel": "Giugno 2026",
            "valoreOriginale": 132.5,
            "unitaOriginale": "eur_mwh",
            "fonte": MODULE.GME_SOURCE_LABEL,
            "urlFonte": "https://gme.example/notice",
            "urlDocumento": "https://gme.example/document.pdf",
            "pubblicatoIl": "2026-07-14",
            "acquisitoIl": "2026-07-27",
            "stato": "ufficiale",
        }
        updated = MODULE.apply_pun_snapshot(parameters, snapshot, datetime(2026, 7, 27))
        self.assertEqual(updated["indiciMercato"]["pun"]["valore"], 0.1325)
        self.assertEqual(updated["indiciMercato"]["pun"]["periodo"], "2026-06")
        self.assertEqual(updated["indiciMercato"]["psv"], parameters["indiciMercato"]["psv"])
        self.assertEqual(updated["parametriCalcolo"], parameters["parametriCalcolo"])

    def test_semantic_variable_price_uses_supplied_pun(self):
        values = [
            {
                "ruolo": "spread_corrente_candidato",
                "valore": 0.0278,
                "unitaMisura": "€/kWh",
            }
        ]
        price, quality, provenance, error = MODULE.semantic_price(
            values,
            "luce",
            "variabile",
            {"pun": 0.1325, "psv": 0.504419055},
        )
        self.assertEqual(error, "")
        self.assertEqual(quality, "indice_piu_spread_semantico")
        self.assertAlmostEqual(price, 0.1603, places=8)
        self.assertEqual(provenance["valoreIndice"], 0.1325)

    def test_main_publishes_arera_and_pun_atomically(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "package"
            source = Path(tmp) / "xml"
            source.mkdir(parents=True)
            (root / "data").mkdir(parents=True)
            parameters = {
                "versioneDati": "old",
                "fonte": "old",
                "aggiornatoIl": "2026-07-03",
                "parametriCalcolo": {},
                "indiciMercato": {
                    "pun": {"label": "PUN", "valore": 0.119351258, "unita": "eur_kwh"},
                    "psv": {"label": "PSV", "valore": 0.504419055, "unita": "eur_smc"},
                    "psbg": {"label": "PSBG", "valore": 0.504419055, "unita": "eur_smc"},
                },
            }
            (root / "data" / "calcolo-parametri.json").write_text(
                json.dumps(parameters), encoding="utf-8"
            )
            light_code = "000155ESFML04XXZZ05103Z260711E01"
            gas_code = "000155GSFML04XXZZZZ05102Z260711G"
            (source / "PO_Offerte_E_MLIBERO_20260716.xml").write_text(
                offer_xml(
                    code=light_code,
                    name="Illumia Luce Test",
                    customer_type="01",
                    duration=12,
                    piva="02356770988",
                    components=[
                        component("Prezzo base", [("00", 0.11)], "03"),
                        component("Quota vendita", [("00", 84)], "01"),
                    ],
                ),
                encoding="utf-8",
            )
            (source / "PO_Offerte_G_MLIBERO_20260716.xml").write_text(
                offer_xml(
                    code=gas_code,
                    name="Illumia Gas Test",
                    customer_type="01",
                    duration=12,
                    piva="02356770988",
                    components=[
                        component("Prezzo base", [("00", 0.49)], "04"),
                        component("Quota vendita", [("00", 84)], "01"),
                    ],
                ),
                encoding="utf-8",
            )
            (source / "PO_Offerte_D_MLIBERO_20260716.xml").write_text(
                dual_xml(
                    code="000155DSFML01XX05103SFMX05102SFM",
                    light_code=light_code,
                    gas_code=gas_code,
                    name="Illumia Dual Test",
                ),
                encoding="utf-8",
            )
            snapshot = {
                "periodo": "2026-06",
                "periodoLabel": "Giugno 2026",
                "titolo": "Dati di sintesi elettrico - Giugno 2026",
                "urlFonte": "https://gme.test/notice",
                "urlDocumento": "https://gme.test/document.pdf",
                "pubblicatoIl": "2026-07-14",
                "label": "PUN Index GME",
                "valore": 0.1325,
                "unita": "eur_kwh",
                "valoreOriginale": 132.5,
                "unitaOriginale": "eur_mwh",
                "fonte": MODULE.GME_SOURCE_LABEL,
                "stato": "ufficiale",
                "acquisitoIl": "2026-07-16",
            }
            argv = [
                "update-arera-menu.py",
                "--source-dir",
                str(source),
                "--package-root",
                str(root),
                "--as-of",
                "2026-07-16",
            ]
            with mock.patch.object(MODULE, "download_previous_month_pun", return_value=snapshot), mock.patch.object(
                sys, "argv", argv
            ):
                result = MODULE.main()

            data_parameters = json.loads(
                (root / "data" / "calcolo-parametri.json").read_text(encoding="utf-8")
            )
            public_parameters = json.loads(
                (root / "public" / "data" / "calcolo-parametri.json").read_text(encoding="utf-8")
            )
            offers = json.loads(
                (root / "data" / "offerte-arera-menu.json").read_text(encoding="utf-8")
            )

        self.assertEqual(result, 0)
        self.assertEqual(data_parameters, public_parameters)
        self.assertEqual(data_parameters["indiciMercato"]["pun"]["valore"], 0.1325)
        self.assertEqual(offers["indiciUsati"]["pun"], 0.1325)
        self.assertEqual(offers["indiciDettaglio"]["pun"]["periodo"], "2026-06")
        self.assertEqual(len(offers["offerteDual"]), 1)

    def test_atomic_publish_keeps_calculation_parameter_copies_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            parameters = {"indiciMercato": {"pun": {"valore": 0.1325}}}
            targets = MODULE.atomic_publish(
                root,
                {"offerte": [], "statistiche": {}},
                {"pubblicazioneAutorizzata": True},
                parameters,
            )
            data_parameters = json.loads(
                (root / "data" / "calcolo-parametri.json").read_text(encoding="utf-8")
            )
            public_parameters = json.loads(
                (root / "public" / "data" / "calcolo-parametri.json").read_text(encoding="utf-8")
            )
        self.assertEqual(data_parameters, public_parameters)
        self.assertEqual(data_parameters["indiciMercato"]["pun"]["valore"], 0.1325)
        self.assertEqual(len(targets), 5)

    def test_pun_only_updates_parameter_files_without_arera_pipeline(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "package"
            (root / "data").mkdir(parents=True)
            parameters = {
                "versioneDati": "old",
                "fonte": "old",
                "aggiornatoIl": "2026-07-03",
                "parametriCalcolo": {"perditeReteLuceVariabile": 1.102},
                "indiciMercato": {
                    "pun": {"label": "PUN", "valore": 0.119351258, "unita": "eur_kwh"},
                    "psv": {"label": "PSV", "valore": 0.504419055, "unita": "eur_smc"},
                    "psbg": {"label": "PSBG", "valore": 0.504419055, "unita": "eur_smc"},
                },
            }
            (root / "data" / "calcolo-parametri.json").write_text(
                json.dumps(parameters), encoding="utf-8"
            )
            snapshot = {
                "periodo": "2026-06",
                "periodoLabel": "Giugno 2026",
                "titolo": "Dati di sintesi elettrico - Giugno 2026",
                "urlFonte": "https://gme.test/notice",
                "urlDocumento": "https://gme.test/document.pdf",
                "pubblicatoIl": "2026-07-14",
                "label": "PUN Index GME",
                "valore": 0.1325,
                "unita": "eur_kwh",
                "valoreOriginale": 132.5,
                "unitaOriginale": "eur_mwh",
                "fonte": MODULE.GME_SOURCE_LABEL,
                "stato": "ufficiale",
                "acquisitoIl": "2026-07-27",
            }
            argv = [
                "update-arera-menu.py",
                "--pun-only",
                "--package-root",
                str(root),
                "--as-of",
                "2026-07-27",
            ]
            with mock.patch.object(MODULE, "download_previous_month_pun", return_value=snapshot), mock.patch.object(
                MODULE, "download_current_files", side_effect=AssertionError("ARERA non deve partire")
            ), mock.patch.object(sys, "argv", argv):
                result = MODULE.main()

            data_parameters = json.loads(
                (root / "data" / "calcolo-parametri.json").read_text(encoding="utf-8")
            )
            public_parameters = json.loads(
                (root / "public" / "data" / "calcolo-parametri.json").read_text(encoding="utf-8")
            )

            self.assertEqual(result, 0)
            self.assertEqual(data_parameters, public_parameters)
            self.assertEqual(data_parameters["indiciMercato"]["pun"]["valore"], 0.1325)
            self.assertEqual(data_parameters["indiciMercato"]["pun"]["periodo"], "2026-06")
            self.assertEqual(data_parameters["indiciMercato"]["psv"], parameters["indiciMercato"]["psv"])
            self.assertFalse((root / "data" / "offerte-arera-menu.json").exists())
            self.assertFalse((root / "data" / "arera-update-report.json").exists())

    def test_pun_only_waiting_period_keeps_both_parameter_files_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "package"
            data_path = root / "data" / "calcolo-parametri.json"
            public_path = root / "public" / "data" / "calcolo-parametri.json"
            data_path.parent.mkdir(parents=True)
            public_path.parent.mkdir(parents=True)
            parameters = {
                "versioneDati": "old",
                "aggiornatoIl": "2026-07-03",
                "indiciMercato": {
                    "pun": {"valore": 0.119351258},
                    "psv": {"valore": 0.504419055},
                },
            }
            original = json.dumps(parameters, ensure_ascii=False, indent=2) + "\n"
            data_path.write_text(original, encoding="utf-8")
            public_path.write_text(original, encoding="utf-8")
            argv = [
                "update-arera-menu.py",
                "--pun-only",
                "--package-root",
                str(root),
                "--as-of",
                "2026-07-01",
            ]
            with mock.patch.object(MODULE, "download_previous_month_pun", return_value=None), mock.patch.object(
                MODULE, "download_current_files", side_effect=AssertionError("ARERA non deve partire")
            ), mock.patch.object(sys, "argv", argv):
                result = MODULE.main()

            self.assertEqual(result, 0)
            self.assertEqual(data_path.read_text(encoding="utf-8"), original)
            self.assertEqual(public_path.read_text(encoding="utf-8"), original)
            self.assertFalse((root / "data" / "arera-update-report.json").exists())

    def test_pun_only_failure_does_not_write_arera_report_or_change_parameters(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "package"
            data_path = root / "data" / "calcolo-parametri.json"
            data_path.parent.mkdir(parents=True)
            parameters = {
                "versioneDati": "old",
                "indiciMercato": {
                    "pun": {"valore": 0.119351258},
                    "psv": {"valore": 0.504419055},
                },
            }
            original = json.dumps(parameters)
            data_path.write_text(original, encoding="utf-8")
            argv = [
                "update-arera-menu.py",
                "--pun-only",
                "--package-root",
                str(root),
                "--as-of",
                "2026-07-27",
            ]
            with mock.patch.object(
                MODULE, "download_previous_month_pun", side_effect=RuntimeError("GME non disponibile")
            ), mock.patch.object(MODULE, "download_current_files", side_effect=AssertionError("ARERA non deve partire")), mock.patch.object(
                sys, "argv", argv
            ):
                result = MODULE.main()

            self.assertEqual(result, 1)
            self.assertEqual(data_path.read_text(encoding="utf-8"), original)
            self.assertFalse((root / "public" / "data" / "calcolo-parametri.json").exists())
            self.assertFalse((root / "data" / "arera-update-report.json").exists())

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
