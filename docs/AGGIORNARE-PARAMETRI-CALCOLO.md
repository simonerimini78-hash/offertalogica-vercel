# Aggiornare i parametri di calcolo

Aggiornamento: 2026-06-21

Il calcolatore online legge i parametri da:

```text
public/data/calcolo-parametri.json
```

Tenere sincronizzata anche la copia operativa:

```text
data/calcolo-parametri.json
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
indiciMercato.pun.valore
indiciMercato.psv.valore
```

## Regola anti-errori

Non modificare i calcoli dentro `index.html` per aggiornare i prezzi medi.

Modificare solo `calcolo-parametri.json`, poi caricare su GitHub entrambe le copie:

```text
data/calcolo-parametri.json
public/data/calcolo-parametri.json
```

## Valori ufficiali

Prima di dichiarare un dato come ARERA o ufficiale:

1. verificare la fonte;
2. annotare la fonte nel campo `fonte`;
3. aggiornare `aggiornatoIl`;
4. controllare che il dato sia compatibile con l'unita indicata.

Per ora il file e una configurazione aggiornable del motore. I valori vanno raffinati con fonti ufficiali prima dell'uso commerciale pieno.

## Anteprima locale

Se apri `index.html` direttamente dal Mac con percorso `file://`, il browser puo bloccare il caricamento del JSON.

In quel caso il calcolatore usa il fallback interno e resta funzionante. Online su Vercel, invece, legge:

```text
/data/calcolo-parametri.json
```
