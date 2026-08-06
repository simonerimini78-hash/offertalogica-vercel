# Premium v0.36.23

## Resa grafica

La superficie sottostante al vetro è ora neutra: argento, grigio chiaro e riflessi bianchi. I gradienti verdi restano confinati agli elementi funzionali e di marchio. Questo evita che trasparenza e blur trasformino tutta l’interfaccia in una superficie verde uniforme.

## Aggiornamenti

- App: service worker automatico con scope `/app.html`.
- Staff: nessuna registrazione di service worker; controllo di `version.json` e ricarica manuale tramite pulsante.
- Migrazione: l’app e il pulsante Staff eliminano l’eventuale registrazione legacy `/sw.js` con scope `/`.

## Invarianti

- Nessuna modifica a Supabase o ai limiti Premium.
- Nessuna nuova funzione Vercel.
- Termini commerciali invariati alla versione `premium-terms-v0.36.22-2026-08-06`.
