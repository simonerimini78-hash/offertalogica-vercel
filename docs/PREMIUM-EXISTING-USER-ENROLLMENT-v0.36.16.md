# Premium v0.36.16 — account Auth esistente

## Problema riprodotto

Un indirizzo gia presente in Supabase Auth, per esempio un account staff, non viene trasformato in profilo Premium da un nuovo tentativo di registrazione.

Supabase registra il tentativo come `user repeated signup`; il trigger `premium_handle_new_user` non viene rieseguito perché l'utente Auth non viene creato di nuovo. Di conseguenza:

- `premium_profiles` non contiene la riga dell'utente;
- l'app mostra “Profilo Premium non abilitato”;
- l'area staff non mostra l'utente tra i clienti Premium;
- il ruolo amministratore resta valido, ma non esiste il profilo cliente.

## Correzione

La nuova RPC autenticata `premium_ensure_current_user_profile()` crea, se manca, il profilo Premium dello stesso utente Auth. La funzione:

- usa esclusivamente `auth.uid()`;
- legge email, telefono e nome dall'utente Auth corrente;
- non modifica `premium_staff_members`;
- non riattiva profili sospesi, cancellati o con cancellazione richiesta;
- non crea automaticamente un abbonamento;
- lascia obbligatoria l'accettazione delle condizioni correnti prima dell'attivazione della prova.

L'app richiama la RPC soltanto quando un utente autenticato entra nell'Area Premium e non possiede ancora un profilo. Dopo la creazione mostra il pannello delle condizioni; l'utente deve accettarle esplicitamente. Solo dopo può essere attivata la prova gratuita prevista.

## Versioni

App Premium e Area staff sono allineate a `v0.36.16`. La vecchia scritta superiore `v0.36.3` dell'Area staff era un'etichetta hardcoded rimasta indietro: lo stesso file conteneva già anche `v0.36.15`.
