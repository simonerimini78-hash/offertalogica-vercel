# Punto 8.2 — orchestratore AI shadow

Versione: `8.2.0`

## Scopo

`lib/pdfAiShadow.js` coordina una lettura visuale privata e revisionabile senza collegarla al risultato pubblico del lettore PDF.

La modalità iniziale supportata è esclusivamente `shadow`. La modalità `fallback` resta deliberatamente non collegata.

## Flusso

1. crea una copia privata dell'output normalizzato;
2. applica `shouldAttemptPdfAi()` con consenso, limiti di file/pagine e budget temporale;
3. chiama `runPdfAiReview()` solo quando la policy autorizza il tentativo;
4. costruisce `buildPdfAiReviewPlan()` sulla copia privata;
5. restituisce un sidecar diagnostico con candidati, evidenze e piano di revisione;
6. non modifica e non restituisce come sostituzione l'output pubblico.

## Garanzie

- AI disattivata per default;
- consenso esplicito obbligatorio anche in shadow;
- nessuna chiamata in modalità `off` o `fallback`;
- nessun import di `api/analyze-pdf.js`;
- nessun aggiornamento del frontend;
- nessun campo economico richiesto o accettato;
- nessuna sovrascrittura di parser o OCR;
- errori, timeout e output invalidi sono non bloccanti;
- nessun PDF, Base64, chiave API o messaggio sensibile entra nei diagnostici;
- `review_plan.applied` resta falso;
- comportamento indipendente dal nome e dal layout del fornitore.

## Architettura generale fornitori

La logica non contiene nomi, coordinate o layout specifici di un fornitore. Il comportamento dipende esclusivamente da:

- tipo documento e commodity;
- campi mancanti;
- etichette ed evidenze visibili;
- ruolo semantico;
- limiti operativi e consenso.

Una modifica non è valida se migliora un singolo PDF ma riduce la robustezza su fornitori o formati diversi.

## Non incluso nel Punto 8.2

- collegamento a `api/analyze-pdf.js`;
- chiamate reali in test;
- salvataggio persistente dei diagnostici;
- visualizzazione dei candidati nel frontend;
- accettazione automatica dei candidati;
- fallback pubblico;
- prezzi, consumi, quote fisse, spread, indici o offerte commerciali.

## Passo successivo

Il Punto 8.3 potrà collegare il sidecar shadow all'endpoint in un commit separato, mantenendo invariato il JSON pubblico e verificando prima una Preview Vercel con consenso esplicito.
