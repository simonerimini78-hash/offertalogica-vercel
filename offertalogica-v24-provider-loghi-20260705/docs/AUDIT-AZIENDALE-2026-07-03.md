# Audit aziendale OffertaLogica

Aggiornamento: 2026-07-03

## Stato operativo

OffertaLogica ha oggi una base funzionante:

- calcolatore pubblico con dati esterni in `public/data/calcolo-parametri.json` e `public/data/offerte-proposte.json`;
- caricamento PDF collegato al backend;
- popup lead con consensi separati;
- OTP con provider configurabili;
- database clienti proprietario tramite Supabase;
- modalita staff per provare il flusso senza salvare lead;
- pagina staff per leggere lead recenti;
- pagine pubbliche `come-funziona`, `partner`, `casa-smart` e `internet-casa`;
- sitemap, robots, Iubenda e verifica Tradedoubler presenti.

## Verifiche tecniche eseguite

```text
npm run validate:calculator
```

Esito:

- motore caricato correttamente;
- 19 offerte lette;
- dati sincronizzati tra `data/` e `public/data/`;
- confronto solo luce/gas non gonfiato sulle commodity escluse.

```text
npm run audit:offers
```

Esito:

- offerte analizzate: 19;
- offerte certificate: 9;
- offerte coerenti senza rilievi: 5;
- offerte da verificare: 14;
- offerte da non pubblicare: 0.

## Correzioni fatte in questo audit

- Lo script `scripts/validate-calculator-data.mjs` ora valida `public/index.html`, che e la struttura reale usata da Vercel.
- `data/destinazioni-offerte.csv` e stato riallineato alle offerte attivabili:
  - E.ON fisso e variabile attive su Tradedoubler;
  - Enel attiva su Tradedoubler;
  - Plenitude attiva su Tradedoubler;
  - Alperia fisso e variabile attive su Awin;
  - Dolomiti fisso e variabile aggiunte come proposte consulenziali.
- Il README e i documenti tecnici ora citano il workflow corretto `.github/workflows/update-arera-menu.yml`.
- `docs/AUDIT-OFFERTE.md` viene rigenerato con data dinamica.

## Punti forti commerciali

- Il valore principale non e una lista di tariffe, ma la comparazione sui consumi reali dell'utente.
- Il PDF bolletta rende il lead piu qualificato rispetto a un semplice form.
- La modalita staff permette di mostrare il prodotto a partner o acquirenti senza sporcare il database.
- La pagina partner spiega bene il flusso: consumo, calcolo, consenso, OTP, scelta offerta.
- Le pagine laterali casa smart e internet permettono monetizzazione aggiuntiva senza contaminare il calcolatore energia.

## Punti mancanti prima della spinta forte

1. SMS produzione
   Aruba SMS va completato con alias approvato e variabili ambiente definitive. Finche l'OTP non e stabile, meglio non spingere traffico a pagamento.

2. Destinazione lead non attivabili
   Serve almeno una destinazione reale per offerte senza affiliazione diretta: partner CPL, broker, consulente, Switcho o accordo diretto. Altrimenti il lead resta nostro ma si raffredda.

3. Certificazione offerte
   Le offerte non certificate o con fonte generica devono essere chiuse con scheda sintetica, codice ARERA o fonte ufficiale. Priorita: NeN, Iren, Magis, E.ON variabile e commissioni Alperia.

4. Automazione ARERA
   Il workflow aggiorna il menu ARERA, ma non deve ancora sostituire automaticamente le offerte pubbliche. La promozione in `offerte-proposte.json` deve restare controllata finche non abbiamo regole certe per variabili, link e monetizzazione.

5. SEO editoriale
   Serve una pagina forte tipo "Migliori offerte luce e gas luglio 2026" che intercetti traffico Google e spinga al calcolatore: la tabella media puo essere pubblica, ma il messaggio deve portare alla bolletta reale.

6. Eventi conversione
   Andrebbero tracciati almeno:
   - click "elabora e confronta";
   - upload PDF riuscito;
   - popup lead aperto;
   - OTP inviato;
   - OTP verificato;
   - offerta cliccata;
   - consenso partner confermato.

7. Legal/compliance
   Iubenda e presente, ma prima di scala commerciale vera serve verifica finale di informativa, consensi, retention PDF/lead e rapporti con partner esterni.

## Priorita consigliata

1. Chiudere SMS Aruba in produzione.
2. Chiudere almeno una destinazione per lead non attivabili.
3. Completare certificazione delle offerte piu visibili.
4. Pubblicare una pagina SEO mensile sulle migliori offerte, con CTA verso calcolatore e upload bolletta.
5. Raffinare analytics/eventi conversione.

## Regola di manutenzione

Ogni modifica alle tariffe deve aggiornare insieme:

- `data/offerte-proposte.json`;
- `public/data/offerte-proposte.json`;
- `data/certificazione-offerte.csv`, se cambia prezzo o fonte;
- `data/destinazioni-offerte.csv`, se cambia link, partner o stato monetizzazione;
- `docs/AUDIT-OFFERTE.md`, rigenerando `npm run audit:offers`.

