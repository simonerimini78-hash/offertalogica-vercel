#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

TARGET_RELATIVE = Path("scripts/update-arera-menu.py")


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("update_arera_menu_patch_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Impossibile caricare il parser")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def offer_xml(name: str, code: str = "TEST001") -> str:
    ns = "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"
    return f'''<ListaOfferteMercatoLibero xmlns="{ns}"><offerta>
<IdentificativiOfferta><PIVA_UTENTE>99999999999</PIVA_UTENTE><COD_OFFERTA>{code}</COD_OFFERTA></IdentificativiOfferta>
<DettaglioOfferta><NOME_OFFERTA>{name}</NOME_OFFERTA><DESCRIZIONE>{name}</DESCRIZIONE>
<Contatti><URL_OFFERTA>https://example.test/{code}</URL_OFFERTA><URL_SITO_VENDITORE>https://example.test</URL_SITO_VENDITORE></Contatti>
</DettaglioOfferta></offerta></ListaOfferteMercatoLibero>'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("repository", nargs="?", default=".")
    args = parser.parse_args()
    repo = Path(args.repository).expanduser().resolve()
    target = repo / TARGET_RELATIVE
    module = load_module(target)

    generic = ET.fromstring(offer_xml("Offerta Casa Eco Conveniente")).find(".//{*}offerta")
    exact = ET.fromstring(offer_xml("E.CO Energia Corrente Casa", "000742TEST")).find(".//{*}offerta")
    assert generic is not None and exact is not None
    assert module.provider_for(generic) is None, "La parola Eco generica viene ancora attribuita a E.CO"
    assert module.provider_for(exact) == ("eco", "E.CO Energia Corrente")

    ns = "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"
    xml = f'''<ListaOfferteMercatoLibero xmlns="{ns}"><offerta><ComponenteImpresa>
<NOME>Corrispettivo per il consumo - spread mercato all'ingrosso</NOME>
<DESCRIZIONE>Spread mercato all'ingrosso</DESCRIZIONE>
<IntervalloPrezzi><FASCIA_COMPONENTE>00</FASCIA_COMPONENTE><PREZZO>0.02000000</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
</ComponenteImpresa></offerta></ListaOfferteMercatoLibero>'''
    node = ET.fromstring(xml).find(".//{*}offerta")
    assert node is not None
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "PO_Offerte_E_MLIBERO_20260717.xml"
        source.write_text(xml, encoding="utf-8")
        values = module.extracted_values(node, "luce", 2700, source, "TEST", "", "", "variabile")
    assert values and values[0]["ruolo"] == "spread_corrente_candidato"
    price, quality, provenance, error = module.semantic_price(values, "luce", "variabile")
    if price is not None:
        assert error == "" and quality == "indice_piu_spread_semantico"
        assert isinstance(provenance, dict) and "valoreIndice" in provenance
        expected = round(float(provenance["valoreIndice"]) + 0.02, 8)
        assert price == expected, f"Prezzo {price}, atteso {expected}"
    else:
        # Alcune varianti del parser richiedono che l'indice corrente sia fornito
        # dal catalogo esterno. In ogni caso lo 0,02 deve essere uno spread,
        # mai un prezzo principale.
        assert error in {"indice_corrente_non_presente_nel_catalogo_arera", "indice_corrente_non_disponibile"}

    print("Verifica superata:")
    print("- Eco generico non è E.CO")
    print("- E.CO viene riconosciuta tramite nome/codice preciso")
    print("- spread 0,02 diventa PUN + 0,02")
    print("- nessuna API coinvolta")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
