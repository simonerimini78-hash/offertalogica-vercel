# OffertaLogica Premium v0.35.1

Correzione limitata al flusso di cambio password e al caricamento del profilo.

## Modifiche

- Testo della sezione password reso più chiaro.
- Dopo il cambio password vengono ricaricati sessione, profilo, abbonamento e accettazioni.
- La prima lettura non riuscita viene ritentata automaticamente dopo 500 ms.
- I caricamenti concorrenti ormai superati non possono sovrascrivere lo stato più recente.
- Durante il rinnovo sessione viene mostrato uno stato neutro di aggiornamento.
- Rimosso il messaggio fuorviante «Account autenticato, ma il profilo Premium non è accessibile».
- Il messaggio finale è «Password aggiornata correttamente.» e il modulo viene richiuso.

## Impatto

- Nessuna migrazione SQL.
- Nessuna nuova funzione Vercel.
- Nessuna modifica alla PWA gratuita.
- Nessuna modifica a termini, privacy, accettazioni o cancellazione account.
