# OffertaLogica App - prima versione PWA

Questa versione aggiunge un primo ingresso app senza sostituire o riscrivere il comparatore esistente.

## File aggiunti
- `public/app.html`: home mobile dell'app coerente con grafica, logo e colori reali.
- `public/manifest.webmanifest`: configurazione installabile PWA.
- `public/sw.js`: service worker e cache minima della shell app.
- `public/assets/app-icon-192.png`
- `public/assets/app-icon-512.png`

## File modificato
- `public/index.html`: aggiunti manifest, theme color, icona app e registrazione service worker.

## Come provarla
1. Pubblicare il branch/preview su Vercel.
2. Aprire `/app.html` sul dominio della preview.
3. Da Android/Chrome usare il pulsante di installazione quando compare.
4. Da iPhone/Safari usare Condividi > Aggiungi alla schermata Home.

## Funzioni già collegate
- Confronta offerte -> comparatore reale.
- Carica bolletta -> pannello PDF reale.
- Nuovo confronto -> percorso reale del sito.
- Offerte disponibili -> pagina offerte aggiornata.
- Aiuto -> pagina Come funziona.

## Limite intenzionale di questa prima versione
Archivio, profilo e notifiche personali non sono ancora implementati perché richiedono autenticazione e struttura dati utente. Non sono stati simulati con dati finti.
