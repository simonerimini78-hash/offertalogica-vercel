// Catalogo pubblico generato soltanto su comando autorizzato. Non modifica job o API esistenti.
// Uso: node scripts/genera-partner-territoriali.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
const root=process.cwd();
const privateDir=resolve(root,'data/partner-territoriali');
const output=resolve(root,'public/data/partner-territoriali-attivi.json');
// In caso di errore azzera SEMPRE l'archivio pubblico, anche se manca il file geografico.
const empty={schemaVersion:2,providers:[],coverageByProvider:{},visibleUntilByProvider:{}};
try {
const geo=JSON.parse(readFileSync(resolve(root,'public/data/fornitori-territoriali.json'),'utf8'));
if (geo?.schemaVersion !== 1 || !geo.providers || typeof geo.providers !== 'object' || Array.isArray(geo.providers)) throw new Error('Archivio geografico non valido');
const now=new Date();
const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
const isDate=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const partners=[];
if(existsSync(privateDir)) for(const name of readdirSync(privateDir).sort()) {
  if(!name.endsWith('.json')) continue;
  if(!/^[a-z0-9-]+\.json$/.test(name)) throw new Error('Nome file non consentito: '+name);
  const id=basename(name,'.json');
  const entry=JSON.parse(readFileSync(resolve(privateDir,name),'utf8'));
  if(entry.providerId!==id || !Object.hasOwn(geo.providers,id)) throw new Error('Fornitore sconosciuto: '+id);
  if(!['draft','active','paused','ended'].includes(entry.status)) throw new Error('Stato non valido: '+id);
  if(entry.status!=='active') continue;
  if(entry.contractSigned!==true || entry.contentApproved!==true || entry.territoriesVerified!==true) throw new Error('Approvazioni mancanti: '+id);
  if(!isDate(entry.activeFrom) || !isDate(entry.activeUntil) || entry.activeUntil<entry.activeFrom) throw new Error('Periodo contrattuale non valido: '+id);
  if(entry.activeFrom>today || entry.activeUntil<today) continue;
  if(!Array.isArray(entry.verifiedCaps) || entry.verifiedCaps.length===0 || entry.verifiedCaps.some(cap=>typeof cap!=='string'|| !/^\d{5}$/.test(cap))) throw new Error('CAP di copertura verificati mancanti o non validi: '+id);
  if(new Set(entry.verifiedCaps).size!==entry.verifiedCaps.length) throw new Error('CAP duplicati: '+id);
  partners.push({id,verifiedCaps:entry.verifiedCaps.slice().sort(),visibleUntil:entry.activeUntil});
}
const doc={schemaVersion:2,providers:partners.map(p=>p.id),coverageByProvider:Object.fromEntries(partners.map(p=>[p.id,p.verifiedCaps])),visibleUntilByProvider:Object.fromEntries(partners.map(p=>[p.id,p.visibleUntil]))};
writeFileSync(output,JSON.stringify(doc,null,2)+'\n');
console.log('Partner pubblicabili:',partners.length);
} catch (error) {
  writeFileSync(output,JSON.stringify(empty,null,2)+'\n');
  throw error;
}
