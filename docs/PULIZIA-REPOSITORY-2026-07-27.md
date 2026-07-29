# Pulizia repository - 2026-07-27

## Base

Audit eseguito sul contenuto di
`offertalogica-vercel-lettura-IA-pura.1 (1).zip`.

## Rimossi

- copie annidate delle release v24, v70 e v75;
- pacchetti ZIP e hotfix storici presenti nella root;
- appunti di installazione e README superati;
- vecchio stack parser regex, OCR, hybrid e shadow non importato dal percorso
  pubblico;
- test riferiti esclusivamente al vecchio stack;
- script monouso gia applicati;
- anteprima grafica locale;
- duplicati root di sitemap e verifica Google gia presenti in `public/`;
- cartella `doc/` duplicata;
- report shadow storici;
- loghi duplicati non referenziati da `provider-brand.json`;
- report e downloader loghi non piu coerenti con il catalogo curato.
- vecchio CSV ARERA senza estensione, datato 18 giugno e non referenziato;
- collegamento locale `node_modules` verso una cartella Step 8 esterna.

## Conservati

- tutte le 12 API;
- `api/analyze-pdf.js` e il lettore IA pura;
- contratto dati, validazione, diagnostica e archivio PDF;
- tutte le pagine pubbliche e staff operative;
- cataloghi ARERA, partner, brand e dati commerciali;
- workflow e procedure ARERA;
- test del codice effettivamente raggiungibile;
- entrambi i file Google di verifica pubblici;
- documentazione tecnica e commerciale ancora utile.

## Correzioni collaterali

- `vercel.json` non riscrive piu il JSON ARERA verso un'API inesistente.
- Rimossi asset OCR inutilizzati dalla configurazione Vercel.
- Il workflow ARERA manuale accetta sorgente e data.
- `check-env` accetta correttamente Aruba oppure Twilio.
- I testi frontend di revisione non citano piu OCR.
- Aggiunti `.gitignore` e `.env.example`.

## Integrazione

Al momento dell'audit il branch IA pura era avanti di sette commit e indietro di
un commit rispetto a `main`. Il commit presente solo su `main` aggiornava i due
cataloghi ARERA. Integrare tramite branch/PR e non sostituire quei file con
copie meno recenti.
