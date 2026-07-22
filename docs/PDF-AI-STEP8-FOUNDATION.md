# Punto 8 — Fondazione AI visuale controllata

Questo sottostep introduce esclusivamente le fondamenta testabili del Punto 8.
Non modifica `api/analyze-pdf.js`, non effettua chiamate a servizi esterni e non cambia il risultato del Punto 7.

## Garanzie iniziali

- modalità predefinita `off`;
- consenso esplicito sempre obbligatorio;
- modello configurato soltanto tramite `PDF_AI_MODEL`;
- limiti rigidi per dimensione, numero di pagine e timeout;
- primo schema limitato a classificazione e identificativi;
- esclusione completa dei valori economici;
- nessuna sovrascrittura dei valori deterministici o OCR;
- ogni valore AI resta in `review_fields` e richiede selezione esplicita;
- candidati privi di pagina, etichetta, evidenza o validità formale vengono scartati;
- contraddizioni e candidati AI discordanti vengono messi in conflitto, non applicati.

## Moduli

- `lib/pdfAiConfig.js`: configurazione e consenso;
- `lib/pdfAiSchema.js`: schema ristretto dell'output visuale;
- `lib/pdfAiPolicy.js`: condizioni di attivazione e budget temporale;
- `lib/pdfAiMerge.js`: validazione e piano di revisione non distruttivo.

L'integrazione con il provider AI e con l'endpoint PDF sarà introdotta in un sottostep separato, dopo la verifica di queste fondamenta.
