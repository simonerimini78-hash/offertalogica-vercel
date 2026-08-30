#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
import urllib.request
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path

ARERA_PLACET_URL = "https://www.arera.it/consumatori/offerte-standard-per-i-clienti-finali-placet"
ARERA_PROFILE_URL = "https://www.arera.it/rapporti-e-relazioni/monitoraggio-retail/monitoraggio-retail-offerte-e-prezzi"
USER_AGENT = "OffertaLogica/1.0 (+https://offertalogica.it/)"
MONTHS = {
    "gennaio": 1,
    "febbraio": 2,
    "marzo": 3,
    "aprile": 4,
    "maggio": 5,
    "giugno": 6,
    "luglio": 7,
    "agosto": 8,
    "settembre": 9,
    "ottobre": 10,
    "novembre": 11,
    "dicembre": 12,
}
MONTH_LABELS = {value: key.capitalize() for key, value in MONTHS.items()}
STANDARD_PROFILE = {"luceConsumoKwh": 2700, "gasConsumoSmc": 1400, "potenzaKw": "3"}


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = re.sub(r"\s+", " ", data).strip()
        if value:
            self.parts.append(value)


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        body = response.read()
    return body.decode("utf-8", errors="replace")


def html_to_text(page_html: str) -> str:
    parser = TextExtractor()
    parser.feed(page_html)
    return re.sub(r"\s+", " ", html.unescape(" ".join(parser.parts))).strip()


def parse_decimal(value: str) -> float:
    return float(value.replace(".", "").replace(",", ".")) if "," in value else float(value)


def find_month_value(section: str) -> tuple[str, int, float]:
    month_pattern = "|".join(MONTHS)
    match = re.search(
        rf"\b({month_pattern})\s+(20\d{{2}})\s+([0-9]+(?:[.,][0-9]+)?)",
        section,
        flags=re.I,
    )
    if not match:
        raise RuntimeError("Valore mensile ARERA non trovato nella pagina PLACET")
    month_name = match.group(1).lower()
    return month_name, int(match.group(2)), parse_decimal(match.group(3))


def parse_arera_standard_profile(page_html: str) -> dict[str, object]:
    """Legge dal Monitoraggio Retail ARERA il profilo domestico usato nei confronti.

    Il parser non usa i valori di fallback per dichiarare la verifica: se la pagina
    ufficiale non espone esplicitamente consumi e potenza, l'aggiornamento fallisce.
    """
    text = html_to_text(page_html)

    light_match = re.search(
        r"domestico\s+residente[^.]{0,320}?([0-9]+(?:[.,][0-9]+)?)\s*kW[^.]{0,320}?([0-9]+(?:[.,][0-9]+)?)\s*kWh",
        text,
        flags=re.I,
    )
    gas_match = re.search(
        r"settore\s+del\s+gas[^.]{0,420}?domestico[^.]{0,260}?([0-9]+(?:[.,][0-9]+)?)\s*Smc",
        text,
        flags=re.I,
    )
    if not light_match or not gas_match:
        raise RuntimeError("Profilo domestico ARERA non riconosciuto nel Monitoraggio Retail")

    def integer_value(raw: str) -> int:
        normalized = raw.strip()
        # Nelle pagine italiane il punto separa le migliaia: 2.700 -> 2700.
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", normalized):
            return int(normalized.replace(".", ""))
        if re.fullmatch(r"\d{1,3}(?:,\d{3})+", normalized):
            return int(normalized.replace(",", ""))
        return int(round(float(normalized.replace(",", "."))))

    power = float(light_match.group(1).replace(",", "."))
    light = integer_value(light_match.group(2))
    gas = integer_value(gas_match.group(1))
    if not 1 <= power <= 15 or not 500 <= light <= 10000 or not 100 <= gas <= 5000:
        raise RuntimeError(
            f"Profilo domestico ARERA fuori intervallo plausibile: {power} kW, {light} kWh, {gas} Smc"
        )
    return {
        "luceConsumoKwh": light,
        "gasConsumoSmc": gas,
        "potenzaKw": str(int(power)) if power.is_integer() else str(power),
    }


def parse_placet_indices(page_html: str) -> dict[str, dict[str, object]]:
    text = html_to_text(page_html)
    lower = text.lower()
    light_start = lower.find("le offerte placet dell'energia elettrica")
    gas_start = lower.find("le offerte placet di gas naturale")
    if light_start < 0 or gas_start < 0 or gas_start <= light_start:
        raise RuntimeError("Sezioni elettricità/gas ARERA PLACET non riconosciute")

    light_section = text[light_start:gas_start]
    mono_pos = light_section.lower().find("monorario")
    if mono_pos < 0:
        raise RuntimeError("Valore monorario ARERA PLACET non riconosciuto")
    light_month, light_year, light_value = find_month_value(light_section[mono_pos:])

    gas_section = text[gas_start:]
    reference_pos = gas_section.lower().find("il prezzo a copertura dei costi di approvvigionamento")
    if reference_pos < 0:
        reference_pos = 0
    gas_month, gas_year, gas_value = find_month_value(gas_section[reference_pos:])

    if not 0.01 <= light_value <= 1.0:
        raise RuntimeError(f"PUN/P_ING ARERA fuori intervallo plausibile: {light_value}")
    if not 0.05 <= gas_value <= 5.0:
        raise RuntimeError(f"PSV/P_ING ARERA fuori intervallo plausibile: {gas_value}")

    def detail(month_name: str, year: int, value: float, commodity: str) -> dict[str, object]:
        month = MONTHS[month_name]
        period = f"{year:04d}-{month:02d}"
        if commodity == "pun":
            return {
                "label": "PUN Index GME / P_ING,M PLACET",
                "valore": round(value, 8),
                "unita": "eur_kwh",
                "periodo": period,
                "periodoLabel": f"{MONTH_LABELS[month]} {year}",
                "valoreOriginale": round(value * 1000, 6),
                "unitaOriginale": "eur_mwh",
                "fonte": "ARERA - Offerte PLACET",
                "urlFonte": ARERA_PLACET_URL,
                "acquisitoIl": date.today().isoformat(),
                "stato": "ufficiale",
                "note": "Media mensile monoraria P_ING,M pubblicata da ARERA per le offerte PLACET elettriche.",
            }
        return {
            "label": "PSV DA / P_ING,M PLACET",
            "valore": round(value, 8),
            "unita": "eur_smc",
            "periodo": period,
            "periodoLabel": f"{MONTH_LABELS[month]} {year}",
            "fonte": "ARERA - Offerte PLACET",
            "urlFonte": ARERA_PLACET_URL,
            "acquisitoIl": date.today().isoformat(),
            "stato": "ufficiale",
            "note": "Media mensile del prezzo giornaliero al PSV (day ahead) pubblicata da ARERA per le offerte PLACET gas.",
        }

    return {
        "pun": detail(light_month, light_year, light_value, "pun"),
        "psv": detail(gas_month, gas_year, gas_value, "psv"),
    }


def read_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_params(root: Path, payload: dict[str, object]) -> None:
    body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    for relative in (Path("data/calcolo-parametri.json"), Path("public/data/calcolo-parametri.json")):
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")


def update_indices(
    root: Path,
    page_html: str | None = None,
    profile_html: str | None = None,
) -> dict[str, object]:
    params_path = root / "data/calcolo-parametri.json"
    params = read_json(params_path)
    indices = parse_placet_indices(page_html if page_html is not None else fetch_text(ARERA_PLACET_URL))
    standard_profile = parse_arera_standard_profile(
        profile_html if profile_html is not None else fetch_text(ARERA_PROFILE_URL)
    )

    market = params.setdefault("indiciMercato", {})
    if not isinstance(market, dict):
        raise RuntimeError("indiciMercato non valido in calcolo-parametri.json")
    market["pun"] = indices["pun"]
    market["psv"] = indices["psv"]

    calculation = params.setdefault("parametriCalcolo", {})
    if not isinstance(calculation, dict):
        raise RuntimeError("parametriCalcolo non valido")
    profile = calculation.setdefault("profiloMedio", {})
    if not isinstance(profile, dict):
        raise RuntimeError("profiloMedio non valido")
    profile.update(standard_profile)

    periods = sorted({str(indices["pun"]["periodo"]), str(indices["psv"]["periodo"])})
    params["aggiornatoIl"] = date.today().isoformat()
    params["versioneDati"] = f"parametri-calcolo-{date.today().isoformat()}-arera-{'_'.join(periods)}"
    params["fonte"] = "ARERA: catalogo Portale Offerte e riferimenti mensili ufficiali PLACET. Nessun prezzo statico usato come indice di confronto."
    calculation["profiloConsumiFonte"] = {
        "fonte": "ARERA - Monitoraggio Retail - Offerte e prezzi",
        "urlFonte": ARERA_PROFILE_URL,
        "acquisitoIl": date.today().isoformat(),
        "profiloStandard": "Cliente domestico usato da ARERA per il monitoraggio delle offerte",
        "luceConsumoKwh": standard_profile["luceConsumoKwh"],
        "gasConsumoSmc": standard_profile["gasConsumoSmc"],
        "potenzaKw": standard_profile["potenzaKw"],
    }
    write_params(root, params)
    return params


def valid_catalog_rows(catalog: dict[str, object], commodity: str, price_type: str) -> list[dict[str, object]]:
    offers = catalog.get("offerte")
    if not isinstance(offers, list):
        raise RuntimeError("Catalogo ARERA privati non disponibile")
    rows = []
    for row in offers:
        if not isinstance(row, dict):
            continue
        if row.get("commodity") != commodity or row.get("tipo") != price_type:
            continue
        try:
            price = float(row["prezzo"])
            fee = float(row["quotaFissaAnnua"])
        except (KeyError, TypeError, ValueError):
            continue
        if price > 0 and fee >= 0:
            rows.append(row)
    return rows


def arithmetic_mean(values: list[float]) -> float:
    if not values:
        raise RuntimeError("Media ARERA non calcolabile: nessun valore")
    return sum(values) / len(values)


def update_benchmark(root: Path) -> dict[str, object]:
    params = read_json(root / "data/calcolo-parametri.json")
    catalog = read_json(root / "data/offerte-arera-menu.json")
    calculation = params.get("parametriCalcolo")
    if not isinstance(calculation, dict):
        raise RuntimeError("parametriCalcolo non valido")
    profile = calculation.get("profiloMedio")
    if not isinstance(profile, dict):
        raise RuntimeError("profiloMedio non valido")
    price_type = str(profile.get("tipoPrezzo") or "fisso").strip().lower()
    if price_type not in {"fisso", "variabile"}:
        price_type = "fisso"

    light_rows = valid_catalog_rows(catalog, "luce", price_type)
    gas_rows = valid_catalog_rows(catalog, "gas", price_type)
    if len(light_rows) < 10 or len(gas_rows) < 10:
        raise RuntimeError("Catalogo ARERA insufficiente per il benchmark medio")

    profile["prezzoLuceEurKwh"] = round(arithmetic_mean([float(row["prezzo"]) for row in light_rows]), 8)
    profile["prezzoGasEurSmc"] = round(arithmetic_mean([float(row["prezzo"]) for row in gas_rows]), 8)
    profile["quotaFissaLuceAnnua"] = round(arithmetic_mean([float(row["quotaFissaAnnua"]) for row in light_rows]), 4)
    profile["quotaFissaGasAnnua"] = round(arithmetic_mean([float(row["quotaFissaAnnua"]) for row in gas_rows]), 4)

    calculation["profiloMedioFonte"] = {
        "fonte": "Portale Offerte ARERA/Acquirente Unico Open Data",
        "catalogoVersione": catalog.get("versioneDati"),
        "catalogoAggiornatoIl": catalog.get("aggiornatoIl"),
        "tipoPrezzo": price_type,
        "metodoPrezzo": "Media aritmetica dei prezzi unitari e delle quote fisse delle offerte ARERA correnti per clienti privati dello stesso tipo prezzo.",
        "numeroOfferteLuce": len(light_rows),
        "numeroOfferteGas": len(gas_rows),
        "luceConsumoKwh": profile.get("luceConsumoKwh"),
        "gasConsumoSmc": profile.get("gasConsumoSmc"),
        "potenzaKw": profile.get("potenzaKw"),
    }
    params["aggiornatoIl"] = date.today().isoformat()
    write_params(root, params)
    return params


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sincronizza i riferimenti economici ARERA usati da OffertaLogica.")
    parser.add_argument("mode", choices=("indices", "benchmark"))
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.package_root.resolve()
    if args.mode == "indices":
        params = update_indices(root)
        print(f"[ARERA] Indici ufficiali sincronizzati: PUN={params['indiciMercato']['pun']['valore']} PSV={params['indiciMercato']['psv']['valore']}")
    else:
        params = update_benchmark(root)
        profile = params["parametriCalcolo"]["profiloMedio"]
        print(f"[ARERA] Benchmark medio sincronizzato: luce={profile['prezzoLuceEurKwh']} gas={profile['prezzoGasEurSmc']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
