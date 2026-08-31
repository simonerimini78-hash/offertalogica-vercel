const TOOL_VERSION = '1.3.0';
const TRACK_URL = '/api/track-event';
const PV_URL = '/api/pv-estimate';
const PDF_REPLAY_KEY = 'offertalogicaPdfArchiveReplay';
const root = document.getElementById('ol-pv-tool');
if (!root) throw new Error('Fotovoltaico tool root non trovato');

let mode = 'consumer';
let billReplayPayload = null;
const pvCache = new Map();
const source = 'seo_fotovoltaico';
const sessionId = (() => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `pv-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
})();

const REGIONS = {
  'Valle d’Aosta': { lat:45.74, lon:7.32 }, 'Piemonte': { lat:45.05, lon:7.67 },
  'Liguria': { lat:44.41, lon:8.93 }, 'Lombardia': { lat:45.47, lon:9.19 },
  'Trentino-Alto Adige': { lat:46.07, lon:11.12 }, 'Veneto': { lat:45.44, lon:12.33 },
  'Friuli-Venezia Giulia': { lat:45.65, lon:13.77 }, 'Emilia-Romagna': { lat:44.49, lon:11.34 },
  'Toscana': { lat:43.77, lon:11.25 }, 'Umbria': { lat:43.11, lon:12.39 },
  'Marche': { lat:43.62, lon:13.52 }, 'Lazio': { lat:41.90, lon:12.50 },
  'Abruzzo': { lat:42.35, lon:13.40 }, 'Molise': { lat:41.56, lon:14.66 },
  'Campania': { lat:40.85, lon:14.27 }, 'Puglia': { lat:41.12, lon:16.87 },
  'Basilicata': { lat:40.64, lon:15.81 }, 'Calabria': { lat:38.91, lon:16.59 },
  'Sicilia': { lat:38.12, lon:13.36 }, 'Sardegna': { lat:39.22, lon:9.12 }
};
const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
const ENEA_M2_PER_KWP = 6;
const $ = (id) => document.getElementById(id);
const fmt = (v,d=0) => new Intl.NumberFormat('it-IT',{maximumFractionDigits:d,minimumFractionDigits:d}).format(v);
const euro = (v) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);
const clamp = (v,min,max) => Math.min(max,Math.max(min,v));

function num(id){
  const el=$(id); if(!el)return null;
  const raw=String(el.value??'').trim().replace(',','.'); if(!raw)return null;
  const value=Number(raw); return Number.isFinite(value)?value:null;
}
function finiteData(value){ if(value===null||value===undefined||String(value).trim()==='')return null; const n=Number(String(value).replace(',','.')); return Number.isFinite(n)&&n>=0?n:null; }
function setText(id,value){ const el=$(id); if(el)el.textContent=value; }
function status(text,type=''){ const el=$('pv-status'); if(!el)return; el.textContent=text; el.className=`status ${type}`.trim(); }
function billStatus(text,type=''){ const el=$('pv-bill-status'); if(!el)return; el.textContent=text; el.className=`bill-import-status ${type}`.trim(); }
function isStaffPreview(){ try{return sessionStorage.getItem('offertalogicaStaffMode')==='true';}catch{return false;} }
function normalizedTrackAction(action){
  const raw=String(action||'').trim().toLowerCase();
  if(raw==='tool_viewed'||raw==='page_view')return 'page_view';
  if(raw.includes('failed')||raw.includes('error'))return 'error';
  if(raw.includes('clicked')||raw.includes('cta'))return 'cta_clicked';
  if(raw.includes('completed')||raw.includes('resolved')||raw.includes('imported'))return 'completed';
  return 'started';
}
function currentToolCode(){ return mode==='business'&&$('pv-business-kind')?.value==='agriculture'?'fotovoltaico_agricoltura':'fotovoltaico'; }
function track(action,detail={}){
  if(isStaffPreview())return;
  const raw=String(action||'').trim().toLowerCase(); const customerType=mode==='business'?'business':'consumer';
  const payload={toolCode:currentToolCode(),toolAction:normalizedTrackAction(raw),toolOutcome:String(detail.outcome||'').slice(0,100),toolContext:[raw,String(detail.context||'').trim()].filter(Boolean).join(':').slice(0,80),toolVersion:TOOL_VERSION,source,page:location.pathname,customerType,dataOrigin:source};
  fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventType:'interactive_tool_event',sessionId,page:location.pathname,customerType,dataOrigin:source,source,payload}),credentials:'same-origin',keepalive:true}).catch(()=>{});
}

function validCoordinate(value,min,max){ return Number.isFinite(value)&&value>=min&&value<=max; }
function cleanText(value){ return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function normalizeRegionName(value){ const raw=cleanText(value); if(!raw)return ''; return Object.keys(REGIONS).find((name)=>{const k=cleanText(name);return raw===k||raw.includes(k)||k.includes(raw);})||''; }
function setResolvedPlace(lat,lon,label,regionName=''){
  if(!validCoordinate(lat,35,48)||!validCoordinate(lon,5,20))return false;
  $('pv-lat').value=Number(lat).toFixed(5); $('pv-lon').value=Number(lon).toFixed(5); $('pv-place-label').value=label||'';
  const region=normalizeRegionName(regionName); if(region&&$('pv-region'))$('pv-region').value=region;
  return true;
}
function resolvedLocation(){
  const lat=num('pv-lat'),lon=num('pv-lon');
  if(validCoordinate(lat,35,48)&&validCoordinate(lon,5,20))return{lat,lon,label:$('pv-place-label')?.value||'località selezionata',precision:'locality'};
  const region=$('pv-region')?.value; if(region&&REGIONS[region])return{...REGIONS[region],label:region,precision:'region'};
  return null;
}
async function findPlace(){
  const query=String($('pv-place-search')?.value||'').trim(); if(query.length<2){status('Inserisci un Comune o un CAP.','error');return;}
  const button=$('pv-find-place'); if(button)button.disabled=true; status('Ricerca della zona in corso…');
  try{
    const url=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=it&format=json&countryCode=IT`;
    const response=await fetch(url,{headers:{Accept:'application/json'}}); if(!response.ok)throw new Error('lookup_failed');
    const data=await response.json(); const result=(data?.results||[]).find((item)=>String(item?.country_code||'').toUpperCase()==='IT'&&validCoordinate(Number(item?.latitude),35,48)&&validCoordinate(Number(item?.longitude),5,20));
    if(!result)throw new Error('not_found');
    const label=[result.name,result.admin2].filter(Boolean).join(', '); setResolvedPlace(Number(result.latitude),Number(result.longitude),label,result.admin1);
    status(`Zona trovata: ${label}.`,'ok'); track('place_resolved',{context:label});
  }catch(error){ status(error?.message==='not_found'?'Comune o CAP non trovato. Puoi scegliere la regione.':'Ricerca zona non disponibile. Puoi scegliere la regione.','error'); }
  finally{if(button)button.disabled=false;}
}

function comparisonUrl({replay=false}={}){ const params=new URLSearchParams({landing:'0',source:mode==='business'?'fotovoltaico_business':'fotovoltaico'}); if(replay)params.set('pdfReplay','1'); return `/?${params.toString()}`; }
function updateComparisonCta(){
  const cta=$('pv-compare-cta'); if(!cta)return;
  cta.textContent=mode==='business'?'Confronta offerte Business':'Vai al confronto offerte'; cta.href=comparisonUrl({replay:Boolean(billReplayPayload)});
  if(billReplayPayload)setText('pv-next-copy',mode==='business'?'La bolletta aziendale è già stata letta: puoi passare direttamente al confronto senza ricaricarla.':'La bolletta è già stata letta: puoi passare direttamente al confronto senza ricaricarla.');
  else setText('pv-next-copy',mode==='business'?'Verifica quanto costa l’energia che l’azienda continuerà a prelevare dalla rete.':'Verifica quanto costa l’energia che continuerai a prelevare dalla rete.');
}
function setMode(next,kind=''){
  mode=next==='business'?'business':'consumer'; root.dataset.mode=mode;
  document.querySelectorAll('[data-segment]').forEach((button)=>{const active=button.dataset.segment===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('.business-only').forEach((el)=>{el.hidden=mode!=='business';});
  if(mode==='business'){if(kind==='agriculture')$('pv-business-kind').value='agriculture';$('pv-power-kw').max='1000';}else $('pv-power-kw').max='50';
  updateAgricultureVisibility(); updateComparisonCta(); track('segment_changed',{context:mode});
}
function updateAgricultureVisibility(){ const agriculture=mode==='business'&&$('pv-business-kind')?.value==='agriculture'; document.querySelectorAll('.agriculture-only').forEach((el)=>{el.hidden=!agriculture;}); }

function bandFor(day,hour){
  if(day<=4){ if(hour>=8&&hour<19)return 'f1'; if((hour>=7&&hour<8)||(hour>=19&&hour<23))return 'f2'; return 'f3'; }
  if(day===5){ if(hour>=7&&hour<23)return 'f2'; return 'f3'; }
  return 'f3';
}
function profileFromBands(f1,f2,f3){
  const values={f1:Number(f1),f2:Number(f2),f3:Number(f3)}; const total=values.f1+values.f2+values.f3;
  if(!Object.values(values).every(Number.isFinite)||total<=0)return null;
  const shares={f1:values.f1/total,f2:values.f2/total,f3:values.f3/total}; const counts={f1:0,f2:0,f3:0};
  for(let d=0;d<7;d++)for(let h=0;h<24;h++)counts[bandFor(d,h)]++;
  const hourly=Array(24).fill(0);
  for(let d=0;d<7;d++)for(let h=0;h<24;h++){const band=bandFor(d,h);hourly[h]+=shares[band]/counts[band];}
  return {fractions:hourly,origin:'bands',description:`F1 ${fmt(shares.f1*100,0)}% · F2 ${fmt(shares.f2*100,0)}% · F3 ${fmt(shares.f3*100,0)}%`};
}
function profileFromChoice(choice){
  if(choice==='unknown')return null;
  if(choice==='continuous')return{fractions:Array(24).fill(1/24),origin:'declared',description:'consumo distribuito nell’arco delle 24 ore (ipotesi uniforme)'};
  const shareMap={low:.30,medium:.50,high:.70}; const dayShare=shareMap[choice]; if(!dayShare)return null;
  const fractions=Array.from({length:24},(_,h)=>h>=8&&h<18?dayShare/10:(1-dayShare)/14);
  const labels={low:'soprattutto mattina presto e sera',medium:'distribuito tra giorno e sera',high:'soprattutto durante il giorno'}; return {fractions,origin:'declared',description:`${labels[choice]} · ipotesi di calcolo: circa ${fmt(dayShare*100)}% dei consumi tra le 8 e le 18`};
}
function consumptionProfile(){
  const f1=num('pv-f1'),f2=num('pv-f2'),f3=num('pv-f3'); const bands=profileFromBands(f1,f2,f3); if(bands)return bands;
  return profileFromChoice($('pv-usage-profile')?.value||'unknown');
}
function calculateImpact(pv,annualConsumption,profile){
  if(!pv?.profileAvailable||!profile?.fractions||!annualConsumption)return null;
  const dailyLoad=annualConsumption/365; let self=0;
  for(let m=0;m<12;m++){
    const month=Number(pv.monthly?.[m]?.month||m+1); const monthlyKwh=Number(pv.monthly?.[m]?.kwh||0); const days=DAYS_IN_MONTH[month-1]||30;
    const solar=pv.dailyProfiles?.[String(month)]||pv.dailyProfiles?.[month]; if(!Array.isArray(solar)||solar.length!==24)return null;
    let selfDay=0; for(let h=0;h<24;h++){const pvHour=(monthlyKwh/days)*Number(solar[h]||0); const loadHour=dailyLoad*Number(profile.fractions[h]||0); selfDay+=Math.min(pvHour,loadHour);}
    self+=selfDay*days;
  }
  self=Math.min(self,annualConsumption,Number(pv.annualKwh||0));
  return{selfKwh:self,residualKwh:Math.max(0,annualConsumption-self),excessKwh:Math.max(0,Number(pv.annualKwh||0)-self),coveragePct:self/annualConsumption*100};
}

async function jsonResponse(response,errorLabel='Servizio non disponibile'){
  const type=response?.headers?.get?.('content-type')||''; if(!type.includes('application/json'))throw new Error(errorLabel);
  const payload=await response.json(); if(!response.ok||!payload?.ok)throw new Error(payload?.error||errorLabel); return payload;
}
async function fetchPvEstimate(input){
  const key=JSON.stringify(input); if(pvCache.has(key))return pvCache.get(key);
  const request=fetch(PV_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pv_estimate',...input}),credentials:'same-origin'}).then((r)=>jsonResponse(r,'Dati PVGIS non disponibili'));
  pvCache.set(key,request); try{return await request;}catch(error){pvCache.delete(key);throw error;}
}
function renderMonthly(monthly){
  const chart=$('pv-monthly-chart'); if(!chart)return; const values=(monthly||[]).map((x)=>Number(x.kwh||0)); const max=Math.max(...values,1);
  chart.innerHTML=values.map((v,i)=>`<div class="month-bar"><strong>${fmt(v)}</strong><div class="bar" style="height:${Math.max(4,(v/max)*145)}px" aria-hidden="true"></div><span>${MONTHS[i]}</span></div>`).join('');
}
function renderResults(pv,locationInfo,power,consumption,profile,impact,powerOrigin='manual'){
  const annual=Number(pv.annualKwh||0); setText('pv-result-place',locationInfo.label); setText('pv-result-annual',`${fmt(annual)} kWh`);
  setText('pv-result-consumption',consumption?`${fmt(consumption)} kWh`:'Non inserito');
  if(consumption){const delta=annual-consumption; setText('pv-result-balance',`${delta>=0?'+':''}${fmt(delta)} kWh`);}else setText('pv-result-balance','Serve consumo annuo');
  const detail=[pv.radiationDb,pv.yearMin&&pv.yearMax?`${pv.yearMin}–${pv.yearMax}`:'',pv.optimizedAngles?'angoli ottimali PVGIS':`${fmt(pv.slope,0)}° / azimut ${fmt(pv.azimuth,0)}°`].filter(Boolean).join(' · '); setText('pv-result-source-detail',detail);
  let summary=`Per ${fmt(power,1)} kW, PVGIS stima circa ${fmt(annual)} kWh di produzione in un anno.`; if(powerOrigin==='surface')summary+=` La potenza è solo uno scenario ricavato dalla superficie con il riferimento ENEA di circa ${fmt(ENEA_M2_PER_KWP)} m² per kWp.`; if(locationInfo.precision==='region')summary+=` La località è approssimata usando la regione selezionata.`;
  if(consumption){const delta=annual-consumption; summary+=` Tu dichiari ${fmt(consumption)} kWh/anno di consumi: il totale prodotto sarebbe ${delta>=0?'superiore':'inferiore'} di circa ${fmt(Math.abs(delta))} kWh. Questo confronto da solo non dice quanta energia useresti direttamente.`;}
  else summary+=' Aggiungi il consumo annuo per confrontare produzione e fabbisogno.';
  if(impact){summary+=` Con il profilo disponibile, circa ${fmt(impact.selfKwh)} kWh potrebbero essere usati mentre il fotovoltaico produce e circa ${fmt(impact.residualKwh)} kWh resterebbero da acquistare dalla rete.`;}
  setText('pv-result-summary',summary);
  const impactSection=$('pv-impact-section'),missing=$('pv-profile-missing');
  if(impact){impactSection.hidden=false;missing.hidden=true;setText('pv-result-self',`${fmt(impact.selfKwh)} kWh`);setText('pv-result-grid',`${fmt(impact.residualKwh)} kWh`);setText('pv-result-excess',`${fmt(impact.excessKwh)} kWh`);setText('pv-profile-note',profile.origin==='bands'?`Stima basata sulle proporzioni ${profile.description}. Usiamo le fasce orarie ARERA e le distribuiamo convenzionalmente nelle rispettive ore di una settimana tipo. Non è una curva oraria reale e, se la bolletta copre un solo periodo, quel periodo può non rappresentare tutto l’anno.`:`Scenario indicativo scelto dall’utente: ${profile.description}. Il consumo annuale viene distribuito uniformemente sui giorni dell’anno.`);}
  else{impactSection.hidden=true;missing.hidden=!(consumption&&consumption>0);}
  renderMonthly(pv.monthly); $('pv-results').hidden=false; $('pv-results').scrollIntoView({behavior:'smooth',block:'start'});
}
async function compute(){
  const locationInfo=resolvedLocation(); if(!locationInfo){status('Inserisci Comune/CAP oppure scegli una regione.','error');return;}
  let power=num('pv-power-kw'); const surface=num('pv-surface-m2'); let powerOrigin='manual';
  if((!power||power<=0)&&surface&&surface>0){power=surface/ENEA_M2_PER_KWP;powerOrigin='surface';}
  if(!power||power<=0){status('Inserisci la potenza da simulare oppure una superficie disponibile.','error');return;}
  const maxPower=mode==='business'?1000:50; if(power<1||power>maxPower){status(mode==='business'?'Inserisci una potenza tra 1 e 1000 kW.':'Per il profilo Casa puoi simulare una potenza tra 1 e 50 kW.','error');return;}
  const consumption=num('pv-consumption-kwh'); const orientation=$('pv-orientation')?.value||'auto'; const tilt=num('pv-tilt');
  const completeAngles=orientation!=='auto'&&tilt!==null; const aspect=completeAngles?Number(orientation):null; const angle=completeAngles?clamp(tilt,0,90):null;
  const button=$('pv-calc'); if(button)button.disabled=true; status('Calcolo PVGIS in corso…'); track('calculation_started',{context:`${mode}:${locationInfo.precision}`});
  try{
    const pv=await fetchPvEstimate({lat:locationInfo.lat,lon:locationInfo.lon,powerKw:power,customerType:mode,angle,aspect});
    const profile=consumptionProfile(); const impact=consumption&&consumption>0&&profile?calculateImpact(pv,consumption,profile):null;
    renderResults(pv,locationInfo,power,consumption,profile,impact,powerOrigin); status(`Stima PVGIS completata per ${locationInfo.label}.`,'ok'); track('calculation_completed',{outcome:`${Math.round(Number(pv.annualKwh||0))}kwh`,context:impact?profile.origin:'production_only'});
  }catch(error){status(String(error?.message||'Dati PVGIS non disponibili. Riprova più tardi.'),'error');track('calculation_failed',{outcome:String(error?.message||'error')});}
  finally{if(button)button.disabled=false;}
}

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
function contractValue(data,field){const entry=data?.data_contract?.fields?.[field];if(entry?.status==='completo'&&entry?.normalized_value!==undefined)return entry.normalized_value;return data?.[field];}
function billingDays(data){const start=Date.parse(`${data?.billing_period_start||''}T00:00:00Z`),end=Date.parse(`${data?.billing_period_end||''}T00:00:00Z`);return Number.isFinite(start)&&Number.isFinite(end)&&end>=start?Math.floor((end-start)/86400000)+1:null;}
function safeAnnualConsumption(data){
  const annual=finiteData(data?.consumo_luce_kwh); if(annual===null)return null; const period=finiteData(data?.consumo_periodo_luce_kwh); const days=billingDays(data);
  if(days&&days<330&&period!==null&&Math.abs(annual-period)<=Math.max(.02,period*.001))return null;
  if(days&&days<330&&period===null){const evidence=(data?.diagnostics||[]).filter((x)=>x?.field==='consumo_luce_kwh').map((x)=>`${x?.label||''} ${x?.source_snippet||''} ${x?.evidence||''}`).join(' ').toLowerCase();if(!/(annuo|annuale|12\s*mesi|ultimi\s*dodici\s*mesi)/i.test(evidence))return null;}
  return annual;
}
function monthLabel(data){
  const start=data?.billing_period_start,end=data?.billing_period_end;if(!start&&!end)return 'Periodo della bolletta';
  try{const a=start?new Date(`${start}T12:00:00Z`):null,b=end?new Date(`${end}T12:00:00Z`):a;const fm=new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric',timeZone:'UTC'});if(a&&b&&a.getUTCFullYear()===b.getUTCFullYear()&&a.getUTCMonth()===b.getUTCMonth())return fm.format(a).replace(/^./,c=>c.toUpperCase());const f=new Intl.DateTimeFormat('it-IT',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});return `${a?f.format(a):''}${a&&b?' – ':''}${b?f.format(b):''}`;}catch{return 'Periodo della bolletta';}
}
function renderBillSummary(data){
  const box=$('pv-bill-summary');if(!box)return;const period=finiteData(data?.consumo_periodo_luce_kwh),annual=safeAnnualConsumption(data),total=finiteData(data?.total_amount_eur),f1=finiteData(contractValue(data,'consumo_luce_f1_kwh')),f2=finiteData(contractValue(data,'consumo_luce_f2_kwh')),f3=finiteData(contractValue(data,'consumo_luce_f3_kwh')),power=finiteData(contractValue(data,'potenza_impegnata_kw'));const bands=[f1,f2,f3].every((x)=>x!==null)&&f1+f2+f3>0;
  setText('pv-bill-period-title',monthLabel(data));setText('pv-bill-profile',mode==='business'?'Azienda':'Casa');setText('pv-bill-period-consumption',period===null?'Non rilevato':`${fmt(period)} kWh`);setText('pv-bill-total',total===null?'Non rilevato':euro(total));setText('pv-bill-annual',annual===null?'Non presente':`${fmt(annual)} kWh/anno`);setText('pv-bill-bands',bands?'F1/F2/F3 disponibili':'Non presente');setText('pv-bill-annual-note',annual===null?'Il consumo del periodo resta separato dal consumo annuo. Se il PDF non contiene un dato annuale esplicito, inseriscilo manualmente. Le eventuali F1/F2/F3 possono comunque aiutarci a capire quando consumi.':'Il consumo annuo è esplicitamente presente nella bolletta ed è stato inserito nel simulatore.');setText('pv-bill-f1',f1===null?'—':`${fmt(f1)} kWh`);setText('pv-bill-f2',f2===null?'—':`${fmt(f2)} kWh`);setText('pv-bill-f3',f3===null?'—':`${fmt(f3)} kWh`);setText('pv-bill-power',power===null?'—':`${fmt(power,1)} kW`);box.hidden=false;
}
function applyBillData(payload,file){
  const data=payload?.normalized||{}; const commodity=String(data.commodity||'').toLowerCase(); if(commodity==='gas')throw new Error('Per il simulatore fotovoltaico serve una bolletta luce');
  if(data.customer_type==='business')setMode('business');else if(data.customer_type==='privato')setMode('consumer');
  const annual=safeAnnualConsumption(data); const values={'pv-contract-power':contractValue(data,'potenza_impegnata_kw'),'pv-f1':contractValue(data,'consumo_luce_f1_kwh'),'pv-f2':contractValue(data,'consumo_luce_f2_kwh'),'pv-f3':contractValue(data,'consumo_luce_f3_kwh')};if(annual!==null)values['pv-consumption-kwh']=annual;
  let imported=0;Object.entries(values).forEach(([id,value])=>{const target=$(id),n=Number(value);if(target&&Number.isFinite(n)&&n>=0){target.value=String(n);imported++;}});
  renderBillSummary(data); billReplayPayload={normalized:data,filename:file?.name||'bolletta.pdf',analysisId:payload?.archive?.analysisId||payload?.analysisId||null};try{sessionStorage.setItem(PDF_REPLAY_KEY,JSON.stringify(billReplayPayload));}catch{}
  updateComparisonCta(); const bands=profileFromBands(num('pv-f1'),num('pv-f2'),num('pv-f3')); billStatus(annual===null?`Bolletta letta${bands?' e fasce disponibili':''}. Inserisci il consumo annuo se non è presente nel PDF.`:`Bolletta letta: ${imported} dati utili inseriti automaticamente.`,'ok'); track('bill_data_imported',{outcome:String(imported),context:bands?'bands_available':annual===null?'period_only':mode});
}
async function onBillSelected(event){const file=event.target?.files?.[0];if(!file)return;billStatus('Lettura della bolletta in corso…');$('pv-bill-file').disabled=true;track('bill_analysis_started');try{const payload=await analyzeBill(file);applyBillData(payload,file);}catch(error){billStatus(String(error?.message||'Lettura non disponibile'),'error');track('bill_analysis_failed',{outcome:String(error?.message||'error')});}finally{$('pv-bill-file').disabled=false;event.target.value='';}}
function prepareComparison(){if(!billReplayPayload)return;try{sessionStorage.setItem(PDF_REPLAY_KEY,JSON.stringify(billReplayPayload));}catch{}}
function prefillFromQuery(){
  const q=new URLSearchParams(location.search);const requestedProfile=String(q.get('profilo')||'').toLowerCase(),requestedKind=String(q.get('tipo')||'').toLowerCase();if(requestedProfile==='azienda'||requestedProfile==='business'||requestedKind==='agricola'||requestedKind==='agriculture')setMode('business',requestedKind.startsWith('agri')?'agriculture':'');
  const map={consumo:'pv-consumption-kwh',f1:'pv-f1',f2:'pv-f2',f3:'pv-f3',potenza:'pv-contract-power',impianto:'pv-power-kw'};Object.entries(map).forEach(([key,id])=>{const raw=q.get(key),value=raw===null?null:Number(String(raw).replace(',','.'));if(raw!==null&&$(id)&&Number.isFinite(value))$(id).value=String(value);});
}

$('pv-calc')?.addEventListener('click',compute);$('pv-find-place')?.addEventListener('click',findPlace);$('pv-bill-file')?.addEventListener('change',onBillSelected);$('pv-region')?.addEventListener('change',()=>{$('pv-lat').value='';$('pv-lon').value='';$('pv-place-label').value='';});$('pv-place-search')?.addEventListener('input',()=>{$('pv-lat').value='';$('pv-lon').value='';$('pv-place-label').value='';});$('pv-place-search')?.addEventListener('keydown',(event)=>{if(event.key==='Enter'){event.preventDefault();findPlace();}});$('pv-business-kind')?.addEventListener('change',updateAgricultureVisibility);document.querySelectorAll('[data-segment]').forEach((el)=>el.addEventListener('click',()=>setMode(el.dataset.segment)));$('pv-compare-cta')?.addEventListener('click',prepareComparison);document.querySelectorAll('[data-pv-track]').forEach((el)=>el.addEventListener('click',()=>track(el.dataset.pvTrack||'cta_clicked')));
prefillFromQuery();updateComparisonCta();track('tool_viewed');
