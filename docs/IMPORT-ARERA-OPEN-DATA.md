# Import open data ARERA/AU

Aggiornamento: 2026-06-25

Questo flusso serve a usare il Portale Offerte come magazzino neutro di tariffe reali senza trasformare automaticamente ogni riga in un'offerta pubblica.

## Principio

ARERA/AU e la fonte di confronto. Le affiliazioni e i partner sono la fonte di monetizzazione.

Per questo le offerte del Portale possono entrare nel calcolatore solo dopo una selezione:

```text
open data ARERA/AU -> candidati -> shortlist -> verifica -> offerte-proposte.json
```

## File coinvolti

```text
data/offerte-reali-arera-candidati.csv
data/arera-candidati-menu.csv
data/arera-shortlist-manutenzione.csv
data/offerte-proposte.json
public/data/offerte-proposte.json
data/certificazione-offerte.csv
```

## Comando operativo

Per scaricare gli ultimi open data dal Portale Offerte:

```text
npm run sync:arera
```

Il comando aggiorna:

```text
data/offerte-reali-arera-candidati.csv
data/arera-sync-meta.json
```

Per creare la lista di lavoro:

```text
npm run shortlist:arera
```

Il comando legge `data/offerte-reali-arera-candidati.csv` e genera:

```text
data/arera-candidati-menu.csv
data/arera-shortlist-manutenzione.csv
```

`arera-candidati-menu.csv` e l'estrazione utile per OffertaLogica: contiene solo fornitori presenti nella tendina del calcolatore.

`arera-shortlist-manutenzione.csv` contiene invece le prime righe da verificare, ordinate per priorita operativa.

## Promozione nel listino pubblico

Quando una riga e pronta e vogliamo usarla nel calcolatore live, usare:

```text
npm run promote:arera -- --offer-id 11 --luce CODICE_LUCE --gas CODICE_GAS
```

Prima di scrivere:

```text
npm run promote:arera -- --offer-id 11 --luce CODICE_LUCE --gas CODICE_GAS --dry-run
```

Lo script:

- legge `data/arera-candidati-menu.csv`;
- accetta solo righe `pronta_fisso`;
- aggiorna `data/offerte-proposte.json`;
- sincronizza `public/data/offerte-proposte.json`;
- aggiorna `data/certificazione-offerte.csv`;
- conserva il link affiliato/partner gia presente nell'offerta live.

Se vuoi sostituire anche il link dell'offerta con quello ARERA, aggiungi:

```text
--update-link
```

Usarlo con cautela: per Enel, Plenitude o altri partner attivi normalmente vogliamo conservare il link tracciato.

La shortlist divide le righe in:

```text
pronta_fisso              Offerta fissa domestica con prezzo e quota fissa leggibili.
richiede_indice_pun_psv   Offerta variabile domestica: serve formula PUN/PSV + spread.
da_verificare             Riga utilizzabile ma con elemento ambiguo.
scartata                  Fuori perimetro o non adatta al calcolatore domestico.
```

## Automazione GitHub

Il file:

```text
.github/workflows/update-arera-menu.yml
```

aggiorna il menu ARERA/AU usato come magazzino tecnico consultabile. Non promuove automaticamente offerte nel calcolatore pubblico e non sostituisce la verifica umana.

La pubblicazione live resta manuale:

```text
candidati ARERA -> shortlist -> verifica umana -> offerte-proposte.json
```

Questa scelta e voluta. Gli open data sono reali, ma alcune offerte variabili contengono spread, macroaree, fasce, condizioni o riferimenti PUN/PSV che non vanno trasformati automaticamente in prezzo finale.

## Regola per le offerte variabili

Nei dati del Portale molte offerte variabili espongono spread, corrispettivi o valori di calcolo che non vanno confusi con il prezzo finale tutto incluso.

Nel motore OffertaLogica un'offerta variabile corretta deve usare questa struttura:

```json
{
  "tipo": "variabile",
  "luce": {
    "prezzoVariabile": 0,
    "formula": { "tipo": "indice_spread", "indice": "pun", "spread": 0.0278 },
    "quotaFissaAnnua": 144
  },
  "gas": {
    "prezzoVariabile": 0,
    "formula": { "tipo": "indice_spread", "indice": "psv", "spread": 0.09 },
    "quotaFissaAnnua": 120
  }
}
```

Poi bisogna valorizzare in modo documentato:

```text
indiciMercato.pun.valore
indiciMercato.psv.valore
```

Se PUN/PSV non sono valorizzati con una fonte chiara, la variabile resta candidata e non va promossa nel live.

## Regola commerciale

Le migliori offerte reali possono essere usate come benchmark anche senza monetizzazione.

Le offerte affiliate attive, invece, restano sempre visibili come `Attivabile online` o `Alternativa attivabile`, per non lasciare l'utente senza una destinazione concreta.

Questa separazione evita due errori:

- mostrare solo offerte monetizzabili e perdere credibilita;
- mostrare solo offerte non monetizzabili e perdere il ricavo.
