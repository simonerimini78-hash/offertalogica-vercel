#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin


NS = {"po": "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"}
OPEN_DATA_URL = "https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page"
SOURCE_LABEL = "Portale Offerte ARERA/Acquirente Unico Open Data"
PUN_FALLBACK = 0.119351258
PSV_FALLBACK = 0.504419055
REFERENCE_CONSUMPTION = {"luce": 2700, "gas": 700}
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


PROVIDERS: tuple[ProviderRule, ...] = (
    ProviderRule("a2a", "A2A Energia", (r"\ba2a\b",)),
    ProviderRule("acea", "Acea Energia", (r"\bacea\b", r"acea energia")),
    ProviderRule("agasco", "Agasco", (r"\bagasco\b",)),
    ProviderRule("alperia", "Alperia", (r"\balperia\b",)),
    ProviderRule("amga", "Amga", (r"\bamga\b",)),
    ProviderRule("argos", "Argos", (r"\bargos\b",)),
    ProviderRule("axpo", "Axpo Energia", (r"\baxpo\b",)),
    ProviderRule("dolomiti", "Dolomiti Energia", (r"\bdolomiti\b",)),
    ProviderRule("eco", "E.CO Energia Corrente", (r"\be\.?\s*co\b", r"energia corrente")),
    ProviderRule("eon", "E.ON", (r"\be\.?\s*on\b",), ("03429130234",)),
    ProviderRule("edison", "Edison", (r"\bedison\b",)),
    ProviderRule("eni", "Eni Plenitude", (r"\bplenitude\b", r"\beni\b", r"gas e luce")),
    ProviderRule("enel", "Enel Energia", (r"\benel\b",)),
    ProviderRule("enercom", "Enercom", (r"\benercom\b",)),
    ProviderRule("engie", "Engie", (r"\bengie\b",)),
    ProviderRule("eja", "Eja Energia", (r"\beja\b",)),
    ProviderRule("hera", "Hera Comm", (r"\bhera\b",)),
    ProviderRule("illum", "Illumia", (r"\billumia\b",)),
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
    ProviderRule("vivi", "Vivi Energia", (r"\bvivi energia\b",)),
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
    fields = [
        piva,
        code,
        node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA"),
        node_text(offer, "po:DettaglioOfferta/po:DESCRIZIONE"),
        node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_OFFERTA"),
        node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_SITO_VENDITORE"),
    ]
    blob = normalize_text(" ".join(fields))

    for rule in PROVIDERS:
        if piva and piva in rule.piva:
            return rule.key, rule.label
        if any(re.search(pattern, blob) for pattern in rule.patterns):
            return rule.key, rule.label
    return None


def is_consumer_offer(offer: ET.Element) -> bool:
    # The public calculator ranks domestic offers. Relying only on words such as
    # "business" is unsafe because many non-domestic products have neutral names.
    if node_text(offer, "po:DettaglioOfferta/po:TIPO_CLIENTE") != "01":
        return False

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
    return not any(word in blob for word in EXCLUDED_OFFER_WORDS)


def interval_applies(interval: ET.Element, annual_consumption: float) -> bool:
    lower = parse_float(node_text(interval, "po:CONSUMO_DA"))
    upper = parse_float(node_text(interval, "po:CONSUMO_A"))
    if lower is not None and annual_consumption < lower:
        return False
    if upper is not None and annual_consumption > upper:
        return False
    return True


def unit_component_prices(
    offer: ET.Element,
    unit: str,
    annual_consumption: float,
) -> list[float]:
    """Return one applicable price for each XML commercial component.

    Intervals belonging to the same component can describe tariff bands and
    consumption brackets. They are alternatives inside that component, while
    different components are cumulative. Flattening every interval into one
    list and averaging it can turn a real energy price into a small spread.
    """
    component_prices: list[float] = []

    for component in offer.findall(".//po:ComponenteImpresa", NS):
        prices_by_band: dict[str, list[float]] = {}

        for interval in component.findall("po:IntervalloPrezzi", NS):
            if node_text(interval, "po:UNITA_MISURA") != unit:
                continue
            if not interval_applies(interval, annual_consumption):
                continue

            value = parse_float(node_text(interval, "po:PREZZO"))
            if value is None or value < 0:
                continue

            band = node_text(interval, "po:FASCIA_COMPONENTE") or "00"
            prices_by_band.setdefault(band, []).append(value)

        if not prices_by_band:
            continue

        band_totals = [sum(values) for values in prices_by_band.values()]
        component_prices.append(sum(band_totals) / len(band_totals))

    return component_prices


def annual_fee(offer: ET.Element) -> float | None:
    values: set[float] = set()
    for interval in offer.findall(".//po:ComponenteImpresa/po:IntervalloPrezzi", NS):
        if node_text(interval, "po:UNITA_MISURA") != "01":
            continue
        value = parse_float(node_text(interval, "po:PREZZO"))
        if value is None or value < 0:
            continue
        values.add(round(value, 6))
    if not values:
        return None
    return round(sum(values), 4)


def representative_price(component_prices: list[float], commodity: str, tipo: str) -> tuple[float | None, str]:
    values = [value for value in component_prices if value >= 0]
    if not values:
        return None, "missing"

    raw_price = sum(values)
    quality = "puntuale" if len(values) == 1 else "somma_componenti"

    if tipo == "variabile":
        if commodity == "luce" and raw_price < 0.08:
            return round(PUN_FALLBACK + raw_price, 8), f"{quality}_pun_fallback"
        if commodity == "gas" and raw_price < 0.25:
            return round(PSV_FALLBACK + raw_price, 8), f"{quality}_psv_fallback"

    return round(raw_price, 8), quality


def score_for(commodity: str, price: float, fee: float) -> float:
    return round((REFERENCE_CONSUMPTION[commodity] * price) + fee, 4)


def parse_offer_file(path: Path, commodity: str, as_of: datetime) -> list[dict[str, object]]:
    unit = "03" if commodity == "luce" else "04"
    tree = ET.parse(path)
    rows: list[dict[str, object]] = []

    for offer in tree.findall(".//po:offerta", NS):
        match = provider_for(offer)
        if not match:
            continue
        if not is_consumer_offer(offer):
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

        price, quality = representative_price(
            unit_component_prices(offer, unit, REFERENCE_CONSUMPTION[commodity]),
            commodity,
            tipo,
        )
        fee = annual_fee(offer)
        if price is None or fee is None:
            continue

        provider_key, provider_label = match
        nome = node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA")
        url = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_OFFERTA")
        site = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_SITO_VENDITORE")
        code = node_text(offer, "po:IdentificativiOfferta/po:COD_OFFERTA")

        rows.append(
            {
                "providerKey": provider_key,
                "providerLabel": provider_label,
                "fornitore": provider_label,
                "commodity": commodity,
                "tipo": tipo,
                "nome": nome or f"{provider_label} offerta {commodity}",
                "codice": code,
                "dataInizio": data_inizio,
                "dataFine": data_fine,
                "prezzo": price,
                "quotaFissaAnnua": fee,
                "url": url or site or "#",
                "fonte": f"{SOURCE_LABEL} - codice {code}",
                "score": score_for(commodity, price, fee),
                "qualitaPrezzo": quality,
            }
        )

    return rows


def extract_xml_links(open_data_html: str) -> dict[str, str]:
    links: dict[str, str] = {}
    pattern = re.compile(r'href=["\']([^"\']*PO_Offerte_([EGD])_MLIBERO_\d+\.xml)["\']', re.I)
    for href, kind in pattern.findall(open_data_html):
        kind = kind.upper()
        links[kind] = urljoin(OPEN_DATA_URL, html.unescape(href))
    if "E" not in links or "G" not in links:
        raise RuntimeError("Open Data XML luce/gas non trovati nella pagina del Portale Offerte")
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


def write_json(root: Path, payload: dict[str, object]) -> list[Path]:
    targets = [root / "data" / "offerte-arera-menu.json", root / "public" / "data" / "offerte-arera-menu.json"]
    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return targets


def build_payload(files: dict[str, Path], as_of: datetime) -> dict[str, object]:
    rows = []
    rows.extend(parse_offer_file(files["E"], "luce", as_of))
    rows.extend(parse_offer_file(files["G"], "gas", as_of))
    rows = dedupe_rows(rows)

    return {
        "versioneDati": f"arera-menu-{as_of.strftime('%Y-%m-%d')}",
        "fonte": f"{SOURCE_LABEL}. Le offerte variabili sono stimate con indice corrente del motore quando ARERA espone solo lo spread.",
        "aggiornatoIl": as_of.strftime("%Y-%m-%d"),
        "indiciUsati": {
            "pun": PUN_FALLBACK,
            "psv": PSV_FALLBACK,
        },
        "offerte": rows,
        "statistiche": {
            "totaleRighe": len(rows),
            "fileLuce": files["E"].name,
            "fileGas": files["G"].name,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aggiorna il JSON ARERA usato dal menu nuova offerta.")
    parser.add_argument("--source-dir", type=Path, help="Cartella locale con XML Open Data gia scaricati.")
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--as-of", help="Data controllo in formato YYYY-MM-DD. Default: oggi.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    as_of = datetime.now()
    if args.as_of:
        as_of = datetime.strptime(args.as_of, "%Y-%m-%d")

    root = args.package_root.resolve()
    try:
        if args.source_dir:
            log_info(f"Cerco file ARERA locali in {args.source_dir.resolve()} per la data {as_of.strftime('%Y%m%d')}.")
            files = local_files(args.source_dir.resolve())
            source_date = source_date_from_files(files) or as_of
            log_info(f"Parsing file ARERA per la data {source_date.strftime('%Y%m%d')}.")
            payload = build_payload(files, source_date)
            targets = write_json(root, payload)
        else:
            with tempfile.TemporaryDirectory(prefix="offertalogica-arera-") as tmp:
                files = download_current_files(Path(tmp), as_of)
                source_date = source_date_from_files(files) or as_of
                log_info(f"Parsing file ARERA per la data {source_date.strftime('%Y%m%d')}.")
                payload = build_payload(files, source_date)
                targets = write_json(root, payload)
    except Exception as error:
        if isinstance(error, AreraFilesNotFound):
            log_error(no_files_message(as_of.strftime("%Y%m%d")))
        log_error(f"Aggiornamento ARERA non riuscito: {error}")
        log_error("I dati esistenti non sono stati modificati.")
        return 1

    log_info(
        f"Creato offerte-arera-menu.json con {payload['statistiche']['totaleRighe']} righe "
        f"({payload['statistiche']['fileLuce']} / {payload['statistiche']['fileGas']})."
    )
    log_info("Aggiornamento completato correttamente.")
    for target in targets:
        log_info(f"Aggiornato: {target.relative_to(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
