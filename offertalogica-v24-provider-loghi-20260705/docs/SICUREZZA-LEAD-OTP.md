# Architettura sicura lead, PDF e OTP

Questa parte non deve vivere nel solo file statico GitHub Pages. Serve un backend HTTPS.

## Flusso consigliato

1. L'utente inserisce consumi o carica bolletta/scheda PDF.
2. Il frontend mostra una stima parziale: massimo risparmio potenziale e richiesta di verifica.
3. L'utente inserisce nome, telefono, email e accetta l'informativa privacy, includendo il trattamento dei dati inseriti o caricati per comparazione, ricontatto necessario e miglioramento interno del servizio in forma aggregata/anonimizzata.
4. Il backend crea un lead in stato `pending_otp`.
5. Il backend invia SMS OTP tramite provider certificato/contrattualizzato.
6. L'utente inserisce OTP.
7. Il backend conferma il lead e restituisce le 3 migliori offerte complete.

## Dati da salvare

- Nome e cognome
- Email
- Telefono normalizzato
- Consumi luce/gas
- Fornitore attuale, se noto
- Esito calcolo sintetico
- Consensi separati: richiesta comparazione/ricontatto necessario e trasmissione dati a partner su offerta specifica
- Timestamp consenso, IP, user agent, versione informativa
- Stato OTP: pending, verified, expired
- Origine dato: `pdf_upload`, `manual_input`, `arera_average_profile`, `business_profile`

## Consensi nel popup lead

Per ridurre attrito e aumentare la conversione, il popup pubblico parte con una sola casella obbligatoria:

- richiesta comparazione, ricontatto necessario alla gestione della richiesta e trattamento dei dati inseriti/caricati per miglioramento interno del servizio anche in forma aggregata e anonimizzata.

Per i privati, il consenso alla trasmissione dati al fornitore/partner viene richiesto in un secondo popup solo quando l'utente sceglie una specifica offerta. L'OTP conferma il numero di telefono, ma non sostituisce quel consenso. Il record lead deve salvare la versione dell'informativa, il timestamp lato client, il timestamp lato server, IP, user agent e origine del popup.

Per le aziende, il popup resta unico: se il numero viene verificato via OTP, la richiesta puo essere inoltrata al CRM o consulente incaricato della pratica business.

Se l'utente non presta un consenso marketing separato, il lead non deve essere usato per campagne promozionali generiche. Puo essere gestito solo per la richiesta effettivamente avviata dall'utente, nei limiti della base giuridica indicata nell'informativa.

## PDF

- Upload solo via HTTPS.
- Limite dimensione file.
- Controllo MIME e scansione antivirus.
- Estrazione testo in area temporanea.
- Eliminazione automatica del PDF dopo estrazione, salvo consenso specifico alla conservazione.
- Salvataggio nel database solo dei dati tecnici normalizzati, non del PDF originale.
- Mascheramento di POD/PDR/codice fiscale nei log.

## OTP

- Codice generato solo lato server.
- Hash del codice salvato a database, mai codice in chiaro.
- Scadenza breve, ad esempio 5 minuti.
- Massimo 3-5 tentativi.
- Rate limit per IP e per numero di telefono.
- Log degli eventi senza salvare il contenuto dell'SMS.

## Notifica operativa lead

Il lead privato puo uscire verso partner CPL/CPA solo dopo due passaggi:

1. OTP verificato, per confermare numero e identita operativa del lead;
2. consenso specifico sull'offerta scelta, per autorizzare il ricontatto o la trasmissione dati al fornitore/partner.

Il lead business puo uscire verso CRM/consulente con evento `business_consulting_request` dopo OTP verificato, perche la richiesta aziendale non mostra una lista di attivazioni self-service.

- Variabile: `LEAD_WEBHOOK_URL`.
- Segreto opzionale: `LEAD_WEBHOOK_SECRET`, inviato come header `X-Lead-Webhook-Secret`.
- Se il webhook fallisce, il lead resta comunque verificato e il record conserva l'errore di notifica.
- Il webhook non deve ricevere PDF originali, ma solo dati estratti e normalizzati.

## Modalita staff/test

La modalita staff serve solo al titolare o a persone autorizzate per controllare calcolatore, offerte, popup e landing senza creare lead reali.

- Variabile: `STAFF_PREVIEW_TOKEN`.
- Link consigliato: `https://offertalogica.it/#staff=IL_TUO_TOKEN`, per evitare che il token venga inviato nella richiesta iniziale della pagina.
- Il token viene rimosso dalla barra indirizzi dopo l'attivazione.
- In modalita staff non vengono chiamati `api/lead`, `api/send-otp`, `api/verify-otp` e `api/offer-consent`.
- Il codice OTP simulato e `000000`.
- Non condividere il token con consulenti, partner o utenti finali.

## Sicurezza

- HTTPS obbligatorio.
- Database cifrato a riposo o almeno campi sensibili cifrati.
- Segreti in variabili ambiente, mai nel repository.
- Accesso amministrativo con MFA.
- Backup cifrati.
- Retention definita: eliminazione dei lead non confermati dopo pochi giorni.
- Audit log accessi ai lead.

## Privacy e normativa

La base deve rispettare GDPR e normativa italiana:

- informativa chiara prima dell'invio dati;
- minimizzazione dei dati;
- consensi separati, soprattutto per marketing e comunicazione a partner;
- prova del consenso;
- possibilita di revoca;
- nomina dei responsabili esterni, per esempio provider SMS, hosting, CRM.

Riferimenti utili:

- Regolamento UE 2016/679, in particolare art. 5, 6, 7, 13, 28 e 32.
- Garante Privacy per indicazioni su informativa, consensi e marketing.

## Aziende

La sezione business deve essere separata dalla logica domestica:

- potenza impegnata e tensione;
- fasce F1/F2/F3;
- consumi mensili/stagionali;
- P.IVA, ragione sociale e referente;
- profilo gas con usi diversi;
- offerte business separate da offerte domestiche.
