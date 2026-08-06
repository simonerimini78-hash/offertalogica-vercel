# Premium v0.36.24 — analisi e pulsanti stabili

## Difetto riprodotto sulla v0.36.23

Durante una nuova analisi, `runAutomaticAnalysis()` impostava la bolletta come `running/analyzing` e richiamava `renderEnabled()`.

Lo stesso `renderEnabled()` avviava poi `scheduleAutomaticWork()`. Il controllo delle analisi in corso non escludeva la bolletta già gestita dalla richiesta aperta nella pagina. Di conseguenza veniva programmato un polling ogni 5 secondi.

Ogni polling eseguiva `loadData()`, che richiamava in sequenza:

1. `renderEnabled()`;
2. `renderList()`;
3. `state.list.replaceChildren()`.

L'intero elenco e i pulsanti `APRI`, `VEDI ANALISI`, `VEDI STATO` ed `ELIMINA` venivano quindi distrutti e ricreati ripetutamente. Questo produceva il lampeggiamento visibile.

Alla conclusione dell'analisi esisteva inoltre una seconda ricostruzione ravvicinata: `loadData()` renderizzava già il risultato, poi il blocco `finally` richiamava nuovamente `renderEnabled()`.

## Correzione

- Le analisi già presenti in `analysisInFlightIds` non attivano il polling server.
- Il polling di recupero viene usato solo per analisi avviate sul server e non più collegate alla richiesta locale, per esempio dopo la riapertura dell'app.
- Il recupero interroga soltanto le bollette ancora in analisi.
- Prima di renderizzare viene confrontata un'impronta degli stati e dei dati visibili. Se nulla è cambiato, l'elenco non viene ricostruito.
- Rimossa la renderizzazione intermedia immediatamente precedente all'avvio dell'analisi.
- Rimossa la seconda renderizzazione al termine quando `loadData()` ha già aggiornato la schermata.
- Durante l'elaborazione il pulsante secondario resta fisso, disabilitato e mostra `ANALISI IN CORSO`.
- Il pulsante `APRI` resta disponibile.

## Limite dell'intervento

Questa release elimina il lampeggiamento e le ricostruzioni inutili dell'interfaccia. Non modifica il lettore IA, il timeout o il numero di chiamate del backend; pertanto non dichiara una riduzione del tempo effettivo di analisi.
