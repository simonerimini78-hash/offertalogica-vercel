#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_PARTNER_ROOT = Path.home() / "Desktop" / "Offerte-Partner"
PARTNER_SUBDIRS = ("00_DA_VALIDARE", "10_NORMALIZZATE", "20_ATTIVE", "90_ARCHIVIO")
PARTNER_METADATA_FILE = ".offertalogica-partner.json"
FOLDER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")


def log(message: str) -> None:
    print(f"[PARTNER-DIRS] {message}")


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key or key in os.environ:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            os.environ[key] = value
    except OSError as exc:
        log(f"AVVISO: configurazione locale non leggibile ({path}): {exc}")


def load_local_environment(package_root: Path) -> None:
    candidates = (
        package_root / ".env.local",
        package_root / ".env",
        Path.home() / ".config" / "offertalogica" / "protection-sync.env",
    )
    for path in candidates:
        load_env_file(path)


def first_env(*names: str) -> str:
    for name in names:
        value = str(os.environ.get(name, "")).strip()
        if value:
            return value
    return ""


def protection_config(package_root: Path) -> tuple[str, str] | None:
    load_local_environment(package_root)
    url = first_env(
        "PROTECTION_SUPABASE_URL",
        "SUPABASE_URL",
        "CUSTOMER_DB_SUPABASE_URL",
    ).rstrip("/")
    secret = first_env(
        "PROTECTION_SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY",
    )
    if not url or not secret:
        return None
    if not url.startswith("https://"):
        raise ValueError("URL Supabase Protezione non valida")
    return url, secret


def fetch_manifest(url: str, secret: str, timeout: float = 20.0) -> list[dict[str, Any]]:
    endpoint = f"{url}/rest/v1/rpc/protection_partner_folder_manifest"
    body = b"{}"
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"RPC manifest HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"RPC manifest non raggiungibile: {exc.reason}") from exc
    if not isinstance(payload, list):
        raise RuntimeError("RPC manifest: risposta non valida")
    return [item for item in payload if isinstance(item, dict)]


def read_manifest_file(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Il manifest locale deve essere una lista JSON")
    return [item for item in payload if isinstance(item, dict)]


def safe_folder_slug(value: Any) -> str:
    slug = str(value or "").strip().lower()
    if not FOLDER_RE.fullmatch(slug):
        raise ValueError(f"folder_slug non valido: {slug or '<vuoto>'}")
    return slug


def write_partner_metadata(partner_dir: Path, row: dict[str, Any], dry_run: bool = False) -> int:
    """Mantiene un piccolo riferimento locale non sensibile all'anagrafica Staff.

    Il file è nascosto nel Finder e serve al normalizzatore PDF generico per usare
    il nome canonico del fornitore invece dello slug della cartella.
    """
    payload = {
        "schemaVersion": 1,
        "source": "protection_partner_folder_manifest",
        "supplierId": row.get("supplier_id"),
        "supplierKey": str(row.get("supplier_key") or "").strip() or None,
        "supplierName": str(row.get("supplier_name") or "").strip() or None,
        "partnerId": row.get("partner_id"),
        "partnerKey": str(row.get("partner_key") or "").strip() or None,
        "relationshipType": str(row.get("relationship_type") or "").strip() or None,
        "folderSlug": str(row.get("folder_slug") or "").strip() or None,
        "validFrom": row.get("valid_from"),
        "validUntil": row.get("valid_until"),
    }
    target = partner_dir / PARTNER_METADATA_FILE
    body = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if target.is_file():
        try:
            if target.read_text(encoding="utf-8") == body:
                return 0
        except OSError:
            pass
    if dry_run:
        return 1
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(body, encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    os.replace(temporary, target)
    return 1


def ensure_partner_folder(partner_root: Path, row: dict[str, Any], dry_run: bool = False) -> tuple[str, int]:
    slug = safe_folder_slug(row.get("folder_slug") or row.get("supplier_key") or row.get("partner_key"))
    supplier_name = str(row.get("supplier_name") or row.get("supplier_key") or slug).strip() or slug
    partner_dir = partner_root / slug
    root_resolved = partner_root.resolve(strict=False)
    target_resolved = partner_dir.resolve(strict=False)
    if root_resolved != target_resolved and root_resolved not in target_resolved.parents:
        raise ValueError(f"cartella partner fuori dalla radice consentita: {slug}")

    created = 0
    if not dry_run:
        if not partner_dir.exists():
            partner_dir.mkdir(parents=True, exist_ok=True)
            created += 1
        for subdir in PARTNER_SUBDIRS:
            path = partner_dir / subdir
            if not path.exists():
                path.mkdir(parents=True, exist_ok=True)
                created += 1
        created += write_partner_metadata(partner_dir, row, dry_run=False)
    elif partner_dir.exists():
        created += write_partner_metadata(partner_dir, row, dry_run=True)
    return supplier_name, created


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sincronizza sul Mac le cartelle delle collaborazioni Offerta Logica attive.")
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--partner-root", type=Path, default=Path(os.environ.get("OFFERTALOGICA_PARTNER_ROOT", DEFAULT_PARTNER_ROOT)))
    parser.add_argument("--manifest-file", type=Path, default=None, help="Manifest JSON locale per test/offline.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--require-config", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    package_root = args.package_root.expanduser().resolve()
    partner_root = args.partner_root.expanduser().resolve()

    if args.manifest_file:
        rows = read_manifest_file(args.manifest_file.expanduser().resolve())
        source = f"manifest locale {args.manifest_file}"
    else:
        config = protection_config(package_root)
        if config is None:
            message = (
                "configurazione Supabase Protezione assente sul Mac; "
                "mantengo le cartelle esistenti senza crearne di nuove"
            )
            if args.require_config:
                raise RuntimeError(message)
            log(f"AVVISO: {message}.")
            return 0
        rows = fetch_manifest(*config)
        source = "Supabase Protezione"

    log(f"Manifest collaborazioni: {len(rows)} record da {source}.")
    if not rows:
        log("Nessuna collaborazione con pipeline offerte attiva. Nessuna cartella modificata.")
        return 0

    if not args.dry_run:
        partner_root.mkdir(parents=True, exist_ok=True)

    created_total = 0
    processed = 0
    for row in sorted(rows, key=lambda item: str(item.get("supplier_name") or item.get("supplier_key") or "").lower()):
        try:
            supplier_name, created = ensure_partner_folder(partner_root, row, dry_run=args.dry_run)
        except ValueError as exc:
            log(f"ERRORE record manifest ignorato: {exc}")
            continue
        processed += 1
        created_total += created
        slug = safe_folder_slug(row.get("folder_slug") or row.get("supplier_key") or row.get("partner_key"))
        if args.dry_run:
            log(f"DRY-RUN: {supplier_name} -> {partner_root / slug}")
        elif created:
            log(f"{supplier_name}: struttura creata/aggiornata in {partner_root / slug} ({created} elementi nuovi).")
        else:
            log(f"{supplier_name}: struttura già presente in {partner_root / slug}.")

    log(f"Sincronizzazione cartelle completata: {processed} partner, {created_total} elementi creati.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        log(f"ERRORE: {exc}")
        raise SystemExit(1)
