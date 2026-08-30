const TOOL_VERSION = '1.1';
const TRACK_URL = '/api/track-event';
const PDF_REPLAY_KEY = 'offertalogicaPdfArchiveReplay';
const root = document.getElementById('ol-pv-tool');
if (!root) throw new Error('Fotovoltaico tool root non trovato');

let mode = 'consumer';
let billReplayPayload = null;
const source = 'seo_fotovoltaico';
const sessionId = (() => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `pv-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
})();

const REGIONS = {
  'Valle d’Aosta': { lat:45.74, lon:7.32, yield:1220 }, 'Piemonte': { lat:45.05, lon:7.67, yield:1280 },
  'Liguria': { lat:44.41, lon:8.93, yield:1410 }, 'Lombardia': { lat:45.47, lon:9.19, yield:1260 },
  'Trentino-Alto Adige': { lat:46.07, lon:11.12, yield:1260 }, 'Veneto': { lat:45.44, lon:12.33, yield:1320 },
  'Friuli-Venezia Giulia': { lat:45.65, lon:13.77, yield:1320 }, 'Emilia-Romagna': { lat:44.49, lon:11.34, yield:1370 },
  'Toscana': { lat:43.77, lon:11.25, yield:1460 }, 'Umbria': { lat:43.11, lon:12.39, yield:1460 },
  'Marche': { lat:43.62, lon:13.52, yield:1470 }, 'Lazio': { lat:41.90, lon:12.50, yield:1540 },
  'Abruzzo': { lat:42.35, lon:13.40, yield:1510 }, 'Molise': { lat:41.56, lon:14.66, yield:1550 },
  'Campania': { lat:40.85, lon:14.27, yield:1620 }, 'Puglia': { lat:41.12, lon:16.87, yield:1710 },
  'Basilicata': { lat:40.64, lon:15.81, yield:1650 }, 'Calabria': { lat:38.91, lon:16.59, yield:1750 },
  'Sicilia': { lat:38.12, lon:13.36, yield:1810 }, 'Sardegna': { lat:39.22, lon:9.12, yield:1780 }
};
const orientationFactor = { south:1, southeast:.96, southwest:.96, east:.88, west:.88, flat:.94, north:.64 };
const monthNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const northDist = [.035,.055,.085,.105,.12,.135,.14,.12,.09,.06,.035,.02];
const southDist = [.05,.065,.09,.105,.115,.12,.125,.115,.09,.06,.04,.025];
const $ = (id) => document.getElementById(id);
const clamp = (v,min,max) => Math.min(max, Math.max(min,v));
const fmt = (v,d=0) => new Intl.NumberFormat('it-IT',{maximumFractionDigits:d,minimumFractionDigits:d}).format(v);
const euro = (v) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);

function num(id) {
  const el = $(id);
  if (!el) return null;
  const raw = String(el.value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function setText(id,value){ const el=$(id); if(el) el.textContent=value; }
function status(text,type=''){ const el=$('pv-status'); if(!el)return; el.textContent=text; el.className=`status ${type}`.trim(); }
function billStatus(text,type=''){ const el=$('pv-bill-status'); if(!el)return; el.textContent=text; el.className=`bill-import-status ${type}`.trim(); }
function isStaffPreview(){ try { return sessionStorage.getItem('offertalogicaStaffMode') === 'true'; } catch { return false; } }
function track(action, detail={}) {
  if (isStaffPreview()) return;
  const customerType = mode === 'business' ? 'business' : 'consumer';
  const toolCode = mode === 'business' ? 'fotovoltaico_business' : 'fotovoltaico';
  const payload = { toolCode, toolAction: action, toolOutcome: String(detail.outcome || '').slice(0,100), toolContext: String(detail.context || '').slice(0,80), toolVersion: TOOL_VERSION, source, page: location.pathname, customerType, dataOrigin: source };
  fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventType:'interactive_tool_event',sessionId,page:location.pathname,customerType,dataOrigin:source,source,payload}),credentials:'same-origin',keepalive:true}).catch(()=>{});
}

function nearestRegion(lat,lon){
  let best=null;
  Object.entries(REGIONS).forEach(([name,r])=>{ const d=(lat-r.lat)**2+((lon-r.lon)*.75)**2; if(!best||d<best.d) best={name,...r,d}; });
  return best;
}
function validCoordinate(value, min, max){ return Number.isFinite(value) && value >= min && value <= max; }
function baseYield(){
  const lat=num('pv-lat'), lon=num('pv-lon');
  const selected=$('pv-region')?.value;
  if(validCoordinate(lat,35,48) && validCoordinate(lon,5,20)){
    const nearest=nearestRegion(lat,lon);
    const geo=clamp(1945-(lat-36.5)*79+(lon-12)*2.5,1150,1900);
    return {value:geo*.62+nearest.yield*.38,lat,lon,label:nearest.name};
  }
  if(selected && REGIONS[selected]) return {value:REGIONS[selected].yield,lat:REGIONS[selected].lat,lon:REGIONS[selected].lon,label:selected};
  return null;
}
function tiltFactor(lat,tilt){ const optimal=clamp((lat||42.5)-10,24,37); const delta=Math.abs(tilt-optimal); return clamp(1-delta*.0028-delta*delta*.00005,.78,1.01); }
function costRange(power){
  if(mode==='business'){ const center=power<=20?1280:power<=100?1050:power<=300?890:790; return [power*center*.86,power*center*1.16]; }
  const center=power<=3?1650:power<=6?1500:power<=10?1375:1280; return [power*center*.86,power*center*1.16];
}
function monthlyDistribution(lat){ const t=clamp(((lat||42.5)-37)/9,0,1); const arr=northDist.map((v,i)=>v*t+southDist[i]*(1-t)); const sum=arr.reduce((a,b)=>a+b,0); return arr.map(v=>v/sum); }
function renderChart(annual,lat){
  const chart=$('pv-monthly-chart'); if(!chart)return;
  const values=monthlyDistribution(lat).map(v=>annual*v); const max=Math.max(...values,1);
  chart.innerHTML=values.map((v,i)=>`<div class="month-bar"><strong>${fmt(v)}</strong><div class="bar" style="height:${Math.max(4,(v/max)*145)}px" aria-hidden="true"></div><span>${monthNames[i]}</span></div>`).join('');
}

function comparisonUrl({ replay = false } = {}){
  const params = new URLSearchParams({ landing:'0', source: mode==='business' ? 'fotovoltaico_business' : 'fotovoltaico' });
  if(replay) params.set('pdfReplay','1');
  return `/?${params.toString()}`;
}
function updateComparisonCta(){
  const cta=$('pv-compare-cta');
  if(!cta)return;
  cta.textContent=mode==='business'?'Confronta offerte Business':'Vai al confronto offerte';
  cta.href=comparisonUrl({replay:Boolean(billReplayPayload)});
  if(!billReplayPayload){
    setText('pv-next-copy',mode==='business'
      ? 'Confronta il costo dell’energia che l’azienda continuerà a prelevare dalla rete.'
      : 'Confronta il costo dell’energia che continuerai a prelevare dalla rete.');
  }
}
function setMode(next, kind=''){
  mode=next==='business'?'business':'consumer';
  root.dataset.mode=mode;
  document.querySelectorAll('[data-segment]').forEach((button)=>{ const active=button.dataset.segment===mode; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
  document.querySelectorAll('.business-only').forEach((el)=>{ el.hidden=mode!=='business'; });
  if(mode==='business'){
    if(kind==='agriculture') $('pv-business-kind').value='agriculture';
    $('pv-power-kw').max='1000';
  } else {
    $('pv-power-kw').max='50';
  }
  updateAgricultureVisibility();
  updateComparisonCta();
  track('segment_changed',{context:mode});
}
function updateAgricultureVisibility(){
  const agriculture=mode==='business' && $('pv-business-kind')?.value==='agriculture';
  document.querySelectorAll('.agriculture-only').forEach((el)=>{ el.hidden=!agriculture; });
}

function compute(){
  const geo=baseYield();
  if(!geo){ status('Seleziona una regione oppure usa la tua posizione.','error'); return; }
  let power=num('pv-power-kw'); const surface=num('pv-surface-m2');
  if((!power||power<=0)&&surface&&surface>0){ power=surface/(mode==='business'?5:5.2); $('pv-power-kw').value=power.toFixed(1); }
  if(!power||power<=0){ status('Inserisci la potenza dell’impianto oppure una superficie disponibile.','error'); return; }
  power=clamp(power,mode==='business'?3:1,mode==='business'?1000:50);
  const orientation=$('pv-orientation')?.value||'south'; const tilt=clamp(num('pv-tilt')??30,0,90);
  const specific=geo.value*(orientationFactor[orientation]||1)*tiltFactor(geo.lat,tilt); const annual=power*specific;
  const areaNeeded=power*(mode==='business'?5:5.2); const [costMin,costMax]=costRange(power); const consumption=num('pv-consumption-kwh');
  let selfKwh=null,residual=null,excess=null,coverage=null,savings=null;
  if(consumption&&consumption>0){
    let selfRate;
    if(mode==='business'){
      const f1=num('pv-f1'),f2=num('pv-f2'),f3=num('pv-f3'); const complete=[f1,f2,f3].every(v=>v!==null&&v>=0); const bandTotal=complete?f1+f2+f3:0;
      const dayShare=bandTotal>0?clamp(f1/bandTotal,0,1):.42; const loadRatio=clamp(consumption/annual,0,1.5);
      const agriculturalBonus=$('pv-business-kind')?.value==='agriculture'?.03:0;
      selfRate=clamp(.28+dayShare*.42+Math.min(1,loadRatio)*.12+agriculturalBonus,.32,.85);
    } else {
      const loadRatio=clamp(consumption/annual,0,1.5); selfRate=clamp(.25+Math.min(1,loadRatio)*.30,.28,.58);
    }
    selfKwh=Math.min(consumption,annual*selfRate); residual=Math.max(0,consumption-selfKwh); excess=Math.max(0,annual-selfKwh); coverage=selfKwh/consumption*100;
    const price=num('pv-energy-price'); if(price&&price>0)savings=selfKwh*price;
  }
  setText('pv-result-place',geo.label); setText('pv-result-annual',`${fmt(annual)} kWh`); setText('pv-result-specific',`${fmt(specific)} kWh/kW`); setText('pv-result-area',`${fmt(areaNeeded,1)} m²`); setText('pv-result-cost',`${euro(costMin)} – ${euro(costMax)}`);
  setText('pv-result-self',selfKwh===null?'Aggiungi i consumi':`${fmt(selfKwh)} kWh`); setText('pv-result-grid',residual===null?'Aggiungi i consumi':`${fmt(residual)} kWh`); setText('pv-result-excess',excess===null?'Aggiungi i consumi':`${fmt(excess)} kWh`); setText('pv-result-coverage',coverage===null?'Aggiungi i consumi':`${fmt(coverage,1)}%`);
  const savingsBox=$('pv-saving-impact'); if(savingsBox){ savingsBox.hidden=savings===null; if(savings!==null)setText('pv-result-savings',`${euro(savings)} / anno`); }
  const surfaceCheck=$('pv-surface-check'); if(surfaceCheck){ surfaceCheck.textContent=surface&&surface>0?(surface>=areaNeeded?`La superficie indicata è compatibile con circa ${fmt(power,1)} kW nel modello.`:`Per ${fmt(power,1)} kW servirebbero circa ${fmt(areaNeeded-surface,1)} m² in più.`):`Superficie tecnica indicativa: circa ${fmt(areaNeeded,1)} m².`; }
  renderChart(annual,geo.lat); $('pv-results').hidden=false; status(`Stima calcolata per ${geo.label}.`,'ok'); track('calculation_completed',{outcome:`${Math.round(annual)}kwh`,context:`${geo.label}:${mode}`}); $('pv-results').scrollIntoView({behavior:'smooth',block:'start'});
}

function useLocation(){
  if(!window.isSecureContext){ status('La posizione richiede una connessione HTTPS. Seleziona la regione manualmente.','error'); return; }
  if(!navigator.geolocation){ status('Geolocalizzazione non disponibile: scegli una regione.','error'); return; }
  const button=$('pv-use-location'); if(button)button.disabled=true; status('Richiesta della posizione in corso…'); track('location_requested');
  navigator.geolocation.getCurrentPosition((pos)=>{
    if(button)button.disabled=false;
    const lat=Number(pos.coords.latitude),lon=Number(pos.coords.longitude); if(!validCoordinate(lat,35,48)||!validCoordinate(lon,5,20)){ status('La posizione rilevata non sembra essere in Italia: scegli una regione.','error'); return; }
    $('pv-lat').value=lat.toFixed(5); $('pv-lon').value=lon.toFixed(5); const near=nearestRegion(lat,lon); $('pv-region').value=near.name; status(`Posizione rilevata: ${near.name}.`,'ok'); track('location_resolved',{context:near.name});
  },(error)=>{ if(button)button.disabled=false; const message=error?.code===1?'Permesso posizione non concesso: scegli una regione.':'Posizione non disponibile: scegli una regione.'; status(message,'error'); },{enableHighAccuracy:false,timeout:12000,maximumAge:900000});
}
function powerFromSurface(){ const surface=num('pv-surface-m2'); if(!surface||surface<=0){ status('Inserisci prima la superficie disponibile.','error'); return; } const power=surface/(mode==='business'?5:5.2); $('pv-power-kw').value=power.toFixed(1); status(`Potenza preliminare: circa ${fmt(power,1)} kW.`,'ok'); }

async function jsonResponse(response){ const type=response?.headers?.get?.('content-type')||''; if(!type.includes('application/json'))throw new Error('Servizio di lettura non disponibile'); const payload=await response.json(); if(!response.ok||!payload?.ok)throw new Error(payload?.error||'Lettura non disponibile'); return payload; }
async function analyzeBill(file){
  if(!file||file.type!=='application/pdf')throw new Error('Seleziona una bolletta in formato PDF');
  if(Number(file.size||0)>=4_000_000){
    const created=await jsonResponse(await fetch('/api/analyze-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create_upload',filename:file.name||'bolletta.pdf',mimeType:file.type||'application/pdf',fileSize:Number(file.size||0)})}));
    const upload=created.upload||{}; if(!upload.uploadUrl||!upload.uploadTicket)throw new Error('Caricamento protetto del PDF non riuscito');
    const body=new FormData(); body.append('file',file,file.name||'bolletta.pdf'); const uploaded=await fetch(upload.uploadUrl,{method:'PUT',body}); if(!uploaded.ok)throw new Error('Caricamento protetto del PDF non riuscito');
    return jsonResponse(await fetch('/api/analyze-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'analyze_uploaded_pdf',uploadTicket:upload.uploadTicket,archiveContext:{sessionId,customerType:mode==='business'?'business':'privato'}})}));
  }
  const body=new FormData(); body.append('pdf',file); body.append('archiveContext',JSON.stringify({sessionId,customerType:mode==='business'?'business':'privato'})); return jsonResponse(await fetch('/api/analyze-pdf',{method:'POST',body}));
}
function contractValue(data,field){ const entry=data?.data_contract?.fields?.[field]; if(entry?.status==='completo'&&entry?.normalized_value!==undefined)return entry.normalized_value; return data?.[field]; }
function applyBillData(payload,file){
  const data=payload?.normalized||{}; const commodity=String(data.commodity||'').toLowerCase(); if(commodity==='gas')throw new Error('Per il simulatore fotovoltaico serve una bolletta luce');
  if(data.customer_type==='business')setMode('business'); else if(data.customer_type==='privato')setMode('consumer');
  const values={
    'pv-consumption-kwh':contractValue(data,'consumo_luce_kwh'), 'pv-f1':contractValue(data,'consumo_luce_f1_kwh'), 'pv-f2':contractValue(data,'consumo_luce_f2_kwh'), 'pv-f3':contractValue(data,'consumo_luce_f3_kwh'),
    'pv-contract-power':contractValue(data,'potenza_impegnata_kw'), 'pv-energy-price':contractValue(data,'prezzo_luce_eur_kwh')
  };
  let imported=0; Object.entries(values).forEach(([id,value])=>{ const target=$(id); const number=Number(value); if(target&&Number.isFinite(number)&&number>=0){ target.value=String(number); imported++; } });
  if(!num('pv-consumption-kwh')){ const bands=['pv-f1','pv-f2','pv-f3'].map(num); if(bands.every(v=>v!==null&&v>=0))$('pv-consumption-kwh').value=String(bands.reduce((a,b)=>a+b,0)); }
  if(!imported)throw new Error('La bolletta è stata letta, ma non contiene dati luce utilizzabili automaticamente');
  billReplayPayload={normalized:data,filename:file?.name||'bolletta.pdf',analysisId:payload?.archive?.analysisId||payload?.analysisId||null};
  try{ sessionStorage.setItem(PDF_REPLAY_KEY,JSON.stringify(billReplayPayload)); }catch{}
  $('pv-imported-note').hidden=false; updateComparisonCta(); setText('pv-next-copy',mode==='business'?'La bolletta aziendale è già stata letta: apri direttamente il confronto Business senza ricaricarla.':'La bolletta è già stata letta: apri direttamente il confronto offerte senza ricaricarla.');
  billStatus(`Bolletta letta: ${imported} dati energetici inseriti automaticamente.`,'ok'); track('bill_data_imported',{outcome:String(imported),context:mode});
}
async function onBillSelected(event){
  const file=event.target?.files?.[0]; if(!file)return; billStatus('Lettura della bolletta in corso…'); $('pv-bill-file').disabled=true; track('bill_analysis_started');
  try{ const payload=await analyzeBill(file); applyBillData(payload,file); }
  catch(error){ billStatus(String(error?.message||'Lettura non disponibile'),'error'); track('bill_analysis_failed',{outcome:String(error?.message||'error')}); }
  finally{ $('pv-bill-file').disabled=false; event.target.value=''; }
}
function prepareComparison(){ if(!billReplayPayload)return; try{ sessionStorage.setItem(PDF_REPLAY_KEY,JSON.stringify(billReplayPayload)); }catch{} }

function prefillFromQuery(){
  const q=new URLSearchParams(location.search); const requestedProfile=String(q.get('profilo')||'').toLowerCase(); const requestedKind=String(q.get('tipo')||'').toLowerCase();
  if(requestedProfile==='azienda'||requestedProfile==='business'||requestedKind==='agricola'||requestedKind==='agriculture')setMode('business',requestedKind.startsWith('agri')?'agriculture':'');
  const map={consumo:'pv-consumption-kwh',f1:'pv-f1',f2:'pv-f2',f3:'pv-f3',potenza:'pv-contract-power',prezzo:'pv-energy-price',superficie:'pv-surface-m2',impianto:'pv-power-kw'}; let imported=0;
  Object.entries(map).forEach(([key,id])=>{ const raw=q.get(key); const value=raw===null?null:Number(String(raw).replace(',','.')); if(raw!==null&&$(id)&&Number.isFinite(value)){ $(id).value=String(value); imported++; } });
  if(q.get('source')==='bolletta'&&imported>0){ $('pv-imported-note').hidden=false; }
}

$('pv-calc')?.addEventListener('click',compute); $('pv-use-location')?.addEventListener('click',useLocation); $('pv-power-from-surface')?.addEventListener('click',powerFromSurface); $('pv-bill-file')?.addEventListener('change',onBillSelected);
$('pv-region')?.addEventListener('change',()=>{ $('pv-lat').value=''; $('pv-lon').value=''; }); $('pv-business-kind')?.addEventListener('change',updateAgricultureVisibility);
document.querySelectorAll('[data-segment]').forEach((el)=>el.addEventListener('click',()=>setMode(el.dataset.segment))); $('pv-compare-cta')?.addEventListener('click',prepareComparison);
document.querySelectorAll('[data-pv-track]').forEach(el=>el.addEventListener('click',()=>track(el.dataset.pvTrack||'cta_clicked')));
prefillFromQuery(); updateComparisonCta(); track('tool_viewed');
