#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import io
import json
import re
import tempfile
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

ARERA_STATS_PAGE = "https://www.arera.it/dati-e-statistiche?ADMCMD_prev=LIVE&keyword=&orderby=&settore=4"
ARERA_DETAIL_PAGE = "https://www.arera.it/dati-e-statistiche/dettaglio/analisi-delle-offerte-disponibili-sul-portale-offerte"
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


def discover_attachment_urls(page_url: str = ARERA_STATS_PAGE) -> list[str]:
    """Find the official ARERA Excel ZIP containing the Portale Offerte spending analysis.

    ARERA publishes one combined archive for electricity and gas.  We read the
    normal HTML page and follow the file link directly: no API and no derived
    market average.
    """
    body = fetch(page_url).decode("utf-8", errors="replace")
    hrefs = re.findall(r'href=["\']([^"\']+)["\']', body, flags=re.I)
    candidates: list[str] = []
    for href in hrefs:
        decoded = html.unescape(href).strip()
        if not decoded:
            continue
        absolute = urllib.parse.urljoin(page_url, decoded)
        parsed = urllib.parse.urlparse(absolute)
        path = urllib.parse.unquote(parsed.path)
        lower = path.lower()
        if not lower.endswith(".zip"):
            continue
        if "monitoraggioretail" not in lower:
            continue
        if "analisi_spesa_offerte_po" not in lower and "analisi-spesa-offerte-po" not in lower:
            continue
        candidates.append(absolute)
    if not candidates:
        raise RuntimeError("ZIP ARERA 'Analisi spesa offerte PO' non trovato nella pagina Dati e statistiche")
    # The filename carries a publication version; sort descending so the latest
    # linked archive is tried first when ARERA temporarily exposes more versions.
    return sorted(set(candidates), reverse=True)


def _xlsx_col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return max(0, value - 1)


def _xlsx_shared_strings(book: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(book.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    values: list[str] = []
    for item in root.findall("m:si", ns):
        values.append("".join(node.text or "" for node in item.findall(".//m:t", ns)))
    return values


def _xlsx_sheet_targets(book: zipfile.ZipFile) -> list[tuple[str, str]]:
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    pkgrel = "http://schemas.openxmlformats.org/package/2006/relationships"
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    relationships = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    relmap = {node.attrib.get("Id", ""): node.attrib.get("Target", "") for node in relationships.findall(f"{{{pkgrel}}}Relationship")}
    result: list[tuple[str, str]] = []
    for sheet in workbook.findall(f".//{{{main}}}sheet"):
        name = sheet.attrib.get("name", "")
        rid = sheet.attrib.get(f"{{{rel}}}id", "")
        target = relmap.get(rid, "")
        if not target:
            continue
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        result.append((name, target))
    return result


def _xlsx_matrix(book: zipfile.ZipFile, target: str, shared: list[str]) -> list[list[Any]]:
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    root = ET.fromstring(book.read(target))
    matrix: list[list[Any]] = []
    for row_node in root.findall(f".//{{{ns}}}row"):
        row_values: dict[int, Any] = {}
        max_col = -1
        for cell in row_node.findall(f"{{{ns}}}c"):
            ref = cell.attrib.get("r", "A1")
            col = _xlsx_col_index(ref)
            max_col = max(max_col, col)
            cell_type = cell.attrib.get("t", "")
            if cell_type == "inlineStr":
                value = "".join(t.text or "" for t in cell.findall(f".//{{{ns}}}t"))
            else:
                v = cell.find(f"{{{ns}}}v")
                raw = v.text if v is not None else ""
                if cell_type == "s":
                    try:
                        value = shared[int(raw)]
                    except (ValueError, IndexError):
                        value = raw
                elif cell_type in {"str", "e"}:
                    value = raw
                else:
                    try:
                        value = float(raw)
                    except (TypeError, ValueError):
                        value = raw
            row_values[col] = value
        if max_col < 0:
            matrix.append([])
            continue
        row = [None] * (max_col + 1)
        for col, value in row_values.items():
            row[col] = value
        matrix.append(row)
    return matrix


def workbook_matrices(path: Path) -> list[tuple[str, list[list[Any]]]]:
    with zipfile.ZipFile(path) as book:
        shared = _xlsx_shared_strings(book)
        return [(name, _xlsx_matrix(book, target, shared)) for name, target in _xlsx_sheet_targets(book)]


def parse_period(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date().replace(day=1)
    if isinstance(value, date):
        return value.replace(day=1)
    if isinstance(value, (int, float)) and 30000 <= float(value) <= 80000:
        # Excel serial date (1900 date system). ARERA workbooks may store the
        # month as a numeric date while displaying it as gen-26/feb-26.
        try:
            return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().replace(day=1)
        except (OverflowError, ValueError):
            return None
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


def target_profile_matches(commodity: str, context: str) -> bool:
    hay = norm(context)
    if commodity == "luce":
        has_consumption = any(token in hay for token in ("2700 kwh", "2.700 kwh", "2 700 kwh"))
        has_power = any(token in hay for token in ("3 kw", "3kw"))
        return has_consumption and has_power
    if commodity == "gas":
        return any(token in hay for token in ("1400 smc", "1.400 smc", "1 400 smc"))
    return False


def points_from_workbook(path: Path) -> list[Point]:
    found: list[Point] = []
    for sheet_name, matrix in workbook_matrices(path):
        if not matrix:
            continue
        # Include enough rows to catch the ARERA client-type description even
        # when the chart data start lower in the sheet.
        global_text = " ".join(norm(v) for row in matrix[:120] for v in row if v is not None)
        for r, row in enumerate(matrix):
            for c, cell in enumerate(row):
                label = norm(cell)
                if not is_average_market_metric(label):
                    continue
                nearby = local_text(matrix, r, c, radius_rows=25, radius_cols=14)
                context = f"{path.name} {sheet_name} {global_text} {nearby}"
                commodity = infer_commodity(context, path.name, sheet_name)
                price_type = infer_price_type(nearby) or infer_price_type(f"{sheet_name} {global_text}")
                if commodity not in {"luce", "gas"} or price_type not in {"fisso", "variabile"}:
                    continue
                if not target_profile_matches(commodity, context):
                    continue
                for cc in range(c + 1, len(row)):
                    value = numeric(row[cc])
                    if value is None or not (50 <= value <= 20000):
                        continue
                    period = find_period_above(matrix, r, cc)
                    if not period:
                        continue
                    found.append(Point(commodity, price_type, period, round(value, 4), path.name, sheet_name, str(cell)))
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
    attachment_url: str,
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
        "urlPagina": ARERA_DETAIL_PAGE,
        "urlDati": ARERA_STATS_PAGE,
        "urlAllegato": attachment_url,
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
        "urlPagina": ARERA_DETAIL_PAGE,
        "acquisitoIl": today,
        "luceConsumoKwh": 2700,
        "gasConsumoSmc": 1400,
        "potenzaKw": "3",
        "nota": "Profili tipo usati da ARERA nelle analisi mensili delle offerte disponibili sul Portale Offerte.",
    }
    calculation["profiloMedioFonte"] = {
        "tipo": "arera_monitoraggio_retail_ufficiale",
        "fonte": SOURCE_LABEL,
        "urlAllegato": attachment_url,
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
    if args.fixture_zip:
        attachment_url = "fixture://arera-monitoraggio-retail/analisi-spesa-offerte-po"
        selected = extract_official_points(Path(args.fixture_zip).read_bytes(), required_all)
    else:
        selected = None
        attachment_url = ""
        last_error: Exception | None = None
        for candidate in discover_attachment_urls():
            try:
                parsed = extract_official_points(fetch(candidate), required_all)
            except Exception as exc:
                last_error = exc
                continue
            selected = parsed
            attachment_url = candidate
            break
        if selected is None:
            raise RuntimeError(f"Nessun ZIP ARERA valido 'Analisi spesa offerte PO': {last_error}")

    update_params(root, selected, attachment_url)
    for key in sorted(selected):
        point = selected[key]
        print(f"[ARERA-RETAIL] {point.commodity}/{point.price_type}: {point.value:.2f} EUR/anno ({point.period:%Y-%m})")
    print(f"[ARERA-RETAIL] Fonte: {attachment_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
