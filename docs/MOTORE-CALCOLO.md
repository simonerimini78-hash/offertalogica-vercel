# Motore di calcolo OffertaLogica

Aggiornamento: 2026-06-21

## Obiettivo

Il calcolatore deve confrontare offerte luce e gas usando sempre la stessa base di consumo dell'utente.

La priorita non e mostrare tante offerte, ma ordinare le proposte in modo coerente e verificabile.

## Componenti calcolate

Per ogni scenario il motore separa:

```text
Materia/variabile       Consumo annuo x prezzo unitario dell'offerta.
Fissa vendita           Corrispettivo fisso annuo commerciale dell'offerta.
Profilo                 Correzioni di profilo da potenza luce e ambito gas.
Totale                  Somma delle componenti sopra.
```

Per la luce variabile viene applicato il fattore perdite rete configurato nel codice:

```text
PERDITE_RETE_LUCE_VARIABILE = 1.102
```

## Regole di confronto

1. Offerta dual fuel: confronto su luce e gas.
2. Offerta solo luce: confronto solo sulla quota luce attuale.
3. Offerta solo gas: confronto solo sulla quota gas attuale.
4. Offerta separata con luce e gas: confronto su entrambe le commodity, ma mantenendo quote luce e gas separate.
5. Le prime 3 offerte sono ordinate per risparmio comparabile e poi per costo annuo stimato.

Questa regola evita l'errore di confrontare un'offerta solo luce o solo gas contro tutta la spesa luce+gas.

## Profilo medio

Quando l'utente non conosce i consumi, il frontend usa il profilo medio configurato in `PARAMETRI_CALCOLO.profiloMedio` dentro `index.html`.

Valori attuali:

```text
Luce: 2700 kWh/anno
Gas: 700 Smc/anno
Prezzo luce attuale stimato: 0.1500 €/kWh
Prezzo gas attuale stimato: 0.6800 €/Smc
Fisso luce attuale stimato: 144 €/anno
Fisso gas attuale stimato: 120 €/anno
```

Questi valori devono essere aggiornati quando si aggiorna il riferimento medio ARERA o il benchmark interno.

## Cosa non e ancora incluso al centesimo

La versione attuale e una stima comparativa omogenea. Non include ancora in modo puntuale:

- IVA;
- accise;
- addizionali;
- tutti gli oneri di sistema;
- dettaglio completo trasporto e gestione contatore;
- scaglioni gas per consumo e ambito tariffario;
- fasce F1/F2/F3 domestiche con distribuzione oraria reale.

Queste componenti vanno aggiunte in una fase successiva usando tabelle aggiornabili e fonti ufficiali.

## Regola di manutenzione tariffe

Quando si aggiorna un'offerta, non modificare formule sparse.

Aggiornare solo la scheda dentro `OFFERTE_PROPOSTE`:

```text
provider
nome
tipo
fornitura
link
destinationType
destinationStatus
luce.prezzoVariabile
luce.quotaFissaAnnua
gas.prezzoVariabile
gas.quotaFissaAnnua
descrizione
```

Per le offerte variabili future, preferire una formula esplicita:

```text
formula: { tipo: "indice_spread", indice: "pun", spread: 0.0000 }
formula: { tipo: "indice_spread", indice: "psv", spread: 0.0000 }
```

Poi aggiornare `INDICI_MERCATO` con il valore medio scelto per il periodo di confronto.

## Prossimo salto di qualita

Il livello successivo e spostare:

- offerte;
- indici PUN/PSV;
- componenti ARERA;
- scaglioni gas;
- imposte;

in file dati separati, caricati dal frontend o dal backend. In quel momento il calcolatore potra essere aggiornato senza toccare il codice HTML.
