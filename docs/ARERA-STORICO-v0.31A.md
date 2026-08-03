# OffertaLogica — storico ARERA v0.31A

Questo incremento riguarda esclusivamente il processo centrale di aggiornamento ARERA sul branch `main`.

Aggiunge:

- `scripts/update-arera-history.py`
- aggiornamento del workflow `.github/workflows/update-arera-menu.yml`
- test automatici dello storico

Il workflow continua a generare il catalogo corrente e, subito dopo, mantiene:

- `data/offerte-arera-history.json`
- `public/data/offerte-arera-history.json`

Le offerte non più presenti nel catalogo giornaliero non vengono eliminate: restano nello storico con `active: false`.

Non modifica il comparatore, la PWA gratuita, le API, Supabase o il branch Premium.
