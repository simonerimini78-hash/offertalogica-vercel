# Lettore PDF shadow GPT-4.1

## Scopo

La prima iterazione costruisce una base verificabile per migliorare la lettura di bollette e schede sintetiche senza modificare il risultato pubblico del parser legacy.

Il flusso pubblico continua a usare esclusivamente `normalized` prodotto da `lib/pdfExtract.js`. Lo shadow:

1. converte i diagnostici legacy in candidati con campo, valore, unita, pagina, evidenza, ruolo semantico, fonte e confidenza;
2. puo chiedere a GPT-4.1 di leggere visivamente il PDF originale;
3. confronta le fonti con una policy deterministica;
4. salva candidati, conflitti e decisioni soltanto nell'archivio PDF privato;
5. non alimenta il calcolatore e non appare nella risposta pubblica.

## Regole di sicurezza

- Nessuna votazione a maggioranza: piu candidati dello stesso parser valgono come una sola fonte.
- Un valore critico trovato soltanto dall'IA resta `needs_review`.
- Due fonti indipendenti concordanti possono produrre `accepted`.
- Valori critici discordanti producono `blocked`.
- Esempi, soglie, sconti, tasse e componenti di rete non possono sostituire consumi o prezzi cliente.
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
PDF_AI_TIMEOUT_MS=12000
PDF_ARCHIVE_MODE=all
```

La chiave OpenAI resta server-side. La richiesta usa Responses API, `store: false`, PDF originale, dettaglio esplicito e Structured Outputs strict. Il timeout e limitato a 15 secondi e l'endpoint mantiene un margine rispetto ai 30 secondi di Vercel.

Prima di abilitare lo shadow su traffico reale devono essere completate la verifica privacy sui sub-responsabili e la valutazione della retention. L'abilitazione non fa parte di questa iterazione.

## Archivio e apprendimento

Quando lo shadow e attivo, `normalized_data` contiene la chiave privata `_reader_shadow`. Il risultato legacy non viene mutato. Per ogni PDF archiviato sono disponibili:

- candidati parser e IA;
- pagina ed evidenza breve;
- ruolo semantico;
- fonte e versione;
- campi mancanti;
- accordi, conflitti e rifiuti;
- stato `calculator_ready`.

Le correzioni staff gia salvate in `confirmed_data` e `correction_summary` restano compatibili. Il passo successivo sara produrre benchmark per fornitore e tipo documento usando soltanto casi revisionati, senza addestramento automatico sui dati non verificati.

## Variabili non implementate in questa iterazione

- OCR selettivo;
- escalation automatica a `gpt-4.1-2025-04-14`;
- recupero di esempi dal corpus;
- promozione dei dati shadow nell'output pubblico.

Questi passaggi richiedono prima un corpus revisionato e metriche campo per campo.
