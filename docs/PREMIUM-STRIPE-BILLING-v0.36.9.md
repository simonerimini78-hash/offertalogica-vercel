# OffertaLogica Premium v0.36.9 — Stripe test mode

## Scelta tecnica

La v0.36.9 usa Stripe Checkout e Stripe Billing tramite una Supabase Edge Function. Non aggiunge funzioni Vercel e mantiene il totale Vercel a 12.

Configurazione commerciale:

- prezzo ricorrente annuale Stripe: 59,88 EUR;
- coupon riservato al primo acquisto: 9,98 EUR di sconto, durata `once`;
- prima fattura: 49,90 EUR;
- fatture annuali successive: 59,88 EUR.

Il coupon viene applicato soltanto quando `first_paid_at` e `intro_price_redeemed_at` sono vuoti. Il diritto al prezzo introduttivo viene registrato soltanto dopo il primo evento `invoice.paid`.

## Funzioni disponibili

- creazione Customer Stripe collegato all'UUID Supabase;
- riuso di una sessione Checkout ancora aperta;
- Checkout in modalità `subscription`;
- sincronizzazione tramite webhook;
- attivazione del piano `premium-casa-annual` dopo il pagamento;
- rinnovo annuale automatico;
- disattivazione del rinnovo a fine periodo;
- riattivazione prima della scadenza;
- portale Stripe per metodo di pagamento e fatture;
- registrazione idempotente degli eventi webhook;
- nuovo tentativo controllato degli eventi falliti o rimasti bloccati;
- verifica server-side della corretta configurazione di prezzo annuale e coupon prima del Checkout;
- accesso al portale pagamenti anche dopo la cancellazione, per consultare lo storico.

## Eventi webhook gestiti

- `checkout.session.completed`;
- `checkout.session.expired`;
- `customer.subscription.created`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`;
- `customer.subscription.paused`;
- `customer.subscription.resumed`;
- `invoice.paid`;
- `invoice.payment_failed`.

## Sicurezza

- `verify_jwt=false` serve perché Stripe non possiede un JWT Supabase;
- le azioni utente verificano manualmente il bearer token con Supabase Auth;
- i webhook verificano `Stripe-Signature` con HMAC SHA-256 e tolleranza di 5 minuti;
- `premium_checkout_sessions` e `premium_payment_events` sono accessibili soltanto al `service_role`;
- i segreti Stripe risiedono esclusivamente nelle Supabase Edge Function Secrets;
- gli eventi sono idempotenti tramite vincolo univoco `(provider, provider_event_id)`;
- gli eventi `failed` e quelli `processing` da oltre 10 minuti vengono ripresi; quelli già `processed` non vengono eseguiti nuovamente;
- un evento ancora in elaborazione restituisce un errore ritentabile invece di essere considerato completato.

## Limiti della fase

La v0.36.9 deve essere collaudata esclusivamente in Stripe Test mode. La funzione rifiuta un prezzo diverso da 59,88 EUR/anno o un coupon diverso da 9,98 EUR `once` applicato al prodotto Premium. Non include ancora la funzione online di recesso con rimborso integrale entro 14 giorni e non deve essere portata in Live mode prima del pacchetto successivo e della verifica fiscale del trattamento IVA.
