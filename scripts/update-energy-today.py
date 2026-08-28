#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urljoin

ARERA_VIGILANZA_URL = "https://www.arera.it/vigilanza-energetica"
OUTPUT_PATH = Path("public/data/energia-oggi.json")
PARAMS_PATH = Path("public/data/calcolo-parametri.json")
USER_AGENT = "OffertaLogica/1.0 (+https://offertalogica.it/)"
DATE_RE = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")
NUMBER_RE = re.compile(r"^-?\d+(?:[.,]\d+)?$")
BULLETIN_RE = re.compile(
    r'href=["\']([^"\']*Bollettino_vigilanza_energetica_(\d{8})[^"\']*\.pdf)["\']',
    re.I,
)


def log(message: str) -> None:
    print(f"[ENERGIA] {message}", flush=True)


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def discover_latest_bulletin(page_html: str, base_url: str = ARERA_VIGILANZA_URL) -> tuple[str, str]:
    candidates: list[tuple[str, str]] = []
    for href, yyyymmdd in BULLETIN_RE.findall(page_html):
        candidates.append((yyyymmdd, urljoin(base_url, href.replace("&amp;", "&"))))
    if not candidates:
        raise RuntimeError("Nessun bollettino ARERA individuato nella pagina di Vigilanza Energetica")
    yyyymmdd, url = max(candidates, key=lambda item: item[0])
    return url, yyyymmdd


def normalize_cell(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def parse_date_cell(value: str) -> date | None:
    match = DATE_RE.search(value or "")
    if not match:
        return None
    day, month, year = map(int, match.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_number(value: str) -> float | None:
    cleaned = normalize_cell(value).replace("€", "").replace("/MWh", "").strip()
    if not NUMBER_RE.match(cleaned):
        return None
    try:
        return float(cleaned.replace(",", "."))
    except ValueError:
        return None


def row_label(row: list[str]) -> str:
    return " ".join(cell for cell in row if cell).lower()


def find_indicator_row(rows: list[list[str]], needle: str) -> list[str]:
    target = needle.lower()
    for row in rows:
        if target in row_label(row):
            return row
    raise RuntimeError(f"Riga indicatore non trovata: {needle}")


def find_header_row(rows: list[list[str]]) -> list[str]:
    for row in rows:
        if sum(1 for cell in row if parse_date_cell(cell)) >= 1 and "indice" in row_label(row):
            return row
    for row in rows:
        if sum(1 for cell in row if parse_date_cell(cell)) >= 2:
            return row
    raise RuntimeError("Riga intestazione date non trovata nel bollettino")


def align_row(row: list[str], width: int) -> list[str]:
    if len(row) < width:
        return row + [""] * (width - len(row))
    if len(row) > width:
        return row[:width]
    return row


def select_dated_values(header: list[str], row: list[str]) -> list[tuple[date, float]]:
    width = max(len(header), len(row))
    header = align_row(header, width)
    row = align_row(row, width)
    values: list[tuple[date, float]] = []
    for index, header_cell in enumerate(header):
        parsed_date = parse_date_cell(header_cell)
        if parsed_date is None:
            continue
        parsed_value = parse_number(row[index])
        if parsed_value is not None:
            values.append((parsed_date, parsed_value))
    return sorted(values, key=lambda item: item[0], reverse=True)


def extract_rows_from_pdf(pdf_bytes: bytes) -> list[list[str]]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as exc:
        raise RuntimeError("Dipendenza pdfplumber non installata") from exc

    rows: list[list[str]] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        if not pdf.pages:
            raise RuntimeError("Bollettino ARERA senza pagine")
        page = pdf.pages[0]
        tables = page.extract_tables() or []
        for table in tables:
            for raw_row in table or []:
                if raw_row:
                    rows.append([normalize_cell(cell) for cell in raw_row])
    if not rows:
        raise RuntimeError("Nessuna tabella leggibile nel bollettino ARERA")
    return rows


def extract_market_values(rows: list[list[str]]) -> dict[str, object]:
    header = find_header_row(rows)
    pun_row = find_indicator_row(rows, "PUN index GME")
    ig_row = find_indicator_row(rows, "IG Index GME")
    pun_values = select_dated_values(header, pun_row)
    ig_values = select_dated_values(header, ig_row)
    if not pun_values:
        raise RuntimeError("Nessun valore giornaliero PUN associato a una data")
    if not ig_values:
        raise RuntimeError("Nessun valore giornaliero IG Index associato a una data")

    pun_date, pun_value = pun_values[0]
    pun_previous = pun_values[1][1] if len(pun_values) > 1 else None
    ig_date, ig_value = ig_values[0]
    ig_previous = ig_values[1][1] if len(ig_values) > 1 else None

    def variation(current: float, previous: float | None) -> float | None:
        if previous in (None, 0):
            return None
        return ((current - previous) / previous) * 100

    return {
        "pun": {
            "data": pun_date.isoformat(),
            "valoreEurMwh": pun_value,
            "ieriEurMwh": pun_previous,
            "variazionePercentuale": variation(pun_value, pun_previous),
        },
        "ig": {
            "data": ig_date.isoformat(),
            "valoreEurMwh": ig_value,
            "ieriEurMwh": ig_previous,
            "variazionePercentuale": variation(ig_value, ig_previous),
        },
    }


def load_monthly_psv(params_path: Path) -> dict[str, object]:
    params = json.loads(params_path.read_text(encoding="utf-8"))
    psv = params.get("indiciMercato", {}).get("psv")
    if not isinstance(psv, dict):
        raise RuntimeError("PSV mensile non presente in calcolo-parametri.json")
    return {
        "label": psv.get("label", "PSV DA / CMEM,m"),
        "periodo": psv.get("periodo"),
        "periodoLabel": psv.get("periodoLabel"),
        "valoreEurMwh": psv.get("valoreOriginale"),
        "valoreEurSmc": psv.get("valore"),
        "fonte": "OffertaLogica - calcolo-parametri.json",
        "origineDato": psv.get("fonte"),
        "urlFonteOriginale": psv.get("urlFonte"),
        "stato": "ufficiale_mensile",
    }


def build_output(values: dict[str, object], monthly_psv: dict[str, object], bulletin_url: str) -> dict[str, object]:
    pun = values["pun"]
    ig = values["ig"]
    assert isinstance(pun, dict) and isinstance(ig, dict)
    updated_at = max(str(pun["data"]), str(ig["data"]))
    return {
        "versione": f"energia-oggi-{updated_at}",
        "aggiornatoIl": updated_at,
        "fonteInterna": "OffertaLogica - aggiornamento dati energia",
        "origineAggiornamento": "ARERA - Unità di Vigilanza Energetica",
        "urlOrigineAggiornamento": bulletin_url,
        "nota": "File locale prodotto dal processo di aggiornamento OffertaLogica. I riferimenti giornalieri e il PSV mensile restano separati.",
        "pun": {
            "label": "PUN Index GME",
            "data": pun["data"],
            "valoreEurMwh": pun["valoreEurMwh"],
            "valoreEurKwh": round(float(pun["valoreEurMwh"]) / 1000, 6),
            "ieriEurMwh": pun["ieriEurMwh"],
            "variazionePercentuale": pun["variazionePercentuale"],
            "minimoEurMwh": None,
            "massimoEurMwh": None,
            "fonte": "OffertaLogica - aggiornamento dati energia",
            "origineDato": "ARERA - Unità di Vigilanza Energetica / PUN Index GME",
            "urlFonteOriginale": bulletin_url,
            "stato": "verificato_da_aggiornamento_offertalogica",
        },
        "gas": {
            "giornaliero": {
                "label": "IG Index GME",
                "data": ig["data"],
                "valoreEurMwh": ig["valoreEurMwh"],
                "ieriEurMwh": ig["ieriEurMwh"],
                "variazionePercentuale": ig["variazionePercentuale"],
                "fonte": "OffertaLogica - aggiornamento dati energia",
                "origineDato": "ARERA - Unità di Vigilanza Energetica / IG Index GME",
                "urlFonteOriginale": bulletin_url,
                "stato": "riferimento_giornaliero_mercato_gas",
                "nota": "IG Index GME resta distinto dal PSV day-ahead mensile usato nei riferimenti ARERA.",
            },
            "psvMensile": monthly_psv,
        },
    }


def write_json_atomic(path: Path, data: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Aggiorna il file locale OffertaLogica con PUN/IG giornalieri e PSV mensile.")
    parser.add_argument("--bulletin-url", default="", help="URL PDF ARERA da usare al posto della scoperta automatica")
    parser.add_argument("--pdf-file", default="", help="PDF locale ARERA per test o aggiornamento manuale")
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    parser.add_argument("--params", default=str(PARAMS_PATH))
    args = parser.parse_args()

    output_path = Path(args.output)
    params_path = Path(args.params)

    try:
        bulletin_url = args.bulletin_url
        if args.pdf_file:
            pdf_bytes = Path(args.pdf_file).read_bytes()
            bulletin_url = bulletin_url or "file-locale-verificato"
        else:
            if not bulletin_url:
                page_html = fetch_bytes(ARERA_VIGILANZA_URL).decode("utf-8", errors="replace")
                bulletin_url, bulletin_date = discover_latest_bulletin(page_html)
                log(f"Ultimo bollettino ARERA individuato: {bulletin_date} - {bulletin_url}")
            pdf_bytes = fetch_bytes(bulletin_url)

        rows = extract_rows_from_pdf(pdf_bytes)
        values = extract_market_values(rows)
        monthly_psv = load_monthly_psv(params_path)
        output = build_output(values, monthly_psv, bulletin_url)
        write_json_atomic(output_path, output)
        log(f"Aggiornato {output_path} con PUN {output['pun']['data']} e IG {output['gas']['giornaliero']['data']}")
        return 0
    except Exception as exc:
        print(f"[ENERGIA] ERRORE: {exc}", file=sys.stderr, flush=True)
        print("[ENERGIA] Il file esistente non è stato sovrascritto.", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
