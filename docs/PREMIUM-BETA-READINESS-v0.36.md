# OffertaLogica Premium v0.36 — collaudo end-to-end e preparazione beta

## Obiettivo

La v0.36 non introduce pagamenti o nuovi piani commerciali. Chiude i blocchi tecnici che potevano confondere o fermare un utente durante una beta controllata e rende visibile allo staff lo stato reale dell'ambiente operativo.

## Correzioni applicate

### 1. Accettazioni legali coerenti in tutto il flusso

Le funzioni operative Premium ora richiedono sempre le tre accettazioni correnti già introdotte nella v0.35:

- Termini Premium;
- Informativa Premium;
- trattamento cloud e IA necessario al servizio.

La verifica viene eseguita:

- nell'area utenze;
- nell'archivio bollette;
- nel backend prima di analisi IA e conferma offerta.

Senza accettazioni correnti l'utente mantiene la consultazione e la cancellazione dei dati già archiviati, ma non può aggiungere utenze, caricare bollette, avviare analisi, confermare offerte o richiedere controlli.

### 2. Stato beta chiaro nell'app

La dicitura `IN SVILUPPO` è sostituita da `BETA RISERVATA`. La versione dell'app e della cache PWA diventa `v0.36`.

### 3. Verifica automatica ambiente staff

La sezione **Costi e tempi → Configurazione operativa** controlla senza mostrare segreti:

- configurazione Supabase;
- raggiungibilità dello schema necessario;
- disponibilità del bucket `premium-bills`;
- presenza della configurazione OpenAI;
- disponibilità dello storico offerte ARERA;
- configurazione e funzionamento del rate limit persistente;
- completezza delle tariffe IA;
- limite PDF, deadline e limiti orari.

Lo stato `PRONTA PER BETA` compare soltanto quando tutti i controlli automatici obbligatori sono positivi.

## Controlli manuali necessari dopo il deployment

1. Aprire `/staff.html`, accedere come amministratore e controllare **Costi e tempi**.
2. Verificare che la configurazione mostri `PRONTA PER BETA`.
3. Creare un account beta nuovo e confermare l'email.
4. Accedere senza accettare le condizioni: utenze e bollette devono restare in sola gestione e mostrare `Accettazione richiesta`.
5. Accettare le condizioni correnti dal Profilo.
6. Creare un'utenza luce o gas.
7. Caricare una bolletta PDF reale non sensibile o autorizzata.
8. Verificare completamento analisi, costo, token e durata nella pagina staff.
9. Provare uno dei due percorsi:
   - analisi chiara senza richiesta staff;
   - analisi da approfondire con richiesta e chiusura del controllo staff.
10. Aprire e cancellare la bolletta dall'app.
11. Provare recupero password e nuovo accesso.
12. Provare la richiesta di cancellazione account su un account di test.

## Configurazione Vercel da controllare

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` oppure chiave service role equivalente
- `OPENAI_API_KEY`
- `PDF_AI_PRIMARY_MODEL`
- `PREMIUM_BILLS_BUCKET=premium-bills`
- `PREMIUM_AI_MAX_PDF_BYTES`
- `PREMIUM_AI_DEADLINE_MS`
- `PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS`
- `PREMIUM_AI_CACHED_INPUT_EUR_PER_1M_TOKENS`
- `PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS`
- credenziali Redis/KV compatibili con `lib/store.js`
- `ARERA_HISTORY_URL`, facoltativa perché esistono due fallback HTTPS

## Configurazione Supabase da controllare

- Redirect URL Preview Vercel;
- Redirect URL produzione Premium;
- bucket privato `premium-bills`;
- migrazioni fino alla v0.35 eseguite;
- almeno un amministratore attivo in `premium_staff_members`;
- account beta con abbonamento `trialing` o `active`.

## Limiti della verifica automatica

Il controllo automatico non effettua una chiamata a pagamento a OpenAI e non può certificare la qualità della lettura su tutte le bollette. Verifica la presenza della chiave, la raggiungibilità delle risorse e la coerenza del codice. Il collaudo con PDF reali resta necessario prima di aprire la beta a utenti esterni.

## SQL e funzioni Vercel

- Nessuna nuova migrazione SQL.
- Nessuna nuova funzione Vercel.
- `api/health.js` resta assente.
