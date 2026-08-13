#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Allinea i lastmod giornalieri della sitemap alla data del catalogo ARERA."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Radice repository. Default: radice ricavata dal percorso dello script.",
    )
    return parser.parse_args()


def update_sitemap(root: Path) -> tuple[str, int]:
    root = root.resolve()
    catalog_path = root / "public" / "data" / "offerte-arera-menu.json"
    sitemap_path = root / "public" / "sitemap.xml"

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    as_of = str(catalog.get("aggiornatoIl") or "").strip()
    datetime.strptime(as_of, "%Y-%m-%d")

    original = sitemap_path.read_text(encoding="utf-8")
    url_block = re.compile(r"<url>.*?</url>", re.S)

    changed = 0

    def replace_block(match: re.Match[str]) -> str:
        nonlocal changed
        block = match.group(0)
        if "<changefreq>daily</changefreq>" not in block:
            return block
        updated, count = re.subn(
            r"(<lastmod>)\d{4}-\d{2}-\d{2}(</lastmod>)",
            rf"\g<1>{as_of}\g<2>",
            block,
            count=1,
        )
        if count != 1:
            raise RuntimeError("Voce sitemap daily senza un lastmod valido.")
        if updated != block:
            changed += 1
        return updated

    result = url_block.sub(replace_block, original)
    if "<changefreq>daily</changefreq>" not in original:
        raise RuntimeError("Sitemap senza voci daily: aggiornamento bloccato.")

    fd, temp_name = tempfile.mkstemp(
        prefix=".sitemap.",
        suffix=".tmp",
        dir=sitemap_path.parent,
    )
    temp_path = Path(temp_name)
    try:
        with open(fd, "w", encoding="utf-8", closefd=True) as handle:
            handle.write(result)
        temp_path.replace(sitemap_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()

    return as_of, changed


def main() -> int:
    args = parse_args()
    as_of, changed = update_sitemap(args.root)
    print(f"[SITEMAP] lastmod daily allineati a {as_of}; voci modificate: {changed}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
