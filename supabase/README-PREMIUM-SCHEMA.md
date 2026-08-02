# SCHEMA PREMIUM SUPABASE

## File eseguibile corrente

`premium-schema-v0.2.sql`

## File da non eseguire

`premium-schema-v0.1.sql` e obsoleto ed e stato sostituito dopo l'audit del backend reale.
Il file ora contiene un blocco di sicurezza che interrompe l'esecuzione.

## Ordine

1. Non modificare il branch gratuito `App-OffetaLogica`.
2. Operare soltanto su `App-Premium-ok`.
3. Non eseguire ancora lo schema finche non viene richiesto esplicitamente.
4. Quando autorizzato, eseguire `premium-schema-v0.2.sql`.
5. Subito dopo eseguire `premium-schema-v0.2-verify.sql`.

## Auth

La prima versione usa il provider Email.
La registrazione dell'app Premium dovra inviare il metadata:

```js
options: {
  data: {
    offertalogica_product: 'premium'
  }
}
```

Questo marker serve soltanto a creare il profilo applicativo corretto.
Non concede un abbonamento e non autorizza l'accesso ai dati.
Le funzioni Premium richiedono una riga `premium_subscriptions` con stato `trialing` o `active`.

La URL Configuration di Supabase verra impostata quando sara disponibile un URL stabile dedicato al Premium.
Non usare per questa fase l'URL della PWA gratuita v0.22.
