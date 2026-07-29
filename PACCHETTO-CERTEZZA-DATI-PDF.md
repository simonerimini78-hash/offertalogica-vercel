# OffertaLogica — Pacchetto certezza e tracciabilità dati PDF

## Obiettivo

Questo pacchetto non promette che ogni PDF contenga o renda leggibile ogni dato. Garantisce invece che:

1. ogni valore accettato possa essere ricondotto alla risposta originale dell'IA;
2. il backend distingua il dato letto dal dato normalizzato o derivato;
3. il frontend non scelga arbitrariamente tra valori incompatibili;
4. un dato mancante resti mancante, senza valori standard o sostituzioni silenziose;
5. i conflitti blocchino l'autocompilazione del campo interessato;
6. luce e gas restino separati anche con più PDF e fornitori diversi.

La regola è: **meglio un campo vuoto e dichiarato che un valore plausibile ma non dimostrato**.

## Strategia applicata

### 1. Catena di custodia del dato

Sono separati quattro livelli:

- risposta JSON originale dell'IA;
- risultato normalizzato e validato dal backend;
- JSON pubblico restituito al browser;
- dati applicati al modulo e usati dal calcolo.

La risposta originale viene conservata in `_reader_trace.raw_ai` esclusivamente nell'archivio staff. Non viene inviata al browser pubblico.

Nell'area staff sono presenti due viste distinte:

- **Mostra risposta IA originale**;
- **Mostra risultato normalizzato**.

Questo permette di localizzare il primo punto in cui un valore cambia o viene scartato.

### 2. Ingresso affidabile dei PDF grandi

- PDF piccoli: multipart diretto esistente.
- PDF oltre 4 MB: upload firmato Supabase e successiva richiesta JSON leggera alla Function.
- Il backend continua a gestire fino a 20 MB secondo il limite applicativo esistente.
- Nessuna nuova API è stata aggiunta.

Il frontend conserva ora `diagnostic_code`, `analysis_stage`, `ingress_mode` ed `elapsed_ms` invece di ridurre ogni errore a un messaggio indistinto.

### 3. Dati accettati solo con contratto verificato

L'autocompilazione continua a usare soltanto campi:

- con stato `completo`;
- ammessi dal contratto dati;
- confermati dall'utente nell'anteprima.

I valori parziali, da verificare o in conflitto restano visibili ma non vengono inseriti automaticamente.

### 4. Merge deterministico e indipendente dall'ordine

I documenti sono ordinati con una chiave stabile prima della fusione.

Il merge:

- mantiene luce e gas nelle rispettive commodity;
- conserva fornitori e codici cliente specifici;
- usa un valore comune soltanto quando coincide esattamente;
- blocca clienti differenti, POD differenti o PDR differenti;
- non unisce bollette e schede sintetiche nello stesso risultato;
- non assegna un tipo di prezzo comune quando luce e gas sono diversi;
- deduplica i target di autocompilazione;
- trasforma valori incompatibili in `da_verificare`.

### 5. Prezzi complessi conservati fino al calcolo

Sono mantenuti e utilizzati:

- F0;
- F1/F23;
- F1/F2/F3;
- indice;
- moltiplicatore;
- spread, anche negativo;
- formula completa;
- quote fisse negative come credito o sconto.

Non vengono create medie tra fasce e il moltiplicatore esplicito evita di applicare due volte le perdite.

### 6. Percorso business senza dati inventati

Sono stati eliminati i valori predefiniti per:

- prezzo luce;
- prezzo gas;
- quota fissa luce;
- quota fissa gas.

Il profilo business conserva identificativi, riferimenti archivio e campi mancanti. Il calcolo viene bloccato quando i dati economici necessari non sono completi. La richiesta di assistenza resta possibile anche con profilo incompleto.

### 7. Riuso dell'archivio senza nuova lettura

Dall'area staff è possibile caricare nel calcolatore il risultato archiviato senza richiamare OpenAI. Questo consente di verificare separatamente frontend, merge e calcolo sullo stesso identico output backend.

## File modificati

- `lib/pdfPureAiReader.js`
- `api/analyze-pdf.js`
- `public/index.html`
- `public/staff-pdf.html`
- `test/pdfPureAiReader.test.mjs`

Non sono stati aggiunti endpoint. Le route API restano **12**.

## Verifiche eseguite

### Suite principale del lettore

Comando:

```bash
npm run test:pdf-reader
```

Risultato: **38/38 test superati**.

### Progetto escluso il test del menu partner non pertinente

Risultato: **177/177 test superati**.

Sono inclusi test su:

- risposta IA originale e normalizzato separati;
- privacy della traccia grezza;
- upload firmato dei PDF grandi;
- PDF piccoli multipart;
- errori e diagnostica;
- prezzi medi e consumi del periodo rifiutati;
- fasce e formule indicizzate;
- moltiplicatori;
- spread e quote negative;
- merge indipendente dall'ordine;
- clienti e forniture differenti;
- codici cliente luce/gas;
- percorso business senza valori predefiniti;
- replay dall'archivio staff.

### Suite completa

Risultato: **177/180 test superati**.

I soli tre test non superati riguardano il menu offerte partner 6+3 e non il lettore PDF. Erano fuori dal perimetro di questo intervento e non sono stati modificati per evitare regressioni su un'altra parte del progetto.

## Configurazione necessaria

Per usare l'upload firmato dei PDF grandi e conservare la risposta originale nell'archivio devono essere configurati i parametri Supabase già previsti dal progetto, inclusi URL, service role key, bucket e tabella `pdf_analyses`.

Se l'archivio è disattivato, il lettore continua a funzionare, ma la risposta originale dell'IA non potrà essere verificata a posteriori nell'area staff.

## Protocollo di collaudo in produzione

Per ogni PDF problematico:

1. aprire il record nell'area staff;
2. confrontare **Risposta IA originale** e **Risultato normalizzato**;
3. usare **Prova questi dati nel calcolatore**;
4. verificare il riepilogo e l'anteprima di autocompilazione;
5. controllare i valori effettivamente applicati al modulo;
6. intervenire soltanto sul primo livello in cui il dato cambia.

Classificazione:

- errato già nella risposta IA → lettura/prompt/modello;
- corretto nell'IA ma assente nel normalizzato → normalizzatore/validatore;
- corretto nell'API ma alterato nel riepilogo → merge frontend;
- corretto nel riepilogo ma errato nel calcolo → profilo/calcolatore.

## Limite dichiarato

Il pacchetto rende i dati **tracciabili, non arbitrari e verificabili**. Non può garantire che un modello esterno legga correttamente ogni documento o che un dato assente venga recuperato. In tali casi il campo resta vuoto o da verificare e non viene sostituito automaticamente.
