// Report mensile da eventi esportati: partner da contratti privati, mai dal catalogo pubblico corrente.
// Uso: node scripts/report-partner-territorio.mjs eventi.json AAAA-MM
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
const [file,month]=process.argv.slice(2);
if(!file || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month||'')) {console.error('Uso: node scripts/report-partner-territorio.mjs eventi.json AAAA-MM');process.exit(2);}
const dir=resolve(process.cwd(),'data/partner-territoriali');
const contracts=new Map();
const validDate=s=>typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const monthEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
if(existsSync(dir)) for(const name of readdirSync(dir)) {
  if(!/^[a-z0-9-]+\.json$/.test(name)) continue;
  const id=basename(name,'.json');
  const data=JSON.parse(readFileSync(resolve(dir,name),'utf8'));
  if(data.providerId!==id || data.contractSigned!==true || data.contentApproved!==true || data.territoriesVerified!==true || !validDate(data.activeFrom) || !validDate(data.activeUntil) || data.activeFrom>data.activeUntil) continue;
  if(data.activeFrom>monthEnd || data.activeUntil<month+'-01') continue;
  contracts.set(id,data);
}
const source=JSON.parse(readFileSync(file,'utf8'));
const events=Array.isArray(source)?source:Array.isArray(source?.events)?source.events:null;
if(!events) throw new Error('Formato eventi non valido');
const metrics=new Map([...contracts.keys()].map(id=>[id,{offers:0,site:0,source:0,fromCap:0}]));
for(const event of events){
  if(!event || typeof event!=='object') continue;
  const ts=String(event.created_at??event.createdAt??'');
  if(!/^\d{4}-\d{2}-\d{2}/.test(ts) || !ts.startsWith(month))continue;
  if((event.event_type??event.eventType)!=='site_action_clicked')continue;
  const p=event.payload && typeof event.payload==='object'?event.payload:event;
  if(p.page!=='/fornitori-vicino-a-te.html' && p.page!=='/fornitori-vicino-a-te')continue;
  const match=/^territorio_(offerte_dal_cap|offerte|sito|fonte)_([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(String(p.item??''));
  if(!match || !contracts.has(match[2]))continue;
  const contract=contracts.get(match[2]);
  const date=ts.slice(0,10);
  if(date<contract.activeFrom || date>contract.activeUntil)continue;
  const m=metrics.get(match[2]);
  if(match[1]==='offerte')m.offers++;
  else if(match[1]==='sito')m.site++;
  else if(match[1]==='fonte')m.source++;
  else if(match[1]==='offerte_dal_cap')m.fromCap++;
}
const q=value=>'"'+String(value).replaceAll('"','""')+'"';
console.log(['mese','fornitore_id','aperture_offerte','click_sito','click_fonti','click_offerte_da_cap','attivazioni_confermate','impression_scheda'].map(q).join(','));
for(const [id,m] of [...metrics].sort((a,b)=>a[0].localeCompare(b[0])))console.log([month,id,m.offers,m.site,m.source,m.fromCap,'N/D','N/D'].map(q).join(','));
