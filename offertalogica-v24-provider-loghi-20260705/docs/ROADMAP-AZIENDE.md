# Roadmap sezione aziende

La sezione aziende deve essere distinta dal calcolatore domestico.

## Stato implementazione

Prima versione inserita nel frontend:

- scelta iniziale Privato / Azienda;
- pannello aziendale separato;
- raccolta ragione sociale, P.IVA, referente, telefono, email;
- raccolta potenza, consumi annui, fasce F1/F2/F3, prezzo medio e quote fisse;
- stima preliminare del margine business;
- lead business con profilo aziendale salvato nel payload;
- PDF riutilizzabile anche in modalita business per precompilare consumi e fornitore quando disponibili.

La stima business non deve essere presentata come offerta finale. Serve solo come pre-qualifica commerciale fino a quando non saranno collegati listini/offerte business reali.

## Dati minimi richiesti

- Ragione sociale
- Partita IVA
- Referente
- Telefono ed email
- Comune/sede fornitura
- Potenza impegnata luce
- Tensione e tipologia contatore, se nota
- Consumi annui luce totali
- Consumi per fasce F1/F2/F3, se disponibili
- Consumi gas annui
- Uso gas: riscaldamento, processo produttivo, cucina, altro
- Prezzo attuale materia energia/gas
- Quote fisse e condizioni attuali

## Logica calcolo

- Separare offerte domestiche e business.
- Gestire fasce orarie elettriche.
- Gestire profili di consumo non lineari.
- Valutare potenza, trasporto e condizioni contrattuali business.
- Mostrare sempre costo stimato annuo e ipotesi utilizzate.

## UX consigliata

- Tab iniziale: Privati / Aziende.
- Per aziende: percorso guidato con upload bolletta prioritario.
- Lead obbligatorio prima di mostrare offerte dettagliate, perche la valutazione e piu consulenziale.
