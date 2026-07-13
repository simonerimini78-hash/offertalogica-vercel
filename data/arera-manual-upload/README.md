# Upload manuale XML ARERA

Usare questa cartella solo se il workflow GitHub non riesce a scaricare i file dal Portale Offerte per blocco `403 Forbidden`.

## File attesi

Caricare almeno:

- `PO_Offerte_E_MLIBERO_YYYYMMDD.xml`
- `PO_Offerte_G_MLIBERO_YYYYMMDD.xml`

Il file dual fuel e opzionale:

- `PO_Offerte_D_MLIBERO_YYYYMMDD.xml`

## Uso da GitHub Actions

Avviare il workflow `Aggiorna offerte ARERA` manualmente e impostare:

- `source_dir`: `data/arera-manual-upload`
- `as_of`: la data dei file, ad esempio `2026-07-13`

Lo script usera questi XML locali per rigenerare:

- `data/offerte-arera-menu.json`
- `public/data/offerte-arera-menu.json`

Se i file non sono validi, il workflow deve fallire. Non usare dati statici come fallback pubblico.
