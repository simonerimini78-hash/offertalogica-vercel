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

PAGES = {
    "luce": "https://www.arera.it/dati-e-statistiche/dettaglio/analisi-delle-offerte-disponibili-sul-portale-offerte",
    "gas": "https://www.arera.it/dati-e-statistiche/dettaglio/analisi-delle-offerte-disponibili-sul-portale-offerte-1",
}
SOURCE_LABEL = "ARERA - Monitoraggio Retail - Analisi delle offerte disponibili sul Portale Offerte"
METRIC = "spesa_annua_media_offerte_mercato_libero_disponibili"
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
    text = html.unescape(str(value or "")).lower().replace("’", "'")
    text = text.replace("€", " eur ")
    text = re.sub(r"[^a-z0-9àèéìòù_./%+-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "*/*",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def _candidate_strings(body: str) -> list[str]:
    body = html.unescape(body).replace("\\/", "/")
    values: list[str] = []
    for match in re.finditer(r'''(?:href|src|data-[a-z0-9_-]+)\s*=\s*["']([^"']+)["']''', body, flags=re.I):
        values.append(match.group(1))
    for match in re.finditer(r'''https?://[^\s"'<>]+''', body, flags=re.I):
        values.append(match.group(0))
    # TYPO3/JSON can expose file paths as escaped strings without href attributes.
    for match in re.finditer(r'''(?:/fileadmin/|/_assets/)[^\s"'<>]+''', body, flags=re.I):
        values.append(match.group(0))
    return values


def discover_attachments(page_url: str) -> list[str]:
    body = fetch(page_url).decode("utf-8", errors="replace")
    result: list[str] = []
    for raw in _candidate_strings(body):
        value = raw.strip().rstrip(",;)")
        if not value:
            continue
        absolute = urllib.parse.urljoin(page_url, value)
        parsed = urllib.parse.urlparse(absolute)
        if parsed.netloc and not parsed.netloc.lower().endswith("arera.it"):
            continue
        decoded = urllib.parse.unquote(parsed.path).lower()
        # Accept direct office files and zip archives. Ignore icons/assets that
        # do not carry workbook/archive extensions.
        if not re.search(r"\.(?:zip|xlsx|xlsm|xls)$", decoded):
            continue
        result.append(absolute)
    return list(dict.fromkeys(result))


def _xlsx_col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return max(0, value - 1)


def _shared_strings(book: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(book.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    return ["".join(node.text or "" for node in item.findall(".//m:t", ns)) for item in root.findall("m:si", ns)]


def _sheet_targets(book: zipfile.ZipFile) -> list[tuple[str, str]]:
    main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    pkgrel = "http://schemas.openxmlformats.org/package/2006/relationships"
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    relationships = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    relmap = {node.attrib.get("Id", ""): node.attrib.get("Target", "") for node in relationships.findall(f"{{{pkgrel}}}Relationship")}
    output: list[tuple[str, str]] = []
    for sheet in workbook.findall(f".//{{{main}}}sheet"):
        name = sheet.attrib.get("name", "")
        rid = sheet.attrib.get(f"{{{rel}}}id", "")
        target = relmap.get(rid, "").lstrip("/")
        if not target:
            continue
        if not target.startswith("xl/"):
            target = "xl/" + target
        output.append((name, target))
    return output


def _matrix(book: zipfile.ZipFile, target: str, shared: list[str]) -> list[list[Any]]:
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    root = ET.fromstring(book.read(target))
    matrix: list[list[Any]] = []
    for row_node in root.findall(f".//{{{ns}}}row"):
        cells: dict[int, Any] = {}
        max_col = -1
        for cell in row_node.findall(f"{{{ns}}}c"):
            col = _xlsx_col_index(cell.attrib.get("r", "A1"))
            max_col = max(max_col, col)
            cell_type = cell.attrib.get("t", "")
            if cell_type == "inlineStr":
                value: Any = "".join(t.text or "" for t in cell.findall(f".//{{{ns}}}t"))
            else:
                node = cell.find(f"{{{ns}}}v")
                raw = node.text if node is not None else ""
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
            cells[col] = value
        if max_col < 0:
            matrix.append([])
        else:
            row = [None] * (max_col + 1)
            for col, value in cells.items():
                row[col] = value
            matrix.append(row)
    return matrix


def workbook_matrices(data: bytes, name: str) -> list[tuple[str, str, list[list[Any]]]]:
    result: list[tuple[str, str, list[list[Any]]]] = []
    with tempfile.TemporaryDirectory(prefix="arera-po-") as temp_dir:
        root = Path(temp_dir)
        with zipfile.ZipFile(io.BytesIO(data)) as top:
            names = set(top.namelist())
            if "xl/workbook.xml" in names:
                path = root / (name if name.lower().endswith((".xlsx", ".xlsm")) else "allegato.xlsx")
                path.write_bytes(data)
                files = [path]
            else:
                top.extractall(root)
                files = sorted(p for p in root.rglob("*") if p.suffix.lower() in {".xlsx", ".xlsm"})
        for path in files:
            with zipfile.ZipFile(path) as book:
                shared = _shared_strings(book)
                for sheet, target in _sheet_targets(book):
                    result.append((path.name, sheet, _matrix(book, target, shared)))
    return result


def parse_period(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date().replace(day=1)
    if isinstance(value, date):
        return value.replace(day=1)
    if isinstance(value, (int, float)) and 30000 <= float(value) <= 80000:
        try:
            return (datetime(1899, 12, 30) + timedelta(days=float(value))).date().replace(day=1)
        except (OverflowError, ValueError):
            return None
    text = norm(value)
    if not text:
        return None
    for pattern, order in (
        (r"\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b", "ym"),
        (r"\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b", "my"),
    ):
        m = re.search(pattern, text)
        if m:
            year, month = (int(m.group(1)), int(m.group(2))) if order == "ym" else (int(m.group(2)), int(m.group(1)))
            return date(year, month, 1)
    m = re.search(r"\b([a-zàèéìòù]{3,10})[- /](\d{2,4})\b", text)
    if m and m.group(1) in MONTHS:
        year = int(m.group(2))
        if year < 100:
            year += 2000
        return date(year, MONTHS[m.group(1)], 1)
    return None


def numeric(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        out = float(value)
        return out if out == out else None
    text = str(value).strip().replace("€", "").replace(" ", "")
    if not text:
        return None
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".") if text.rfind(",") > text.rfind(".") else text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    text = re.sub(r"[^0-9+-.]", "", text)
    try:
        return float(text)
    except ValueError:
        return None


@dataclass(frozen=True)
class Point:
    price_type: str
    period: date
    value: float
    workbook: str
    sheet: str


def price_type(text: str) -> str | None:
    text = norm(text)
    fixed = max(text.rfind("prezzo fisso"), text.rfind("fisso"))
    variable = max(text.rfind("prezzo variabile"), text.rfind("variabile"), text.rfind("indicizzat"))
    if fixed < 0 and variable < 0:
        return None
    return "fisso" if fixed > variable else "variabile"


def average_metric(text: str) -> bool:
    text = norm(text)
    if "10%" in text or "10 %" in text or "tutela" in text or "piu convenient" in text or "meno convenient" in text:
        return False
    market = "mercato libero" in text or "offerte disponibili" in text or "tutte le offerte" in text
    average = any(token in text for token in (
        "spesa annua mediamente sostenuta",
        "spesa media",
        "media delle offerte",
        "media offerte",
        "spesa annua media",
    ))
    return market and average


def profile_compatible(commodity: str, text: str) -> bool:
    text = norm(text)
    if commodity == "gas":
        if any(token in text for token in ("1400 smc", "1.400 smc", "1 400 smc")):
            return True
        # The gas detail page is already domestic 1,400 Smc; absence of a
        # profile label in the sheet is acceptable, but another explicit gas
        # consumption profile is not.
        return re.search(r"\b\d+[., ]?\d*\s*smc\b", text) is None
    if any(token in text for token in ("2700 kwh", "2.700 kwh", "2 700 kwh")) and ("3 kw" in text or "3kw" in text):
        return True
    explicit_other = any(token in text for token in ("4000 kwh", "4.000 kwh", "15000 kwh", "15.000 kwh", "6 kw", "12 kw"))
    return not explicit_other


def nearest_price_type(matrix: list[list[Any]], row: int, col: int, sheet: str) -> str | None:
    # Nearest row/column labels win over a generic sheet title.
    current = matrix[row]
    for distance in range(1, 16):
        for c in (col - distance, col + distance):
            if 0 <= c < len(current):
                kind = price_type(current[c])
                if kind:
                    return kind
    for distance in range(1, 20):
        for r in (row - distance, row + distance):
            if 0 <= r < len(matrix) and col < len(matrix[r]):
                kind = price_type(matrix[r][col])
                if kind:
                    return kind
    return price_type(sheet)


def period_near(matrix: list[list[Any]], row: int, col: int) -> date | None:
    current = matrix[row]
    for distance in range(1, max(len(current), 20)):
        for c in (col - distance, col + distance):
            if 0 <= c < len(current):
                period = parse_period(current[c])
                if period:
                    return period
    for r in range(row - 1, max(-1, row - 30), -1):
        if col < len(matrix[r]):
            period = parse_period(matrix[r][col])
            if period:
                return period
    return None


def points_for_sector(data: bytes, filename: str, commodity: str = "luce") -> list[Point]:
    found: list[Point] = []
    for workbook, sheet, matrix in workbook_matrices(data, filename):
        if not matrix:
            continue
        global_text = " ".join(norm(v) for row in matrix[:180] for v in row if v is not None)
        for r, row in enumerate(matrix):
            for c, cell in enumerate(row):
                if not isinstance(cell, str) or not average_metric(cell):
                    continue
                local_rows = []
                for rr in range(max(0, r - 15), min(len(matrix), r + 16)):
                    local_rows.extend(norm(v) for v in matrix[rr] if v is not None)
                profile_context = f"{workbook} {sheet} {' '.join(local_rows)}"
                if not profile_compatible(commodity, profile_context):
                    continue

                # Horizontal time series: label in first column, months/values to the right.
                for cc in range(c + 1, len(row)):
                    value = numeric(row[cc])
                    if value is None or not (50 <= value <= 20000):
                        continue
                    kind = nearest_price_type(matrix, r, cc, sheet)
                    if kind not in {"fisso", "variabile"}:
                        # If price type is encoded in the metric label itself.
                        kind = price_type(cell)
                    period = period_near(matrix, r, cc)
                    if kind and period:
                        found.append(Point(kind, period, round(value, 4), workbook, sheet))

                # Vertical time series: metric in a header, periods/values below.
                for rr in range(r + 1, min(len(matrix), r + 240)):
                    if c >= len(matrix[rr]):
                        continue
                    value = numeric(matrix[rr][c])
                    if value is None or not (50 <= value <= 20000):
                        continue
                    kind = nearest_price_type(matrix, rr, c, sheet) or price_type(cell)
                    period = period_near(matrix, rr, c)
                    if kind and period:
                        found.append(Point(kind, period, round(value, 4), workbook, sheet))
    return found

def select_latest(points: list[Point]) -> dict[str, Point]:
    selected: dict[str, Point] = {}
    for point in points:
        current = selected.get(point.price_type)
        if current is None or point.period > current.period:
            selected[point.price_type] = point
        elif current.period == point.period and abs(current.value - point.value) > 0.01:
            # Prefer the first exact metric candidate rather than inventing an
            # average between ambiguous source values.
            continue
    missing = {"fisso", "variabile"} - set(selected)
    if missing:
        raise RuntimeError("Dati ARERA mancanti per: " + ", ".join(sorted(missing)))
    return selected


def acquire_sector(commodity: str, fixture: str | None = None) -> tuple[dict[str, Point], str]:
    if fixture:
        data = Path(fixture).read_bytes()
        return select_latest(points_for_sector(data, Path(fixture).name, commodity)), f"fixture://{commodity}"

    page = PAGES[commodity]
    candidates = discover_attachments(page)
    if not candidates:
        raise RuntimeError(f"Nessun allegato Excel/ZIP trovato nella pagina ARERA {commodity}: {page}")
    errors: list[str] = []
    for url in candidates:
        try:
            data = fetch(url)
            points = points_for_sector(data, Path(urllib.parse.urlparse(url).path).name or "allegato-arera", commodity)
            selected = select_latest(points)
            return selected, url
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError(f"Nessun allegato ARERA {commodity} interpretabile. " + " | ".join(errors[-4:]))


def write_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def update_params(root: Path, sectors: dict[str, dict[str, Point]], urls: dict[str, str]) -> None:
    data_path = root / "data" / "calcolo-parametri.json"
    if not data_path.is_file():
        raise RuntimeError(f"File parametri assente: {data_path}")
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    calculation = payload.setdefault("parametriCalcolo", {})
    today = date.today().isoformat()

    reference: dict[str, Any] = {
        "metrica": METRIC,
        "fonte": SOURCE_LABEL,
        "acquisitoIl": today,
        "nota": "Valori letti dagli allegati ufficiali ARERA; OffertaLogica non calcola la media del catalogo.",
        "luce": {},
        "gas": {},
    }
    for commodity in ("luce", "gas"):
        reference[f"urlPagina{commodity.capitalize()}"] = PAGES[commodity]
        reference[f"urlAllegato{commodity.capitalize()}"] = urls[commodity]
        for kind in ("fisso", "variabile"):
            point = sectors[commodity][kind]
            reference[commodity][kind] = {
                "spesaAnnuaMediaEur": point.value,
                "periodo": point.period.strftime("%Y-%m"),
                "stato": "ufficiale",
                "fonte": SOURCE_LABEL,
                "workbook": point.workbook,
                "foglio": point.sheet,
            }

    # Overlay minimo: non cambia versioneDati, fonte, indici, catalogo o i
    # parametri legacy usati da altri percorsi. Aggiunge solo il riferimento
    # ufficiale che il frontend usa in modalita "non conosco i consumi".
    calculation["riferimentiMercatoLibero"] = reference
    calculation["profiloMedioFonte"] = {
        "tipo": "arera_monitoraggio_retail_ufficiale",
        "fonte": SOURCE_LABEL,
        "acquisitoIl": today,
        "metrica": METRIC,
        "urlPaginaLuce": PAGES["luce"],
        "urlPaginaGas": PAGES["gas"],
        "nota": "Nessuna media matematica viene calcolata da OffertaLogica.",
    }

    write_atomic(data_path, payload)
    write_atomic(root / "public" / "data" / "calcolo-parametri.json", payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Legge la spesa annua media ufficiale ARERA delle offerte di mercato libero")
    parser.add_argument("--package-root", default=".")
    parser.add_argument("--fixture-luce")
    parser.add_argument("--fixture-gas")
    args = parser.parse_args()
    root = Path(args.package_root).resolve()

    sectors: dict[str, dict[str, Point]] = {}
    urls: dict[str, str] = {}
    sectors["luce"], urls["luce"] = acquire_sector("luce", args.fixture_luce)
    sectors["gas"], urls["gas"] = acquire_sector("gas", args.fixture_gas)
    update_params(root, sectors, urls)

    for commodity in ("luce", "gas"):
        for kind in ("fisso", "variabile"):
            point = sectors[commodity][kind]
            print(f"[ARERA-MEDIA] {commodity}/{kind}: {point.value:.2f} EUR/anno ({point.period:%Y-%m})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
