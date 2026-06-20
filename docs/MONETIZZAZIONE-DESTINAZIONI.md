# Monetizzazione e destinazioni offerte

Questo documento separa il calcolo tecnico dalla destinazione commerciale.

- `data/offerte-reali-arera-candidati.csv`: dati economici e tariffe per il calcolo.
- `data/destinazioni-offerte.csv`: uscita commerciale, link tracking, partner e stato monetizzazione.

## Stati destinazione

```text
da_cercare                  Non esiste ancora un canale concreto.
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

## Priorita attuale

Le candidature Awin in attesa sono:

- Eni Plenitude;
- Octopus Energy;
- NeN;
- Alperia.

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
