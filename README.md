# OffertaLogica

Comparatore luce e gas per privati e aziende, con catalogo ARERA, offerte
partner, verifica OTP, archivio lead e lettura nativa delle bollette PDF tramite
IA.

## Struttura

- `public/`: sito, pagine informative, pannelli staff e risorse statiche.
- `api/`: 12 funzioni serverless Vercel.
- `lib/`: moduli server condivisi.
- `data/`: cataloghi ARERA, offerte, brand e report di verifica.
- `scripts/`: aggiornamento e validazione dei cataloghi.
- `test/`: test Node e Python del codice attivo.
- `supabase/`: schema dell'archivio PDF di test.
- `docs/`: documentazione tecnica e commerciale corrente.

## Lettore PDF

`api/analyze-pdf.js` invia il PDF originale a OpenAI tramite
`lib/pdfPureAiReader.js`. Il percorso pubblico non usa parser regex, OCR o
lettori shadow.

- Reader: `pure-ai-native-pdf-v1.0.3`.
- Modello predefinito: `gpt-4.1-2025-04-14`.
- Output: contratto dati normalizzato, stato dei campi, evidenze e piano di
  autocompilazione.
- File grandi: caricamento firmato nel bucket Supabase privato.
- Archivio di test: facoltativo e controllato da variabili server.

La service role Supabase e la chiave OpenAI sono usate soltanto dalle API e non
devono mai comparire nel browser.

## Variabili ambiente

Partire da `.env.example`. In produzione servono almeno:

- `OTP_SECRET`;
- credenziali Redis/Upstash;
- un provider SMS completo, Aruba oppure Twilio;
- `OPENAI_API_KEY`;
- variabili Supabase server se `PDF_ARCHIVE_MODE` non e `off`.

Verifica configurazione:

```bash
npm run lint
```

## Test

```bash
npm test
npm run test:python
npm run test:pdf-reader
npm run verify:offers
```

I controlli del catalogo sono disponibili anche con:

```bash
npm run validate:calculator
npm run test:ranking-arera
npm run test:partner-arera
```

## Catalogo ARERA

La trasformazione canonica e `scripts/update-arera-menu.py`. Aggiorna insieme:

- `data/offerte-arera-menu.json`;
- `public/data/offerte-arera-menu.json`;
- `data/arera-update-report.json`.

Il workflow GitHub supporta sia il download automatico sia una cartella
contenente i tre XML E, G e D caricati nel repository. La procedura locale per
macOS e `scripts/aggiorna-arera-locale-mac.sh`.

## API

Il progetto contiene esattamente 12 funzioni:

`analyze-pdf`, `health`, `lead`, `offer-consent`, `send-otp`,
`staff-analytics`, `staff-leads`, `staff-pdf-analyses`, `staff-preview`,
`track-event`, `unlock-offers`, `verify-otp`.

Non aggiungere nuove funzioni senza verificare prima il limite del piano
Vercel.

## Rientro operativo

Prima di apportare modifiche leggere:

- `CONTINUA-DA-QUI-CODEX.md`;
- `docs/STATO-PROGETTO-OFFERTALOGICA.md`;
- `docs/PULIZIA-REPOSITORY-2026-07-27.md`.
