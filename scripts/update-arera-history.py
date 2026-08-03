#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
CURRENT_RELATIVE_PATH = Path("data/offerte-arera-menu.json")
HISTORY_RELATIVE_PATH = Path("data/offerte-arera-history.json")
PUBLIC_HISTORY_RELATIVE_PATH = Path("public/data/offerte-arera-history.json")
CATALOG_FIELDS = ("offerte", "offerteBusiness", "offerteDual", "offerteDualBusiness")


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON non valido: {path}")
    return payload


def json_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def clean_text(value: Any, limit: int = 500) -> str:
    return " ".join(str(value or "").split()).strip()[:limit]


def clean_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 8)


def clean_date(value: Any) -> str:
    return clean_text(value, 40)


def catalog_date(payload: dict[str, Any]) -> str:
    raw = clean_text(payload.get("aggiornatoIl"), 20)
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        return datetime.now().date().isoformat()


def record_type(field: str, row: dict[str, Any]) -> str:
    if field in {"offerteDual", "offerteDualBusiness"} or row.get("fornitura") == "dual":
        return "dual"
    return "single"


def record_commodity(field: str, row: dict[str, Any]) -> str:
    if record_type(field, row) == "dual":
        return "dual"
    value = clean_text(row.get("commodity"), 20).lower()
    return value if value in {"luce", "gas"} else "unknown"


def record_key(field: str, row: dict[str, Any]) -> str:
    code = clean_text(row.get("codice"), 220).upper().replace(" ", "")
    commodity = record_commodity(field, row)
    if not code:
        fallback = "|".join(
            [
                clean_text(row.get("providerKey"), 100).lower(),
                clean_text(row.get("nome"), 250).lower(),
                commodity,
                clean_text(row.get("tipo"), 40).lower(),
                clean_date(row.get("dataInizio")),
                clean_date(row.get("dataFine")),
            ]
        )
        code = "NO-CODE-" + hashlib.sha256(fallback.encode("utf-8")).hexdigest()[:20].upper()
    return f"{commodity}:{code}"


def variable_details(row: dict[str, Any], current_payload: dict[str, Any]) -> dict[str, Any]:
    if clean_text(row.get("tipo"), 30).lower() != "variabile":
        return {"indexName": None, "indexValueAtCapture": None, "spreadEstimate": None}

    commodity = clean_text(row.get("commodity"), 20).lower()
    index_name = "PUN" if commodity == "luce" else "PSV" if commodity == "gas" else None
    index_key = "pun" if commodity == "luce" else "psv" if commodity == "gas" else None
    index_value = clean_number((current_payload.get("indiciUsati") or {}).get(index_key)) if index_key else None
    price = clean_number(row.get("prezzo"))
    spread = round(price - index_value, 8) if price is not None and index_value is not None else None
    return {
        "indexName": index_name,
        "indexValueAtCapture": index_value,
        "spreadEstimate": spread,
    }


def snapshot_from_row(field: str, row: dict[str, Any], current_payload: dict[str, Any], seen_on: str) -> dict[str, Any]:
    single = record_type(field, row) == "single"
    variable = variable_details(row, current_payload) if single else {
        "indexName": None,
        "indexValueAtCapture": None,
        "spreadEstimate": None,
    }
    snapshot: dict[str, Any] = {
        "catalogDate": seen_on,
        "validFrom": clean_date(row.get("dataInizio")),
        "validTo": clean_date(row.get("dataFine")),
        "priceType": clean_text(row.get("tipo"), 40).lower(),
        "price": clean_number(row.get("prezzo")) if single else None,
        "annualFixedFee": clean_number(row.get("quotaFissaAnnua")) if single else None,
        "durationMonths": int(row["durataMesi"]) if isinstance(row.get("durataMesi"), (int, float)) else None,
        "priceQuality": clean_text(row.get("qualitaPrezzo"), 100),
        "url": clean_text(row.get("url"), 800),
        "source": clean_text(row.get("fonte"), 800),
        **variable,
    }
    if not single:
        light = row.get("luce") if isinstance(row.get("luce"), dict) else {}
        gas = row.get("gas") if isinstance(row.get("gas"), dict) else {}
        snapshot["electricityOfferCode"] = clean_text(
            row.get("codiceOffertaLuce") or light.get("codice"), 220
        )
        snapshot["gasOfferCode"] = clean_text(
            row.get("codiceOffertaGas") or gas.get("codice"), 220
        )
    return snapshot


def snapshot_signature(snapshot: dict[str, Any]) -> str:
    relevant = {
        key: snapshot.get(key)
        for key in (
            "validFrom",
            "validTo",
            "priceType",
            "price",
            "annualFixedFee",
            "durationMonths",
            "priceQuality",
            "indexName",
            "indexValueAtCapture",
            "spreadEstimate",
            "electricityOfferCode",
            "gasOfferCode",
        )
    }
    return hashlib.sha256(
        json.dumps(relevant, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def base_record(field: str, row: dict[str, Any], current_payload: dict[str, Any], seen_on: str) -> dict[str, Any]:
    kind = record_type(field, row)
    commodity = record_commodity(field, row)
    code = clean_text(row.get("codice"), 220).upper().replace(" ", "")
    return {
        "key": record_key(field, row),
        "recordType": kind,
        "commodity": commodity,
        "offerCode": code,
        "providerKey": clean_text(row.get("providerKey"), 100).lower(),
        "providerName": clean_text(row.get("fornitore") or row.get("providerLabel"), 250),
        "providerVat": clean_text(row.get("pivaVenditore"), 40),
        "offerName": clean_text(row.get("nome"), 300),
        "customerType": clean_text(row.get("customerType"), 40),
        "firstSeen": seen_on,
        "lastSeen": seen_on,
        "active": True,
        "versions": [snapshot_from_row(field, row, current_payload, seen_on)],
    }


def merge_catalog(current_payload: dict[str, Any], previous_history: dict[str, Any]) -> dict[str, Any]:
    seen_on = catalog_date(current_payload)
    previous_records = previous_history.get("offers", [])
    by_key: dict[str, dict[str, Any]] = {
        str(item.get("key")): copy.deepcopy(item)
        for item in previous_records
        if isinstance(item, dict) and item.get("key")
    }

    for item in by_key.values():
        item["active"] = False

    current_keys: set[str] = set()
    for field in CATALOG_FIELDS:
        rows = current_payload.get(field, [])
        if not isinstance(rows, list):
            continue
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            row = copy.deepcopy(raw)
            key = record_key(field, row)
            current_keys.add(key)
            snapshot = snapshot_from_row(field, row, current_payload, seen_on)
            signature = snapshot_signature(snapshot)
            existing = by_key.get(key)

            if existing is None:
                by_key[key] = base_record(field, row, current_payload, seen_on)
                continue

            existing["active"] = True
            existing["lastSeen"] = seen_on
            existing["providerKey"] = clean_text(row.get("providerKey"), 100).lower()
            existing["providerName"] = clean_text(row.get("fornitore") or row.get("providerLabel"), 250)
            existing["providerVat"] = clean_text(row.get("pivaVenditore"), 40)
            existing["offerName"] = clean_text(row.get("nome"), 300)
            existing["customerType"] = clean_text(row.get("customerType"), 40)
            versions = existing.get("versions")
            if not isinstance(versions, list):
                versions = []
                existing["versions"] = versions
            latest_signature = snapshot_signature(versions[-1]) if versions else ""
            if signature != latest_signature:
                versions.append(snapshot)

    offers = sorted(
        by_key.values(),
        key=lambda item: (
            str(item.get("providerName") or "").lower(),
            str(item.get("commodity") or ""),
            str(item.get("offerName") or "").lower(),
            str(item.get("offerCode") or ""),
        ),
    )
    active_count = sum(1 for item in offers if item.get("active"))
    inactive_count = len(offers) - active_count
    version_count = sum(len(item.get("versions") or []) for item in offers)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "version": f"arera-history-{seen_on}",
        "updatedAt": seen_on,
        "sourceCatalogVersion": clean_text(current_payload.get("versioneDati"), 120),
        "source": clean_text(current_payload.get("fonte"), 800),
        "offers": offers,
        "statistics": {
            "totalOffers": len(offers),
            "activeOffers": active_count,
            "inactiveOffers": inactive_count,
            "totalVersions": version_count,
            "currentCatalogRecords": len(current_keys),
        },
    }


def atomic_write_many(targets: dict[Path, str]) -> None:
    temporary: list[tuple[Path, Path]] = []
    originals = {target: target.read_bytes() if target.exists() else None for target in targets}
    replaced: list[Path] = []
    try:
        for target, body in targets.items():
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
                target.write_bytes(original)
        raise
    finally:
        for temp_path, _ in temporary:
            temp_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mantiene lo storico progressivo delle offerte ARERA pubblicate da OffertaLogica."
    )
    parser.add_argument(
        "--package-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Radice del repository.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.package_root.resolve()
    current_path = root / CURRENT_RELATIVE_PATH
    history_path = root / HISTORY_RELATIVE_PATH
    public_path = root / PUBLIC_HISTORY_RELATIVE_PATH

    current_payload = read_json(current_path)
    if not current_payload.get("offerte"):
        raise ValueError(f"Catalogo ARERA corrente assente o vuoto: {current_path}")

    previous_history = read_json(history_path)
    history = merge_catalog(current_payload, previous_history)
    body = json_text(history)
    atomic_write_many({history_path: body, public_path: body})

    stats = history["statistics"]
    print(
        "[ARERA-HISTORY] "
        f"{stats['totalOffers']} offerte storiche; "
        f"{stats['activeOffers']} attive; "
        f"{stats['inactiveOffers']} non più presenti; "
        f"{stats['totalVersions']} versioni."
    )
    print(f"[ARERA-HISTORY] Aggiornato: {history_path.relative_to(root)}")
    print(f"[ARERA-HISTORY] Aggiornato: {public_path.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
