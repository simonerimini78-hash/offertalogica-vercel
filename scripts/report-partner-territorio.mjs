// Report operativo da esportazione di eventi OL: nessuna API o dato cliente richiesto.
// Uso: node scripts/report-partner-territorio.mjs eventi.json 2027-01
import { readFileSync } from 'node:fs';
const [file, month] = process.argv.slice(2);
if (!file || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) {
  console.error('Uso: node scripts/report-partner-territorio.mjs eventi.json AAAA-MM');
  process.exit(2);
}
const source = JSON.parse(readFileSync(file, 'utf8'));
const rows = Array.isArray(source) ? source : Array.isArray(source?.events) ? source.events : null;
if (!rows) throw new Error('Atteso un array eventi oppure un oggetto con proprietà events');
const result = new Map();
const ensure = key => {
  if (!result.has(key)) result.set(key, { scheda: 0, offerte: 0, sito: 0, fonte: 0, dalCap: 0 });
  return result.get(key);
};
const get = (r, k, alt) => r[k] ?? r[alt];
for (const row of rows) {
  if (!row || typeof row !== 'object') continue;
  const date = String(get(row,'created_at','createdAt') || '');
  if (!date.startsWith(month)) continue;
  if (get(row,'event_type','eventType') !== 'site_action_clicked') continue;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : row;
  if (!String(payload.page || '').includes('/fornitori-vicino-a-te')) continue;
  const item = String(payload.item || '');
  const match = /^territorio_(offerte_dal_cap|offerte|sito|fonte)_([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(item);
  if (!match) continue;
  const [, type, key] = match;
  const metrics = ensure(key);
  if (type === 'offerte_dal_cap') metrics.dalCap++;
  if (type === 'offerte') metrics.offerte++;
  if (type === 'sito') metrics.sito++;
  if (type === 'fonte') metrics.fonte++;
}
const quote = str => '"' + String(str).replaceAll('"', '""') + '"';
console.log(['mese','fornitore_id','aperture_offerte','click_sito','click_fonti','click_offerte_da_cap','attivazioni_confermate','impression_scheda'].map(quote).join(','));
for (const [key, metrics] of [...result.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
  console.log([month,key,metrics.offerte,metrics.sito,metrics.fonte,metrics.dalCap,'N/D','N/D'].map(quote).join(','));
}
// Questi eventi non certificano impression né conversioni. L'assenza di eventi non equivale a zero attività.
