# OffertaLogica Premium v0.36.7 — area Abbonamento

## Obiettivo

La v0.36.7 rende visibili nell’app le condizioni commerciali approvate senza simulare un checkout non ancora collegato a un provider di pagamento.

## Contenuto dell’area Abbonamento

L’area Profilo mostra:

- stato del piano;
- periodo corrente;
- prezzo applicato o assenza di addebito durante la prova;
- prezzo previsto per il primo anno a pagamento;
- prezzo dei rinnovi successivi;
- stato del rinnovo automatico;
- distinzione tra prova, piano attivo, rinnovo disattivato, prova scaduta e pagamento da regolarizzare.

## Formula commerciale esposta

- prova gratuita di 30 giorni senza carta e senza conversione automatica;
- primo anno: 49,90 € IVA inclusa, pagamento annuale unico;
- dal secondo anno: 59,88 € IVA inclusa all’anno, equivalenti a 4,99 € al mese;
- rinnovo annuale automatico, salvo disattivazione fino al giorno precedente;
- rimborso integrale entro 14 giorni dal primo acquisto Premium a pagamento.

## Limite intenzionale

La v0.36.7 non attiva pagamenti e non mostra un pulsante di acquisto fittizio. Checkout, rinnovo, disattivazione e recesso saranno collegati al provider di pagamento scelto in una fase successiva.

## Installazione

1. Applicare il pacchetto incrementale alla v0.36.6 verificata.
2. Eseguire `supabase/premium-commercial-terms-v0.36.7.sql`.
3. Eseguire `supabase/premium-commercial-terms-v0.36.7-verify.sql`.
4. Verificare il risultato `premium_commercial_terms_v0.36.7_ok`.
5. Accedere con un account esistente e accettare la nuova versione dei Termini.

## Checklist esterna prima della beta pubblica

- configurare un SMTP personalizzato in Supabase Auth per conferma account e recupero password;
- scegliere e collegare il provider di pagamento;
- attivare le comunicazioni automatiche della prova, del rinnovo e della cancellazione dati;
- collegare e verificare il dominio definitivo `premium.offertalogica.it`.
