# Stato progetto OffertaLogica

Aggiornato: 2026-07-04

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

- Deve mostrare fino a 3 offerte partner attive e attivabili online.
- Le offerte devono essere coerenti con il filtro selezionato.
- Le offerte partner attive devono essere considerate anche quando non vengono agganciate perfettamente dal ranking ARERA.
- Se lo stesso partner compare piu volte per lo stesso filtro, si mostra una sola card, scegliendo la proposta migliore per costo stimato.
- Questo blocco ha priorita commerciale, ma deve restare trasparente: il badge puo indicare la posizione economica rispetto al ranking generale.

### Blocco migliori offerte per costo con consulente

- Deve mostrare fino a 3 offerte non attivabili online, ordinate per convenienza sul profilo dell'utente.
- Queste offerte richiedono verifica consulenziale o ricontatto prima dell'eventuale attivazione.
- Deve restare separato dal blocco partner per evitare confusione.

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

## Regola di lavoro

Prima di modificare codice:

- Cosa cambio.
- Cosa non tocco.
- Come verifico che funzioni.
