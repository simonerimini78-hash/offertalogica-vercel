# OffertaLogica — PATCH Lettura completa PDF v1.2.0

## Prerequisito

Questa patch si applica al branch `Lettore-IA-Pura-Pulita` dopo la patch **Lettore Certezza Dati v1.1.0**.
Non contiene il progetto completo e non richiede un nuovo branch.

## File da sostituire

Caricare i seguenti file nei percorsi omonimi del branch esistente:

```text
lib/pdfPureAiReader.js
public/staff-pdf.html
test/pdfPureAiReader.test.mjs
test/pdfPureAiSemanticValidation.test.mjs
test/pdfTargetedQuestionSafety.test.mjs
```

Aggiungere nella root il documento:

```text
PACCHETTO-LETTURA-COMPLETA-PDF.md
```

`README-PATCH.md` serve solo come guida e non è necessario caricarlo nel repository.

## Cosa cambia

- La prima analisi legge tutti i fatti visibili nel documento, non soltanto i campi del confronto.
- I dati osservati restano separati dai dati contrattuali.
- Consumi fatturati, costi medi e totali non diventano automaticamente consumo annuo o prezzo contrattuale.
- Se mancano campi indispensabili e rimane tempo sufficiente, viene eseguita una seconda verifica mirata sullo stesso PDF.
- La seconda verifica non annulla la prima lettura in caso di errore.
- La pagina staff mostra separatamente prima lettura, verifica mirata, risposta unificata e risultato normalizzato.
- Non sono state aggiunte API e non sono presenti regole specifiche per Sorgenia o altri fornitori.

## Primo collaudo dopo il deployment

1. Caricare una bolletta domestica completa.
2. Aprire l'analisi nella pagina staff.
3. Controllare, nell'ordine:
   - `Dati osservati nel documento`;
   - `Mostra prima lettura IA`;
   - `Mostra verifica mirata IA`;
   - `Mostra risposta IA unificata`;
   - `Mostra risultato normalizzato`.
4. Verificare che un consumo del periodo resti osservato e non venga usato come consumo annuo.
5. Verificare che un costo medio resti osservato e non venga usato come prezzo contrattuale.
6. Controllare che i campi contrattuali presenti nel PDF abbiano valore, pagina ed evidenza.

## Risultato atteso sulla bolletta Sorgenia di prova

Devono essere rilevati, quando leggibili:

- intestatario e dati fiscali;
- codice cliente;
- POD e indirizzo;
- potenza impegnata e disponibile;
- fornitore, offerta e codice prodotto;
- consumi fatturati del periodo e per fascia;
- spesa materia energia;
- costi medi esposti;
- totale bolletta.

I 4.084 kWh fatturati e il costo medio di 0,15 €/kWh devono restare dati osservati. Non devono essere trasformati in consumo annuo o prezzo contrattuale. Se il documento non contiene esplicitamente condizioni economiche contrattuali o quota fissa commerciale, tali campi devono restare mancanti.

## Verifiche locali

- Lettore PDF: 41/41
- Validazione semantica mirata: 26/26
- Test Python ARERA eseguiti con discovery: 13/13
- Suite Node completa: 180/183

I tre fallimenti residui sono quelli preesistenti del menu offerte partner 6+3 e non riguardano questa patch.

## Vincoli invariati

- API Vercel: 12
- Nessun endpoint nuovo
- Nessuna regola per singolo fornitore
- Nessun valore mancante trasformato in zero o completato con valori predefiniti
