# Registro lead e CRM leggero

Il registro operativo puo essere un Google Sheet o un CRM leggero, ma non deve essere l'unico archivio. Lo storico proprietario consigliato e il database clienti descritto in `docs/DATABASE-CLIENTI.md`.

Google Sheet/CRM serve a lavorare le pratiche. Il database clienti serve a conservare il patrimonio OffertaLogica: consumi, consensi, offerte viste/scelte e storico utile per ricontatti futuri.

Template colonne:

```text
data/template-registro-lead.csv
```

## Quando nasce una riga

Una riga deve essere creata quando succede uno di questi eventi:

- `business_consulting_request`: lead business verificato con OTP;
- `offer_partner_consent`: utente privato verificato che sceglie una specifica offerta e conferma il consenso partner.

Il semplice sblocco delle offerte non deve essere venduto o inviato a partner se manca il consenso partner.

## Stati lavorazione

```text
nuovo                       Lead appena ricevuto.
da_contattare               Da lavorare manualmente o assegnare a partner.
inviato_partner             Inviato a fornitore, broker, consulente o network.
in_lavorazione              Partner/consulente sta gestendo il lead.
vendita_confermata          Contratto o conversione confermata.
scartato                    Lead non valido o non lavorabile.
pagato                      Commissione incassata.
```

## Campi chiave

- `lead_id`: identificativo generato dal sito.
- `event`: tipo evento ricevuto dal webhook.
- `customer_type`: `privato` o `business`.
- `best_saving`: risparmio stimato.
- `offerta_id`, `offerta_nome`, `offerta_fornitore`: offerta scelta.
- `destination_type`: affiliazione, partner lead, richiamami.
- `destination_status`: stato della destinazione commerciale.
- `monetization_status`: stato salvato dal backend.
- `tracking_page`, `tracking_clicked_at`: prova del click sul percorso offerta.
- `consenso_servizio`, `consenso_partner`: consensi raccolti.
- `stato_lavorazione`: stato operativo interno.
- `commissione_prevista`, `commissione_confermata`: valori economici.

## Regola commerciale

Un lead ha valore monetizzabile solo se:

1. telefono verificato tramite OTP;
2. consenso servizio presente;
3. consenso partner presente quando viene inviato a terzi;
4. offerta scelta registrata;
5. destinazione commerciale chiara.

## Prima configurazione consigliata

1. Crea un Google Sheet chiamato `OffertaLogica - Registro Lead`.
2. Importa `data/template-registro-lead.csv`.
3. Cancella la riga demo dopo aver verificato le colonne.
4. Collega il webhook quando scegliamo Make, Zapier, Google Apps Script o CRM.
5. Aggiorna `stato_lavorazione` manualmente finche non automatizziamo il processo.

## Nota privacy

Il registro contiene dati personali. Deve essere accessibile solo a persone autorizzate e coerente con informativa privacy, consensi, retention e accordi con eventuali partner.
