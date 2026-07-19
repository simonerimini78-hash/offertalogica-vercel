# OffertaLogica v98 — Contratti, periodi ed evidenze

La v98 sostituisce il confronto grezzo dei valori di consumo con un arbitraggio basato sul significato del dato.

## Consumi distinti

- consumo completo degli ultimi 12 mesi;
- consumo dichiarato annuo;
- consumo completo di un anno solare;
- consumo annuo stimato;
- progressivo dell'anno corrente;
- consumo fatturato nel periodo;
- consumo mensile;
- consumo da inizio fornitura;
- consumi per fascia;
- letture contatore e totali non classificati.

Solo i ruoli compatibili con il contratto `complete_annual_consumption` possono alimentare il calcolatore.

## Periodi

Le date vengono cercate nel blocco locale compreso tra l'etichetta semantica e il valore. Date contrattuali, scadenze e altri intervalli vicini non vengono associate automaticamente al consumo.

Due valori diversi riferiti allo stesso periodo annuale bloccano il campo. Due periodi annuali distinti e completi vengono ordinati per data e viene selezionato il più recente quando non esistono altre ambiguità.

## OCR

- timeout e fallimenti restano stati neutrali;
- unità OCR comuni come `Sme` possono sostenere il dato solo insieme a una conferma indipendente;
- numeri compatti e ambigui come `165386` non diventano valori autonomi;
- un numero OCR compatto può essere registrato come supporto approssimativo di `1.653,86`, senza generare conflitto.

## Diagnostica

Ogni decisione espone:

- `decision_contract`;
- `decision_rule`;
- candidato selezionato;
- candidati esclusi con motivazione;
- annualità concorrenti;
- disponibilità, qualità e relazione di parser, OCR e IA.

## Marcatori

- `parser_version`: `v98-contract-period-evidence-1`
- `analysis.version`: `pdf-hybrid-v13-contract-period-evidence`
- `analysis.strategy`: `field_contracts_then_period_aware_evidence_arbitration`
