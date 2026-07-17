#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import py_compile
import shutil
import sys
from pathlib import Path

EXPECTED_GIT_BLOB_SHA = "5d447da243433f78802436bae1984b184564d78b"
TARGET_RELATIVE = Path("scripts/update-arera-menu.py")

OLD_PROVIDER = '''    ProviderRule("eco", "E.CO Energia Corrente", (r"\\be\\.?\\s*co\\b", r"energia corrente")),'''
NEW_PROVIDER = '''    ProviderRule(
        "eco",
        "E.CO Energia Corrente",
        (r"\\be\\.\\s*co\\b", r"\\benergia corrente\\b", r"\\b000742"),
    ),'''

OLD_PRICE_ORDER = '''            elif matches_any(context, PRIMARY_PRICE_PATTERNS):
                role = "prezzo_principale_candidato"
            elif tipo == "variabile" and matches_any(context, SPREAD_PATTERNS):
                role = "spread_corrente_candidato"'''

NEW_PRICE_ORDER = '''            elif tipo == "variabile" and matches_any(context, SPREAD_PATTERNS):
                role = "spread_corrente_candidato"
            elif matches_any(context, PRIMARY_PRICE_PATTERNS):
                role = "prezzo_principale_candidato"'''


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode("utf-8")
    return hashlib.sha1(header + data).hexdigest()


def resolve_target(repo: Path) -> Path:
    repo = repo.expanduser().resolve()
    direct = repo / TARGET_RELATIVE
    if direct.is_file():
        return direct
    if repo.is_file() and repo.name == TARGET_RELATIVE.name:
        return repo
    raise FileNotFoundError(
        f"Non trovo {TARGET_RELATIVE}. Indica la cartella principale del repository."
    )


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"Patch interrotta: il blocco '{label}' compare {count} volte invece di 1. "
            "Il file non corrisponde alla base verificata."
        )
    return text.replace(old, new, 1)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Applica la correzione mirata Axpo/E.CO senza eliminare file o creare API."
    )
    parser.add_argument(
        "repository",
        nargs="?",
        default=".",
        help="Cartella principale del repository (default: cartella corrente).",
    )
    parser.add_argument(
        "--allow-sha-mismatch",
        action="store_true",
        help="Consente l'applicazione solo se i due blocchi attesi sono comunque identici.",
    )
    args = parser.parse_args()

    target = resolve_target(Path(args.repository))
    original_bytes = target.read_bytes()
    original_sha = git_blob_sha(original_bytes)

    if original_sha != EXPECTED_GIT_BLOB_SHA and not args.allow_sha_mismatch:
        raise RuntimeError(
            "Patch interrotta: SHA del file diversa da quella del branch verificato.\n"
            f"Attesa:  {EXPECTED_GIT_BLOB_SHA}\n"
            f"Trovata: {original_sha}\n"
            "Non è stato modificato nulla."
        )

    original = original_bytes.decode("utf-8")
    modified = replace_once(original, OLD_PROVIDER, NEW_PROVIDER, "matching E.CO")
    modified = replace_once(modified, OLD_PRICE_ORDER, NEW_PRICE_ORDER, "priorità spread")

    backup = target.with_suffix(target.suffix + ".bak-prezzi-axpo-eco")
    if backup.exists():
        raise FileExistsError(
            f"Esiste già il backup {backup}. Rimuovilo o rinominalo prima di riprovare."
        )

    shutil.copy2(target, backup)
    try:
        target.write_text(modified, encoding="utf-8", newline="")
        py_compile.compile(str(target), doraise=True)
    except Exception:
        shutil.copy2(backup, target)
        raise

    new_sha = git_blob_sha(target.read_bytes())
    print("Patch applicata correttamente.")
    print(f"File modificato: {target}")
    print(f"Backup: {backup}")
    print(f"SHA originale: {original_sha}")
    print(f"SHA modificata: {new_sha}")
    print("Modifiche: matching E.CO preciso; spread variabile classificato prima del prezzo generico.")
    print("Nessun altro file è stato modificato. Nessuna API è stata creata.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERRORE: {exc}", file=sys.stderr)
        raise SystemExit(1)
