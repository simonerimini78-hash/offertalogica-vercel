#!/usr/bin/env python3
from __future__ import annotations

import json
import mimetypes
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "public" / "assets" / "providers"
DATA_JSON = ROOT / "data" / "provider-brand.json"
PUBLIC_DATA_JSON = ROOT / "public" / "data" / "provider-brand.json"


PROVIDERS = [
    ("a2a", "A2A Energia", "https://www.a2aenergia.eu/"),
    ("acea", "Acea Energia", "https://www.acea.it/"),
    ("agasco", "Agasco", "https://www.agasco.it/"),
    ("alperia", "Alperia", "https://www.alperia.eu/"),
    ("amga", "Amga", "https://www.amgaenergia.it/"),
    ("argos", "Argos", "https://www.argosenergia.it/"),
    ("axpo", "Axpo Energia", "https://www.axpo.com/it/it.html"),
    ("dolomiti", "Dolomiti Energia", "https://www.dolomitienergia.it/"),
    ("eco", "E.CO Energia Corrente", "https://www.energia-corrente.it/"),
    ("eon", "E.ON", "https://www.eon-energia.com/"),
    ("edison", "Edison", "https://www.edisonenergia.it/"),
    ("eni", "Plenitude", "https://eniplenitude.com/"),
    ("enel", "Enel Energia", "https://www.enel.it/"),
    ("enercom", "Enercom", "https://www.enercomlucegas.it/"),
    ("engie", "Engie", "https://www.engie.it/"),
    ("eja", "Eja Energia", "https://www.ejaenergia.it/"),
    ("hera", "Hera Comm", "https://heracomm.gruppohera.it/"),
    ("illum", "Illumia", "https://www.illumia.it/"),
    ("iren", "Iren Luce e Gas", "https://www.irenlucegas.it/"),
    ("magis", "Magis Energia", "https://www.magisenergia.it/"),
    ("nen", "neN", "https://nen.it/"),
    ("nova", "Nova Aeg", "https://www.novaaeg.it/"),
    ("octopus", "Octopus Energy", "https://octopusenergy.it/"),
    ("optima", "Optima Italia", "https://www.optimaitalia.com/"),
    ("poste", "Poste Energia", "https://www.poste.it/prodotti/poste-energia.html"),
    ("pulsee", "Pulsee Luce e Gas", "https://pulsee.it/"),
    ("sen", "Servizio Elettrico Nazionale", "https://www.servizioelettriconazionale.it/"),
    ("sorgenia", "Sorgenia", "https://www.sorgenia.it/"),
    ("tate", "Tate", "https://www.tate.it/"),
    ("vivi", "Vivi Energia", "https://www.vivienergia.it/"),
    ("wekiwi", "Wekiwi", "https://www.wekiwi.it/"),
    ("sinergy", "Sinergy", "https://www.sinergylucegas.com/"),
]


class CandidateParser(HTMLParser):
    def __init__(self, base_url: str, label: str, key: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.label = label.lower()
        self.key = key.lower()
        self.candidates: list[tuple[int, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {k.lower(): (v or "") for k, v in attrs}
        if tag == "link":
            rel = data.get("rel", "").lower()
            href = data.get("href", "")
            if href and ("icon" in rel or "apple" in rel):
                self.add(href, 20, f"link:{rel}")
        if tag == "meta":
            prop = (data.get("property") or data.get("name") or "").lower()
            content = data.get("content", "")
            if content and prop in {"og:image", "twitter:image", "twitter:image:src"}:
                self.add(content, 50, f"meta:{prop}")
        if tag in {"img", "source"}:
            src = data.get("src") or data.get("data-src") or data.get("data-lazy-src") or data.get("srcset", "").split(" ")[0]
            if not src:
                return
            haystack = " ".join([
                src,
                data.get("alt", ""),
                data.get("class", ""),
                data.get("id", ""),
                data.get("title", ""),
                data.get("aria-label", ""),
            ]).lower()
            score = 0
            if "logo" in haystack:
                score += 180
            if self.key in haystack:
                score += 60
            for token in re.split(r"[^a-z0-9]+", self.label):
                if token and len(token) >= 3 and token in haystack:
                    score += 35
            if "header" in haystack or "nav" in haystack or "brand" in haystack:
                score += 20
            if src.lower().endswith(".svg"):
                score += 30
            if src.lower().endswith((".png", ".webp")):
                score += 15
            if score:
                self.add(src, score, f"{tag}:scored")

    def add(self, url: str, score: int, reason: str) -> None:
        absolute = urllib.parse.urljoin(self.base_url, url)
        if absolute.startswith("data:"):
            return
        self.candidates.append((score, absolute, reason))


def fetch(url: str, *, timeout: int = 15) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 OffertaLogica logo registry (+https://offertalogica.it)",
            "Accept": "text/html,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
        return response.read(4_000_000), content_type


def extension_for(url: str, content_type: str, body: bytes) -> str:
    lower_path = urllib.parse.urlparse(url).path.lower()
    suffix = Path(lower_path).suffix
    if suffix in {".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    if content_type == "image/svg+xml" or body.lstrip().startswith(b"<svg"):
        return ".svg"
    guessed = mimetypes.guess_extension(content_type) or ".png"
    if guessed == ".jpe":
        guessed = ".jpg"
    return guessed


def valid_image(body: bytes, content_type: str) -> bool:
    head = body[:128].lstrip()
    return (
        content_type.startswith("image/")
        or head.startswith(b"<svg")
        or body.startswith(b"\x89PNG")
        or body.startswith(b"\xff\xd8")
        or body.startswith(b"RIFF")
        or body.startswith(b"\x00\x00\x01\x00")
    )


def existing_logo_path(entry: dict) -> Path | None:
    logo = entry.get("logo")
    if not logo or not isinstance(logo, str):
        return None
    if not logo.startswith("/assets/providers/"):
        return None
    return ROOT / "public" / logo.lstrip("/")


def load_registry() -> dict:
    if DATA_JSON.exists():
        return json.loads(DATA_JSON.read_text(encoding="utf-8"))
    return {
        "versioneDati": "provider-brand-2026-07-06-v2",
        "fonte": "Registro brand OffertaLogica.",
        "aggiornatoIl": "2026-07-06",
        "providers": {},
    }


def discover_and_download(key: str, label: str, homepage: str) -> dict:
    try:
        html_bytes, _ = fetch(homepage)
        html = html_bytes.decode("utf-8", errors="ignore")
    except Exception as exc:
        return {"ok": False, "error": f"homepage: {exc}"}

    parser = CandidateParser(homepage, label, key)
    parser.feed(html)

    # Favicons are last-resort candidates.
    parsed = urllib.parse.urlparse(homepage)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    parser.add(f"{origin}/favicon.ico", 5, "fallback:favicon")
    parser.add(f"{origin}/apple-touch-icon.png", 8, "fallback:apple-touch")

    seen: set[str] = set()
    candidates = []
    for score, url, reason in sorted(parser.candidates, reverse=True):
        clean = url.split("#")[0]
        if clean in seen:
            continue
        seen.add(clean)
        candidates.append((score, clean, reason))

    for score, url, reason in candidates[:12]:
        try:
            time.sleep(0.15)
            body, content_type = fetch(url)
        except Exception:
            continue
        if not valid_image(body, content_type):
            continue
        ext = extension_for(url, content_type, body)
        out = ASSET_DIR / f"{key}{ext}"
        out.write_bytes(body)
        return {
            "ok": True,
            "logo": f"/assets/providers/{out.name}",
            "source": url,
            "reason": reason,
            "score": score,
            "contentType": content_type,
            "bytes": len(body),
        }
    return {"ok": False, "error": "nessuna immagine valida trovata", "candidates": candidates[:5]}


def main() -> int:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    registry = load_registry()
    registry["versioneDati"] = "provider-brand-2026-07-06-v2"
    registry["aggiornatoIl"] = "2026-07-06"
    registry["fonte"] = (
        "Registro brand OffertaLogica. I marchi sono usati solo per identificare offerte e fornitori confrontati; "
        "preferire asset ufficiali o di affiliazione quando disponibili."
    )
    providers = registry.setdefault("providers", {})
    report = []

    for key, label, homepage in PROVIDERS:
        current = providers.get(key, {})
        path = existing_logo_path(current)
        if path and path.exists() and path.stat().st_size > 0:
            providers[key] = {
                "label": current.get("label") or label,
                "logo": current.get("logo"),
                "source": current.get("source") or homepage,
                "usageStatus": current.get("usageStatus") or "asset_esistente",
            }
            report.append({"key": key, "label": label, "status": "kept", "logo": current.get("logo")})
            continue

        result = discover_and_download(key, label, homepage)
        if result.get("ok"):
            providers[key] = {
                "label": label,
                "logo": result["logo"],
                "source": result["source"],
                "usageStatus": "asset_pubblico_recuperato_da_sito_fornitore",
            }
            report.append({"key": key, "label": label, "status": "downloaded", **result})
        else:
            providers[key] = {
                "label": label,
                "logo": None,
                "source": homepage,
                "usageStatus": "logo_non_recuperato_fallback_riquadro",
            }
            report.append({"key": key, "label": label, "status": "missing", **result})

    ordered = {key: providers[key] for key, *_ in PROVIDERS}
    registry["providers"] = ordered
    DATA_JSON.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PUBLIC_DATA_JSON.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_JSON.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_path = ROOT / "data" / "provider-logo-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    downloaded = [item for item in report if item["status"] == "downloaded"]
    missing = [item for item in report if item["status"] == "missing"]
    kept = [item for item in report if item["status"] == "kept"]
    print(json.dumps({
        "ok": True,
        "kept": len(kept),
        "downloaded": len(downloaded),
        "missing": len(missing),
        "report": str(report_path.relative_to(ROOT)),
        "missingKeys": [item["key"] for item in missing],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
