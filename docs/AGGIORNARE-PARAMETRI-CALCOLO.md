# Aggiornare dati di calcolo e offerte

Aggiornamento: 2026-06-21

Il calcolatore online legge i parametri da:

```text
public/data/calcolo-parametri.json
```

Legge le offerte proposte da:

```text
public/data/offerte-proposte.json
```

Tenere sincronizzata anche la copia operativa:

```text
data/calcolo-parametri.json
data/offerte-proposte.json
```

## Cosa aggiornare periodicamente

Nel file JSON si aggiornano:

```text
versioneDati
fonte
aggiornatoIl
parametriCalcolo.perditeReteLuceVariabile
parametriCalcolo.profiloMedio
parametriCalcolo.componentiProfilo
parametriCalcolo.componentiRegolate
indiciMercato.pun.valore
indiciMercato.psv.valore
```

`componentiRegolate` contiene campi predisposti per trasporto, oneri, imposte e IVA. Lasciare a zero i valori non verificati.

## Aggiornare offerte

Nel file `offerte-proposte.json` si aggiornano:

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
fonte
aggiornataIl
```

Se un'offerta e solo luce, `gas` deve essere `null`.

Se un'offerta e solo gas, `luce` deve essere `null`.

Se un'offerta e dual fuel, `luce` e `gas` devono essere entrambi presenti.

## Regola anti-errori

Non modificare i calcoli dentro `index.html` per aggiornare prezzi, indici o offerte.

Modificare solo i file JSON, poi caricare su GitHub entrambe le copie:

```text
data/calcolo-parametri.json
public/data/calcolo-parametri.json
data/offerte-proposte.json
public/data/offerte-proposte.json
```

## Valori ufficiali

Prima di dichiarare un dato come ARERA o ufficiale:

1. verificare la fonte;
2. annotare la fonte nel campo `fonte`;
3. aggiornare `aggiornatoIl`;
4. controllare che il dato sia compatibile con l'unita indicata.
5. non valorizzare IVA, imposte o componenti regolate senza fonte chiara.

Per ora il file e una configurazione aggiornable del motore. I valori vanno raffinati con fonti ufficiali prima dell'uso commerciale pieno.

## Anteprima locale

Se apri `index.html` direttamente dal Mac con percorso `file://`, il browser puo bloccare il caricamento del JSON.

In quel caso il calcolatore usa il fallback interno e resta funzionante. Online su Vercel, invece, legge:

```text
/data/calcolo-parametri.json
/data/offerte-proposte.json
```

## Controllo prima del caricamento

Se lavori da ambiente tecnico, eseguire:

```text
npm run validate:calculator
```

Il controllo verifica:

- copie `data` e `public/data` sincronizzate;
- JSON validi;
- offerte con luce/gas coerenti;
- JavaScript senza errori sintattici;
- motore corretto sul caso dual fuel e sul caso solo luce.
```
