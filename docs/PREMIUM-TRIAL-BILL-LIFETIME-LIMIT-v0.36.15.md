# OffertaLogica Premium v0.36.15 — limite cumulativo della prova

## Regola applicata

La prova gratuita consente al massimo **4 bollette complessivamente caricate**. La cancellazione di una bolletta dall’archivio non libera un nuovo caricamento.

Il limite riguarda esclusivamente gli account con:

- `status = trialing`;
- `plan_code = premium-beta`.

Gli account Premium pagati e gli omaggi senza una prova sospesa non ricevono questo limite.

## Premium omaggio sopra una prova attiva

Quando un omaggio sospende una prova ancora valida, gli upload effettuati durante l’omaggio vengono registrati senza limitare il Premium omaggio. Alla revoca o alla scadenza dell’omaggio, quelle bollette concorrono al limite della prova ripristinata.

## Protezione tecnica

La migrazione crea `premium_trial_bill_usage`, un registro separato dalla tabella delle bollette. Il registro resta presente dopo la normale cancellazione del PDF.

Il caricamento segue tre fasi:

1. prenotazione atomica dell’identificativo della bolletta;
2. inserimento del record e caricamento nel bucket privato;
3. conferma della prenotazione soltanto dopo la presenza del PDF nello Storage.

Gli upload falliti prima del completamento non consumano la quota. Le prenotazioni interrotte prima della creazione della bolletta scadono dopo un’ora.

## Dati precedenti alla migrazione

La migrazione registra automaticamente le bollette ancora presenti negli account con prova attiva o prova sospesa da un omaggio.

Le bollette eliminate fisicamente **prima** dell’installazione della v0.36.15 non possono essere ricostruite con certezza e non vengono conteggiate retroattivamente. Per il collaudo definitivo va usato un account creato dopo la migrazione oppure un account che conservi ancora le bollette caricate.

## Installazione

Eseguire, nell’ordine:

1. `supabase/premium-trial-bill-lifetime-limit-v0.36.15.sql`;
2. `supabase/premium-trial-bill-lifetime-limit-v0.36.15-verify.sql`.

Risultato atteso:

`premium_trial_bill_lifetime_limit_v0.36.15_ok`

## Collaudo reale

1. creare o usare un account prova successivo alla migrazione;
2. caricare quattro bollette;
3. eliminare una delle quattro;
4. verificare che il contatore resti `4 / 4`;
5. tentare il quinto caricamento;
6. verificare il blocco e il messaggio che chiarisce che la cancellazione non libera quota.
