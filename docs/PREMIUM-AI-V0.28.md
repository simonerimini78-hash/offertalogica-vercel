# OFFERTALOGICA PREMIUM v0.28 — PRE-ANALISI IA ASSISTITA

## Scopo

La v0.28 aggiunge una pre-analisi IA avviata esclusivamente dallo staff dalla dashboard Premium.

La pre-analisi:

- non parte automaticamente al caricamento della bolletta;
- non è visibile al cliente;
- non modifica lo stato o l’esito professionale del controllo;
- non crea automaticamente anomalie;
- non invia comunicazioni al cliente;
- produce una bozza tecnica che deve essere verificata sul PDF da un revisore.

## Dati economici prioritari

Per ogni fornitura luce o gas vengono evidenziati soprattutto:

1. consumo annuo;
2. prezzo della sola materia/vendita;
3. quota fissa della vendita su base annua.

La dashboard mostra inoltre, quando disponibili, tipo di prezzo, indice, formula ed evidenze individuate nel documento.

## Misurazione dei costi

Ogni esecuzione registra in `premium_analysis_runs`:

- modello;
- durata;
- token di input;
- token di input in cache;
- token di output;
- token di ragionamento;
- identificativi delle risposte;
- stato e campi mancanti.

Viene creato anche un evento `ai_analysis` in `premium_cost_events`.

Le tariffe non sono codificate nel repository. Per ottenere una stima in euro, configurare su Vercel dopo aver verificato le tariffe effettive del modello:

```text
PREMIUM_AI_INPUT_EUR_PER_1M_TOKENS
PREMIUM_AI_CACHED_INPUT_EUR_PER_1M_TOKENS
PREMIUM_AI_OUTPUT_EUR_PER_1M_TOKENS
```

Senza questi valori i token vengono comunque registrati, mentre il costo resta indicato come non configurato.

## Variabili server richieste

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SECRET_KEY
```

È supportata anche la vecchia variabile:

```text
SUPABASE_SERVICE_ROLE_KEY
```

Configurazione facoltativa:

```text
PREMIUM_BILLS_BUCKET=premium-bills
PREMIUM_AI_MAX_PDF_BYTES=20000000
PREMIUM_AI_DEADLINE_MS=52000
RATE_LIMIT_PREMIUM_AI_LIMIT=12
RATE_LIMIT_PREMIUM_AI_WINDOW_SECONDS=3600
```

Le chiavi segrete devono restare nelle variabili server Vercel e non devono essere inserite nel frontend.
