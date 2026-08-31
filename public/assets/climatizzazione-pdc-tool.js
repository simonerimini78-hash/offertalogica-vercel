const TOOL_VERSION = '1.0.1';
const TRACK_URL = '/api/track-event';
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
  const price = num('clima-price');

  if (!area || area < 5 || area > 1000) return {ok: false, error: 'Inserisci una superficie tra 5 e 1.000 m².'};
  if (!height || height < 2 || height > 8) return {ok: false, error: 'Inserisci un’altezza tra 2 e 8 metri.'};
  if (!hours || hours < 0.5 || hours > 24) return {ok: false, error: 'Inserisci ore di utilizzo tra 0,5 e 24 al giorno.'};
  if (!days || days < 1 || days > 365) return {ok: false, error: 'Inserisci giorni di utilizzo tra 1 e 365.'};
  if (price !== null && (price < 0.01 || price > 3)) return {ok: false, error: 'Controlla il prezzo energia inserito.'};

  return {ok: true, area, height, hours, days, price};
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

['clima-area', 'clima-height', 'clima-hours', 'clima-days', 'clima-price', 'clima-class', 'clima-index']
  .forEach((id) => $(id)?.addEventListener('input', () => { if (hasCalculated) calculate(false); }));

document.querySelectorAll('[data-clima-track]').forEach((link) => {
  link.addEventListener('click', () => track(link.dataset.climaTrack || 'compare_cta', {context: link.id}));
});

updateEfficiencyFields();
setMode('cooling', {trackChoice: false});
track('page_view');
