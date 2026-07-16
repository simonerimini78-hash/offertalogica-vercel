# Motore di calcolo

## Confine dei dati

Il motore applica i consumi dell'utente alle righe del catalogo ARERA v93 gia validate. Non interpreta XML, non corregge prezzi e non usa listini partner.

Per ogni commodity usa:

- consumo annuo;
- prezzo principale ARERA validato;
- quota fissa annua ARERA validata;
- componenti di profilo e regolate presenti in `data/calcolo-parametri.json`.

Il ranking economico e calcolato prima dell'etichetta commerciale. Logo, URL e priorita partner non modificano costo o posizione.

## Origini ammesse

- offerte: `public/data/offerte-arera-menu.json`;
- parametri generali: `public/data/calcolo-parametri.json`;
- brand visivi: `public/data/provider-brand.json`;
- metadati partner: annotazioni gia validate dentro il catalogo pubblico.

Se il catalogo non e disponibile o non ha `schemaVersion >= 93`, il sito non mostra prezzi statici sostitutivi.

## Privati e business

Il frontend privati carica esclusivamente `catalogo.offerte`. Le righe business restano in `catalogo.offerteBusiness` e non entrano nel ranking privato.

## Verifica

```bash
npm run validate-calculator-data
npm run verify-calcolo-offerte
npm run test:ranking-arera
```
