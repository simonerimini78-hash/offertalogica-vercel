# OffertaLogica Premium v0.36.4 — account unico e accesso beta pubblico

## Problemi risolti

1. Nello stato non autenticato comparivano due riquadri che comunicavano entrambi l’accesso all’account.
2. I testi piccoli sotto i titoli venivano interpretati come elementi cliccabili.
3. Un account creato dal link pubblico Share riceveva profilo e consensi, ma nessuna riga in `premium_subscriptions`; di conseguenza le policy impedivano la creazione delle utenze.

## Nuovo comportamento grafico

- Utente non collegato: viene mostrato soltanto il riquadro bianco con accesso e registrazione.
- Utente collegato: viene mostrato soltanto il riepilogo verde dell’account, con il comando di uscita.
- Rimossi il sottotitolo “Accedi o crea il tuo account”, il badge “EMAIL” e la nota che dichiarava che la registrazione non attivava un piano.

## Accesso beta

L’app richiama la funzione idempotente `premium_activate_beta_trial()` quando trova:

- un profilo Premium attivo;
- le accettazioni correnti registrate;
- nessuna sottoscrizione precedente.

La beta attivata automaticamente prevede:

- stato `trialing`;
- piano `premium-beta`;
- durata 90 giorni;
- 2 utenze;
- 30 documenti annui.

La funzione non rinnova né riattiva account che possiedono già una sottoscrizione, anche scaduta o annullata.
