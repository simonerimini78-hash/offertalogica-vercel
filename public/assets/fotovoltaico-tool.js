const TOOL_VERSION = '1.0';
const TRACK_URL = '/api/track-event';
const root = document.getElementById('ol-pv-tool');
if (!root) throw new Error('Fotovoltaico tool root non trovato');

const mode = root.dataset.mode === 'business' ? 'business' : 'consumer';
const source = mode === 'business' ? 'seo_fotovoltaico_agricoltura' : 'seo_fotovoltaico';
const toolCode = mode === 'business' ? 'fotovoltaico_agricoltura' : 'fotovoltaico';
const sessionId = (() => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `pv-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
})();

const REGIONS = {
  'Valle d’Aosta': { lat:45.74, lon:7.32, yield:1220 },
  'Piemonte': { lat:45.05, lon:7.67, yield:1280 },
  'Liguria': { lat:44.41, lon:8.93, yield:1410 },
  'Lombardia': { lat:45.47, lon:9.19, yield:1260 },
  'Trentino-Alto Adige': { lat:46.07, lon:11.12, yield:1260 },
  'Veneto': { lat:45.44, lon:12.33, yield:1320 },
  'Friuli-Venezia Giulia': { lat:45.65, lon:13.77, yield:1320 },
  'Emilia-Romagna': { lat:44.49, lon:11.34, yield:1370 },
  'Toscana': { lat:43.77, lon:11.25, yield:1460 },
  'Umbria': { lat:43.11, lon:12.39, yield:1460 },
  'Marche': { lat:43.62, lon:13.52, yield:1470 },
  'Lazio': { lat:41.90, lon:12.50, yield:1540 },
  'Abruzzo': { lat:42.35, lon:13.40, yield:1510 },
  'Molise': { lat:41.56, lon:14.66, yield:1550 },
  'Campania': { lat:40.85, lon:14.27, yield:1620 },
  'Puglia': { lat:41.12, lon:16.87, yield:1710 },
  'Basilicata': { lat:40.64, lon:15.81, yield:1650 },
  'Calabria': { lat:38.91, lon:16.59, yield:1750 },
  'Sicilia': { lat:38.12, lon:13.36, yield:1810 },
  'Sardegna': { lat:39.22, lon:9.12, yield:1780 }
};

const orientationFactor = { south:1, southeast:.96, southwest:.96, east:.88, west:.88, flat:.94, north:.64 };
const monthNames = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const northDist = [.035,.055,.085,.105,.12,.135,.14,.12,.09,.06,.035,.02];
const southDist = [.05,.065,.09,.105,.115,.12,.125,.115,.09,.06,.04,.025];

const $ = (id) => document.getElementById(id);
const num = (id) => {
  const v = Number($(id)?.value);
  return Number.isFinite(v) ? v : null;
};
const clamp = (v,min,max) => Math.min(max, Math.max(min,v));
const fmt = (v,d=0) => new Intl.NumberFormat('it-IT',{maximumFractionDigits:d,minimumFractionDigits:d}).format(v);
const euro = (v) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);

function isStaffPreview(){ try { return sessionStorage.getItem('offertalogicaStaffMode') === 'true'; } catch { return false; } }
function track(action, detail={}) {
  if (isStaffPreview()) return;
  const payload = { toolCode, toolAction: action, toolOutcome: String(detail.outcome || '').slice(0,100), toolContext: String(detail.context || '').slice(0,80), toolVersion: TOOL_VERSION, source, page: location.pathname, customerType: mode === 'business' ? 'business' : 'consumer', dataOrigin: source };
  fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventType:'interactive_tool_event',sessionId,page:location.pathname,customerType:payload.customerType,dataOrigin:source,source,payload}),credentials:'same-origin',keepalive:true}).catch(()=>{});
}

function nearestRegion(lat,lon){
  let best = null;
  Object.entries(REGIONS).forEach(([name,r]) => {
    const d = Math.pow(lat-r.lat,2) + Math.pow((lon-r.lon)*.75,2);
    if (!best || d < best.d) best = {name,...r,d};
  });
  return best;
}

function baseYield(){
  const lat = num('pv-lat');
  const lon = num('pv-lon');
  const selected = $('pv-region')?.value;
  if (lat !== null && lon !== null) {
    const nearest = nearestRegion(lat,lon);
    const geo = clamp(1945 - (lat - 36.5) * 79 + (lon - 12) * 2.5, 1150, 1900);
    return { value: geo*.62 + nearest.yield*.38, lat, lon, label: nearest.name };
  }
  if (selected && REGIONS[selected]) return { value: REGIONS[selected].yield, lat: REGIONS[selected].lat, lon: REGIONS[selected].lon, label:selected };
  return null;
}

function tiltFactor(lat, tilt){
  const optimal = clamp((lat || 42.5) - 10, 24, 37);
  const delta = Math.abs(tilt - optimal);
  return clamp(1 - delta*.0028 - delta*delta*.00005, .78, 1.01);
}

function costRange(power){
  if (mode === 'business') {
    const center = power <= 20 ? 1280 : power <= 100 ? 1050 : power <= 300 ? 890 : 790;
    return [power*center*.86, power*center*1.16];
  }
  const center = power <= 3 ? 1650 : power <= 6 ? 1500 : power <= 10 ? 1375 : 1280;
  return [power*center*.86, power*center*1.16];
}

function monthlyDistribution(lat){
  const t = clamp(((lat || 42.5)-37)/9,0,1);
  const arr = northDist.map((v,i)=>v*t + southDist[i]*(1-t));
  const sum = arr.reduce((a,b)=>a+b,0);
  return arr.map(v=>v/sum);
}

function renderChart(annual, lat){
  const chart = $('pv-monthly-chart');
  if (!chart) return;
  const values = monthlyDistribution(lat).map(v=>annual*v);
  const max = Math.max(...values,1);
  chart.innerHTML = values.map((v,i)=>`<div class="month-bar"><strong>${fmt(v)}</strong><div class="bar" style="height:${Math.max(4,(v/max)*145)}px" aria-hidden="true"></div><span>${monthNames[i]}</span></div>`).join('');
}

function setText(id, value){ const el=$(id); if(el) el.textContent=value; }
function status(text,type=''){ const el=$('pv-status'); if(!el)return; el.textContent=text; el.className=`status ${type}`.trim(); }

function compute(){
  const geo = baseYield();
  if (!geo) { status('Seleziona una regione oppure usa la tua posizione.','error'); return; }
  let power = num('pv-power-kw');
  const surface = num('pv-surface-m2');
  if ((!power || power <= 0) && surface && surface > 0) {
    power = surface / (mode === 'business' ? 5.0 : 5.2);
    if ($('pv-power-kw')) $('pv-power-kw').value = power.toFixed(1);
  }
  if (!power || power <= 0) { status('Inserisci la potenza dell’impianto oppure una superficie disponibile.','error'); return; }
  power = clamp(power, mode === 'business' ? 3 : 1, mode === 'business' ? 1000 : 50);
  const orientation = $('pv-orientation')?.value || 'south';
  const tilt = clamp(num('pv-tilt') ?? 30,0,90);
  const specific = geo.value * (orientationFactor[orientation] || 1) * tiltFactor(geo.lat,tilt);
  const annual = power * specific;
  const areaNeeded = power * (mode === 'business' ? 5.0 : 5.2);
  const [costMin,costMax] = costRange(power);
  const consumption = num('pv-consumption-kwh');
  let selfKwh = null, residual = null, excess = null, coverage = null, savings = null, selfRate = null;
  if (consumption && consumption > 0) {
    if (mode === 'business') {
      const f1=num('pv-f1'), f2=num('pv-f2'), f3=num('pv-f3');
      const bands = [f1,f2,f3];
      const bandTotal = bands.every(v=>v!==null && v>=0) ? bands.reduce((a,b)=>a+b,0) : 0;
      const dayShare = bandTotal > 0 ? clamp(f1/bandTotal,0,1) : .42;
      const loadRatio = clamp(consumption/annual,0,1.5);
      selfRate = clamp(.28 + dayShare*.42 + Math.min(1,loadRatio)*.12,.32,.82);
    } else {
      const loadRatio = clamp(consumption/annual,0,1.5);
      selfRate = clamp(.25 + Math.min(1,loadRatio)*.30,.28,.58);
    }
    selfKwh = Math.min(consumption, annual*selfRate);
    residual = Math.max(0, consumption-selfKwh);
    excess = Math.max(0, annual-selfKwh);
    coverage = selfKwh/consumption*100;
    const price = num('pv-energy-price');
    if (price && price > 0) savings = selfKwh*price;
  }

  setText('pv-result-place', geo.label);
  setText('pv-result-annual', `${fmt(annual)} kWh`);
  setText('pv-result-specific', `${fmt(specific)} kWh/kW`);
  setText('pv-result-area', `${fmt(areaNeeded,1)} m²`);
  setText('pv-result-cost', `${euro(costMin)} – ${euro(costMax)}`);
  setText('pv-result-self', selfKwh===null ? 'Aggiungi i consumi' : `${fmt(selfKwh)} kWh`);
  setText('pv-result-grid', residual===null ? 'Aggiungi i consumi' : `${fmt(residual)} kWh`);
  setText('pv-result-excess', excess===null ? 'Aggiungi i consumi' : `${fmt(excess)} kWh`);
  setText('pv-result-coverage', coverage===null ? 'Aggiungi i consumi' : `${fmt(coverage,1)}%`);
  const savingsBox = $('pv-saving-impact');
  if (savingsBox) {
    savingsBox.hidden = savings===null;
    if (savings!==null) setText('pv-result-savings', `${euro(savings)} / anno`);
  }
  const surfaceCheck = $('pv-surface-check');
  if (surfaceCheck) {
    if (surface && surface > 0) surfaceCheck.textContent = surface >= areaNeeded ? `La superficie indicata è compatibile con circa ${fmt(power,1)} kW nel modello.` : `Per ${fmt(power,1)} kW servirebbero circa ${fmt(areaNeeded-surface,1)} m² in più rispetto alla superficie indicata.`;
    else surfaceCheck.textContent = `Superficie tecnica indicativa: circa ${fmt(areaNeeded,1)} m².`;
  }
  renderChart(annual, geo.lat);
  $('pv-results').hidden = false;
  status(`Stima calcolata per ${geo.label}. I valori sono informativi e dipendono dalle condizioni reali del sito.`,'ok');
  track('calculation_completed',{outcome:`${Math.round(annual)}kwh`,context:geo.label});
  $('pv-results').scrollIntoView({behavior:'smooth',block:'start'});
}

function useLocation(){
  if (!navigator.geolocation) { status('Geolocalizzazione non disponibile: scegli una regione.','error'); return; }
  status('Richiesta della posizione in corso…');
  track('location_requested');
  navigator.geolocation.getCurrentPosition((pos)=>{
    const lat=pos.coords.latitude, lon=pos.coords.longitude;
    $('pv-lat').value=lat.toFixed(5); $('pv-lon').value=lon.toFixed(5);
    const near=nearestRegion(lat,lon);
    if ($('pv-region')) $('pv-region').value=near.name;
    status(`Posizione rilevata: ${near.name} (${lat.toFixed(3)}, ${lon.toFixed(3)}).`,'ok');
    track('location_resolved',{context:near.name});
  },()=>status('Posizione non disponibile o non autorizzata: scegli una regione.','error'),{enableHighAccuracy:false,timeout:10000,maximumAge:900000});
}

function powerFromSurface(){
  const surface=num('pv-surface-m2');
  if (!surface || surface<=0) { status('Inserisci prima la superficie disponibile.','error'); return; }
  const power=surface/(mode==='business'?5.0:5.2);
  $('pv-power-kw').value=power.toFixed(1);
  status(`Potenza preliminare ricavata dalla superficie: circa ${fmt(power,1)} kW.`,'ok');
}

function prefillFromQuery(){
  const q=new URLSearchParams(location.search);
  const map={consumo:'pv-consumption-kwh',f1:'pv-f1',f2:'pv-f2',f3:'pv-f3',potenza:'pv-contract-power',prezzo:'pv-energy-price',superficie:'pv-surface-m2',impianto:'pv-power-kw'};
  let imported=0;
  Object.entries(map).forEach(([key,id])=>{ const value=q.get(key); if(value!==null && $(id) && Number.isFinite(Number(value))){ $(id).value=value; imported++; } });
  if (q.get('source')==='bolletta' && imported>0) {
    const note=$('pv-imported-note'); if(note) note.hidden=false;
    track('bill_data_imported',{outcome:String(imported)});
  }
}

$('pv-calc')?.addEventListener('click',compute);
$('pv-use-location')?.addEventListener('click',useLocation);
$('pv-power-from-surface')?.addEventListener('click',powerFromSurface);
$('pv-region')?.addEventListener('change',()=>{ $('pv-lat').value=''; $('pv-lon').value=''; });
document.querySelectorAll('[data-pv-track]').forEach(el=>el.addEventListener('click',()=>track(el.dataset.pvTrack||'cta_clicked')));
prefillFromQuery();
track('tool_viewed');
