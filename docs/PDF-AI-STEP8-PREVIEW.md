# PDF AI — Step 8.4.1 lettura visuale automatica in Preview staff

Data: 22 luglio 2026

## Obiettivo

Collaudare la lettura visuale AI sulle bollette fotografate direttamente nel normale caricatore della Preview, senza checkbox, richieste di consenso AI o pagine staff separate.

## Attivazione

L'AI può essere tentata soltanto quando tutte le condizioni seguenti sono vere:

1. `PDF_AI_MODE=shadow`;
2. `VERCEL_ENV=preview`;
3. token staff valido nell'header `X-Staff-Token`;
4. archivio PDF privato configurato;
5. modello e chiave AI configurati;
6. limiti di pagine, byte e tempo rispettati.

Il token staff viene inviato automaticamente dal normale caricatore quando la modalità staff è già attiva e la Preview dichiara disponibile il percorso AI.

## Nessun controllo di consenso nell'interfaccia

Non esistono:

- checkbox AI;
- testi di consenso AI;
- campi multipart `pdfAiConsent`;
- passaggi aggiuntivi prima di analizzare la bolletta.

La protezione è esclusivamente tecnica e server-side: ambiente Preview, autenticazione staff, archivio privato e configurazione AI.

## Risultato visibile per il collaudo

Nella Preview staff la risposta può aggiungere a `normalized` soltanto `ai_preview`, una vista sanitizzata e revisionabile contenente:

- classificazione visuale del documento;
- campi di identità letti;
- pagina, etichetta, evidenza e confidenza;
- eventuali conferme del valore parser/OCR;
- eventuali conflitti.

Il riepilogo mostra il riquadro:

`Dati letti dalla fotografia — da verificare`

Questi valori:

- non sostituiscono parser o OCR;
- non entrano nel contratto di autofill;
- non vengono inseriti automaticamente nel modulo;
- non sono restituiti in Production o senza token staff valido.

Il sidecar completo `_ai_shadow` resta soltanto nell'archivio privato.

## Collaudo richiesto

L'unica prova utente richiesta dopo il deploy è caricare bollette fotografate nella normale Preview staff e controllare ciò che appare nel riquadro della lettura visuale.

Non sono richiesti test manuali di checkbox, pagine archivio o pannelli staff.
