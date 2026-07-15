#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "update-arera-menu.py"
SPEC = importlib.util.spec_from_file_location("update_arera_menu", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

NS = "http://www.acquirenteunico.it/schemas/SII_AU/OffertaRetail/01"


def offer_xml(customer_type: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ListaOfferteMercatoLibero xmlns="{NS}">
  <offerta>
    <IdentificativiOfferta>
      <PIVA_UTENTE>01141160992</PIVA_UTENTE>
      <COD_OFFERTA>000099ESFFL07XXAXPOIXFIX89922607</COD_OFFERTA>
    </IdentificativiOfferta>
    <DettaglioOfferta>
      <TIPO_CLIENTE>{customer_type}</TIPO_CLIENTE>
      <TIPO_OFFERTA>01</TIPO_OFFERTA>
      <NOME_OFFERTA>Scegli Sereno 2.0 36 Mesi Giorno 3Fasce</NOME_OFFERTA>
      <Contatti><URL_OFFERTA>https://www.axpo.com/offerta</URL_OFFERTA></Contatti>
    </DettaglioOfferta>
    <ValiditaOfferta>
      <DATA_INIZIO>09/07/2026_12:00:00</DATA_INIZIO>
      <DATA_FINE>20/07/2026_11:59:59</DATA_FINE>
    </ValiditaOfferta>
    <ComponenteImpresa>
      <NOME>Onere Adeguamento Consumi</NOME>
      <IntervalloPrezzi><FASCIA_COMPONENTE>01</FASCIA_COMPONENTE><CONSUMO_DA>0</CONSUMO_DA><CONSUMO_A>50000</CONSUMO_A><PREZZO>0.00550</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
      <IntervalloPrezzi><FASCIA_COMPONENTE>01</FASCIA_COMPONENTE><PREZZO>0.00000</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
      <IntervalloPrezzi><FASCIA_COMPONENTE>02</FASCIA_COMPONENTE><CONSUMO_DA>0</CONSUMO_DA><CONSUMO_A>50000</CONSUMO_A><PREZZO>0.00550</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
      <IntervalloPrezzi><FASCIA_COMPONENTE>03</FASCIA_COMPONENTE><CONSUMO_DA>0</CONSUMO_DA><CONSUMO_A>50000</CONSUMO_A><PREZZO>0.00550</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
    </ComponenteImpresa>
    <ComponenteImpresa>
      <NOME>Opzione verde</NOME>
      <IntervalloPrezzi><FASCIA_COMPONENTE>01</FASCIA_COMPONENTE><PREZZO>0.00500</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
      <IntervalloPrezzi><FASCIA_COMPONENTE>02</FASCIA_COMPONENTE><PREZZO>0.00500</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
      <IntervalloPrezzi><FASCIA_COMPONENTE>03</FASCIA_COMPONENTE><PREZZO>0.00500</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
    </ComponenteImpresa>
    <ComponenteImpresa>
      <NOME>Prezzo luce</NOME>
      <IntervalloPrezzi><FASCIA_COMPONENTE>01</FASCIA_COMPONENTE><PREZZO>0.12945</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
      <IntervalloPrezzi><FASCIA_COMPONENTE>02</FASCIA_COMPONENTE><PREZZO>0.14031</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
      <IntervalloPrezzi><FASCIA_COMPONENTE>03</FASCIA_COMPONENTE><PREZZO>0.11931</PREZZO><UNITA_MISURA>03</UNITA_MISURA></IntervalloPrezzi>
    </ComponenteImpresa>
    <ComponenteImpresa>
      <NOME>Quota vendita luce</NOME>
      <IntervalloPrezzi><PREZZO>144.00000</PREZZO><UNITA_MISURA>01</UNITA_MISURA></IntervalloPrezzi>
    </ComponenteImpresa>
  </offerta>
</ListaOfferteMercatoLibero>
"""


class UpdateAreraMenuTest(unittest.TestCase):
    def parse(self, customer_type: str):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "offers.xml"
            source.write_text(offer_xml(customer_type), encoding="utf-8")
            return MODULE.parse_offer_file(source, "luce", datetime(2026, 7, 15))

    def test_axpo_components_are_summed_after_band_averaging(self):
        rows = self.parse("01")
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]["prezzo"], 0.14019, places=8)
        self.assertNotAlmostEqual(rows[0]["prezzo"], 0.066595, places=6)

    def test_non_domestic_axpo_offer_is_excluded(self):
        self.assertEqual(self.parse("02"), [])


if __name__ == "__main__":
    unittest.main()
