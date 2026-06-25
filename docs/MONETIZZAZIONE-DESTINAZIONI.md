# Monetizzazione e destinazioni offerte

Questo documento separa il calcolo tecnico dalla destinazione commerciale.

- `data/offerte-reali-arera-candidati.csv`: dati economici e tariffe per il calcolo.
- `data/destinazioni-offerte.csv`: uscita commerciale, link tracking, partner e stato monetizzazione.

## Stati destinazione

```text
da_cercare                  Non esiste ancora un canale concreto.
da_contattare               Fornitore individuato, contatto commerciale da avviare.
in_attesa_approvazione      Candidatura inviata, ma link non attivo.
approvata                   Partner approvato, manca inserimento link o test.
attiva                      Link/partner operativo e tracciamento verificato.
sospesa                     Da non mostrare come uscita monetizzata.
```

## Tipi destinazione

```text
affiliazione                Link tracciato CPA/CPS verso fornitore o network.
partner_lead                Lead inviato a consulente, call center o broker.
richiamami                  Lead interno da lavorare manualmente.
da_definire                 Destinazione non ancora decisa.
```

## Regola operativa

Un'offerta puo diventare monetizzata solo quando:

1. esiste un link tracking ufficiale o un partner operativo;
2. il modello pagamento e chiaro;
3. il consenso partner e coerente con la destinazione;
4. il click o l'invio lead viene registrato con `leadId`, offerta, timestamp e stato.

## Tracking scelta offerta

Quando l'utente clicca una specifica offerta e conferma il consenso partner, `api/offer-consent.js` salva nel lead:

```text
selectedOffer
monetization.status
monetization.destinationType
monetization.destinationStatus
monetization.provider
monetization.trackedAt
monetization.tracking.page
monetization.tracking.clickedAt
```

Questi campi sono inclusi anche nel webhook lead, se `LEAD_WEBHOOK_URL` e configurato.

## Priorita attuale

Affiliazioni attive su Tradedoubler:

- Enel Italia, programma 348999, cookie 30 giorni, tasso cancellazione 0%;
- Eni Gas e Luce_CPL / Plenitude, programma 271844, cookie post-click 30 giorni, tasso cancellazione 62%, EPC medio 0.76 EUR.

Le candidature Awin in attesa sono:

- Octopus Energy;
- NeN;
- Alperia.

Fornitori da contattare direttamente:

- Sorgenia.

Appena una candidatura viene approvata, aggiornare `data/destinazioni-offerte.csv`:

```text
stato=approvata
link_tracking=link affiliato ufficiale
modello_pagamento=CPA confermato dal network
ultimo_aggiornamento=data modifica
```

Dopo aver testato il click e la registrazione, portare lo stato a:

```text
stato=attiva
```

## Fallback fino alle approvazioni

Finche non c'e una destinazione attiva, il sito puo:

- registrare l'interesse sull'offerta scelta;
- mostrare un messaggio di richiesta ricevuta;
- evitare redirect non tracciati che fanno perdere monetizzazione;
- usare il lead solo se il consenso partner e stato raccolto.

Non usare link generici dei fornitori come uscita monetizzata: informano l'utente, ma non garantiscono ricavo.
