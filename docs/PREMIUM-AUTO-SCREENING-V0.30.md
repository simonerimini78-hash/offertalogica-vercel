# OFFERTALOGICA PREMIUM v0.30 — SCREENING IA AUTOMATICO

## Obiettivo

La v0.30 sposta la prima analisi dalla dashboard staff al caricamento della bolletta nell’app Premium.

Flusso:

```text
Caricamento PDF
→ analisi IA automatica
→ estrazione e salvataggio dei dati
→ aggiornamento del totale dell’archivio
→ classificazione automatica
→ controllo umano disponibile soltanto per eccezioni
```

La PWA gratuita v0.22 e il branch `App-OffetaLogica` non vengono modificati.

## Dati estratti

Il lettore tenta di acquisire:

- importo totale finale;
- inizio e fine del periodo fatturato;
- data di emissione e scadenza;
- tipo di fornitura;
- fornitore;
- consumo annuo;
- prezzo unitario della vendita/materia;
- quota fissa della vendita;
- prezzo fisso, indicizzato o ibrido;
- indice e formula;
- alert esplicitamente motivati dal documento.

I dati grezzi della pre-analisi rimangono in `premium_analysis_runs` e non sono esposti direttamente al cliente.

## Esiti automatici

### `clear`

I dati essenziali sono stati letti e non sono emersi elementi da approfondire nei dati leggibili e nelle eventuali condizioni contrattuali registrate.

Testo prudenziale: non equivale a una certificazione umana della bolletta.

### `review_recommended`

È presente almeno un elemento da approfondire, per esempio:

- conguaglio o ricalcolo dichiarato;
- variazione economica;
- possibile quota inattesa;
- scadenza delle condizioni;
- incoerenza interna;
- differenza rispetto al contratto registrato.

L’app mostra **Richiedi controllo**.

### `inconclusive`

Uno o più dati necessari non sono leggibili o non risultano sufficientemente completi. L’app non classifica la bolletta come regolare e mostra **Richiedi controllo**.

### `failed`

L’analisi tecnica non è terminata. L’utente può riprovare oppure richiedere il controllo umano.

## Coda staff

Una bolletta non entra automaticamente nella dashboard staff.

Entra nella coda soltanto quando:

1. lo screening restituisce `review_recommended`, `inconclusive` o `failed`;
2. l’utente preme **Richiedi controllo**;
3. l’utente autorizza l’accesso al PDF per la verifica.

La validazione umana della v0.29.1 rimane disponibile sulle eccezioni e sulle eventuali verifiche di qualità.

## Archivio e totale

Al termine dell’analisi il backend aggiorna `premium_bills` con:

- `total_amount_eur`;
- date e periodo;
- tipo di fornitura;
- stato dello screening;
- riepilogo e motivi sintetici;
- riferimento all’esecuzione IA.

L’app calcola il totale annuale sulle bollette che dispongono di un importo valido, usando la fine del periodo, la data di emissione oppure la data di caricamento come riferimento.

## Sicurezza

- Il frontend usa soltanto la Publishable key Supabase.
- La Secret key Supabase e `OPENAI_API_KEY` restano nel backend Vercel.
- L’endpoint esistente `api/premium-ai-analysis.js` gestisce sia lo screening cliente sia la riesecuzione staff; non viene aggiunta una tredicesima funzione Vercel.
- Il backend verifica proprietario, profilo e abbonamento.
- Le policy RLS obbligano il browser a creare bollette nello stato `pending` e impediscono di falsificare l’esito automatico.
- La richiesta umana è autorizzata dal database soltanto per gli stati di eccezione.
- La mancata registrazione del costo tecnico non trasforma un’analisi completata in un errore cliente.

## Limiti della v0.30

- L’assenza di alert non garantisce che non esistano anomalie non rilevate.
- Il confronto contrattuale è completo soltanto quando nell’utenza è presente un contratto corrente con condizioni affidabili.
- Nella fase iniziale è opportuno validare manualmente tutte le eccezioni e un campione dei casi `clear`, per misurare falsi positivi e falsi negativi.
- Il prezzo dell’abbonamento resta da definire dopo la misurazione di token, durata, revisioni umane, storage e pagamenti.
