#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import html
import json
import os
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
CATALOG_SCHEMA_VERSION = 93
REFERENCE_CONSUMPTION = {"luce": 2700, "gas": 700}
PRICE_CHANGE_TOLERANCE = 0.02
FEE_CHANGE_TOLERANCE = 24.0
MINIMUM_VALID_ROWS = {"luce": 10, "gas": 10}
OFFER_CODE_PATTERN = re.compile(r"^[A-Z0-9]{20,40}$", re.I)
BLOCKED_PRICE_QUALITIES = {
    "media_fasce",
    "media_fasce_pun_fallback",
    "media_fasce_psv_fallback",
    "somma_componenti",
    "puntuale_pun_fallback",
    "puntuale_psv_fallback",
}
ALLOWED_PRICE_QUALITIES = {
    "prezzo_esplicito",
    "verificato_specifica_commerciale",
}
PRIMARY_PRICE_PATTERNS = (
    r"^prezzo(?:\s+prezzo)?$",
    r"\bcosto\s+per\s+consumi\b",
    r"\bprezzo\s+(?:luce|energia|gas)\b",
    r"\bprezzo\s+(?:fisso\s+(?:energia|gas)|quota\s+(?:energia|gas))\b",
    r"\bprezzo\s+componente\s+(?:energia\s+elettricita|materia\s+prima\s+gas)\b",
    r"\bprezzo\s+(?:della\s+)?materia(?:\s+prima)?\b",
    r"\bcomponente\s+(?:energia|gas)\b",
    r"\bcomponente\s+sostitutiva\s+materia\s+prima\s+gas\b",
    r"\bcorrispettivo\s+per\s+il\s+consumo\b",
    r"\bcorrispettivo\s+(?:luce|energia|gas)\b",
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
PARTNER_ALLOWED_FIELDS = {
    "routeId",
    "providerKey",
    "providerLabel",
    "logo",
    "url",
    "destinationType",
    "destinationStatus",
    "editorialText",
    "priority",
    "namePatterns",
}
PARTNER_FORBIDDEN_FIELD_PARTS = (
    "prezzo",
    "price",
    "quota",
    "codice",
    "code",
    "durata",
    "spread",
    "formula",
    "indice",
    "tipoofferta",
    "tipoprezzo",
)
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
    ProviderRule("axpo", "Axpo Energia", (r"\baxpo\b", r"axpo"), ("01141160992",)),
    ProviderRule("dolomiti", "Dolomiti Energia", (r"\bdolomiti\b",)),
    ProviderRule("eco", "E.CO Energia Corrente", (r"\be\.?\s*co\b", r"energia corrente")),
    ProviderRule("eon", "E.ON", (r"\be\.?\s*on\b",), ("03429130234",)),
    ProviderRule("edison", "Edison", (r"\bedison\b",)),
    ProviderRule("eni", "Eni Plenitude", (r"\bplenitude\b", r"\beni\b")),
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


def offer_index_name(offer: ET.Element, commodity: str) -> str | None:
    context = normalize_text(
        " ".join(
            [
                node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA"),
                node_text(offer, "po:DettaglioOfferta/po:DESCRIZIONE"),
                node_text(offer, "po:RiferimentiPrezzoEnergia/po:IDX_PREZZO_ENERGIA"),
            ]
        )
    )
    if "psbil" in context or "prezzo sbilanciamento" in context:
        return "PSBIL"
    if "psv day ahead" in context or "psv da" in context:
        return "PSV day ahead"
    if "psv" in context:
        return "PSV"
    if "pun index gme" in context:
        return "PUN Index GME"
    if re.search(r"\bpun\b", context):
        return "PUN"
    return None if commodity in {"luce", "gas"} else None


def band_prices(values: list[dict[str, object]]) -> dict[str, float]:
    result: dict[str, float] = {}
    for item in values:
        if item.get("ruolo") != "prezzo_principale_candidato":
            continue
        band = str(item.get("fascia") or "00")
        value = parse_float(str(item.get("valore", "")))
        if value is not None:
            result[band] = round(value, 8)
    return result


def spread_from_provenance(provenance: dict[str, object] | None) -> float | None:
    if not provenance or provenance.get("ruolo") != "spread_corrente_selezionato":
        return None
    return parse_float(str(provenance.get("valore", "")))


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
            elif matches_any(context, PRIMARY_PRICE_PATTERNS):
                role = "prezzo_principale_candidato"
            elif tipo == "variabile" and matches_any(context, SPREAD_PATTERNS):
                role = "spread_corrente_candidato"
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
        if item["ruolo"] != "quota_fissa_candidata" or item["unitaMisuraCodice"] not in {"01", "02"}:
            continue
        by_component.setdefault(int(item["componenteIndice"]), []).append(item)

    total = 0.0
    for component_values in by_component.values():
        unique: dict[float, dict[str, object]] = {}
        for item in component_values:
            annual_value = float(item["valore"]) * (12 if item["unitaMisuraCodice"] == "02" else 1)
            normalized = copy.deepcopy(item)
            normalized["valoreOriginale"] = item["valore"]
            normalized["unitaMisuraOriginale"] = item["unitaMisura"]
            normalized["valore"] = round(annual_value, 8)
            normalized["unitaMisura"] = "€/anno"
            normalized["conversione"] = "€/mese x 12" if item["unitaMisuraCodice"] == "02" else "nessuna"
            unique[round(annual_value, 8)] = normalized
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
    values: list[dict[str, object]], commodity: str, tipo: str
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
                provenance["ruolo"] = "spread_corrente_selezionato"
                return None, "", provenance, "indice_corrente_non_presente_nel_catalogo_arera"
        return selected_value, "prezzo_esplicito", provenance, ""

    if not unique_primary and tipo == "variabile":
        spreads = [item for item in values if item["ruolo"] == "spread_corrente_candidato"]
        unique_spreads = sorted({round(float(item["valore"]), 8) for item in spreads})
        if len(unique_spreads) == 1:
            spread = unique_spreads[0]
            selected = next(item for item in spreads if round(float(item["valore"]), 8) == spread)
            provenance = copy.deepcopy(selected)
            provenance["ruolo"] = "spread_corrente_selezionato"
            return None, "", provenance, "indice_corrente_non_presente_nel_catalogo_arera"

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


def load_partner_metadata(root: Path) -> tuple[str, list[dict[str, object]]]:
    path = root / "data" / "partner-metadata.json"
    if not path.exists():
        return "", []
    payload = json.loads(path.read_text(encoding="utf-8"))
    routes = payload.get("routes", [])
    if not isinstance(routes, list):
        raise ValueError(f"Formato metadati partner non valido: {path}")
    clean: list[dict[str, object]] = []
    for index, route in enumerate(routes):
        if not isinstance(route, dict):
            raise ValueError(f"Metadato partner #{index + 1} non valido")
        unknown = set(route) - PARTNER_ALLOWED_FIELDS
        if unknown:
            raise ValueError(f"Campi partner non ammessi in {route.get('routeId')}: {sorted(unknown)}")
        for field in route:
            compact = re.sub(r"[^a-z]", "", field.lower())
            if any(part in compact for part in PARTNER_FORBIDDEN_FIELD_PARTS):
                raise ValueError(f"Campo economico non ammesso nei metadati partner: {field}")
        if not route.get("routeId") or not route.get("providerKey") or not route.get("url"):
            raise ValueError(f"Metadato partner incompleto: {route}")
        patterns = route.get("namePatterns", [])
        if not isinstance(patterns, list) or not patterns:
            raise ValueError(f"namePatterns mancante per {route.get('routeId')}")
        clean.append(copy.deepcopy(route))
    return str(payload.get("versione") or ""), clean


def partner_for_row(row: dict[str, object], routes: list[dict[str, object]]) -> dict[str, object] | None:
    name = str(row.get("nome") or "")
    matches = []
    for route in routes:
        if route.get("providerKey") != row.get("providerKey"):
            continue
        patterns = route.get("namePatterns") or []
        if not any(re.search(str(pattern), name, re.I) for pattern in patterns):
            continue
        matches.append(route)
    if not matches:
        return None
    route = sorted(matches, key=lambda item: int(item.get("priority") or 0), reverse=True)[0]
    return {
        "routeId": route.get("routeId"),
        "providerKey": route.get("providerKey"),
        "providerLabel": route.get("providerLabel") or row.get("providerLabel"),
        "logo": route.get("logo") or "",
        "url": route.get("url"),
        "destinationType": route.get("destinationType") or "affiliazione",
        "destinationStatus": route.get("destinationStatus") or "attiva",
        "editorialText": route.get("editorialText") or "",
        "priority": int(route.get("priority") or 0),
    }


def enrich_partner_metadata(
    payload: dict[str, object], root: Path
) -> tuple[dict[str, object], dict[str, int]]:
    version, routes = load_partner_metadata(root)
    enriched = copy.deepcopy(payload)
    matched = 0
    for field in ("offerte", "offerteBusiness"):
        rows = enriched.get(field, [])
        if not isinstance(rows, list):
            continue
        for row in rows:
            partner = partner_for_row(row, routes)
            if partner:
                row["partner"] = partner
                matched += 1
            else:
                row.pop("partner", None)
    enriched["partnerMetadataVersion"] = version
    return enriched, {"routeConfigurate": len(routes), "righePartnerAbbinate": matched}


def apply_verified_override(
    override: dict[str, object] | None,
    *,
    code: str,
    name: str,
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
        "nomeOfferta": name,
        "commodity": commodity,
        "customerType": customer_type,
        "tipo": tipo,
        "durataMesi": duration,
        "dataInizio": data_inizio,
        "dataFine": data_fine,
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
        start_date = parse_portale_date(data_inizio)
        end_date = parse_portale_date(data_fine)
        code = node_text(offer, "po:IdentificativiOfferta/po:COD_OFFERTA")
        provider_key, provider_label = match
        nome = node_text(offer, "po:DettaglioOfferta/po:NOME_OFFERTA")
        if not start_date or not end_date:
            diagnostics.append(
                {
                    "codiceOfferta": code,
                    "fornitore": provider_label,
                    "nome": nome,
                    "commodity": commodity,
                    "campoProblematico": "validita",
                    "valoriCandidati": [data_inizio, data_fine],
                    "unita": "data",
                    "testoSorgente": f"DATA_INIZIO={data_inizio or 'assente'}; DATA_FINE={data_fine or 'assente'}",
                    "stato": "scartato",
                    "motivo": "validita_mancante_o_non_valida",
                    "sorgente": source_label_for(path),
                }
            )
            continue
        if start_date.date() > as_of.date():
            diagnostics.append(
                {
                    "codiceOfferta": code,
                    "fornitore": provider_label,
                    "nome": nome,
                    "commodity": commodity,
                    "campoProblematico": "dataInizio",
                    "valoriCandidati": [data_inizio],
                    "unita": "data",
                    "testoSorgente": data_inizio,
                    "stato": "escluso",
                    "motivo": "offerta_non_ancora_valida",
                    "sorgente": source_label_for(path),
                }
            )
            continue
        if end_date.date() < as_of.date():
            diagnostics.append(
                {
                    "codiceOfferta": code,
                    "fornitore": provider_label,
                    "nome": nome,
                    "commodity": commodity,
                    "campoProblematico": "dataFine",
                    "valoriCandidati": [data_fine],
                    "unita": "data",
                    "testoSorgente": data_fine,
                    "stato": "scaduto",
                    "motivo": "offerta_scaduta",
                    "sorgente": source_label_for(path),
                }
            )
            continue

        tipo_raw = node_text(offer, "po:DettaglioOfferta/po:TIPO_OFFERTA")
        tipo = {"01": "fisso", "02": "variabile"}.get(tipo_raw, "")
        if tipo not in {"fisso", "variabile"}:
            continue

        url = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_OFFERTA")
        site = node_text(offer, "po:DettaglioOfferta/po:Contatti/po:URL_SITO_VENDITORE")
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
        price, quality, price_provenance, price_error = semantic_price(values, commodity, tipo)
        fee, fee_provenance = annual_fee(values)

        override_price, override_fee, override_quality, override_provenance, technical_details = apply_verified_override(
            overrides.get(code),
            code=code,
            name=nome,
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
            candidate_values = [
                {
                    "valore": item.get("valore"),
                    "unita": item.get("unitaMisura"),
                    "etichetta": item.get("etichettaOriginale"),
                    "ruolo": item.get("ruolo"),
                }
                for item in values
                if item.get("ruolo") in {"prezzo_principale_candidato", "spread_corrente_candidato"}
            ]
            diagnostics.append(
                {
                    "codiceOfferta": code,
                    "fornitore": provider_label,
                    "nome": nome,
                    "commodity": commodity,
                    "campoProblematico": "customerType" if customer_type == "sconosciuto" else "prezzoPrincipale",
                    "valoriCandidati": candidate_values,
                    "unita": "€/kWh" if commodity == "luce" else "€/Smc",
                    "testoSorgente": " | ".join(
                        str(item.get("testoVicino") or "") for item in values if item.get("testoVicino")
                    )[:2000],
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
                "dataInizio": data_inizio,
                "dataFine": data_fine,
                "customerType": customer_type,
                "tipoClienteCodice": customer_type_code,
                "durataMesi": duration,
                "prezzo": price,
                "unitaPrezzo": "€/kWh" if commodity == "luce" else "€/Smc",
                "quotaFissaAnnua": fee,
                "unitaQuotaFissa": "€/POD/anno" if commodity == "luce" else "€/PDR/anno",
                "indice": offer_index_name(offer, commodity),
                "spread": spread_from_provenance(price_provenance),
                "prezziFascia": band_prices(values),
                "url": url or site or "#",
                "fonte": f"{SOURCE_LABEL} - codice {code}",
                "score": score_for(commodity, price, fee),
                "qualitaPrezzo": quality,
                "metodoEstrazione": (
                    "sintesi_documentale_verificata"
                    if quality == "verificato_specifica_commerciale"
                    else "campo_semantico_arera"
                ),
                "confidenza": "alta",
                "aggiornatoIl": as_of.isoformat(timespec="seconds"),
                "provenienzaPrezzo": price_provenance,
                "provenienzaQuotaFissa": fee_provenance,
                "valoriEstratti": values,
                "dettagliTecnici": technical_details,
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
    for kind in ("E", "G"):
        url = links.get(kind)
        if not url:
            raise AreraFilesNotFound(f"Link XML ARERA obbligatorio {kind} assente")
        out = destination / Path(url).name
        download_file(url, out)
        files[kind] = out
    dual_url = links.get("D")
    if dual_url:
        dual_out = destination / Path(dual_url).name
        try:
            download_file(dual_url, dual_out)
            files["D"] = dual_out
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            log_info(f"XML dual fuel opzionale non scaricato: {error}.")
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
    if len({date.strftime("%Y%m%d") for date in dates}) != 1:
        raise ValueError(
            "I file ARERA luce/gas non appartengono alla stessa data; catalogo pubblico invariato"
        )
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
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError) as error:
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
    code = str(row.get("codice") or "")

    if not OFFER_CODE_PATTERN.fullmatch(code):
        reasons.append("codice_offerta_assente_o_malformato")
    if not parse_portale_date(str(row.get("dataInizio") or "")):
        reasons.append("data_inizio_non_valida")
    if not parse_portale_date(str(row.get("dataFine") or "")):
        reasons.append("data_fine_non_valida")
    if row.get("tipo") not in {"fisso", "variabile"}:
        reasons.append("tipo_prezzo_non_valido")
    if row.get("unitaPrezzo") != expected_unit:
        reasons.append("unita_prezzo_principale_non_coerente")
    expected_fee_unit = "€/POD/anno" if commodity == "luce" else "€/PDR/anno" if commodity == "gas" else ""
    if row.get("unitaQuotaFissa") != expected_fee_unit:
        reasons.append("unita_quota_fissa_non_coerente")

    if quality not in ALLOWED_PRICE_QUALITIES or blocked_quality(quality):
        reasons.append(f"qualita_prezzo_non_ammessa:{quality or 'assente'}")
    if row.get("customerType") not in {"privato", "business"}:
        reasons.append("tipo_cliente_non_valido")
    if commodity not in {"luce", "gas"}:
        reasons.append("commodity_non_valida")
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
        if provenance.get("ruolo") != "prezzo_principale_selezionato":
            reasons.append("ruolo_prezzo_principale_non_valido")
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


def public_row(row: dict[str, object]) -> dict[str, object]:
    result = copy.deepcopy(row)
    result.pop("valoriEstratti", None)
    return result


def validate_staging_catalog(
    staging_payload: dict[str, object],
    previous_payload: dict[str, object],
    diagnostics: list[dict[str, object]],
    *,
    enforce_minimum: bool = True,
) -> tuple[dict[str, object], dict[str, object]]:
    previous_by_key = {row_key(row): row for row in existing_rows(previous_payload) if all(row_key(row))}
    candidate_rows = existing_rows(staging_payload)
    valid_rows: list[dict[str, object]] = []
    quarantine: list[dict[str, object]] = []
    key_counts: dict[tuple[str, str], int] = {}
    for candidate in candidate_rows:
        key = row_key(candidate)
        key_counts[key] = key_counts.get(key, 0) + 1

    for candidate in candidate_rows:
        key = row_key(candidate)
        reasons = validate_candidate_row(candidate)
        if key_counts.get(key, 0) > 1:
            reasons.append("record_duplicato")
        previous = previous_by_key.get(key)
        if previous:
            reasons.extend(unexpected_changes(candidate, previous))

        if reasons:
            provenance = candidate.get("provenienzaPrezzo") if isinstance(candidate.get("provenienzaPrezzo"), dict) else {}
            quarantine.append(
                {
                    "codiceOfferta": key[0],
                    "commodity": key[1],
                    "fornitore": candidate.get("fornitore"),
                    "nome": candidate.get("nome"),
                    "campoProblematico": "validazione_catalogo",
                    "valoriCandidati": [
                        {
                            "prezzo": candidate.get("prezzo"),
                            "quotaFissaAnnua": candidate.get("quotaFissaAnnua"),
                            "tipo": candidate.get("tipo"),
                            "customerType": candidate.get("customerType"),
                            "durataMesi": candidate.get("durataMesi"),
                            "qualitaPrezzo": candidate.get("qualitaPrezzo"),
                        }
                    ],
                    "unita": candidate.get("unitaPrezzo"),
                    "testoSorgente": provenance.get("testoVicino") or "",
                    "motivi": sorted(set(reasons)),
                    "ultimoValidoConservato": False,
                }
            )
            continue
        valid_rows.append(public_row(candidate))

    parse_quarantine = [
        copy.deepcopy(item)
        for item in diagnostics
        if item.get("motivo") not in {"offerta_scaduta", "offerta_non_ancora_valida"}
    ]
    for item in parse_quarantine:
        item["motivi"] = [item.get("motivo") or "errore_parsing"]
        item["ultimoValidoConservato"] = False
    quarantine.extend(parse_quarantine)

    rows = dedupe_rows(valid_rows)
    private_rows = [row for row in rows if row.get("customerType") == "privato"]
    business_rows = [row for row in rows if row.get("customerType") == "business"]
    if not private_rows:
        raise ValueError("Validazione staging fallita: nessuna offerta privata valida; catalogo pubblico invariato")
    if enforce_minimum:
        for commodity, minimum in MINIMUM_VALID_ROWS.items():
            count = sum(1 for row in rows if row.get("commodity") == commodity)
            if count < minimum:
                raise ValueError(
                    f"Validazione staging fallita: solo {count} offerte {commodity} valide "
                    f"(minimo {minimum}); catalogo pubblico invariato"
                )
    if any(blocked_quality(row.get("qualitaPrezzo")) for row in rows):
        raise ValueError("Validazione staging fallita: qualitaPrezzo bloccata nel risultato")
    if any(row.get("customerType") != "privato" for row in private_rows):
        raise ValueError("Validazione staging fallita: offerta business nel catalogo privati")

    payload = {
        **{key: copy.deepcopy(value) for key, value in staging_payload.items() if key not in {"offerte", "offerteBusiness"}},
        "offerte": private_rows,
        "offerteBusiness": business_rows,
    }
    base_statistics = dict(payload.get("statistiche") or {})
    received_count = int(base_statistics.get("offerteRicevute") or 0)
    considered_count = int(base_statistics.get("offerteConsiderate") or 0)
    outside_radar_count = max(0, received_count - considered_count)
    expired_count = sum(1 for item in diagnostics if item.get("motivo") == "offerta_scaduta")
    future_count = sum(1 for item in diagnostics if item.get("motivo") == "offerta_non_ancora_valida")
    exclusion_reasons: dict[str, int] = {}
    if outside_radar_count:
        exclusion_reasons["fornitore_fuori_radar_gestito"] = outside_radar_count
    if expired_count:
        exclusion_reasons["offerta_scaduta"] = expired_count
    if future_count:
        exclusion_reasons["offerta_non_ancora_valida"] = future_count

    payload["statistiche"] = {
        **base_statistics,
        "totaleRighe": len(private_rows) + len(business_rows),
        "offertePrivati": len(private_rows),
        "offerteBusiness": len(business_rows),
        "inQuarantena": len(quarantine),
        "scadute": expired_count,
        "fuoriRadar": outside_radar_count,
        "escluse": outside_radar_count + future_count,
        "scartate": len(diagnostics),
    }
    report = {
        "schemaVersion": CATALOG_SCHEMA_VERSION,
        "versioneDati": payload.get("versioneDati"),
        "aggiornatoIl": payload.get("aggiornatoIl"),
        "pubblicazioneAutorizzata": True,
        "statoPubblicazioneAtomica": "completata",
        "catalogoPrecedenteUsatoIntegralmente": False,
        "offertePrecedentiRipescate": 0,
        "statistiche": payload["statistiche"],
        "motiviEsclusione": exclusion_reasons,
        "quarantena": quarantine,
        "scarti": diagnostics,
    }
    payload["report"] = {
        "schemaVersion": CATALOG_SCHEMA_VERSION,
        "versioneDati": payload.get("versioneDati"),
        "aggiornatoIl": payload.get("aggiornatoIl"),
        "statoPubblicazioneAtomica": "completata",
        "statistiche": payload["statistiche"],
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


def atomic_publish_catalog(
    root: Path,
    payload: dict[str, object],
    report: dict[str, object],
) -> list[Path]:
    targets_with_bodies = [
        (root / "data" / "offerte-arera-menu.json", json_text(payload)),
        (root / "public" / "data" / "offerte-arera-menu.json", json_text(payload)),
        (root / "data" / "arera-update-report.json", json_text(report)),
        (root / "public" / "data" / "arera-update-report.json", json_text(report)),
    ]
    targets = [target for target, _ in targets_with_bodies]
    temporary: list[tuple[Path, Path]] = []
    originals = {target: target.read_bytes() if target.exists() else None for target in targets}
    replaced: list[Path] = []
    try:
        for target, body in targets_with_bodies:
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
            os.close(fd)
            temp_path = Path(name)
            temp_path.write_text(body, encoding="utf-8")
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


def xml_offer_count(path: Path) -> int:
    return len(ET.parse(path).findall(".//po:offerta", NS))


def build_staging_payload(
    files: dict[str, Path], as_of: datetime, root: Path
) -> tuple[dict[str, object], list[dict[str, object]]]:
    overrides = load_verified_overrides(root)
    diagnostics: list[dict[str, object]] = []
    rows: list[dict[str, object]] = []
    rows.extend(parse_offer_file(files["E"], "luce", as_of, overrides, diagnostics))
    rows.extend(parse_offer_file(files["G"], "gas", as_of, overrides, diagnostics))

    return {
        "schemaVersion": CATALOG_SCHEMA_VERSION,
        "versioneDati": f"arera-menu-v{CATALOG_SCHEMA_VERSION}-{as_of.strftime('%Y-%m-%d')}",
        "fonte": SOURCE_LABEL,
        "aggiornatoIl": as_of.strftime("%Y-%m-%d"),
        "offerte": [row for row in rows if row.get("customerType") == "privato"],
        "offerteBusiness": [row for row in rows if row.get("customerType") == "business"],
        "statistiche": {
            "offerteRicevute": xml_offer_count(files["E"]) + xml_offer_count(files["G"]),
            "offerteRicevuteLuce": xml_offer_count(files["E"]),
            "offerteRicevuteGas": xml_offer_count(files["G"]),
            "offerteConsiderate": len(rows) + len(diagnostics),
            "totaleRigheStaging": len(rows),
            "fileLuce": files["E"].name,
            "fileGas": files["G"].name,
        },
    }, diagnostics


def build_validated_payload(
    files: dict[str, Path], as_of: datetime, root: Path
) -> tuple[dict[str, object], dict[str, object], Path]:
    staging_payload, diagnostics = build_staging_payload(files, as_of, root)
    staging_path = write_staging(root, staging_payload)
    previous_payload = read_json(root / "data" / "offerte-arera-menu.json")
    payload, report = validate_staging_catalog(staging_payload, previous_payload, diagnostics)
    payload, partner_stats = enrich_partner_metadata(payload, root)
    payload["statistiche"].update(partner_stats)
    report["statistiche"] = copy.deepcopy(payload["statistiche"])
    payload["report"]["statistiche"] = copy.deepcopy(payload["statistiche"])
    return payload, report, staging_path


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
    staging_path: Path | None = None
    report: dict[str, object] | None = None
    try:
        if args.source_dir:
            log_info(f"Cerco file ARERA locali in {args.source_dir.resolve()} per la data {as_of.strftime('%Y%m%d')}.")
            files = local_files(args.source_dir.resolve())
            source_date = source_date_from_files(files) or as_of
            log_info(f"Parsing file ARERA per la data {source_date.strftime('%Y%m%d')}.")
            payload, report, staging_path = build_validated_payload(files, source_date, root)
            targets = atomic_publish_catalog(root, payload, report)
        else:
            with tempfile.TemporaryDirectory(prefix="offertalogica-arera-") as tmp:
                files = download_current_files(Path(tmp), as_of)
                source_date = source_date_from_files(files) or as_of
                log_info(f"Parsing file ARERA per la data {source_date.strftime('%Y%m%d')}.")
                payload, report, staging_path = build_validated_payload(files, source_date, root)
                targets = atomic_publish_catalog(root, payload, report)
    except Exception as error:
        failure_report = report or {
            "schemaVersion": CATALOG_SCHEMA_VERSION,
            "versioneDati": f"arera-menu-v{CATALOG_SCHEMA_VERSION}-{as_of.strftime('%Y-%m-%d')}",
            "aggiornatoIl": as_of.strftime("%Y-%m-%d"),
            "pubblicazioneAutorizzata": False,
            "errore": str(error),
        }
        failure_report["pubblicazioneAutorizzata"] = False
        failure_report["statoPubblicazioneAtomica"] = "non_eseguita_catalogo_precedente_invariato"
        failure_report["catalogoPrecedenteUsatoIntegralmente"] = True
        failure_report["offertePrecedentiRipescate"] = 0
        failure_report["errore"] = str(error)
        write_report(root, failure_report)
        if isinstance(error, AreraFilesNotFound):
            log_error(no_files_message(as_of.strftime("%Y%m%d")))
        log_error(f"Aggiornamento ARERA non riuscito: {error}")
        log_error("I dati esistenti non sono stati modificati.")
        return 1

    log_info(
        f"Creato offerte-arera-menu.json con {payload['statistiche']['totaleRighe']} righe "
        f"({payload['statistiche']['fileLuce']} / {payload['statistiche']['fileGas']})."
    )
    log_info(f"Staging validato: {staging_path.relative_to(root) if staging_path else 'non disponibile'}")
    log_info("Report aggiornamento pubblicato atomicamente insieme al catalogo.")
    log_info("Aggiornamento completato correttamente.")
    for target in targets:
        log_info(f"Aggiornato: {target.relative_to(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
