(() => {
  "use strict";

  const dataset = window.OL_PROVIDER_QUALITY_DATA;
  if (!dataset || !Array.isArray(dataset.providers)) return;

  const providers = new Map(dataset.providers.map((item) => [item.key, item]));
  const selectA = document.getElementById("provider-select-a");
  const selectB = document.getElementById("provider-select-b");
  const bodyA = document.getElementById("provider-card-body-a");
  const bodyB = document.getElementById("provider-card-body-b");
  const live = document.getElementById("provider-live");
  const comparisonSummary = document.getElementById("comparison-summary");
  const comparisonSummaryBody = document.getElementById("comparison-summary-body");
  const dialog = document.getElementById("metric-info-dialog");
  const dialogTitle = document.getElementById("metric-info-title");
  const dialogBody = document.getElementById("metric-info-body");
  const dialogClose = document.getElementById("metric-info-close");
  const infoPayloads = new Map();
  let infoCounter = 0;

  const ARERA_SOURCE = "https://www.arera.it/fileadmin/allegati/relaz_ann/25/VOLUME_1_definitivo.pdf";
  const coreConcepts = ["complaint-response", "billing-correction", "double-billing"];
  const conceptOrder = ["complaint-response", "billing-correction", "double-billing", "information", "complaint-volume", "indemnities"];
  const conceptTitles = {
    "complaint-response": "Risposta ai reclami",
    "billing-correction": "Correzione bollette",
    "double-billing": "Doppia fatturazione",
    "information": "Richieste di informazioni",
    "complaint-volume": "Reclami registrati",
    "indemnities": "Indennizzi"
  };

  const marketReasons = {
    luce: [
      { label: "Problemi con la bolletta", value: 38.84, technical: "Fatturazione", explain: "Comprende consumi e importi fatturati, autolettura, periodicità, fattura di chiusura, pagamenti e rimborsi." },
      { label: "Cambio fornitore o offerta", value: 16.41, technical: "Mercato", explain: "Comprende conclusione di nuovi contratti, tempi del cambio fornitore e condizioni economiche proposte o applicate." },
      { label: "Problemi con il contratto", value: 15.57, technical: "Contratti", explain: "Comprende recesso, cambio intestazione, voltura, subentro, perfezionamento e costi collegati al contratto." },
      { label: "Pagamenti e distacchi", value: 11.62, technical: "Morosità e sospensione", explain: "Comprende problemi legati a morosità e sospensione della fornitura." },
      { label: "Problemi tecnici, allacci e lavori", value: 6.59, technical: "Connessioni, lavori e qualità tecnica", explain: "Comprende connessioni, lavori sulla fornitura e aspetti di qualità tecnica." },
      { label: "Letture e contatore", value: 3.54, technical: "Misura", explain: "Comprende problemi collegati alla misura dei consumi e al contatore." },
      { label: "Altri problemi", value: 3.48, technical: "Altro", explain: "Raccoglie gli argomenti residuali che ARERA non riconduce alle altre categorie." },
      { label: "Assistenza commerciale", value: 2.96, technical: "Qualità commerciale", explain: "Comprende aspetti di qualità commerciale diversi dalle altre categorie specifiche." },
      { label: "Bonus sociale", value: 0.98, technical: "Bonus sociale", explain: "Comprende reclami collegati al bonus sociale." },
      { label: "Fuori competenza del venditore", value: 0.01, technical: "Non di competenza", explain: "Richieste che non rientrano negli argomenti di competenza del venditore." }
    ],
    gas: [
      { label: "Problemi con la bolletta", value: 46.31, technical: "Fatturazione", explain: "Comprende consumi e importi fatturati, autolettura, periodicità, fattura di chiusura, pagamenti e rimborsi." },
      { label: "Problemi con il contratto", value: 21.54, technical: "Contratti", explain: "Comprende recesso, cambio intestazione, voltura, subentro, perfezionamento e costi collegati al contratto." },
      { label: "Cambio fornitore o offerta", value: 11.99, technical: "Mercato", explain: "Comprende conclusione di nuovi contratti, tempi del cambio fornitore e condizioni economiche proposte o applicate." },
      { label: "Pagamenti e distacchi", value: 8.44, technical: "Morosità e sospensione", explain: "Comprende problemi legati a morosità e sospensione della fornitura." },
      { label: "Letture e contatore", value: 5.01, technical: "Misura", explain: "Comprende problemi collegati alla misura dei consumi e al contatore." },
      { label: "Problemi tecnici, allacci e lavori", value: 2.45, technical: "Connessioni, lavori e qualità tecnica", explain: "Comprende connessioni, lavori sulla fornitura e aspetti di qualità tecnica." },
      { label: "Altri problemi", value: 1.67, technical: "Altro", explain: "Raccoglie gli argomenti residuali che ARERA non riconduce alle altre categorie." },
      { label: "Assistenza commerciale", value: 1.56, technical: "Qualità commerciale", explain: "Comprende aspetti di qualità commerciale diversi dalle altre categorie specifiche." },
      { label: "Bonus sociale", value: 1.02, technical: "Bonus sociale", explain: "Comprende reclami collegati al bonus sociale." },
      { label: "Fuori competenza del venditore", value: 0.01, technical: "Non di competenza", explain: "Richieste che non rientrano negli argomenti di competenza del venditore." }
    ]
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  }

  function formatNumber(value) {
    if (typeof value !== "number") return escapeHtml(value);
    return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
  }

  function metricValue(metric) {
    if (!metric) return "—";
    const base = formatNumber(Number(metric.value));
    const unit = String(metric.unit || "").trim();
    if (unit === "%") return `${base}%`;
    if (unit === "euro") return `€ ${base}`;
    if (unit === "giorni o meno") return `≤ ${base} gg`;
    if (unit === "giorni") return `${base} gg`;
    return unit ? `${base} ${escapeHtml(unit)}` : base;
  }

  function friendlyCluster(cluster) {
    const value = String(cluster || "").toLowerCase();
    const parts = [];
    const hasLuce = value.includes("luce") || value.includes("elettric");
    const hasGas = value.includes("gas");
    if (value.includes("dual") || (hasLuce && hasGas)) parts.push("luce e gas");
    else if (hasLuce) parts.push("luce");
    else if (hasGas) parts.push("gas");
    if (value.includes("non domest")) parts.push("clienti non domestici");
    else if (value.includes("domest")) parts.push("clienti domestici");
    if (value.includes("mercato libero")) parts.push("mercato libero");
    return parts.length ? parts.join(" · ") : String(cluster || "Perimetro indicato nella fonte");
  }

  function bucket(cluster) {
    const value = String(cluster || "").toLowerCase();
    const hasLuce = value.includes("luce") || value.includes("elettric");
    const hasGas = value.includes("gas");
    if (value.includes("dual") || (hasLuce && hasGas) || value.includes("aggregato") || value.includes("vendita energia")) return "general";
    if (hasLuce) return "luce";
    if (hasGas) return "gas";
    return "general";
  }

  function roundedOutOf100(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
  }

  function metricCopy(metric) {
    const indicator = String(metric?.indicator || "");
    const value = metricValue(metric);
    const outOf100 = roundedOutOf100(metric?.value);
    const copies = {
      "Rispetto standard risposta reclami": ["Reclami nei tempi", outOf100 === null ? "Quota di reclami che ricevono risposta entro il termine previsto." : `Circa ${outOf100} reclami su 100 ricevono risposta entro il termine previsto.`],
      "Tempo medio risposta reclami": ["Tempo medio risposta", `In media, il fornitore risponde ai reclami in ${value}.`],
      "Rispetto standard rettifica fatturazione": ["Correzione bollette", outOf100 === null ? "Quota di correzioni della bolletta concluse entro i tempi previsti." : `Circa ${outOf100} correzioni su 100 vengono concluse entro i tempi previsti.`],
      "Tempo medio rettifica fatturazione": ["Tempo correzione bolletta", `In media, una correzione della bolletta richiede ${value}.`],
      "Rispetto standard rettifica doppia fatturazione": ["Doppia fatturazione", outOf100 === 0 ? "La fonte indica 0% entro il termine. Senza il numero totale dei casi il dato va interpretato con cautela." : (outOf100 === null ? "Quota di doppie fatturazioni corrette entro il termine previsto." : `Circa ${outOf100} casi su 100 risultano corretti entro il termine previsto.`)],
      "Tempo medio rettifica doppia fatturazione": ["Tempo doppia fatturazione", `In media, la correzione di una doppia fatturazione richiede ${value}.`],
      "Risposte informazioni entro 30 giorni": ["Informazioni entro 30 giorni", outOf100 === null ? "Quota di richieste di informazioni risposte entro 30 giorni." : `Circa ${outOf100} richieste su 100 ricevono risposta entro 30 giorni.`],
      "Reclami ricevuti": ["Reclami registrati", `La fonte registra ${value}. Il numero assoluto da solo non misura la qualità del fornitore.`],
      "Reclami gestiti": ["Reclami gestiti", `La fonte registra ${value}. Per confrontare fornitori servirebbe rapportare il dato ai clienti serviti.`],
      "Risposte reclami entro standard": ["Reclami nei tempi", `La fonte registra ${value} entro il termine previsto.`],
      "Rettifiche fatturazione entro standard": ["Correzioni nei tempi", `La fonte registra ${value} correzioni concluse entro il termine previsto.`],
      "Indennizzi reclami": ["Indennizzi reclami", `La fonte riporta ${value} di indennizzi nel perimetro indicato.`],
      "Reclami ricevuti da UNC": ["Reclami arrivati a UNC", `UNC registra ${value}. Non sono tutti i reclami ricevuti dal fornitore.`],
      "Casi risolti": ["Casi risolti con UNC", `UNC dichiara ${value} tra i casi lavorati sulla propria piattaforma.`],
      "Punteggio risoluzione problemi": ["Indicatore Altroconsumo", `Indicatore pubblicato da Altroconsumo sulla propria piattaforma.`],
      "Tempo medio risposta": ["Tempo medio risposta", `Tempo medio indicato dalla fonte: ${value}.`]
    };
    const copy = copies[indicator] || [indicator || "Dato", metric?.note || "Dato pubblicato nella fonte indicata."];
    return { title: copy[0], explain: copy[1], caution: indicator === "Rispetto standard rettifica doppia fatturazione" && Number(metric?.value) === 0 };
  }

  function officialMetrics(provider) {
    return provider ? provider.metrics.filter((metric) => metric.source === "Ufficiale TIQV") : [];
  }

  function observerMetrics(provider, source) {
    return provider ? provider.metrics.filter((metric) => metric.source === source) : [];
  }

  function metricConcept(metric) {
    const indicator = String(metric?.indicator || "");
    if (["Rispetto standard risposta reclami", "Tempo medio risposta reclami", "Risposte reclami entro standard"].includes(indicator)) return "complaint-response";
    if (["Rispetto standard rettifica fatturazione", "Tempo medio rettifica fatturazione", "Rettifiche fatturazione entro standard"].includes(indicator)) return "billing-correction";
    if (["Rispetto standard rettifica doppia fatturazione", "Tempo medio rettifica doppia fatturazione"].includes(indicator)) return "double-billing";
    if (indicator === "Risposte informazioni entro 30 giorni") return "information";
    if (["Reclami ricevuti", "Reclami gestiti"].includes(indicator)) return "complaint-volume";
    if (indicator === "Indennizzi reclami") return "indemnities";
    return indicator ? `other:${indicator}` : "other";
  }

  function conceptSort(a, b) {
    const ia = conceptOrder.indexOf(a);
    const ib = conceptOrder.indexOf(b);
    if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    return a.localeCompare(b, "it");
  }

  function metricsBySector(provider, sector) {
    return officialMetrics(provider).filter((metric) => bucket(metric.cluster) === sector);
  }

  function pickMetrics(provider, sector, concept) {
    if (!provider) return [];
    return metricsBySector(provider, sector)
      .filter((metric) => metricConcept(metric) === concept)
      .sort((a, b) => String(b.year).localeCompare(String(a.year), "it", { numeric: true }));
  }

  function tableConcepts(provider, otherProvider) {
    const concepts = new Set(coreConcepts);
    [provider, otherProvider].filter(Boolean).forEach((item) => {
      ["luce", "gas", "general"].forEach((sector) => metricsBySector(item, sector).forEach((metric) => concepts.add(metricConcept(metric))));
    });
    return [...concepts].filter((concept) => concept !== "other").sort(conceptSort);
  }

  function conceptTitle(concept, providersToCheck = []) {
    if (conceptTitles[concept]) return conceptTitles[concept];
    for (const provider of providersToCheck) {
      for (const sector of ["luce", "gas", "general"]) {
        const first = pickMetrics(provider, sector, concept)[0];
        if (first) return metricCopy(first).title;
      }
    }
    return concept.replace(/^other:/, "");
  }

  function initials(name) {
    return String(name || "OL").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function registerMetricInfo(metrics, provider, title) {
    const list = Array.isArray(metrics) ? metrics : [metrics];
    const id = `metric-${++infoCounter}`;
    if (!list.length) {
      infoPayloads.set(id, { title, html: `<p>Dato non disponibile nel dataset verificato per ${escapeHtml(provider.name)}.</p>` });
      return id;
    }
    const rows = list.map((metric) => {
      const copy = metricCopy(metric);
      return `<p><strong>${escapeHtml(copy.title)}:</strong> ${metricValue(metric)}<br>${escapeHtml(copy.explain)}</p>
        <div class="info-dialog-meta">
          <span><strong>Anno:</strong> ${escapeHtml(metric.year)}</span>
          <span><strong>Perimetro:</strong> ${escapeHtml(friendlyCluster(metric.cluster))}</span>
          <span><strong>Nome tecnico:</strong> ${escapeHtml(metric.indicator)}</span>
          <span><strong>Confrontabile:</strong> ${metric.comparable ? "sì, con lo stesso tipo di dato" : "no, va letto da solo"}</span>
          ${metric.note ? `<span><strong>Nota:</strong> ${escapeHtml(metric.note)}</span>` : ""}
          ${metric.sourceUrl ? `<a href="${escapeHtml(metric.sourceUrl)}" target="_blank" rel="noopener noreferrer">Apri la fonte originale</a>` : ""}
        </div>`;
    }).join("");
    infoPayloads.set(id, { title: title || metricCopy(list[0]).title, html: rows });
    return id;
  }

  function providerReasonEntries(provider) {
    if (!provider) return [];
    const direct = Array.isArray(provider.complaintReasons) ? provider.complaintReasons : [];
    const fromMetrics = Array.isArray(provider.metrics)
      ? provider.metrics.filter((metric) => metric.kind === "complaint-reason" || metric.type === "complaint-reason")
      : [];
    return [...direct, ...fromMetrics];
  }

  function complaintReasonKey(value) {
    const raw = String(value || "").toLowerCase();
    const groups = [
      ["fatturazione", ["fattur", "bolletta", "billing"]],
      ["contratti", ["contratt", "contract"]],
      ["mercato", ["mercato", "switch", "cambio fornitore", "market"]],
      ["morosita", ["moros", "sospension", "distacc", "arrears"]],
      ["tecnica", ["connession", "lavori", "qualità tecnica", "qualita tecnica", "technical"]],
      ["misura", ["misura", "lettur", "contatore", "meter"]],
      ["altro", ["altro", "altri problemi", "other"]],
      ["qualita-commerciale", ["qualità commerciale", "qualita commerciale", "assistenza commerciale", "commercial-quality"]],
      ["bonus", ["bonus sociale", "social-bonus"]],
      ["fuori-competenza", ["non di competenza", "fuori competenza"]]
    ];
    return groups.find(([, tokens]) => tokens.some((token) => raw.includes(token)))?.[0] || raw;
  }

  function complaintReasonSector(entry) {
    const raw = String(entry?.sector || entry?.cluster || "").toLowerCase();
    if (raw.includes("luce") || raw.includes("elettric")) return "luce";
    if (raw.includes("gas")) return "gas";
    return null;
  }

  function providerReason(provider, reason, sector) {
    const target = complaintReasonKey(reason.technical || reason.label);
    return providerReasonEntries(provider).find((entry) => {
      const unit = String(entry?.unit || "%").trim();
      return complaintReasonSector(entry) === sector
        && complaintReasonKey(entry?.key || entry?.category || entry?.technical || entry?.indicator) === target
        && unit === "%"
        && Number.isFinite(Number(entry?.value));
    }) || null;
  }

  function reasonForSector(sector, referenceReason) {
    const key = complaintReasonKey(referenceReason.technical || referenceReason.label);
    return marketReasons[sector].find((reason) => complaintReasonKey(reason.technical || reason.label) === key) || null;
  }

  function registerReasonInfo(referenceReason, provider) {
    const luceReason = reasonForSector("luce", referenceReason);
    const gasReason = reasonForSector("gas", referenceReason);
    const providerLuce = luceReason ? providerReason(provider, luceReason, "luce") : null;
    const providerGas = gasReason ? providerReason(provider, gasReason, "gas") : null;
    const id = `reason-${++infoCounter}`;
    const providerRows = [
      providerLuce ? `<span><strong>${escapeHtml(provider.name)} luce:</strong> ${formatNumber(Number(providerLuce.value))}% · ${escapeHtml(providerLuce.year || "anno n.d.")}</span>` : `<span><strong>${escapeHtml(provider.name)} luce:</strong> dato specifico non disponibile</span>`,
      providerGas ? `<span><strong>${escapeHtml(provider.name)} gas:</strong> ${formatNumber(Number(providerGas.value))}% · ${escapeHtml(providerGas.year || "anno n.d.")}</span>` : `<span><strong>${escapeHtml(provider.name)} gas:</strong> dato specifico non disponibile</span>`
    ].join("");
    infoPayloads.set(id, {
      title: referenceReason.label,
      html: `<p>${escapeHtml(referenceReason.explain)}</p>
        <div class="info-dialog-meta">
          <span><strong>Mercato ARERA 2024 luce:</strong> ${luceReason ? `${formatNumber(luceReason.value)}%` : "n.d."}</span>
          <span><strong>Mercato ARERA 2024 gas:</strong> ${gasReason ? `${formatNumber(gasReason.value)}%` : "n.d."}</span>
          ${providerRows}
          <span><strong>Categoria tecnica ARERA:</strong> ${escapeHtml(referenceReason.technical)}</span>
          <span><strong>Come leggerlo:</strong> è la quota di questo motivo sul totale dei reclami, non la percentuale di clienti o fatture con un problema.</span>
          ${providerLuce?.sourceUrl ? `<a href="${escapeHtml(providerLuce.sourceUrl)}" target="_blank" rel="noopener noreferrer">Fonte fornitore luce</a>` : ""}
          ${providerGas?.sourceUrl ? `<a href="${escapeHtml(providerGas.sourceUrl)}" target="_blank" rel="noopener noreferrer">Fonte fornitore gas</a>` : ""}
          <a href="${ARERA_SOURCE}" target="_blank" rel="noopener noreferrer">Apri la fonte ARERA</a>
        </div>`
    });
    return id;
  }

  function registerObserverInfo(provider, source) {
    const metrics = observerMetrics(provider, source);
    const coverageKey = source === "UNC" ? "unc" : "altroconsumo";
    const coverage = provider.coverage?.[coverageKey];
    const id = `observer-${++infoCounter}`;
    let html = "";
    if (metrics.length) {
      html = metrics.map((metric) => {
        const copy = metricCopy(metric);
        return `<p><strong>${escapeHtml(copy.title)}:</strong> ${metricValue(metric)}<br>${escapeHtml(copy.explain)}</p>`;
      }).join("");
    } else {
      html = `<p>Non abbiamo un dato numerico normalizzato da mostrare per questa fonte.</p>`;
    }
    html += `<div class="info-dialog-meta"><span><strong>Fonte:</strong> ${escapeHtml(source)}</span><span><strong>Perimetro:</strong> casi transitati dalla piattaforma dell'osservatore, non tutti i clienti del fornitore</span>${coverage?.url ? `<a href="${escapeHtml(coverage.url)}" target="_blank" rel="noopener noreferrer">Apri la fonte</a>` : ""}</div>`;
    infoPayloads.set(id, { title: `${source} · ${provider.name}`, html });
    return id;
  }

  function observerSummary(provider, source) {
    const metrics = observerMetrics(provider, source);
    const coverageKey = source === "UNC" ? "unc" : "altroconsumo";
    const coverage = provider.coverage?.[coverageKey];
    if (!metrics.length) return coverage?.status === "VERIFICATA" ? "Fonte verificata · dettagli disponibili" : "Nessun dato normalizzato";
    if (source === "UNC") {
      const complaints = metrics.find((m) => m.indicator === "Reclami ricevuti da UNC");
      const resolved = metrics.find((m) => m.indicator === "Casi risolti");
      const bits = [];
      if (complaints) bits.push(`${metricValue(complaints)} ricevuti`);
      if (resolved) {
        const match = String(resolved.unit || "").match(/su\s*(\d+)/i);
        const total = match ? Number(match[1]) : NaN;
        const pct = Number.isFinite(total) && total > 0 ? Math.round((Number(resolved.value) / total) * 100) : null;
        bits.push(pct ? `${pct}% casi risolti` : `${metricValue(resolved)} risolti`);
      }
      return bits.join(" · ") || `${metrics.length} dati`;
    }
    return metrics.map((metric) => `${metricCopy(metric).title}: ${metricValue(metric)}`).join(" · ");
  }

  function cellContent(metrics) {
    if (!metrics.length) return `<span class="matrix-value is-missing">—</span>`;
    const latestYear = String(metrics[0].year);
    const latest = metrics.filter((metric) => String(metric.year) === latestYear);
    return latest.map((metric) => `<span class="matrix-value${metricCopy(metric).caution ? " is-caution" : ""}">${metricValue(metric)}</span>`).join(`<span class="matrix-separator">·</span>`);
  }

  function renderManagementTable(provider, otherProvider) {
    const concepts = tableConcepts(provider, otherProvider);
    const rows = concepts.map((concept) => {
      const title = conceptTitle(concept, [provider, otherProvider].filter(Boolean));
      const luce = pickMetrics(provider, "luce", concept);
      const gas = pickMetrics(provider, "gas", concept);
      const general = pickMetrics(provider, "general", concept);
      const all = [...luce, ...gas, ...general];
      const infoId = registerMetricInfo(all, provider, title);
      if (!luce.length && !gas.length && general.length) {
        return `<div class="matrix-row matrix-data-row" role="row">
          <span class="matrix-label" role="rowheader">${escapeHtml(title)}</span>
          <span class="matrix-combined" role="cell">${cellContent(general)} <small>Luce + Gas</small></span>
          <button type="button" class="info-button" data-metric-info="${infoId}" aria-label="Spiega ${escapeHtml(title)}">i</button>
        </div>`;
      }
      return `<div class="matrix-row matrix-data-row" role="row">
        <span class="matrix-label" role="rowheader">${escapeHtml(title)}</span>
        <span class="matrix-cell" role="cell">${cellContent(luce)}</span>
        <span class="matrix-cell" role="cell">${cellContent(gas)}</span>
        <button type="button" class="info-button" data-metric-info="${infoId}" aria-label="Spiega ${escapeHtml(title)}">i</button>
      </div>`;
    }).join("");

    return `<section class="provider-data-section" aria-label="Gestione reclami">
      <div class="provider-section-title"><strong>Gestione reclami</strong><span>Dati ufficiali del fornitore</span></div>
      <div class="metric-matrix" role="table" aria-label="Dati luce e gas di ${escapeHtml(provider.name)}">
        <div class="matrix-row matrix-header" role="row"><span role="columnheader">Voce</span><span role="columnheader">Luce</span><span role="columnheader">Gas</span><span aria-hidden="true"></span></div>
        ${rows}
      </div>
    </section>`;
  }

  function renderReasonTable(provider) {
    const rows = marketReasons.luce.map((referenceReason) => {
      const gasReason = reasonForSector("gas", referenceReason);
      const providerLuce = providerReason(provider, referenceReason, "luce");
      const providerGas = gasReason ? providerReason(provider, gasReason, "gas") : null;
      const infoId = registerReasonInfo(referenceReason, provider);
      return `<div class="reason-matrix-row" role="row">
        <span class="reason-matrix-label" role="rowheader">${escapeHtml(referenceReason.label)}</span>
        <span class="reason-matrix-cell benchmark" role="cell">${formatNumber(referenceReason.value)}%</span>
        <span class="reason-matrix-cell provider-value${providerLuce ? "" : " is-missing"}" role="cell">${providerLuce ? `${formatNumber(Number(providerLuce.value))}%` : "—"}</span>
        <span class="reason-matrix-cell benchmark" role="cell">${gasReason ? `${formatNumber(gasReason.value)}%` : "—"}</span>
        <span class="reason-matrix-cell provider-value${providerGas ? "" : " is-missing"}" role="cell">${providerGas ? `${formatNumber(Number(providerGas.value))}%` : "—"}</span>
        <button type="button" class="info-button" data-metric-info="${infoId}" aria-label="Spiega ${escapeHtml(referenceReason.label)}">i</button>
      </div>`;
    }).join("");

    return `<section class="provider-data-section reason-section" aria-label="Motivi dei reclami">
      <div class="provider-section-title"><strong>Motivi dei reclami</strong><span>Fornitore vs mercato ARERA 2024</span></div>
      <div class="reason-matrix" role="table" aria-label="Motivi dei reclami: mercato ARERA e ${escapeHtml(provider.name)}">
        <div class="reason-matrix-row reason-sector-header" role="row"><span class="reason-header-spacer"></span><span class="sector-group sector-luce" role="columnheader">Luce</span><span class="sector-group sector-gas" role="columnheader">Gas</span><span class="reason-info-spacer"></span></div>
        <div class="reason-matrix-row reason-column-header" role="row"><span role="columnheader">Motivo</span><span role="columnheader">ARERA</span><span role="columnheader" aria-label="${escapeHtml(provider.name)} luce">Forn.</span><span role="columnheader">ARERA</span><span role="columnheader" aria-label="${escapeHtml(provider.name)} gas">Forn.</span><span aria-hidden="true"></span></div>
        ${rows}
      </div>
    </section>`;
  }

  function renderObservers(provider) {
    return ["UNC", "Altroconsumo"].map((source) => {
      const id = registerObserverInfo(provider, source);
      return `<div class="observer-row"><strong>${escapeHtml(source)}</strong><span>${escapeHtml(observerSummary(provider, source))}</span><button type="button" class="info-button" data-metric-info="${id}" aria-label="Dettagli ${escapeHtml(source)} per ${escapeHtml(provider.name)}">i</button></div>`;
    }).join("");
  }

  function renderCard(provider, otherProvider, body) {
    const card = body?.closest(".provider-card");
    if (!provider) {
      if (body) {
        body.innerHTML = "";
        body.hidden = true;
      }
      card?.classList.remove("is-active");
      return;
    }

    body.hidden = false;
    card?.classList.add("is-active");
    const officialYear = provider.coverage?.official?.year || "anno non disponibile";
    const status = provider.coverage?.official?.status || "NON VERIFICATA";
    const logo = provider.logo ? `<img src="${escapeHtml(provider.logo)}" alt="Logo ${escapeHtml(provider.name)}">` : `<span class="initials" aria-hidden="true">${escapeHtml(initials(provider.name))}</span>`;

    body.innerHTML = `
      <div class="provider-card-head">
        <div class="provider-logo">${logo}</div>
        <div class="provider-card-title"><h3>${escapeHtml(provider.name)}</h3><p>Dati ufficiali ${escapeHtml(officialYear)} · ${escapeHtml(status.toLowerCase().replaceAll("_", " "))}</p></div>
      </div>
      ${renderManagementTable(provider, otherProvider)}
      ${renderReasonTable(provider)}
      <div class="observers-head"><strong>UNC / Altroconsumo</strong><span>Osservatori separati dai dati ufficiali</span></div>
      <div class="provider-observers">${renderObservers(provider)}</div>
      <div class="provider-actions">
        <a class="btn btn-primary" href="/reclami-luce-gas.html?fornitore=${encodeURIComponent(provider.key)}#verifica-caso">Verifica un problema</a>
        <a class="btn btn-secondary" href="/?landing=0&from=fornitori-trasparenza&provider=${encodeURIComponent(provider.key)}">Vedi offerte</a>
      </div>`;
  }

  function numericMetric(provider, sector, indicator, year) {
    return metricsBySector(provider, sector).find((metric) => metric.indicator === indicator && String(metric.year) === String(year) && metric.comparable && Number.isFinite(Number(metric.value)));
  }

  function serviceComparisonItems(providerA, providerB) {
    const specs = [
      { indicator: "Rispetto standard risposta reclami", direction: "higher", copy: (winner, a, b, sector) => `${sector}: ${winner.name} rispetta più spesso i tempi dei reclami (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Tempo medio risposta reclami", direction: "lower", copy: (winner, a, b, sector) => `${sector}: ${winner.name} risponde più rapidamente (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Rispetto standard rettifica fatturazione", direction: "higher", copy: (winner, a, b, sector) => `${sector}: ${winner.name} corregge più spesso le bollette entro i tempi (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Tempo medio rettifica fatturazione", direction: "lower", copy: (winner, a, b, sector) => `${sector}: ${winner.name} corregge le bollette più rapidamente (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Rispetto standard rettifica doppia fatturazione", direction: "higher", copy: (winner, a, b, sector) => `${sector}: ${winner.name} ha più rettifiche di doppia fatturazione entro i tempi (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Tempo medio rettifica doppia fatturazione", direction: "lower", copy: (winner, a, b, sector) => `${sector}: ${winner.name} corregge più rapidamente le doppie fatturazioni (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` }
    ];
    const items = [];
    ["luce", "gas", "general"].forEach((sectorKey) => {
      const sectorLabel = sectorKey === "luce" ? "Luce" : sectorKey === "gas" ? "Gas" : "Luce e gas";
      specs.forEach((spec) => {
        const yearsA = metricsBySector(providerA, sectorKey).filter((m) => m.indicator === spec.indicator && m.comparable).map((m) => String(m.year));
        const yearsB = new Set(metricsBySector(providerB, sectorKey).filter((m) => m.indicator === spec.indicator && m.comparable).map((m) => String(m.year)));
        const commonYears = yearsA.filter((year) => yearsB.has(year)).sort((a, b) => b.localeCompare(a, "it", { numeric: true }));
        if (!commonYears.length) return;
        const year = commonYears[0];
        const a = numericMetric(providerA, sectorKey, spec.indicator, year);
        const b = numericMetric(providerB, sectorKey, spec.indicator, year);
        if (!a || !b || String(a.unit) !== String(b.unit)) return;
        const av = Number(a.value);
        const bv = Number(b.value);
        if (av === bv) return;
        const aWins = spec.direction === "higher" ? av > bv : av < bv;
        const winner = aWins ? providerA : providerB;
        items.push({ priority: Math.abs(av - bv), text: spec.copy(winner, a, b, sectorLabel) });
      });
    });
    return items.sort((a, b) => b.priority - a.priority);
  }

  function reasonComparisonItems(providerA, providerB) {
    const direct = [];
    const benchmark = [];
    ["luce", "gas"].forEach((sector) => {
      const sectorLabel = sector === "luce" ? "Luce" : "Gas";
      marketReasons[sector].forEach((reason) => {
        const a = providerReason(providerA, reason, sector);
        const b = providerReason(providerB, reason, sector);
        const market = Number(reason.value);
        if (a && b && String(a.year) === String(b.year)) {
          const av = Number(a.value);
          const bv = Number(b.value);
          if (Number.isFinite(av) && Number.isFinite(bv) && Math.abs(av - bv) >= 0.005) {
            const lower = av < bv ? providerA : providerB;
            const low = av < bv ? av : bv;
            const high = av < bv ? bv : av;
            direct.push({
              priority: Math.abs(av - bv),
              text: `${reason.label} ${sectorLabel.toLowerCase()}: pesa meno nei reclami di ${lower.name} (${formatNumber(low)}% vs ${formatNumber(high)}%; mercato ARERA ${formatNumber(market)}%).`
            });
            return;
          }
        }
        [
          { provider: providerA, entry: a },
          { provider: providerB, entry: b }
        ].forEach(({ provider, entry }) => {
          if (!entry || String(entry.year) !== "2024") return;
          const value = Number(entry.value);
          if (!Number.isFinite(value) || Math.abs(value - market) < 0.5) return;
          benchmark.push({
            priority: Math.abs(value - market),
            text: `${reason.label} ${sectorLabel.toLowerCase()}: per ${provider.name} pesa ${value < market ? "meno" : "più"} del riferimento ARERA (${formatNumber(value)}% vs ${formatNumber(market)}%).`
          });
        });
      });
    });
    return [...direct.sort((a, b) => b.priority - a.priority), ...benchmark.sort((a, b) => b.priority - a.priority)];
  }

  function renderComparisonSummary(providerA, providerB) {
    if (!comparisonSummary || !comparisonSummaryBody || !providerA || !providerB) {
      if (comparisonSummary) comparisonSummary.hidden = true;
      return;
    }
    const items = [...reasonComparisonItems(providerA, providerB), ...serviceComparisonItems(providerA, providerB)];
    comparisonSummary.hidden = false;
    if (!items.length) {
      comparisonSummaryBody.innerHTML = `<p class="comparison-lead">Dati insufficienti per un confronto diretto tra questi due fornitori.</p>`;
      return;
    }
    comparisonSummaryBody.innerHTML = `<ul>${items.slice(0, 3).map((item) => `<li>${escapeHtml(item.text)}</li>`).join("")}</ul>`;
  }

  function renderBoth() {
    infoPayloads.clear();
    infoCounter = 0;
    const providerA = providers.get(selectA.value) || null;
    const providerB = providers.get(selectB.value) || null;
    renderCard(providerA, providerB, bodyA);
    renderCard(providerB, providerA, bodyB);
    renderComparisonSummary(providerA, providerB);
    const names = [providerA?.name, providerB?.name].filter(Boolean);
    live.textContent = names.length ? `Dati caricati: ${names.join(" e ")}.` : "Scegli un fornitore.";
  }

  function openInfo(title, html) {
    dialogTitle.textContent = title || "Dettaglio del dato";
    dialogBody.innerHTML = html || "";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  document.addEventListener("click", (event) => {
    const metricButton = event.target.closest("[data-metric-info]");
    if (metricButton) {
      const payload = infoPayloads.get(metricButton.getAttribute("data-metric-info"));
      if (payload) openInfo(payload.title, payload.html);
      return;
    }
    const link = event.target.closest("[data-provider-link]");
    if (link) {
      const key = link.getAttribute("data-provider-link");
      if (!providers.has(key)) return;
      event.preventDefault();
      selectA.value = key;
      if (selectB.value === key) selectB.value = "";
      renderBoth();
      document.getElementById("scheda-fornitore")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  });

  dialogClose?.addEventListener("click", () => { if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); });
  dialog?.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) { if (typeof dialog.close === "function") dialog.close(); else dialog.removeAttribute("open"); }
  });

  selectA?.addEventListener("change", () => {
    if (selectA.value && selectA.value === selectB.value) selectB.value = "";
    renderBoth();
  });

  selectB?.addEventListener("change", () => {
    if (selectB.value && selectB.value === selectA.value) {
      live.textContent = "Scegli un fornitore diverso per il confronto.";
      selectB.value = "";
    }
    renderBoth();
  });

  // La pagina parte sempre pulita: nessun fornitore viene preselezionato dall'URL.
  selectA.value = "";
  selectB.value = "";
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("fornitore");
  cleanUrl.searchParams.delete("confronta");
  if (cleanUrl.href !== window.location.href) history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  renderBoth();
})();
