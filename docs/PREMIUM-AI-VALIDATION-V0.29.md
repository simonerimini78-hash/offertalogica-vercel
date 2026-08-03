# OFFERTALOGICA PREMIUM v0.29 — VALIDAZIONE UMANA DELLA PRE-ANALISI IA

## Obiettivo

La v0.29 aggiunge alla dashboard staff il confronto campo per campo tra la bozza prodotta dall’IA e il dato realmente verificato nel PDF.

La funzione non pubblica dati al cliente, non crea anomalie e non conclude il controllo. La revisione umana resta obbligatoria.

## Campi inizialmente misurati

Per ogni fornitura applicabile vengono verificati:

- tipo di fornitura;
- fornitore;
- consumo annuo;
- prezzo della materia o vendita;
- quota fissa annua;
- tipo di prezzo;
- indice di riferimento;
- formula del prezzo.

Per una bolletta dual vengono mostrati separatamente i campi luce e gas.

## Decisioni disponibili

Ogni campo può essere classificato come:

- `approved`: il valore IA coincide con il PDF;
- `corrected`: lo staff inserisce il valore corretto;
- `missing`: il dato è necessario ma non è stato ricavato in modo utilizzabile;
- `not_applicable`: il campo non è pertinente al documento.

## Metriche

Per ciascuna esecuzione vengono registrati:

- numero di campi applicabili;
- campi confermati;
- campi corretti;
- campi mancanti;
- campi non applicabili;
- tempo impiegato per la validazione;
- percentuale di accordo IA/staff;
- tasso di correzione.

La percentuale visualizzata è definita come:

```text
campi confermati / campi applicabili × 100
```

Non rappresenta un’accuratezza scientifica generale del modello. È una metrica operativa sul campione di campi validati dallo staff.

## Persistenza

La tabella `premium_analysis_field_reviews` conserva il confronto di ogni campo. La tabella `premium_analysis_runs` conserva inoltre:

- `review_status`;
- `validated_by_staff_id`;
- `validated_at`;
- `validation_seconds`;
- `validation_note`;
- `validation_metrics`;
- `validated_data`.

`validated_data` parte dalla bozza IA e applica soltanto le correzioni approvate dallo staff. Rimane un dato interno.

## Sicurezza

- accesso esclusivo a `reviewer` e `admin`;
- RLS attiva;
- nessun privilegio per `anon`;
- validazione consentita soltanto su analisi `completed` o `partial`;
- il controllo deve essere stato preso in carico;
- un revisore non può validare un controllo assegnato a un altro operatore;
- nessuna chiave segreta nel frontend;
- nessun nuovo endpoint serverless.

## Installazione

Eseguire una sola volta:

```text
supabase/premium-ai-validation-v0.29.sql
```

Poi verificare con:

```text
supabase/premium-ai-validation-v0.29-verify.sql
```
