# Installazione su Offertalogica-V100.1

Questo e un pacchetto incrementale. Non sostituisce il repository completo.

## Caricamento GitHub

1. Aprire il branch `Offertalogica-V100.1`.
2. Aprire questa cartella ZIP sul Mac.
3. Caricare nella root del branch tutte le cartelle e `package.json`, mantenendo i percorsi.
4. Non caricare il file ZIP chiuso.
5. Usare un messaggio commit come:

   `Aggiunge lettore PDF AI in shadow mode`

Il `package.json` incluso conserva anche `test:partner-arera`, gia presente nel branch.

## Variabili Vercel per la Preview

Impostare soltanto nell'ambiente Preview:

```text
PDF_AI_MODE=shadow
OPENAI_API_KEY=CHIAVE_OPENAI_SERVER
PDF_AI_MODEL=gpt-4.1-mini-2025-04-14
PDF_AI_TIMEOUT_MS=12000
PDF_ARCHIVE_MODE=all
PDF_ARCHIVE_BUCKET=pdf-test-archive
PDF_ARCHIVE_RETENTION_DAYS=180
SUPABASE_URL=URL_SUPABASE
SUPABASE_SERVICE_ROLE_KEY=CHIAVE_SERVICE_ROLE
```

Non inserire la chiave OpenAI nel codice o nel browser. Non abilitare `PDF_AI_MODE=shadow` in Production durante questa prova.

Se l'archivio Supabase non e configurato, il PDF non viene inviato all'IA.

## Prova

1. Attendere il deployment Preview del branch.
2. Aprire l'URL Preview, non `offertalogica.it`.
3. Caricare una bolletta di test.
4. Verificare che i dati mostrati al cliente siano quelli legacy, invariati.
5. Aprire l'archivio PDF staff e controllare `normalized_data._reader_shadow`.
6. Verificare candidati, pagine, evidenze, accordi e conflitti.

Lo shadow non modifica formule, ranking, offerte, OTP, lead o frontend.
