# Diagnosi tecnica v0.36.25

## Loop automatico

Nella v0.36.24 `scheduleAutomaticWork()` individuava una bolletta recente in stato `pending/uploaded` e richiamava automaticamente `runAutomaticAnalysis()`. Se la richiesta falliva prima dell'aggiornamento persistente dello stato, il successivo caricamento recuperava nuovamente `pending/uploaded` e riavviava il tentativo.

La v0.36.25 elimina questa selezione automatica. L'avvio automatico è collegato esclusivamente al caricamento appena concluso. Dopo un errore il tentativo successivo è manuale.

## Run server obsoleto

`createPremiumAnalysisRun()` ora legge `started_at`. Un run `queued/running` recente impedisce il duplicato; un run oltre la soglia viene chiuso con `premium_analysis_stale_recovered`, poi viene creato un nuovo run.

## Stabilità dei nodi DOM

La v0.36.24 usava `state.list.replaceChildren()` a ogni render. La v0.36.25 confronta l'ordine degli ID delle bollette:

- se la struttura è cambiata, ricostruisce l'elenco;
- se gli ID sono invariati, aggiorna ogni articolo esistente con `updateBillArticle()`;
- i nodi dei pulsanti vengono creati una volta e conservati;
- soltanto testo, attributi, stato disabilitato e dettaglio vengono aggiornati.

## Versioni legali

La release dell'app e le versioni dei documenti legali sono indipendenti. Il pannello è visibile soltanto quando manca almeno una delle accettazioni correnti. L'evento `offertalogica:legal-acceptance-required` apre automaticamente la sezione Profilo soltanto in tale condizione.
