# OffertaLogica Premium v0.31C

## Obiettivo

Rendere visibile nell'app il risultato del riconoscimento ARERA introdotto dalla v0.31B e chiedere al cliente il minimo indispensabile.

## Stati mostrati

- **Identificata**: codice esatto o corrispondenza forte; nessuna conferma richiesta.
- **Da confermare**: una o più offerte compatibili; il cliente sceglie quella riconoscibile.
- **Confermata**: la scelta è stata registrata e il contratto diventa verificato.
- **Non confermata**: il cliente ha escluso la proposta; il contratto non viene usato nei controlli automatici.
- **Provvisoria**: offerta ricostruita dalla bolletta ma non identificata nello storico ARERA.

## Conferma

La conferma usa l'endpoint Vercel già esistente:

`/api/premium-ai-analysis`

Azioni supportate:

- `confirm_offer`
- `reject_offer`

Non viene aggiunta una tredicesima funzione Vercel.

Il server:

1. verifica account e abbonamento;
2. carica il contratto appartenente all'utente;
3. accetta soltanto candidati già memorizzati dal motore ARERA;
4. registra la decisione;
5. in caso di conferma, riclassifica la bolletta usando i dati IA già archiviati;
6. non richiama OpenAI e non genera un nuovo costo IA.

## Offerte indicizzate

La v0.31C aggiunge il confronto deterministico di:

- indice dichiarato, ad esempio PUN o PSV;
- spread luce;
- spread gas;
- quota fissa.

Il prezzo corrente di un'offerta indicizzata non viene trattato come prezzo fisso contrattuale.

La versione non dichiara ancora di ricalcolare il valore mensile storico di PUN o PSV per ogni periodo fatturato. Quel calcolo richiede una fonte storica degli indici e una metodologia separata.

## Storico ARERA

Lo storico parte dal 3 agosto 2026. Non viene effettuata una ricostruzione retroattiva completa. Le offerte precedenti restano provvisorie quando non sono presenti nello storico disponibile.

## Sicurezza

- le scelte del browser non aggiornano direttamente il contratto;
- l'aggiornamento avviene lato server con controllo di proprietà;
- i candidati sono verificati contro il JSON già salvato nel contratto;
- i contratti manuali o verificati dallo staff non vengono sovrascritti;
- RLS resta attivo;
- nessun permesso anonimo viene aggiunto.
