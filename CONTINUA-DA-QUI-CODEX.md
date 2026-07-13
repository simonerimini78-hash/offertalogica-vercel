# CONTINUA DA QUI - OffertaLogica

Ultimo aggiornamento: 2026-07-13

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

`offertalogica-v59-arera-update-locale-mac-20260713`

Base stabile precedente:

`offertalogica-v54-redirect-assistente-partner-fix-20260710`

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
- `offertalogica-v42-calcolatore-arera-aggiornato-20260707.zip`
- `offertalogica-v43-loghi-forniture-separate-20260707.zip`
- `offertalogica-v44-card-risparmio-evidente-20260707.zip`
- `offertalogica-v46-pagine-vetrina-provider-20260707.zip`
- `offertalogica-v47-offerte-bloccate-senza-cifre-20260707.zip`
- `offertalogica-v48-log-arera-chiari-20260709.zip`
- `offertalogica-v54-redirect-assistente-partner-fix-20260710.zip`
- `offertalogica-v59-arera-update-locale-mac-20260713.zip`

## Punto v59 - aggiornamento ARERA locale da Mac

Problema:

- il workflow GitHub Actions storico `Aggiorna offerte ARERA` riceve `HTTP 403 Forbidden` dal Portale Offerte;
- il problema e' lato accesso/rete GitHub Actions, non lato motore di calcolo;
- senza XML ARERA nuovi non si possono aggiornare i JSON.

Soluzione operativa aggiunta:

- nuovo script locale `scripts/aggiorna-arera-locale-mac.sh`;
- guida `docs/AGGIORNAMENTO-ARERA-LOCALE.md`;
- lo script scarica gli XML ARERA dalla connessione del Mac;
- genera `data/offerte-arera-menu.json`;
- genera `public/data/offerte-arera-menu.json`;
- se non trova XML validi, fallisce e non modifica i dati esistenti.

Comando operativo sul Mac:

```bash
bash scripts/aggiorna-arera-locale-mac.sh
```

Per una data precisa:

```bash
bash scripts/aggiorna-arera-locale-mac.sh 2026-07-13
```

Dopo l'esecuzione caricare su GitHub:

- `data/offerte-arera-menu.json`;
- `public/data/offerte-arera-menu.json`.

Cosa non e' stato toccato:

- motore di calcolo;
- ranking;
- dati offerte partner;
- frontend;
- OTP;
- lead;
- Supabase;
- consensi;
- loghi;
- link affiliati;
- workflow GitHub esistente.

Nota verifica:

- aggiornato solo lo script `scripts/verify-calcolo-offerte.mjs` per riconoscere il nome corrente dell'offerta Alperia variabile `Variabile PUN/PSV` nell'audit automatico; non cambia il sito e non cambia il calcolo.

Verifiche v59:

- `bash -n scripts/aggiorna-arera-locale-mac.sh`: OK;
- `PYTHONPYCACHEPREFIX=/tmp/offertalogica-pycache python3 -m py_compile scripts/update-arera-menu.py`: OK;
- `npm run validate-calculator-data`: OK;
- `npm run verify-calcolo-offerte`: OK, 0 errori, 0 warning.

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
- Pagine pubbliche v46: `internet-casa.html` e `casa-smart.html` sono pagine-vetrina con hero e blocchi offerta; non devono contenere spiegazioni interne su come costruiamo il sistema.
- Pagina `partner.html` v46: resta B2B, ma senza parole operative come `leadId`, `webhook`, `CRM`, `CPA/CPL` o spiegazioni tecniche da cantiere.
- Menu fornitori v46: aggiunti `Lene Energia` e `Segnoverde` nei menu a tendina offerta attuale/nuova offerta.
- Regola Segnoverde: Segnoverde non va trattato come dual fuel; se il filtro e' dual non deve essere forzato come offerta dual, perche' opera su luce e gas separati.
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

- Mostra fino a 6 offerte partner attive e attivabili online.
- Devono essere coerenti con filtro selezionato.
- Devono essere ordinate per costo stimato sul profilo utente.
- Nei testi pubblici non dichiarare un numero fisso: usare "le migliori offerte" o formule equivalenti.
- Quando il file ARERA e' disponibile, prezzi e ranking devono arrivare dal file ARERA aggiornato.
- I partner attivabili usano `offerte-proposte.json` solo per link, logo, stato commerciale e tracciamento.
- Un partner non deve essere mostrato come attivabile se non esiste un aggancio coerente e prudente con una proposta ARERA valida per lo stesso filtro.
- Se lo stesso partner compare due volte per lo stesso filtro, mostrare una sola card.

### 2. Migliori offerte per costo con consulente

- Mostra fino a 3 offerte non attivabili online.
- Devono essere ordinate per convenienza sul profilo utente.
- Devono restare separate dal blocco partner.
- Nei testi pubblici non dichiarare un numero fisso: usare "migliori offerte per costo con consulente" o formule equivalenti.
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

## Punto v44 - costo prima, risparmio evidente

Data: 2026-07-07.

- Base: `offertalogica-v43-loghi-forniture-separate-20260707`.
- Motore di calcolo non modificato: resta ARERA-first.
- Modifica v44: nelle card offerte viene mostrato prima `Costo stimato ... / anno`.
- Subito sotto viene mostrato `Risparmio annuo stimato` o `Risparmio potenziale stimato`, graficamente piu evidente.
- Il dettaglio tecnico resta sotto in piccolo: materia energia/gas, fissa vendita, potenza/ambito, oneri/imposte/IVA.
- Aggiunto logo `E.CO Energia Corrente` fornito da Simone in `public/assets/providers/eco-user.png`.
- Aggiornati `public/data/provider-brand.json`, `data/provider-brand.json` e fallback HTML `PROVIDER_BRANDS`.
- Non sono stati toccati ranking, dati ARERA, link partner, OTP, lead, database o consensi.
- Verifiche eseguite: `scripts/validate-calculator-data.mjs` OK; `scripts/verify-calcolo-offerte.mjs` OK; sintassi script inline OK; JSON brand root/pubblico identici; asset E.CO presente.

## Punto v46 - pagine vetrina pulite e provider menu

Data: 2026-07-07.

- Base: `offertalogica-v45-internet-affiliati-pulito-20260707`.
- Motore di calcolo non modificato: resta ARERA-first.
- `internet-casa.html` e `casa-smart.html` sono state rese pagine-vetrina: hero, blocchi offerta e CTA, senza spiegazioni interne su affiliazioni, commissioni o costruzione del sistema.
- `partner.html` resta pagina B2B, ma ripulita da parole operative tipo `leadId`, `webhook`, `CRM`, `CPA/CPL` e note da cantiere.
- Rimossa la pagina preview pubblica `public/index-preview-pelle-premium.html`.
- Aggiunti `Lene Energia` e `Segnoverde` nelle tendine fornitore.
- Segnoverde e' compatibile solo con forniture separate: non forzarlo nel dual fuel.
- Non sono stati toccati ranking, dati ARERA, link partner, OTP, lead, database o consensi.

## Punto v47 - offerte bloccate senza cifre

Data: 2026-07-07.

- Base: `offertalogica-v46-pagine-vetrina-provider-20260707`.
- Motore di calcolo non modificato: resta ARERA-first.
- Prima dello sblocco OTP, le card offerte non devono mostrare importi di costo stimato o risparmio stimato.
- Prima dello sblocco si mostrano solo badge, tipo di percorso e testo neutro: `Disponibile dopo verifica`.
- Dopo OTP verificato, le card tornano a mostrare costo stimato, risparmio annuo stimato e dettaglio tecnico.
- Non sono stati toccati ranking, dati ARERA, link partner, OTP, lead, database o consensi.

## Punto v48 - log ARERA chiari nel workflow

Data: 2026-07-09.

- Base: `offertalogica-v47-offerte-bloccate-senza-cifre-20260707`.
- Modifica limitata a `scripts/update-arera-menu.py`.
- Motore di calcolo non modificato: resta ARERA-first.
- Se ARERA non pubblica file validi per la data cercata, lo script continua a fallire con exit code 1.
- Il log ora indica la data cercata e stampa un messaggio esplicito: `Nessun file ARERA trovato per la data YYYYMMDD. Aggiornamento non eseguito. I dati esistenti non sono stati modificati.`
- Se i file sono trovati, il log indica la data usata, i file scaricati e i due JSON aggiornati: `data/offerte-arera-menu.json` e `public/data/offerte-arera-menu.json`.
- Non sono stati toccati ranking, dati partner, frontend, OTP, lead, Supabase, consensi, loghi o pagine pubbliche.
- Verifiche: scenario senza file con exit code 1 e log chiaro; scenario reale ARERA 20260709 su cartella temporanea con download/parsing riusciti; `scripts/validate-calculator-data.mjs` OK; `scripts/verify-calcolo-offerte.mjs` OK.

## Punto v49 - fix responsive mobile card offerte

Data: 2026-07-09.

- Base: `offertalogica-v48-log-arera-chiari-20260709`.
- Modifica limitata a `public/index.html`, solo regole CSS responsive delle card offerte.
- Obiettivo: evitare overflow orizzontale e contenuti fuori card su mobile.
- Aggiunte regole `min-width: 0`, `max-width: 100%`, wrapping testi lunghi e layout verticale sotto 700px.
- Sistemati i casi critici: titolo offerta lungo, dettagli tecnici lunghi, area costo/risparmio, CTA, loghi singoli e loghi doppi per forniture separate.
- Sotto 380px i loghi doppi possono andare a capo in modo controllato, restando dentro la card.
- Non sono stati toccati motore di calcolo, dati ARERA, ranking, offerte partner, offerte consulente, OTP, lead, Supabase, consensi, link affiliati, tracciamento eventi o logica di blocco/sblocco.
- Verifiche: homepage locale su 320px, 360px, 390px e 430px; card bloccate e simulazione card sbloccate; nessun overflow interno alle card; `scrollWidth` uguale al viewport; `scripts/validate-calculator-data.mjs` OK; `scripts/verify-calcolo-offerte.mjs` OK.

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

## Punto v50 - pulsanti sblocco mobile piu visibili

Data: 2026-07-10.

- Base: `offertalogica-v49-card-offerte-mobile-20260709`.
- Portati avanti i JSON ARERA aggiornati al 2026-07-10 gia generati dal Mac, cosi il pacchetto non regredisce sui dati caricati dopo l'ultimo aggiornamento manuale.
- Modifica limitata a `public/index.html`, solo CSS dei pulsanti di sblocco/offerte.
- Su mobile il pulsante `Sblocca le offerte` e i CTA `Sblocca` delle card bloccate sono piu grandi, piu leggibili e usano la stessa sfumatura verde del pulsante `Elabora e confronta le offerte`.
- Rimossa la forzatura blu dei CTA bloccati, sostituita da `var(--logo-green-gradient)`.
- Non sono stati toccati motore, ranking, dati partner, OTP, lead, Supabase, consensi, link affiliati, tracciamento eventi o logica di blocco/sblocco.
- Verifiche: `scripts/validate-calculator-data.mjs` OK; `scripts/verify-calcolo-offerte.mjs` OK con 0 errori.

## Punto v51 - effetto pulse premium su sblocco offerte

Data: 2026-07-10.

- Base: `offertalogica-v50-sblocca-mobile-evidente-20260710`.
- Modifica limitata a `public/index.html`, solo CSS.
- Aggiunto effetto `unlockPulse` sui pulsanti di sblocco: animazione leggera, non lampeggiante, con 3 cicli e poi stop.
- L'effetto usa lo stesso linguaggio visivo del gradiente verde gia approvato per `Elabora e confronta le offerte`.
- Aggiunto rispetto di `prefers-reduced-motion: reduce`, cosi l'animazione viene disattivata per utenti che hanno riduzione movimento attiva.
- Non sono stati toccati motore, ranking, dati ARERA, dati partner, OTP, lead, Supabase, consensi, link affiliati, tracciamento eventi o logica di blocco/sblocco.
- Verifiche prima dello zip: `scripts/validate-calculator-data.mjs` OK; `scripts/verify-calcolo-offerte.mjs` OK con 0 errori.

## Punto v52 - Magis esclusa dal filtro dual fuel

Data: 2026-07-10.

- Base: `offertalogica-v51-sblocca-pulse-demo-20260710`.
- Problema rilevato: Magis Energia compariva nella lista dual fuel perche il motore ARERA abbinava la migliore luce e il migliore gas dello stesso fornitore, anche se commercialmente erano due forniture separate.
- Correzione limitata a `public/index.html`: aggiunto `magis` in `PROVIDER_SOLO_FORNITURE_SEPARATE`, mantenendo gia presente `segnoverde`.
- Effetto: Magis non compare piu nelle liste dual fuel; resta disponibile nelle liste forniture separate, dove e coerente.
- Non sono stati modificati prezzi ARERA, file offerte, ranking generale, link affiliati, OTP, lead, Supabase, consensi, grafica o pagine pubbliche.
- Verifiche: `scripts/validate-calculator-data.mjs` OK; `scripts/verify-calcolo-offerte.mjs` OK con 0 errori.
- Esito verifica: profilo `medio-dual-fisso` passa da Magis Energia ad Acea Energia come prima offerta; Magis resta nei profili `forniture separate`.

## Scaletta SEO - piano per posizionamento organico

Data: 2026-07-10.

Nota di metodo:

- Non esiste garanzia di arrivare primi su Google.
- Il piano SEO deve essere costruito su contenuti utili, struttura tecnica pulita, dati verificabili e differenziazione reale rispetto ai competitor.
- Prima di spingere traffico forte, chiarire la gestione delle offerte non partner e attendere risposta Switcho o canale alternativo.

1. Base tecnica:
   - `robots.txt` corretto.
   - Nessun `noindex` sulle pagine che devono posizionarsi.
   - Sitemap aggiornata.
   - Search Console attiva.
   - Pagine veloci da mobile.
   - Meta title e description puliti.
   - Dati strutturati dove sensato: `Organization`, `Breadcrumb`, `FAQ`, eventualmente `WebApplication`.

2. Pagine SEO principali:
   - `/offerte-luce-gas-aggiornate`
   - `/migliori-offerte-luce-gas`
   - `/confronto-bolletta-luce-gas`
   - `/offerte-luce-gas-prezzo-fisso`
   - `/offerte-luce-gas-prezzo-variabile`
   - `/offerte-luce-gas-business`
   - `/come-leggere-bolletta-luce-gas`
   - `/cambiare-fornitore-luce-gas-conviene`

3. Pagine fornitore:
   - Enel
   - E.ON
   - Plenitude
   - Alperia
   - Octopus
   - A2A
   - Acea
   - Dolomiti
   - NeN
   - Sorgenia
   - Edison
   - Lene
   - Segnoverde

   Ogni pagina fornitore deve contenere:
   - come funziona il fornitore;
   - offerte presenti nel radar ARERA;
   - quando conviene;
   - quando non conviene;
   - link al calcolatore;
   - nota che il risultato cambia in base ai consumi reali.

4. Vantaggio competitivo SEO:

   Frase cardine:
   "OffertaLogica non mostra solo offerte medie: calcola il confronto sui consumi reali dell'utente, inseriti a mano o letti dalla bolletta."

5. Strategia contenuti:
   - PUN e PSV: cosa cambiano in bolletta.
   - Prezzo fisso o variabile: quando conviene.
   - Quota fissa vendita: perche cambia il risparmio.
   - Perche l'offerta piu economica non e sempre la migliore.
   - Come confrontare una bolletta luce e gas senza farsi ingannare.

6. Fiducia:
   - chi siamo;
   - metodo di calcolo;
   - fonti ARERA;
   - aggiornamento dati;
   - privacy;
   - nessuna promessa falsa;
   - promessa: "se non conviene, te lo diciamo".

7. Link e autorevolezza:
   - citazioni da partner;
   - directory affidabili;
   - blog locali;
   - comunicati stampa;
   - LinkedIn;
   - eventuali articoli su progetto innovativo/utility/bollette.

8. Tempistiche realistiche:
   - 0-30 giorni: indicizzazione e prime impression.
   - 30-90 giorni: prime query lunghe.
   - 3-6 mesi: crescita seria se i contenuti sono buoni.
   - 6-12 mesi: possibilita reale di posizionarsi su keyword competitive.

Priorita attuale:

- Aspettare risposta Switcho.
- Continuare a monitorare nuove affiliazioni.
- Non lanciare traffico pesante finche non e chiaro il canale di uscita per le offerte non partner.
- Correggere solo bug reali o incoerenze operative.

## Punto v53 - Assistente dati per attivazione

Data: 2026-07-10.

Base di partenza:

- `offertalogica-v52-filtro-dual-magis-20260710`.

Cosa e stato aggiunto:

- Pulsante `I miei dati per attivare`, visibile solo quando e stata letta una bolletta o sono disponibili dati tecnici tipici della bolletta.
- Popup di supporto prima del redirect verso il fornitore partner, con dati copiabili:
  - fornitore attuale;
  - POD luce;
  - PDR gas;
  - consumo annuo luce;
  - consumo annuo gas;
  - potenza impegnata;
  - codice cliente, se rilevato;
  - indirizzo fornitura, se rilevato.
- Copia singolo dato e copia di tutti i dati tecnici.
- Apertura del funnel ufficiale del fornitore in nuova scheda dal popup, cosi OffertaLogica resta aperta come guida.
- Eventi analytics:
  - `activation_assistant_opened`;
  - `activation_data_copied`;
  - `partner_funnel_opened`.
- Reset del pulsante e del popup quando viene azzerato il caricamento PDF.

Cosa non e stato toccato:

- Motore di calcolo.
- Regola ARERA-first.
- Ranking offerte.
- Prezzi/offerte partner.
- Offerte consulente.
- OTP.
- Lead.
- Supabase.
- Consensi.
- Link affiliati.
- Pagine pubbliche.

Regola operativa:

- Non si compila automaticamente il sito del fornitore: OffertaLogica mostra e rende copiabili i dati utili, poi l'utente compila sul sito ufficiale.
- Se non ci sono dati tecnici da bolletta, il redirect resta quello precedente.

Verifiche eseguite:

- `/Users/simo78/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/validate-calculator-data.mjs` OK.
- `/Users/simo78/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-calcolo-offerte.mjs` OK, 0 errori.

Prossima attenzione:

- Verificare in produzione, con una bolletta reale caricata, che il popup mostri POD/PDR e consumi corretti prima dell'apertura del sito del partner.

## Punto v54 - Fix redirect assistente e partner attivabili

Data: 2026-07-10.

Base di partenza:

- `offertalogica-v53-assistente-attivazione-20260710`.

Problemi rilevati:

- Dal popup assistente dati, il click sul sito del fornitore apriva una nuova scheda ma poteva cambiare anche la scheda del calcolatore, facendo perdere il popup con i dati copiabili.
- Enel, pur essendo affiliato attivo, poteva finire nel blocco "Migliori offerte per costo con consulente" quando il ranking ARERA generava una proposta Enel non agganciata al funnel partner.

Cosa e stato corretto:

- Rimosso il fallback `window.location.href` dall'apertura del funnel tramite assistente.
- Il popup ora apre il sito del fornitore tramite link temporaneo `target="_blank"` e mantiene OffertaLogica nella scheda corrente.
- Etichetta del pulsante assistente resa piu chiara: `Procedi sul sito del fornitore`.
- Riattivata l'unione tra ranking ARERA e offerte partner dirette tramite:
  - `offertePartnerDiretteAttivabili`;
  - `unisciOfferteCandidati`.
- Se un fornitore e gia presente tra i partner attivabili, non viene riproposto sotto nel blocco consulente con la stessa chiave fornitore/tipo/fornitura.

Cosa non e stato toccato:

- Motore di calcolo.
- Formula costi.
- Regola ARERA-first.
- Prezzi ARERA.
- OTP.
- Lead.
- Supabase.
- Consensi.
- PDF reader.
- Link affiliati gia presenti.

Verifiche eseguite:

- `/Users/simo78/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/validate-calculator-data.mjs` OK.
- `/Users/simo78/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-calcolo-offerte.mjs` OK, 0 errori, 0 warning.
- Profilo `medio-dual-fisso`: partner attivabili rilevati nel report tecnico:
  - E.ON;
  - Alperia;
  - Octopus Energy;
  - Eni Plenitude;
  - A2A Energia;
  - Enel.

Regola da mantenere:

- I partner diretti coerenti con il filtro devono restare nel blocco "Offerte partner attivabili online".
- Il blocco consulente deve servire per offerte non attivabili direttamente o che richiedono verifica, non per duplicare un partner gia attivo.
