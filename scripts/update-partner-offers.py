#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
PARTNER_CATALOG_VERSION = 1
GENERIC_PARSER_VERSION = "generic-cte-v1"
DEFAULT_PARTNER_ROOT = Path.home() / "Desktop" / "Offerte-Partner"
PARTNER_METADATA_FILE = ".offertalogica-partner.json"
ITALIAN_MONTHS = {
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


@dataclass(frozen=True)
class ParseResult:
    payload: dict[str, Any]
    text: str


def log(message: str) -> None:
    print(f"[PARTNER-OFFERS] {message}")


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_number(raw: str | None) -> float | None:
    if raw is None:
        return None
    value = str(raw).strip().replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return round(float(value), 8)
    except (TypeError, ValueError):
        return None


def parse_italian_date(raw: str | None) -> str | None:
    if not raw:
        return None
    text = normalize_space(raw).lower()
    match = re.search(r"\b(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})\b", text)
    if not match:
        return None
    month = ITALIAN_MONTHS.get(match.group(2))
    if not month:
        return None
    try:
        return date(int(match.group(3)), month, int(match.group(1))).isoformat()
    except ValueError:
        return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalizer_revision() -> str:
    """Fingerprint automatico del normalizzatore per invalidare la cache quando cambia il codice."""
    return sha256_file(Path(__file__).resolve())[:16]


def extract_pdf_text(path: Path) -> str:
    try:
        import pdfplumber  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime guard on Mac
        raise RuntimeError("pdfplumber non disponibile") from exc

    pages: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:1]:
            pages.append(page.extract_text() or "")
    text = "\n".join(pages).strip()
    if not text:
        raise ValueError("PDF senza testo estraibile")
    return text


def extract_pdf_text_multi(path: Path, max_pages: int = 12) -> str:
    """Estrae più pagine senza modificare il comportamento dei parser storici.

    I parser dedicati continuano a leggere la prima pagina come prima. Il parser
    generico usa invece fino a 12 pagine, perché validità e condizioni economiche
    dei nuovi fornitori sono spesso distribuite nel documento.
    """
    try:
        import pdfplumber  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime guard on Mac
        raise RuntimeError("pdfplumber non disponibile") from exc

    pages: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:max_pages]:
            pages.append(page.extract_text() or "")
    text = "\n".join(pages).strip()
    if not text:
        raise ValueError("PDF senza testo estraibile")
    return text


def first_match(pattern: str, text: str, flags: int = re.I | re.S) -> str | None:
    match = re.search(pattern, text, flags)
    return match.group(1).strip() if match else None


def detect_offer_name(text: str) -> str:
    lines = [normalize_space(line) for line in text.splitlines()]
    for idx, line in enumerate(lines):
        if "riservate esclusivamente" not in line.lower():
            continue
        for candidate in lines[idx + 1 : idx + 6]:
            if not candidate:
                continue
            low = candidate.lower()
            if low.startswith("le presenti condizioni") or low.startswith("vendita di"):
                break
            if len(candidate) <= 120 and not candidate.endswith("."):
                return candidate
    return ""


def parse_ccv(text: str, commodity: str) -> float | None:
    patterns = [
        r"CCV\s+FISSA\s*=\s*([0-9.,]+)\s*Euro/(?:Pdr|PdR)/Anno",
        r"Commercializzazione\s+e\s+Vendita\s+CCV\s*([0-9.,]+)\s*(?:€|Euro)/pod/anno",
    ]
    for pattern in patterns:
        value = parse_number(first_match(pattern, text))
        if value is not None:
            return value

    if commodity == "luce":
        inline = re.search(r"Commercializzazione\s+e\s+Vendita\s+CCV\s+([0-9.,]+)", text, re.I)
        if inline:
            value = parse_number(inline.group(1))
            if value is not None and value >= 24:
                return value
        marker = re.search(r"Commercializzazione\s+e\s+Vendita\s+CCV", text, re.I)
        if marker:
            segment = text[marker.start() : marker.start() + 350]
            values = [parse_number(raw) for raw in re.findall(r"([0-9.,]+)\s*(?:€|Euro)/pod/anno", segment, re.I)]
            values = [value for value in values if value is not None and value >= 24]
            if values:
                return max(values)

    unit = r"pod" if commodity == "luce" else r"(?:pdr|PdR|PDR)"
    marker = re.search(r"Totale\s+Corrispettivi\s+Fissi\s+Annui", text, re.I)
    if marker:
        segment = text[marker.start() : marker.start() + 500]
        match = re.search(rf"([0-9.,]+)\s*(?:€|Euro)/{unit}/anno", segment, re.I)
        if match:
            return parse_number(match.group(1))
    return None


def parse_electricity_spread(text: str) -> float | None:
    candidates: list[tuple[int, float]] = []
    pattern = re.compile(r"PUN\s+Index\s+GME(?:\s+(?:MONO|ORARIO))?\s*\+\s*([0-9.,]+)", re.I)
    for match in pattern.finditer(text):
        prefix = text[max(0, match.start() - 20) : match.start()].replace(" ", "")
        if "1,1*" in prefix or "1.1*" in prefix:
            continue
        value = parse_number(match.group(1))
        if value is not None:
            candidates.append((match.start(), value))
    return sorted(candidates)[0][1] if candidates else None


def parse_gas_spread(text: str) -> float | None:
    match = re.search(r"(?:Pgas\s*=\s*)?PSVt?\s*\+\s*([0-9.,]+)\s*Euro/Smc", text, re.I)
    return parse_number(match.group(1)) if match else None


def parse_fixed_price(text: str, commodity: str) -> float | None:
    if commodity == "gas":
        match = re.search(r"Prezzo\s+Gas\s+Fisso\s*([0-9.,]+)\s*Euro/Smc", text, re.I)
        return parse_number(match.group(1)) if match else None

    values = [parse_number(raw) for raw in re.findall(r"Fascia\s+Unica\s*=\s*([0-9.,]+)", text, re.I)]
    values = [value for value in values if value is not None]
    return values[0] if values else None


def parse_cap(text: str, commodity: str) -> float | None:
    if "P_CAP" not in text.upper():
        return None
    if commodity == "gas":
        match = re.search(r"Tetto\s+Massimo\s+al\s+prezzo\s*-\s*P_CAP\s*=*\s*([0-9.,]+)\s*Euro/Smc", text, re.I)
        if not match:
            match = re.search(r"Tetto\s+Massimo\s+al\s+prezzo\s*-\s*P_CAP[^\n]*?([0-9.,]+)\s*Euro/Smc", text, re.I)
        return parse_number(match.group(1)) if match else None

    explicit = re.search(r"P_CAP\s*=\s*([0-9.,]+)\s*Al\s+netto\s+delle\s+perdite", text, re.I)
    if explicit:
        return parse_number(explicit.group(1))
    marker = re.search(r"Tetto\s+Massimo\s+al\s+prezzo\s*-\s*P_CAP", text, re.I)
    if marker:
        segment = text[marker.start() : marker.start() + 350]
        next_price = re.search(r"Prezzo\s+Energia\s+per\s+il\s+consumo", segment[1:], re.I)
        if next_price:
            segment = segment[: next_price.start() + 1]
        values = [parse_number(v) for v in re.findall(r"\b([0-9]+[,.][0-9]+)\b", segment)]
        values = [v for v in values if v is not None and 0 < v < 1]
        if values:
            return min(values)
    return None


def parse_bonus_sdd(text: str, commodity: str) -> dict[str, Any] | None:
    match = re.search(
        r"Bonus\s+SDD[^\n]{0,120}?([0-9.,]+)\s*(?:€|Euro)/(?:pod|pdr)/anno",
        text,
        re.I,
    )
    if not match:
        match = re.search(
            r"Bonus\s+SDD:\s*in\s+caso\s+di\s+pagamento\s+con\s+SDD\s+si\s+applica\s+uno\s+sconto\s+pari\s+a\s+([0-9.,]+)\s*(?:€|Euro)/(?:pod|pdr)/anno",
            text,
            re.I,
        )
    value = parse_number(match.group(1)) if match else None
    if value is None:
        return None
    return {
        "name": "Bonus SDD",
        "value": value,
        "unit": "EUR/anno",
        "condition": "Pagamento tramite SDD",
        "includedInRanking": False,
    }


def add_component(items: list[dict[str, Any]], name: str, value: float | None, unit: str, classification: str) -> None:
    if value is None:
        return
    items.append({
        "name": name,
        "value": value,
        "unit": unit,
        "rankingTreatment": classification,
    })


def parse_extra_components(text: str, commodity: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if commodity == "luce":
        green = first_match(r"fonti\s+rinnovabili,\s+ad\s+un\s+costo\s+pari\s+a\s+([0-9.,]+)\s*Euro/kWh", text)
        modulation = first_match(r"Corrispettivo\s+di\s+modulazione\s+pari\s+a\s+([0-9.,]+)\s*Euro/kWh", text)
        add_component(items, "Energia verde", parse_number(green), "EUR/kWh", "detail_only")
        add_component(items, "Modulazione", parse_number(modulation), "EUR/kWh", "detail_only")
    else:
        ccv_var = first_match(r"CCV\s+Variabile\s*=\s*([0-9.,]+)\s*Euro/Smc", text)
        carbon = first_match(r"corrispettivo\s+previsto\s+è\s+di\s+([0-9.,]+)\s*Euro/Smc", text)
        cop = first_match(r"corrispettivo\s+COP[^\n]{0,120}?pari\s+a\s+([0-9.,]+)\s*Euro/Smc", text)
        add_component(items, "CCV variabile", parse_number(ccv_var), "EUR/Smc", "detail_only")
        add_component(items, "Crediti carbonio", parse_number(carbon), "EUR/Smc", "detail_only")
        add_component(items, "COP", parse_number(cop), "EUR/Smc", "detail_only")
    return items


def parse_extra_fixed_components(text: str, commodity: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if commodity == "gas":
        capacity = first_match(
            r"corrispettivo\s+a\s+copertura\s+dei\s+costi\s+fissi\s+di\s+capacità\s+di\s+trasporto\s+pari\s+a\s+([0-9.,]+)\s*Euro/Pdr/anno",
            text,
        )
        value = parse_number(capacity)
        if value is not None:
            items.append({
                "name": "Capacità di trasporto - quota fissa CTE",
                "value": value,
                "unit": "EUR/anno",
                "rankingTreatment": "annual_fixed_fee",
            })
    return items


def commercial_family(name: str) -> str:
    value = normalize_space(name).lower()
    value = re.sub(r"\b(?:energia\s+elettrica|gas\s+naturale|luce|gas)\b", " ", value)
    value = re.sub(r"\b24\s+mesi\b", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_greenius(path: Path, partner_key: str, partner_label: str, market_indices: dict[str, float]) -> ParseResult:
    text = extract_pdf_text(path)
    normalized = normalize_space(text)
    if "GREENIUS Srl" not in text or "04362490403" not in text:
        raise ValueError("CTE non riconosciuta come Greenius")

    code = first_match(r"Codice\s+offerta:\s*([A-Z0-9]+)", text)
    validity_raw = first_match(r"Validità\s+offerta\s+fino\s+al:\s*([^\n]+)", text)
    valid_to = parse_italian_date(validity_raw)
    offer_name = detect_offer_name(text)
    commodity = "luce" if "CONDIZIONI TECNICO ECONOMICHE ENERGIA ELETTRICA" in text.upper() else "gas"
    customer_type = "business" if "NON DOMESTICI" in text.upper() else "domestico"
    price_type = "fisso" if re.search(r"Prezzo\s+(?:Energia|Gas)\s+Fisso", text, re.I) else "variabile"
    annual_fixed_fee = parse_ccv(text, commodity)
    extra_fixed_components = parse_extra_fixed_components(text, commodity)
    if annual_fixed_fee is not None:
        annual_fixed_fee = round(annual_fixed_fee + sum(float(item["value"]) for item in extra_fixed_components), 8)
    cap_value = parse_cap(text, commodity)
    fixed_price = parse_fixed_price(text, commodity) if price_type == "fisso" else None
    spread = None
    index_name = None
    index_value = None
    projected_price = fixed_price

    if price_type == "variabile":
        index_name = "PUN" if commodity == "luce" else "PSV"
        spread = parse_electricity_spread(text) if commodity == "luce" else parse_gas_spread(text)
        index_value = market_indices.get(index_name.lower())
        if spread is not None and index_value is not None:
            projected_price = round(index_value + spread, 8)
            if cap_value is not None:
                projected_price = min(projected_price, cap_value)

    if not code or not valid_to or not offer_name:
        raise ValueError("Campi identificativi CTE incompleti")
    if annual_fixed_fee is None or projected_price is None:
        raise ValueError("Dati economici essenziali non leggibili")

    discounts: list[dict[str, Any]] = []
    bonus = parse_bonus_sdd(text, commodity)
    if bonus:
        discounts.append(bonus)

    source_hash = sha256_file(path)
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    canonical_key = f"04362490403|{commodity}|{code}"
    cap_enabled = cap_value is not None

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceType": "partner_direct",
        "partner": {
            "partnerKey": partner_key,
            "partnerLabel": partner_label,
        },
        "identity": {
            "canonicalKey": canonical_key,
            "providerKey": "greenius",
            "providerLabel": "Greenius",
            "providerVat": "04362490403",
            "offerCode": code,
            "offerName": offer_name,
            "commercialFamily": commercial_family(offer_name),
        },
        "classification": {
            "commodity": commodity,
            "customerType": customer_type,
            "priceType": price_type,
        },
        "validity": {
            "saleFrom": None,
            "saleTo": valid_to,
            "conditionsDurationMonths": 24 if price_type == "fisso" and "24 MESI" in offer_name.upper() else None,
        },
        "economics": {
            "indexName": index_name,
            "indexValueAtProjection": index_value,
            "fixedPrice": fixed_price,
            "spread": spread,
            "annualFixedFee": annual_fixed_fee,
            "networkLosses": {
                "rankingPriceConvention": "included" if commodity == "luce" and price_type == "fisso" else ("net" if commodity == "luce" else None),
            },
            "variableComponents": parse_extra_components(text, commodity),
            "fixedComponents": extra_fixed_components,
            "cap": {
                "enabled": cap_enabled,
                "value": cap_value,
                "unit": ("EUR/kWh" if commodity == "luce" else "EUR/Smc") if cap_enabled else None,
                "validForMonths": 12 if cap_enabled else None,
                "rule": "min(indice + spread, cap)" if cap_enabled else None,
            },
            "discounts": discounts,
        },
        "requirements": {
            "sdd": True if "SDD" in text.upper() else None,
            "digitalInvoice": True if "fatture tramite mail" in normalized.lower() else None,
            "powerConstraints": None,
            "geographicConstraints": None,
            "other": [],
        },
        "activation": {
            "channel": None,
            "partnerDirect": True,
        },
        "rankingProjection": {
            "eligible": True,
            "price": projected_price,
            "annualFixedFee": annual_fixed_fee,
            "projectionRule": (
                "prezzo fisso CTE comprensivo perdite" if price_type == "fisso" and commodity == "luce"
                else "prezzo fisso CTE" if price_type == "fisso"
                else "min(indice corrente + spread netto perdite, CAP)" if commodity == "luce" and cap_enabled
                else "indice corrente + spread netto perdite" if commodity == "luce"
                else "min(indice corrente + spread, CAP)" if cap_enabled
                else "indice corrente + spread"
            ),
            "exclusionReason": None,
        },
        "source": {
            "originalFile": path.name,
            "fileHash": source_hash,
            "normalizedAt": now,
        },
        "status": "normalizzata",
    }
    return ParseResult(payload=payload, text=text)



def parse_cte_date(raw: str | None) -> str | None:
    if not raw:
        return None
    text = normalize_space(raw)
    match = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", text)
    if match:
        try:
            return date(int(match.group(3)), int(match.group(2)), int(match.group(1))).isoformat()
        except ValueError:
            return None
    return parse_italian_date(text)


def detail_component(name: str, value: float | None, unit: str, note: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {
        "name": name,
        "value": value,
        "unit": unit,
        "rankingTreatment": "detail_only",
    }
    if note:
        item["note"] = note
    return item


def annual_fixed_component(name: str, value: float, unit: str = "EUR/anno") -> dict[str, Any]:
    return {
        "name": name,
        "value": round(float(value), 8),
        "unit": unit,
        "rankingTreatment": "annual_fixed_fee",
    }


def build_partner_payload(
    *,
    path: Path,
    partner_key: str,
    partner_label: str,
    provider_key: str,
    provider_label: str,
    provider_vat: str,
    offer_code: str,
    offer_name: str,
    commercial_family_name: str,
    commodity: str,
    customer_type: str,
    sale_from: str | None,
    sale_to: str,
    conditions_duration_months: int | None,
    index_name: str | None,
    spread: float | None,
    annual_fixed_fee: float,
    market_indices: dict[str, float],
    variable_components: list[dict[str, Any]] | None = None,
    fixed_components: list[dict[str, Any]] | None = None,
    requirements_other: list[str] | None = None,
    ranking_eligible: bool = True,
    exclusion_reason: str | None = None,
    alternative_offer_codes: list[str] | None = None,
    known_partial_variable_adder: float | None = None,
    unpriced_components: list[str] | None = None,
) -> ParseResult:
    if commodity not in {"luce", "gas"}:
        raise ValueError("commodity partner non supportata")
    if customer_type not in {"domestico", "business"}:
        raise ValueError("customerType partner non supportato")
    if not offer_code or not offer_name or not sale_to:
        raise ValueError("Campi identificativi CTE incompleti")
    if annual_fixed_fee < 0:
        raise ValueError("quota fissa partner negativa")

    index_value = market_indices.get(str(index_name or "").lower()) if index_name else None
    projected_price: float | None = None
    partial_price: float | None = None
    if ranking_eligible:
        if index_name not in {"PUN", "PSV"} or spread is None or index_value is None:
            raise ValueError("indice/spread non disponibili per la proiezione partner")
        projected_price = round(float(index_value) + float(spread), 8)
    elif known_partial_variable_adder is not None:
        if index_name not in {"PUN", "PSV"} or index_value is None:
            raise ValueError("indice non disponibile per la proiezione parziale partner")
        partial_price = round(float(index_value) + float(known_partial_variable_adder), 8)

    identity: dict[str, Any] = {
        "canonicalKey": f"{provider_vat}|{commodity}|{offer_code}",
        "providerKey": provider_key,
        "providerLabel": provider_label,
        "providerVat": provider_vat,
        "offerCode": offer_code,
        "offerName": offer_name,
        "commercialFamily": commercial_family_name,
    }
    alternatives = [str(code).strip() for code in (alternative_offer_codes or []) if str(code).strip() and str(code).strip() != offer_code]
    if alternatives:
        identity["alternativeOfferCodes"] = alternatives

    source_hash = sha256_file(path)
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceType": "partner_direct",
        "partner": {
            "partnerKey": partner_key,
            "partnerLabel": partner_label,
        },
        "identity": identity,
        "classification": {
            "commodity": commodity,
            "customerType": customer_type,
            "priceType": "variabile",
        },
        "validity": {
            "saleFrom": sale_from,
            "saleTo": sale_to,
            "conditionsDurationMonths": conditions_duration_months,
        },
        "economics": {
            "indexName": index_name,
            "indexValueAtProjection": index_value,
            "fixedPrice": None,
            "spread": spread,
            "annualFixedFee": round(float(annual_fixed_fee), 8),
            "economicCompleteness": "complete" if ranking_eligible else "partial",
            "knownPartialVariableAdder": round(float(known_partial_variable_adder), 8) if known_partial_variable_adder is not None else None,
            "unpricedComponents": [str(item).strip() for item in (unpriced_components or []) if str(item).strip()],
            "networkLosses": {
                "rankingPriceConvention": "net" if commodity == "luce" else None,
            },
            "variableComponents": variable_components or [],
            "fixedComponents": fixed_components or [],
            "cap": {
                "enabled": False,
                "value": None,
                "unit": None,
                "validForMonths": None,
                "rule": None,
            },
            "discounts": [],
        },
        "requirements": {
            "sdd": None,
            "digitalInvoice": None,
            "powerConstraints": None,
            "geographicConstraints": None,
            "other": requirements_other or [],
        },
        "activation": {
            "channel": None,
            "partnerDirect": True,
        },
        "rankingProjection": {
            "eligible": ranking_eligible,
            "price": projected_price,
            "partialPrice": partial_price,
            "annualFixedFee": round(float(annual_fixed_fee), 8),
            "projectionRule": "indice corrente + spread netto perdite" if ranking_eligible and commodity == "luce" else ("indice corrente + spread" if ranking_eligible else ("indice corrente + sole componenti note (parziale)" if partial_price is not None else None)),
            "exclusionReason": exclusion_reason,
        },
        "source": {
            "originalFile": path.name,
            "fileHash": source_hash,
            "normalizedAt": now,
        },
        "status": "normalizzata" if ranking_eligible else "normalizzata_non_calcolabile",
    }
    return ParseResult(payload=payload, text="")


def lion_green_commercial_family(name: str) -> str:
    value = normalize_space(name).lower().replace("_", " ")
    value = re.sub(r"\b(?:power|gas)\b", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def ovenergy_commercial_family(name: str) -> str:
    value = normalize_space(name).lower()
    value = re.sub(r"\b(?:pun|psv)\b", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    if value == "flex business":
        return "business flex"
    return value


def parse_lion_green(path: Path, partner_key: str, partner_label: str, market_indices: dict[str, float]) -> ParseResult:
    text = extract_pdf_text(path)
    normalized = normalize_space(text)
    code = first_match(r"Codice\s+offerta:\s*([A-Z0-9]+)", text)
    if not code or not code.startswith("039840") or "FAMILY FORCE" not in normalized.upper():
        raise ValueError("CTE non riconosciuta come Lion Green FAMILY FORCE")

    offer_name = first_match(r"Condizioni\s+Tecnico\s+Economiche\s*[–-]\s*Offerta\s+(.+?)\s+nel\s+Mercato\s+Libero", normalized)
    valid_to = parse_cte_date(first_match(r"richiesta\s+sia\s+effettuata\s+entro\s+il:\s*([0-9/.-]+)", text))
    header = normalized[:900].upper()
    commodity = "gas" if "FORNITURA DI GAS NATURALE" in header else "luce" if "FORNITURA DI ENERGIA ELETTRICA" in header else ""
    if not commodity:
        raise ValueError("commodity Lion Green non riconosciuta")
    annual_fixed_fee = parse_number(first_match(r"Corrispettivo\s+annuo\s+([0-9.,]+)\s*(?:€|Euro)/(?:POD|PdR)/anno", text))
    if not offer_name or not valid_to or annual_fixed_fee is None:
        raise ValueError("Campi identificativi/economici Lion Green incompleti")

    variable_components: list[dict[str, Any]] = []
    if commodity == "luce":
        gross_spread = parse_number(first_match(r"PUN_INDEX_GME\s*\+\s*α:\s*([0-9.,]+)\s*(?:€|Euro)/kWh", text))
        if gross_spread is None:
            raise ValueError("spread luce Lion Green non leggibile")
        spread = round(gross_spread / 1.10, 8)
        variable_components.append(detail_component(
            "Spread CTE comprensivo perdite di rete",
            gross_spread,
            "EUR/kWh",
            "Normalizzato al netto delle perdite per coerenza con il motore, che applica separatamente il fattore perdite.",
        ))
        index_name = "PUN"
    else:
        spread = parse_number(first_match(r"PSV\s*\+\s*α:\s*([0-9.,]+)\s*(?:€|Euro)/Smc", text))
        if spread is None:
            raise ValueError("spread gas Lion Green non leggibile")
        index_name = "PSV"

    result = build_partner_payload(
        path=path,
        partner_key=partner_key,
        partner_label=partner_label,
        provider_key="liongreen",
        provider_label="Lion Green",
        provider_vat="04569010616",
        offer_code=code,
        offer_name=offer_name,
        commercial_family_name=lion_green_commercial_family(offer_name),
        commodity=commodity,
        customer_type="domestico",
        sale_from=None,
        sale_to=valid_to,
        conditions_duration_months=12,
        index_name=index_name,
        spread=spread,
        annual_fixed_fee=annual_fixed_fee,
        market_indices=market_indices,
        variable_components=variable_components,
        fixed_components=[annual_fixed_component("Corrispettivo annuo CTE", annual_fixed_fee)],
        requirements_other=["Condizioni economiche valide per i primi 12 mesi dalla data di attivazione."],
    )
    return ParseResult(payload=result.payload, text=text)


def parse_ovenergy(path: Path, partner_key: str, partner_label: str, market_indices: dict[str, float]) -> ParseResult:
    text = extract_pdf_text(path)
    normalized = normalize_space(text)
    codes: list[str] = []
    for code in re.findall(r"\b021889[A-Z0-9]{20,}\b", text):
        if code not in codes:
            codes.append(code)
    if not codes:
        raise ValueError("CTE non riconosciuta come OV Energy")

    validity = re.search(r"Offerta\s+sottoscrivibile\s+dal\s+([0-9/.-]+)\s+al\s+([0-9/.-]+)", text, re.I)
    sale_from = parse_cte_date(validity.group(1)) if validity else None
    sale_to = parse_cte_date(validity.group(2)) if validity else None
    offer_name = None
    for known_name in ("PSV Domestici Flex", "PSV Flex Business", "PUN Domestici Flex", "PUN Business Flex"):
        if known_name.lower() in normalized.lower():
            offer_name = known_name
            break
    if not sale_from or not sale_to or not offer_name:
        raise ValueError("Campi identificativi OV Energy incompleti")

    header = normalized[:900].upper()
    commodity = "gas" if "FORNITURA DI GAS NATURALE" in header else "luce" if "FORNITURA DI ENERGIA ELETTRICA" in header else ""
    if not commodity:
        raise ValueError("commodity OV Energy non riconosciuta")
    customer_type = "business" if "NON DOMESTIC" in normalized.upper() else "domestico"
    family = ovenergy_commercial_family(offer_name)
    variable_components: list[dict[str, Any]] = []
    fixed_components: list[dict[str, Any]] = []
    requirements_other = ["Condizioni economiche riferite ai primi 12 mesi dalla data di attivazione."]

    if customer_type == "domestico" and commodity == "gas":
        spread = parse_number(first_match(r"Corrispettivo\s+per\s+il\s+Consumo\s+PSV\s*\+\s*([0-9.,]+)\s*(?:€|Euro)/Smc", text))
        programming = parse_number(first_match(r"Onere\s+di\s+programmazione\s+([0-9.,]+)\s*(?:€|Euro)/PdR/Anno", text))
        monthly_fixed = parse_number(first_match(r"fatturato\s+in\s+quote\s+mensili\s+pari\s+a\s+([0-9.,]+)\s*(?:€|Euro)/mese", text))
        spread_month_13 = parse_number(first_match(r"dal\s+13\s+mese\s+PSV\s*\+\s*([0-9.,]+)\s*(?:€|Euro)/Smc", text))
        if spread is None or programming is None or monthly_fixed is None:
            raise ValueError("Dati economici OV Energy PSV Domestici incompleti")
        annual_monthly_fixed = round(monthly_fixed * 12, 8)
        annual_fixed_fee = round(programming + annual_monthly_fixed, 8)
        fixed_components.extend([
            annual_fixed_component("Onere di programmazione", programming),
            annual_fixed_component("Corrispettivo annuo fisso", annual_monthly_fixed),
        ])
        if spread_month_13 is not None:
            variable_components.append(detail_component("Spread dal 13° mese", spread_month_13, "EUR/Smc"))
        result = build_partner_payload(
            path=path,
            partner_key=partner_key,
            partner_label=partner_label,
            provider_key="ovenergy",
            provider_label="OV Energy",
            provider_vat="12952081003",
            offer_code=codes[0],
            offer_name=offer_name,
            commercial_family_name=family,
            commodity=commodity,
            customer_type=customer_type,
            sale_from=sale_from,
            sale_to=sale_to,
            conditions_duration_months=12,
            index_name="PSV",
            spread=spread,
            annual_fixed_fee=annual_fixed_fee,
            market_indices=market_indices,
            variable_components=variable_components,
            fixed_components=fixed_components,
            requirements_other=requirements_other,
        )
        return ParseResult(payload=result.payload, text=text)

    if customer_type == "domestico" and commodity == "luce":
        gross_spread = parse_number(first_match(r"Corrispettivo\s+per\s+il\s+consumo\s+PUN\s+Index\s+GME\s*\+\s*([0-9.,]+)\s*(?:€|Euro)/kWh", text))
        programming = parse_number(first_match(r"Onere\s+di\s+programmazione\s+([0-9.,]+)\s*(?:€|Euro)/POD/anno", text))
        monthly_fixed = parse_number(first_match(r"fatturato\s+in\s+quote\s+mensili\s+pari\s+a\s+([0-9.,]+)\s*(?:€|Euro)/mese", text))
        gross_spread_month_13 = parse_number(first_match(r"dal\s+13\s+mese\s+PUN\s+Index\s+GME\s*\+\s*([0-9.,]+)\s*(?:€|Euro)/kWh", text))
        cdispd = parse_number(first_match(r"CDISPD.{0,220}?pari\s+al\s+valore\s+([0-9.,]+)", normalized))
        if gross_spread is None or programming is None or monthly_fixed is None:
            raise ValueError("Dati economici OV Energy PUN Domestici incompleti")
        spread = round(gross_spread / 1.10, 8)
        annual_monthly_fixed = round(monthly_fixed * 12, 8)
        annual_fixed_fee = round(programming + annual_monthly_fixed, 8)
        variable_components.append(detail_component(
            "Spread CTE comprensivo perdite di rete",
            gross_spread,
            "EUR/kWh",
            "Normalizzato al netto delle perdite per coerenza con il motore, che applica separatamente il fattore perdite.",
        ))
        if gross_spread_month_13 is not None:
            variable_components.append(detail_component("Spread CTE dal 13° mese comprensivo perdite", gross_spread_month_13, "EUR/kWh"))
        if cdispd is not None:
            variable_components.append(detail_component(
                "C_DISPD indicato nella CTE",
                cdispd,
                "EUR/kWh",
                "Voce regolata documentata ma esclusa dal ranking partner: il motore applica separatamente il C_DISPD corrente.",
            ))
        fixed_components.extend([
            annual_fixed_component("Onere di programmazione", programming),
            annual_fixed_component("Corrispettivo annuo fisso", annual_monthly_fixed),
        ])
        result = build_partner_payload(
            path=path,
            partner_key=partner_key,
            partner_label=partner_label,
            provider_key="ovenergy",
            provider_label="OV Energy",
            provider_vat="12952081003",
            offer_code=codes[0],
            offer_name=offer_name,
            commercial_family_name=family,
            commodity=commodity,
            customer_type=customer_type,
            sale_from=sale_from,
            sale_to=sale_to,
            conditions_duration_months=12,
            index_name="PUN",
            spread=spread,
            annual_fixed_fee=annual_fixed_fee,
            market_indices=market_indices,
            variable_components=variable_components,
            fixed_components=fixed_components,
            requirements_other=requirements_other,
        )
        return ParseResult(payload=result.payload, text=text)

    if customer_type == "business" and commodity == "gas":
        base_spread = parse_number(first_match(r"Spread\s+([0-9.,]+)\s*(?:€|Euro)/Smc", text))
        contractual_monthly = parse_number(first_match(r"quota\s+fissa.{0,160}?([0-9.,]+)\s*(?:€|Euro)/mese", normalized))
        programming_monthly = parse_number(first_match(r"onere\s+di\s+programmazione.{0,140}?([0-9.,]+)\s*(?:€|Euro)/mese", normalized))
        cpr = parse_number(first_match(r"componente\s+sostitutiva\s+della\s+CPR\s+pari\s+a\s+([0-9.,]+)\s*(?:€|Euro)/Smc", normalized))
        ccr = parse_number(first_match(r"componente\s+sostitutiva\s+della\s+CCR\s+pari\s+a\s+([0-9.,]+)\s*(?:€|Euro)/Smc", normalized))
        if base_spread is None or contractual_monthly is None or programming_monthly is None:
            raise ValueError("Dati documentali OV Energy PSV Business incompleti")
        annual_fixed_fee = round((contractual_monthly + programming_monthly) * 12, 8)
        variable_components.extend([
            detail_component("Spread energia CTE", base_spread, "EUR/Smc"),
            detail_component("QTint", None, "EUR/Smc", "Componente richiamata dalla CTE senza valore unitario riportato."),
            detail_component("QTpsv", None, "EUR/Smc", "Componente richiamata dalla CTE senza valore unitario riportato."),
            detail_component("CPR sostitutiva", cpr, "EUR/Smc"),
            detail_component("CCR sostitutiva", ccr, "EUR/Smc"),
            detail_component("QOA", None, "EUR/Smc", "Componente richiamata dalla CTE senza valore unitario riportato."),
        ])
        fixed_components.extend([
            annual_fixed_component("Quota fissa contrattuale", contractual_monthly * 12),
            annual_fixed_component("Onere di programmazione", programming_monthly * 12),
        ])
        exclusion = "CTE business normalizzata a fini documentali: QTint, QTpsv e QOA non hanno un valore unitario completo modellabile dal ranking partner corrente."
        requirements_other.append(exclusion)
        result = build_partner_payload(
            path=path,
            partner_key=partner_key,
            partner_label=partner_label,
            provider_key="ovenergy",
            provider_label="OV Energy",
            provider_vat="12952081003",
            offer_code=codes[0],
            offer_name=offer_name,
            commercial_family_name=family,
            commodity=commodity,
            customer_type=customer_type,
            sale_from=sale_from,
            sale_to=sale_to,
            conditions_duration_months=12,
            index_name="PSV",
            spread=None,
            annual_fixed_fee=annual_fixed_fee,
            market_indices=market_indices,
            variable_components=variable_components,
            fixed_components=fixed_components,
            requirements_other=requirements_other,
            ranking_eligible=False,
            exclusion_reason=exclusion,
            alternative_offer_codes=codes[1:],
            known_partial_variable_adder=round(base_spread + float(cpr or 0) + float(ccr or 0), 8),
            unpriced_components=["QTint", "QTpsv", "QOA"],
        )
        return ParseResult(payload=result.payload, text=text)

    if customer_type == "business" and commodity == "luce":
        base_spread = parse_number(first_match(r"Spread\s+([0-9.,]+)\s*(?:€|Euro)/kWh", text))
        gross_spread = parse_number(first_match(r"Spread\s+comprensivo\s+delle\s+perdite\s+di\s+rete\s+([0-9.,]+)\s*(?:€|Euro)/kWh", text))
        programming_monthly = parse_number(first_match(r"onere\s+di\s+programmazione\s+pari\s+a\s+([0-9.,]+)\s*(?:€|Euro)/POD/mese", normalized))
        commercial_variable = parse_number(first_match(r"commercializzazione\s+e\s+vendita\s+variabile\s+pari\s+a\s+([0-9.,]+)\s*(?:€|Euro)/kWh", normalized))
        if base_spread is None or programming_monthly is None or commercial_variable is None:
            raise ValueError("Dati documentali OV Energy PUN Business incompleti")
        annual_fixed_fee = round(programming_monthly * 12, 8)
        variable_components.extend([
            detail_component("Spread energia CTE", base_spread, "EUR/kWh"),
            detail_component("Spread CTE comprensivo perdite di rete", gross_spread, "EUR/kWh"),
            detail_component("Commercializzazione e vendita variabile", commercial_variable, "EUR/kWh"),
            detail_component("Dispacciamento TIDE", None, "EUR/kWh", "Voce richiamata dalla CTE ma non valorizzata nella normalizzazione corrente."),
            detail_component("Mercato capacità CMC", None, "EUR/kWh", "Voce richiamata dalla CTE ma non valorizzata nella normalizzazione corrente."),
        ])
        fixed_components.append(annual_fixed_component("Onere di programmazione", annual_fixed_fee))
        exclusion = "CTE business normalizzata a fini documentali: la struttura commerciale multi-componente e i due codici offerta non sono rappresentati integralmente dal ranking partner corrente."
        requirements_other.append(exclusion)
        result = build_partner_payload(
            path=path,
            partner_key=partner_key,
            partner_label=partner_label,
            provider_key="ovenergy",
            provider_label="OV Energy",
            provider_vat="12952081003",
            offer_code=codes[0],
            offer_name=offer_name,
            commercial_family_name=family,
            commodity=commodity,
            customer_type=customer_type,
            sale_from=sale_from,
            sale_to=sale_to,
            conditions_duration_months=12,
            index_name="PUN",
            spread=None,
            annual_fixed_fee=annual_fixed_fee,
            market_indices=market_indices,
            variable_components=variable_components,
            fixed_components=fixed_components,
            requirements_other=requirements_other,
            ranking_eligible=False,
            exclusion_reason=exclusion,
            alternative_offer_codes=codes[1:],
            known_partial_variable_adder=None,
            unpriced_components=["Dispacciamento TIDE", "Mercato capacità CMC"],
        )
        return ParseResult(payload=result.payload, text=text)

    raise ValueError("CTE OV Energy non supportata")


def load_partner_metadata(partner_dir: Path) -> dict[str, Any]:
    path = partner_dir / PARTNER_METADATA_FILE
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def generic_unique(values: list[Any], *, digits: int = 8) -> Any | None:
    normalized: list[Any] = []
    for value in values:
        if value is None or value == "":
            continue
        item = round(float(value), digits) if isinstance(value, (int, float)) else str(value).strip()
        if item not in normalized:
            normalized.append(item)
    return normalized[0] if len(normalized) == 1 else None


def generic_provider_vat(text: str, provider_label: str) -> str | None:
    matches: list[tuple[str, int]] = []
    pattern = re.compile(
        r"(?:partita\s+iva|p\.?\s*iva|piva|codice\s+fiscale\s+e\s+partita\s+iva)\s*(?:n\.?|numero)?\s*[:\-]?\s*([0-9][0-9 .]{9,16})",
        re.I,
    )
    for match in pattern.finditer(text):
        digits_value = re.sub(r"\D", "", match.group(1))
        if len(digits_value) == 11:
            matches.append((digits_value, match.start()))
    unique = sorted({value for value, _ in matches})
    if len(unique) == 1:
        return unique[0]
    if len(unique) <= 1:
        return None

    tokens = [token for token in re.findall(r"[a-z0-9]+", provider_label.lower()) if len(token) >= 4]
    if not tokens:
        return None
    lower = text.lower()
    provider_positions: list[int] = []
    for token in tokens[:3]:
        provider_positions.extend(match.start() for match in re.finditer(re.escape(token), lower))
    if not provider_positions:
        return None
    scored = sorted(
        ((min(abs(position - provider_position) for provider_position in provider_positions), value) for value, position in matches),
        key=lambda item: item[0],
    )
    if len(scored) == 1 or (scored[0][0] + 250 < scored[1][0]):
        return scored[0][1]
    return None


def generic_offer_code(text: str) -> str | None:
    patterns = (
        r"codice\s+(?:dell['’]\s*)?offerta(?:\s+arera)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,63})",
        r"codice\s+(?:prodotto|commerciale)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,63})",
    )
    values: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.I):
            value = match.group(1).strip(" .,:;-_").upper()
            if value and value not in values:
                values.append(value)
    return values[0] if len(values) == 1 else None


def generic_offer_name(text: str) -> str | None:
    normalized = normalize_space(text)
    patterns = (
        r"(?:nome|denominazione)\s+(?:dell['’]\s*)?offerta\s*[:\-]\s*([^|;]{3,120}?)(?=\s{2,}|\s+(?:codice|validit|fornitura|mercato)\b|$)",
        r'condizioni\s+(?:tecnico\s+)?economiche\s+(?:dell[\'’]\s*)?offerta\s*[\"“]?([^\"”|;]{3,100})[\"”]?',
        r'offerta\s+[\"“]([^\"”]{3,100})[\"”]',
    )
    candidates: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, normalized, re.I):
            value = normalize_space(match.group(1)).strip(" -–—:.;")
            if value and not re.search(r"\b(?:mercato libero|energia elettrica|gas naturale)\b$", value, re.I):
                candidates.append(value)
    unique: list[str] = []
    for value in candidates:
        if value.lower() not in {item.lower() for item in unique}:
            unique.append(value)
    return unique[0] if len(unique) == 1 else None


def generic_date_after_labels(text: str, labels: tuple[str, ...]) -> str | None:
    candidates: list[str] = []
    for label in labels:
        pattern = rf"{label}[^\n]{{0,90}}?((?:\d{{1,2}}[/-]\d{{1,2}}[/-]\d{{4}})|(?:\d{{1,2}}\s+[A-Za-zÀ-ÿ]+\s+\d{{4}}))"
        for match in re.finditer(pattern, text, re.I):
            parsed = parse_cte_date(match.group(1))
            if parsed and parsed not in candidates:
                candidates.append(parsed)
    return candidates[0] if len(candidates) == 1 else None


def generic_commodity(text: str) -> str | None:
    head = normalize_space(text[:7000]).lower()
    explicit_light = bool(re.search(r"(?:fornitura|condizioni[^.]{0,80})\s+(?:di\s+)?energia\s+elettrica", head))
    explicit_gas = bool(re.search(r"(?:fornitura|condizioni[^.]{0,80})\s+(?:di\s+)?gas\s+naturale", head))
    if explicit_light != explicit_gas:
        return "luce" if explicit_light else "gas"
    light = len(re.findall(r"\benergia\s+elettrica\b|\bkwh\b|\bpod\b", head))
    gas = len(re.findall(r"\bgas\s+naturale\b|\bsmc\b|\bpdr\b", head))
    if light >= max(2, gas * 2):
        return "luce"
    if gas >= max(2, light * 2):
        return "gas"
    return None


def generic_customer_type(text: str) -> str | None:
    head = normalize_space(text[:9000]).lower()
    business = bool(re.search(r"\b(?:clienti?|forniture?)\s+non\s+domestic[iohe]\b|\bmicroimpres|\bpiccole\s+imprese\b|\bclienti?\s+business\b", head))
    domestic = bool(re.search(r"\b(?:clienti?|forniture?|uso)\s+domestic[iohe]\b", head))
    if business != domestic:
        return "business" if business else "domestico"
    return None


def generic_price_type(text: str, commodity: str) -> str | None:
    normalized = normalize_space(text).lower()
    index_pattern = r"\bpun(?:\s+index\s+gme)?\b" if commodity == "luce" else r"\bpsv(?:\s+day\s+ahead)?\b"
    variable = bool(re.search(index_pattern + r"[^.;]{0,120}?\+\s*[0-9]", normalized)) or bool(re.search(r"\bprezzo\s+(?:variabile|indicizzato)\b", normalized))
    fixed = bool(re.search(r"\bprezzo\s+fisso\b|\bcorrispettivo\s+fisso\b", normalized))
    if variable and not fixed:
        return "variabile"
    if fixed and not variable:
        return "fisso"
    return None


def generic_money_candidates(text: str, keywords: str, commodity: str, *, fixed_fee: bool = False) -> list[tuple[float, str, str]]:
    unit = r"(?:kWh|MWh)" if commodity == "luce" else r"(?:Smc|MWh)"
    if fixed_fee:
        unit = r"(?:(?:POD|PdR|PDR)\s*/\s*)?(?:mese|anno)|(?:POD|PdR|PDR)\s*/\s*(?:mese|anno)"
    pattern = re.compile(
        rf"({keywords})[^\n.;]{{0,150}}?([0-9]+(?:[.,][0-9]+)?)\s*(?:€|euro|eur)\s*/\s*({unit})",
        re.I,
    )
    result: list[tuple[float, str, str]] = []
    for match in pattern.finditer(text):
        value = parse_number(match.group(2))
        if value is None:
            continue
        result.append((float(value), normalize_space(match.group(1)), normalize_space(match.group(3))))
    return result


def generic_annual_fixed_fee(text: str, commodity: str) -> tuple[float | None, list[dict[str, Any]]]:
    keywords = r"(?:quota\s+fissa(?:\s+di\s+vendita)?|corrispettivo\s+(?:annuo\s+)?fisso|commercializzazione\s+e\s+vendita|commercializzazione|\bCCV\b|\bPCV\b)"
    candidates = generic_money_candidates(text, keywords, commodity, fixed_fee=True)
    normalized: list[tuple[float, str]] = []
    for value, label, unit in candidates:
        unit_lower = unit.lower()
        annual = value * 12 if "mese" in unit_lower else value
        if annual < 0 or annual > 2000:
            continue
        normalized.append((round(annual, 8), label))
    values = [value for value, _ in normalized]
    selected = generic_unique(values)
    if selected is None:
        return None, []
    return float(selected), [annual_fixed_component("Quota fissa vendita CTE", float(selected))]


def generic_price_value(text: str, commodity: str, price_type: str, losses_factor: float) -> tuple[float | None, float | None, str | None, list[dict[str, Any]], str | None]:
    unit_pattern = r"(?:kWh|MWh)" if commodity == "luce" else r"(?:Smc|MWh)"
    variable_components: list[dict[str, Any]] = []
    network_convention: str | None = None
    if price_type == "variabile":
        index_name = "PUN" if commodity == "luce" else "PSV"
        index_pattern = r"PUN(?:\s+Index\s+GME)?" if commodity == "luce" else r"PSV(?:\s+Day\s+Ahead)?"
        pattern = re.compile(
            rf"({index_pattern})[^\n.;]{{0,90}}?\+\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:€|euro|eur)\s*/\s*({unit_pattern})",
            re.I,
        )
        found: list[tuple[float, str, str]] = []
        for match in pattern.finditer(text):
            raw = parse_number(match.group(2))
            if raw is None:
                continue
            unit = match.group(3).lower()
            value = float(raw) / 1000 if "mwh" in unit else float(raw)
            context = normalize_space(text[max(0, match.start() - 140) : match.end() + 140]).lower()
            found.append((round(value, 8), context, unit))
        spread = generic_unique([item[0] for item in found])
        if spread is None:
            return None, None, index_name, [], None
        matching = next(item for item in found if round(item[0], 8) == round(float(spread), 8))
        if commodity == "luce":
            context = matching[1]
            if re.search(r"comprensiv[oa]\s+(?:delle\s+)?perdite|incluse?\s+(?:le\s+)?perdite", context):
                gross = float(spread)
                spread = round(gross / losses_factor, 8)
                network_convention = "net"
                variable_components.append(detail_component(
                    "Spread CTE comprensivo perdite di rete",
                    gross,
                    "EUR/kWh",
                    f"Normalizzato al netto usando il fattore perdite corrente {losses_factor}.",
                ))
            elif re.search(r"al\s+netto\s+(?:delle\s+)?perdite|perdite\s+(?:di\s+rete\s+)?escluse", context):
                network_convention = "net"
            else:
                return None, None, index_name, [], None
        return None, float(spread), index_name, variable_components, network_convention

    keywords = r"(?:prezzo\s+fisso|prezzo\s+(?:energia|gas)|corrispettivo\s+(?:energia|gas)|componente\s+(?:energia|gas))"
    candidates = generic_money_candidates(text, keywords, commodity, fixed_fee=False)
    normalized_values: list[tuple[float, str]] = []
    for value, label, unit in candidates:
        converted = value / 1000 if "mwh" in unit.lower() else value
        if 0 <= converted <= 5:
            normalized_values.append((round(converted, 8), label))
    fixed = generic_unique([item[0] for item in normalized_values])
    if fixed is None:
        return None, None, None, [], None
    value_text = str(fixed).replace(".", "[.,]")
    price_match = re.search(
        rf"(?:prezzo\s+fisso|prezzo\s+(?:energia|gas)|corrispettivo\s+(?:energia|gas)|componente\s+(?:energia|gas))[^\n.;]{{0,160}}?{value_text}",
        text,
        re.I,
    )
    if commodity == "luce":
        context = normalize_space(text[max(0, (price_match.start() if price_match else 0) - 120) : (price_match.end() if price_match else 0) + 160]).lower()
        if re.search(r"comprensiv[oa]\s+(?:delle\s+)?perdite|incluse?\s+(?:le\s+)?perdite", context):
            network_convention = "included"
        elif re.search(r"al\s+netto\s+(?:delle\s+)?perdite|perdite\s+(?:di\s+rete\s+)?escluse", context):
            fixed = round(float(fixed) * losses_factor, 8)
            network_convention = "included"
            variable_components.append(detail_component(
                "Prezzo fisso CTE al netto delle perdite",
                float(normalized_values[0][0]),
                "EUR/kWh",
                f"Convertito a prezzo comprensivo perdite usando il fattore corrente {losses_factor}.",
            ))
        else:
            return None, None, None, [], None
    return float(fixed), None, None, variable_components, network_convention


def parse_generic_partner(path: Path, partner_key: str, partner_label: str, market_indices: dict[str, float]) -> ParseResult:
    text = extract_pdf_text_multi(path)
    partner_dir = path.parent.parent
    metadata = load_partner_metadata(partner_dir)
    provider_key = str(metadata.get("supplierKey") or partner_key).strip() or partner_key
    provider_label = str(metadata.get("supplierName") or partner_label).strip() or partner_label

    provider_vat = generic_provider_vat(text, provider_label)
    offer_code = generic_offer_code(text)
    offer_name = generic_offer_name(text)
    commodity = generic_commodity(text)
    customer_type = generic_customer_type(text)
    sale_to = generic_date_after_labels(text, (
        r"validit[aà]\s+(?:dell['’]\s*)?offerta(?:\s+fino\s+al)?",
        r"offerta\s+valida\s+fino\s+al",
        r"aderire\s+entro\s+il",
        r"sottoscrizione\s+entro\s+il",
        r"richiesta\s+(?:di\s+attivazione\s+)?(?:sia\s+effettuata\s+)?entro\s+il",
    ))
    sale_from = generic_date_after_labels(text, (
        r"validit[aà]\s+(?:dell['’]\s*)?offerta\s+dal",
        r"offerta\s+valida\s+dal",
    ))

    missing_identity = [
        name for name, value in (
            ("P.IVA venditore", provider_vat),
            ("codice offerta", offer_code),
            ("nome offerta", offer_name),
            ("commodity", commodity),
            ("tipo cliente", customer_type),
            ("scadenza vendita", sale_to),
        ) if not value
    ]
    if missing_identity:
        raise ValueError("normalizzatore generico: dati identificativi non univoci/mancanti: " + ", ".join(missing_identity))

    price_type = generic_price_type(text, str(commodity))
    if not price_type:
        raise ValueError("normalizzatore generico: prezzo fisso/indicizzato non determinabile in modo univoco")
    annual_fixed_fee, fixed_components = generic_annual_fixed_fee(text, str(commodity))
    if annual_fixed_fee is None:
        raise ValueError("normalizzatore generico: quota fissa vendita annua non determinabile in modo univoco")

    losses_factor = float(market_indices.get("electricity_losses") or 1.102)
    fixed_price, spread, index_name, variable_components, loss_convention = generic_price_value(
        text,
        str(commodity),
        price_type,
        losses_factor,
    )
    if price_type == "fisso" and fixed_price is None:
        raise ValueError("normalizzatore generico: prezzo fisso non leggibile o convenzione perdite luce non esplicita")
    if price_type == "variabile" and (spread is None or index_name not in {"PUN", "PSV"}):
        raise ValueError("normalizzatore generico: indice/spread non leggibile o convenzione perdite luce non esplicita")

    index_value = market_indices.get(str(index_name or "").lower()) if index_name else None
    if price_type == "variabile" and not isinstance(index_value, (int, float)):
        raise ValueError(f"normalizzatore generico: indice corrente {index_name} non disponibile")
    projected_price = float(fixed_price) if fixed_price is not None else round(float(index_value) + float(spread), 8)
    source_hash = sha256_file(path)
    now = datetime.now().astimezone().isoformat(timespec="seconds")

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceType": "partner_direct",
        "partner": {
            "partnerKey": str(metadata.get("partnerKey") or partner_key).strip() or partner_key,
            "partnerLabel": provider_label,
        },
        "identity": {
            "canonicalKey": f"{provider_vat}|{commodity}|{offer_code}",
            "providerKey": provider_key,
            "providerLabel": provider_label,
            "providerVat": provider_vat,
            "offerCode": offer_code,
            "offerName": offer_name,
            "commercialFamily": commercial_family(str(offer_name)),
        },
        "classification": {
            "commodity": commodity,
            "customerType": customer_type,
            "priceType": price_type,
        },
        "validity": {
            "saleFrom": sale_from,
            "saleTo": sale_to,
            "conditionsDurationMonths": None,
        },
        "economics": {
            "indexName": index_name,
            "indexValueAtProjection": index_value,
            "fixedPrice": fixed_price,
            "spread": spread,
            "annualFixedFee": annual_fixed_fee,
            "networkLosses": {
                "rankingPriceConvention": loss_convention,
            },
            "variableComponents": variable_components,
            "fixedComponents": fixed_components,
            "cap": {"enabled": False, "value": None, "unit": None, "validForMonths": None, "rule": None},
            "discounts": [],
        },
        "requirements": {
            "sdd": True if re.search(r"\bSDD\b|domiciliazione\s+bancaria", text, re.I) else None,
            "digitalInvoice": True if re.search(r"fattur[ae]\s+(?:digitale|elettronica)|bolletta\s+web", text, re.I) else None,
            "powerConstraints": None,
            "geographicConstraints": None,
            "other": ["Normalizzazione automatica generica: attivata solo con campi economici e identificativi univoci."],
        },
        "activation": {"channel": None, "partnerDirect": True},
        "rankingProjection": {
            "eligible": True,
            "price": projected_price,
            "annualFixedFee": annual_fixed_fee,
            "projectionRule": (
                "prezzo fisso CTE comprensivo perdite" if price_type == "fisso" and commodity == "luce"
                else "prezzo fisso CTE" if price_type == "fisso"
                else "indice corrente + spread netto perdite" if commodity == "luce"
                else "indice corrente + spread"
            ),
            "exclusionReason": None,
        },
        "source": {
            "originalFile": path.name,
            "fileHash": source_hash,
            "normalizedAt": now,
            "parser": GENERIC_PARSER_VERSION,
            "extractionPagesMax": 12,
        },
        "status": "normalizzata",
    }
    return ParseResult(payload=payload, text=text)


def partner_key_from_dir(path: Path) -> str:
    key = re.sub(r"[^a-z0-9]+", "-", path.name.lower()).strip("-")
    return key or "partner"


def parser_for_partner(path: Path, text_hint: str | None = None):
    key = partner_key_from_dir(path)
    if key == "greenius":
        return parse_greenius
    if key in {"lion-green", "liongreen"}:
        return parse_lion_green
    if key == "ovenergy":
        return parse_ovenergy
    if text_hint and "GREENIUS Srl" in text_hint:
        return parse_greenius
    if text_hint and "FAMILY FORCE" in text_hint.upper():
        return parse_lion_green
    if text_hint and "OV ENERGY" in text_hint.upper():
        return parse_ovenergy
    if text_hint:
        return parse_generic_partner
    return None


def load_market_indices(package_root: Path) -> dict[str, float]:
    path = package_root / "data" / "offerte-arera-menu.json"
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    indices = payload.get("indiciUsati") or {}
    result: dict[str, float] = {}
    for key in ("pun", "psv"):
        value = indices.get(key)
        if isinstance(value, (int, float)) and value > 0:
            result[key] = float(value)
    params_path = package_root / "data" / "calcolo-parametri.json"
    if params_path.is_file():
        try:
            params = json.loads(params_path.read_text(encoding="utf-8"))
            losses = (params.get("parametriCalcolo") or {}).get("perditeReteLuceVariabile")
            if not isinstance(losses, (int, float)):
                losses = (params.get("parametri") or {}).get("perditeReteLuceVariabile")
            if not isinstance(losses, (int, float)):
                losses = params.get("perditeReteLuceVariabile")
            if isinstance(losses, (int, float)) and 1 <= float(losses) <= 1.3:
                result["electricity_losses"] = float(losses)
        except Exception:
            pass
    return result


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(body, encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    os.replace(temporary, path)


def archive_json(path: Path, archive_dir: Path, tag: str) -> Path:
    archive_dir.mkdir(parents=True, exist_ok=True)
    archived_at = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S%z")
    stem = path.stem
    candidate = archive_dir / f"{stem}__{tag}__{archived_at}.json"
    suffix = 1
    while candidate.exists():
        candidate = archive_dir / f"{stem}__{tag}__{archived_at}__{suffix}.json"
        suffix += 1
    path.replace(candidate)
    return candidate


def active_payload_equivalent(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """Confronta le condizioni commerciali ignorando metadati e sole proiezioni dinamiche."""
    def compact(payload: dict[str, Any]) -> dict[str, Any]:
        value = copy.deepcopy(payload)
        source = value.get("source")
        if isinstance(source, dict):
            source.pop("normalizedAt", None)
            source.pop("normalizerRevision", None)

        economics = value.get("economics")
        if isinstance(economics, dict):
            economics.pop("indexValueAtProjection", None)

        projection = value.get("rankingProjection")
        if isinstance(projection, dict):
            projection.pop("price", None)
            projection.pop("partialPrice", None)

        return value
    return compact(left) == compact(right)


def promote_normalized_payload(
    partner_dir: Path,
    normalized_path: Path,
    payload: dict[str, Any],
    indices: dict[str, float],
) -> bool:
    """Promuove in 20_ATTIVE solo record che superano la validazione del catalogo attivo."""
    validated = validate_active_record(refresh_ranking_projection(payload, indices), normalized_path)
    code = str((validated.get("identity") or {}).get("offerCode") or "").strip()
    if not code:
        raise ValueError(f"codice offerta assente in {normalized_path.name}")

    active_dir = partner_dir / "20_ATTIVE"
    archive_dir = partner_dir / "90_ARCHIVIO"
    active_dir.mkdir(parents=True, exist_ok=True)
    target = active_dir / f"{code}.json"

    if target.exists():
        existing = json.loads(target.read_text(encoding="utf-8"))
        if active_payload_equivalent(existing, payload):
            return False
        archived = archive_json(target, archive_dir, "attiva")
        log(f"Versione attiva precedente archiviata: {archived.name}")

    write_json_atomic(target, payload)
    return True


def ensure_partner_structure(partner_dir: Path) -> None:
    for name in ("00_DA_VALIDARE", "10_NORMALIZZATE", "20_ATTIVE", "90_ARCHIVIO"):
        (partner_dir / name).mkdir(parents=True, exist_ok=True)


def normalize_partner_folder(partner_dir: Path, package_root: Path, indices: dict[str, float]) -> tuple[int, int, int]:
    ensure_partner_structure(partner_dir)
    source_dir = partner_dir / "00_DA_VALIDARE"
    normalized_dir = partner_dir / "10_NORMALIZZATE"
    archive_dir = partner_dir / "90_ARCHIVIO"

    partner_key = partner_key_from_dir(partner_dir)
    partner_label = partner_dir.name
    revision = normalizer_revision()
    ok = 0
    errors = 0
    promoted = 0
    seen_codes: dict[str, str] = {}
    existing_by_cache: dict[tuple[str, str], Path] = {}
    existing_by_source_name: dict[str, Path] = {}

    for existing_path in normalized_dir.glob("*.json"):
        try:
            existing_payload = json.loads(existing_path.read_text(encoding="utf-8"))
            source = existing_payload.get("source") or {}
            existing_hash = str(source.get("fileHash") or "")
            existing_revision = str(source.get("normalizerRevision") or "")
            original_file = str(source.get("originalFile") or "")
            if existing_hash and existing_revision:
                existing_by_cache[(existing_hash, existing_revision)] = existing_path
            if original_file:
                existing_by_source_name[original_file] = existing_path
        except Exception:
            continue

    for pdf_path in sorted(source_dir.glob("*.pdf")):
        try:
            digest_now = sha256_file(pdf_path)
            cached_path = existing_by_cache.get((digest_now, revision))
            if cached_path is not None and cached_path.exists():
                cached_payload = json.loads(cached_path.read_text(encoding="utf-8"))
                if promote_normalized_payload(partner_dir, cached_path, cached_payload, indices):
                    promoted += 1
                ok += 1
                continue

            parser = parser_for_partner(partner_dir)
            if parser is None:
                text_hint = extract_pdf_text(pdf_path)
                parser = parser_for_partner(partner_dir, text_hint=text_hint)
            if parser is None:
                raise ValueError(f"nessun parser disponibile per il partner {partner_label}")

            result = parser(pdf_path, partner_key, partner_label, indices)
            source = result.payload.setdefault("source", {})
            source["normalizerRevision"] = revision
            code = str(result.payload["identity"]["offerCode"])
            digest = str(source["fileHash"])
            if code in seen_codes and seen_codes[code] != digest:
                raise ValueError(f"codice offerta duplicato con contenuti differenti: {code}")
            seen_codes[code] = digest
            target = normalized_dir / f"{code}.json"

            # Se lo stesso PDF (stesso nome file) ora produce un codice diverso,
            # la vecchia normalizzazione e la relativa attiva vengono archiviate.
            previous_for_source = existing_by_source_name.get(pdf_path.name)
            replaced_offer_code: str | None = None
            if previous_for_source is not None and previous_for_source.exists() and previous_for_source != target:
                try:
                    previous_payload = json.loads(previous_for_source.read_text(encoding="utf-8"))
                    replaced_offer_code = str((previous_payload.get("identity") or {}).get("offerCode") or previous_for_source.stem)
                except Exception:
                    replaced_offer_code = previous_for_source.stem
                archived = archive_json(previous_for_source, archive_dir, "normalizzata-sostituita")
                log(f"Versione normalizzata sostituita archiviata: {archived.name}")

            if target.exists():
                existing = json.loads(target.read_text(encoding="utf-8"))
                existing_source = existing.get("source") or {}
                existing_hash = str(existing_source.get("fileHash") or "")
                if not replaced_offer_code:
                    carried_replacement = str(existing_source.get("replacesOfferCode") or "").strip()
                    if carried_replacement and carried_replacement != code:
                        replaced_offer_code = carried_replacement
                if existing_hash == digest:
                    source["normalizedAt"] = existing_source.get("normalizedAt") or source.get("normalizedAt")
                else:
                    archived = archive_json(target, archive_dir, "normalizzata")
                    log(f"Versione normalizzata precedente archiviata: {archived.name}")

            if replaced_offer_code and replaced_offer_code != code:
                source["replacesOfferCode"] = replaced_offer_code
            else:
                source.pop("replacesOfferCode", None)

            write_json_atomic(target, result.payload)
            existing_by_cache[(digest, revision)] = target
            existing_by_source_name[pdf_path.name] = target

            if promote_normalized_payload(partner_dir, target, result.payload, indices):
                promoted += 1
            if replaced_offer_code and replaced_offer_code != code:
                previous_active = partner_dir / "20_ATTIVE" / f"{replaced_offer_code}.json"
                if previous_active.exists():
                    archived_active = archive_json(previous_active, archive_dir, "attiva-sostituita")
                    log(f"Versione attiva sostituita archiviata: {archived_active.name}")
            ok += 1
        except Exception as exc:
            errors += 1
            log(f"ERRORE normalizzazione {pdf_path.name}: {exc}")
    return ok, errors, promoted


def refresh_ranking_projection(payload: dict[str, Any], market_indices: dict[str, float]) -> dict[str, Any]:
    refreshed = copy.deepcopy(payload)
    classification = refreshed.get("classification") or {}
    economics = refreshed.get("economics") or {}
    projection = refreshed.get("rankingProjection") or {}
    price_type = str(classification.get("priceType") or "")
    commodity = str(classification.get("commodity") or "")

    annual_fixed_fee = economics.get("annualFixedFee")
    if not isinstance(annual_fixed_fee, (int, float)):
        raise ValueError("quota fissa normalizzata assente o non numerica")

    if projection.get("eligible") is False or economics.get("economicCompleteness") == "partial":
        index_name = str(economics.get("indexName") or "").upper()
        known_partial_variable_adder = economics.get("knownPartialVariableAdder")
        index_value = market_indices.get(index_name.lower())
        if index_name not in {"PUN", "PSV"} or not isinstance(index_value, (int, float)):
            raise ValueError("indice non disponibile per la proiezione parziale corrente")
        partial_price = (
            round(float(index_value) + float(known_partial_variable_adder), 8)
            if isinstance(known_partial_variable_adder, (int, float))
            else None
        )
        economics["indexValueAtProjection"] = float(index_value)
        projection.update({
            "eligible": False,
            "price": None,
            "partialPrice": partial_price,
            "annualFixedFee": round(float(annual_fixed_fee), 8),
            "projectionRule": "indice corrente + sole componenti note (parziale)" if partial_price is not None else "componenti note separate; totale parziale non aggregato",
            "exclusionReason": projection.get("exclusionReason") or "Condizioni economiche incomplete: record escluso dal ranking.",
        })
        refreshed["economics"] = economics
        refreshed["rankingProjection"] = projection
        return refreshed

    if price_type == "fisso":
        fixed_price = economics.get("fixedPrice")
        if not isinstance(fixed_price, (int, float)):
            raise ValueError("prezzo fisso normalizzato assente o non numerico")
        current_price = float(fixed_price)
        rule = "prezzo fisso CTE comprensivo perdite" if commodity == "luce" else "prezzo fisso CTE"
    elif price_type == "variabile":
        index_name = str(economics.get("indexName") or "").upper()
        spread = economics.get("spread")
        index_value = market_indices.get(index_name.lower())
        if index_name not in {"PUN", "PSV"} or not isinstance(spread, (int, float)) or not isinstance(index_value, (int, float)):
            raise ValueError("indice o spread normalizzato non disponibile per la proiezione corrente")
        current_price = round(float(index_value) + float(spread), 8)
        cap = economics.get("cap") or {}
        cap_value = cap.get("value") if cap.get("enabled") is True else None
        if isinstance(cap_value, (int, float)):
            current_price = min(current_price, float(cap_value))
        if commodity == "luce":
            rule = "min(indice corrente + spread netto perdite, CAP)" if isinstance(cap_value, (int, float)) else "indice corrente + spread netto perdite"
        else:
            rule = "min(indice corrente + spread, CAP)" if isinstance(cap_value, (int, float)) else "indice corrente + spread"
        economics["indexValueAtProjection"] = float(index_value)
    else:
        raise ValueError("tipo prezzo normalizzato non supportato")

    projection.update({
        "eligible": True,
        "price": round(float(current_price), 8),
        "annualFixedFee": round(float(annual_fixed_fee), 8),
        "projectionRule": rule,
        "exclusionReason": None,
    })
    refreshed["economics"] = economics
    refreshed["rankingProjection"] = projection
    return refreshed


def validate_active_record(payload: dict[str, Any], source_path: Path) -> dict[str, Any]:
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"schemaVersion non supportata in {source_path.name}")
    if payload.get("sourceType") != "partner_direct":
        raise ValueError(f"sourceType non valida in {source_path.name}")
    partner = payload.get("partner") or {}
    identity = payload.get("identity") or {}
    classification = payload.get("classification") or {}
    validity = payload.get("validity") or {}
    projection = payload.get("rankingProjection") or {}
    required = {
        "partnerKey": partner.get("partnerKey"),
        "canonicalKey": identity.get("canonicalKey"),
        "providerKey": identity.get("providerKey"),
        "providerVat": identity.get("providerVat"),
        "offerCode": identity.get("offerCode"),
        "offerName": identity.get("offerName"),
        "commodity": classification.get("commodity"),
        "customerType": classification.get("customerType"),
        "priceType": classification.get("priceType"),
        "saleTo": validity.get("saleTo"),
        "annualFixedFee": projection.get("annualFixedFee"),
    }
    missing = [key for key, value in required.items() if value in (None, "")]
    if missing:
        raise ValueError(f"campi obbligatori mancanti in {source_path.name}: {', '.join(missing)}")
    if classification.get("commodity") not in {"luce", "gas"}:
        raise ValueError(f"commodity non valida in {source_path.name}")
    if classification.get("customerType") not in {"domestico", "business"}:
        raise ValueError(f"customerType non valido in {source_path.name}")
    if classification.get("priceType") not in {"fisso", "variabile"}:
        raise ValueError(f"priceType non valido in {source_path.name}")
    canonical_expected = f"{identity.get('providerVat')}|{classification.get('commodity')}|{identity.get('offerCode')}"
    if str(identity.get("canonicalKey") or "").lower() != canonical_expected.lower():
        raise ValueError(f"canonicalKey incoerente in {source_path.name}")
    date.fromisoformat(str(validity.get("saleTo")))
    eligible = projection.get("eligible") is True
    if eligible:
        price = projection.get("price")
        if not isinstance(price, (int, float)):
            raise ValueError(f"prezzo completo non numerico in {source_path.name}")
        if float(price) < 0 or float(projection.get("annualFixedFee")) < 0:
            raise ValueError(f"valori economici negativi in {source_path.name}")
        return payload

    economics = payload.get("economics") or {}
    partial_price = projection.get("partialPrice")
    unpriced = economics.get("unpricedComponents")
    known_components = economics.get("variableComponents") or []
    if economics.get("economicCompleteness") != "partial":
        raise ValueError(f"offerta non eligible senza stato economico parziale in {source_path.name}")
    if partial_price is not None and (not isinstance(partial_price, (int, float)) or float(partial_price) < 0):
        raise ValueError(f"prezzo parziale non valido in {source_path.name}")
    if not any(isinstance(item, dict) and isinstance(item.get("value"), (int, float)) for item in known_components):
        raise ValueError(f"componenti economiche note mancanti in {source_path.name}")
    if not isinstance(unpriced, list) or not [item for item in unpriced if str(item).strip()]:
        raise ValueError(f"componenti non valorizzate mancanti in {source_path.name}")
    if projection.get("price") is not None:
        raise ValueError(f"offerta parziale con prezzo completo valorizzato in {source_path.name}")
    if float(projection.get("annualFixedFee")) < 0:
        raise ValueError(f"quota fissa negativa in {source_path.name}")
    return payload


def active_economic_signature(payload: dict[str, Any]) -> str:
    identity = payload.get("identity") or {}
    classification = payload.get("classification") or {}
    validity = payload.get("validity") or {}
    economics = payload.get("economics") or {}
    projection = payload.get("rankingProjection") or {}
    relevant = {
        "providerVat": identity.get("providerVat"),
        "offerCode": identity.get("offerCode"),
        "commercialFamily": identity.get("commercialFamily"),
        "classification": classification,
        "validity": validity,
        "economics": {
            "indexName": economics.get("indexName"),
            "fixedPrice": economics.get("fixedPrice"),
            "spread": economics.get("spread"),
            "annualFixedFee": economics.get("annualFixedFee"),
            "economicCompleteness": economics.get("economicCompleteness"),
            "knownPartialVariableAdder": economics.get("knownPartialVariableAdder"),
            "unpricedComponents": economics.get("unpricedComponents"),
            "networkLosses": economics.get("networkLosses"),
            "variableComponents": economics.get("variableComponents"),
            "fixedComponents": economics.get("fixedComponents"),
            "cap": economics.get("cap"),
            "discounts": economics.get("discounts"),
        },
        "rankingProjection": {
            "eligible": projection.get("eligible"),
            "price": projection.get("price"),
            "partialPrice": projection.get("partialPrice"),
            "annualFixedFee": projection.get("annualFixedFee"),
            "projectionRule": projection.get("projectionRule"),
            "exclusionReason": projection.get("exclusionReason"),
        },
    }
    return json.dumps(relevant, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def project_active_record(payload: dict[str, Any], market_indices: dict[str, float]) -> dict[str, Any]:
    projected = json.loads(json.dumps(payload))
    classification = projected.get("classification") or {}
    economics = projected.get("economics") or {}
    ranking = projected.get("rankingProjection") or {}
    price_type = classification.get("priceType")
    if price_type == "fisso":
        fixed = economics.get("fixedPrice")
        if isinstance(fixed, (int, float)) and fixed >= 0:
            ranking["price"] = round(float(fixed), 8)
    elif price_type == "variabile":
        index_name = str(economics.get("indexName") or "").lower()
        index_value = market_indices.get(index_name)
        spread = economics.get("spread")
        if not isinstance(index_value, (int, float)) or not isinstance(spread, (int, float)):
            raise ValueError(f"indice/spread non disponibili per {projected.get('identity', {}).get('offerCode', 'offerta')} ")
        price = float(index_value) + float(spread)
        cap = economics.get("cap") or {}
        if cap.get("enabled") and isinstance(cap.get("value"), (int, float)):
            price = min(price, float(cap["value"]))
        ranking["price"] = round(price, 8)
        economics["indexValueAtProjection"] = round(float(index_value), 8)
    projected["economics"] = economics
    projected["rankingProjection"] = ranking
    return projected


def arera_like_row(payload: dict[str, Any]) -> dict[str, Any]:
    identity = payload["identity"]
    classification = payload["classification"]
    validity = payload["validity"]
    projection = payload["rankingProjection"]
    partner = payload.get("partner") or {}
    economics = payload.get("economics") or {}
    available_partners = payload.get("_availablePartners") if isinstance(payload.get("_availablePartners"), list) else []
    if not available_partners:
        available_partners = [partner]
    normalized_partners: list[dict[str, str]] = []
    seen_partner_keys: set[str] = set()
    for item in available_partners:
        if not isinstance(item, dict):
            continue
        key = str(item.get("partnerKey") or "").strip()
        if not key or key in seen_partner_keys:
            continue
        seen_partner_keys.add(key)
        normalized_partners.append({
            "partnerKey": key,
            "partnerLabel": str(item.get("partnerLabel") or key).strip(),
        })
    normalized_partners.sort(key=lambda item: item["partnerKey"])
    partner_keys = [item["partnerKey"] for item in normalized_partners]
    primary_partner_key = str(partner.get("partnerKey") or "").strip() or (partner_keys[0] if partner_keys else "")
    partner_labels = [item["partnerLabel"] for item in normalized_partners]
    return {
        "providerKey": identity["providerKey"],
        "providerLabel": identity.get("providerLabel") or identity["providerKey"],
        "fornitore": identity.get("providerLabel") or identity["providerKey"],
        "commodity": classification["commodity"],
        "tipo": classification["priceType"],
        "nome": identity["offerName"],
        "codice": identity["offerCode"],
        "pivaVenditore": identity["providerVat"],
        "dataInizio": validity.get("saleFrom") or "",
        "dataFine": validity["saleTo"],
        "customerType": classification["customerType"],
        "tipoClienteCodice": "PARTNER_DIRECT",
        "tipoOffertaCodice": "PARTNER_DIRECT",
        "durataMesi": validity.get("conditionsDurationMonths"),
        "indiceRiferimento": str(economics.get("indexName") or "").lower(),
        "prezzo": float(projection["price"]),
        "quotaFissaAnnua": float(projection["annualFixedFee"]),
        "url": "#",
        "fonte": f"CTE partner diretta {' / '.join(partner_labels) or primary_partner_key}".strip(),
        "score": 900,
        "qualitaPrezzo": "partner_cte_validata",
        "provenienzaPrezzo": {
            "sourceType": "partner_direct",
            "partnerKey": primary_partner_key,
            "partnerKeys": partner_keys,
            "projectionRule": projection.get("projectionRule"),
            "sourceDocument": payload.get("source", {}).get("originalFile"),
        },
        "provenienzaQuotaFissa": {
            "sourceType": "partner_direct",
            "partnerKey": primary_partner_key,
            "partnerKeys": partner_keys,
            "sourceDocument": payload.get("source", {}).get("originalFile"),
        },
        # I bonus condizionati restano documentati nei dettagli tecnici. Non vengono
        # esposti come sconti di ranking finche il motore non puo verificarne la condizione.
        "sconti": [],
        "dettagliTecnici": {
            "sourceType": "partner_direct",
            "partnerKey": primary_partner_key,
            "partnerKeys": partner_keys,
            "partners": normalized_partners,
            "commercialFamily": identity.get("commercialFamily") or "",
            "canonicalKey": identity.get("canonicalKey") or "",
            "sourceFile": payload.get("source", {}).get("originalFile"),
            "sourceHash": payload.get("source", {}).get("fileHash"),
            "economics": economics,
            "requirements": payload.get("requirements") or {},
        },
        "sourceType": "partner_direct",
        "partnerKey": primary_partner_key,
        "partnerKeys": partner_keys,
        "commercialFamily": identity.get("commercialFamily") or "",
        "canonicalKey": identity.get("canonicalKey") or "",
    }


def partial_catalog_row(payload: dict[str, Any]) -> dict[str, Any]:
    identity = payload["identity"]
    classification = payload["classification"]
    validity = payload["validity"]
    projection = payload["rankingProjection"]
    economics = payload.get("economics") or {}
    partner = payload.get("partner") or {}
    available_partners = payload.get("_availablePartners") if isinstance(payload.get("_availablePartners"), list) else []
    if not available_partners:
        available_partners = [partner]
    normalized_partners: list[dict[str, str]] = []
    seen_partner_keys: set[str] = set()
    for item in available_partners:
        if not isinstance(item, dict):
            continue
        key = str(item.get("partnerKey") or "").strip()
        if not key or key in seen_partner_keys:
            continue
        seen_partner_keys.add(key)
        normalized_partners.append({
            "partnerKey": key,
            "partnerLabel": str(item.get("partnerLabel") or key).strip(),
        })
    normalized_partners.sort(key=lambda item: item["partnerKey"])
    partner_keys = [item["partnerKey"] for item in normalized_partners]
    primary_partner_key = str(partner.get("partnerKey") or "").strip() or (partner_keys[0] if partner_keys else "")
    return {
        "providerKey": identity["providerKey"],
        "providerLabel": identity.get("providerLabel") or identity["providerKey"],
        "fornitore": identity.get("providerLabel") or identity["providerKey"],
        "commodity": classification["commodity"],
        "tipo": classification["priceType"],
        "nome": identity["offerName"],
        "codice": identity["offerCode"],
        "codiciAlternativi": identity.get("alternativeOfferCodes") or [],
        "pivaVenditore": identity["providerVat"],
        "dataInizio": validity.get("saleFrom") or "",
        "dataFine": validity["saleTo"],
        "customerType": classification["customerType"],
        "eligible": False,
        "economicCompleteness": "partial",
        "prezzo": None,
        "prezzoParziale": float(projection["partialPrice"]) if isinstance(projection.get("partialPrice"), (int, float)) else None,
        "quotaFissaAnnua": float(projection["annualFixedFee"]),
        "indiceRiferimento": str(economics.get("indexName") or "").lower(),
        "maggiorazioneVariabileNota": float(economics["knownPartialVariableAdder"]) if isinstance(economics.get("knownPartialVariableAdder"), (int, float)) else None,
        "componentiNonValorizzate": list(economics.get("unpricedComponents") or []),
        "componentiVariabiliNote": list(economics.get("variableComponents") or []),
        "componentiFisseNote": list(economics.get("fixedComponents") or []),
        "projectionRule": projection.get("projectionRule"),
        "exclusionReason": projection.get("exclusionReason"),
        "sourceType": "partner_direct",
        "partnerKey": primary_partner_key,
        "partnerKeys": partner_keys,
        "partners": normalized_partners,
        "commercialFamily": identity.get("commercialFamily") or "",
        "canonicalKey": identity.get("canonicalKey") or "",
        "sourceFile": payload.get("source", {}).get("originalFile"),
        "sourceHash": payload.get("source", {}).get("fileHash"),
    }


def build_active_catalog(partner_root: Path, package_root: Path) -> dict[str, Any]:
    today = date.today()
    market_indices = load_market_indices(package_root)
    private_rows: list[dict[str, Any]] = []
    business_rows: list[dict[str, Any]] = []
    partial_rows: list[dict[str, Any]] = []
    active_by_key: dict[str, dict[str, Any]] = {}
    source_files = 0
    expired = 0

    if partner_root.is_dir():
        for partner_dir in sorted(p for p in partner_root.iterdir() if p.is_dir()):
            active_dir = partner_dir / "20_ATTIVE"
            if not active_dir.is_dir():
                continue
            for path in sorted(active_dir.glob("*.json")):
                raw_payload = json.loads(path.read_text(encoding="utf-8"))
                payload = refresh_ranking_projection(raw_payload, market_indices)
                payload = validate_active_record(payload, path)
                source_files += 1
                valid_to = date.fromisoformat(str(payload["validity"]["saleTo"]))
                if valid_to < today:
                    expired += 1
                    continue

                key = str(payload["identity"]["canonicalKey"])
                signature = active_economic_signature(payload)
                existing = active_by_key.get(key)
                if existing is None:
                    active_by_key[key] = {
                        "payload": payload,
                        "signature": signature,
                        "partners": [payload.get("partner") or {}],
                    }
                    continue
                if existing["signature"] != signature:
                    raise ValueError(f"canonicalKey duplicata con condizioni economiche differenti in 20_ATTIVE: {key}")
                existing["partners"].append(payload.get("partner") or {})

    for item in active_by_key.values():
        payload = copy.deepcopy(item["payload"])
        payload["_availablePartners"] = item["partners"]
        if payload.get("rankingProjection", {}).get("eligible") is False:
            partial_rows.append(partial_catalog_row(payload))
            continue
        row = arera_like_row(payload)
        if payload["classification"]["customerType"] == "business":
            business_rows.append(row)
        else:
            private_rows.append(row)

    private_rows.sort(key=lambda row: (row["providerKey"], row["commodity"], row["tipo"], row["codice"]))
    business_rows.sort(key=lambda row: (row["providerKey"], row["commodity"], row["tipo"], row["codice"]))
    partial_rows.sort(key=lambda row: (row["providerKey"], row["customerType"], row["commodity"], row["tipo"], row["codice"]))
    updated = today.isoformat()
    return {
        "versioneDati": f"partner-menu-{updated}-v{PARTNER_CATALOG_VERSION}",
        "schemaVersion": PARTNER_CATALOG_VERSION,
        "fonte": "Offerte partner dirette validate nelle cartelle 20_ATTIVE; le offerte con condizioni economiche incomplete sono pubblicate separatamente e restano escluse dal ranking.",
        "aggiornatoIl": updated,
        "offerte": private_rows,
        "offerteBusiness": business_rows,
        "offerteParziali": partial_rows,
        "statistiche": {
            "fileAttiviLetti": source_files,
            "offertePrivateAttive": len(private_rows),
            "offerteBusinessAttive": len(business_rows),
            "offerteParzialiAttive": len(partial_rows),
            "offerteScaduteEscluse": expired,
        },
    }


def publish_active_catalog(partner_root: Path, package_root: Path) -> dict[str, Any] | None:
    payload = build_active_catalog(partner_root, package_root)
    data_target = package_root / "data" / "offerte-partner.json"
    public_target = package_root / "public" / "data" / "offerte-partner.json"
    source_files = int((payload.get("statistiche") or {}).get("fileAttiviLetti") or 0)
    if source_files == 0 and not data_target.exists() and not public_target.exists():
        log("Nessuna offerta in 20_ATTIVE e nessun catalogo partner precedente: pubblicazione iniziale non necessaria.")
        return None
    write_json_atomic(data_target, payload)
    write_json_atomic(public_target, payload)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalizza e pubblica le offerte partner dirette OffertaLogica.")
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--partner-root", type=Path, default=Path(os.environ.get("OFFERTALOGICA_PARTNER_ROOT", DEFAULT_PARTNER_ROOT)))
    parser.add_argument("--normalize-only", action="store_true")
    parser.add_argument("--publish-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    package_root = args.package_root.resolve()
    partner_root = args.partner_root.expanduser().resolve()
    indices = load_market_indices(package_root)

    log(f"Radice partner: {partner_root}")
    if not partner_root.exists():
        log("Radice partner non trovata: nessuna normalizzazione e nessuna modifica al catalogo partner esistente.")
        return 0

    if not args.publish_only and partner_root.is_dir():
        normalized_total = 0
        errors_total = 0
        for partner_dir in sorted(p for p in partner_root.iterdir() if p.is_dir()):
            ok, errors, promoted = normalize_partner_folder(partner_dir, package_root, indices)
            normalized_total += ok
            errors_total += errors
            if ok or errors:
                log(f"{partner_dir.name}: {ok} normalizzate, {promoted} promosse/aggiornate in 20_ATTIVE, {errors} errori.")
        if errors_total:
            log("Normalizzazione completata con errori: le CTE non valide non vengono promosse; le versioni attive valide restano intatte.")
        else:
            log(f"Normalizzazione completata: {normalized_total} CTE elaborate.")

    if not args.normalize_only:
        payload = publish_active_catalog(partner_root, package_root)
        if payload is not None:
            stats = payload["statistiche"]
            log(
                "Catalogo attivo pubblicato localmente: "
                f"{stats['offertePrivateAttive']} private, {stats['offerteBusinessAttive']} business, "
                f"{stats['offerteParzialiAttive']} parziali fuori ranking, "
                f"{stats['offerteScaduteEscluse']} scadute escluse."
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
