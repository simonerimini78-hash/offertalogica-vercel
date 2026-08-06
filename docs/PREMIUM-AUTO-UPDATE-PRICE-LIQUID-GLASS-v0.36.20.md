# Specifica tecnica v0.36.20

## Ambito

La release interviene su tre aree isolate:

1. rilevamento e applicazione automatica delle release PWA;
2. formula commerciale Premium 3,99/4,99;
3. trattamento visivo Liquid Glass della sola App cliente.

Non modifica il motore di analisi bollette, il limite della prova, le tabelle bollette, la logica semaforo o il numero di funzioni Vercel.

## Aggiornamento PWA

### Diagnosi v0.36.19

Il controllo del service worker avveniva esclusivamente al caricamento. Una pagina mantenuta aperta durante un deployment non effettuava polling e non poteva rilevare in modo affidabile il worker nuovo.

### Strategia v0.36.20

- polling ogni 30.000 ms;
- controllo su `focus`, `online` e `visibilitychange`;
- attivazione del worker in attesa tramite `SKIP_WAITING`;
- ricarica dopo `controllerchange`;
- fallback di ricarica dopo 10 secondi se il cambio controller non viene notificato.

### Protezioni App

La ricarica è sospesa quando:

- esiste un elemento `aria-busy=true` o `data-update-busy=true`;
- è in corso upload o analisi automatica;
- è aperto un dialogo o il browser PDF interno;
- è stato selezionato un file;
- l’utente sta scrivendo in un campo;
- sono trascorsi meno di quattro secondi dall’ultima interazione.

### Protezioni Area staff

La ricarica è sospesa durante operazioni `aria-busy`, dialoghi, campi in modifica o dati staff non ancora salvati. Dopo il completamento dell’operazione viene rieseguito automaticamente il tentativo di attivazione.

## Sessione

L’aggiornamento non richiama `auth.signOut()` e i client Supabase mantengono `persistSession: true`. La persistenza è limitata al medesimo origin per le regole del browser. URL Preview Vercel differenti non condividono localStorage.

## Formula economica

- rinnovo annuale ordinario: 5.988 centesimi;
- primo anno: 4.788 centesimi;
- coupon introduttivo Stripe `once`: 1.200 centesimi;
- valuta: EUR.

La vendita rimane disabilitata tramite configurazione esistente.

## Termini correnti

- terms: `premium-terms-v0.36.20-2026-08-06`;
- privacy: `premium-privacy-v0.36.6-2026-08-04`;
- cloud_storage: `premium-cloud-ai-v0.36.6-2026-08-04`.

La migrazione aggiorna policy di inserimento, trigger di normalizzazione del consenso, verifica accettazioni, RPC di accettazione e trigger nuovi utenti.

## Liquid Glass

La regola CSS è racchiusa in `@supports` e conserva il fallback. Non cambia DOM, ID, ordine delle sezioni o griglie. Sono trattati solo componenti già esistenti: card, pannelli verdi, pulsanti, campi e barra inferiore. Le immagini logo restano quelle presenti in `/public/assets`.
