# PDF AI — Orchestratore shadow Step 8.4.1

L'orchestratore visuale resta isolato dal parser e dall'OCR.

- esegue soltanto la modalità `shadow`;
- rispetta modello, pagine, byte, filename e budget temporale;
- viene chiamato soltanto dopo i gate server Preview staff dell'endpoint;
- non richiede né gestisce checkbox o consenso lato browser;
- costruisce un piano di revisione senza mutare il risultato deterministico;
- timeout ed errori sono non bloccanti;
- nessun campo economico è ancora ammesso nello schema visuale.

La vista ridotta mostrata nella Preview viene costruita separatamente dal sidecar e non abilita autofill.
