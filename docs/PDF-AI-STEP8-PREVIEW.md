# PDF AI — Step 8.4 Preview staff controllata

Data: 22 luglio 2026

## Obiettivo

Abilitare il collaudo reale del percorso AI shadow soltanto nelle Preview Vercel e soltanto per una sessione staff autenticata, senza modificare il risultato pubblico del lettore.

## Protezioni introdotte

L'AI può essere tentata soltanto quando tutte le condizioni seguenti sono vere:

1. `PDF_AI_MODE=shadow`;
2. `VERCEL_ENV=preview`;
3. token staff valido nell'header `X-Staff-Token`;
4. consenso dedicato `pdfAiConsent=true` selezionato esplicitamente;
5. archivio PDF privato configurato;
6. modello e chiave AI configurati;
7. policy Step 8 rispettata per dimensione, pagine e budget temporale.

Il controllo di consenso:

- è nascosto per gli utenti normali;
- è nascosto anche allo staff quando la Preview non è completamente configurata;
- non è mai preselezionato;
- viene azzerato dopo ogni batch di analisi, all'uscita dalla modalità staff e al reset del lettore;
- autorizza soltanto i PDF selezionati in quel batch.

## Sicurezza server

Il backend non considera attendibili `archiveContext.staffMode` o altri campi inviati dal browser.

Controlla direttamente:

- ambiente Vercel Preview;
- token staff con confronto temporale sicuro;
- consenso AI dedicato;
- disponibilità dell'archivio privato.

Un client che invia manualmente `pdfAiConsent=true` in produzione o senza token staff riceve un risultato shadow `skipped`; il PDF non viene letto dal percorso AI e non viene inviato al provider.

## Risultato pubblico

La risposta resta:

```json
{ "ok": true, "normalized": {}, "archive": {} }
```

Il sidecar `_ai_shadow` resta esclusivamente nella copia privata archiviata. Nessun candidato AI viene mostrato al cliente o applicato al modulo.

## Variabili da configurare soltanto nella Preview

Obbligatorie:

- `STAFF_PREVIEW_TOKEN`;
- `PDF_AI_MODE=shadow`;
- `PDF_AI_MODEL`;
- `OPENAI_API_KEY`;
- `PDF_ARCHIVE_MODE=problematic` oppure `all`;
- `PDF_ARCHIVE_BUCKET`;
- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`.

Le variabili AI e la chiave non devono essere abilitate nell'ambiente Production durante il collaudo.

## Collaudo reale ancora necessario

Dopo il deploy Preview:

1. aprire il link protetto staff;
2. verificare che il controllo AI compaia solo nella Preview configurata;
3. provare senza selezionare il consenso: nessun tentativo AI;
4. selezionare il consenso e caricare un corpus anonimizzato multi-fornitore luce, gas e dual;
5. controllare `_ai_shadow` nell'archivio privato;
6. verificare che il risultato pubblico e il modulo siano identici al percorso senza AI;
7. registrare tentativi, osservazioni utili, conflitti, timeout e costi.

Il fallback pubblico resta disattivato.
