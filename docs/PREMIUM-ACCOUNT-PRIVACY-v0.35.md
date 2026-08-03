# OffertaLogica Premium v0.35 — account e privacy pre-lancio

## Obiettivo

Chiudere i principali punti account/privacy prima del lancio pubblico senza aggiungere funzioni Vercel e senza modificare la PWA gratuita v0.22.

## Funzioni introdotte

- recupero password tramite email Supabase;
- cambio password dall’account autenticato;
- accettazioni obbligatorie e versionate per Termini Premium, Informativa Premium e trattamento cloud/IA necessario al servizio;
- blocco delle nuove operazioni Premium finché le accettazioni correnti non risultano registrate;
- richiesta e annullamento della cancellazione completa dell’account;
- completamento amministrativo della cancellazione, comprese credenziali Auth, dopo rimozione dei PDF dal bucket;
- visualizzazione nello staff della data e del motivo della richiesta;
- controllo amministrativo delle variabili IA, tariffe, limiti e persistenza del rate limit senza mostrare segreti;
- informativa specifica Premium e integrazione dei Termini del servizio.

## Versioni legali registrate

- `premium-terms-v0.35-2026-08-03`
- `premium-privacy-v0.35-2026-08-03`
- `premium-cloud-ai-v0.35-2026-08-03`

Le caselle di registrazione non sono preselezionate. Per gli account esistenti l’app richiede l’accettazione delle versioni correnti prima di consentire nuovi caricamenti o analisi.

## Cancellazione account

1. Il cliente registra la richiesta dall’app.
2. Lo stato diventa `deletion_requested`; nuove operazioni Premium vengono bloccate.
3. Il cliente può ancora consultare o cancellare i dati già archiviati.
4. L’amministratore rimuove i PDF dal bucket e usa `Elimina account completo` nella pagina staff.
5. La RPC elimina l’utente da `auth.users` e i dati Premium collegati.

La cancellazione completa non può essere eseguita se la richiesta non esiste, se l’account è uno staff attivo o se nel bucket restano file del cliente.

## Configurazione da verificare

Nel pannello `Costi e tempi` la sezione `Configurazione operativa` mostra:

- backend Supabase;
- chiave OpenAI configurata;
- modello IA;
- limite PDF e deadline;
- tariffe input, cache e output;
- rate limit cliente, staff e conferma offerta;
- presenza di Redis/KV persistente.

Non vengono restituiti valori di chiavi o segreti.

## Operazione manuale Supabase Auth

Prima del test del recupero password, aggiungere agli URL di reindirizzamento consentiti di Supabase Auth l’URL Premium stabile e le Preview usate per il collaudo, con percorso `/app.html`.

## Nota legale

I testi inseriti costituiscono la struttura operativa del servizio e devono essere verificati e allineati dal titolare con la Privacy Policy ufficiale e con un professionista prima dell’apertura pubblica a pagamento.
