# Verifica calcolo offerte

Generato: 2026-07-07T18:53:50.393Z
Motore frontend: motore-v6-arera-first-2026-07-03
Parametri: parametri-calcolo-2026-07-03-v4-psv-operativo
Offerte commerciali: offerte-proposte-2026-07-07-v15-affiliazioni-a2a-octopus
ARERA: arera-menu-2026-07-07 (2026-07-07)

**Esito automatico: OK.** Nessun errore bloccante trovato nei profili verificati.

La verifica usa il motore del frontend, non una copia separata: carica `public/index.html`, applica i JSON pubblici e calcola le offerte come farebbe il sito.

## Audit partner attivi

Questa sezione spiega perche un'offerta affiliata attiva viene mostrata oppure esclusa. Il principio e: il funnel partner viene agganciato solo se esiste una proposta ARERA coerente e valida per lo stesso filtro.

| Partner | Offerta commerciale | Filtro | Esito | Motivo | Offerta ARERA agganciata |
| --- | --- | --- | --- | --- | --- |
| E.ON | E.ON Luce e Gas Insieme | fisso / dual | visibile | offerta ARERA valida e agganciata a funnel partner attivo | E.ON - E.ON LuceClickVerde + E.ON Gas Click |
| E.ON | E.ON Luce e Gas Insieme Variabile | variabile / dual | visibile | offerta ARERA valida e agganciata a funnel partner attivo | E.ON - E.ON Luce Drive Smarty + E.ON FlexClick Gas - PROMO |
| A2A | A2A Start Luce e Gas | fisso / dual | visibile | offerta ARERA valida e agganciata a funnel partner attivo | A2A Energia - A2A Click Luce + A2A Click - GAS |
| Octopus Energy | Octopus Luce e Gas Monoraria | fisso / dual | visibile | offerta ARERA valida e agganciata a funnel partner attivo | Octopus Energy - Octopus Fissa 12M + Octopus Fissa 12M Gas |
| Enel | Enel Fix Web Luce e Gas | fisso / dual | non visibile | righe ARERA valide, ma nome/codici non agganciati al funnel partner commerciale | Enel Energia - Enel Night Free + Enel  Flash Gas |
| Eni Plenitude | Eni Plenitude Fixa Time 24 | fisso / dual | visibile | offerta ARERA valida e agganciata a funnel partner attivo | Eni Plenitude - Fixa Time 24 Smart Luce + Fixa Time 24 Smart Gas |
| Alperia | Alperia Smile Easy / Start | fisso / dual | visibile | offerta ARERA valida e agganciata a funnel partner attivo | Alperia - Alperia Smile Easy Summer + Alperia Gas Smile Start |
| Alperia | Alperia Luce e Gas Variabile PUN/PSV | variabile / dual | visibile | offerta ARERA valida e agganciata a funnel partner attivo | Alperia - Alperia Free Welcome + Alperia Gas Home Promo |

## Privato medio - dual fuel - fisso

Offerte generate: 20

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Magis Energia | Magis Energia - MIA LUCE FIX WEB + MIA GAS FIX WEB | 755.11 EUR | 563.11 EUR | 192.00 EUR | 389.89 EUR | da_contattare |
| 2 | Acea Energia | Acea Energia - Acea Energia Fix + Acea Energia Fix | 769.30 EUR | 547.30 EUR | 222.00 EUR | 375.70 EUR | da_contattare |
| 3 | Dolomiti Energia | Dolomiti Energia - DOLOMITI FISSO LUCE 120 + DOLOMITI FISSO GAS 36 WEB | 790.75 EUR | 598.75 EUR | 192.00 EUR | 354.25 EUR | da_contattare |
| 4 | Engie | Engie - Energia PuntoFisso - 12 mesi + Energia PuntoFisso - 12 mesi | 801.37 EUR | 645.37 EUR | 156.00 EUR | 343.63 EUR | da_contattare |
| 5 | Iren Luce e Gas | Iren Luce e Gas - IREN PRIMA SCELTA LUCE FISSA + IREN PRIMA SCELTA GAS | 812.92 EUR | 569.92 EUR | 243.00 EUR | 332.08 EUR | da_contattare |
| 6 | Alperia | Alperia - Alperia Smile Easy Summer + Alperia Gas Smile Start | 831.69 EUR | 592.29 EUR | 239.40 EUR | 313.31 EUR | attivabile |
| 7 | Octopus Energy | Octopus Energy - Octopus Fissa 12M + Octopus Fissa 12M Gas | 834.61 EUR | 678.61 EUR | 156.00 EUR | 310.39 EUR | attivabile |
| 8 | E.ON | E.ON - E.ON LuceClickVerde + E.ON Gas Click | 839.28 EUR | 622.05 EUR | 217.23 EUR | 305.72 EUR | attivabile |
| 9 | Edison | Edison - Edison 5xTe Luce km0 + Edison Web Gas | 853.30 EUR | 631.30 EUR | 222.00 EUR | 291.70 EUR | da_contattare |
| 10 | neN | neN - Due Luce + Due Gas | 860.80 EUR | 656.80 EUR | 204.00 EUR | 284.20 EUR | da_contattare |

### Attivabili online rilevate

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | Alperia | Alperia - Alperia Smile Easy Summer + Alperia Gas Smile Start | 831.69 EUR | 592.29 EUR | 239.40 EUR | 313.31 EUR | attivabile |
| 7 | Octopus Energy | Octopus Energy - Octopus Fissa 12M + Octopus Fissa 12M Gas | 834.61 EUR | 678.61 EUR | 156.00 EUR | 310.39 EUR | attivabile |
| 8 | E.ON | E.ON - E.ON LuceClickVerde + E.ON Gas Click | 839.28 EUR | 622.05 EUR | 217.23 EUR | 305.72 EUR | attivabile |
| 11 | Eni Plenitude | Eni Plenitude - Fixa Time 24 Smart Luce + Fixa Time 24 Smart Gas | 863.30 EUR | 575.30 EUR | 288.00 EUR | 281.70 EUR | attivabile |
| 13 | A2A Energia | A2A Energia - A2A Click Luce + A2A Click - GAS | 881.90 EUR | 671.90 EUR | 210.00 EUR | 263.10 EUR | attivabile |

## Privato medio - dual fuel - variabile

Offerte generate: 21

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alperia | Alperia - Alperia Free Welcome + Alperia Gas Home Promo | 796.94 EUR | 796.94 EUR | 0.00 EUR | 389.37 EUR | attivabile |
| 2 | E.CO Energia Corrente | E.CO Energia Corrente - E.CO LUCE SOLE SPECIAL + ECO GAS INDEX PSV 30 | 803.48 EUR | 581.48 EUR | 222.00 EUR | 382.83 EUR | da_contattare |
| 3 | Illumia | Illumia - Luce Flex + Illumia Smart Flex Gas | 821.12 EUR | 593.12 EUR | 228.00 EUR | 365.19 EUR | da_contattare |
| 4 | Engie | Engie - Energia VedoChiaro + Energia VedoChiaro | 871.01 EUR | 753.01 EUR | 118.00 EUR | 315.30 EUR | da_contattare |
| 5 | Octopus Energy | Octopus Energy - Octopus Flex + Octopus Flex Gas | 932.39 EUR | 776.39 EUR | 156.00 EUR | 253.92 EUR | da_contattare |
| 6 | neN | neN - Surf Luce + Surf Gas | 948.21 EUR | 708.21 EUR | 240.00 EUR | 238.10 EUR | da_contattare |
| 7 | Acea Energia | Acea Energia - Acea Energia Sprint Web + Acea Energia Sprint Web | 951.14 EUR | 759.14 EUR | 192.00 EUR | 235.17 EUR | da_contattare |
| 8 | Dolomiti Energia | Dolomiti Energia - ENERGIA CASA PRIMIERO + DOLOMITI SINERGIKA GAS | 966.15 EUR | 768.15 EUR | 198.00 EUR | 220.16 EUR | da_contattare |
| 9 | Edison | Edison - Edison World Luce Plus + Edison Dynamic Plus Gas | 972.71 EUR | 753.71 EUR | 219.00 EUR | 213.60 EUR | da_contattare |
| 10 | Magis Energia | Magis Energia - MIA LUCE + MIA GAS | 986.71 EUR | 746.71 EUR | 240.00 EUR | 199.60 EUR | da_contattare |

### Attivabili online rilevate

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alperia | Alperia - Alperia Free Welcome + Alperia Gas Home Promo | 796.94 EUR | 796.94 EUR | 0.00 EUR | 389.37 EUR | attivabile |
| 13 | E.ON | E.ON - E.ON Luce Drive Smarty + E.ON FlexClick Gas - PROMO | 1001.08 EUR | 771.85 EUR | 229.23 EUR | 185.23 EUR | attivabile |

## Privato alto consumo - dual fuel - fisso

Offerte generate: 20

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Magis Energia | Magis Energia - MIA LUCE FIX WEB + MIA GAS FIX WEB | 1096.80 EUR | 904.80 EUR | 192.00 EUR | 583.20 EUR | da_contattare |
| 2 | Acea Energia | Acea Energia - Acea Energia Fix + Acea Energia Fix | 1098.00 EUR | 876.00 EUR | 222.00 EUR | 582.00 EUR | da_contattare |
| 3 | Dolomiti Energia | Dolomiti Energia - DOLOMITI FISSO LUCE 120 + DOLOMITI FISSO GAS 36 WEB | 1156.20 EUR | 964.20 EUR | 192.00 EUR | 523.80 EUR | da_contattare |
| 4 | Iren Luce e Gas | Iren Luce e Gas - IREN PRIMA SCELTA LUCE FISSA + IREN PRIMA SCELTA GAS | 1157.40 EUR | 914.40 EUR | 243.00 EUR | 522.60 EUR | da_contattare |
| 5 | Engie | Engie - Energia PuntoFisso - 12 mesi + Energia PuntoFisso - 12 mesi | 1187.80 EUR | 1031.80 EUR | 156.00 EUR | 492.20 EUR | da_contattare |
| 6 | Alperia | Alperia - Alperia Smile Easy Summer + Alperia Gas Smile Start | 1190.20 EUR | 950.80 EUR | 239.40 EUR | 489.80 EUR | attivabile |
| 7 | Eni Plenitude | Eni Plenitude - Fixa Time 24 Smart Luce + Fixa Time 24 Smart Gas | 1212.00 EUR | 924.00 EUR | 288.00 EUR | 468.00 EUR | attivabile |
| 8 | E.ON | E.ON - E.ON LuceClickVerde + E.ON Gas Click | 1216.03 EUR | 998.80 EUR | 217.23 EUR | 463.97 EUR | attivabile |
| 9 | Octopus Energy | Octopus Energy - Octopus Fissa 12M + Octopus Fissa 12M Gas | 1241.20 EUR | 1085.20 EUR | 156.00 EUR | 438.80 EUR | attivabile |
| 10 | Edison | Edison - Edison 5xTe Luce km0 + Edison Web Gas | 1242.00 EUR | 1020.00 EUR | 222.00 EUR | 438.00 EUR | da_contattare |

### Attivabili online rilevate

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6 | Alperia | Alperia - Alperia Smile Easy Summer + Alperia Gas Smile Start | 1190.20 EUR | 950.80 EUR | 239.40 EUR | 489.80 EUR | attivabile |
| 7 | Eni Plenitude | Eni Plenitude - Fixa Time 24 Smart Luce + Fixa Time 24 Smart Gas | 1212.00 EUR | 924.00 EUR | 288.00 EUR | 468.00 EUR | attivabile |
| 8 | E.ON | E.ON - E.ON LuceClickVerde + E.ON Gas Click | 1216.03 EUR | 998.80 EUR | 217.23 EUR | 463.97 EUR | attivabile |
| 9 | Octopus Energy | Octopus Energy - Octopus Fissa 12M + Octopus Fissa 12M Gas | 1241.20 EUR | 1085.20 EUR | 156.00 EUR | 438.80 EUR | attivabile |
| 13 | A2A Energia | A2A Energia - A2A Click Luce + A2A Click - GAS | 1282.00 EUR | 1072.00 EUR | 210.00 EUR | 398.00 EUR | attivabile |

## Privato medio - forniture separate - fisso

Offerte generate: 20

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Axpo Energia + Acea Energia | Axpo Energia + Acea Energia - miglior abbinamento separato | 713.72 EUR | 458.72 EUR | 255.00 EUR | 431.28 EUR | da_contattare |
| 2 | Axpo Energia + Magis Energia | Axpo Energia + Magis Energia - miglior abbinamento separato | 721.82 EUR | 481.82 EUR | 240.00 EUR | 423.18 EUR | da_contattare |
| 3 | Axpo Energia + Dolomiti Energia | Axpo Energia + Dolomiti Energia - miglior abbinamento separato | 726.17 EUR | 510.17 EUR | 216.00 EUR | 418.83 EUR | da_contattare |
| 4 | Axpo Energia + Engie | Axpo Energia + Engie - miglior abbinamento separato | 731.87 EUR | 503.87 EUR | 228.00 EUR | 413.13 EUR | da_contattare |
| 5 | Axpo Energia + Iren Luce e Gas | Axpo Energia + Iren Luce e Gas - miglior abbinamento separato | 743.72 EUR | 479.72 EUR | 264.00 EUR | 401.28 EUR | da_contattare |
| 6 | Magis Energia + Acea Energia | Magis Energia + Acea Energia - miglior abbinamento separato | 747.01 EUR | 540.01 EUR | 207.00 EUR | 397.99 EUR | da_contattare |
| 7 | Axpo Energia + Octopus Energy | Axpo Energia + Octopus Energy - miglior abbinamento separato | 749.72 EUR | 521.72 EUR | 228.00 EUR | 395.28 EUR | da_contattare |
| 8 | Axpo Energia + neN | Axpo Energia + neN - miglior abbinamento separato | 752.72 EUR | 500.72 EUR | 252.00 EUR | 392.28 EUR | da_contattare |
| 9 | Magis Energia | Magis Energia - MIA LUCE FIX WEB + MIA GAS FIX WEB | 755.11 EUR | 563.11 EUR | 192.00 EUR | 389.89 EUR | da_contattare |
| 10 | Magis Energia + Dolomiti Energia | Magis Energia + Dolomiti Energia - miglior abbinamento separato | 759.46 EUR | 591.46 EUR | 168.00 EUR | 385.54 EUR | da_contattare |

## Privato medio - forniture separate - variabile

Offerte generate: 20

| # | Fornitore | Offerta | Totale | Variabile | Fissa vendita | Risparmio vs attuale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alperia + E.CO Energia Corrente | Alperia + E.CO Energia Corrente - miglior abbinamento separato | 693.85 EUR | 597.85 EUR | 96.00 EUR | 492.46 EUR | da_contattare |
| 2 | Eni Plenitude + E.CO Energia Corrente | Eni Plenitude + E.CO Energia Corrente - miglior abbinamento separato | 726.58 EUR | 630.58 EUR | 96.00 EUR | 459.73 EUR | da_contattare |
| 3 | Engie + E.CO Energia Corrente | Engie + E.CO Energia Corrente - miglior abbinamento separato | 743.92 EUR | 588.92 EUR | 155.00 EUR | 442.39 EUR | da_contattare |
| 4 | Illumia + E.CO Energia Corrente | Illumia + E.CO Energia Corrente - miglior abbinamento separato | 745.12 EUR | 565.12 EUR | 180.00 EUR | 441.19 EUR | da_contattare |
| 5 | Dolomiti Energia + E.CO Energia Corrente | Dolomiti Energia + E.CO Energia Corrente - miglior abbinamento separato | 746.56 EUR | 572.56 EUR | 174.00 EUR | 439.75 EUR | da_contattare |
| 6 | Octopus Energy + E.CO Energia Corrente | Octopus Energy + E.CO Energia Corrente - miglior abbinamento separato | 759.30 EUR | 591.30 EUR | 168.00 EUR | 427.01 EUR | da_contattare |
| 7 | Alperia + Illumia | Alperia + Illumia - miglior abbinamento separato | 769.85 EUR | 625.85 EUR | 144.00 EUR | 416.46 EUR | da_contattare |
| 8 | Acea Energia + E.CO Energia Corrente | Acea Energia + E.CO Energia Corrente - miglior abbinamento separato | 777.95 EUR | 585.95 EUR | 192.00 EUR | 408.36 EUR | da_contattare |
| 9 | Edison + E.CO Energia Corrente | Edison + E.CO Energia Corrente - miglior abbinamento separato | 781.12 EUR | 565.12 EUR | 216.00 EUR | 405.19 EUR | da_contattare |
| 10 | Alperia | Alperia - Alperia Free Welcome + Alperia Gas Home Promo | 796.94 EUR | 796.94 EUR | 0.00 EUR | 389.37 EUR | da_contattare |

