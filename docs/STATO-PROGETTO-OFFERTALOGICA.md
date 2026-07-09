# Stato progetto OffertaLogica

Aggiornato: 2026-07-07

## Punto di rientro Codex

Prima di riprendere il lavoro dopo una pausa, un cambio sessione o un reset di contesto, leggere:

- `CONTINUA-DA-QUI-CODEX.md`
- `docs/STATO-PROGETTO-OFFERTALOGICA.md`
- `docs/VERIFICA-CALCOLO-OFFERTE.md`

Il file `CONTINUA-DA-QUI-CODEX.md` contiene il prompt breve da incollare in una nuova sessione e l'elenco delle cose da non rompere.

## Regole operative del calcolatore

### Motore di calcolo

- Il calcolo deve basarsi sui consumi dell'utente quando disponibili.
- Se l'utente non conosce i consumi, il confronto usa profili medi e l'ultimo riferimento ARERA disponibile.
- Le offerte a prezzo fisso e variabile devono essere filtrate in modo coerente con la scelta dell'utente.
- Le offerte dual fuel e separate devono essere filtrate in modo coerente con la scelta dell'utente.
- Le quote devono restare separate: materia energia/gas, fissa vendita, potenza/ambito, oneri/imposte/IVA, totale.

### Blocco offerte partner attivabili online

- Deve mostrare fino a 6 offerte partner attive e attivabili online.
- Le offerte devono essere coerenti con il filtro selezionato.
- Nei testi pubblici non deve dichiarare un numero fisso di offerte: usare "le migliori offerte" o formule equivalenti.
- Prima dello sblocco OTP non deve mostrare importi precisi di costo o risparmio dentro le card.
- Dopo lo sblocco OTP puo mostrare costo stimato, risparmio annuo stimato e dettaglio tecnico.
- Quando il file ARERA e' disponibile, prezzi e ranking devono arrivare dal file ARERA aggiornato.
- Il file partner deve arricchire le offerte con link, logo, stato commerciale e tracciamento, non sostituire il prezzo ARERA.
- Un partner non deve essere mostrato come attivabile se non esiste un aggancio coerente e prudente con una proposta ARERA valida per lo stesso filtro.
- Se lo stesso partner compare piu volte per lo stesso filtro, si mostra una sola card, scegliendo la proposta migliore per costo stimato.
- Questo blocco ha priorita commerciale, ma deve restare trasparente: il badge puo indicare la posizione economica rispetto al ranking generale.

### Regola ARERA-first

- `offerte-arera-menu.json` e' la fonte primaria per prezzi, quote fisse, filtro fisso/variabile e ranking.
- `offerte-proposte.json` contiene metadati commerciali: link affiliati, loghi, stato partner e tracciamento.
- Se il download ARERA fallisce, lo script di aggiornamento deve fallire: non deve lasciare dati vecchi facendo risultare l'automazione riuscita.
- Se ARERA non ha ancora pubblicato file per la data cercata, il workflow deve fallire con exit code 1 ma il log deve dire chiaramente che nessun file ARERA valido e' stato trovato e che i dati esistenti non sono stati modificati.
- Se il frontend non carica il file ARERA, non deve mostrare offerte con prezzi statici come se fossero aggiornate.
- Esempio verificato il 2026-07-07: Octopus fisso e' passato dalle righe scadute al 06/07/2026 alle righe valide dal 07/07/2026 al 13/07/2026.

### Blocco migliori offerte per costo con consulente

- Deve mostrare fino a 3 offerte non attivabili online, ordinate per convenienza sul profilo dell'utente.
- Queste offerte richiedono verifica consulenziale o ricontatto prima dell'eventuale attivazione.
- Deve restare separato dal blocco partner per evitare confusione.
- Nei testi pubblici non deve dichiarare un numero fisso di offerte.
- Prima dello sblocco OTP non deve esporre importi di costo o risparmio nelle singole card.

### Fornitori in menu

- Le tendine dei fornitori devono includere anche `Lene Energia` e `Segnoverde`.
- Segnoverde non deve essere trattato come dual fuel: se il filtro utente e' dual, non va forzato come proposta dual.
- Se in futuro una collaborazione consente di indirizzare richieste verso un partner consulenziale, la gestione deve restare coerente con il consenso specifico dell'utente.

### Pagine pubbliche

- `internet-casa.html` e `casa-smart.html` devono restare pagine-vetrina: hero, blocchi offerta e CTA.
- Non inserire nelle pagine pubbliche spiegazioni operative su come costruiamo il sistema.
- La pagina `partner.html` puo restare B2B, ma deve evitare parole e dettagli da implementazione interna come `leadId`, `webhook`, `CRM`, `CPA/CPL`.
- Le eventuali note tecniche devono restare nei documenti interni, non nei testi visibili ai clienti.

### Lead e consensi

- Le offerte sbloccate richiedono lead verificato via OTP.
- Il consenso privacy serve per generare e mostrare il confronto/offerte.
- Il consenso partner deve essere richiesto prima di trasmettere dati a fornitori o partner commerciali.
- Il PDF originale non deve essere conservato stabilmente, salvo scelta futura con consenso specifico.
- I dati tecnici estratti o inseriti devono restare nel database OffertaLogica: origine dato, consumi, prezzi, quote fisse, filtri scelti, risparmio stimato e offerta scelta.
- Le origini dati devono essere distinguibili: `pdf_upload`, `manual_input`, `arera_average_profile`, `business_profile`.
- Per affinare il motore usare viste o dataset anonimizzati, senza nome, email, telefono, POD o PDR.

### Strategia dati reali

La regolazione al centesimo puo essere migliorata con dati reali. Per questo, la priorita operativa e portare traffico al calcolatore e incentivare caricamento bollette/schede, salvando i dati normalizzati nel sistema proprietario. Le bollette reali serviranno per verificare voci ricorrenti, errori di estrazione, differenze fra fornitori e accuratezza del ranking.

### Analytics interni

- Il sito invia eventi tecnici a `/api/track-event` per misurare caricamento PDF, confronto, popup lead, OTP, offerte sbloccate e scelta offerta.
- Gli eventi finiscono in `lead_events` su Supabase.
- Prima del lead gli eventi restano anonimi; dopo la creazione del lead possono essere collegati al relativo `lead_id`.
- Non salvare negli eventi nome, telefono, email, POD, PDR, nome file PDF o testo della bolletta.
- La modalita staff e le anteprime locali non devono sporcare il database.

## Regola di lavoro

Prima di modificare codice:

- Cosa cambio.
- Cosa non tocco.
- Come verifico che funzioni.
