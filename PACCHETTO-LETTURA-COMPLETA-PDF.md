# OffertaLogica — Lettura completa e certezza dei dati PDF v1.2.0

## Obiettivo

Il lettore deve individuare tutti i dati realmente visibili nella bolletta e, contemporaneamente, impedire che numeri con significato diverso vengano utilizzati nel confronto.

La pipeline distingue quattro categorie:

1. **Dati osservati** — valori scritti nel PDF con pagina, etichetta ed evidenza.
2. **Dati derivati** — calcoli trasparenti effettuati dal sistema; non vengono presentati come valori contrattuali.
3. **Dati contrattuali** — consumi annuali, prezzi di vendita, indice, spread, formula e quota fissa utilizzabili nel confronto solo con evidenza coerente.
4. **Dati mancanti** — informazioni non trovate o non dimostrate; restano mancanti.

## Flusso di analisi

```text
PDF originale
  ↓
Prima lettura completa
  ├─ mappa del documento
  ├─ fatti osservati
  └─ campi contrattuali trovati
  ↓
Controllo dei campi indispensabili
  ↓
Verifica mirata, solo se necessaria e se rimane tempo
  ↓
Unificazione delle due risposte
  ↓
Validazione semantica universale
  ↓
Risultato normalizzato e contratto dati
```

## Prima lettura completa

La prima richiesta non è limitata ai soli valori del confronto. Cerca anche:

- cliente, codice fiscale o partita IVA e codice cliente;
- POD/PDR e indirizzi;
- potenza;
- fornitore, offerta e codice prodotto;
- periodo e dati della fattura;
- consumi fatturati e consumi per fascia;
- spese di vendita;
- costi medi dichiarati;
- totale del documento;
- condizioni economiche contrattuali presenti.

Ogni fatto osservato mantiene la propria natura. Un valore non viene promosso a dato contrattuale soltanto perché numericamente plausibile.

## Verifica mirata

Se la prima lettura non trova i dati indispensabili, il sistema può eseguire una seconda richiesta sullo stesso PDF. La richiesta riguarda soltanto i campi mancanti e ribadisce le esclusioni semantiche:

- consumo del periodo ≠ consumo annuo;
- costo medio ≠ prezzo contrattuale;
- quota di rete o oneri ≠ quota fissa commerciale;
- tariffa futura ≠ condizioni correnti.

La verifica viene avviata solo quando il budget temporale residuo è sufficiente. Un errore della seconda richiesta non elimina i dati validi della prima.

## Certezza e autocompilazione

Un campo può essere autocompilato soltanto quando:

- il valore è presente;
- l'unità è coerente;
- la pagina è nota;
- l'evidenza contiene il valore o ne dimostra la derivazione;
- il ruolo semantico è compatibile con il campo;
- il contratto dati ne consente l'uso.

I dati osservati non contrattuali restano disponibili nello staff, ma non vengono usati per calcolare il confronto.

## Esempio Sorgenia

Nella bolletta di prova:

- 4.084 kWh sono consumi fatturati di dicembre e gennaio;
- 0,15 €/kWh è il costo medio della materia energia del periodo;
- 625,88 € è la spesa materia energia;
- 10 kW è la potenza impegnata;
- 11 kW è la potenza disponibile.

Il lettore deve conservare tutti questi valori. Tuttavia:

- 4.084 kWh non diventano consumo annuo;
- 0,15 €/kWh non diventa prezzo contrattuale;
- il rapporto 625,88 / 4.084 può essere mostrato come costo effettivo derivato del periodo, mai come tariffa contrattuale.

## Tracciabilità staff

La pagina staff separa:

- prima risposta IA;
- eventuale verifica mirata;
- risposta unificata;
- risultato normalizzato;
- dati osservati;
- dati derivati;
- campi accettati e rifiutati.

Il primo punto in cui un valore cambia individua il componente responsabile.

## Impatto tecnico

- Modello e PDF originale invariati.
- Nessun OCR aggiuntivo.
- Nessun nuovo endpoint.
- Numero di API invariato: 12.
- Possibile seconda chiamata OpenAI soltanto per recuperare campi essenziali mancanti e con tempo sufficiente.
- Nessuna logica legata al nome del fornitore.
