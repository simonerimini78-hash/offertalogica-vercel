# Aggiornamento ARERA locale da Mac

GitHub Actions puo essere bloccato dal Portale Offerte con errore `403 Forbidden`.
In quel caso l'aggiornamento va fatto dal Mac, dove il download parte da una rete normale.

## Procedura

Apri Terminale nella cartella del progetto e lancia:

```bash
bash scripts/aggiorna-arera-locale-mac.sh
```

Per cercare una data precisa:

```bash
bash scripts/aggiorna-arera-locale-mac.sh 2026-07-13
```

Lo script:

- scarica gli XML ufficiali ARERA;
- genera `data/offerte-arera-menu.json`;
- genera `public/data/offerte-arera-menu.json`;
- non modifica i dati se non trova file XML validi.

## File da caricare su GitHub

Dopo l'esecuzione, caricare questi due file:

- `data/offerte-arera-menu.json`
- `public/data/offerte-arera-menu.json`

Non caricare la cartella `.arera-download`.

## Verifica

Dopo il caricamento su GitHub e deploy Vercel, controllare che nel calcolatore le offerte usino la nuova data ARERA indicata nei JSON.
