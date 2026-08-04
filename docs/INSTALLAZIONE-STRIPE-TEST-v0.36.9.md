# Installazione Stripe Test — Premium v0.36.9

Questa procedura deve essere eseguita soltanto in Stripe Test mode. Non abilita pagamenti reali.

## 1. Database Supabase

Eseguire nel SQL Editor, nell'ordine:

1. `supabase/premium-stripe-billing-v0.36.9.sql`
2. `supabase/premium-stripe-billing-v0.36.9-verify.sql`

Risultato previsto:

`premium_stripe_billing_v0.36.9_ok`

## 2. Stripe Test mode

Creare:

- prodotto: `OffertaLogica Premium Casa`;
- prezzo ricorrente: `59,88 EUR`, cadenza annuale, attivo e associato al prodotto Premium;
- coupon: sconto fisso `9,98 EUR`, valuta EUR, durata `once`, limitato allo stesso prodotto Premium;
- portale cliente: aggiornamento metodo di pagamento, visualizzazione fatture e cancellazione esclusivamente alla fine del periodo; annotare il relativo ID configurazione `bpc_...`.

Il prezzo ricorrente da 59,88 EUR con coupon `once` da 9,98 EUR produce:

- prima fattura: 49,90 EUR;
- rinnovi successivi: 59,88 EUR.

La funzione verifica automaticamente importo, valuta, cadenza annuale e ambito del coupon prima di creare il Checkout. La configurazione IVA/Stripe Tax resta disattivata finché non viene verificata fiscalmente. Quando sarà attivata, il prezzo Stripe dovrà avere `tax_behavior=inclusive`; in caso contrario il Checkout viene bloccato.

## 3. Edge Function Supabase

Distribuire `premium-billing`:

`supabase functions deploy premium-billing`

La funzione è pubblicamente raggiungibile per ricevere i webhook, ma:

- verifica la firma Stripe per i webhook;
- verifica manualmente il JWT Supabase per le azioni dell'utente.

## 4. Segreti Edge Function

Usare come elenco il file:

`supabase/billing-secrets.example.txt`

Tenere inizialmente:

`PREMIUM_BILLING_ENABLED=false`

Aggiungere tutte le credenziali Test mode e solo dopo il test tecnico impostare:

`PREMIUM_BILLING_ENABLED=true`

I segreti Stripe non devono essere inseriti nelle variabili Vercel e non devono essere caricati nel repository.

## 5. Webhook Stripe

Creare un endpoint webhook Stripe Test mode verso:

`https://kzxdamhfmzaxonpkytcf.supabase.co/functions/v1/premium-billing`

Selezionare gli eventi:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `invoice.paid`
- `invoice.payment_failed`

Copiare il signing secret `whsec_...` nelle Edge Function Secrets come `STRIPE_WEBHOOK_SECRET`.

## 6. Collaudo minimo

Con un account Premium di prova:

1. aprire Profilo > Abbonamento;
2. verificare il pulsante `ACQUISTA PREMIUM PER 49,90 €`;
3. completare Stripe Checkout con una carta Test;
4. verificare passaggio a `ATTIVO`;
5. verificare periodo annuale e importo 49,90 EUR;
6. disattivare il rinnovo;
7. verificare `cancel_at_period_end=true` in Stripe e nell'app;
8. riattivare il rinnovo;
9. aprire il portale pagamenti;
10. simulare un pagamento fallito e verificare che una prova interna ancora valida non venga interrotta;
11. ritrasmettere un webhook fallito e verificare che venga elaborato, mentre un evento già completato resti idempotente;
12. dopo una cancellazione effettiva, verificare che il portale resti disponibile per consultare fatture e pagamenti precedenti.

Non passare in Stripe Live mode prima dell'implementazione e del collaudo del recesso con rimborso entro 14 giorni.
