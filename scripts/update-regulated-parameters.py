#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

USER_AGENT = "OffertaLogica/1.0 (+https://offertalogica.it/)"

ARERA_EE_NETWORK_URL = (
    "https://www.arera.it/area-operatori/prezzi-e-tariffe/"
    "tariffe-trasmissione-distribuzione-e-misura-clienti-domestici"
)
ARERA_EE_CONSUMER_URL = "https://www.arera.it/consumatori/valori-rete-oneri-domestici-ee"
ARERA_GAS_CONSUMER_URL = "https://www.arera.it/consumatori/valori-rete-oneri-domestici-gas"
ADM_EXCISE_URL = "https://www.adm.gov.it/portale/aliquote-accisa-nazionali"

STATE_FILE = ".arera-download/regulatory-source-state.json"


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = re.sub(r"\s+", " ", data).strip()
        if value:
            self.parts.append(value)


def html_to_text(page_html: str) -> str:
    parser = TextExtractor()
    parser.feed(page_html)
    return re.sub(r"\s+", " ", html.unescape(" ".join(parser.parts))).strip()


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.current_href: str | None = None
        self.current_text: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self.current_href = href
            self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self.current_href is not None:
            text = re.sub(r"\s+", " ", " ".join(self.current_text)).strip()
            self.links.append((self.current_href, text))
            self.current_href = None
            self.current_text = []


def fetch_bytes(url: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "it-IT,it;q=0.9",
            "Cache-Control": "no-cache",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
        headers = {key.lower(): value for key, value in response.headers.items()}
    return body, headers


def fetch_text(url: str) -> str:
    body, _ = fetch_bytes(url)
    return body.decode("utf-8", errors="replace")


def parse_it_number(value: str) -> float:
    normalized = value.strip().replace(" ", "")
    if "," in normalized:
        normalized = normalized.replace(".", "").replace(",", ".")
    return float(normalized)


def parse_electricity_network_tariffs(page_html: str, year: int) -> dict[str, float]:
    text = html_to_text(page_html)
    # Riga ARERA: anno | s1 totale | s1 di cui misura | s2 | s3.
    pattern = re.compile(
        rf"\b{year}\b\s+"
        r"([0-9.]+,[0-9]+)\s+"
        r"([0-9.]+,[0-9]+)\s+"
        r"([0-9.]+,[0-9]+)\s+"
        r"([0-9.]+,[0-9]+)",
        flags=re.I,
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError(f"Tariffe rete elettrica ARERA {year} non riconosciute")

    s1_cent = parse_it_number(match.group(1))
    mis_cent = parse_it_number(match.group(2))
    s2_cent = parse_it_number(match.group(3))
    s3_cent = parse_it_number(match.group(4))

    result = {
        "s1EurPodAnno": round(s1_cent / 100.0, 8),
        "misEurPodAnno": round(mis_cent / 100.0, 8),
        "s2EurKwAnno": round(s2_cent / 100.0, 8),
        "s3EurKwh": round(s3_cent / 100.0, 8),
    }
    if not 5 <= result["s1EurPodAnno"] <= 100:
        raise RuntimeError(f"s1 ARERA fuori intervallo plausibile: {result['s1EurPodAnno']}")
    if not 1 <= result["misEurPodAnno"] <= 100:
        raise RuntimeError(f"misura ARERA fuori intervallo plausibile: {result['misEurPodAnno']}")
    if not 1 <= result["s2EurKwAnno"] <= 100:
        raise RuntimeError(f"s2 ARERA fuori intervallo plausibile: {result['s2EurKwAnno']}")
    if not 0.001 <= result["s3EurKwh"] <= 0.1:
        raise RuntimeError(f"s3 ARERA fuori intervallo plausibile: {result['s3EurKwh']}")
    return result


def discover_xlsx_url(page_html: str, page_url: str, commodity: str) -> str:
    if commodity not in {"elettrico", "gas"}:
        raise ValueError("commodity non supportata")
    pattern = re.compile(
        rf'href=["\']([^"\']*Corrispettivi_libero_{commodity}_domestico_20\d{{2}}\.xlsx(?:\?[^"\']*)?)["\']',
        flags=re.I,
    )
    candidates = pattern.findall(page_html)
    if not candidates:
        raise RuntimeError(f"File XLSX ARERA domestico {commodity} non trovato")
    urls = [urllib.parse.urljoin(page_url, html.unescape(item)) for item in candidates]
    return sorted(urls)[-1]


def discover_adm_current_pdf(page_html: str, page_url: str) -> tuple[str, str]:
    # Seleziona il link il cui testo parla esplicitamente delle aliquote nazionali correnti,
    # evitando di prendere PDF di navigazione o documenti non fiscali presenti nella pagina.
    parser = LinkExtractor()
    parser.feed(page_html)
    candidates: list[tuple[str, str]] = []
    for href, anchor_text in parser.links:
        normalized = re.sub(r"\s+", " ", anchor_text).strip()
        if re.search(r"aliquote(?:\s+accisa)?\s+nazionali", normalized, flags=re.I) and re.search(
            r"aggiornamento", normalized, flags=re.I
        ):
            candidates.append((href, normalized))

    if candidates:
        href, label = candidates[0]
        update_match = re.search(
            r"Aggiornamento\s+(?:al\s+)?(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+20\d{2})",
            label,
            flags=re.I,
        )
        if not update_match:
            raise RuntimeError("Data pubblicazione aliquote ADM non riconosciuta nel link corrente")
        return urllib.parse.urljoin(page_url, html.unescape(href)), update_match.group(1)

    text = html_to_text(page_html)
    update_match = re.search(
        r"Aggiornamento\s+(?:al\s+)?(\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+20\d{2})",
        text,
        flags=re.I,
    )
    if not update_match:
        raise RuntimeError("Data pubblicazione aliquote ADM non riconosciuta")
    # Fallback: alcune versioni ADM non espongono il PDF come anchor HTML.
    return page_url, update_match.group(1)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "sources": {}}
    payload = load_json(path)
    if not isinstance(payload.get("sources"), dict):
        raise RuntimeError("Stato fonti regolatorie non valido")
    return payload


def guarded_source(
    state: dict[str, Any],
    source_id: str,
    url: str,
    body: bytes,
    *,
    label: str,
    accept_changed: bool,
) -> str:
    digest = sha256_bytes(body)
    sources = state.setdefault("sources", {})
    previous = sources.get(source_id) if isinstance(sources, dict) else None
    previous_hash = str((previous or {}).get("sha256") or "")

    if previous_hash and previous_hash != digest and not accept_changed:
        raise RuntimeError(
            f"Fonte regolatoria cambiata: {label}. "
            "Aggiornamento economico bloccato: verificare il nuovo documento e poi eseguire "
            "con --accept-changed solo dopo l'adeguamento del parser/valori."
        )

    sources[source_id] = {
        "label": label,
        "url": url,
        "sha256": digest,
        "policy": "blocco_su_cambio_non_parsato",
    }
    return "baseline" if not previous_hash else ("changed_accepted" if previous_hash != digest else "unchanged")


def update_network_values(params: dict[str, Any], values: dict[str, float], year: int) -> bool:
    calculation = params.get("parametriCalcolo")
    if not isinstance(calculation, dict):
        raise RuntimeError("parametriCalcolo mancante")
    regulated = calculation.get("componentiRegolate")
    meta = calculation.get("componentiRegolateMeta")
    if not isinstance(regulated, dict) or not isinstance(meta, dict):
        raise RuntimeError("componenti regolate/meta mancanti")
    luce = regulated.get("luce")
    if not isinstance(luce, dict):
        raise RuntimeError("componentiRegolate.luce mancante")

    period_year = int(str(meta.get("periodoRete") or "0")[:4] or 0)
    if period_year != year:
        raise RuntimeError(
            f"La fonte rete ARERA espone {year}, ma il dataset OL dichiara periodoRete={meta.get('periodoRete')}. "
            "Blocco per evitare di mescolare rete e oneri di periodi diversi."
        )

    current_meta = meta.get(f"valoriLuce{year}")
    if not isinstance(current_meta, dict):
        raise RuntimeError(f"Metadati valoriLuce{year} mancanti")

    asos = float(current_meta.get("asosEurKwh") or 0)
    arim = float(current_meta.get("arimEurKwh") or 0)
    uc3 = float(current_meta.get("uc3EurKwh") or 0)
    uc6_energy = float(current_meta.get("uc6EurKwh") or 0)
    uc6_power = float(current_meta.get("uc6EurKwAnno") or 0)
    if not all(x >= 0 for x in (asos, arim, uc3, uc6_energy, uc6_power)):
        raise RuntimeError("Oneri luce correnti non validi")

    updates = {
        "s1EurPodAnno": values["s1EurPodAnno"],
        "s2EurKwAnno": values["s2EurKwAnno"],
        "s3EurKwh": values["s3EurKwh"],
        "variabileComuneApplicataEurKwh": round(values["s3EurKwh"] + asos + arim + uc3 + uc6_energy, 8),
        "potenzaComuneApplicataEurKwAnno": round(values["s2EurKwAnno"] + uc6_power, 8),
    }
    changed = any(float(current_meta.get(k, -999999)) != float(v) for k, v in updates.items())
    current_meta.update(updates)
    luce["fissaAnnua"] = updates["s1EurPodAnno"]
    luce["potenzaEurKwAnno"] = updates["potenzaComuneApplicataEurKwAnno"]
    luce["variabileEurUnita"] = updates["variabileComuneApplicataEurKwh"]
    return changed


def write_params_pair(root: Path, params: dict[str, Any]) -> None:
    body = json.dumps(params, ensure_ascii=False, indent=2) + "\n"
    for relative in ("data/calcolo-parametri.json", "public/data/calcolo-parametri.json"):
        (root / relative).write_text(body, encoding="utf-8")


def run_update(root: Path, *, accept_changed: bool = False) -> dict[str, Any]:
    params_path = root / "data/calcolo-parametri.json"
    params = load_json(params_path)
    state_path = root / STATE_FILE
    state = load_state(state_path)

    meta = ((params.get("parametriCalcolo") or {}).get("componentiRegolateMeta") or {})
    year = int(str(meta.get("periodoRete") or date.today().year)[:4])

    network_html = fetch_text(ARERA_EE_NETWORK_URL)
    network_values = parse_electricity_network_tariffs(network_html, year)
    network_changed = update_network_values(params, network_values, year)

    ee_html = fetch_text(ARERA_EE_CONSUMER_URL)
    ee_xlsx = discover_xlsx_url(ee_html, ARERA_EE_CONSUMER_URL, "elettrico")
    ee_body, _ = fetch_bytes(ee_xlsx)
    ee_state = guarded_source(
        state,
        "arera-ee-domestici-xlsx",
        ee_xlsx,
        ee_body,
        label="ARERA corrispettivi domestici elettricita",
        accept_changed=accept_changed,
    )

    gas_html = fetch_text(ARERA_GAS_CONSUMER_URL)
    gas_xlsx = discover_xlsx_url(gas_html, ARERA_GAS_CONSUMER_URL, "gas")
    gas_body, _ = fetch_bytes(gas_xlsx)
    gas_state = guarded_source(
        state,
        "arera-gas-domestici-xlsx",
        gas_xlsx,
        gas_body,
        label="ARERA corrispettivi domestici gas",
        accept_changed=accept_changed,
    )

    adm_html = fetch_text(ADM_EXCISE_URL)
    adm_pdf_url, adm_label = discover_adm_current_pdf(adm_html, ADM_EXCISE_URL)
    if adm_pdf_url != ADM_EXCISE_URL:
        adm_body, _ = fetch_bytes(adm_pdf_url)
        adm_state = guarded_source(
            state,
            "adm-accise-correnti",
            adm_pdf_url,
            adm_body,
            label=f"ADM aliquote accisa nazionali ({adm_label})",
            accept_changed=accept_changed,
        )
    else:
        # Fallback: la data ufficiale resta monitorata senza fingerprint PDF.
        adm_state = guarded_source(
            state,
            "adm-accise-correnti",
            ADM_EXCISE_URL,
            adm_label.encode("utf-8"),
            label=f"ADM aliquote accisa nazionali ({adm_label})",
            accept_changed=accept_changed,
        )

    if network_changed:
        params["aggiornatoIl"] = date.today().isoformat()
        write_params_pair(root, params)

    write_json(state_path, state)
    return {
        "networkChanged": network_changed,
        "network": network_values,
        "guarded": {
            "electricity": ee_state,
            "gas": gas_state,
            "excise": adm_state,
        },
        "stateFile": STATE_FILE,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Aggiorna/controlla in modo fail-closed i parametri regolati OffertaLogica."
    )
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--accept-changed",
        action="store_true",
        help="Accetta una nuova impronta per fonti non ancora parsate. Usare solo dopo verifica manuale.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    result = run_update(args.package_root.resolve(), accept_changed=args.accept_changed)
    print(
        "[REGOLATI] OK: "
        f"rete_luce={'aggiornata' if result['networkChanged'] else 'invariata'}, "
        f"guard_ee={result['guarded']['electricity']}, "
        f"guard_gas={result['guarded']['gas']}, "
        f"guard_accise={result['guarded']['excise']}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
