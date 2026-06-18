# Architettura sicura lead, PDF e OTP

Questa parte non deve vivere nel solo file statico GitHub Pages. Serve un backend HTTPS.

## Flusso consigliato

1. L'utente inserisce consumi o carica bolletta/scheda PDF.
2. Il frontend mostra una stima parziale: massimo risparmio potenziale e richiesta di verifica.
3. L'utente inserisce nome, telefono, email e accetta l'informativa privacy.
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
- Consensi separati: servizio richiesto, marketing, eventuale cessione a partner
- Timestamp consenso, IP, user agent, versione informativa
- Stato OTP: pending, verified, expired

## PDF

- Upload solo via HTTPS.
- Limite dimensione file.
- Controllo MIME e scansione antivirus.
- Estrazione testo in area temporanea.
- Eliminazione automatica del PDF dopo estrazione, salvo consenso specifico alla conservazione.
- Mascheramento di POD/PDR/codice fiscale nei log.

## OTP

- Codice generato solo lato server.
- Hash del codice salvato a database, mai codice in chiaro.
- Scadenza breve, ad esempio 5 minuti.
- Massimo 3-5 tentativi.
- Rate limit per IP e per numero di telefono.
- Log degli eventi senza salvare il contenuto dell'SMS.

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
