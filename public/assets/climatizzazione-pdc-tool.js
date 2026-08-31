const TOOL_VERSION = '1.0.4';
const TRACK_URL = '/api/track-event';
const ANALYZE_PDF_URL = '/api/analyze-pdf';
const PDF_DIRECT_UPLOAD_THRESHOLD_BYTES = 4_000_000;
const PDF_ARCHIVE_REPLAY_STORAGE_KEY = 'offertalogicaPdfArchiveReplay';
const TOOL_CODE = 'climatizzazione_pdc';
const SOURCE = 'seo_climatizzazione_pdc';

const root = document.getElementById('ol-clima-tool');
if (!root) throw new Error('Climatizzazione tool root non trovato');

const $ = (id) => document.getElementById(id);
const fmt = (value, digits = 0) => new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: digits,
  minimumFractionDigits: digits
}).format(value);
const euro = (value) => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
}).format(value);

const CLASS_BANDS = {
  cooling: {
    'A+++': [8.5, null], 'A++': [6.1, 8.5], 'A+': [5.6, 6.1], A: [5.1, 5.6],
    B: [4.6, 5.1], C: [4.1, 4.6], D: [3.6, 4.1], E: [3.1, 3.6], F: [2.6, 3.1], G: [null, 2.6]
  },
  heating: {
    'A+++': [5.1, null], 'A++': [4.6, 5.1], 'A+': [4.0, 4.6], A: [3.4, 4.0],
    B: [3.1, 3.4], C: [2.8, 3.1], D: [2.5, 2.8], E: [2.2, 2.5], F: [1.9, 2.2], G: [null, 1.9]
  }
};

const UNKNOWN_SCENARIOS = ['A', 'A+', 'A++'];
let mode = 'cooling';
let hasCalculated = false;
let billProfile = {provider: '', annualKwh: null, priceKwh: null};
let billAnalysisBusy = false;
let billReplayPayload = null;

const sessionId = (() => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `clima-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
})();

function num(id) {
  const el = $(id);
  if (!el) return null;
  const raw = String(el.value ?? '').trim().replace(',', '.');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function status(text, type = '') {
  const el = $('clima-status');
  if (!el) return;
  el.textContent = text;
  el.className = `status ${type}`.trim();
}

function isStaffPreview() {
  try { return sessionStorage.getItem('offertalogicaStaffMode') === 'true'; } catch { return false; }
}

function track(action, detail = {}) {
  if (isStaffPreview()) return;
  const actionMap = {
    page_view: 'page_view',
    mode_selected: 'started',
    calculation_completed: 'completed',
    bill_cta: 'cta_clicked',
    bill_analysis_started: 'started',
    bill_analysis_completed: 'completed',
    bill_analysis_failed: 'error',
    compare_cta: 'cta_clicked',
    error: 'error'
  };
  const toolAction = actionMap[action] || 'started';
  const payload = {
    toolCode: TOOL_CODE,
    toolAction,
    toolOutcome: String(detail.outcome || '').slice(0, 100),
    toolContext: [action, String(detail.context || '').trim()].filter(Boolean).join(':').slice(0, 80),
    toolVersion: TOOL_VERSION,
    source: SOURCE,
    page: location.pathname,
    customerType: 'consumer',
    dataOrigin: SOURCE
  };
  fetch(TRACK_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      eventType: 'interactive_tool_event',
      sessionId,
      page: location.pathname,
      customerType: 'consumer',
      dataOrigin: SOURCE,
      source: SOURCE,
      payload
    }),
    credentials: 'same-origin',
    keepalive: true
  }).catch(() => {});
}

function currentService() {
  if (mode === 'cooling') return 'cooling';
  if (mode === 'heatpump') return 'heating';
  return $('clima-service')?.value === 'heating' ? 'heating' : 'cooling';
}

function indexName(service = currentService()) {
  return service === 'cooling' ? 'SEER' : 'SCOP';
}

function setMode(next, {trackChoice = true} = {}) {
  mode = ['cooling', 'heatcool', 'heatpump'].includes(next) ? next : 'cooling';
  root.dataset.mode = mode;

  document.querySelectorAll('[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  $('clima-service-switch').hidden = mode !== 'heatcool';
  updateEfficiencyLabels();
  if (trackChoice) track('mode_selected', {context: `${mode}:${currentService()}`});
  if (hasCalculated) calculate(false);
}

function updateEfficiencyLabels() {
  const label = $('clima-index-label');
  if (label) label.textContent = indexName();
}

function updateEfficiencyFields() {
  const source = $('clima-efficiency-source')?.value || 'unknown';
  document.querySelectorAll('.efficiency-class-field').forEach((el) => { el.hidden = source !== 'class'; });
  document.querySelectorAll('.efficiency-index-field').forEach((el) => { el.hidden = source !== 'index'; });
  updateEfficiencyLabels();
}

function validateInputs() {
  const area = num('clima-area');
  const height = num('clima-height');
  const hours = num('clima-hours');
  const days = num('clima-days');
  const currentAnnualKwh = num('clima-current-consumption');
  const price = num('clima-price');

  if (!area || area < 5 || area > 1000) return {ok: false, error: 'Inserisci una superficie tra 5 e 1.000 m².'};
  if (!height || height < 2 || height > 8) return {ok: false, error: 'Inserisci un’altezza tra 2 e 8 metri.'};
  if (!hours || hours < 0.5 || hours > 24) return {ok: false, error: 'Inserisci ore di utilizzo tra 0,5 e 24 al giorno.'};
  if (!days || days < 1 || days > 365) return {ok: false, error: 'Inserisci giorni di utilizzo tra 1 e 365.'};
  if (currentAnnualKwh !== null && (currentAnnualKwh < 0 || currentAnnualKwh > 1000000)) {
    return {ok: false, error: 'Controlla il consumo annuo luce inserito.'};
  }
  if (price !== null && (price < 0.01 || price > 3)) return {ok: false, error: 'Controlla il prezzo energia inserito.'};

  return {ok: true, area, height, hours, days, currentAnnualKwh, price};
}


function parseBillNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let raw = value.trim().replace(/\s+/g, '');
  if (!raw) return null;
  raw = raw.replace(/[€a-zA-Z]/g, '');
  if (raw.includes(',') && raw.includes('.')) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) raw = raw.replace(/\./g, '').replace(',', '.');
    else raw = raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    raw = raw.replace(',', '.');
  }
  raw = raw.replace(/[^0-9.+-]/g, '');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function pdfAnalysisError(payload, fallback = 'Errore analisi PDF') {
  const error = new Error(payload?.error || fallback);
  error.code = payload?.code || 'PDF_ANALYSIS_ERROR';
  error.diagnostic_code = payload?.diagnostic_code || null;
  error.analysis_stage = payload?.analysis_stage || null;
  error.ingress_mode = payload?.ingress_mode || null;
  error.elapsed_ms = Number(payload?.elapsed_ms || 0) || null;
  return error;
}

async function pdfJsonResponse(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('api_non_disponibile');
  const payload = await response.json();
  if (!response.ok || !payload?.ok) throw pdfAnalysisError(payload);
  return payload;
}

function pdfContractFieldEntry(data, field) {
  return data?.data_contract?.fields?.[field] || null;
}

function pdfSafeAutofillValue(data, field) {
  const entry = pdfContractFieldEntry(data, field);
  if (!entry?.autofill?.allowed || entry.status !== 'completo') return undefined;
  return entry.normalized_value;
}

function normalizedBillValue(data, field) {
  const hasContract = Boolean(data?.data_contract?.fields);
  if (hasContract) return pdfSafeAutofillValue(data, field);
  const direct = data?.[field];
  return direct === null || direct === undefined || direct === '' ? undefined : direct;
}

function extractBillProfile(payload) {
  const data = payload?.normalized && typeof payload.normalized === 'object' ? payload.normalized : {};
  const annualRaw = normalizedBillValue(data, 'consumo_luce_kwh');
  const priceRaw = normalizedBillValue(data, 'prezzo_luce_eur_kwh');
  const providerRaw = normalizedBillValue(data, 'fornitore_luce') ?? normalizedBillValue(data, 'fornitore');
  const annualKwh = parseBillNumber(annualRaw);
  const priceKwh = parseBillNumber(priceRaw);
  const provider = typeof providerRaw === 'string' ? providerRaw.trim().replace(/\s+/g, ' ').slice(0, 100) : '';

  return {
    normalized: data,
    annualKwh: annualKwh != null && annualKwh >= 0 && annualKwh <= 1_000_000 ? annualKwh : null,
    priceKwh: priceKwh != null && priceKwh >= 0.01 && priceKwh <= 3 ? priceKwh : null,
    provider
  };
}

function billArchiveContext() {
  return {
    sessionId,
    staffMode: isStaffPreview(),
    customerType: 'privato',
    uploadSequence: 1,
    source: SOURCE,
    toolCode: TOOL_CODE
  };
}

async function postBillPdf(file) {
  const archiveContext = billArchiveContext();

  if (Number(file.size || 0) >= PDF_DIRECT_UPLOAD_THRESHOLD_BYTES) {
    const createResponse = await fetch(ANALYZE_PDF_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        action: 'create_upload',
        filename: file.name || 'documento.pdf',
        mimeType: file.type || 'application/pdf',
        fileSize: Number(file.size || 0)
      }),
      credentials: 'same-origin'
    });
    const created = await pdfJsonResponse(createResponse);
    const upload = created.upload || {};
    if (!upload.uploadUrl || !upload.uploadTicket) throw new Error('Caricamento protetto del PDF non riuscito');

    const signedBody = new FormData();
    signedBody.append('file', file, file.name || 'documento.pdf');
    const uploadResponse = await fetch(upload.uploadUrl, {method: 'PUT', body: signedBody});
    if (!uploadResponse.ok) throw new Error('Caricamento protetto del PDF non riuscito');

    const analyzeResponse = await fetch(ANALYZE_PDF_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        action: 'analyze_uploaded_pdf',
        uploadTicket: upload.uploadTicket,
        archiveContext
      }),
      credentials: 'same-origin'
    });
    return pdfJsonResponse(analyzeResponse);
  }

  const formData = new FormData();
  formData.append('pdf', file);
  formData.append('archiveContext', JSON.stringify(archiveContext));
  const response = await fetch(ANALYZE_PDF_URL, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin'
  });
  return pdfJsonResponse(response);
}

function pdfErrorPublicMessage(error) {
  const directMessages = new Set([
    'PDF troppo grande',
    'PDF protetto o cifrato',
    'Il file caricato non è un PDF valido',
    'PDF mancante o formato non accettato',
    'Caricamento protetto del PDF non riuscito',
    'Documento non riconosciuto come bolletta',
    'Seleziona una bolletta, non una scheda offerta',
    'Per questo calcolo serve una bolletta luce'
  ]);
  if (directMessages.has(error?.message)) return error.message;
  const diagnostic = error?.diagnostic_code || error?.code;
  if (diagnostic) return `Lettura non disponibile (${diagnostic})`;
  return 'Lettura non disponibile';
}

function setBillReading(active, text = 'Sto leggendo la bolletta…') {
  billAnalysisBusy = active;
  const reading = $('clima-bill-reading');
  const button = $('clima-bill-cta');
  const readingText = $('clima-bill-reading-text');
  if (reading) reading.hidden = !active;
  if (readingText) readingText.textContent = text;
  if (button) {
    button.disabled = active;
    button.setAttribute('aria-busy', String(active));
    button.textContent = active ? 'Lettura in corso…' : 'Carica la bolletta';
  }
}

function markAutofilled(id, active) {
  const field = $(id);
  if (!field) return;
  field.classList.toggle('bill-autofilled', Boolean(active));
}

function persistBillProfile() {
  try {
    sessionStorage.setItem('offertalogicaClimatizzazioneBillProfile', JSON.stringify({
      version: TOOL_VERSION,
      source: SOURCE,
      provider: billProfile.provider || '',
      annualKwh: billProfile.annualKwh,
      priceKwh: billProfile.priceKwh,
      savedAt: new Date().toISOString()
    }));
  } catch {}
}

function persistBillReplay(payload, fileName = '') {
  const normalized = payload?.normalized && typeof payload.normalized === 'object' ? payload.normalized : null;
  if (!normalized) return false;
  billReplayPayload = {
    filename: fileName || 'bolletta.pdf',
    analysisId: payload?.archive?.analysisId || payload?.archive?.analysis_id || null,
    normalized
  };
  try {
    sessionStorage.setItem(PDF_ARCHIVE_REPLAY_STORAGE_KEY, JSON.stringify(billReplayPayload));
    return true;
  } catch {
    return false;
  }
}

function updateCompareDestination() {
  const link = $('clima-compare-cta');
  if (!link) return;
  const target = new URL('/', window.location.origin);
  target.searchParams.set('landing', '0');
  target.searchParams.set('source', 'climatizzazione_pdc');
  if (billReplayPayload?.normalized) target.searchParams.set('pdfReplay', '1');
  link.href = `${target.pathname}${target.search}`;
}

function renderBillAutofill(profile, fileName = '') {
  const panel = $('clima-bill-autofill');
  if (!panel) return;
  panel.hidden = false;
  $('clima-bill-provider').textContent = profile.provider || 'Non rilevato';
  $('clima-bill-consumption-summary').textContent = profile.annualKwh != null ? `${fmt(profile.annualKwh)} kWh` : 'Non rilevato';
  $('clima-bill-price-summary').textContent = profile.priceKwh != null ? `${fmt(profile.priceKwh, 3)} €/kWh` : 'Non rilevato';

  const found = [
    profile.annualKwh != null ? 'consumo annuo' : '',
    profile.priceKwh != null ? 'prezzo energia' : '',
    profile.provider ? 'fornitore' : ''
  ].filter(Boolean);

  $('clima-bill-autofill-note').textContent = found.length
    ? `${fileName ? `${fileName}: ` : ''}${found.join(', ')} ${found.length === 1 ? 'inserito' : 'inseriti'} automaticamente.`
    : `${fileName ? `${fileName}: ` : ''}la bolletta è stata letta, ma non sono stati trovati valori luce utilizzabili per questi campi.`;
}

async function analyzeBill(file) {
  if (!file || billAnalysisBusy) return;
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) {
    status('Seleziona una bolletta in formato PDF.', 'error');
    return;
  }

  setBillReading(true);
  status('Sto leggendo la bolletta e compilando i dati utili…');
  track('bill_analysis_started', {context: 'pdf'});

  try {
    const response = await postBillPdf(file);
    const profile = extractBillProfile(response);
    const normalized = profile.normalized || {};
    if (normalized.recognized === false || normalized.kind === 'unknown') {
      throw new Error('Documento non riconosciuto come bolletta');
    }
    if (normalized.kind && normalized.kind !== 'bolletta') {
      throw new Error('Seleziona una bolletta, non una scheda offerta');
    }
    if (normalized.commodity === 'gas') {
      throw new Error('Per questo calcolo serve una bolletta luce');
    }
    billProfile = {provider: profile.provider, annualKwh: profile.annualKwh, priceKwh: profile.priceKwh};

    if (profile.annualKwh != null) {
      $('clima-current-consumption').value = String(Math.round(profile.annualKwh));
      markAutofilled('clima-current-consumption', true);
    }
    if (profile.priceKwh != null) {
      $('clima-price').value = String(Math.round(profile.priceKwh * 10000) / 10000);
      markAutofilled('clima-price', true);
    }

    renderBillAutofill(profile, file.name);
    persistBillProfile();
    persistBillReplay(response, file.name);
    updateCompareDestination();

    const usableCount = Number(profile.annualKwh != null) + Number(profile.priceKwh != null);
    if (usableCount) {
      status('Bolletta letta: i dati energetici disponibili sono stati inseriti. Calcolo aggiornato automaticamente.', 'ok');
      track('bill_analysis_completed', {
        context: `autofill:${usableCount}`,
        outcome: profile.provider ? 'provider_detected' : 'energy_data_detected'
      });
      calculate(false);
      $('clima-results')?.scrollIntoView({behavior: 'smooth', block: 'start'});
    } else {
      status('Bolletta letta, ma non ho trovato consumo annuo o prezzo luce utilizzabili. Puoi completarli manualmente.', 'error');
      track('bill_analysis_completed', {context: 'autofill:0', outcome: 'no_usable_energy_fields'});
    }
  } catch (error) {
    const message = pdfErrorPublicMessage(error);
    status(`${message} Puoi riprovare con un altro PDF o continuare con i dati manuali.`, 'error');
    track('bill_analysis_failed', {context: message.slice(0, 70), outcome: 'failed'});
  } finally {
    setBillReading(false);
  }
}

function billImpactRange(input, efficiency) {
  if (!input.currentAnnualKwh || !efficiency?.range) return null;
  const range = efficiency.range;
  if (range.kind === 'point') {
    return {kind: 'point', min: input.currentAnnualKwh + range.maxKwh, max: input.currentAnnualKwh + range.maxKwh};
  }
  if (range.kind === 'range') {
    return {kind: 'range', min: input.currentAnnualKwh + range.minKwh, max: input.currentAnnualKwh + range.maxKwh};
  }
  if (range.kind === 'max') {
    return {kind: 'max', min: input.currentAnnualKwh, max: input.currentAnnualKwh + range.maxKwh};
  }
  if (range.kind === 'min') {
    return {kind: 'min', min: input.currentAnnualKwh + range.minKwh, max: null};
  }
  return null;
}

function renderBillImpact(input, efficiency) {
  const panel = $('clima-bill-impact');
  const textEl = $('clima-bill-impact-text');
  if (!panel || !textEl || !input.currentAnnualKwh || efficiency.source === 'unknown') {
    if (panel) panel.hidden = true;
    return;
  }

  const impact = billImpactRange(input, efficiency);
  if (!impact) {
    panel.hidden = true;
    return;
  }

  let projected = '';
  if (impact.kind === 'point') projected = `circa ${fmt(impact.max)} kWh/anno`;
  else if (impact.kind === 'range') projected = `circa ${fmt(impact.min)}–${fmt(impact.max)} kWh/anno`;
  else if (impact.kind === 'max') projected = `fino a circa ${fmt(impact.max)} kWh/anno`;
  else projected = `oltre circa ${fmt(impact.min)} kWh/anno`;

  textEl.textContent =
    `La bolletta indica ${fmt(input.currentAnnualKwh)} kWh/anno. Sommando il consumo stagionale stimato della climatizzazione, il profilo indicativo diventa ${projected}.`;
  panel.hidden = false;
}

function baseDemand(input, service) {
  const k = service === 'cooling' ? 25 : 35;
  const powerKw = (k * input.area * input.height) / 1000;
  const usefulKwh = powerKw * input.hours * input.days;
  return {k, powerKw, usefulKwh};
}

function rangeFromBand(usefulKwh, band) {
  const [minIndex, maxIndex] = band;
  if (minIndex && maxIndex) {
    return {
      minKwh: usefulKwh / maxIndex,
      maxKwh: usefulKwh / minIndex,
      kind: 'range'
    };
  }
  if (minIndex && !maxIndex) {
    return {
      minKwh: null,
      maxKwh: usefulKwh / minIndex,
      kind: 'max'
    };
  }
  if (!minIndex && maxIndex) {
    return {
      minKwh: usefulKwh / maxIndex,
      maxKwh: null,
      kind: 'min'
    };
  }
  return {minKwh: null, maxKwh: null, kind: 'unbounded'};
}

function formatEnergyRange(range) {
  if (range.kind === 'point') return `${fmt(range.maxKwh)} kWh`;
  if (range.kind === 'range') return `${fmt(range.minKwh)}–${fmt(range.maxKwh)} kWh`;
  if (range.kind === 'max') return `fino a ${fmt(range.maxKwh)} kWh`;
  if (range.kind === 'min') return `oltre ${fmt(range.minKwh)} kWh`;
  return 'Serve SEER/SCOP';
}

function formatCostRange(range, price) {
  if (!price) return 'Prezzo non inserito';
  if (range.kind === 'point') return euro(range.maxKwh * price);
  if (range.kind === 'range') return `${euro(range.minKwh * price)}–${euro(range.maxKwh * price)}`;
  if (range.kind === 'max') return `fino a ${euro(range.maxKwh * price)}`;
  if (range.kind === 'min') return `oltre ${euro(range.minKwh * price)}`;
  return 'Non stimabile';
}

function formatIndexBand(service, className) {
  const [lo, hi] = CLASS_BANDS[service][className];
  const name = indexName(service);
  if (lo && hi) return `${name} ${fmt(lo, 1)}–${fmt(hi, 1)}`;
  if (lo && !hi) return `${name} ≥ ${fmt(lo, 1)}`;
  if (!lo && hi) return `${name} < ${fmt(hi, 1)}`;
  return name;
}

function renderScenarioCards(usefulKwh, service, price) {
  const grid = $('clima-scenario-grid');
  if (!grid) return;
  const bands = CLASS_BANDS[service];
  grid.innerHTML = UNKNOWN_SCENARIOS.map((className) => {
    const range = rangeFromBand(usefulKwh, bands[className]);
    return `<article class="scenario-card">
      <strong>Classe ${className}</strong>
      <span>${formatIndexBand(service, className)}</span>
      <span class="scenario-energy">${formatEnergyRange(range)}</span>
      <span>${formatCostRange(range, price)}</span>
    </article>`;
  }).join('');
  $('clima-scenarios').hidden = false;
}

function calculationFromEfficiency(demand, service) {
  const source = $('clima-efficiency-source')?.value || 'unknown';

  if (source === 'index') {
    const index = num('clima-index');
    if (!index || index < 1 || index > 20) {
      return {ok: false, error: `Inserisci un ${indexName(service)} valido.`};
    }
    const energyKwh = demand.usefulKwh / index;
    return {
      ok: true,
      source,
      range: {minKwh: energyKwh, maxKwh: energyKwh, kind: 'point'},
      assumption: `${indexName(service)} ${fmt(index, 1)} inserito`
    };
  }

  if (source === 'class') {
    const className = $('clima-class')?.value || 'A';
    const band = CLASS_BANDS[service][className];
    return {
      ok: true,
      source,
      range: rangeFromBand(demand.usefulKwh, band),
      assumption: `Classe ${className} · ${formatIndexBand(service, className)} · Reg. UE 626/2011`
    };
  }

  return {ok: true, source, range: null, assumption: 'Efficienza non indicata · scenari A / A+ / A++'};
}

function renderMainResult(input, demand, efficiency, service) {
  $('clima-result-power').textContent = `${fmt(demand.powerKw, 1)} kW`;
  $('clima-result-assumption').textContent = efficiency.assumption;

  if (efficiency.source === 'unknown') {
    $('clima-result-energy').textContent = 'Vedi scenari';
    $('clima-result-cost').textContent = input.price ? 'Vedi scenari' : 'Prezzo non inserito';
    $('clima-result-summary').textContent =
      `Per ${fmt(input.area)} m² e ${fmt(input.height, 1)} m di altezza, la potenza indicativa è ${fmt(demand.powerKw, 1)} kW. Senza ${indexName(service)} o classe mostriamo più scenari, non un unico numero.`;
    $('clima-result-note').textContent =
      'Gli scenari A, A+ e A++ servono a visualizzare l’effetto dell’efficienza. Non indicano quale classe abbia il tuo apparecchio.';
    renderScenarioCards(demand.usefulKwh, service, input.price);
    renderBillImpact(input, efficiency);
    return;
  }

  $('clima-scenarios').hidden = true;
  const range = efficiency.range;
  $('clima-result-energy').textContent = formatEnergyRange(range);
  $('clima-result-cost').textContent = formatCostRange(range, input.price);

  if (range.kind === 'point') {
    $('clima-result-summary').textContent =
      `Con i dati inseriti, il consumo elettrico stagionale stimato è circa ${fmt(range.maxKwh)} kWh.`;
  } else if (range.kind === 'range') {
    $('clima-result-summary').textContent =
      `Con la classe indicata, il consumo elettrico stagionale è stimato tra ${fmt(range.minKwh)} e ${fmt(range.maxKwh)} kWh.`;
  } else if (range.kind === 'max') {
    $('clima-result-summary').textContent =
      `Con la classe indicata, il modello semplificato porta a un consumo stagionale fino a circa ${fmt(range.maxKwh)} kWh.`;
  } else {
    $('clima-result-summary').textContent =
      `Con la classe indicata, il modello semplificato porta a un consumo stagionale superiore a circa ${fmt(range.minKwh)} kWh.`;
  }

  const priceNote = input.price
    ? `Costo calcolato con ${fmt(input.price, 2)} €/kWh. Usa il dato effettivo della bolletta per una stima più personale.`
    : 'Il costo non viene inventato: inserisci il tuo prezzo €/kWh oppure carica la bolletta per usare un dato reale.';
  const heatPumpNote = mode === 'heatpump'
    ? ' Per una pompa di calore questa stima non dimostra automaticamente un risparmio rispetto a una caldaia: per il confronto economico servono dati reali della bolletta.'
    : '';
  $('clima-result-note').textContent = `${priceNote}${heatPumpNote}`;
  renderBillImpact(input, efficiency);
}

function calculate(trackEvent = true) {
  const input = validateInputs();
  if (!input.ok) {
    status(input.error, 'error');
    if (trackEvent) track('error', {context: input.error});
    return;
  }

  const service = currentService();
  const demand = baseDemand(input, service);
  const efficiency = calculationFromEfficiency(demand, service);
  if (!efficiency.ok) {
    status(efficiency.error, 'error');
    if (trackEvent) track('error', {context: efficiency.error});
    return;
  }

  renderMainResult(input, demand, efficiency, service);
  $('clima-results').hidden = false;
  status('Stima aggiornata.', 'ok');
  hasCalculated = true;

  if (trackEvent) {
    track('calculation_completed', {
      context: `${mode}:${service}:${$('clima-efficiency-source')?.value || 'unknown'}`,
      outcome: 'ok'
    });
    $('clima-results').focus({preventScroll: true});
    $('clima-results').scrollIntoView({behavior: 'smooth', block: 'start'});
  }
}

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

$('clima-service')?.addEventListener('change', () => {
  updateEfficiencyLabels();
  track('mode_selected', {context: `heatcool:${currentService()}`});
  if (hasCalculated) calculate(false);
});

$('clima-efficiency-source')?.addEventListener('change', () => {
  updateEfficiencyFields();
  if (hasCalculated) calculate(false);
});

$('clima-calc')?.addEventListener('click', () => calculate(true));

['clima-area', 'clima-height', 'clima-hours', 'clima-days', 'clima-current-consumption', 'clima-price', 'clima-class', 'clima-index']
  .forEach((id) => $(id)?.addEventListener('input', () => {
    if (id === 'clima-current-consumption' || id === 'clima-price') markAutofilled(id, false);
    if (hasCalculated) calculate(false);
  }));

$('clima-bill-cta')?.addEventListener('click', () => {
  if (billAnalysisBusy) return;
  track('bill_cta', {context: 'direct_file_picker'});
  const input = $('clima-bill-file');
  if (!input) return;
  input.value = '';
  input.click();
});

$('clima-bill-file')?.addEventListener('change', (event) => {
  const file = event.target?.files?.[0];
  if (file) analyzeBill(file);
});

$('clima-compare-cta')?.addEventListener('click', () => {
  if (billReplayPayload?.normalized) {
    try { sessionStorage.setItem(PDF_ARCHIVE_REPLAY_STORAGE_KEY, JSON.stringify(billReplayPayload)); } catch {}
  }
  updateCompareDestination();
  track('compare_cta', {context: billReplayPayload?.normalized ? 'bill_replay' : 'manual_profile'});
});

updateCompareDestination();
updateEfficiencyFields();
setMode('cooling', {trackChoice: false});
track('page_view');
