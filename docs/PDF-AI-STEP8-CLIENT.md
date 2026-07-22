# Punto 8.1 — Client AI isolato e non bloccante

Questo sottostep aggiunge soltanto l'adattatore di trasporto verso la Responses API.
Non modifica `api/analyze-pdf.js`, non attiva la modalità shadow e non effettua chiamate durante i test.

## File

- `lib/pdfAiClient.js`;
- `test/pdfAiClientStep8.test.mjs`.

## Garanzie

- modello ricevuto dall'ambiente/chiamante, mai fissato nel codice;
- chiave letta soltanto lato server;
- trasporto `fetch` iniettabile nei test;
- PDF inviato come `input_file` Base64;
- `store: false` e `background: false`;
- output richiesto con JSON Schema rigoroso;
- schema locale verificato di nuovo dopo la risposta del provider;
- timeout tramite `AbortController`;
- nessun log del PDF, del Base64, della chiave o dei dati personali;
- messaggi del provider non propagati nell'output normalizzato;
- errori HTTP, timeout, trasporto, JSON e forma dell'output trasformati in risultati non bloccanti;
- nessuna logica di merge o decisione commerciale nel client;
- nessun campo economico ammesso.

## Risultato normalizzato

Successo:

```js
{
  ok: true,
  status: "completed",
  provider: "openai",
  model,
  response_id,
  request_id,
  elapsed_ms,
  usage,
  output
}
```

Errore:

```js
{
  ok: false,
  status: "error" | "timeout",
  provider: "openai",
  model,
  elapsed_ms,
  error: {
    code,
    retryable,
    http_status,
    provider_code
  }
}
```

L'errore non contiene corpo del PDF, Base64, chiave, prompt o messaggi potenzialmente sensibili del provider.

## Test

`test/pdfAiClientStep8.test.mjs` verifica:

- richiesta strutturata e non persistente;
- esclusione dei campi economici dai gap richiesti;
- validazione locale della forma e dei ruoli;
- successo con trasporto mock;
- timeout;
- JSON invalido;
- output non conforme allo schema;
- errore HTTP 429 normalizzato;
- assenza della chiave senza invocazione del trasporto.

Il client resta scollegato dall'applicazione fino al sottostep shadow dedicato.
