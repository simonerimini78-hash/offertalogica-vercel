# OffertaLogica – cancellazioni staff v0.34

La v0.34 completa la pagina staff unica con eliminazioni amministrative coerenti.

## Livelli di cancellazione

- Lead: singolo, tutti i lead visibili dopo la ricerca, archivio lead completo.
- Analytics: singolo evento, eventi visibili, archivio analytics completo.
- Clienti Premium: singola bolletta, singolo contratto, intero blocco utenza, intero blocco cliente, clienti visibili.
- Controlli Premium: solo controllo, controlli visibili, intero blocco bolletta con controllo e analisi collegate.
- Diagnostica PDF: singola analisi, tutte le analisi dello stesso PDF, analisi filtrate visibili, archivio completo.
- Costi: singola analisi IA, analisi IA visibili, singolo evento di costo, eventi di costo visibili.

## Sicurezza

Le cancellazioni sono visibili ed eseguibili soltanto dagli amministratori. I reviewer conservano la lettura e le RPC operative, ma non possono cancellare direttamente tabelle Premium.

Le operazioni massive richiedono una parola di conferma. La RPC `premium_staff_delete_records` esegue in transazione la cancellazione dei record database collegati. I PDF Premium vengono rimossi dallo Storage prima della cancellazione database.

L’eliminazione del blocco cliente rimuove i dati Premium, ma non elimina l’account Supabase Auth. Questo evita una cancellazione implicita dell’identità di accesso da un comando operativo sui dati.

## Installazione

1. Caricare il pacchetto sul branch `App-Premium-ok`.
2. Distribuire la Preview Vercel.
3. Eseguire `supabase/premium-staff-deletion-v0.34.sql`.
4. Eseguire `supabase/premium-staff-deletion-v0.34-verify.sql`.
5. Verificare che tutti i valori restituiti siano `true`.
