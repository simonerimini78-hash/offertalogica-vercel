# Offerta indicizzata: valori corretti nella scheda — v0.36.26

## Problema riprodotto

Sulla v0.36.25 una bolletta gas indicizzata correttamente analizzata mostrava contemporaneamente:

- prezzo applicato letto: `0,687459 €/Smc`;
- formula contrattuale: `PSVDA + 0,121732 €/Smc`;
- quota fissa gas: `144 €/anno`;
- campo scheda `Prezzo gas: 0 €/Smc`;
- campi luce assenti trasformati in `0`.

Il run live risultava concluso senza errore. Le funzioni Supabase di consensi, limiti e sincronizzazione risultavano tutte aggiornate.

## Causa

Il renderer usava controlli equivalenti a:

```js
Number.isFinite(Number(contract.gas_price_eur_smc))
```

In JavaScript `Number(null)` vale `0`. I campi contrattuali nulli venivano quindi considerati numeri validi e visualizzati come zero.

Per un'offerta indicizzata il prezzo contrattuale fisso può correttamente essere nullo: il contratto conserva indice, spread e formula, mentre il prezzo applicato nel periodo è presente nei dati letti dalla bolletta.

## Correzione

- valori `null`, `undefined` e stringhe vuote non sono più convertiti in zero;
- se esiste un prezzo contrattuale esplicito viene mostrato come `Prezzo luce/gas`;
- se il prezzo contrattuale è nullo ma la bolletta contiene il prezzo del periodo, viene mostrato come `Prezzo luce/gas applicato`;
- i campi luce non vengono mostrati in una bolletta solo gas e viceversa;
- formula e quota fissa vengono mostrate solo quando realmente presenti;
- gli stessi controlli sicuri sono applicati anche ai candidati ARERA.

## Stato del riconoscimento ARERA

La correzione non forza il riconoscimento dell'offerta. `GAS ITALY CASA_R` non ha raggiunto una corrispondenza affidabile nel catalogo live consultato; lo stato giallo resta quindi coerente e separato dalla corretta lettura del prezzo.
