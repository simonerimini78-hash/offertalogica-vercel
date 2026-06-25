# Certificazione offerte

Aggiornamento: 2026-06-21

Questo registro separa le offerte realmente certificate dalle offerte candidate. Una offerta entra come certificata solo quando esiste una corrispondenza tra:

- nome offerta;
- codice offerta;
- validita;
- prezzo variabile o formula;
- quota fissa annua;
- fonte ufficiale.

## Fonti usate

- Portale Offerte ARERA/Acquirente Unico open data, file mercato libero scaricati il 21/06/2026:
  - `PO_Offerte_D_MLIBERO_20260620.xml`
  - `PO_Offerte_E_MLIBERO_20260620.xml`
  - `PO_Offerte_G_MLIBERO_20260620.xml`
- Schede sintetiche PDF fornite:
  - `Scheda Sintetica (1).PDF` per E.ON Gas Insieme, valida 29/05/2026-08/06/2026;
  - `Scheda Sintetica.PDF` per E.ON LuceDinamica Click ECO microbusiness, valida 21/05/2026-17/06/2026.

## Offerte certificate nel calcolatore

```text
1  E.ON Luce e Gas Insieme
2  A2A Start Luce e Gas
4  Octopus Fissa 12M Luce e Gas
12 Alperia Smile Easy / Gas Smile Start
13 Sorgenia Next Energy Smart
```

Le offerte sopra hanno prezzi aggiornati nel file:

```text
data/offerte-proposte.json
public/data/offerte-proposte.json
```

## Offerte ancora candidate

Restano da certificare con scheda sintetica aggiornata, open data con match chiaro o link partner ufficiale:

```text
3  Magis Energia Mia Fix
5  Iren Fissa 36 Mesi
6  neN Luce Dieci
7  neN Duel Luce e Gas
8  neN Luce Surf
9  neN Gas Surf
10 Enel Fix Web Luce e Gas
11 Eni Plenitude Fixa Time 24
```

Nota Plenitude: la landing ufficiale indicata e `Offerte luce e gas per la casa`, con offerta in evidenza `Fixa Time 24`. I corrispettivi di calcolo restano temporanei finche non viene acquisita la scheda sintetica aggiornata.

Nota NeN: al momento non ho trovato un match diretto e sicuro nei file open data analizzati. Va certificata tramite scheda sintetica, portale partner o conferma affiliate.

## Regola operativa

Quando aggiorniamo le tariffe:

1. scarichiamo o riceviamo la scheda sintetica/fonte ufficiale;
2. registriamo la riga in `data/certificazione-offerte.csv`;
3. aggiorniamo `data/offerte-proposte.json` solo se il match e certo;
4. copiamo lo stesso JSON in `public/data/offerte-proposte.json`;
5. lanciamo `npm run validate:calculator` e `npm run audit:offers`.

In caso di dubbio, l'offerta resta `da_verificare` e non deve essere promessa come certificata.
