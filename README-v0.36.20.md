# OffertaLogica Premium v0.36.20 — aggiornamento automatico, prezzo e Liquid Glass

## Base esatta utilizzata

La modifica è stata costruita ricostruendo, nell’ordine, la base realmente testata:

1. `offertalogica-vercel-App-Premium-ok (2).zip`;
2. `OffertaLogica-Premium-account-esistente-profilo-staff-v0.36.16-incrementale.zip`;
3. `OffertaLogica-Premium-analisi-fluida-privacy-popup-v0.36.17-incrementale.zip`;
4. `OffertaLogica-Premium-esito-analisi-prezzi-versione-v0.36.18-incrementale.zip`;
5. `OffertaLogica-Premium-gas-mc-aggiornamento-sessione-v0.36.19-incrementale.zip`.

Il pacchetto v0.36.20 è incrementale e deve essere applicato esclusivamente sopra questa v0.36.19.

## Problemi riprodotti e cause dimostrate

### Le pagine già aperte non rilevavano le nuove versioni

Nella v0.36.19 App e Area staff eseguivano `registration.update()` una sola volta al caricamento della pagina. Se il deployment veniva pubblicato mentre la pagina restava aperta, non venivano effettuati altri controlli. Il messaggio di aggiornamento poteva quindi non apparire fino a una ricarica o riapertura manuale.

### Prezzo non più approvato

La v0.36.19 mostrava ancora `4,16 €/mese`, equivalenti a `49,90 €` per il primo anno. La nuova formula approvata è:

- primo anno: `3,99 €/mese`, equivalenti a `47,88 € IVA inclusa`, con addebito annuale unico;
- dal secondo anno: `4,99 €/mese`, equivalenti a `59,88 € IVA inclusa`, con addebito annuale unico.

### Interfaccia pubblica ancora piatta

L’interfaccia Premium usava correttamente logo, palette e struttura OffertaLogica, ma senza il trattamento visivo Liquid Glass approvato nella simulazione. La correzione agisce soltanto su CSS e non modifica gerarchia, posizioni, testi operativi o funzioni.

## Modifiche applicate

### Aggiornamento automatico controllato

App e Area staff ora:

- controllano il service worker ogni 30 secondi;
- ricontrollano quando la pagina torna visibile, online o in primo piano;
- applicano automaticamente la nuova versione;
- non eseguono `signOut` e non cancellano la sessione Supabase;
- rimandano la ricarica se è in corso un caricamento, un’analisi, una finestra operativa o una modifica staff non ancora salvata;
- riprendono automaticamente l’aggiornamento appena l’operazione termina.

La conservazione della sessione è possibile soltanto sullo stesso origin. Un nuovo URL casuale di Vercel Preview è un sito diverso per il browser e non può ereditare la sessione del precedente URL.

### Passaggio iniziale v0.36.19 → v0.36.20

Le pagine che stanno già eseguendo il codice v0.36.19 non possono iniziare a fare polling usando codice che non hanno ancora caricato. Per questo primo passaggio è necessaria una sola ricarica o riapertura manuale sullo stesso URL dopo il deployment. Da v0.36.20 in avanti il controllo è automatico.

### Prezzo Premium

Aggiornati:

- Area Abbonamento;
- confronto Prova/Premium;
- pulsanti di attivazione e riattivazione;
- Termini Premium;
- costanti della funzione Stripe predisposta;
- importo dello sconto introduttivo, ora pari a `12,00 €` rispetto al prezzo annuale di rinnovo.

Stripe resta disabilitato. Prima di un futuro collaudo Stripe dovrà essere creato o aggiornato il coupon `once` a `12,00 €`.

### Versione dei Termini

La modifica economica introduce i Termini correnti:

`premium-terms-v0.36.20-2026-08-06`

Privacy e consenso cloud/IA restano invariati. Gli utenti esistenti dovranno accettare i Termini commerciali aggiornati; i consensi precedenti non vengono eliminati.

### Liquid Glass

Applicato soltanto all’App Premium pubblica:

- stesso logo e stesse immagini originali;
- stessa palette verde OffertaLogica (`#18a84b`, `#087f3a`);
- stesso layout, stesse sezioni e stessa barra di navigazione;
- pannelli translucidi e sfocati;
- riflessi, bordi luminosi e profondità moderata;
- nessuna modifica estetica strutturale all’Area staff.

Sui browser senza supporto a `backdrop-filter` resta automaticamente la grafica precedente.

## Installazione

1. Eseguire in Supabase SQL Editor:
   `supabase/premium-commercial-terms-v0.36.20.sql`.
2. Facoltativo ma consigliato: eseguire
   `supabase/premium-commercial-terms-v0.36.20-verify.sql`.
3. Applicare il contenuto dello ZIP incrementale sopra la v0.36.19, mantenendo i percorsi.
4. Pubblicare il deployment sullo stesso progetto/URL usato per i test.
5. Per il solo passaggio dalla v0.36.19, ricaricare una volta App e Area staff già aperte. Non dovrebbe essere richiesto un nuovo login se l’URL non cambia.
6. Verificare che venga mostrata `APP v0.36.20` e che i Termini correnti risultino v0.36.20.

## Collaudo reale richiesto

- lasciare App e Area staff aperte sullo stesso URL;
- pubblicare una release successiva di prova con cache/versione diversa;
- verificare che il controllo avvenga entro 30 secondi o al ritorno in primo piano;
- verificare aggiornamento automatico senza logout;
- verificare rinvio dell’aggiornamento durante upload/analisi o modifica staff;
- verificare prezzo `3,99 €/mese`, totale `47,88 €` e rinnovo `4,99 €/mese`/`59,88 €`;
- controllare la resa Liquid Glass su iPhone e desktop.

## Test eseguiti localmente

- test mirati aggiornamento/prezzo/Liquid Glass/Termini/Stripe: `28/28`;
- suite completa v0.36.19: `443/459`, con 16 errori storici;
- suite completa v0.36.20: `447/463`, con gli stessi 16 errori storici;
- nuovi errori: `0`;
- sintassi JavaScript e script inline: verificata;
- funzioni Vercel: `12`.

Le verifiche non sono ancora state eseguite nel deployment Preview né nel database Supabase reale.

## Rollback

1. Ripristinare i file della v0.36.19.
2. Eseguire `supabase/premium-commercial-terms-v0.36.20-rollback.sql` per rendere nuovamente correnti i Termini v0.36.7.
3. Pubblicare nuovamente con una cache service worker diversa da quella v0.36.20.

Il rollback non elimina i consensi v0.36.20 già registrati; li conserva come storico.
