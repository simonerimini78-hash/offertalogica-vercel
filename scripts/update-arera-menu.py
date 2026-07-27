#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin


NS = {"po": "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"}
OPEN_DATA_URL = "https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page"
SOURCE_LABEL = "Portale Offerte ARERA/Acquirente Unico Open Data"
GME_ELECTRIC_NOTICES_URL = (
    "https://gme.mercatoelettrico.org/Home/AvvisieComunicati/AvvisieComunicatiME"
)
GME_SOURCE_LABEL = "Gestore dei Mercati Energetici (GME)"
ITALIAN_MONTHS = (
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre",
)
# Valori usati soltanto dalle funzioni isolate e dai test che non caricano il JSON
# del progetto. Il flusso principale legge sempre gli indici pubblicati in
# data/calcolo-parametri.json e aggiorna il PUN dal documento ufficiale GME.
PUN_FALLBACK = 0.119351258
PSV_FALLBACK = 0.504419055
REFERENCE_CONSUMPTION = {"luce": 2700, "gas": 700}
PRICE_CHANGE_TOLERANCE = 0.02
FEE_CHANGE_TOLERANCE = 24.0
BLOCKED_PRICE_QUALITIES = {
    "media_fasce",
    "media_fasce_pun_fallback",
    "media_fasce_psv_fallback",
}
ALLOWED_PRICE_QUALITIES = {
    "prezzo_esplicito",
    "indice_piu_spread_semantico",
    "verificato_specifica_commerciale",
}
PRIMARY_PRICE_PATTERNS = (
    r"\bcosto\s+per\s+consumi\b",
    r"\bprezzo\s+(?:luce|energia|gas)\b",
    r"\bprezzo\s+componente\s+(?:energia\s+elettricit.|materia\s+prima\s+gas)\b",
    r"\bprezzo\s+fisso\s+(?:energia|gas)\b",
    r"\bprezzo\s+quota\s+energia\b",
    r"\bprezzo\s+base\b",
    r"\bprezzo\s+(?:della\s+)?materia(?:\s+prima)?\b",
    r"\bcomponente\s+(?:energia|gas)\b",
    r"\bcomponente\s+sostitutiva\s+materia\s+prima\s+gas\b",
    r"\bcorrispettivo\s+(?:luce|gas)\b",
    r"\bcorrispettivo\s+per\s+il\s+consumo\b",
    r"^prezzo(?:\s+prezzo)?$",
)
SPREAD_PATTERNS = (
    r"\bspread\b",
    r"corrispettivo.*mercato\s+all.?ingrosso",
)
BLOCKED_COMPONENT_PATTERNS = (
    r"dispacciament",
    r"remunerazione.*capacita",
    r"\bcapacita\b",
    r"commercializz",
    r"adeguamento.*consum",
    r"onere.*adeguamento",
    r"bilanciament",
    r"quota\s+vendita\s+variabile",
    r"gestione\s+fornitura",
    r"opzione\s+verde",
)
FUTURE_COMPONENT_PATTERNS = (
    r"dal\s+\d+.?\s*mese",
    r"a\s+partire\s+dal\s+\d+.?\s*mese",
    r"dopo\s+\d+\s+mesi",
)
UNIT_CODES = {"01": "€/anno", "02": "€/mese", "03": "€/kWh", "04": "€/Smc"}
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
}


class AnchorCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.anchors: list[tuple[str, str]] = []
        self.text_parts: list[str] = []
        self._href: str | None = None
        self._label_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        self._href = next((value for name, value in attrs if name.lower() == "href"), None)
        self._label_parts = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text_parts.append(data)
        if self._href is not None:
            self._label_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._href is None:
            return
        self.anchors.append((self._href, " ".join(self._label_parts).strip()))
        self._href = None
        self._label_parts = []


def previous_month_reference(as_of: datetime) -> tuple[int, int, str, str]:
    previous = as_of.replace(day=1) - timedelta(days=1)
    label = f"{ITALIAN_MONTHS[previous.month - 1]} {previous.year}"
    period = f"{previous.year:04d}-{previous.month:02d}"
    return previous.year, previous.month, period, label


def parse_html_links(page: str) -> AnchorCollector:
    parser = AnchorCollector()
    parser.feed(page)
    parser.close()
    return parser


def find_exact_link(page: str, base_url: str, expected_label: str) -> str | None:
    expected = normalize_text(expected_label)
    parser = parse_html_links(page)
    for href, label in parser.anchors:
        if href and normalize_text(label) == expected:
            return urljoin(base_url, href.replace("\\", "/")) urljoin(base_url, href)
    return None


def find_pdf_link(page: str, base_url: str, expected_label: str) -> str | None:
    exact = find_exact_link(page, base_url, expected_label)
    if exact and exact.lower().split("?", 1)[0].endswith(".pdf"):
        return exact
    parser = parse_html_links(page)
    for href, label in parser.anchors:
        absolute = urljoinabsolute = urljoin(base_url, (href or "").replace("\\", "/"))base_url, href or "")
        if absolute.lower().split("?", 1)[0].endswith(".pdf"):
            if normalize_text(expected_label) in normalize_text(label) or not label.strip():
                return absolute
    return None


def fetch_url(url: str, *, timeout: int = 60) -> tuple[bytes, str, str]:
    request = urllib.request.Request(url, headers=BROWSER_HEADERS)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
        final_url = response.geturl()
        content_type = response.headers.get_content_type()
    return body, final_url, content_type


def publication_date_from_page(page: str) -> str:
    text = " ".join(parse_html_links(page).text_parts)
    match = re.search(r"\b(\d{2})/(\d{2})/(\d{4})\b", text)
    if not match:
        return ""
    day, month, year = match.groups()
    return f"{year}-{month}-{day}"


def discover_gme_pun_document(as_of: datetime) -> dict[str, str] | None:
    _, _, period, period_label = previous_month_reference(as_of)
    expected_title = f"Dati di sintesi elettrico - {period_label}"
    listing_bytes, listing_url, _ = fetch_url(GME_ELECTRIC_NOTICES_URL)
    listing_page = listing_bytes.decode("utf-8", errors="replace")
    notice_url = find_exact_link(listing_page, listing_url, expected_title)
    if not notice_url:
        return None

    notice_bytes, notice_final_url, _ = fetch_url(notice_url)
    notice_page = notice_bytes.decode("utf-8", errors="replace")
    document_url = find_pdf_link(notice_page, notice_final_url, expected_title)
    if not document_url:
        raise RuntimeError(f"Documento PDF GME non trovato per {period_label}")

    return {
        "periodo": period,
        "periodoLabel": period_label,
        "titolo": expected_title,
        "urlFonte": notice_final_url,
        "urlDocumento": document_url,
        "pubblicatoIl": publication_date_from_page(notice_page),
    }


def extract_first_page_pdf_text(pdf_path: Path) -> str:
    executable = shutil.which("pdftotext")
    if not executable:
        raise RuntimeError("pdftotext non disponibile: installare poppler-utils nel workflow")
    result = subprocess.run(
        [executable, "-f", "1", "-l", "1", "-layout", str(pdf_path), "-"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    if result.returncode != 0:
        detail = (result.stderr or "").strip()
        raise RuntimeError(f"Estrazione PDF GME non riuscita: {detail or result.returncode}")
    if not result.stdout.strip():
        raise RuntimeError("Il PDF GME non contiene testo estraibile nella prima pagina")
    return result.stdout


def parse_gme_pun_text(text: str, expected_period_label: str) -> tuple[float, float]:
    normalized = normalize_text(text)
    if normalize_text(expected_period_label) not in normalized:
        raise ValueError(f"Periodo GME inatteso: atteso {expected_period_label}")
    if "mercato del giorno prima" not in normalized:
        raise ValueError("Sezione 'Mercato del Giorno Prima' assente nel documento GME")

    match = re.search(r"\bBaseload\s+([0-9]{1,4}(?:[.,][0-9]{1,6})?)\b", text, re.I)
    if not match:
        raise ValueError("Valore Baseload non trovato nel documento GME")
    eur_mwh = float(match.group(1).replace(",", "."))
    if not 0 < eur_mwh < 1000:
        raise ValueError(f"Valore Baseload GME non plausibile: {eur_mwh}")
    return eur_mwh, round(eur_mwh / 1000, 9)


def download_previous_month_pun(as_of: datetime) -> dict[str, object] | None:
    document = discover_gme_pun_document(as_of)
    if document is None:
        _, _, _, period_label = previous_month_reference(as_of)
        if as_of.day > 20:
            raise RuntimeError(
                f"Pubblicazione mensile GME non trovata per {period_label} oltre la finestra di attesa"
            )
        return None

    pdf_bytes, final_url, content_type = fetch_url(str(document["urlDocumento"]))
    if not pdf_bytes.startswith(b"%PDF") and content_type != "application/pdf":
        raise RuntimeError(f"Il documento GME non e un PDF valido: {content_type}")

    with tempfile.TemporaryDirectory(prefix="offertalogica-gme-") as tmp:
        pdf_path = Path(tmp) / "dati-sintesi-gme.pdf"
        pdf_path.write_bytes(pdf_bytes)
        text = extract_first_page_pdf_text(pdf_path)

    eur_mwh, eur_kwh = parse_gme_pun_text(text, str(document["periodoLabel"]))
    return {
        **document,
        "urlDocumento"urlDocumento": final_url.replace("\\", "/"),: final_url,
        "label": "PUN Index GME",
        "valore": eur_kwh,
        "unita": "eur_kwh",
        "valoreOriginale": eur_mwh,
        "unitaOriginale": "eur_mwh",
        "fonte": GME_SOURCE_LABEL,
        "stato": "ufficiale",
        "acquisitoIl": as_of.strftime("%Y-%m-%d"),
    }


def load_calculation_parameters(root: Path) -> dict[str, object]:
    path = root / "data" / "calcolo-parametri.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON non valido: {path}")
    return payload


def market_index_values(parameters: dict[str, object]) -> dict[str, float]:
    indices = parameters.get("indiciMercato")
    if not isinstance(indices, dict):
        raise ValueError("indiciMercato assente in calcolo-parametri.json")
    values: dict[str, float] = {}
    for key in ("pun", "psv", "psbg"):
        item = indices.get(key)
        if not isinstance(item, dict):
            continue
        try:
            value = float(item.get("valore"))
        except (TypeError, ValueError):
            continue
        if value > 0:
            values[key] = value
    if "pun" not in values or "psv" not in values:
        raise ValueError("PUN o PSV non validi in calcolo-parametri.json")
    return values


def apply_pun_snapshot(
    parameters: dict[str, object], snapshot: dict[str, object] | None, as_of: datetime
) -> dict[str, object]:
    updated = copy.deepcopy(parameters)
    if snapshot is None:
        return updated
    indices = updated.setdefault("indiciMercato", {})
    if not isinstance(indices, dict):
        raise ValueError("indiciMercato non modificabile in calcolo-parametri.json")
    pun = indices.setdefault("pun", {})
    if not isinstance(pun, dict):
        raise ValueError("Voce PUN non modificabile in calcolo-parametri.json")
    pun.clear()
    pun.update(
        {
            "label": snapshot["label"],
            "valore": snapshot["valore"],
            "unita": snapshot["unita"],
            "periodo": snapshot["periodo"],
            "periodoLabel": snapshot["periodoLabel"],
            "valoreOriginale": snapshot["valoreOriginale"],
            "unitaOriginale": snapshot["unitaOriginale"],
            "fonte": snapshot["fonte"],
            "urlFonte": snapshot["urlFonte"],
            "urlDocumento": snapshot["urlDocumento"],
            "pubblicatoIl": snapshot.get("pubblicatoIl") or "",
            "acquisitoIl": snapshot["acquisitoIl"],
            "stato": snapshot["stato"],
            "note": (
                f"PUN Index GME medio {snapshot['periodoLabel']}: "
                f"{float(snapshot['valoreOriginale']):.6f} eur/MWh, "
                f"convertito in {float(snapshot['valore']):.9f} eur/kWh."
            ),
        }
    )
    updated["versioneDati"] = (
        f"parametri-calcolo-{as_of.strftime('%Y-%m-%d')}-pun-{snapshot['periodo']}"
    )
    updated["aggiornatoIl"] = as_of.strftime("%Y-%m-%d")
    updated["fonte"] = (
        "Configurazione OffertaLogica aggiornabile; PUN acquisito dalla pubblicazione "
        "mensile ufficiale GME del mese precedente."
    )
    return updated


def market_index_for(commodity: str, market_indices: dict[str, float] | None = None) -> float:
    values = market_indices or {"pun": PUN_FALLBACK, "psv": PSV_FALLBACK}
    key = "pun" if commodity == "luce" else "psv"
    value = float(values.get(key, 0))
    if value <= 0:
        raise ValueError(f"Indice di mercato non valido: {key}")
    return value


def log_info(message: str) -> None:
    print(f"[ARERA] {message}", flush=True)


def log_error(message: str) -> None:
    print(f"[ARERA] ERRORE: {message}", file=sys.stderr, flush=True)


class AreraFilesNotFound(FileNotFoundError):
    pass


@dataclass(frozen=True)
class ProviderRule:
    key: str
    label: str
    patterns: tuple[str, ...]
    piva: tuple[str, ...] = ()
    code_prefixes: tuple[str, ...] = ()


PROVIDERS: tuple[ProviderRule, ...] = (
    ProviderRule("a2a", "A2A Energia", (r"\ba2a\b",)),
    ProviderRule("acea", "Acea Energia", (r"\bacea\b", r"acea energia")),
    ProviderRule("agasco", "Agasco", (r"\bagasco\b",)),
    ProviderRule("alperia", "Alperia", (r"\balperia\b",)),
    ProviderRule("amga", "Amga", (r"\bamga\b",)),
    ProviderRule("argos", "Argos", (r"\bargos\b",)),
    ProviderRule("axpo", "Axpo Energia", (r"\baxpo\b", r"axpo"), ("01141160992",)),
    ProviderRule("dolomiti", "Dolomiti Energia", (r"\bdolomiti\b",)),
    ProviderRule("eco", "E.CO Energia Corrente", (), (), ("000742",)),
    ProviderRule("eon", "E.ON", (r"\be\.?\s*on\b",), ("03429130234",)),
    ProviderRule("edison", "Edison", (r"\bedison\b",)),
    ProviderRule("eni", "Eni Plenitude", (r"\bplenitude\b", r"\beni\b"), ("12300020158",)),
    ProviderRule("enel", "Enel Energia", (r"\benel\b",)),
    ProviderRule("enercom", "Enercom", (r"\benercom\b",)),
    ProviderRule("engie", "Engie", (r"\bengie\b",)),
    ProviderRule("eja", "Eja Energia", (r"\beja\b",)),
    ProviderRule("hera", "Hera Comm", (r"\bhera\b",)),
    ProviderRule("illum", "Illumia", (r"\billumia\b",), ("02356770988",)),
    ProviderRule("iren", "Iren Luce e Gas", (r"\biren\b",)),
    ProviderRule("magis", "Magis Energia", (r"\bmagis\b",)),
    ProviderRule("nen", "neN", (r"\bnen\b", r"\bne n\b")),
    ProviderRule("nova", "Nova Aeg", (r"\bnova aeg\b",)),
    ProviderRule("octopus", "Octopus Energy", (r"\boctopus\b",)),
    ProviderRule("optima", "Optima Italia", (r"\boptima\b",)),
    ProviderRule("poste", "Poste Energia", (r"\bposte energia\b",)),
    ProviderRule("pulsee", "Pulsee Luce e Gas", (r"\bpulsee\b",)),
    ProviderRule("sen", "Servizio Elettrico Nazionale", (r"servizio elettrico nazionale",)),
    ProviderRule("sorgenia", "Sorgenia", (r"\bsorgenia\b",)),
    ProviderRule("tate", "Tate", (r"\btate\b",)),
    ProviderRule("vivi", "Vivi Energia", (r"\bvivi(?:\s+energia|attivo|clear|web)?\b",)),
    ProviderRule("wekiwi", "Wekiwi", (r"\bwekiwi\b",)),
    ProviderRule("sinergy", "Sinergy", (r"\bsinergy\b",)),
)

EXCLUDED_OFFER_WORDS = (
    "altri usi",
    "azienda",
    "business",
    "condominio",
    "condominiale",
    "corporate",
    "impresa",
    "partite iva",
    "piva",
    "professionisti",
    "pubblica amministrazione",
)


def node_text(node: ET.Element, path: str) -> str:
    found = node.find(path, NS)
    return (found.text or "").strip() if found is not None else ""


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def parse_portale_date(value: str) -> datetime | None:
    if not value:
        return None
    for fmt in ("%d/%m/%Y_%H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def parse_float(value: str) -> float | None:
    if value is None:
        return None
    cleaned = str(value).strip().replace(",", ".")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def provider_for(offer: ET.Element) -> tuple[str, str] | None:
    piva = node_text(offer, "po:IdentificativiOfferta/po:PIVA_UTENTE")
    code = node_text(offer, "po:IdentificativiOfferta/po:COD_OFFERTA")
    name = normalize_text(node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA"))
    description = normalize_text(node_text(offer, "po:DettaglioOfferta/po:DESCRIZIONE"))
    offer_url = normalize_text(node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_OFFERTA"))
    seller_url = normalize_text(node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_SITO_VENDITORE"))

    # I prefissi espliciti hanno precedenza assoluta: servono per marchi come
    # E.CO, il cui nome descrittivo compare anche in offerte di altri venditori.
    for rule in PROVIDERS:
        if rule.code_prefixes:
            if any(code.startswith(prefix) for prefix in rule.code_prefixes):
                return rule.key, rule.label

    candidates: list[tuple[int, int, ProviderRule]] = []
    for order, rule in enumerate(PROVIDERS):
        if rule.code_prefixes:
            continue
        score = 0
        for pattern in rule.patterns:
            if name and re.search(pattern, name):
                score = max(score, 100)
            if description and re.search(pattern, description):
                score = max(score, 80)
            if code and re.search(pattern, normalize_text(code)):
                score = max(score, 70)
            if offer_url and re.search(pattern, offer_url):
                score = max(score, 50)
            if seller_url and re.search(pattern, seller_url):
                score = max(score, 30)
        if piva and piva in rule.piva:
            score = max(score, 60)
        if score:
            candidates.append((score, -order, rule))

    if not candidates:
        return None
    _, _, selected = max(candidates, key=lambda item: (item[0], item[1]))
    return selected.key, selected.label


def customer_segment(offer: ET.Element) -> tuple[str, str]:
    raw = node_text(offer, "po:DettaglioOfferta/po:TIPO_CLIENTE")
    blob = normalize_text(
        " ".join(
            [
                node_text(offer, "po:IdentificativiOfferta/po:COD_OFFERTA"),
                node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA"),
                node_text(offer, "po:DettaglioOfferta/po:DESCRIZIONE"),
                node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_OFFERTA"),
            ]
        )
    )
    if raw == "01" and not any(word in blob for word in EXCLUDED_OFFER_WORDS):
        return "privato", raw
    if raw == "02" or any(word in blob for word in EXCLUDED_OFFER_WORDS):
        return "business", raw
    return "sconosciuto", raw


def interval_applies(interval: ET.Element, annual_consumption: float) -> bool:
    lower = parse_float(node_text(interval, "po:CONSUMO_DA"))
    upper = parse_float(node_text(interval, "po:CONSUMO_A"))
    if lower is not None and annual_consumption < lower:
        return False
    if upper is not None and annual_consumption > upper:
        return False
    return True


def matches_any(value: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pattern, value, re.I) for pattern in patterns)


def unit_for_commodity(commodity: str) -> str:
    return "03" if commodity == "luce" else "04"


def source_label_for(path: Path) -> str:
    return f"{SOURCE_LABEL} - {path.name}"


def extracted_values(
    offer: ET.Element,
    commodity: str,
    annual_consumption: float,
    source_path: Path,
    code: str,
    data_inizio: str,
    data_fine: str,
    tipo: str,
) -> list[dict[str, object]]:
    expected_unit = unit_for_commodity(commodity)
    values: list[dict[str, object]] = []
    for component_index, component in enumerate(offer.findall(".//po:ComponenteImpresa", NS), start=1):
        name = node_text(component, "po:NOME")
        description = node_text(component, "po:DESCRIZIONE")
        macroarea = node_text(component, "po:MACROAREA")
        typology = node_text(component, "po:TIPOLOGIA")
        context = normalize_text(f"{name} {description}")

        for interval_index, interval in enumerate(component.findall("po:IntervalloPrezzi", NS), start=1):
            value = parse_float(node_text(interval, "po:PREZZO"))
            if value is None or value < 0:
                continue
            unit = node_text(interval, "po:UNITA_MISURA")
            applies = interval_applies(interval, annual_consumption)
            role = "dettaglio_tecnico"
            rejected_reason = ""

            if not applies:
                role = "scartato"
                rejected_reason = "intervallo_consumo_non_applicabile"
            elif unit in {"01", "02"}:
                role = "quota_fissa_candidata"
            elif unit != expected_unit:
                role = "scartato"
                rejected_reason = "unita_non_compatibile"
            elif matches_any(context, BLOCKED_COMPONENT_PATTERNS):
                role = "dettaglio_tecnico"
                rejected_reason = "componente_non_principale"
            elif tipo == "fisso" and (
                matches_any(context, SPREAD_PATTERNS) or matches_any(context, FUTURE_COMPONENT_PATTERNS)
            ):
                role = "dettaglio_tecnico"
                rejected_reason = "valore_futuro_non_applicabile_al_periodo_fisso"
            elif tipo == "variabile" and matches_any(context, SPREAD_PATTERNS):
                 role = "spread_corrente_candidato"
            elif matches_any(context, PRIMARY_PRICE_PATTERNS):
                 role = "prezzo_principale_candidato"
            else:
                rejected_reason = "etichetta_non_compatibile_con_prezzo_principale"

            band = node_text(interval, "po:FASCIA_COMPONENTE") or "00"
            consumption_from = node_text(interval, "po:CONSUMO_DA")
            consumption_to = node_text(interval, "po:CONSUMO_A")
            nearby = " | ".join(
                part
                for part in (
                    name,
                    description if description != name else "",
                    f"macroarea {macroarea}" if macroarea else "",
                    f"tipologia {typology}" if typology else "",
                    f"fascia {band}" if band != "00" else "",
                    f"consumo {consumption_from}-{consumption_to}" if consumption_from or consumption_to else "",
                )
                if part
            )
            values.append(
                {
                    "valore": round(value, 8),
                    "sorgente": source_label_for(source_path),
                    "codiceOfferta": code,
                    "etichettaOriginale": name or description or "Componente senza etichetta",
                    "unitaMisuraCodice": unit,
                    "unitaMisura": UNIT_CODES.get(unit, f"codice {unit or 'assente'}"),
                    "periodoValidita": {
                        "dataInizio": data_inizio,
                        "dataFine": data_fine,
                        "consumoDa": consumption_from or None,
                        "consumoA": consumption_to or None,
                    },
                    "testoVicino": nearby,
                    "ruolo": role,
                    "motivoScarto": rejected_reason or None,
                    "fascia": band,
                    "componenteIndice": component_index,
                    "intervalloIndice": interval_index,
                }
            )
    return values


def annual_fee(values: list[dict[str, object]]) -> tuple[float | None, list[dict[str, object]]]:
    selected: list[dict[str, object]] = []
    by_component: dict[int, list[dict[str, object]]] = {}
    for item in values:
        if item["ruolo"] != "quota_fissa_candidata" or item["unitaMisuraCodice"] != "01":
            continue
        by_component.setdefault(int(item["componenteIndice"]), []).append(item)

    total = 0.0
    for component_values in by_component.values():
        unique: dict[float, dict[str, object]] = {}
        for item in component_values:
            unique[round(float(item["valore"]), 8)] = item
        positive = [value for value in unique if value > 0]
        chosen_value = max(positive) if positive else (max(unique) if unique else None)
        if chosen_value is None:
            continue
        chosen = copy.deepcopy(unique[chosen_value])
        chosen["ruolo"] = "quota_fissa_selezionata"
        selected.append(chosen)
        total += chosen_value

    return (round(total, 4), selected) if selected else (None, [])


def semantic_price(
    values: list[dict[str, object]],
    commodity: str,
    tipo: str,
    market_indices: dict[str, float] | None = None,
) -> tuple[float | None, str, dict[str, object] | None, str]:
    primary = [item for item in values if item["ruolo"] == "prezzo_principale_candidato"]
    unique_primary = sorted({round(float(item["valore"]), 8) for item in primary})

    if len(unique_primary) == 1:
        selected_value = unique_primary[0]
        selected = next(item for item in primary if round(float(item["valore"]), 8) == selected_value)
        provenance = copy.deepcopy(selected)
        provenance["ruolo"] = "prezzo_principale_selezionato"
        if tipo == "variabile":
            threshold = 0.08 if commodity == "luce" else 0.25
            if selected_value < threshold:
                index_value = market_index_for(commodity, market_indices)
                provenance["indiceApplicato"] = "PUN" if commodity == "luce" else "PSV"
                provenance["valoreIndice"] = index_value
                return (
                    round(index_value + selected_value, 8),
                    "indice_piu_spread_semantico",
                    provenance,
                    "",
                )
        return selected_value, "prezzo_esplicito", provenance, ""

    if not unique_primary and tipo == "variabile":
        spreads = [item for item in values if item["ruolo"] == "spread_corrente_candidato"]
        unique_spreads = sorted({round(float(item["valore"]), 8) for item in spreads})
        if len(unique_spreads) == 1:
            spread = unique_spreads[0]
            selected = next(item for item in spreads if round(float(item["valore"]), 8) == spread)
            provenance = copy.deepcopy(selected)
            provenance["ruolo"] = "spread_corrente_selezionato"
            index_value = market_index_for(commodity, market_indices)
            provenance["indiceApplicato"] = "PUN" if commodity == "luce" else "PSV"
            provenance["valoreIndice"] = index_value
            return round(index_value + spread, 8), "indice_piu_spread_semantico", provenance, ""

    if len(unique_primary) > 1:
        return None, "", None, "prezzo_multifascia_senza_sintesi_verificata"
    return None, "", None, "nessun_prezzo_principale_semanticamente_compatibile"


def load_verified_overrides(root: Path) -> dict[str, dict[str, object]]:
    path = root / "data" / "arera-verified-price-overrides.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    offers = payload.get("offerte", {})
    if not isinstance(offers, dict):
        raise ValueError(f"Formato override non valido: {path}")
    return offers


def apply_verified_override(
    override: dict[str, object] | None,
    *,
    code: str,
    commodity: str,
    customer_type: str,
    tipo: str,
    duration: int | None,
    data_inizio: str,
    data_fine: str,
) -> tuple[float | None, float | None, str, dict[str, object] | None, list[dict[str, object]]]:
    if not override:
        return None, None, "", None, []
    expected = {
        "commodity": commodity,
        "customerType": customer_type,
        "tipo": tipo,
        "durataMesi": duration,
    }
    for field, actual in expected.items():
        configured = override.get(field)
        if configured is not None and configured != actual:
            raise ValueError(
                f"Override verificato incoerente per {code}: {field}={configured!r}, XML={actual!r}"
            )

    price_data = override.get("prezzoSintetico") or {}
    price = parse_float(str(price_data.get("valore", "")))
    fee = parse_float(str(override.get("quotaFissaAnnua", "")))
    if price is None or price <= 0:
        raise ValueError(f"Override verificato senza prezzo sintetico valido per {code}")

    provenance = {
        "valore": round(price, 8),
        "sorgente": price_data.get("sorgente") or override.get("sorgente") or "Verifica commerciale documentale",
        "codiceOfferta": code,
        "etichettaOriginale": price_data.get("etichettaOriginale") or "Prezzo sintetico verificato per il confronto",
        "unitaMisuraCodice": unit_for_commodity(commodity),
        "unitaMisura": "€/kWh" if commodity == "luce" else "€/Smc",
        "periodoValidita": {"dataInizio": data_inizio, "dataFine": data_fine},
        "testoVicino": price_data.get("testoVicino") or "Valore verificato sulle condizioni economiche dell'offerta.",
        "ruolo": "prezzo_principale_selezionato",
        "motivoScarto": None,
    }
    details = copy.deepcopy(override.get("dettagliTecnici") or [])
    return round(price, 8), round(fee, 4) if fee is not None else None, "verificato_specifica_commerciale", provenance, details


def score_for(commodity: str, price: float, fee: float) -> float:
    return round((REFERENCE_CONSUMPTION[commodity] * price) + fee, 4)


def parse_offer_file(
    path: Path,
    commodity: str,
    as_of: datetime,
    overrides: dict[str, dict[str, object]] | None = None,
    diagnostics: list[dict[str, object]] | None = None,
    market_indices: dict[str, float] | None = None,
) -> list[dict[str, object]]:
    tree = ET.parse(path)
    rows: list[dict[str, object]] = []
    overrides = overrides or {}
    diagnostics = diagnostics if diagnostics is not None else []

    for offer in tree.findall(".//po:offerta", NS):
        match = provider_for(offer)
        if not match:
            continue

        data_inizio = node_text(offer, "po:ValiditaOfferta/po:DATA_INIZIO")
        data_fine = node_text(offer, "po:ValiditaOfferta/po:DATA_FINE")
        end_date = parse_portale_date(data_fine)
        if end_date and end_date < as_of:
            continue

        tipo_raw = node_text(offer, "po:DettaglioOfferta/po:TIPO_OFFERTA")
        tipo = {"01": "fisso", "02": "variabile"}.get(tipo_raw, "")
        if tipo not in {"fisso", "variabile"}:
            continue

        provider_key, provider_label = match
        nome = node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA")
        url = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_OFFERTA")
        site = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_SITO_VENDITORE")
        code = node_text(offer, "po:IdentificativiOfferta/po:COD_OFFERTA")
        seller_vat = node_text(offer, "po:IdentificativiOfferta/po:PIVA_UTENTE")
        customer_type, customer_type_code = customer_segment(offer)
        duration_value = parse_float(node_text(offer, "po:DettaglioOfferta/po:DURATA"))
        duration = int(duration_value) if duration_value is not None else None
        values = extracted_values(
            offer,
            commodity,
            REFERENCE_CONSUMPTION[commodity],
            path,
            code,
            data_inizio,
            data_fine,
            tipo,
        )
        price, quality, price_provenance, price_error = semantic_price(
            values, commodity, tipo, market_indices
        )
        fee, fee_provenance = annual_fee(values)

        override_price, override_fee, override_quality, override_provenance, technical_details = apply_verified_override(
            overrides.get(code),
            code=code,
            commodity=commodity,
            customer_type=customer_type,
            tipo=tipo,
            duration=duration,
            data_inizio=data_inizio,
            data_fine=data_fine,
        )
        if override_price is not None:
            price = override_price
            quality = override_quality
            price_provenance = override_provenance
            if override_fee is not None:
                fee = override_fee

        if customer_type == "sconosciuto" or price is None or fee is None or price_provenance is None:
            diagnostics.append(
                {
                    "codiceOfferta": code,
                    "fornitore": provider_label,
                    "commodity": commodity,
                    "stato": "scartato",
                    "motivo": (
                        "tipo_cliente_non_riconosciuto"
                        if customer_type == "sconosciuto"
                        else price_error or "prezzo_o_quota_fissa_non_validi"
                    ),
                    "sorgente": source_label_for(path),
                }
            )
            continue

        rows.append(
            {
                "providerKey": provider_key,
                "providerLabel": provider_label,
                "fornitore": provider_label,
                "commodity": commodity,
                "tipo": tipo,
                "nome": nome or f"{provider_label} offerta {commodity}",
                "codice": code,
                "pivaVenditore": seller_vat,
                "dataInizio": data_inizio,
                "dataFine": data_fine,
                "customerType": customer_type,
                "tipoClienteCodice": customer_type_code,
                "tipoOffertaCodice": tipo_raw,
                "durataMesi": duration,
                "prezzo": price,
                "quotaFissaAnnua": fee,
                "url": url or site or "#",
                "fonte": f"{SOURCE_LABEL} - codice {code}",
                "score": score_for(commodity, price, fee),
                "qualitaPrezzo": quality,
                "provenienzaPrezzo": price_provenance,
                "provenienzaQuotaFissa": fee_provenance,
                "valoriEstratti": values,
                "dettagliTecnici": technical_details,
            }
        )

    return rows


def parse_dual_file(
    path: Path,
    light_rows: list[dict[str, object]],
    gas_rows: list[dict[str, object]],
    as_of: datetime,
    diagnostics: list[dict[str, object]] | None = None,
) -> list[dict[str, object]]:
    tree = ET.parse(path)
    diagnostics = diagnostics if diagnostics is not None else []
    light_by_code = {str(row.get("codice") or ""): row for row in light_rows}
    gas_by_code = {str(row.get("codice") or ""): row for row in gas_rows}
    rows: list[dict[str, object]] = []

    for offer in tree.findall(".//po:offerta", NS):
        code = node_text(offer, "po:IdentificativiOfferta/po:COD_OFFERTA")
        seller_vat = node_text(offer, "po:IdentificativiOfferta/po:PIVA_UTENTE")
        light_code = node_text(offer, "po:OffertaDual/po:OFFERTE_CONGIUNTE_EE")
        gas_code = node_text(offer, "po:OffertaDual/po:OFFERTE_CONGIUNTE_GAS")
        match = provider_for(offer)
        data_inizio = node_text(offer, "po:ValiditaOfferta/po:DATA_INIZIO")
        data_fine = node_text(offer, "po:ValiditaOfferta/po:DATA_FINE")
        end_date = parse_portale_date(data_fine)
        if end_date and end_date < as_of:
            continue

        def reject(reason: str) -> None:
            diagnostics.append(
                {
                    "recordType": "dual",
                    "codiceOfferta": code,
                    "codiceOffertaLuce": light_code,
                    "codiceOffertaGas": gas_code,
                    "commodity": "dual",
                    "stato": "scartato",
                    "motivo": reason,
                    "sorgente": source_label_for(path),
                }
            )

        if not match:
            continue
        if not code or not light_code or not gas_code:
            reject("riferimenti_dual_incompleti")
            continue

        tipo_raw = node_text(offer, "po:DettaglioOfferta/po:TIPO_OFFERTA")
        tipo = {"01": "fisso", "02": "variabile"}.get(tipo_raw, "")
        customer_type, customer_type_code = customer_segment(offer)
        light = light_by_code.get(light_code)
        gas = gas_by_code.get(gas_code)
        if light is None or gas is None:
            reject("componente_dual_non_validata")
            continue

        provider_key, provider_label = match
        if tipo not in {"fisso", "variabile"} or customer_type not in {"privato", "business"}:
            reject("metadati_dual_non_validi")
            continue
        if light.get("commodity") != "luce" or gas.get("commodity") != "gas":
            reject("commodity_dual_non_coerenti")
            continue
        if light.get("providerKey") != provider_key or gas.get("providerKey") != provider_key:
            reject("fornitore_componenti_dual_non_coerente")
            continue
        if light.get("tipo") != tipo or gas.get("tipo") != tipo:
            reject("tipo_prezzo_componenti_dual_non_coerente")
            continue
        if light.get("customerType") != customer_type or gas.get("customerType") != customer_type:
            reject("clientela_componenti_dual_non_coerente")
            continue

        duration_value = parse_float(node_text(offer, "po:DettaglioOfferta/po:DURATA"))
        duration = int(duration_value) if duration_value is not None else None
        name = node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA")
        url = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_OFFERTA")
        site = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_SITO_VENDITORE")
        rows.append(
            {
                "providerKey": provider_key,
                "providerLabel": provider_label,
                "fornitore": provider_label,
                "fornitura": "dual",
                "tipo": tipo,
                "nome": name or f"{provider_label} offerta dual",
                "codice": code,
                "pivaVenditore": seller_vat,
                "codiceOffertaLuce": light_code,
                "codiceOffertaGas": gas_code,
                "dataInizio": data_inizio,
                "dataFine": data_fine,
                "customerType": customer_type,
                "tipoClienteCodice": customer_type_code,
                "tipoOffertaCodice": tipo_raw,
                "durataMesi": duration,
                "url": url or site or "#",
                "fonte": f"{SOURCE_LABEL} - file D - codice {code}",
                "score": round(float(light["score"]) + float(gas["score"]), 4),
                "luce": copy.deepcopy(light),
                "gas": copy.deepcopy(gas),
            }
        )

    return rows


def extract_xml_links(open_data_html: str) -> dict[str, str]:
    links: dict[str, str] = {}
    pattern = re.compile(r'href=["\']([^"\']*PO_Offerte_([EGD])_MLIBERO_\d+\.xml)["\']', re.I)
    for href, kind in pattern.findall(open_data_html):
        kind = kind.upper()
        links[kind] = urljoin(OPEN_DATA_URL, html.unescape(href))
    if not all(kind in links for kind in ("E", "G", "D")):
        raise RuntimeError("Open Data XML luce/gas/dual non trovati nella pagina del Portale Offerte")
    return links


def download_file(url: str, path: Path) -> None:
    request = urllib.request.Request(url, headers=BROWSER_HEADERS)
    with urllib.request.urlopen(request, timeout=60) as response:
        path.write_bytes(response.read())


def direct_xml_links(days_back: int = 10, start_date: datetime | None = None) -> list[tuple[str, dict[str, str]]]:
    candidates: list[tuple[str, dict[str, str]]] = []
    today = start_date or datetime.now()
    for offset in range(days_back):
        day = today - timedelta(days=offset)
        stamp = day.strftime("%Y%m%d")
        folder = f"{day.year}_{day.month}"
        base = f"https://www.ilportaleofferte.it/portaleOfferte/resources/opendata/csv/offerteML/{folder}"
        candidates.append(
            (
                stamp,
                {
                    "E": f"{base}/PO_Offerte_E_MLIBERO_{stamp}.xml",
                    "G": f"{base}/PO_Offerte_G_MLIBERO_{stamp}.xml",
                    "D": f"{base}/PO_Offerte_D_MLIBERO_{stamp}.xml",
                },
            )
        )
    return candidates


def source_date_from_urls(urls: list[str]) -> str:
    dates: list[str] = []
    for url in urls:
        match = re.search(r"MLIBERO_(\d{8})\.xml", url, re.I)
        if match:
            dates.append(match.group(1))
    return min(dates) if dates else "non determinata"


def describe_files(files: dict[str, Path]) -> str:
    parts = []
    if "E" in files:
        parts.append(f"luce={files['E'].name}")
    if "G" in files:
        parts.append(f"gas={files['G'].name}")
    if "D" in files:
        parts.append(f"dual={files['D'].name}")
    return ", ".join(parts) or "nessun file"


def no_files_message(date_stamp: str) -> str:
    return (
        f"Nessun file ARERA trovato per la data {date_stamp}. "
        "Aggiornamento non eseguito. I dati esistenti non sono stati modificati."
    )


def download_link_set(links: dict[str, str], destination: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for kind, url in links.items():
        out = destination / Path(url).name
        download_file(url, out)
        files[kind] = out
    return files


def source_date_from_files(files: dict[str, Path]) -> datetime | None:
    dates: list[datetime] = []
    for path in files.values():
        match = re.search(r"MLIBERO_(\d{8})\.xml$", path.name, re.I)
        if not match:
            continue
        try:
            dates.append(datetime.strptime(match.group(1), "%Y%m%d"))
        except ValueError:
            continue
    if not dates:
        return None
    return min(dates)


def download_current_files(destination: Path, requested_date: datetime) -> dict[str, Path]:
    requested_stamp = requested_date.strftime("%Y%m%d")
    destination.mkdir(parents=True, exist_ok=True)
    log_info(f"Data ARERA cercata: {requested_stamp}.")
    try:
        log_info("Leggo la pagina Open Data del Portale Offerte.")
        request = urllib.request.Request(OPEN_DATA_URL, headers=BROWSER_HEADERS)
        with urllib.request.urlopen(request, timeout=60) as response:
            page = response.read().decode("utf-8", errors="replace")
        links = extract_xml_links(page)
        page_stamp = source_date_from_urls(list(links.values()))
        log_info(f"File ARERA trovati nella pagina Open Data per la data {page_stamp}.")
        files = download_link_set(links, destination)
        log_info(f"Download completato: {describe_files(files)}.")
        return files
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        log_info(f"Pagina Open Data non raggiungibile da questo ambiente ({error}). Provo i link XML diretti.")

    last_error: Exception | None = None
    searched_dates: list[str] = []
    for date_stamp, links in direct_xml_links(start_date=requested_date):
        searched_dates.append(date_stamp)
        log_info(f"Cerco file ARERA per la data {date_stamp}.")
        try:
            files = download_link_set(links, destination)
            log_info(f"File ARERA trovati per la data {date_stamp}: {describe_files(files)}.")
            return files
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code == 404:
                log_info(no_files_message(date_stamp))
            else:
                log_info(
                    f"Download ARERA non riuscito per la data {date_stamp}: "
                    f"HTTP {error.code} {error.reason}."
                )
            continue
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            log_info(f"Download ARERA non riuscito per la data {date_stamp}: {error}.")
            continue

    if len(searched_dates) == 1:
        raise RuntimeError(no_files_message(searched_dates[0]))
    raise RuntimeError(
        "Nessun file ARERA valido trovato per le date cercate "
        f"({', '.join(searched_dates)}). Aggiornamento non eseguito. "
        f"I dati esistenti non sono stati modificati. Ultimo errore: {last_error}"
    )


def latest_matching(source_dir: Path, patterns: tuple[str, ...]) -> Path:
    matches: list[Path] = []
    for pattern in patterns:
        matches.extend(source_dir.glob(pattern))
    if not matches:
        raise AreraFilesNotFound(f"Nessun file trovato in {source_dir} per {patterns}")
    return sorted(matches, key=lambda path: path.stat().st_mtime)[-1]


def local_files(source_dir: Path) -> dict[str, Path]:
    return {
        "E": latest_matching(source_dir, ("PO_Offerte_E_MLIBERO_*.xml", "offerte_elettrico*.xml")),
        "G": latest_matching(source_dir, ("PO_Offerte_G_MLIBERO_*.xml", "offerte_gas*.xml")),
        "D": latest_matching(source_dir, ("PO_Offerte_D_MLIBERO_*.xml", "offerte_dual*.xml")),
    }


def dedupe_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    best: dict[tuple[object, ...], dict[str, object]] = {}
    for row in rows:
        key = (row["providerKey"], row["commodity"], row["tipo"], row["codice"])
        current = best.get(key)
        if current is None or float(row["score"]) < float(current["score"]):
            best[key] = row
    return sorted(
        best.values(),
        key=lambda item: (
            str(item["providerKey"]),
            str(item["commodity"]),
            str(item["tipo"]),
            float(item["score"]),
            str(item["nome"]),
        ),
    )


def row_key(row: dict[str, object]) -> tuple[str, str]:
    return str(row.get("codice") or ""), str(row.get("commodity") or "")


def read_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON non valido: {path}")
    return payload


def existing_rows(payload: dict[str, object]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for field in ("offerte", "offerteBusiness"):
        value = payload.get(field, [])
        if isinstance(value, list):
            rows.extend(item for item in value if isinstance(item, dict))
    return rows


def existing_dual_rows(payload: dict[str, object]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for field in ("offerteDual", "offerteDualBusiness"):
        value = payload.get(field, [])
        if isinstance(value, list):
            rows.extend(item for item in value if isinstance(item, dict))
    return rows


def blocked_quality(value: object) -> bool:
    quality = str(value or "")
    return quality in BLOCKED_PRICE_QUALITIES or quality.startswith("media_fasce")


def is_last_valid(row: dict[str, object] | None) -> bool:
    if not row:
        return False
    return str(row.get("qualitaPrezzo") or "") in ALLOWED_PRICE_QUALITIES and not validate_candidate_row(row)


def validate_candidate_row(row: dict[str, object]) -> list[str]:
    reasons: list[str] = []
    commodity = str(row.get("commodity") or "")
    expected_unit = "€/kWh" if commodity == "luce" else "€/Smc" if commodity == "gas" else ""
    quality = str(row.get("qualitaPrezzo") or "")
    provenance = row.get("provenienzaPrezzo")

    if quality not in ALLOWED_PRICE_QUALITIES or blocked_quality(quality):
        reasons.append(f"qualita_prezzo_non_ammessa:{quality or 'assente'}")
    if row.get("customerType") not in {"privato", "business"}:
        reasons.append("tipo_cliente_non_valido")
    if commodity not in {"luce", "gas"}:
        reasons.append("commodity_non_valida")
    if row.get("providerKey") == "eco" and not str(row.get("codice") or "").startswith("000742"):
        reasons.append("codice_venditore_eco_non_valido")
    try:
        if float(row.get("prezzo", 0)) <= 0:
            reasons.append("prezzo_non_positivo")
        if float(row.get("quotaFissaAnnua", -1)) < 0:
            reasons.append("quota_fissa_non_valida")
    except (TypeError, ValueError):
        reasons.append("valori_economici_non_numerici")

    if not isinstance(provenance, dict):
        reasons.append("provenienza_prezzo_assente")
    else:
        label_context = normalize_text(
            f"{provenance.get('etichettaOriginale', '')} {provenance.get('testoVicino', '')}"
        )
        if provenance.get("unitaMisura") != expected_unit:
            reasons.append("unita_prezzo_incompatibile")
        if matches_any(label_context, BLOCKED_COMPONENT_PATTERNS):
            reasons.append("componente_non_principale_usata_come_prezzo")
        if matches_any(label_context, FUTURE_COMPONENT_PATTERNS):
            reasons.append("valore_futuro_usato_come_prezzo")
    return reasons


def validate_dual_candidate(row: dict[str, object]) -> list[str]:
    reasons: list[str] = []
    light = row.get("luce")
    gas = row.get("gas")
    if row.get("fornitura") != "dual":
        reasons.append("fornitura_dual_non_valida")
    if row.get("tipo") not in {"fisso", "variabile"}:
        reasons.append("tipo_dual_non_valido")
    if row.get("customerType") not in {"privato", "business"}:
        reasons.append("tipo_cliente_dual_non_valido")
    if row.get("providerKey") == "eco" and not str(row.get("codice") or "").startswith("000742"):
        reasons.append("codice_venditore_eco_dual_non_valido")
    if not isinstance(light, dict) or not isinstance(gas, dict):
        reasons.append("componenti_dual_assenti")
        return reasons

    if str(row.get("codiceOffertaLuce") or "") != str(light.get("codice") or ""):
        reasons.append("riferimento_luce_dual_non_esatto")
    if str(row.get("codiceOffertaGas") or "") != str(gas.get("codice") or ""):
        reasons.append("riferimento_gas_dual_non_esatto")
    if light.get("commodity") != "luce" or gas.get("commodity") != "gas":
        reasons.append("commodity_componenti_dual_non_valide")
    if light.get("providerKey") != row.get("providerKey") or gas.get("providerKey") != row.get("providerKey"):
        reasons.append("fornitore_componenti_dual_non_valido")
    if light.get("tipo") != row.get("tipo") or gas.get("tipo") != row.get("tipo"):
        reasons.append("tipo_componenti_dual_non_valido")
    if light.get("customerType") != row.get("customerType") or gas.get("customerType") != row.get("customerType"):
        reasons.append("clientela_componenti_dual_non_valida")
    reasons.extend(f"luce:{reason}" for reason in validate_candidate_row(light))
    reasons.extend(f"gas:{reason}" for reason in validate_candidate_row(gas))
    return reasons


def unexpected_changes(candidate: dict[str, object], previous: dict[str, object]) -> list[str]:
    if not is_last_valid(previous):
        return []

    reasons: list[str] = []
    if previous.get("tipo") and candidate.get("tipo") != previous.get("tipo"):
        reasons.append("tipo_prezzo_modificato")
    if previous.get("customerType") and candidate.get("customerType") != previous.get("customerType"):
        reasons.append("tipo_cliente_modificato")
    if previous.get("durataMesi") is not None and candidate.get("durataMesi") != previous.get("durataMesi"):
        reasons.append("durata_modificata")

    try:
        previous_price = float(previous["prezzo"])
        candidate_price = float(candidate["prezzo"])
        if abs(candidate_price - previous_price) > PRICE_CHANGE_TOLERANCE:
            reasons.append(
                f"prezzo_variato_oltre_soglia:{previous_price:.8f}->{candidate_price:.8f}"
            )
    except (KeyError, TypeError, ValueError):
        reasons.append("confronto_prezzo_non_disponibile")

    try:
        previous_fee = float(previous["quotaFissaAnnua"])
        candidate_fee = float(candidate["quotaFissaAnnua"])
        if abs(candidate_fee - previous_fee) > FEE_CHANGE_TOLERANCE:
            reasons.append(f"quota_fissa_variata_oltre_soglia:{previous_fee:.2f}->{candidate_fee:.2f}")
    except (KeyError, TypeError, ValueError):
        reasons.append("confronto_quota_fissa_non_disponibile")
    return reasons


def unexpected_dual_changes(candidate: dict[str, object], previous: dict[str, object]) -> list[str]:
    if not is_last_valid_dual(previous):
        return []
    reasons: list[str] = []
    for field, label in (
        ("tipo", "tipo_prezzo_dual_modificato"),
        ("customerType", "tipo_cliente_dual_modificato"),
        ("durataMesi", "durata_dual_modificata"),
        ("codiceOffertaLuce", "riferimento_luce_dual_modificato"),
        ("codiceOffertaGas", "riferimento_gas_dual_modificato"),
    ):
        if previous.get(field) is not None and candidate.get(field) != previous.get(field):
            reasons.append(label)
    for commodity in ("luce", "gas"):
        current_component = candidate.get(commodity)
        previous_component = previous.get(commodity)
        if isinstance(current_component, dict) and isinstance(previous_component, dict):
            reasons.extend(
                f"{commodity}:{reason}"
                for reason in unexpected_changes(current_component, previous_component)
            )
    return reasons


def public_row(row: dict[str, object]) -> dict[str, object]:
    result = copy.deepcopy(row)
    result.pop("valoriEstratti", None)
    for commodity in ("luce", "gas"):
        if isinstance(result.get(commodity), dict):
            result[commodity] = public_row(result[commodity])
    return result


def is_last_valid_dual(row: dict[str, object] | None) -> bool:
    return bool(row) and not validate_dual_candidate(row or {})


def dedupe_dual_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    best: dict[str, dict[str, object]] = {}
    for row in rows:
        code = str(row.get("codice") or "")
        if not code:
            continue
        current = best.get(code)
        if current is None or float(row.get("score", 0)) < float(current.get("score", 0)):
            best[code] = row
    return sorted(
        best.values(),
        key=lambda item: (
            str(item.get("providerKey") or ""),
            str(item.get("tipo") or ""),
            float(item.get("score", 0)),
            str(item.get("nome") or ""),
        ),
    )


def validate_and_merge(
    staging_payload: dict[str, object],
    previous_payload: dict[str, object],
    diagnostics: list[dict[str, object]],
) -> tuple[dict[str, object], dict[str, object]]:
    previous_by_key = {row_key(row): row for row in existing_rows(previous_payload) if all(row_key(row))}
    candidate_rows = existing_rows(staging_payload)
    final_by_key: dict[tuple[str, str], dict[str, object]] = {}
    quarantine: list[dict[str, object]] = []

    for candidate in candidate_rows:
        key = row_key(candidate)
        reasons = validate_candidate_row(candidate)
        previous = previous_by_key.get(key)
        if previous:
            reasons.extend(unexpected_changes(candidate, previous))

        if reasons:
            quarantine.append(
                {
                    "codiceOfferta": key[0],
                    "commodity": key[1],
                    "fornitore": candidate.get("fornitore"),
                    "motivi": sorted(set(reasons)),
                    "candidato": {
                        "prezzo": candidate.get("prezzo"),
                        "quotaFissaAnnua": candidate.get("quotaFissaAnnua"),
                        "tipo": candidate.get("tipo"),
                        "customerType": candidate.get("customerType"),
                        "durataMesi": candidate.get("durataMesi"),
                        "qualitaPrezzo": candidate.get("qualitaPrezzo"),
                    },
                    "ultimoValidoConservato": is_last_valid(previous),
                }
            )
            if is_last_valid(previous):
                final_by_key[key] = public_row(previous)
            continue
        final_by_key[key] = public_row(candidate)

    # If parsing recognised a code but could not establish a safe main price,
    # retain its last valid record instead of publishing a guessed value.
    for diagnostic in diagnostics:
        key = (str(diagnostic.get("codiceOfferta") or ""), str(diagnostic.get("commodity") or ""))
        previous = previous_by_key.get(key)
        if is_last_valid(previous):
            final_by_key.setdefault(key, public_row(previous))

    rows = dedupe_rows(list(final_by_key.values()))
    final_single_by_key = {row_key(row): row for row in rows}
    previous_dual_by_key = {
        str(row.get("codice") or ""): row
        for row in existing_dual_rows(previous_payload)
        if str(row.get("codice") or "")
    }
    final_dual_by_key: dict[str, dict[str, object]] = {}

    for raw_candidate in existing_dual_rows(staging_payload):
        candidate = copy.deepcopy(raw_candidate)
        code = str(candidate.get("codice") or "")
        light_code = str(candidate.get("codiceOffertaLuce") or "")
        gas_code = str(candidate.get("codiceOffertaGas") or "")
        light = final_single_by_key.get((light_code, "luce"))
        gas = final_single_by_key.get((gas_code, "gas"))
        if light:
            candidate["luce"] = copy.deepcopy(light)
        if gas:
            candidate["gas"] = copy.deepcopy(gas)
        reasons = validate_dual_candidate(candidate)
        previous = previous_dual_by_key.get(code)
        if previous:
            reasons.extend(unexpected_dual_changes(candidate, previous))
        if reasons:
            quarantine.append(
                {
                    "recordType": "dual",
                    "codiceOfferta": code,
                    "codiceOffertaLuce": light_code,
                    "codiceOffertaGas": gas_code,
                    "fornitore": candidate.get("fornitore"),
                    "motivi": sorted(set(reasons)),
                    "ultimoValidoConservato": is_last_valid_dual(previous),
                }
            )
            if is_last_valid_dual(previous):
                final_dual_by_key[code] = public_row(previous)
            continue
        candidate["score"] = round(float(candidate["luce"]["score"]) + float(candidate["gas"]["score"]), 4)
        final_dual_by_key[code] = public_row(candidate)

    for diagnostic in diagnostics:
        if diagnostic.get("recordType") != "dual":
            continue
        code = str(diagnostic.get("codiceOfferta") or "")
        previous = previous_dual_by_key.get(code)
        if is_last_valid_dual(previous):
            final_dual_by_key.setdefault(code, public_row(previous))

    dual_rows = dedupe_dual_rows(list(final_dual_by_key.values()))
    private_rows = [row for row in rows if row.get("customerType") == "privato"]
    business_rows = [row for row in rows if row.get("customerType") == "business"]
    private_dual_rows = [row for row in dual_rows if row.get("customerType") == "privato"]
    business_dual_rows = [row for row in dual_rows if row.get("customerType") == "business"]
    if not private_rows:
        raise ValueError("Validazione staging fallita: nessuna offerta privata valida; catalogo pubblico invariato")
    if "offerteDual" in staging_payload and not private_dual_rows:
        raise ValueError("Validazione staging fallita: nessuna vera offerta dual privata valida; catalogo pubblico invariato")
    if any(blocked_quality(row.get("qualitaPrezzo")) for row in rows):
        raise ValueError("Validazione staging fallita: qualitaPrezzo bloccata nel risultato")
    if any(row.get("customerType") != "privato" for row in private_rows):
        raise ValueError("Validazione staging fallita: offerta business nel catalogo privati")
    if any(row.get("customerType") != "privato" for row in private_dual_rows):
        raise ValueError("Validazione staging fallita: offerta dual business nel catalogo privati")
    if any(
        row.get("providerKey") == "eco" and not str(row.get("codice") or "").startswith("000742")
        for row in rows
    ):
        raise ValueError("Validazione staging fallita: catalogo E.CO contiene codici di altri venditori")

    payload = {
        **{
            key: copy.deepcopy(value)
            for key, value in staging_payload.items()
            if key not in {"offerte", "offerteBusiness", "offerteDual", "offerteDualBusiness"}
        },
        "offerte": private_rows,
        "offerteBusiness": business_rows,
        "offerteDual": private_dual_rows,
        "offerteDualBusiness": business_dual_rows,
    }
    payload["statistiche"] = {
        **dict(payload.get("statistiche") or {}),
        "totaleRighe": len(private_rows) + len(business_rows) + len(private_dual_rows) + len(business_dual_rows),
        "offertePrivati": len(private_rows),
        "offerteBusiness": len(business_rows),
        "offerteDualPrivati": len(private_dual_rows),
        "offerteDualBusiness": len(business_dual_rows),
        "inQuarantena": len(quarantine),
        "scartate": len(diagnostics),
    }
    report = {
        "versioneDati": payload.get("versioneDati"),
        "aggiornatoIl": payload.get("aggiornatoIl"),
        "pubblicazioneAutorizzata": True,
        "statistiche": payload["statistiche"],
        "quarantena": quarantine,
        "scarti": diagnostics,
    }
    return payload, report


def json_text(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def write_staging(root: Path, staging_payload: dict[str, object]) -> Path:
    target = root / "data" / ".arera-staging" / "offerte-arera-menu-staging.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json_text(staging_payload), encoding="utf-8")
    return target


def write_report(root: Path, report: dict[str, object]) -> Path:
    target = root / "data" / "arera-update-report.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json_text(report), encoding="utf-8")
    return target


def atomic_write_json_targets(target_bodies: dict[Path, str]) -> list[Path]:
    targets = list(target_bodies)
    temporary: list[tuple[Path, Path]] = []
    originals = {target: target.read_bytes() if target.exists() else None for target in targets}
    replaced: list[Path] = []
    try:
        for target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
            os.close(fd)
            temp_path = Path(name)
            temp_path.write_text(target_bodies[target], encoding="utf-8")
            json.loads(temp_path.read_text(encoding="utf-8"))
            temporary.append((temp_path, target))
        for temp_path, target in temporary:
            os.replace(temp_path, target)
            replaced.append(target)
    except Exception:
        for target in reversed(replaced):
            original = originals[target]
            if original is None:
                target.unlink(missing_ok=True)
            else:
                fd, name = tempfile.mkstemp(prefix=f".{target.name}.rollback.", suffix=".tmp", dir=target.parent)
                os.close(fd)
                rollback_path = Path(name)
                rollback_path.write_bytes(original)
                os.replace(rollback_path, target)
        raise
    finally:
        for temp_path, _ in temporary:
            temp_path.unlink(missing_ok=True)
    return targets


def atomic_publish_calculation_parameters(
    root: Path, calculation_parameters: dict[str, object]
) -> list[Path]:
    body = json_text(calculation_parameters)
    return atomic_write_json_targets(
        {
            root / "data" / "calcolo-parametri.json": body,
            root / "public" / "data" / "calcolo-parametri.json": body,
        }
    )


def atomic_publish(
    root: Path,
    payload: dict[str, object],
    report: dict[str, object],
    calculation_parameters: dict[str, object],
) -> list[Path]:
    return atomic_write_json_targets(
        {
            root / "data" / "offerte-arera-menu.json": json_text(payload),
            root / "public" / "data" / "offerte-arera-menu.json": json_text(payload),
            root / "data" / "calcolo-parametri.json": json_text(calculation_parameters),
            root / "public" / "data" / "calcolo-parametri.json": json_text(calculation_parameters),
            root / "data" / "arera-update-report.json": json_text(report),
        }
    )


def build_staging_payload(
    files: dict[str, Path],
    as_of: datetime,
    root: Path,
    market_indices: dict[str, float] | None = None,
    index_context: dict[str, object] | None = None,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    overrides = load_verified_overrides(root)
    diagnostics: list[dict[str, object]] = []
    indices = market_indices or {"pun": PUN_FALLBACK, "psv": PSV_FALLBACK}
    light_rows = dedupe_rows(
        parse_offer_file(files["E"], "luce", as_of, overrides, diagnostics, indices)
    )
    gas_rows = dedupe_rows(
        parse_offer_file(files["G"], "gas", as_of, overrides, diagnostics, indices)
    )
    rows = dedupe_rows(light_rows + gas_rows)
    dual_rows = dedupe_dual_rows(parse_dual_file(files["D"], light_rows, gas_rows, as_of, diagnostics))

    return {
        "versioneDati": f"arera-menu-{as_of.strftime('%Y-%m-%d')}",
        "fonte": f"{SOURCE_LABEL}. Le offerte variabili sono stimate con indice corrente del motore quando ARERA espone solo lo spread.",
        "aggiornatoIl": as_of.strftime("%Y-%m-%d"),
        "indiciUsati": {
            "pun": float(indices["pun"]),
            "psv": float(indices["psv"]),
        },
        "indiciDettaglio": copy.deepcopy(index_context or {}),
        "offerte": [row for row in rows if row.get("customerType") == "privato"],
        "offerteBusiness": [row for row in rows if row.get("customerType") == "business"],
        "offerteDual": [row for row in dual_rows if row.get("customerType") == "privato"],
        "offerteDualBusiness": [row for row in dual_rows if row.get("customerType") == "business"],
        "statistiche": {
            "totaleRighe": len(rows) + len(dual_rows),
            "fileLuce": files["E"].name,
            "fileGas": files["G"].name,
            "fileDual": files["D"].name,
        },
    }, diagnostics


def build_validated_payload(
    files: dict[str, Path],
    as_of: datetime,
    root: Path,
    market_indices: dict[str, float] | None = None,
    index_context: dict[str, object] | None = None,
) -> tuple[dict[str, object], dict[str, object], Path]:
    staging_payload, diagnostics = build_staging_payload(
        files, as_of, root, market_indices, index_context
    )
    staging_path = write_staging(root, staging_payload)
    previous_payload = read_json(root / "data" / "offerte-arera-menu.json")
    payload, report = validate_and_merge(staging_payload, previous_payload, diagnostics)
    report["indiciMercato"] = copy.deepcopy(index_context or {})
    return payload, report, staging_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Aggiorna il catalogo ARERA oppure soltanto il PUN mensile GME."
    )
    parser.add_argument("--source-dir", type=Path, help="Cartella locale con XML Open Data gia scaricati.")
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--as-of", help="Data controllo in formato YYYY-MM-DD. Default: oggi.")
    parser.add_argument(
        "--pun-only",
        action="store_true",
        help="Aggiorna soltanto il PUN GME nei due calcolo-parametri.json, senza scaricare o elaborare offerte ARERA.",
    )
    return parser.parse_args()


def run_pun_only(root: Path, as_of: datetime) -> list[Path]:
    current_parameters = load_calculation_parameters(root)
    current_indices = market_index_values(current_parameters)
    snapshot = download_previous_month_pun(as_of)
    if snapshot is None:
        _, _, _, expected_period_label = previous_month_reference(as_of)
        log_info(
            f"PUN GME {expected_period_label} non ancora pubblicato; "
            f"conservo {current_indices['pun']:.9f} eur/kWh e non modifico i file."
        )
        return []

    updated_parameters = apply_pun_snapshot(current_parameters, snapshot, as_of)
    targets = atomic_publish_calculation_parameters(root, updated_parameters)
    log_info(
        f"PUN GME {snapshot['periodoLabel']}: "
        f"{float(snapshot['valoreOriginale']):.6f} eur/MWh = "
        f"{float(snapshot['valore']):.9f} eur/kWh."
    )
    for target in targets:
        log_info(f"Aggiornato: {target.relative_to(root)}")
    return targets


def main() -> int:
    args = parse_args()
    as_of = datetime.now()
    if args.as_of:
        as_of = datetime.strptime(args.as_of, "%Y-%m-%d")

    root = args.package_root.resolve()
    if args.pun_only:
        try:
            run_pun_only(root, as_of)
        except Exception as error:
            log_error(f"Aggiornamento PUN GME non riuscito: {error}")
            log_error("I dati esistenti non sono stati modificati.")
            return 1
        log_info("Aggiornamento PUN GME completato correttamente.")
        return 0

    staging_path: Path | None = None
    report: dict[str, object] | None = None
    try:
        current_parameters = load_calculation_parameters(root)
        current_indices = market_index_values(current_parameters)
        pun_snapshot = download_previous_month_pun(as_of)
        calculation_parameters = apply_pun_snapshot(current_parameters, pun_snapshot, as_of)
        market_indices = market_index_values(calculation_parameters)
        _, _, expected_period, expected_period_label = previous_month_reference(as_of)
        if pun_snapshot is None:
            pun_context: dict[str, object] = {
                "stato": "in_attesa_pubblicazione",
                "periodoAtteso": expected_period,
                "periodoAttesoLabel": expected_period_label,
                "valoreConservato": current_indices["pun"],
                "messaggio": "Pubblicazione GME non ancora disponibile; conservato ultimo PUN ufficiale valido.",
            }
            log_info(
                f"PUN GME {expected_period_label} non ancora pubblicato; "
                f"conservo {current_indices['pun']:.9f} eur/kWh."
            )
        else:
            pun_context = copy.deepcopy(pun_snapshot)
            log_info(
                f"PUN GME {pun_snapshot['periodoLabel']}: "
                f"{float(pun_snapshot['valoreOriginale']):.6f} eur/MWh = "
                f"{float(pun_snapshot['valore']):.9f} eur/kWh."
            )
        index_context = {
            "pun": pun_context,
            "psv": copy.deepcopy(calculation_parameters.get("indiciMercato", {}).get("psv", {})),
        }

        if args.source_dir:
            log_info(f"Cerco file ARERA locali in {args.source_dir.resolve()} per la data {as_of.strftime('%Y%m%d')}.")
            files = local_files(args.source_dir.resolve())
            source_date = source_date_from_files(files) or as_of
            log_info(f"Parsing file ARERA per la data {source_date.strftime('%Y%m%d')}.")
            payload, report, staging_path = build_validated_payload(
                files, source_date, root, market_indices, index_context
            )
            targets = atomic_publish(root, payload, report, calculation_parameters)
        else:
            with tempfile.TemporaryDirectory(prefix="offertalogica-arera-") as tmp:
                files = download_current_files(Path(tmp), as_of)
                source_date = source_date_from_files(files) or as_of
                log_info(f"Parsing file ARERA per la data {source_date.strftime('%Y%m%d')}.")
                payload, report, staging_path = build_validated_payload(
                    files, source_date, root, market_indices, index_context
                )
                targets = atomic_publish(root, payload, report, calculation_parameters)
    except Exception as error:
        failure_report = report or {
            "versioneDati": f"arera-menu-{as_of.strftime('%Y-%m-%d')}",
            "aggiornatoIl": as_of.strftime("%Y-%m-%d"),
            "pubblicazioneAutorizzata": False,
            "errore": str(error),
        }
        failure_report["pubblicazioneAutorizzata"] = False
        failure_report["errore"] = str(error)
        write_report(root, failure_report)
        if isinstance(error, AreraFilesNotFound):
            log_error(no_files_message(as_of.strftime("%Y%m%d")))
        log_error(f"Aggiornamento ARERA non riuscito: {error}")
        log_error("I dati esistenti non sono stati modificati.")
        return 1

    report_path = root / "data" / "arera-update-report.json"
    log_info(
        f"Creato offerte-arera-menu.json con {payload['statistiche']['totaleRighe']} righe "
        f"({payload['statistiche']['fileLuce']} / {payload['statistiche']['fileGas']} / "
        f"{payload['statistiche']['fileDual']})."
    )
    log_info(f"Staging validato: {staging_path.relative_to(root) if staging_path else 'non disponibile'}")
    log_info(f"Report aggiornamento: {report_path.relative_to(root)}")
    log_info("Aggiornamento completato correttamente.")
    for target in targets:
        log_info(f"Aggiornato: {target.relative_to(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
