# Premium v0.36.18 — presentazione dell’analisi e dei prezzi

## Regola di stato cliente

- `pending` / `running`: analisi in corso, nessun dato parziale mostrato.
- `clear`: verde, “Bolletta verificata. Non sono state rilevate anomalie.”
- `review_recommended`: rosso, anomalia importante e controllo professionale disponibile secondo le regole del piano.
- `inconclusive`: giallo, analisi completata con avviso.
- `failed`: giallo, analisi non completata e possibilità di riprovare.

Un dato assente non deve essere rappresentato come zero. Il valore zero viene mostrato soltanto quando è realmente presente nel dato sorgente.

## Totale importi

Il totale include esclusivamente bollette con importo numerico disponibile. Le bollette ancora in analisi vengono conteggiate separatamente nel testo informativo.

## Versioni

- Release applicativa: v0.36.18.
- Versione condizioni Premium: v0.36.7.

Le due versioni hanno significati differenti e devono essere mostrate con etichette esplicite.

## Presentazione commerciale

Messaggio principale:

- `4,16 €/mese*` per i primi 12 mesi.

Chiarimento immediatamente visibile:

- equivalente mensile;
- pagamento annuale unico di `49,90 € IVA inclusa`.

Rinnovo:

- `4,99 €/mese`;
- addebito annuale di `59,88 €`;
- rinnovo disattivabile fino al giorno precedente la scadenza.
