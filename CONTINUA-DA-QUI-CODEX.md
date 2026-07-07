# CONTINUA DA QUI - OffertaLogica

Ultimo aggiornamento: 2026-07-07

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

Il pacchetto completo di riferimento lato progetto e:

`offertalogica-v42-calcolatore-arera-aggiornato-20260707`

Base storica stabile precedente:

`offertalogica-v25-loghi-preview-20260706`

Ultimi zip incrementali importanti generati dopo la base completa:

- `offertalogica-v29-verde-logo-approvato-20260706.zip`
- `offertalogica-v30-aruba-priorita-sms-20260706.zip`
- `offertalogica-v31-aruba-login-api-20260706.zip`
- `offertalogica-v32-aruba-auth-diagnostica-20260706.zip`
- `offertalogica-v33-testo-sms-otp-20260706.zip`
- `offertalogica-v34-termini-disclaimer-20260706.zip`
- `offertalogica-v35-assistente-guidato-20260706.zip`
- `offertalogica-v36-partner-a2a-octopus-mobile-20260707.zip`
- `offertalogica-v37-affiliazioni-deeplink-20260707.zip`
- `offertalogica-v38-logo-octopus-20260707.zip`
- `offertalogica-v39-arera-partner-sync-octopus-20260707.zip`
- `offertalogica-v40-arera-first-partner-20260707.zip`
- `offertalogica-v42-calcolatore-arera-aggiornato-20260707.zip` quando verra generato dopo approvazione.

Nota importante sugli zip incrementali: quelli v30-v33 contengono solo `lib/otp.js` e non devono toccare grafica, offerte, loghi o motore. Il v34 tocca solo pagine pubbliche statiche, footer, sitemap e termini/disclaimer. Il v35 aggiunge solo un assistente guidato frontend alla homepage. Il v36 aggiorna partner energia e pagina internet/mobile.

## Cose gia impostate

- Frontend pubblico in `public/index.html`.
- API Vercel in `api/`.
- Utility server in `lib/`.
- Dati offerte in `data/` e `public/data/`.
- Automazione ARERA tramite `.github/workflows/update-arera-menu.yml`.
- Script di verifica in `scripts/`.
- Database lead su Supabase.
- Redis/Upstash per storage operativo.
- OTP reale con Aruba SMS collegato e testato il 2026-07-06.
- Twilio resta configurato come fallback, ma il codice ora da priorita ad Aruba SMS.
- Privacy/iubenda presente, con attenzione ancora da mantenere su consensi e testi.
- Pagine SEO/istituzionali: `come-funziona`, `partner`, `casa-smart`, `internet-casa`, staff lead.
- Controllo pre-lancio: homepage e robots indicizzabili; `offerte-luce-gas-aggiornate.html` resta in `noindex,follow` finche' non viene lanciata ufficialmente come pagina SEO.
- Termini/disclaimer: aggiunta pagina `termini-condizioni.html`, link nei footer pubblici e nota breve sulle stime informative.
- Promemoria operativo SMS: l'alias Aruba attivo e' `RAGroup`; prima della scadenza annuale del servizio/alias va verificato o rinnovato dal pannello Aruba/AGCOM.
- Assistente guidato v35: pannello in homepage, senza AI/API, senza raccolta dati in chat. Guida l'utente verso PDF, profilo medio, dati reali, business, offerte e privacy.
- Partner aggiornati 2026-07-07: A2A e Octopus accettati su Tradedoubler e promossi a partner energia attivabili; Ho Mobile e Very Mobile inseriti nella sezione Internet casa/mobile con link affiliati e loghi.
- Deeplink aggiornati 2026-07-07: nella cartella v36 A2A punta al funnel fisso dual A2A dentro tracking Tradedoubler; Octopus punta alla pagina informazioni personali dentro tracking Tradedoubler. Lo zip v36 creato prima di questa correzione va rigenerato prima di un eventuale caricamento.
- Pacchetto corretto da caricare: v37. Include deeplink A2A, Octopus, Ho Mobile e Very Mobile dentro tracking Tradedoubler. Lo zip v36 precedente resta superato.
- Pacchetto v38: stessa base v37, con logo Octopus aggiornato in `public/assets/providers/octopus.png` e riferimento HTML corretto da `octopus.svg` a `octopus.png`.
- Pacchetto v39: corregge il collegamento tra offerte ARERA aggiornate e partner attivabili per Octopus/A2A. I prezzi devono arrivare da `offerte-arera-menu.json`; il link affiliato resta da `offerte-proposte.json`.
- Pacchetto v40: prima introduzione della regola ARERA-first. La v42 supera il vecchio fallback pubblico: se ARERA non si carica, non si mostrano prezzi statici come se fossero aggiornati.
- Pacchetto v42: rigenera `offerte-arera-menu.json` dai file ufficiali `PO_Offerte_E_MLIBERO_20260707.xml` e `PO_Offerte_G_MLIBERO_20260707.xml`, elimina il fallback pubblico a offerte statiche quando ARERA non e' disponibile e fa fallire lo script se il download ARERA non riesce.

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
- Quando il file ARERA e' disponibile, prezzi e ranking devono arrivare dal file ARERA aggiornato.
- I partner attivabili usano `offerte-proposte.json` solo per link, logo, stato commerciale e tracciamento.
- Un partner non deve essere mostrato come attivabile se non esiste un aggancio coerente e prudente con una proposta ARERA valida per lo stesso filtro.
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
- A2A
- Octopus

Altri fornitori possono essere presenti nel ranking ARERA o nel blocco consulente:

- Dolomiti
- E.CO Energia Corrente
- Magis
- Edison
- Sorgenia
- NeN
- altri da ARERA.

## Ultima modifica importante

Il blocco "Offerte partner attivabili online" e stato corretto in modalita ARERA-first: i prezzi arrivano dal file ARERA aggiornato; il file partner arricchisce solo con link/logo/stato commerciale. Non usare piu prezzi partner statici quando ARERA e' disponibile.

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

## Stato SMS OTP Aruba - 2026-07-06

Aruba SMS e stato collegato con alias approvato:

- mittente Aruba: `RAGroup`;
- provider selezionato in health check: `aruba-sms`;
- auth mode in health check: `login`;
- `userKeyLooksLikeUsername: true` e atteso, perche la vecchia `ARUBA_SMS_USER_KEY` contiene la username/email e non va usata come vero `user_key`;
- OTP reale arrivato correttamente sul cellulare;
- offerte sbloccate correttamente dopo OTP;
- bottone `Procedi` verso partner attivabile testato: apre correttamente il portale del fornitore;
- credito Aruba scalato correttamente;
- Supabase salva correttamente i tentativi/eventi.

Variabili Vercel Aruba rilevanti:

- `ARUBA_SMS_USERNAME` = username Aruba SMS;
- `ARUBA_SMS_API_PASSWORD` = API password Aruba;
- `ARUBA_SMS_SENDER` = `RAGroup`;
- `ARUBA_SMS_MESSAGE_TYPE` = `GP`;
- `ARUBA_SMS_ACCESS_TOKEN` puo restare configurato, ma il codice usa prima login con username + API password;
- non usare la username come vero `user_key` API.

Zip backend SMS prodotti:

- `offertalogica-v30-aruba-priorita-sms-20260706.zip`: priorita Aruba rispetto a Twilio.
- `offertalogica-v31-aruba-login-api-20260706.zip`: login Aruba con username + API password.
- `offertalogica-v32-aruba-auth-diagnostica-20260706.zip`: evita di usare username/email come `user_key` diretto e aggiunge diagnostica `authMode`.
- `offertalogica-v33-testo-sms-otp-20260706.zip`: aggiorna solo il testo SMS.
- `offertalogica-v34-termini-disclaimer-20260706.zip`: aggiunge termini e condizioni, nota disclaimer nel footer, link footer e sitemap aggiornata.
- `offertalogica-v35-assistente-guidato-20260706.zip`: aggiunge assistente guidato frontend in homepage.
- `offertalogica-v36-partner-a2a-octopus-mobile-20260707.zip`: aggiorna A2A e Octopus come partner energia attivi, aggiorna `data/offerte-proposte.json` e `public/data/offerte-proposte.json`, aggiunge Ho Mobile e Very Mobile alla pagina Internet casa/mobile con loghi e tracking. Attenzione: dopo la prima creazione dello zip sono stati corretti i deeplink A2A/Octopus nella cartella v36; rigenerare lo zip prima di caricarlo.
- `offertalogica-v37-affiliazioni-deeplink-20260707.zip`: pacchetto corretto da caricare. Parte dalla v36 e aggiunge deeplink puliti dentro tracking Tradedoubler per A2A fisso, Octopus, Ho Mobile e Very Mobile.
- `offertalogica-v38-logo-octopus-20260707.zip`: stessa base v37, aggiunge il logo Octopus aggiornato e corregge il mapping provider in homepage.
- `offertalogica-v39-arera-partner-sync-octopus-20260707.zip`: stessa base v38, modifica solo il matching commerciale. Octopus e A2A, quando presenti nel file ARERA aggiornato, usano prezzi ARERA ma conservano il percorso partner affiliato.
- `offertalogica-v40-arera-first-partner-20260707.zip`: stessa base v39, forza la regola ARERA-first. Se il menu ARERA e' disponibile, i partner attivabili vengono calcolati dai prezzi ARERA e non dai valori statici del file partner.
- `offertalogica-v42-calcolatore-arera-aggiornato-20260707.zip`: da generare solo dopo approvazione. Contiene dati ARERA 2026-07-07, script ARERA che fallisce in caso di download non riuscito, messaggio pubblico generico "Offerte in aggiornamento" se il file ARERA non e' caricato.

Testo SMS approvato per v33:

`OffertaLogica: il tuo codice di verifica e' 906129. Valido 5 minuti. Non condividerlo.`

Motivo del testo: usa solo caratteri GSM semplici, evita accenti e riduce il rischio di SMS doppi.

Stato operativo:

- v32 ha permesso il funzionamento reale Aruba.
- v33 e stato generato per correggere il testo del messaggio.
- Dopo caricamento v33 su GitHub e redeploy Vercel, rifare un solo test OTP per confermare il nuovo testo.
- Se si fanno troppi tentativi, `/api/send-otp` puo restituire `429`: e il rate limit anti-abuso, non un errore Aruba.

Misurazione funnel aggiunta:

- endpoint `api/track-event.js`;
- endpoint staff protetto `api/staff-analytics.js`;
- helper frontend `trackEvent(...)` in `public/index.html`;
- pagina protetta `public/staff-analytics.html`;
- eventi salvati in `lead_events` su Supabase tramite `lib/customerDb.js`;
- modalita staff esclusa dal tracciamento;
- anteprime locali escluse dal tracciamento;
- eventi senza PII: niente nome, telefono, email, POD/PDR, nome file PDF o testo bolletta.

Eventi principali:

- `pdf_analysis_started`, `pdf_analysis_completed`, `pdf_data_confirmed`, `pdf_reset`;
- `comparison_started`, `comparison_completed`, `offers_rendered`;
- `lead_modal_opened`, `lead_modal_closed`, `otp_sent`, `otp_verified`, `offers_unlocked`;
- `offer_consent_opened`, `offer_partner_consent_confirmed`, `offer_redirect`, `offer_request_recorded`;
- eventi business preliminari.

Accesso analytics interno:

`https://offertalogica.it/staff-analytics.html#token=IL_TUO_STAFF_PREVIEW_TOKEN`

La pagina mostra funnel, provider/offerte cliccate, origine dati ed eventi recenti. Non mostra nominativi.

## File da leggere prima di ogni modifica seria

- `docs/STATO-PROGETTO-OFFERTALOGICA.md`
- `docs/MOTORE-CALCOLO.md`
- `docs/VERIFICA-CALCOLO-OFFERTE.md`
- `docs/MONETIZZAZIONE-DESTINAZIONI.md`
- `docs/DATABASE-CLIENTI.md`

## Punto v43 - loghi e forniture separate

Data: 2026-07-07.

- Base: `offertalogica-v42-calcolatore-arera-aggiornato-20260707`.
- Motore di calcolo non modificato: resta ARERA-first.
- Modifica v43: aggiornati i loghi fornitori con asset forniti da Simone.
- File principali toccati: `public/index.html`, `public/data/provider-brand.json`, `data/provider-brand.json`, `public/assets/providers/*-user.png`.
- Nelle offerte con fornitura separata e due fornitori diversi, il blocco logo usa due caselle affiancate: una per luce e una per gas.
- Le card mantengono altezza e struttura esistenti; cambia solo la resa del marchio.
- Se il logo manca, compare fallback testuale nella stessa mini-casella, senza accorciare o deformare il blocco.
- Verifiche eseguite: `scripts/validate-calculator-data.mjs` OK; `scripts/verify-calcolo-offerte.mjs` OK; asset loghi richiesti presenti; JSON brand root/pubblico identici.

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

Priorita aggiornate dopo analisi Switcho e decisione di non andare online finche la trattativa non e piu chiara:

1. Fatto: sistemata pagina contenuto offerte luce/gas aggiornata, senza promessa assoluta di "migliore per tutti".
2. Fatto: Dolomiti, Acea e Lene inseriti nel radar contenuto.
3. Fatto: rafforzata promessa strategica "se non conviene, te lo diciamo".
4. Fatto: verificato funnel lead/offerta/non partner e whitelist domini.
5. Fatto: collegati analytics/eventi tecnici interni senza PII.
6. Prossimo: collegare SMS Aruba quando alias/credenziali sono pronti.
7. Prossimo: preparare traffico e pagine SEO indicizzabili quando la trattativa Switcho e la strategia partner sono piu chiare.

Nota strategica:

- Il motore del calcolatore e considerato sistemato a livello operativo solo se `offerte-arera-menu.json` e' aggiornato e caricato.
- La priorita ora non e rifare il motore, ma non bisogna mai perdere la regola ARERA-first: il calcolo deve partire da dati ARERA aggiornati.
- Il sito non va spinto online in modo aggressivo finche non si chiude o chiarisce la trattativa con Switcho.
- OffertaLogica deve apparire come una piccola infrastruttura aziendale seria, non come un semplice esperimento.
- La frase cardine resta: "OffertaLogica calcola le offerte sui tuoi consumi reali, letti dalla bolletta o inseriti manualmente. Se non conviene cambiare, te lo diciamo."

Pagina contenuto preparata:

- `public/offerte-luce-gas-aggiornate.html`
- Titolo impostato in modo non assoluto: "Offerte luce e gas aggiornate: confrontale sui tuoi consumi".
- La pagina non promette "migliori offerte per tutti".
- Include promessa: "se dai tuoi dati non emerge un risparmio reale, te lo diciamo".
- Include radar Dolomiti, Acea e Lene.
- Legge le offerte dal file pubblico `public/data/offerte-proposte.json`.
- Per prudenza pre-Switcho e pre-traffico, al momento resta `noindex,follow` e non va inserita in sitemap finche non decidiamo di renderla una vera pagina SEO indicizzabile.
- Testi visibili ripuliti: non contiene riferimenti interni a Switcho, noindex, modalita controllata, funnel, lead, monetizzazione o note da cantiere.

Funnel lead/offerta/non partner:

- Controllato il 2026-07-04.
- Le offerte partner attive possono restituire `redirectUrl` dopo consenso offerta.
- Le offerte non partner/con consulente non devono aprire landing esterne: registrano la richiesta e mostrano messaggio di ricontatto.
- Aggiornata whitelist domini in `api/offer-consent.js` per coprire anche Dolomiti, Acea, Lene ed E.CO/Energia Corrente.
- Verifica domini offerte attuali: OK, nessun dominio mancante.

## Regola di comunicazione con Simone

Simone vuole procedere senza perdersi.

Prima di modificare codice rispondere sempre:

- Cosa cambio.
- Cosa non tocco.
- Come verifico che funzioni.

Se una richiesta e ambigua, non inventare. Ripetere la regola in italiano semplice e chiedere conferma prima di toccare codice.
