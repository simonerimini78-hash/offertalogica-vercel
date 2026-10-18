// Generatore esplicito del catalogo pubblico: nessun aggiornamento automatico esistente viene modificato.
// Eseguire dopo approvazione amministrativa delle singole schede contrattuali.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const base = resolve('data/partner-territoriali');
const directory = JSON.parse(readFileSync(resolve('public/data/fornitori-territoriali.json'), 'utf8'));
if (!directory?.providers || typeof directory.providers !== 'object') throw new Error('Anagrafica territoriale non valida');
const active = [];
if (existsSync(base)) for (const filename of readdirSync(base).filter(n => /^[a-z0-9-]+\.json$/.test(n)).sort()) {
  const row = JSON.parse(readFileSync(resolve(base, filename), 'utf8'));
  const id = filename.slice(0,-5);
  if (row.providerId !== id || !Object.hasOwn(directory.providers,id)) throw new Error('Identificativo partner incoerente: '+filename);
  if (row.status !== 'active') continue;
  if (row.contractSigned !== true || row.contentApproved !== true || row.territoriesVerified !== true) throw new Error('Partner attivo senza verifiche complete: '+id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.activeFrom ?? '')) throw new Error('Decorrenza mancante: '+id);
  if (row.activeFrom > new Date().toISOString().slice(0,10)) continue;
  active.push(id);
}
writeFileSync(resolve('public/data/partner-territoriali-attivi.json'), JSON.stringify({schemaVersion:1,providers:active},null,2)+'\n');
console.log('Partner pubblicati:',active.length);
