# Stato progetto OffertaLogica

## Versione dati v93

- Catalogo ARERA/AU come fonte unica per prezzi, quote, codici e validita.
- Trasformazione unica in `scripts/update-arera-menu.py`.
- Staging, quarantena e pubblicazione atomica attivi.
- Nessun recupero selettivo di singole offerte precedenti.
- Cataloghi privato e business separati.
- Calcolatore, ranking, SEO, pagine fornitore e partner allineati allo stesso JSON.
- Metadati partner limitati a logo, URL e contenuti non economici.
- Diagnostica catalogo disponibile nella pagina staff analytics.

## Regola operativa

Offerta non letta o non validata con certezza = offerta non pubblicata.

Se l'aggiornamento del giorno fallisce, resta pubblicato integralmente il catalogo precedente. Nessuna riga vecchia viene mescolata al catalogo nuovo.

## Verifiche obbligatorie

Prima di distribuire modifiche al catalogo eseguire:

```bash
npm run test:arera
npm run validate-calculator-data
npm run verify-calcolo-offerte
npm run test:ranking-arera
npm run test:js
```

Il parser bollette, OTP, lead, Supabase e archivio PDF sono componenti separati e non devono essere modificati durante interventi sul catalogo ARERA.
