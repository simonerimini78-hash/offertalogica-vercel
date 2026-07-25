# Lettore PDF shadow GPT-4.1

## Scopo

Lo Step 8 costruisce una base verificabile per migliorare la lettura di bollette e schede sintetiche senza modificare il risultato pubblico di Step 7 quando la modalita e `shadow`.

Il flusso pubblico continua a usare esclusivamente `normalized` prodotto dal parser e dall'OCR controllato di Step 7. Lo shadow:

1. converte i diagnostici legacy in candidati con campo, valore, unita, pagina, evidenza, ruolo semantico, fonte e confidenza;
2. chiede a GPT-4.1 di leggere separatamente luce e gas nel PDF originale
   standard oppure nelle pagine JPEG prodotte nel browser per un PDF
   fotografico grande;
3. confronta le fonti con una policy deterministica;
4. salva candidati, conflitti e decisioni soltanto nell'archivio PDF privato;
5. non alimenta il calcolatore e non appare nella risposta pubblica.

## Regole di sicurezza

- Nessuna votazione a maggioranza: piu candidati dello stesso parser valgono come una sola fonte.
- Un valore critico trovato soltanto dall'IA resta `needs_review`.
- Due fonti indipendenti concordanti possono produrre `accepted`.
- Valori critici discordanti producono `blocked`.
- Esempi, soglie, sconti, tasse e componenti di rete non possono sostituire consumi o prezzi cliente.
- Prezzo unitario completo, spread, indice, quota fissa, componente isolata e
  prezzo futuro hanno ruoli distinti.
- PUN, PSV, PSBIL, TTF, spread, dispacciamento, capacita e singole componenti
  non possono diventare il prezzo unitario principale.
- `calculator_ready` e vero soltanto quando tutti i campi necessari sono confermati da fonti indipendenti.

## Configurazione

Per impostazione predefinita l'adapter e spento e non legge il file:

```text
PDF_AI_MODE=off
```

Per una prova controllata in Preview:

```text
PDF_AI_MODE=shadow
OPENAI_API_KEY=...
PDF_AI_MODEL=gpt-4.1-mini-2025-04-14
PDF_AI_CRITICAL_MODEL=gpt-4.1-2025-04-14
PDF_ANALYSIS_DEADLINE_MS=55000
PDF_AI_GENERAL_PHASE_MS=24000
PDF_AI_CRITICAL_PHASE_MS=22000
PDF_AI_RESPONSE_MARGIN_MS=4000
PDF_ARCHIVE_MODE=all
```

La chiave OpenAI resta server-side. La richiesta usa Responses API, `store: false`, dettaglio esplicito e Structured Outputs strict. `api/analyze-pdf.js` dispone di 60 secondi; il budget applicativo massimo e 55 secondi e riserva sempre un margine per fusione, archivio e risposta HTTP.

Per un PDF raster di cinque pagine il piano e definito prima delle chiamate:

- generale pagine 1-3 con GPT-4.1 mini;
- generale pagine 4-5 con GPT-4.1 mini;
- recupero critico luce con GPT-4.1;
- recupero critico gas con GPT-4.1.

Le chiamate della stessa fase sono parallele. La fase critica non dipende dal tempo casualmente avanzato dalla lettura generale.

La lettura generale classifica ogni pagina e segnala separatamente identita
cliente, POD/PDR, consumo annuale, condizioni economiche e nome/codice offerta.
Le pagine miste sono candidate sia per luce sia per gas. La fase generale non
puo completare da sola il lettore: deve riuscire almeno una lettura critica.

Per un PDF standard, quando la pipeline IA deve intervenire, vengono eseguite
in parallelo due letture specialistiche dell'intero file originale:

- `critical_luce`;
- `critical_gas`.

Entrambe producono inventari strutturati. I consumi vengono promossi soltanto
se esplicitamente annuali o riferiti agli ultimi 12 mesi. Le righe economiche
conservano il valore stampato, l'unita, il periodo, la formula, l'indice e la
validita. L'eventuale conversione da quota mensile a quota annuale e eseguita
solo dalla pipeline deterministica e resta tracciata.

Prima di abilitare lo shadow su traffico reale devono essere completate la verifica privacy sui sub-responsabili e la valutazione della retention. L'abilitazione non fa parte di questa iterazione.

## Archivio e apprendimento

Quando lo shadow e attivo, `normalized_data` contiene la chiave privata `_reader_shadow`. Il risultato Step 7 non viene mutato. Per ogni PDF archiviato sono disponibili:

- candidati parser e IA;
- pagina ed evidenza breve;
- ruolo semantico;
- fonte e versione;
- campi mancanti;
- accordi, conflitti e rifiuti;
- piano, modello, stato e durata di ogni batch.

Le correzioni staff gia salvate in `confirmed_data` e `correction_summary` restano compatibili. Il passo successivo sara produrre benchmark per fornitore e tipo documento usando soltanto casi revisionati, senza addestramento automatico sui dati non verificati.

## Modalita fallback

`PDF_AI_MODE=fallback` permette alla pipeline sicura di completare campi mancanti dopo Step 7. Non sovrascrive valori Step 7 esistenti. Un identificativo o valore critico letto soltanto dall'IA resta da verificare; un conflitto non viene promosso.

Questa modalita non va portata in produzione prima del completamento del benchmark reale e della revisione del corpus.
