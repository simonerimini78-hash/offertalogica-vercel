# Motore di calcolo OffertaLogica

Aggiornamento: 2026-06-25

## Obiettivo

Il calcolatore deve confrontare offerte luce e gas usando sempre la stessa base di consumo dell'utente.

La priorita non e mostrare tante offerte, ma ordinare le proposte in modo coerente e verificabile.

## Componenti calcolate

Per ogni scenario il motore separa:

```text
Materia/variabile       Consumo annuo x prezzo unitario dell'offerta.
Fissa vendita           Corrispettivo fisso annuo commerciale dell'offerta.
Profilo                 Correzioni di profilo da potenza luce e ambito gas.
Reg./fisc.              Componenti regolate, imposte e IVA se valorizzate nei dati.
Totale                  Somma delle componenti sopra.
```

Per la luce variabile viene applicato il fattore perdite rete configurato nei dati:

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

Quando l'utente non conosce i consumi, il frontend usa il profilo medio configurato in:

```text
public/data/calcolo-parametri.json
data/calcolo-parametri.json
```

Se il file non viene caricato, il calcolatore usa il fallback interno dentro `index.html`.

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

## File dati

Il motore prova a leggere:

```text
/data/calcolo-parametri.json
data/calcolo-parametri.json
/data/offerte-proposte.json
data/offerte-proposte.json
```

La prima strada serve online su Vercel. La seconda e utile in ambienti statici compatibili. Se i file non sono disponibili, il calcolatore usa i fallback interni.

Vedi anche:

```text
docs/AGGIORNARE-PARAMETRI-CALCOLO.md
```

## Cosa non e ancora incluso al centesimo

La versione attuale e una stima comparativa omogenea. Il motore ha gia campi per componenti regolate, imposte e IVA, ma i valori restano a zero finche non sono verificati.

Non include ancora in modo puntuale:

- IVA;
- accise;
- addizionali;
- tutti gli oneri di sistema;
- dettaglio completo trasporto e gestione contatore;
- scaglioni gas per consumo e ambito tariffario;
- fasce F1/F2/F3 domestiche con distribuzione oraria reale.

Queste componenti vanno aggiunte in una fase successiva usando tabelle aggiornabili e fonti ufficiali.

## Regola di manutenzione tariffe

Quando si aggiorna un'offerta, non modificare formule sparse e non modificare l'array fallback dentro `index.html`.

Aggiornare solo la scheda dentro:

```text
data/offerte-proposte.json
public/data/offerte-proposte.json
```

Campi principali:

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

Poi aggiornare `indiciMercato` dentro `calcolo-parametri.json` con il valore medio scelto per il periodo di confronto.

## Uso degli open data ARERA/AU

Gli open data del Portale Offerte sono la base piu credibile per allargare il magazzino offerte, ma non devono entrare automaticamente nel calcolatore pubblico.

Flusso corretto:

```text
1. Scaricare o aggiornare i dati ARERA/AU.
2. Trasformarli in candidati normalizzati.
3. Escludere business, condomini, offerte non domestiche e righe con prezzi ambigui.
4. Separare offerte fisse gia calcolabili da offerte variabili che richiedono PUN/PSV.
5. Portare nel JSON live solo le offerte con match sicuro e fonte annotata.
6. Tenere le offerte affiliate attive sempre visibili come destinazioni commerciali, anche fuori filtro.
```

Il comando operativo per scaricare l'ultimo pacchetto disponibile e:

```text
npm run sync:arera
```

Il comando operativo per creare una lista di lavoro dai candidati presenti e:

```text
npm run shortlist:arera
```

Questi comandi non aggiornano `offerte-proposte.json`: generano solo candidati e shortlist di manutenzione, cosi evitiamo di pubblicare offerte non verificate.

La shortlist operativa non pesca da tutto il mercato indistinto: estrae prima le offerte dei fornitori presenti nella tendina del calcolatore e genera anche:

```text
data/arera-candidati-menu.csv
```

Il CSV completo resta disponibile come archivio tecnico, ma la manutenzione commerciale parte dai fornitori che OffertaLogica ha deciso di presidiare.

Per aggiornare una offerta live senza copia-incolla manuale:

```text
npm run promote:arera -- --offer-id ID_OFFERTA --luce CODICE_LUCE --gas CODICE_GAS
```

Questo comando promuove solo righe fisse e pronte. Aggiorna anche il registro di certificazione, mantenendo il link commerciale esistente salvo uso esplicito di `--update-link`.

Su GitHub e presente anche un workflow settimanale:

```text
.github/workflows/update-arera-open-data.yml
```

Il workflow aggiorna i candidati ARERA/AU, valida il calcolatore e committa i file di manutenzione se cambiano.

## Prossimo salto di qualita

Il livello successivo e spostare:

- offerte;
- indici PUN/PSV;
- componenti ARERA;
- scaglioni gas;
- imposte;

in file dati separati, caricati dal frontend o dal backend. Parametri e offerte sono gia stati spostati in JSON; il prossimo passaggio e aggiungere componenti fiscali e scaglioni gas in dati strutturati.
