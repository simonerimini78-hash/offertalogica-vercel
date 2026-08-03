# OffertaLogica Premium v0.36.1 — correzione diagnostica tariffe IA

## Problema rilevato

La dashboard v0.36 poteva limitarsi a mostrare `Tariffe IA incomplete` senza indicare quale valore fosse assente e senza disporre di un fallback per il modello già fissato nel progetto.

## Correzione

- le tre variabili Vercel restano la fonte prioritaria;
- per `gpt-4.1` e `gpt-4.1-2025-04-14`, eventuali valori non ricevuti usano il listino operativo 2 / 0,5 / 8 per milione di token;
- la pagina staff mostra separatamente input, input in cache e output;
- per ogni voce indica `Variabile Vercel`, `Fallback modello` oppure `Variabile non ricevuta`;
- per modelli non censiti, la dashboard mostra i nomi esatti delle variabili mancanti;
- nessuna chiave o segreto viene restituito al browser.

Le tariffe sono stime economiche espresse nel registro interno in euro. Le variabili Vercel, quando presenti e valide, prevalgono sempre sul fallback.

## Installazione

Nessuna migrazione SQL e nessuna nuova funzione Vercel. Dopo il deployment aprire `/staff.html#costs` e premere `Aggiorna`.
