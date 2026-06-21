# Vendita lead energia

La vendita lead e una strada parallela alle affiliazioni dirette.

L'obiettivo non e cedere contatti a caso, ma trovare una destinazione concreta per utenti che hanno:

- confrontato offerte;
- lasciato dati;
- verificato il telefono;
- scelto una proposta o richiesto consulenza;
- accettato il consenso partner quando necessario.

## Tipi di acquirenti

```text
Broker energia              Lavora piu fornitori e puo chiudere contratti.
Call center energia         Richiama lead privati, spesso a CPL.
Consulente/rete vendita     Buono per partenza controllata e lead locali.
Comparatore maggiore        Possibile revenue share o CPL.
Consulente business         Ideale per aziende, valore lead piu alto.
```

## Criteri prima di inviare lead

Prima di collegare un acquirente al webhook servono:

1. accordo scritto sul trattamento dati;
2. definizione lead valido/non valido;
3. tempo massimo di ricontatto;
4. modello pagamento CPL, CPA o provvigione;
5. regole su scarti e contestazioni;
6. divieto di riuso non autorizzato dei dati;
7. canale sicuro di invio lead.

## Stati acquirente

```text
da_cercare                  Categoria utile, partner non individuato.
da_valutare                 Partner reale individuato, ma modello/fit da verificare.
da_contattare               Partner individuato, primo contatto da inviare.
contattato                  Email o form inviato.
in_valutazione              Partner sta valutando sito e condizioni.
accordo_da_definire         Interesse presente, manca accordo operativo.
attivo                      Lead inviabili.
sospeso                     Non inviare lead.
scartato                    Non adatto o non affidabile.
```

## Strategia consigliata

Partire con 1-2 partner, non con una vendita multipla dello stesso lead.

Motivi:

- piu controllo qualita;
- meno rischi privacy;
- meno reclami utente;
- migliori feedback sui lead;
- trattativa piu semplice su pagamento e scarti.

## File operativo

```text
data/acquirenti-lead.csv
```

Aggiornare ogni riga con:

- nome partner;
- sito;
- contatto;
- modello pagamento;
- stato;
- note privacy;
- priorita.

La prima shortlist di soggetti reali da contattare o valutare e in:

```text
docs/RICERCA-ACQUIRENTI-LEAD.md
```

## Domande da fare al potenziale acquirente

- Che tipo di lead energia acquistate?
- Lavorate privati, business o entrambi?
- Pagate CPL, CPA o provvigione su contratto?
- Quanto vale per voi un lead verificato telefonicamente?
- Entro quanto tempo richiamate il lead?
- Quali dati vi servono davvero?
- Come gestite consensi, cancellazioni e opposizioni?
- Quali sono le cause di scarto?
- Fornite report mensile sugli esiti?

## Regola OffertaLogica

Non inviare lead senza:

- consenso partner;
- destinazione commerciale chiara;
- accordo o almeno prova documentata con il soggetto ricevente;
- registro interno dello stato lead.
