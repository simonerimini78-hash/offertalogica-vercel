# Pipeline catalogo ARERA

## Trasformazione canonica

L'unico file autorizzato a calcolare e pubblicare `prezzo`,
`quotaFissaAnnua` e `qualitaPrezzo` e:

`scripts/update-arera-menu.py`

Flusso:

1. acquisizione dei tre XML ARERA E, G e D;
2. estrazione in staging con provenienza;
3. validazione semantica di prezzi, unita e periodo;
4. confronto con l'ultimo record valido;
5. quarantena degli scostamenti sospetti;
6. scrittura congiunta dei due cataloghi pubblici e del report.

Non possono diventare prezzo principale: medie di fasce non previste dalla
struttura dell'offerta, dispacciamento, capacita, commercializzazione,
adeguamenti consumo, delta futuri, spread successivi alla scadenza e quote con
unita incompatibili.

## Ingressi

- `.github/workflows/update-arera-menu.yml`: automatico o manuale; il manuale
  accetta `source_dir` e `as_of`.
- `scripts/aggiorna-arera-locale-mac.sh`: acquisizione locale macOS e chiamata
  allo stesso trasformatore.
- `scripts/download-arera-open-data.sh`: utilita di recupero da ambiente shell.

Non esistono trasformatori JavaScript paralleli del catalogo pubblico.

## Output

- `data/offerte-arera-menu.json`;
- `public/data/offerte-arera-menu.json`;
- `data/arera-update-report.json`;
- staging temporaneo in `data/.arera-staging/`.

I due JSON del catalogo devono essere identici. Se la validazione fallisce, i
dati pubblicati restano invariati e l'aggiornamento termina con errore.

## Script che non pubblicano il catalogo

- `sync-arera-open-data.mjs`: prepara dati candidati.
- `shortlist-arera-candidates.mjs`: prepara la shortlist.
- `promote-arera-offer.mjs`: aggiorna `data/offerte-proposte.json`.
- `test-ranking-arera.mjs`, `test-partner-arera.mjs`,
  `verify-calcolo-offerte.mjs`: leggono e verificano senza riscrivere prezzi.
