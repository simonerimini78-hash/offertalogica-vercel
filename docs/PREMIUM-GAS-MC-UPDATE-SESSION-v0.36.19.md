# Premium v0.36.19 — consumo gas in mc e aggiornamento controllato

## Difetto riprodotto
La lettura reale Dolomiti conteneva `Consumo annuo (mc) = 1.883`, con `purpose=annual_consumption` e `period=year`. Il normalizzatore accettava soltanto `Smc`, scartava il consumo e generava il falso avviso `campo_mancante_consumo_gas_smc`.

## Correzione
Per le sole righe di consumo gas, il normalizzatore accetta anche `mc`, `m3` e `m³`. Prezzi e spread restano vincolati a `€/Smc`. Restano esclusi i consumi del solo periodo fatturato e i valori economici espressi in `€/mc`.

## Aggiornamenti
App e Area staff mostrano un avviso quando il nuovo service worker è pronto. Il caricamento avviene soltanto dopo il pulsante `AGGIORNA`; la sessione Supabase resta memorizzata e non viene eseguito alcun logout.

La conservazione della sessione è possibile soltanto sullo stesso dominio. Un nuovo URL Preview Vercel è un'origine diversa e non può leggere la sessione del precedente URL.
