# CONTINUA DA QUI - OffertaLogica

Ultimo aggiornamento: 2026-07-27

## Base da usare

La base esaminata e il branch `lettura-IA-pura.1`, consegnato nello ZIP
`offertalogica-vercel-lettura-IA-pura.1 (1).zip`.

Non sovrascrivere `main` caricando alla cieca l'intero ZIP: al momento
dell'audit `main` aveva un commit ARERA piu recente nei due file
`offerte-arera-menu.json`. Integrare il lettore tramite branch/PR e conservare i
dati ARERA piu nuovi di `main`.

## Stato lettore PDF

- Percorso pubblico unico: `api/analyze-pdf.js` -> `lib/pdfPureAiReader.js`.
- Reader: `pure-ai-native-pdf-v1.0.3`.
- Modello predefinito: `gpt-4.1-2025-04-14`.
- Il PDF originale viene letto nativamente dall'IA.
- Parser regex, OCR e shadow reader sono stati rimossi perche non raggiungibili
  dal percorso pubblico.
- Il contratto dati, la validazione campi, la diagnostica e l'archivio PDF
  restano attivi.
- Le credenziali OpenAI e Supabase rimangono esclusivamente server-side.

## Regole da non rompere

- Non modificare formule, ranking o filtri del calcolatore durante lavori sul
  lettore PDF.
- Le offerte dual devono provenire dal catalogo dual ARERA; non inventare dual
  unendo due offerte singole.
- Le offerte partner attivabili restano il primo blocco commerciale, usando
  prezzi e coerenza del catalogo ARERA.
- Mantenere separati prezzo materia, quota fissa, potenza/ambito e totale.
- Prima dell'OTP non mostrare importi riservati nelle card.
- Non modificare OTP, consensi, lead, Supabase o link affiliati senza una
  richiesta esplicita.
- Non aggiungere API: il progetto ne contiene gia 12.
- Non fare deployment durante audit, pulizie o test locali.

## Archivio PDF

- Bucket privato: `pdf-test-archive`.
- Tabella e bucket: `supabase/pdf-analysis-archive.sql`.
- Pagina staff: `/staff-pdf.html#token=...`.
- Pulizia retention:
  `/api/staff-pdf-analyses?action=cleanup`, autorizzata con
  `Authorization: Bearer CRON_SECRET`.
- `PDF_ARCHIVE_RETENTION_DAYS` determina `expires_at`.

## Aggiornamento ARERA

- Trasformatore canonico: `scripts/update-arera-menu.py`.
- Workflow: `.github/workflows/update-arera-menu.yml`.
- Aggiornamento locale macOS: `scripts/aggiorna-arera-locale-mac.sh`.
- Il workflow manuale accetta `source_dir` e `as_of`.
- Se il download non e valido, il catalogo esistente non deve essere
  sovrascritto.

## Stato test al punto di pulizia

Prima della pulizia:

- i test IA pura erano verdi;
- la suite completa era rossa solo per test legacy che importavano il vecchio
  parser/OCR e un modulo gia mancante;
- `verify:offers` era verde;
- i 13 test Python ARERA erano verdi;
- `validate:calculator` e `test:ranking-arera` segnalavano il problema dati
  preesistente `vere offerte dual mancanti`.

La pulizia deve essere accettata solo dopo la nuova esecuzione completa dei
test attivi e il controllo dei link pubblici.

## Prossimo passo corretto

1. Verificare lo ZIP pulito in un branch.
2. Controllare Preview con le variabili server.
3. Provare bollette reali senza cambiare il calcolatore.
4. Integrare in `main` tramite PR, conservando i file ARERA piu recenti.
5. Nessun deployment automatico da questo pacchetto.
