#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


PACKAGE_DIR = Path(__file__).resolve().parent
DEFAULT_FIXTURE = PACKAGE_DIR / "PO_Offerte_G_MLIBERO_20260717_fixture.xml"


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("offertalogica_update_arera_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Impossibile importare {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verifica il fix ARERA solo gas E.CO/Illumia.")
    parser.add_argument("repo", type=Path)
    parser.add_argument("--gas-xml", type=Path, default=DEFAULT_FIXTURE)
    args = parser.parse_args()

    repo = args.repo.resolve()
    script = repo / "scripts" / "update-arera-menu.py"
    index = repo / "public" / "index.html"
    workflow = repo / ".github" / "workflows" / "update-arera-menu.yml"
    gas_xml = args.gas_xml.resolve()

    require(script.exists(), f"Parser mancante: {script}")
    require(index.exists(), f"Frontend mancante: {index}")
    require(gas_xml.exists(), f"XML di test mancante: {gas_xml}")

    subprocess.run([sys.executable, "-m", "py_compile", str(script)], cwd=repo, check=True)
    module = load_module(script)
    overrides = module.load_verified_overrides(repo) if hasattr(module, "load_verified_overrides") else {}
    diagnostics: list[dict[str, object]] = []
    rows = module.parse_offer_file(gas_xml, "gas", datetime(2026, 7, 17), overrides, diagnostics)

    by_code = {str(row.get("codice") or ""): row for row in rows}

    dual_code = "000155DSFML04XXZZZZ05102Z260711G"
    require(dual_code not in by_code, "Illumia Energia Lunghissima Gas DS è ancora proposta come solo gas")
    require(not any(re.match(r"^\d{6}DS", code, re.I) for code in by_code), "Sono presenti codici DS nel catalogo singolo")
    require(not any(str(row.get("offertaSingola") or "").upper() == "NO" for row in rows), "Sono presenti OFFERTE_SINGOLE=NO")

    eco_code = "000742GSVML01XXZEROPREM260930D01"
    eco = by_code.get(eco_code)
    require(eco is not None, "Offerta E.CO Zero Premium non estratta")
    require(eco.get("providerKey") == "eco", "E.CO non riconosciuta come provider eco")
    require(eco.get("customerType") == "privato", "E.CO domestica non classificata privato")
    require(eco.get("formula") == {"tipo": "indice_spread", "indice": "psv", "spread": 0.0}, "Formula E.CO diversa da PSV + 0")
    require(float(eco.get("quotaFissaAnnua") or -1) == 204.0, "Quota fissa E.CO Zero Premium diversa da 204 €/anno")

    illum_code = "000155GSVML29XXZZZZ03130Z260711G"
    illum = by_code.get(illum_code)
    require(illum is not None, "Illumia Sicurinsieme Gas non estratta")
    require(illum.get("providerKey") == "illum", "Illumia non riconosciuta come provider illum")
    require(illum.get("customerType") == "privato", "Illumia Sicurinsieme non classificata privato")
    require(illum.get("formula") == {"tipo": "indice_spread", "indice": "psv", "spread": 0.05}, "Formula Illumia diversa da PSV + 0,05")
    require(float(illum.get("quotaFissaAnnua") or -1) == 120.0, "Quota fissa Illumia Sicurinsieme diversa da 120 €/anno")

    eco_business = by_code.get("000742GSFML01XXRELREFIX260731B01")
    require(eco_business is not None and eco_business.get("customerType") == "business", "E.CO BUS non separata come business")

    html = index.read_text(encoding="utf-8")
    for token in (
        "componente dual non singola",
        "offertaSingola:",
        "formula: riga.formula || undefined",
        "formulaDettaglio",
    ):
        require(token in html, f"Frontend privo della protezione: {token}")

    if workflow.exists():
        workflow_text = workflow.read_text(encoding="utf-8")
        require("data/arera-update-report.json" in workflow_text, "Il workflow non committa il report ARERA")

    data_json = repo / "data" / "offerte-arera-menu.json"
    public_json = repo / "public" / "data" / "offerte-arera-menu.json"
    if data_json.exists() and public_json.exists():
        data_payload = json.loads(data_json.read_text(encoding="utf-8"))
        public_payload = json.loads(public_json.read_text(encoding="utf-8"))
        require(data_payload == public_payload, "I due cataloghi ARERA non sono identici")

    print("Verifica superata sui dati ARERA reali del 17/07/2026:")
    print("- Illumia DS/OFFERTA_SINGOLA=NO esclusa dal solo gas")
    print("- E.CO Zero Premium conservata come PSV + 0,0000 €/Smc; quota 204 €/anno")
    print("- Illumia Sicurinsieme conservata come PSV + 0,0500 €/Smc; quota 120 €/anno")
    print("- E.CO BUS separata dal catalogo domestico")
    print("- formula preservata fino al frontend")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
