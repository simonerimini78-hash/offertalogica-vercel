# Audit offerte proposte

Aggiornamento: 2026-06-21

Offerte analizzate: 13

## Risultato sintetico

```text
Coerenti senza rilievi: 0
Da verificare: 13
Non pubblicare: 0
```

## Priorita alte

- 1 E.ON - E.ON Luce e Gas Insieme: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: da_cercare; Link tracking non configurato
- 2 A2A - A2A Click: Variabile senza formula PUN/PSV esplicita: oggi usa prezzo di calcolo statico; Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: da_cercare; Link tracking non configurato
- 3 Magis Energia - Magis Energia Mia Fix: Fornitura separate con luce e gas entrambe presenti: verificare se e bundle reale o due offerte separate; Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: da_cercare; Link tracking non configurato
- 4 Octopus Energy - Octopus Luce e Gas Monoraria: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: in_attesa_approvazione; Link tracking non configurato
- 5 Iren - Iren Fissa 36 Mesi: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: da_cercare; Link tracking non configurato
- 6 NeN - neN Luce Dieci: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: in_attesa_approvazione; Link tracking non configurato
- 7 NeN - neN Duel Luce e Gas: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: in_attesa_approvazione; Link tracking non configurato
- 8 NeN - neN Luce Surf: Variabile senza formula PUN/PSV esplicita: oggi usa prezzo di calcolo statico; Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: in_attesa_approvazione; Link tracking non configurato
- 9 NeN - neN Gas Surf: Variabile senza formula PUN/PSV esplicita: oggi usa prezzo di calcolo statico; Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: in_attesa_approvazione; Link tracking non configurato
- 10 Enel - Enel Fix Web Luce e Gas: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: da_cercare; Link tracking non configurato
- 11 Eni Plenitude - Eni Plenitude Fix Scontata: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: in_attesa_approvazione; Link tracking non configurato
- 12 Alperia - Alperia Smile Easy / Start: Fonte tariffaria da verificare con scheda sintetica o fonte ufficiale; Monetizzazione non attiva: in_attesa_approvazione; Link tracking non configurato

## Regole applicate

- Le offerte dual fuel devono contenere luce e gas.
- Le offerte solo luce o solo gas possono restare `separate`, ma vengono confrontate solo sulla commodity corretta.
- Le offerte variabili dovrebbero usare una formula PUN/PSV esplicita, non solo un prezzo statico.
- Le offerte senza fonte ufficiale o scheda sintetica restano da verificare.
- Le offerte senza link tracking o accordo partner non sono ancora monetizzabili.

## File operativo

```text
data/audit-offerte.csv
```

Usare questo CSV come checklist prima di promuovere un'offerta tra le prime 3 definitive.
