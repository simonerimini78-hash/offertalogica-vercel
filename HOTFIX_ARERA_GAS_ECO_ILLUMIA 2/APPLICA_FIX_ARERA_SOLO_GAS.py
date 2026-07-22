#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


PARSER_PATH = Path("scripts/update-arera-menu.py")
INDEX_PATH = Path("public/index.html")
WORKFLOW_PATH = Path(".github/workflows/update-arera-menu.yml")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: atteso 1 blocco, trovati {count}")
    return text.replace(old, new, 1)


def function_slice(text: str, name: str) -> tuple[int, int, str]:
    match = re.search(rf"(?m)^def {re.escape(name)}\(", text)
    if not match:
        raise RuntimeError(f"Funzione Python non trovata: {name}")
    next_match = re.search(r"(?m)^def [A-Za-z_]\w*\(", text[match.end():])
    end = match.end() + next_match.start() if next_match else len(text)
    return match.start(), end, text[match.start():end]


def js_function_slice(text: str, name: str) -> tuple[int, int, str]:
    match = re.search(rf"(?m)^function {re.escape(name)}\(", text)
    if not match:
        raise RuntimeError(f"Funzione JavaScript non trovata: {name}")
    next_match = re.search(r"(?m)^function [A-Za-z_$]\w*\(", text[match.end():])
    end = match.end() + next_match.start() if next_match else len(text)
    return match.start(), end, text[match.start():end]


def patch_parser(text: str) -> str:
    if "def is_single_commodity_offer(" not in text:
        anchor = '''def unit_for_commodity(commodity: str) -> str:
    return "03" if commodity == "luce" else "04"


'''
        helper = '''def unit_for_commodity(commodity: str) -> str:
    return "03" if commodity == "luce" else "04"


def is_single_commodity_offer(code: str, offerta_singola: str) -> bool:
    """Accetta nel catalogo E/G solo offerte realmente sottoscrivibili singolarmente."""
    if str(offerta_singola or "").strip().upper() == "NO":
        return False
    return re.match(r"^\\d{6}DS", str(code or ""), re.I) is None


def formula_from_values(
    values: list[dict[str, object]], commodity: str, tipo: str
) -> tuple[dict[str, object] | None, dict[str, object] | None]:
    """Conserva indice e spread separati; prezzo resta solo una stima di ranking."""
    if tipo != "variabile":
        return None, None
    candidates = [item for item in values if item.get("ruolo") == "spread_corrente_candidato"]
    unique = sorted({round(float(item["valore"]), 8) for item in candidates})
    if len(unique) != 1:
        return None, None
    spread = unique[0]
    selected = next(item for item in candidates if round(float(item["valore"]), 8) == spread)
    formula = {
        "tipo": "indice_spread",
        "indice": "pun" if commodity == "luce" else "psv",
        "spread": spread,
    }
    return formula, selected


def reference_index_for(commodity: str) -> float:
    if commodity == "luce":
        return float(globals().get("PUN_FALLBACK", 0.119351258))
    return float(globals().get("PSV_FALLBACK", 0.504419055))


'''
        text = replace_once(text, anchor, helper, "helper offerte singole/formula")

    start, end, function = function_slice(text, "parse_offer_file")
    if "componente_dual_esclusa_dal_catalogo_singolo" not in function:
        code_match = re.search(
            r'(?m)^(?P<indent>\s*)code = node_text\(offer, "po:IdentificativiOfferta/po:COD_OFFERTA"\)\s*$',
            function,
        )
        provider_match = re.search(r'(?m)^\s*provider_key, provider_label = match\s*$', function)
        name_match = re.search(r'(?m)^\s*nome = node_text\(offer, "po:DettaglioOfferta/po:NOME_OFFERTA"\)\s*$', function)
        if not code_match or not provider_match or not name_match:
            raise RuntimeError("parse_offer_file: codice/provider/nome non trovati")
        indent = code_match.group("indent")
        insert = f'''
{indent}offerta_singola = node_text(offer, "po:DettaglioOfferta/po:OFFERTA_SINGOLA").upper()
{indent}if not is_single_commodity_offer(code, offerta_singola):
{indent}    diagnostics.append(
{indent}        {{
{indent}            "codiceOfferta": code,
{indent}            "fornitore": provider_label,
{indent}            "nome": nome,
{indent}            "commodity": commodity,
{indent}            "stato": "scartato",
{indent}            "motivo": "componente_dual_esclusa_dal_catalogo_singolo",
{indent}            "sorgente": source_label_for(path),
{indent}            "conservaPrecedente": False,
{indent}        }}
{indent}    )
{indent}    continue'''
        pos = max(code_match.end(), provider_match.end(), name_match.end())
        function = function[:pos] + insert + function[pos:]

    if "formula = formula_from_provenance" not in function:
        override_pos = function.find("        if override_price is not None:")
        customer_pos = function.find("        if customer_type ==", override_pos)
        if override_pos < 0 or customer_pos < 0:
            raise RuntimeError("parse_offer_file: blocco override/customer non trovato")
        formula_block = '''        formula = None
        if override_price is None:
            formula, formula_source = formula_from_values(values, commodity, tipo)
            if formula is not None:
                index_value = reference_index_for(commodity)
                price = round(index_value + float(formula["spread"]), 8)
                quality = "indice_piu_spread_semantico"
                price_error = ""
                if price_provenance is None:
                    price_provenance = copy.deepcopy(formula_source)
                    price_provenance["ruolo"] = "spread_corrente_selezionato"
                price_provenance["indiceApplicato"] = "PUN" if commodity == "luce" else "PSV"
                price_provenance["valoreIndice"] = index_value

'''
        function = function[:customer_pos] + formula_block + function[customer_pos:]

    if '"offertaSingola": offerta_singola or None' not in function:
        field = re.search(r'(?m)^(?P<indent>\s*)"durataMesi": duration,\s*$', function)
        if not field:
            raise RuntimeError("parse_offer_file: campo durataMesi non trovato")
        indent = field.group("indent")
        replacement = (
            field.group(0)
            + f'\n{indent}"offertaSingola": offerta_singola or None,'
            + f'\n{indent}"formula": formula,'
        )
        function = function[:field.start()] + replacement + function[field.end():]

    text = text[:start] + function + text[end:]

    validation_name = "validate_and_merge" if re.search(r"(?m)^def validate_and_merge\(", text) else "validate_staging_catalog"
    start, end, function = function_slice(text, validation_name)
    if validation_name == "validate_and_merge" and 'diagnostic.get("conservaPrecedente") is False' not in function:
        marker = '''    for diagnostic in diagnostics:
        key = (str(diagnostic.get("codiceOfferta") or ""), str(diagnostic.get("commodity") or ""))
'''
        replacement = '''    for diagnostic in diagnostics:
        if diagnostic.get("conservaPrecedente") is False:
            continue
        key = (str(diagnostic.get("codiceOfferta") or ""), str(diagnostic.get("commodity") or ""))
'''
        function = replace_once(function, marker, replacement, "fallback diagnostici")

    after_dedupe = function.split("rows = dedupe_rows", 1)[-1]
    if "is_single_commodity_offer(" not in after_dedupe:
        marker = (
            "    rows = dedupe_rows(list(final_by_key.values()))\n"
            if validation_name == "validate_and_merge"
            else "    rows = dedupe_rows(valid_rows)\n"
        )
        replacement = marker + '''    rows = [
        row
        for row in rows
        if is_single_commodity_offer(
            str(row.get("codice") or ""),
            str(row.get("offertaSingola") or ""),
        )
    ]
'''
        function = replace_once(function, marker, replacement, "filtro finale componenti dual")
    text = text[:start] + function + text[end:]
    return text


def patch_index(text: str) -> str:
    start, end, function = js_function_slice(text, "normalizzaRigaAreraMenu")
    if "offertaSingola:" not in function or "formula," not in function:
        declaration_marker = '  const quotaFissaAnnua = numeroSicuro(riga.quotaFissaAnnua, NaN);\n'
        declaration = declaration_marker + '''  const formula = riga.formula && typeof riga.formula === "object" && riga.formula.tipo === "indice_spread"
    ? {
        tipo: "indice_spread",
        indice: String(riga.formula.indice || "").toLowerCase(),
        spread: numeroSicuro(riga.formula.spread, 0),
      }
    : null;
'''
        function = replace_once(function, declaration_marker, declaration, "formula ARERA normalizzata")
        field_marker = '    dataFine: riga.dataFine || "",\n'
        fields = field_marker + '''    offertaSingola: String(riga.offertaSingola || "").toUpperCase(),
    formula,
'''
        function = replace_once(function, field_marker, fields, "campi formula/offerta singola")
    text = text[:start] + function + text[end:]

    start, end, function = js_function_slice(text, "motiviEsclusioneArera")
    if "componente dual non singola" not in function:
        marker = "  const motivi = [];\n"
        replacement = '''  const motivi = [];
  const codice = String(riga.codice || "");
  const offertaSingola = String(riga.offertaSingola || "").toUpperCase();
  if (offertaSingola === "NO" || /^\\d{6}DS/i.test(codice)) {
    motivi.push("componente dual non singola");
  }
'''
        function = replace_once(function, marker, replacement, "filtro frontend DS/OFFERTA_SINGOLA")
    text = text[:start] + function + text[end:]

    start, end, function = js_function_slice(text, "costoRigaAreraSuProfilo")
    if "formula: riga.formula" not in function:
        marker = "    prezzoVariabile: riga.prezzo,\n"
        replacement = '''    prezzoVariabile: riga.formula ? 0 : riga.prezzo,
    formula: riga.formula || undefined,
'''
        function = replace_once(function, marker, replacement, "formula nel costo ARERA")
    text = text[:start] + function + text[end:]

    start, end, function = js_function_slice(text, "voceDaRigaArera")
    if "formula: riga.formula" not in function:
        marker = '''    prezzoVariabile: riga.prezzo,
    quotaFissaAnnua: riga.quotaFissaAnnua,
'''
        replacement = '''    prezzoVariabile: riga.formula ? 0 : riga.prezzo,
    formula: riga.formula || undefined,
    quotaFissaAnnua: riga.quotaFissaAnnua,
'''
        function = replace_once(function, marker, replacement, "formula nella voce ARERA")
    text = text[:start] + function + text[end:]

    start, end, function = js_function_slice(text, "applicaOffertaAlBloccoNuovo")
    if "formulaDettaglio" not in function:
        duration_marker = "  const durata = durataOffertaTesto(offerta);\n"
        duration_replacement = duration_marker + '''  const formulaDettaglio = [
    offerta.luce?.formula ? `Luce ${prezzoOffertaTesto(offerta.luce, "luce")}` : "",
    offerta.gas?.formula ? `Gas ${prezzoOffertaTesto(offerta.gas, "gas")}` : "",
  ].filter(Boolean).join("; ");
'''
        function = replace_once(function, duration_marker, duration_replacement, "dettaglio formula nel suggerimento")
        old_fragment = '${tipo}${durata ? `, ${durata}` : ""}'
        new_fragment = '${tipo}${formulaDettaglio ? ` (${formulaDettaglio})` : ""}${durata ? `, ${durata}` : ""}'
        function = replace_once(function, old_fragment, new_fragment, "testo formula nel suggerimento")
    text = text[:start] + function + text[end:]
    return text


def patch_workflow(text: str) -> str:
    if "data/arera-update-report.json" in text:
        return text
    old = "          git add data/offerte-arera-menu.json public/data/offerte-arera-menu.json\n"
    new = '''          git add \\
            data/offerte-arera-menu.json \\
            public/data/offerte-arera-menu.json \\
            data/arera-update-report.json
'''
    return replace_once(text, old, new, "workflow report")


def validate_files(repo: Path) -> None:
    subprocess.run([sys.executable, "-m", "py_compile", str(repo / PARSER_PATH)], cwd=repo, check=True)
    node = shutil.which("node")
    if node:
        html = (repo / INDEX_PATH).read_text(encoding="utf-8")
        names = [
            "normalizzaRigaAreraMenu",
            "motiviEsclusioneArera",
            "costoRigaAreraSuProfilo",
            "voceDaRigaArera",
            "applicaOffertaAlBloccoNuovo",
        ]
        for index, name in enumerate(names, start=1):
            _, _, block = js_function_slice(html, name)
            temp = repo / f".arera-solo-gas-function-check-{index}.js"
            try:
                temp.write_text(block, encoding="utf-8")
                subprocess.run([node, "--check", str(temp)], cwd=repo, check=True)
            finally:
                temp.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Corregge il catalogo ARERA solo gas E.CO/Illumia.")
    parser.add_argument("repo", type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    targets = [repo / PARSER_PATH, repo / INDEX_PATH]
    if (repo / WORKFLOW_PATH).exists():
        targets.append(repo / WORKFLOW_PATH)
    for target in targets:
        if not target.exists():
            raise SystemExit(f"File mancante: {target}")

    backups: list[tuple[Path, Path]] = []
    try:
        for target in targets:
            backup = target.with_suffix(target.suffix + ".bak-arera-solo-gas")
            shutil.copy2(target, backup)
            backups.append((target, backup))

        parser_path = repo / PARSER_PATH
        parser_path.write_text(patch_parser(parser_path.read_text(encoding="utf-8")), encoding="utf-8")

        index_path = repo / INDEX_PATH
        index_path.write_text(patch_index(index_path.read_text(encoding="utf-8")), encoding="utf-8")

        workflow_path = repo / WORKFLOW_PATH
        if workflow_path.exists():
            workflow_path.write_text(patch_workflow(workflow_path.read_text(encoding="utf-8")), encoding="utf-8")

        validate_files(repo)
    except Exception:
        for target, backup in reversed(backups):
            if backup.exists():
                shutil.copy2(backup, target)
        raise

    print("Correzione applicata e sintassi verificata.")
    for target in targets:
        print(f"- {target.relative_to(repo)}")
    print("I backup .bak-arera-solo-gas sono locali e non vanno committati.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
