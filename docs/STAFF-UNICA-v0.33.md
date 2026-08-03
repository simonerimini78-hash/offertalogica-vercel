# OffertaLogica v0.33 — Area staff unica

## Obiettivo

Consolidare le pagine operative dello staff in un solo ingresso:

- `/staff.html`

La pagina usa un’unica sessione Supabase e non richiede più token manuali nell’URL o nei moduli.

## Moduli disponibili

1. Riepilogo operativo.
2. Lead e attivazioni.
3. Controlli Premium.
4. Clienti, utenze e contratti correnti.
5. Analytics e funnel.
6. Archivio diagnostico PDF del lettore.
7. Costi IA e tempi di revisione umana.

## Ruoli

- `reviewer`: controlli Premium, clienti e utenze, analytics, diagnostica PDF, analisi IA e tempi staff.
- `admin`: tutte le funzioni precedenti, più lead, CSV, eliminazioni, abbonamenti e registro economico completo.

Le eliminazioni dei lead e delle analisi PDF diagnostiche richiedono una sessione Supabase con ruolo `admin`.

## Migrazione dagli accessi precedenti

Le pagine seguenti reindirizzano all’area unica:

- `/staff-leads.html` → `/staff.html#leads`
- `/staff-analytics.html` → `/staff.html#analytics`
- `/staff-premium.html` → `/staff.html#checks`
- `/staff-pdf.html` → `/staff.html#pdf`

I moduli complessi Controlli Premium e Diagnostica PDF vengono caricati nella pagina unica in modalità incorporata e condividono la stessa sessione Supabase.

## API aggiornate

Senza aggiungere funzioni Vercel:

- `api/staff-leads.js`
- `api/staff-analytics.js`
- `api/staff-pdf-analyses.js`

Le API verificano il JWT Supabase tramite `lib/staffSessionAuth.js` e il record attivo in `premium_staff_members`.

Il token `STAFF_PREVIEW_TOKEN` non viene più usato da questi percorsi. Il token health rimane ammesso soltanto per la lettura degli analytics e non abilita modifiche.

## Sicurezza conservata

- Nessuna chiave segreta nel frontend.
- Nessuna nuova API Vercel: il totale resta 12.
- Nessuna modifica alle policy v0.32 sui PDF Premium.
- I PDF Premium restano leggibili dallo staff solo quando il cliente ha richiesto un controllo non annullato.
- Le operazioni di modifica sulle API staff applicano il controllo dell’origine.
- Le pagine staff sono `noindex`, `nofollow` e `noarchive`.

## Database

La v0.33 non richiede migrazioni SQL. Riutilizza ruoli, RLS e tabelle già installati fino alla v0.32.

## Verifiche eseguite

- Test Premium e staff: 98/98.
- Test specifici archivio diagnostico PDF: 9/9.
- Suite completa repository: 314/327.
- I 13 errori della suite completa sono identici alla base v0.32 e riguardano il comparatore/lettore gratuito, non la v0.33.
- Sintassi dei file JavaScript modificati: valida.
- Funzioni Vercel presenti: 12.
