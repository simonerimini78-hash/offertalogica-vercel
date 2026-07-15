# CONTINUA DA QUI - OffertaLogica

Ultimo aggiornamento: 2026-07-15

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


## Aggiornamento v89 - archivio PDF privato e diagnostica staff

Aggiunto un archivio tecnico dedicato alla fase di test del lettore PDF, senza modificare formule, ranking o correzione Axpo v88:

- archiviazione del PDF originale in un bucket Supabase privato, attiva soltanto con `PDF_ARCHIVE_MODE`;
- modalità `all`, `problematic` e `off`, con predefinita `off`;
- hash SHA-256 per evitare copie fisiche duplicate dello stesso documento;
- conservazione di versione parser, esito, dati normalizzati, avvisi, pagine e diagnostica campo per campo;
- estrazione del testo per pagina tramite `pdf-parse`, mantenendo invariato il parser testuale esistente;
- pagina protetta `staff-pdf.html` per aprire l'originale con link temporaneo, verificare i valori attesi, annotare correzioni e creare casi di test;
- API staff per elenco, revisione, apertura protetta ed eliminazione;
- endpoint protetto per cancellare gli elementi oltre la scadenza;
- script SQL per tabella `pdf_analyses` e bucket privato `pdf-test-archive`;
- link all'archivio nella modalità staff;
- nessuna nuova checkbox o passaggio nel percorso pubblico.

Configurazione e attivazione sono documentate in `docs/ARCHIVIO-PDF-TEST.md`. Durante la fase controllata usare `PDF_ARCHIVE_MODE=all`; prima dell'apertura pubblica rivalutare e passare a `problematic` o `off`.

Verifiche v89:

- test parser e percorso simmetrico precedenti: OK;
- nuovi test diagnostica e modalità archivio: OK;
- totale test Node disponibili nel pacchetto: 23/23;
- sintassi di API, librerie e script inline: OK;
- nessuna modifica ai file ARERA v88, alle formule o al ranking.

File v89:

- `api/analyze-pdf.js`;
- `api/staff-pdf-analyses.js`;
- `api/staff-pdf-file.js`;
- `api/cleanup-pdf-archive.js`;
- `lib/pdfExtract.js`;
- `lib/pdfArchive.js`;
- `lib/staffAuth.js`;
- `public/index.html`;
- `public/staff-pdf.html`;
- `supabase/pdf-analysis-archive.sql`;
- `docs/ARCHIVIO-PDF-TEST.md`;
- test diagnostica e archivio.

## Aggiornamento v88 - correzione componenti ARERA e offerta Axpo non domestica

Corretto un errore nell'importazione XML ARERA che poteva trasformare una componente commerciale o uno spread in un falso prezzo completo dell'energia:

- gli intervalli appartenenti alla stessa componente ARERA vengono ora trattati come fasce o scaglioni alternativi;
- le diverse componenti commerciali applicabili vengono sommate, invece di mediare indiscriminatamente tutti i valori presenti nell'offerta;
- gli scaglioni vengono selezionati sul consumo annuo di riferimento prima del calcolo del prezzo rappresentativo;
- il catalogo pubblico privati accetta esplicitamente soltanto offerte con `TIPO_CLIENTE 01`;
- le offerte Axpo rilevate nei file del 13 luglio 2026 hanno `TIPO_CLIENTE 02` e sono quindi correttamente escluse dal ranking domestico;
- il valore artificiale Axpo `0,066595 €/kWh`, derivato dalla vecchia media, non viene piu generato;
- non sono stati modificati frontend, ranking commerciale, partner, link affiliati, PDF, OTP, lead, consensi o database.

Verifiche v88:

- test di regressione XML: prezzo a fasce e componenti ricostruito a `0,14019 €/kWh`; offerta `TIPO_CLIENTE 02` esclusa;
- JSON ARERA rigenerati dai file luce e gas del 13 luglio 2026 e identici tra `data/` e `public/data/`;
- `npm run validate:calculator`: OK;
- `npm run verify:offers`: OK, zero errori e zero avvisi;
- `npm run test:ranking-arera`: OK;
- test PDF e percorso simmetrico v87: 17/17 superati;
- prova nel browser locale su fisso dual, fisso separato e variabile dual: Axpo e il prezzo anomalo non compaiono; nessun errore console.


## Aggiornamento v87 - percorso simmetrico per bolletta solo gas

Correzione del flusso introdotto in v86:

- quando il PDF contiene soltanto gas, viene ora chiesto se l'utente:
  - ha solo il gas;
  - deve ancora caricare la bolletta luce;
  - ha anche la luce ma vuole confrontare soltanto il gas;
- scegliendo solo gas, tutti i campi luce vengono esclusi dalla validazione e nascosti;
- scegliendo di caricare successivamente la luce, i dati gas restano memorizzati e il caricatore PDF viene riaperto;
- aggiunto lo stato `pending_luce`, simmetrico a `pending_gas`, in indicatore profilo, pulsante di confronto, guida utente e riepilogo dati per attivazione;
- la modalità staff mostra anche l'anteprima della domanda relativa alla luce;
- mantenuto invariato il percorso già funzionante per bolletta solo luce.

Verifiche v87:

- test parser esistenti: 12/12 superati;
- test del percorso luce/gas simmetrico: 5/5 superati;
- totale test automatici: 17/17 superati;
- sintassi di tutti gli script inline: OK.

## Aggiornamento v86 - profilo aziendale e scelta della fornitura da confrontare

Modifiche applicate al percorso successivo alla lettura della bolletta:

- il parser rileva il profilo `azienda / non domestico` usando diciture contrattuali, ragione sociale e partita IVA del cliente, evitando per quanto possibile la partita IVA del fornitore;
- quando viene rilevata un'utenza aziendale, l'utente deve confermare il profilo prima che i dati siano inseriti nel percorso business;
- quando una bolletta contiene soltanto luce, viene chiesto esplicitamente se l'utente:
  - ha solo la luce;
  - deve ancora caricare la bolletta gas;
  - ha anche il gas ma vuole confrontare soltanto la luce;
- scegliendo solo luce, i campi gas vengono esclusi dalla validazione e nascosti sia nel percorso privato sia nel percorso business;
- scegliendo di caricare successivamente il gas, i dati luce restano memorizzati e il caricatore PDF viene riaperto;
- bollette luce e gas di fornitori differenti mantengono separati `fornitore luce attuale` e `fornitore gas attuale`;
- il profilo inviato al lead non include consumi o fornitori predefiniti per una commodity esclusa dal confronto;
- la modalità staff include l'anteprima dei nuovi popup `Profilo e fornitura`;
- il popup decisionale richiede una scelta esplicita: click sullo sfondo ed Esc non selezionano silenziosamente `solo luce`.

Miglioramenti aggiuntivi del parser:

- lettura più robusta di codice fiscale, POD, PDR, potenza e indirizzo nei layout Plenitude appiattiti da `pdf-parse`;
- indirizzi luce e gas mantenuti separati quando disponibili;
- aggiunti `customer_type`, livello di affidabilità ed evidenza rilevata.

Verifiche v86:

- test automatici parser: 12/12 superati;
- prova sui testi estratti dai cinque PDF reali caricati: Dolomiti luce, Dolomiti gas, Plenitude dual, Hera multiservizio e scheda E.ON riconosciuti con i campi attesi;
- sintassi di tutti gli script inline: OK;
- nessun ID HTML duplicato.

## Aggiornamento v85 - parser verificato su documenti reali

- migliorata l'estrazione di consumi, prezzi e quote fisse per Dolomiti, Plenitude, Hera ed E.ON;
- aggiunti nome intestatario, codice fiscale, codice cliente, indirizzo, nome e codice offerta;
- supportata la conversione del consumo gas da mc a Smc quando è presente il coefficiente C;
- aggiunti test di regressione sui layout reali disponibili.

## Aggiornamento v84 - prima messa in sicurezza del lettore PDF

Modifiche applicate senza introdurre OCR o nuovi calcoli economici:

- corretto il caso critico in cui un prezzo come `0.123 €/kWh` poteva diventare `123 €/kWh`;
- rimossi i fallback che prendevano il primo valore generico in `€/kWh` o `€/Smc` senza un contesto commerciale riconoscibile;
- aggiunti controlli prudenziali sui valori palesemente fuori intervallo;
- un documento senza dati energetici non viene più classificato automaticamente come bolletta luce;
- `potenza impegnata` e `potenza disponibile` restano campi separati;
- POD e PDR vengono normalizzati e accettati solo con formato coerente;
- il fornitore viene scelto in base alla prima occorrenza nell'intestazione del documento, non all'ordine fisso dell'elenco;
- il frontend non usa documenti non riconosciuti e blocca l'unione di bolletta e scheda sintetica caricate insieme;
- il riepilogo PDF distingue documento utilizzabile, documento non riconosciuto e documenti incompatibili;
- l'API verifica la firma reale `%PDF-`, restituisce errori più chiari e cancella il file temporaneo;
- aggiunti 6 test automatici sul parser, tutti superati.

Questa versione non aggiunge ancora OCR, parser specifici per nuovi fornitori o dati anagrafici per l'attivazione. Il prossimo passo va deciso dopo test su PDF reali che oggi falliscono.

Verifiche v84:

- test parser Node: 6/6 superati;
- sintassi `lib/pdfExtract.js` e `api/analyze-pdf.js`: OK;
- sintassi degli script inline di `public/index.html`: OK.

## Aggiornamento v83 - anteprime staff complete e coerenti con la pagina pubblica

Modifiche applicate in `public/index.html`:

- la modalità staff continua a usare gli stessi popup, testi e passaggi della pagina pubblica, mantenendo esclusivamente il bypass di salvataggi, webhook e tracciamento;
- il banner staff è ora posizionato sotto i popup, così non copre più modali OTP, assistenza, consenso o dati per l'attivazione;
- aggiunto il comando staff `Anteprime`, che permette di aprire direttamente gli stessi componenti pubblici per verificare:
  - verifica OTP delle offerte;
  - popup `Ti serve una mano?`;
  - richiesta di ricontatto;
  - riepilogo `Dati utili per completare l'attivazione`;
  - consenso relativo all'offerta scelta;
- il riepilogo dei dati per l'attivazione può essere aperto in anteprima staff anche prima del caricamento di una bolletta, mostrando correttamente quali informazioni non sono ancora disponibili;
- su mobile, quando il pannello anteprime è aperto, i pulsanti flottanti pubblici vengono temporaneamente nascosti per evitare sovrapposizioni; appena il pannello viene chiuso tornano disponibili;
- nessun controllo staff è visibile nella pagina pubblica.

Verifiche v83:

- sintassi di tutti gli script inline: OK;
- popup OTP, aiuto e dati per l'attivazione apribili dal pannello staff: OK;
- banner staff sotto i backdrop dei popup: OK;
- nessun overflow orizzontale a 390 px: OK;
- pannello anteprime mobile senza sovrapposizione con l'assistente flottante: OK.

Non sono state modificate formule, ranking, catalogo, PDF, OTP pubblico, consensi, API, database o flussi degli utenti reali.

## Aggiornamento v82 - assistente attivazione ripristinato e aiuto proattivo

Modifiche applicate in `public/index.html`:

- il riepilogo dei dati utili all'attivazione viene nuovamente intercettato prima dell'apertura del percorso del fornitore quando sono disponibili dati tecnici della bolletta;
- il popup mostra i dati disponibili di anagrafica verificata e fornitura, tra cui nome, cellulare, email, codice fiscale se letto, POD, PDR, fornitore attuale, consumi, potenza, codice cliente e indirizzo;
- ogni dato disponibile può essere copiato singolarmente oppure con `Copia tutti i dati disponibili`;
- i dati non rilevati non occupano più schede vuote: sono riassunti in un avviso compatto;
- le azioni del popup restano visibili anche su mobile e il percorso di attivazione viene aperto in una nuova scheda, mantenendo OffertaLogica disponibile come guida;
- aggiunto un popup di assistenza proattiva, mostrato al massimo una volta per sessione in caso di inattività, uscita intenzionale da desktop o errori ripetuti;
- il popup offre tre scelte non obbligatorie: aprire l'assistente, richiedere un ricontatto a OffertaLogica oppure continuare da soli;
- la richiesta di ricontatto riutilizza la verifica OTP ma usa testo e consenso specifici per l'assistenza, senza mostrare o inviare il consenso al fornitore;
- la verifica effettuata solo per il ricontatto non sblocca automaticamente le offerte nel client;
- nome, cellulare ed email nel popup OTP hanno ora etichette sempre visibili;
- il campo OTP ha etichetta, `autocomplete=one-time-code`, limite di sei cifre, tastiera numerica e focus automatico;
- il messaggio OTP indica il numero parzialmente mascherato;
- lo stesso comportamento resta disponibile in modalità staff, con codice di prova `000000` e senza salvataggio.

Non sono state modificate formule, ranking, catalogo offerte, analisi PDF, API esistenti, database o logica economica. La richiesta di assistenza usa l'endpoint lead/OTP già presente e viene distinta tramite `requestType: assistance_callback`, `assistanceReason` e la fonte del consenso.

Verifiche v82:

- sintassi di tutti gli script inline: OK;
- ID HTML duplicati: nessuno;
- popup assistenza e richiesta ricontatto: OK su desktop e mobile;
- consenso partner nascosto e forzato a `false` nel percorso assistenza: OK;
- verifica assistenza separata dallo sblocco delle offerte: OK;
- intercettazione del percorso di attivazione con POD/PDR e dati copiabili: OK;
- nessun overflow orizzontale a 390 px e 1440 px: OK.

## Aggiornamento v81 - popup OTP staff identico alla pagina pubblica

Modifiche applicate in `public/index.html`:

- la modalita staff mostra ora lo stesso titolo, lo stesso testo introduttivo, gli stessi consensi e le stesse CTA del popup OTP pubblico;
- rimossi dal contenuto principale del popup i testi alternativi `Verifica staff senza salvataggio`, `Sblocca in modalita staff` e `Verifica staff e mostra le offerte`;
- la natura di anteprima resta comunicata separatamente dal banner staff e dal messaggio di stato, senza sostituire i contenuti che vedra l'utente finale;
- il messaggio staff non fa piu riferimento al colore del pulsante e indica direttamente `Invia il codice di verifica` e il codice di prova `000000`.

Non sono state modificate logica OTP, modalita senza salvataggio, consensi, API, tracciamento, offerte o calcoli.


## Aggiornamento v80 - popup OTP e CTA senza linguaggio “sblocca”

Modifiche applicate in `public/index.html`:

- confermata la nuova intestazione del popup OTP: “Verifica il numero e visualizza il confronto”;
- confermati i testi semplici che spiegano che il numero serve per ricevere il codice e che nessun dato viene inviato a un fornitore prima della scelta di un'offerta;
- mantenuti separati il consenso necessario alla comparazione e quello facoltativo per la trasmissione al fornitore o partner;
- sostituita la CTA “Sblocca le offerte” con “Verifica e visualizza le offerte”;
- sostituiti i riferimenti pubblici a “sbloccare” con formulazioni coerenti basate sulla verifica del numero;
- il pulsante finale OTP ora usa “Verifica e mostra le offerte”;
- aggiornati anche i messaggi di stato e il testo dell'assistente per evitare ambiguita.

Non sono state modificate logica OTP, consensi, API, tracciamento, catalogo offerte o calcoli.

## Aggiornamento v78 - conferma PDF guidata e reset completo del percorso

Modifiche applicate in `public/index.html`:

- dopo l'analisi del PDF la pagina scorre automaticamente al riepilogo e mostra una guida evidente: "Leggi e conferma i dati estratti";
- il pulsante di conferma e ora a tutta larghezza e specifica che i dati vengono inseriti nel modulo solo dopo la conferma;
- dopo la conferma la pagina porta direttamente ai dati compilati, evidenzia la scheda interessata e segnala subito gli eventuali valori non letti;
- il percorso distingue bolletta attuale e scheda sintetica, guidando rispettivamente alla scheda corretta;
- scegliendo "Non conosco i miei consumi" compare una guida che chiarisce che il profilo medio e gia pronto e non serve modificare nulla;
- "Azzera e cambia PDF" e stato rinominato "Rimuovi PDF e ricomincia" e ora azzera documento, dati derivati, risultati, errori, OTP/lead corrente e stati del confronto, riportando l'utente al caricatore;
- aggiunto supporto a `prefers-reduced-motion` per evitare animazioni quando richiesto dal dispositivo.

Verificati sintassi JavaScript, assenza di ID duplicati, sequenza selezione PDF -> analisi -> conferma -> revisione dati, reset del percorso e guida del profilo medio.

Non sono state modificate formule, catalogo offerte, API di lettura PDF, testi legali dei consensi o logica economica del confronto.

## Aggiornamento v77 - blocchi simmetrici e destinazione PDF evidente

Modifiche applicate in `public/index.html`:

- le schede "La tua fornitura attuale" e "Confronta un'offerta o un fornitore specifico" usano ora la stessa struttura grafica, bordo, testata, badge e altezza;
- la griglia desktop mantiene le due schede perfettamente allineate e della stessa altezza;
- i consumi restano sincronizzati: i campi tecnici della nuova offerta sono nascosti, mentre il riepilogo a destra si aggiorna dai valori della fornitura attuale;
- cliccando "Carica una scheda sintetica" la pagina porta al caricatore PDF, mostra un messaggio "Sei nel punto giusto" e anima sia il pannello sia l'area di caricamento;
- dopo la scelta del file, il messaggio indica chiaramente di premere "Analizza PDF";
- verificati sintassi JavaScript, assenza di ID duplicati, sincronizzazione dei consumi, parita delle altezze desktop e assenza di overflow mobile.

Non sono state modificate formule, catalogo offerte, lettura PDF, OTP, consensi o logica di confronto.

## Stato attuale sintetico

OffertaLogica e un calcolatore luce/gas per privati e aziende.

Il progetto gira su GitHub + Vercel con dominio `offertalogica.it`.

Il pacchetto incrementale piu recente lato progetto e:

`offertalogica-v83-staff-anteprime-complete-20260715`

Base immediatamente precedente:

`offertalogica-v82-assistente-attivazione-aiuto-ricontatto-20260715`

Il pacchetto completo di riferimento lato progetto resta:

`offertalogica-v75-popup-otp-schede-coerenti-20260714`

Base stabile precedente:

`offertalogica-v74-staff-nuova-offerta-chiara-20260714`

Base calcolatore stabile da cui deriva v74:

`offertalogica-v72-pdf-dolomiti-quota-fissa-20260714`

Base calcolatore stabile precedente:

`offertalogica-v69-pdf-plenitude-20260714`

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
- `offertalogica-v60-seo-offerte-aggiornate-20260713.zip`
- `offertalogica-v67-fix-dual-arera-minimo-20260713.zip`
- `offertalogica-v68b-workflow-visibile-20260713.zip`
- `offertalogica-v69-pdf-plenitude-fix-only-20260714.zip`
- `offertalogica-v70-pdf-quote-fisse-mese-anno-20260714.zip`
- `offertalogica-v71-blocco-risparmio-incompleto-20260714.zip`
- `offertalogica-v72-pdf-dolomiti-quota-fissa-20260714.zip`
- `offertalogica-v74-staff-nuova-offerta-chiara-20260714-incrementale.zip`
- `offertalogica-v75-popup-otp-schede-coerenti-20260714-incrementale.zip`

## Punto v75 - popup OTP e schede visivamente coerenti

Interventi completati:

- la scheda `Confronta un'offerta o un fornitore specifico` usa lo stesso accento blu, lo stesso stile del titolo e la stessa densita visiva della fornitura attuale;
- le tre modalita esistenti sono rimaste visibili, ma come righe informative compatte senza tre riquadri pesanti;
- il badge `Facoltativo` resta secondario;
- il popup OTP usa il titolo `Verifica il numero e visualizza il confronto`;
- viene chiarito che nessun dato va a un fornitore prima della scelta di un'offerta;
- la prima casella resta necessaria per comparazione e gestione della richiesta;
- la seconda casella resta facoltativa e riguarda soltanto il fornitore o partner della proposta scelta;
- il pulsante ora dice `Invia il codice di verifica`;
- nome, cellulare ed email hanno anche un'etichetta accessibile;
- l'instradamento PDF e rimasto invariato: scheda sintetica nella nuova offerta, bolletta nella fornitura attuale.

Cosa non e stato toccato:

- riconoscimento e analisi PDF;
- invio e verifica OTP;
- logica e prova dei consensi;
- formule, dati ARERA, ranking, offerte, link affiliati, lead e database;
- percorsi Privato, Azienda e dati medi.

File modificati in v75:

- `public/index.html`;
- `CONTINUA-DA-QUI-CODEX.md`.

Verifiche v75:

- sintassi di tutti gli script inline: OK;
- due consensi presenti una sola volta e ID HTML univoci: OK;
- instradamento della scheda sintetica verso i campi della nuova offerta invariato: OK;
- `npm run validate:calculator`: OK;
- `npm run verify:offers`: OK, 0 errori, 0 warning e 0 partner warning.

## Punto v74 - gestione lead staff e nuova offerta piu chiara

Interventi completati:

- la pagina staff consente di eliminare un singolo contatto o azzerare tutti i lead;
- l'azzeramento richiede la conferma testuale `AZZERA`, e le API di cancellazione accettano soltanto il token staff, non il token health;
- quando si azzerano i lead vengono eliminati anche gli eventi collegati ai contatti, mentre gli analytics anonimi restano;
- un click verso il fornitore o una richiesta registrata non viene conteggiata come entrata;
- le entrate vengono sommate soltanto con stato commissione confermata/approvata o pagata;
- la pagina staff mostra, per ogni documento, i dati tecnici PDF normalizzati gia salvati nel lead e segnala quelli non letti;
- il PDF originale e il testo integrale non vengono archiviati ne esposti: restano solo i campi tecnici necessari a migliorare il lettore;
- la sezione `Nuova Offerta (Facoltativa)` e stata rinominata `Confronta un'offerta o un fornitore specifico`, mantenendo il badge secondario `Facoltativo`;
- sono spiegati senza nuovi passaggi i tre usi esistenti: fornitore, scheda sintetica e inserimento manuale;
- menu fornitore, stato dell'offerta caricata e testo del pulsante finale sono piu chiari;
- i campi non validi mantengono bordo rosso e focus automatico, ma ora mostrano anche un messaggio testuale specifico accessibile;
- su schermi stretti le colonne della sola sezione facoltativa vengono impilate per evitare compressioni.

Cosa non e stato toccato:

- formule, prezzi, dati ARERA, regola ARERA-first e ranking;
- offerte partner e consulente, link affiliati e loghi;
- parser PDF, OTP, consensi, flussi Privato/Azienda e percorso dati medi;
- schema Supabase e raccolta pubblica dei lead.

File modificati in v74:

- `api/staff-leads.js`;
- `lib/customerDb.js`;
- `public/staff-leads.html`;
- `public/index.html`;
- `CONTINUA-DA-QUI-CODEX.md`.

Verifiche v74:

- sintassi API, libreria e script inline: OK;
- ID HTML univoci e associazioni label/campo: OK;
- test simulato lettura dati PDF staff, ricavi confermati, eliminazione singola e azzeramento: OK;
- token health rifiutato per DELETE e token staff autorizzato: OK;
- `npm run validate:calculator`: OK;
- `npm run verify:offers`: OK, 0 errori, 0 warning e 0 partner warning.

Nota di sicurezza:

- se un valore di `STAFF_PREVIEW_TOKEN` e stato incollato in una chat o in uno screenshot, sostituirlo in Vercel e fare un redeploy prima di usare la funzione di cancellazione.

## Punto v72 - quota fissa Dolomiti e bollette separate

Problema risolto:

- Dolomiti scrive `di cui spesa per vendita energia elettrica/gas naturale`, senza la parola `di` dopo vendita;
- il parser riconosceva la sezione `QUOTA FISSA` ma non catturava il valore in euro al mese;
- nella bolletta gas un IBAN che iniziava con `IT` poteva essere scambiato per un POD, classificando erroneamente il documento come dual.

Regola v72:

- sotto `QUOTA FISSA` viene letto soltanto il valore `di cui spesa per vendita`, non il totale comprensivo di rete e oneri;
- sono accettate sia le diciture `vendita di energia/gas` sia `vendita energia/gas`;
- il POD deve rispettare il formato tecnico `IT...E...`, evitando i falsi positivi sugli IBAN;
- due PDF Dolomiti caricati separatamente restano rispettivamente luce e gas e vengono poi uniti dal flusso multi-documento;
- sotto le caselle del costo fisso compare una guida semplice per trovare la riga corretta in bolletta.

Cosa e' stato toccato:

- `lib/pdfExtract.js` per il formato Dolomiti e il POD;
- `public/index.html` soltanto per la guida visibile sotto le due quote fisse attuali;
- nessuna modifica a formule economiche, perdite di rete, ranking, dati ARERA, offerte partner, OTP, lead, Supabase o consensi.

Verifiche v72:

- Dolomiti gas: documento gas, quota fissa vendita `12 €/mese = 144 €/anno`, PDR presente e nessun falso POD: OK;
- Dolomiti luce: documento luce, quota fissa vendita `10,43 €/mese = 125,16 €/anno`, POD presente: OK;
- regressione Plenitude dual: quote fisse, POD e PDR presenti: OK;
- regressione Hera dual: quote fisse, POD e PDR presenti: OK;
- sintassi dei blocchi JavaScript inline: OK;
- `npm run validate:calculator`: OK;
- `npm run verify:offers`: OK, 0 errori e 0 warning.

## Punto v71 - nessun risparmio con dati incompleti

Problema risolto:

- i campi numerici vuoti venivano trasformati in zero e il calcolatore poteva mostrare un risparmio apparentemente preciso partendo da una bolletta letta solo in parte;
- le etichette tecniche rendevano difficile capire quali valori copiare dalla bolletta.

Regola v71:

- il risparmio viene calcolato solo se consumo, prezzo e costo fisso sono presenti sia per luce sia per gas;
- una quota fissa scritta esplicitamente come zero resta valida, mentre una casella vuota e considerata mancante;
- se l'utente inizia a compilare una nuova offerta, anche prezzo e costo fisso della nuova offerta devono essere completi;
- in caso di dati mancanti non vengono mostrati importi, offerte precedenti o vecchi risparmi;
- la pagina evidenzia le caselle mancanti e porta l'utente direttamente alla prima da completare;
- le etichette sono formulate come domande semplici: consumo annuo, prezzo luce/gas e costo fisso della bolletta.

Cosa e' stato toccato:

- solo `public/index.html`;
- nessuna modifica a formule economiche, perdite di rete, ranking, dati ARERA, offerte partner, OTP, PDF, lead, Supabase o consensi.

Verifiche v71:

- profilo Plenitude completo accettato: OK;
- quota fissa vuota bloccata prima del calcolo: OK;
- quota fissa zero inserita esplicitamente accettata: OK;
- guardia dati incompleti eseguita prima di `calcolaDifferenza`: OK;
- sintassi di tutti i blocchi JavaScript inline: OK;
- `npm run validate:calculator`: OK;
- `npm run verify:offers`: OK, 0 errori e 0 warning.

## Punto v70 - campi coerenti con bolletta e quota fissa mese/anno

Problema risolto:

- le etichette `Prezzo Spesa` e `Fisso` non aiutavano l'utente a individuare i valori corretti nella bolletta;
- molte bollette mostrano la quota fissa in euro al mese, mentre il motore lavora internamente con valori annuali.

Regola v70:

- il prezzo da inserire e identificato come `Prezzo vendita`, con richiamo alla riga `Quota per consumi - di cui spesa per la vendita`;
- per la nuova offerta viene richiamato anche il termine `corrispettivo energia/gas`;
- ogni quota fissa ha un selettore esplicito `€/mese` o `€/anno`;
- se l'utente inserisce un valore mensile, il calcolatore lo annualizza automaticamente;
- PDF, dati medi e offerte ARERA continuano a compilare valori annuali impostando automaticamente `€/anno`.

Cosa e' stato toccato:

- `public/index.html` per testi, quattro selettori e conversione mese/anno;
- `lib/pdfExtract.js` e incluso nello zip solo per consegnare insieme la correzione Plenitude v69;
- nessuna modifica a prezzi, formule economiche, ranking, dati ARERA, offerte partner, OTP, lead, Supabase o consensi.

Verifiche v70:

- `12 €/mese` e `144 €/anno` producono entrambi `144 €/anno`: OK;
- quattro selettori presenti con ID univoci: OK;
- sintassi dei blocchi JavaScript della pagina: OK;
- `node scripts/validate-calculator-data.mjs`: OK;
- `node scripts/verify-calcolo-offerte.mjs`: OK, 0 errori e 0 warning.

## Punto v69 - lettura bolletta Plenitude dual

Problema risolto:

- una bolletta Eni Plenitude veniva classificata erroneamente come Acea perche la ricerca generica `acea` intercettava la parola `cartacea`;
- il formato Plenitude separa alcune etichette su piu righe e il parser non leggeva consumi annui, POD, PDR e quote fisse;
- il prezzo luce poteva essere confuso con il prezzo medio totale e il prezzo gas con lo sconto domiciliazione.

Regola v69:

- il riconoscimento del fornitore usa nomi completi con confini di parola;
- per lo Scontrino dell'energia viene letta la componente di vendita, non il prezzo medio comprensivo di rete e oneri;
- le quote fisse mensili di vendita vengono annualizzate;
- vengono letti consumi annui, potenza impegnata, POD e PDR anche nel layout Plenitude;
- il documento resta sempre `needsReview: true`: i dati devono essere confermati dall'utente prima del confronto.

Cosa e' stato toccato:

- solo `lib/pdfExtract.js`;
- nessuna modifica a frontend, motore di calcolo, ranking, dati ARERA, offerte partner, OTP, lead, Supabase o consensi.

Verifiche v69:

- fattura Plenitude dual: fornitore, consumi annui, prezzi vendita, quote fisse, potenza, POD e PDR riconosciuti;
- regressione fattura Hera dual: campi principali ancora riconosciuti;
- `node scripts/validate-calculator-data.mjs`: OK;
- `node scripts/verify-calcolo-offerte.mjs`: OK, 0 errori e 0 warning.

## Punto v68 - workflow ARERA senza esecuzione giornaliera

- rimossa soltanto la pianificazione `schedule` che generava email di errore per i 403 del Portale Offerte;
- mantenuto `workflow_dispatch`, quindi il pulsante manuale GitHub resta disponibile;
- nessuna modifica allo script ARERA o al motore del calcolatore.

## Punto v67 - correzione minima offerte dual ARERA-first

Problema:

- con il filtro `Dual Fuel`, il motore poteva combinare la migliore riga luce e la migliore riga gas dello stesso fornitore anche quando non erano la stessa offerta commerciale;
- questo poteva far comparire offerte sbagliate nel blocco dual, ad esempio coppie costruite da offerte singole;
- alcune offerte partner attivabili rischiavano di usare prezzi statici o righe ARERA non coerenti con il funnel commerciale.

Regola v67:

- se la tendina e' `Dual Fuel`, il calcolatore deve restituire solo offerte dual coerenti;
- per le offerte ARERA non partner, la coppia luce/gas viene considerata dual solo quando le due righe puntano alla stessa pagina/offerta ARERA;
- per le offerte partner attivabili, il prezzo viene aggiornato dai dati ARERA coerenti con quella specifica offerta partner;
- il partner aggiunge link, stato commerciale e tracciamento, ma non deve sostituire il prezzo ARERA;
- E.ON dual fisso deve usare `E.ON Luce Insieme` + `E.ON Gas Insieme`, non `LuceClick/GasClick`;
- A2A Start deve agganciare righe ARERA Start, non Click;
- Magis e Segnoverde restano esclusi dal dual.

Cosa e' stato toccato:

- solo `public/index.html`;
- nessuna modifica a OTP, lead, Supabase, consensi, link affiliati, PDF, pagine SEO o loghi.

Verifiche v67:

- `node scripts/validate-calculator-data.mjs`: OK;
- `node scripts/verify-calcolo-offerte.mjs`: OK, 0 errori, 0 warning;
- controllo sintassi script inline di `public/index.html`: OK.

## Punto v60 - prima spinta SEO pagina offerte aggiornate

Obiettivo:

- iniziare l'indicizzazione organica senza promettere una "migliore offerta" assoluta;
- posizionare OffertaLogica sul concetto distintivo: il confronto cambia con i consumi reali;
- collegare la pagina SEO principale dalla homepage e dalla sitemap.

Modifiche v60:

- `public/offerte-luce-gas-aggiornate.html` passa da `noindex,follow` a `index,follow`;
- aggiornati title, meta description, Open Graph e H1;
- aggiunti dati strutturati `WebPage` e `FAQPage`;
- aggiunta nota dinamica che legge `public/data/offerte-arera-menu.json` e mostra la data ARERA disponibile;
- aggiunto link interno "Offerte aggiornate" nel footer homepage;
- aggiunta pagina `offerte-luce-gas-aggiornate.html` in `public/sitemap.xml` e `sitemap.xml`.

Regola contenuti:

- non scrivere "migliori offerte luglio 2026" come promessa assoluta;
- usare formule come "offerte aggiornate", "confronto sui consumi reali", "non esiste una migliore per tutti";
- le tabelle orientano, ma il calcolatore resta il punto centrale.

Cosa non e' stato toccato:

- motore di calcolo;
- ranking;
- JSON ARERA;
- offerte partner;
- OTP;
- lead;
- Supabase;
- consensi;
- link affiliati.

Verifiche v60:

- pagina SEO senza `noindex`: OK;
- pagina presente in sitemap pubblica e root: OK;
- `npm run validate-calculator-data`: OK;
- `npm run verify-calcolo-offerte`: OK, 0 errori, 0 warning.

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

## Punto v61 - Pagina SEO offerte aggiornata con fonte ARERA live

Data: 2026-07-13.

Base di partenza:

- `offertalogica-v60-seo-offerte-aggiornate-20260713`.

Problema rilevato:

- La pagina `public/offerte-luce-gas-aggiornate.html` mostrava correttamente la nota "Dati ARERA aggiornati al 13 luglio 2026", ma le tabelle visibili delle offerte leggevano ancora i prezzi da `offerte-proposte.json`.
- `offerte-proposte.json` contiene dati commerciali/partner e puo restare indietro rispetto al file ARERA aggiornato.

Cosa e stato corretto:

- La pagina SEO ora legge i prezzi visibili da `public/data/offerte-arera-menu.json`.
- `offerte-proposte.json` viene usato solo per capire quali fornitori hanno un percorso partner attivabile online.
- Nelle righe tabellari, nome offerta, prezzo luce, prezzo gas e quota fissa vengono dalla stessa riga/sorgente ARERA aggiornata.
- Per evitare righe incoerenti, la pagina filtra offerte ARERA in cui nome o URL rimandano chiaramente a un altro marchio.
- Le offerte consulente vengono costruite dai fornitori non partner presenti nel file ARERA aggiornato.

Cosa non e stato toccato:

- Motore di calcolo.
- Regola ARERA-first.
- Ranking del calcolatore.
- Offerte partner operative nel calcolatore.
- OTP.
- Lead.
- Supabase.
- Consensi.
- Link affiliati.
- Tracciamento.

Regola da mantenere:

- Ogni volta che `offerte-arera-menu.json` viene aggiornato, anche la pagina `offerte-luce-gas-aggiornate.html` deve mostrare automaticamente i nuovi valori.
- La pagina SEO non deve tornare a usare `offerte-proposte.json` come fonte dei prezzi visibili.

Verifiche eseguite:

- Sintassi JavaScript della pagina: OK.
- Simulazione caricamento pagina con dati locali: OK, righe aggiornate al `2026-07-13`.
- `/Users/simo78/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/validate-calculator-data.mjs` OK.
- `/Users/simo78/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-calcolo-offerte.mjs` OK, 0 errori, 0 warning.

## Punto v76 - UX grafica offerta specifica e consumi sincronizzati

Data: 2026-07-14.

Base di partenza:

- `offertalogica-v75-popup-otp-schede-coerenti-20260714-incrementale`.

Obiettivo:

- Rendere piu chiara e gradevole la sezione facoltativa per confrontare un'offerta o un fornitore specifico.
- Evitare la duplicazione visiva dei consumi, che erano gia sincronizzati con la fornitura attuale.
- Non modificare motore di calcolo, PDF, catalogo offerte, OTP, lead o consensi.

Cosa e stato modificato in `public/index.html`:

- Nuova gerarchia grafica della scheda facoltativa con badge, testo breve e due azioni riconoscibili.
- Pulsante `Carica una scheda sintetica` che porta al caricatore PDF gia esistente.
- Pulsante `Inserisci una proposta manualmente` che apre o chiude i campi economici senza aggiungere passaggi al percorso normale.
- Il menu fornitore resta sempre visibile e, quando viene selezionato, apre automaticamente i dettagli dell'offerta caricata dal catalogo.
- I campi duplicati dei consumi nella colonna destra sono diventati input nascosti, mantenendo gli ID e la logica esistenti.
- A video compare ora un riepilogo in sola lettura dei consumi luce e gas, sincronizzato in tempo reale con la fornitura attuale.
- Aggiunto il comando `Modifica a sinistra`, che porta ai consumi della fornitura attuale.
- I dettagli economici si aprono automaticamente anche quando:
  - viene selezionato un fornitore;
  - il fornitore non e presente nel catalogo;
  - viene caricata una scheda sintetica;
  - un campo della nuova offerta deve essere corretto.
- Il reset PDF richiude i dettagli e azzera correttamente il riepilogo.
- Su schermi fino a 600 px anche la fornitura attuale passa a una sola colonna, eliminando l'overflow orizzontale dei campi luce/gas.

Cosa non e stato toccato:

- Formule e motore di calcolo.
- Sincronizzazione logica dei consumi.
- Lettura e conferma PDF.
- Evidenziazione e focus dei campi mancanti.
- Catalogo fornitori e selezione automatica delle offerte.
- OTP, lead, database, webhook e consensi.
- Ranking e risultati del confronto.

Verifiche eseguite:

- Sintassi di tutti gli script inline con `node --check`: OK.
- Controllo ID duplicati nell'HTML: nessun duplicato.
- Test browser delle interazioni principali tramite Chrome DevTools Protocol:
  - sincronizzazione consumo attuale -> input nascosto -> riepilogo visivo: OK;
  - apertura e chiusura dettagli manuali: OK;
  - selezione `Altro` apre i campi manuali: OK;
  - caricamento simulato scheda sintetica apre e compila i dettagli: OK;
  - reset richiude la sezione e azzera il riepilogo: OK.
- Verifica statica desktop e mobile: OK.
- Corretto overflow orizzontale mobile della griglia luce/gas.

## Aggiornamento v79 — messaggio dopo conferma PDF

- Rimosso il riferimento al “pulsante blu”: la guida usa ora il nome esatto dell’azione.
- Eliminata la frase che dichiarava completi i dati letti dal PDF.
- Dopo una scheda sintetica viene ricordato che per il confronto servono anche i dati della fornitura attuale, ottenibili caricando la bolletta o inserendoli manualmente.
- Dopo una bolletta la guida invita a controllare i valori e premere “Mostra le offerte disponibili”.
- Nessuna modifica a calcoli, parsing PDF, validazioni, OTP o catalogo offerte.

## Punto v91 - Regressioni parser dual, spread e archivio staff

Data: 2026-07-15.

Punto di ripristino GitHub creato prima delle modifiche:

- commit di partenza `6be0a087c32875f09ab39bed72eefc69ddef6e77` su `main`;
- tag protetto `pre-parser-regression-patch`;
- branch protetto `fix/parser-regression-archive`;
- non usare reset o checkout della v89 e non eliminare tag o branch di ripristino.

Versione parser:

- `v91-dual-offer-regression-1`.

Cosa e stato corretto:

- Nei documenti dual i dati dell'offerta luce e gas restano separati e non si sovrascrivono.
- Aggiunti nel JSON normalizzato i campi:
  - `nome_offerta_luce`, `codice_offerta_luce`, `tipo_prezzo_luce`, `indice_riferimento_luce`, `spread_luce_eur_kwh`;
  - `nome_offerta_gas`, `codice_offerta_gas`, `tipo_prezzo_gas`, `indice_riferimento_gas`, `spread_gas_eur_smc`.
- I campi generici `nome_offerta`, `codice_offerta`, `tipo_prezzo` e `indice_riferimento` restano disponibili per compatibilita, ma nei documenti dual sono compilati solo se il valore e realmente comune.
- Hera Hybrid viene classificata come `ibrido`, non come semplice prezzo fisso.
- Plenitude dual mantiene nomi e codici distinti per Fixa Time Luce Base e Fixa Time Gas Base.
- Dolomiti luce e gas estraggono lo spread vicino alla struttura economica dell'offerta senza confonderlo con perdite, rete o oneri.
- ButanGas business riconosce PUN Index GME, prezzo variabile, spread luce, prezzo medio di vendita e indirizzo reale.
- Gli indirizzi composti da istruzioni o frasi informative vengono rifiutati e segnalati per revisione.
- L'area `public/staff-pdf.html` mostra e permette di correggere i nuovi campi separati, mantenendo i campi generici per i record gia archiviati.

Schema dati:

- nessuna migrazione Supabase;
- nessuna nuova tabella o colonna;
- i nuovi valori sono salvati nei JSON `normalized_data` e `confirmed_data` gia esistenti.

Cosa non e stato toccato:

- motore di calcolo e ranking offerte;
- regola ARERA-first e dati partner;
- OTP, lead, consensi e Supabase;
- archivio PDF e relative API;
- pagine pubbliche del calcolatore.

Test di regressione aggiunti:

- Hera dual;
- Eni Plenitude dual;
- Dolomiti luce;
- Dolomiti gas;
- ButanGas business;
- presenza e compatibilita dei campi nella pagina staff PDF.

Verifiche eseguite:

- test JavaScript: 30 superati, 0 falliti;
- test Python aggiornamento ARERA: 2 superati;
- `npm run validate:calculator`: OK;
- `npm run verify:offers`: OK, 0 errori e 0 warning;
- sintassi JavaScript: OK;
- funzioni presenti in `api`: 12.

Regola da mantenere:

- ogni futura modifica del parser deve conservare questi test e non deve ricondurre i documenti dual a un unico nome/codice offerta generico.
