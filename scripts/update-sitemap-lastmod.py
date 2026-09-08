#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

BASE_URL = "https://offertalogica.it/"
OFFERS_URL = f"{BASE_URL}offerte-luce-gas-aggiornate.html"
PROVIDER_URL_RE = re.compile(r"^https://offertalogica\.it/fornitori/[^/]+\.html$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Allinea i metadata SEO che dipendono dal catalogo offerte ARERA. "
            "PUN e PSV restano sotto il controllo del dataset energia."
        )
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Radice repository. Default: radice ricavata dal percorso dello script.",
    )
    return parser.parse_args()


def load_catalog(root: Path) -> tuple[dict[str, object], str]:
    catalog_path = root / "public" / "data" / "offerte-arera-menu.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    as_of = str(catalog.get("aggiornatoIl") or "").strip()
    datetime.strptime(as_of, "%Y-%m-%d")
    return catalog, as_of


def is_catalog_url(url: str) -> bool:
    return url == OFFERS_URL or bool(PROVIDER_URL_RE.match(url))


def render_sitemap(original: str, as_of: str) -> tuple[str, int, int]:
    url_block = re.compile(r"<url>.*?</url>", re.S)
    targeted = 0
    changed = 0

    def replace_block(match: re.Match[str]) -> str:
        nonlocal targeted, changed
        block = match.group(0)
        loc_match = re.search(r"<loc>([^<]+)</loc>", block)
        if not loc_match or not is_catalog_url(loc_match.group(1)):
            return block
        targeted += 1
        if "<changefreq>daily</changefreq>" not in block:
            raise RuntimeError(f"Voce catalogo non daily in sitemap: {loc_match.group(1)}")
        updated, count = re.subn(
            r"(<lastmod>)\d{4}-\d{2}-\d{2}(</lastmod>)",
            rf"\g<1>{as_of}\g<2>",
            block,
            count=1,
        )
        if count != 1:
            raise RuntimeError(f"Voce sitemap catalogo senza lastmod valido: {loc_match.group(1)}")
        if updated != block:
            changed += 1
        return updated

    result = url_block.sub(replace_block, original)
    if targeted == 0 or f"<loc>{OFFERS_URL}</loc>" not in original:
        raise RuntimeError("Sitemap senza le URL catalogo attese: aggiornamento bloccato.")
    return result, targeted, changed


def date_it(iso_date: str) -> str:
    parsed = datetime.strptime(iso_date, "%Y-%m-%d")
    return parsed.strftime("%d/%m/%Y")


def render_offers_page(original: str, catalog: dict[str, object], as_of: str) -> tuple[str, int]:
    date_pattern = r'("dateModified"\s*:\s*")\d{4}-\d{2}-\d{2}(")'
    if len(re.findall(date_pattern, original)) != 1:
        raise RuntimeError("Pagina offerte: dateModified JSON-LD non trovato in modo univoco.")
    updated = re.sub(date_pattern, rf"\g<1>{as_of}\g<2>", original, count=1)

    offers = catalog.get("offerte")
    offers_count = len(offers) if isinstance(offers, list) else None
    count_text = str(offers_count) if offers_count is not None else "le"
    note = (
        '<div class="notice" id="arera-update-note">'
        f'<strong>Dati ARERA aggiornati al {date_it(as_of)}.</strong> '
        f'Il calcolatore usa {count_text} offerte censite nel file aggiornato e ricalcola la convenienza sul profilo inserito.'
        '</div>'
    )
    note_pattern = r'<div class="notice" id="arera-update-note">.*?</div>'
    if len(re.findall(note_pattern, updated, flags=re.S)) != 1:
        raise RuntimeError("Pagina offerte: nota aggiornamento ARERA non trovata in modo univoco.")
    updated = re.sub(note_pattern, note, updated, count=1, flags=re.S)
    return updated, int(updated != original)


def atomic_publish(targets: dict[Path, str]) -> None:
    temporary: list[tuple[Path, Path]] = []
    originals = {path: path.read_bytes() if path.exists() else None for path in targets}
    replaced: list[Path] = []
    try:
        for target, content in targets.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
            os.close(fd)
            temp = Path(name)
            temp.write_text(content, encoding="utf-8")
            temporary.append((temp, target))
        for temp, target in temporary:
            os.replace(temp, target)
            replaced.append(target)
    except Exception:
        for target in reversed(replaced):
            original = originals[target]
            if original is None:
                target.unlink(missing_ok=True)
            else:
                fd, name = tempfile.mkstemp(prefix=f".{target.name}.rollback.", suffix=".tmp", dir=target.parent)
                os.close(fd)
                rollback = Path(name)
                rollback.write_bytes(original)
                os.replace(rollback, target)
        raise
    finally:
        for temp, _ in temporary:
            temp.unlink(missing_ok=True)


def update_catalog_seo(root: Path) -> tuple[str, int, int, int]:
    root = root.resolve()
    catalog, as_of = load_catalog(root)
    sitemap_path = root / "public" / "sitemap.xml"
    offers_path = root / "public" / "offerte-luce-gas-aggiornate.html"

    sitemap_original = sitemap_path.read_text(encoding="utf-8")
    offers_original = offers_path.read_text(encoding="utf-8")
    sitemap, targeted, sitemap_changed = render_sitemap(sitemap_original, as_of)
    offers_page, offers_changed = render_offers_page(offers_original, catalog, as_of)

    atomic_publish({sitemap_path: sitemap, offers_path: offers_page})
    return as_of, targeted, sitemap_changed, offers_changed


def update_sitemap(root: Path) -> tuple[str, int]:
    """Compatibilità con i chiamanti esistenti: restituisce data e voci sitemap modificate."""
    as_of, _targeted, changed, _offers_changed = update_catalog_seo(root)
    return as_of, changed


def main() -> int:
    args = parse_args()
    as_of, targeted, sitemap_changed, offers_changed = update_catalog_seo(args.root)
    print(
        f"[SEO-DATASET] Catalogo {as_of}; URL sitemap gestite: {targeted}; "
        f"lastmod modificati: {sitemap_changed}; pagina offerte modificata: {offers_changed}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
