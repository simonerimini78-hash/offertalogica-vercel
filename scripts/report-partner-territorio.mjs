// Report mensile territoriale da esportazione degli eventi OL. Nessuna nuova API.
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
  if (!result.has(key)) result.set(key, { offerte: 0, sito: 0, fonte: 0, dalCap: 0 });
  return result.get(key);
};
const stats = { pageViews: 0, searches: 0 };
for (const row of rows) {
  if (!row || typeof row !== 'object') continue;
  const date = String(row.created_at ?? row.createdAt ?? '');
  if (!date.startsWith(month)) continue;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : row;
  const page = String(payload.page ?? row.page ?? '');
  if (page !== '/fornitori-vicino-a-te' && page !== '/fornitori-vicino-a-te.html') continue;
  const type = row.event_type ?? row.eventType;
  if (type === 'site_page_view') { stats.pageViews++; continue; }
  if (type !== 'site_action_clicked') continue;
  const item = String(payload.item || '');
  if (item === 'territorio_ricerca_cap') { stats.searches++; continue; }
  const match = /^territorio_(offerte_dal_cap|offerte|sito|fonte)_([a-z0-9]+)$/.exec(item);
  if (!match) continue;
  const [, action, key] = match;
  const values = ensure(key);
  if (action === 'offerte_dal_cap') values.dalCap++;
  if (action === 'offerte') values.offerte++;
  if (action === 'sito') values.sito++;
  if (action === 'fonte') values.fonte++;
}
const q = value => '"' + String(value).replaceAll('"', '""') + '"';
const header = ['mese','fornitore_id','visite_pagina_totali','click_cerca_cap_totali','click_apri_offerte','click_sito','click_fonti','click_apri_da_cap','attivazioni_confermate','impression_scheda'];
console.log(header.map(q).join(','));
// Riga complessiva separata: visite e ricerche NON sono impression del singolo partner.
console.log([month,'TOTALE_PAGINA',stats.pageViews,stats.searches,'N/D','N/D','N/D','N/D','N/D','N/D'].map(q).join(','));
for (const [key, metric] of [...result.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
  console.log([month,key,'N/D','N/D',metric.offerte,metric.sito,metric.fonte,metric.dalCap,'N/D','N/D'].map(q).join(','));
}
// Nessuna riga partner non presente nei log: l'assenza non equivale a zero.
// Il click sul pulsante è contato anche se la scheda/offerta non è poi stata effettivamente letta.
