# CONTINUA DA QUI - OffertaLogica

Ultimo aggiornamento: 2026-07-04

Questo file e il punto di ritorno del progetto. Quando una nuova sessione Codex riparte, leggere prima questo file e poi `docs/STATO-PROGETTO-OFFERTALOGICA.md`.

## Prompt breve da incollare in una nuova sessione

Riprendi il progetto OffertaLogica dal file `CONTINUA-DA-QUI-CODEX.md`.
Non ripartire da zero. Prima leggi:

- `CONTINUA-DA-QUI-CODEX.md`
- `docs/STATO-PROGETTO-OFFERTALOGICA.md`
- `docs/VERIFICA-CALCOLO-OFFERTE.md`

Poi dimmi:

- cosa risulta gia fatto;
- cosa non va toccato;
- qual e il prossimo passo operativo.

Prima di modificare codice usa sempre questo schema:

- Cosa cambio.
- Cosa non tocco.
- Come verifico che funzioni.

## Stato attuale sintetico

OffertaLogica e un calcolatore luce/gas per privati e aziende.

Il progetto gira su GitHub + Vercel con dominio `offertalogica.it`.

Il pacchetto operativo corrente e:

`offertalogica-v20-arera-audit-partner`

Lo zip completo corrente e:

`offertalogica-v20-arera-audit-partner.zip`

## Cose gia impostate

- Frontend pubblico in `public/index.html`.
- API Vercel in `api/`.
- Utility server in `lib/`.
- Dati offerte in `data/` e `public/data/`.
- Automazione ARERA tramite `.github/workflows/update-arera-menu.yml`.
- Script di verifica in `scripts/`.
- Database lead su Supabase.
- Redis/Upstash per storage operativo.
- OTP con Twilio testato; Aruba SMS in attesa/da collegare quando alias e credenziali sono definitivi.
- Privacy/iubenda presente, con attenzione ancora da mantenere su consensi e testi.
- Pagine SEO/istituzionali: `come-funziona`, `partner`, `casa-smart`, `internet-casa`, staff lead.

## Regola madre del calcolatore

Il calcolatore non deve fare liste casuali.

Deve calcolare le offerte sui dati dell'utente:

- consumi reali o profilo medio;
- prezzo fisso o variabile;
- dual fuel o forniture separate;
- quote materia energia/gas;
- quote fisse vendita;
- quote potenza/ambito;
- oneri, imposte e IVA;
- dati ARERA aggiornati;
- offerte partner e non partner separate.

## Regola dei blocchi offerte

Dopo il click su "Elabora e confronta le offerte" devono comparire due blocchi distinti.

### 1. Offerte partner attivabili online

- Mostra fino a 3 offerte partner attive e attivabili online.
- Devono essere coerenti con filtro selezionato.
- Devono essere ordinate per costo stimato sul profilo utente.
- Le offerte partner attive devono essere considerate anche se non agganciate perfettamente dal ranking ARERA.
- Se lo stesso partner compare due volte per lo stesso filtro, mostrare una sola card.

### 2. Migliori offerte per costo con consulente

- Mostra fino a 3 offerte non attivabili online.
- Devono essere ordinate per convenienza sul profilo utente.
- Devono restare separate dal blocco partner.
- Quando l'utente procede, non aprire automaticamente la pagina fornitore: mostrare popup di richiesta consulente/trasmissione dati.

## Partner attivi importanti

Partner attualmente considerati attivi online:

- E.ON
- Enel
- Eni Plenitude
- Alperia

Altri fornitori possono essere presenti nel ranking ARERA o nel blocco consulente:

- Octopus
- Dolomiti
- E.CO Energia Corrente
- Magis
- A2A
- Edison
- Sorgenia
- NeN
- altri da ARERA.

## Ultima modifica importante

Il blocco "Offerte partner attivabili online" e stato corretto per pescare anche dalle offerte partner dirette attive, non solo dagli agganci ARERA.

Decisione strategica del 2026-07-04: la regolazione millimetrica del motore puo essere rimandata. La priorita ora e portare utenti reali sul sito, far caricare bollette e salvare nel database OffertaLogica i dati tecnici normalizzati utili a migliorare il motore.

Regola dati:

- non salvare stabilmente il PDF originale;
- salvare nel lead i dati estratti/inseriti, origine dato, consumi, prezzi, quote fisse, profilo comparazione e offerta scelta;
- distinguere `pdf_upload`, `manual_input`, `arera_average_profile`, `business_profile`;
- non trasmettere dati a partner esterni senza consenso partner su offerta specifica;
- usare viste/dataset anonimizzati per analizzare e migliorare il motore senza nominativi.

Verifica finale eseguita:

- `dual fuel / prezzo fisso`: blocco partner con 3 card visibili.
- blocco consulente con 3 card separate.
- `scripts/validate-calculator-data.mjs`: OK.
- `scripts/verify-calcolo-offerte.mjs`: OK, 0 errori, 0 warning.

## File da leggere prima di ogni modifica seria

- `docs/STATO-PROGETTO-OFFERTALOGICA.md`
- `docs/MOTORE-CALCOLO.md`
- `docs/VERIFICA-CALCOLO-OFFERTE.md`
- `docs/MONETIZZAZIONE-DESTINAZIONI.md`
- `docs/DATABASE-CLIENTI.md`

## Cose da non rompere

- Separazione dei due blocchi offerte.
- Calcolo su consumi reali o medi.
- Distinzione fisso/variabile.
- Distinzione dual/separate.
- Tracciamento partner online.
- Flusso OTP e consenso.
- Database lead.
- Modalita staff.
- Aggiornamento ARERA.

## Prossime priorita

1. Verificare a fondo i filtri fisso/variabile e dual/separate con diversi profili di consumo.
2. Rifinire i testi dei popup per offerte non partner/consulente.
3. Collegare Aruba SMS quando alias e API sono pronti.
4. Migliorare pagina partner/investor per Switcho e possibili collaborazioni.
5. Preparare scheda tecnica commerciale del flusso lead.
6. Lavorare su SEO e pagine fornitore quando il motore e stabile.

## Regola di comunicazione con Simone

Simone vuole procedere senza perdersi.

Prima di modificare codice rispondere sempre:

- Cosa cambio.
- Cosa non tocco.
- Come verifico che funzioni.

Se una richiesta e ambigua, non inventare. Ripetere la regola in italiano semplice e chiedere conferma prima di toccare codice.
