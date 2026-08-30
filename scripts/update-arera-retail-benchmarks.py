#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import io
import json
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

ELECTRICITY_PAGE = "https://www.arera.it/dati-e-statistiche/dettaglio/analisi-delle-offerte-disponibili-sul-portale-offerte"
GAS_PAGE = "https://www.arera.it/dati-e-statistiche/dettaglio/analisi-delle-offerte-disponibili-sul-portale-offerte-1"
SOURCE_LABEL = "ARERA - Monitoraggio Retail - Analisi delle offerte disponibili sul Portale Offerte"
METRIC = "spesa_annua_media_offerte_mercato_libero"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36"
MONTHS = {
    "gen": 1, "gennaio": 1, "jan": 1,
    "feb": 2, "febbraio": 2,
    "mar": 3, "marzo": 3,
    "apr": 4, "aprile": 4,
    "mag": 5, "maggio": 5, "may": 5,
    "giu": 6, "giugno": 6, "jun": 6,
    "lug": 7, "luglio": 7, "jul": 7,
    "ago": 8, "agosto": 8, "aug": 8,
    "set": 9, "sett": 9, "settembre": 9, "sep": 9,
    "ott": 10, "ottobre": 10, "oct": 10,
    "nov": 11, "novembre": 11,
    "dic": 12, "dicembre": 12, "dec": 12,
}


def norm(value: Any) -> str:
    text = html.unescape(str(value or "")).lower()
    text = text.replace("€", " eur ").replace("’", "'")
    text = re.sub(r"[^a-z0-9àèéìòù_./%+-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Language": "it-IT,it;q=0.9"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def discover_attachment_urls(page_url: str) -> list[str]:
    """Return ZIP attachments linked directly by the official ARERA page.

    This is plain page/attachment retrieval, not an API.  We deliberately avoid
    depending on a historical filename convention: ARERA can rename the ZIP
    while keeping the same publication page.
    """
    body = fetch(page_url).decode("utf-8", errors="replace")
    hrefs = re.findall(r'href=["\']([^"\']+)["\']', body, flags=re.I)
    candidates: list[str] = []
    for href in hrefs:
        decoded = html.unescape(href).strip()
        if not decoded:
            continue
        absolute = urllib.parse.urljoin(page_url, decoded)
        path = urllib.parse.urlparse(absolute).path.lower()
        if not path.endswith(".zip"):
            continue
        candidates.append(absolute)
    if not candidates:
        raise RuntimeError(f"Allegato ZIP ARERA Monitoraggio Retail non trovato in {page_url}")
    return sorted(set(candidates))


def ensure_openpyxl() -> Any:
    try:
        import openpyxl  # type: ignore
        return openpyxl
    except ImportError as exc:
        raise RuntimeError("Dipendenza openpyxl mancante. Esegui: python3 -m pip install --user openpyxl") from exc


def parse_period(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date().replace(day=1)
    if isinstance(value, date):
        return value.replace(day=1)
    text = norm(value)
    if not text:
        return None
    m = re.search(r"\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b", text)
    if m:
        return date(int(m.group(1)), int(m.group(2)), 1)
    m = re.search(r"\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b", text)
    if m:
        return date(int(m.group(2)), int(m.group(1)), 1)
    m = re.search(r"\b([a-zàèéìòù]{3,10})[- /](\d{2,4})\b", text)
    if m and m.group(1) in MONTHS:
        year = int(m.group(2))
        if year < 100:
            year += 2000
        return date(year, MONTHS[m.group(1)], 1)
    return None


def numeric(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number else None
    text = str(value).strip().replace("€", "").replace(" ", "")
    if not text:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    text = re.sub(r"[^0-9+-.]", "", text)
    try:
        return float(text)
    except ValueError:
        return None


@dataclass(frozen=True)
class Point:
    commodity: str
    price_type: str
    period: date
    value: float
    workbook: str
    sheet: str
    metric_label: str


def local_text(matrix: list[list[Any]], row: int, col: int, radius_rows: int = 10, radius_cols: int = 8) -> str:
    parts: list[str] = []
    for r in range(max(0, row - radius_rows), min(len(matrix), row + radius_rows + 1)):
        current = matrix[r]
        for c in range(max(0, col - radius_cols), min(len(current), col + radius_cols + 1)):
            text = norm(current[c])
            if text:
                parts.append(text)
    return " ".join(parts)


def infer_commodity(text: str, filename: str, sheet: str) -> str | None:
    hay = norm(f"{filename} {sheet} {text}")
    gas_score = sum(token in hay for token in ("gas naturale", "1400 smc", "1.400 smc", "cacr", "smc", "settore gas"))
    light_score = sum(token in hay for token in ("energia elettrica", "2700 kwh", "2.700 kwh", "3 kw", "kwh", "elettric"))
    if gas_score > light_score and gas_score >= 1:
        return "gas"
    if light_score > gas_score and light_score >= 1:
        return "luce"
    if re.search(r"(^|[_ -])g(as)?([_ -]|$)", norm(filename)):
        return "gas"
    if re.search(r"(^|[_ -])e(lettricita)?([_ -]|$)", norm(filename)):
        return "luce"
    return None


def infer_price_type(text: str) -> str | None:
    hay = norm(text)
    fixed = hay.rfind("prezzo fisso")
    variable = max(hay.rfind("prezzo variabile"), hay.rfind("indicizzato"))
    if fixed < 0 and variable < 0:
        return None
    return "fisso" if fixed > variable else "variabile"


def is_average_market_metric(text: str) -> bool:
    hay = norm(text)
    return (
        "spesa" in hay
        and "media" in hay
        and "mercato libero" in hay
        and "10%" not in hay
        and "piu convenient" not in hay
        and "meno convenient" not in hay
        and "tutela" not in hay
    )


def find_period_above(matrix: list[list[Any]], row: int, col: int) -> date | None:
    for r in range(row - 1, max(-1, row - 25), -1):
        if col < len(matrix[r]):
            period = parse_period(matrix[r][col])
            if period:
                return period
    return None


def points_from_workbook(path: Path) -> list[Point]:
    openpyxl = ensure_openpyxl()
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    found: list[Point] = []
    try:
        for ws in wb.worksheets:
            matrix = [list(row) for row in ws.iter_rows(values_only=True)]
            if not matrix:
                continue
            global_head = " ".join(norm(v) for row in matrix[:35] for v in row if v is not None)
            for r, row in enumerate(matrix):
                for c, cell in enumerate(row):
                    label = norm(cell)
                    if not is_average_market_metric(label):
                        continue
                    nearby = local_text(matrix, r, c)
                    commodity = infer_commodity(f"{global_head} {nearby}", path.name, ws.title)
                    price_type = infer_price_type(nearby) or infer_price_type(f"{ws.title} {global_head}")
                    if commodity not in {"luce", "gas"} or price_type not in {"fisso", "variabile"}:
                        continue
                    for cc in range(c + 1, len(row)):
                        value = numeric(row[cc])
                        if value is None or not (50 <= value <= 20000):
                            continue
                        period = find_period_above(matrix, r, cc)
                        if not period:
                            continue
                        found.append(Point(commodity, price_type, period, round(value, 4), path.name, ws.title, str(cell)))
    finally:
        wb.close()
    return found


def extract_official_points(
    attachment_bytes: bytes,
    required: set[tuple[str, str]] | None = None,
) -> dict[tuple[str, str], Point]:
    with tempfile.TemporaryDirectory(prefix="arera-retail-") as tmp:
        root = Path(tmp)
        with zipfile.ZipFile(io.BytesIO(attachment_bytes)) as archive:
            archive.extractall(root)
        files = sorted([p for p in root.rglob("*") if p.suffix.lower() in {".xlsx", ".xlsm"}])
        if not files:
            raise RuntimeError("L'allegato ARERA non contiene file XLSX/XLSM leggibili")
        candidates: list[Point] = []
        for path in files:
            candidates.extend(points_from_workbook(path))

    selected: dict[tuple[str, str], Point] = {}
    for point in candidates:
        key = (point.commodity, point.price_type)
        current = selected.get(key)
        if current is None or point.period > current.period:
            selected[key] = point
        elif current and point.period == current.period and abs(point.value - current.value) > 0.01:
            raise RuntimeError(
                f"Valori ARERA ambigui per {key[0]} {key[1]} {point.period:%Y-%m}: "
                f"{current.value} vs {point.value}"
            )
    if required is None:
        required = {(c, t) for c in ("luce", "gas") for t in ("fisso", "variabile")}
    missing = sorted(required - set(selected))
    if missing:
        raise RuntimeError("Riferimenti medi ARERA mancanti: " + ", ".join(f"{c}/{t}" for c, t in missing))
    return {key: selected[key] for key in required}


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def update_params(
    root: Path,
    selected: dict[tuple[str, str], Point],
    attachment_urls: dict[str, str],
) -> None:
    data_path = root / "data" / "calcolo-parametri.json"
    if not data_path.is_file():
        raise RuntimeError(f"File parametri assente: {data_path}")
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    calculation = payload.setdefault("parametriCalcolo", {})
    profile = calculation.setdefault("profiloMedio", {})
    profile["luceConsumoKwh"] = 2700
    profile["gasConsumoSmc"] = 1400
    profile["potenzaKw"] = "3"
    profile.setdefault("regioneGas", "nord-ovest")
    profile.setdefault("tipoPrezzo", "fisso")
    profile.setdefault("tipoFornitura", "dual")
    # Rimuove definitivamente i benchmark unitari/fissi ricostruiti da OffertaLogica.
    # Il percorso "non conosco i consumi" usa esclusivamente la spesa annua media ARERA.
    for obsolete in (
        "prezzoLuceEurKwh", "prezzoGasEurSmc",
        "quotaFissaLuceAnnua", "quotaFissaGasAnnua",
    ):
        profile.pop(obsolete, None)

    today = date.today().isoformat()
    reference: dict[str, Any] = {
        "metrica": METRIC,
        "fonte": SOURCE_LABEL,
        "urlPaginaLuce": ELECTRICITY_PAGE,
        "urlPaginaGas": GAS_PAGE,
        "urlAllegatoLuce": attachment_urls.get("luce", ""),
        "urlAllegatoGas": attachment_urls.get("gas", ""),
        "acquisitoIl": today,
        "nota": (
            "Valori ARERA pubblicati nel Monitoraggio Retail come spesa annua media delle offerte "
            "di mercato libero disponibili sul Portale Offerte, distinti tra prezzo fisso e variabile. "
            "Non sono medie calcolate da OffertaLogica."
        ),
        "profilo": {
            "luce": {"localita": "Milano", "consumoKwh": 2700, "potenzaKw": 3, "cliente": "domestico residente"},
            "gas": {"localita": "Milano", "consumoSmc": 1400, "uso": "cottura, acqua calda e riscaldamento", "cliente": "domestico"},
        },
        "luce": {},
        "gas": {},
    }
    for commodity in ("luce", "gas"):
        for price_type in ("fisso", "variabile"):
            point = selected[(commodity, price_type)]
            reference[commodity][price_type] = {
                "spesaAnnuaMediaEur": point.value,
                "periodo": point.period.strftime("%Y-%m"),
                "stato": "ufficiale",
                "fonte": SOURCE_LABEL,
                "workbook": point.workbook,
                "foglio": point.sheet,
            }

    calculation["riferimentiMercatoLibero"] = reference
    calculation["profiloConsumiFonte"] = {
        "fonte": SOURCE_LABEL,
        "urlPaginaLuce": ELECTRICITY_PAGE,
        "urlPaginaGas": GAS_PAGE,
        "acquisitoIl": today,
        "luceConsumoKwh": 2700,
        "gasConsumoSmc": 1400,
        "potenzaKw": "3",
        "nota": "Profili tipo usati da ARERA nelle analisi mensili delle offerte disponibili sul Portale Offerte.",
    }
    calculation["profiloMedioFonte"] = {
        "tipo": "arera_monitoraggio_retail_ufficiale",
        "fonte": SOURCE_LABEL,
        "urlAllegatoLuce": attachment_urls.get("luce", ""),
        "urlAllegatoGas": attachment_urls.get("gas", ""),
        "acquisitoIl": today,
        "metrica": METRIC,
        "nota": "Il riferimento medio non viene calcolato dal catalogo OffertaLogica.",
    }
    calculation["benchmarkCatalogoOffertaLogicaDisabilitato"] = True
    payload["aggiornatoIl"] = today
    payload["versioneDati"] = f"arera-reference-{today}"
    payload["fonte"] = "ARERA / GME - riferimenti ufficiali acquisiti localmente"

    write_json_atomic(data_path, payload)
    write_json_atomic(root / "public" / "data" / "calcolo-parametri.json", payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Acquisisce i riferimenti medi ufficiali ARERA del mercato libero")
    parser.add_argument("--package-root", default=".")
    parser.add_argument("--fixture-zip", help="ZIP locale per test senza rete")
    args = parser.parse_args()
    root = Path(args.package_root).resolve()

    required_all = {(c, t) for c in ("luce", "gas") for t in ("fisso", "variabile")}
    attachment_urls: dict[str, str] = {}

    if args.fixture_zip:
        attachment_bytes = Path(args.fixture_zip).read_bytes()
        selected = extract_official_points(attachment_bytes, required_all)
        attachment_urls = {
            "luce": "fixture://arera-monitoraggio-retail/luce",
            "gas": "fixture://arera-monitoraggio-retail/gas",
        }
    else:
        selected: dict[tuple[str, str], Point] = {}
        for commodity, page_url in (("luce", ELECTRICITY_PAGE), ("gas", GAS_PAGE)):
            required = {(commodity, "fisso"), (commodity, "variabile")}
            last_error: Exception | None = None
            chosen_url = ""
            sector_points: dict[tuple[str, str], Point] | None = None
            for candidate in discover_attachment_urls(page_url):
                try:
                    parsed = extract_official_points(fetch(candidate), required)
                except Exception as exc:
                    last_error = exc
                    continue
                sector_points = parsed
                chosen_url = candidate
                break
            if sector_points is None:
                raise RuntimeError(
                    f"Nessun allegato ARERA valido per {commodity} contiene i riferimenti fisso/variabile: {last_error}"
                )
            selected.update(sector_points)
            attachment_urls[commodity] = chosen_url

        missing = sorted(required_all - set(selected))
        if missing:
            raise RuntimeError("Riferimenti medi ARERA incompleti: " + ", ".join(f"{c}/{t}" for c, t in missing))

    update_params(root, selected, attachment_urls)
    for key in sorted(selected):
        point = selected[key]
        print(f"[ARERA-RETAIL] {point.commodity}/{point.price_type}: {point.value:.2f} EUR/anno ({point.period:%Y-%m})")
    print(f"[ARERA-RETAIL] Fonte luce: {attachment_urls.get('luce', '')}")
    print(f"[ARERA-RETAIL] Fonte gas: {attachment_urls.get('gas', '')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
