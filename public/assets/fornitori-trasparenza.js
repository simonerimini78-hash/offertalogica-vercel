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
    const base = formatNumber(metric.value);
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
      "Punteggio Reclama Facile": ["Valutazione Reclama Facile", `È un indicatore di Altroconsumo, non un voto OffertaLogica: ${value}.`],
      "Tempo risposta azienda": ["Risposta su Altroconsumo", `Altroconsumo indica ${value}. Non coincide con il tempo medio regolatorio TIQV.`]
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

  function pairConcepts(providerA, providerB, sector) {
    const concepts = new Set();
    [providerA, providerB].filter(Boolean).forEach((provider) => {
      metricsBySector(provider, sector).forEach((metric) => concepts.add(metricConcept(metric)));
    });
    return [...concepts].sort(conceptSort);
  }

  function pickMetrics(provider, sector, concept) {
    if (!provider) return [];
    return metricsBySector(provider, sector)
      .filter((metric) => metricConcept(metric) === concept)
      .sort((a, b) => String(b.year).localeCompare(String(a.year), "it", { numeric: true }));
  }

  function conceptTitle(concept, referenceMetrics = []) {
    if (conceptTitles[concept]) return conceptTitles[concept];
    const first = referenceMetrics[0];
    return first ? metricCopy(first).title : concept.replace(/^other:/, "");
  }

  function initials(name) {
    return String(name || "OL").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function registerMetricInfo(metrics, provider, title) {
    const list = Array.isArray(metrics) ? metrics : [metrics];
    const id = `metric-${++infoCounter}`;
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

  function hasProviderReasonData(provider, sector) {
    return providerReasonEntries(provider).some((entry) => complaintReasonSector(entry) === sector && String(entry?.unit || "%").trim() === "%" && Number.isFinite(Number(entry?.value)));
  }

  function registerMarketInfo(reason, sector, provider, providerEntry) {
    const id = `market-${++infoCounter}`;
    const sectorLabel = sector === "luce" ? "luce" : "gas";
    const specific = providerEntry
      ? `<span><strong>${escapeHtml(provider.name)}:</strong> ${formatNumber(Number(providerEntry.value))}% dei suoi reclami · anno ${escapeHtml(providerEntry.year || "non indicato")}</span>`
      : `<span><strong>${escapeHtml(provider.name)}:</strong> dettaglio specifico non disponibile nel dataset verificato</span>`;
    let comparison = "";
    if (providerEntry && String(providerEntry.year) === "2024") {
      const diff = Number(providerEntry.value) - Number(reason.value);
      const abs = Math.abs(diff);
      const position = abs < 0.005 ? "in linea con" : diff < 0 ? "inferiore a" : "superiore a";
      comparison = `<span><strong>Lettura:</strong> la quota di questo motivo tra i reclami del fornitore è ${position} quella del mercato${abs >= 0.005 ? ` di ${formatNumber(abs)} punti percentuali` : ""}.</span>`;
    } else if (providerEntry) {
      comparison = `<span><strong>Lettura:</strong> il dato del fornitore e il benchmark ARERA si riferiscono ad anni diversi, quindi non li trattiamo come confronto diretto.</span>`;
    }
    infoPayloads.set(id, {
      title: reason.label,
      html: `<p>${escapeHtml(reason.explain)}</p>
        <div class="info-dialog-meta">
          ${specific}
          <span><strong>Mercato ARERA:</strong> ${formatNumber(reason.value)}% dei reclami · 2024 · settore ${sectorLabel}</span>
          ${comparison}
          <span><strong>Categoria tecnica ARERA:</strong> ${escapeHtml(reason.technical)}</span>
          <span><strong>Come leggerlo:</strong> è la quota di questo motivo sul totale dei reclami, non la percentuale di clienti o fatture con un problema.</span>
          ${providerEntry?.sourceUrl ? `<a href="${escapeHtml(providerEntry.sourceUrl)}" target="_blank" rel="noopener noreferrer">Apri la fonte del fornitore</a>` : ""}
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

  function renderOfficialRows(provider, otherProvider, sector) {
    const concepts = pairConcepts(provider, otherProvider, sector);
    if (!concepts.length) {
      return `<div class="metric-row is-missing"><span class="metric-row-label">Dati ufficiali</span><span class="metric-row-value"><strong>—</strong><small>non disponibili</small></span><span aria-hidden="true"></span></div>`;
    }
    return concepts.map((concept) => {
      const own = pickMetrics(provider, sector, concept);
      const reference = own.length ? own : pickMetrics(otherProvider, sector, concept);
      const title = conceptTitle(concept, reference);
      if (!own.length) {
        return `<div class="metric-row is-missing"><span class="metric-row-label">${escapeHtml(title)}</span><span class="metric-row-value"><strong>—</strong><small>non disponibile</small></span><span aria-hidden="true"></span></div>`;
      }
      const infoId = registerMetricInfo(own, provider, title);
      const values = own.map((metric) => metricValue(metric)).join(" · ");
      const years = [...new Set(own.map((metric) => String(metric.year)))];
      const caution = own.some((metric) => metricCopy(metric).caution);
      return `<div class="metric-row${caution ? " is-caution" : ""}"><span class="metric-row-label">${escapeHtml(title)}</span><span class="metric-row-value"><strong>${values}</strong><small>${escapeHtml(years.join("/"))}</small></span><button type="button" class="info-button" data-metric-info="${infoId}" aria-label="Spiega ${escapeHtml(title)}">i</button></div>`;
    }).join("");
  }

  function renderMarketReasons(provider, sector) {
    const comparisonMode = hasProviderReasonData(provider, sector);
    return marketReasons[sector].map((reason) => {
      const specific = providerReason(provider, reason, sector);
      const infoId = registerMarketInfo(reason, sector, provider, specific);
      if (!comparisonMode) {
        return `<div class="reason-row"><span>${escapeHtml(reason.label)}</span><span class="reason-row-value benchmark-only"><strong>${formatNumber(reason.value)}%</strong><small>mercato ARERA</small></span><button type="button" class="info-button" data-metric-info="${infoId}" aria-label="Spiega ${escapeHtml(reason.label)}">i</button></div>`;
      }
      const mainValue = specific ? `${formatNumber(Number(specific.value))}%` : "n.d.";
      const year = specific?.year ? ` · ${escapeHtml(specific.year)}` : "";
      return `<div class="reason-row"><span>${escapeHtml(reason.label)}</span><span class="reason-row-value${specific ? "" : " is-missing"}"><strong>${mainValue}</strong><small>fornitore${year}</small><em>ARERA ${formatNumber(reason.value)}%</em></span><button type="button" class="info-button" data-metric-info="${infoId}" aria-label="Spiega ${escapeHtml(reason.label)}">i</button></div>`;
    }).join("");
  }

  function renderSector(provider, otherProvider, sector, label) {
    const hasReasons = hasProviderReasonData(provider, sector);
    return `<section class="sector-box">
      <div class="sector-head"><strong>${escapeHtml(label)}</strong></div>
      <div class="data-subhead">Gestione reclami</div>
      <div class="metric-rows">${renderOfficialRows(provider, otherProvider, sector)}</div>
      <div class="data-subhead data-subhead-reasons"><span>Motivi dei reclami</span><small>${hasReasons ? "fornitore vs mercato ARERA 2024" : "mercato ARERA 2024 · dato fornitore n.d."}</small></div>
      <div class="reason-rows">${renderMarketReasons(provider, sector)}</div>
    </section>`;
  }

  function renderGeneral(provider, otherProvider) {
    const concepts = pairConcepts(provider, otherProvider, "general");
    if (!concepts.length) return "";
    return `<section class="general-data"><div class="data-subhead"><span>Dati complessivi luce e gas</span><small>quando la fonte non separa i settori</small></div><div class="metric-rows">${renderOfficialRows(provider, otherProvider, "general")}</div></section>`;
  }

  function renderObservers(provider) {
    return ["UNC", "Altroconsumo"].map((source) => {
      const id = registerObserverInfo(provider, source);
      return `<div class="observer-row"><strong>${escapeHtml(source)}</strong><span>${escapeHtml(observerSummary(provider, source))}</span><button type="button" class="info-button" data-metric-info="${id}" aria-label="Dettagli ${escapeHtml(source)} per ${escapeHtml(provider.name)}">i</button></div>`;
    }).join("");
  }

  function renderCard(provider, otherProvider, body) {
    if (!provider) {
      const isSecond = body === bodyB;
      body.innerHTML = `<div class="provider-empty"><strong>${isSecond ? "Aggiungi un confronto" : "Scegli un fornitore"}</strong><span>${isSecond ? "Scegli un secondo fornitore per leggere gli stessi dati nello stesso ordine." : "Vedrai qui luce, gas, gestione dei reclami e motivi confrontati con il riferimento ARERA quando esiste un dato specifico del fornitore."}</span></div>`;
      return;
    }

    const officialYear = provider.coverage?.official?.year || "anno non disponibile";
    const status = provider.coverage?.official?.status || "NON VERIFICATA";
    const logo = provider.logo ? `<img src="${escapeHtml(provider.logo)}" alt="Logo ${escapeHtml(provider.name)}">` : `<span class="initials" aria-hidden="true">${escapeHtml(initials(provider.name))}</span>`;

    body.innerHTML = `
      <div class="provider-card-head">
        <div class="provider-logo">${logo}</div>
        <div class="provider-card-title"><h3>${escapeHtml(provider.name)}</h3><p>Dati ufficiali ${escapeHtml(officialYear)} · ${escapeHtml(status.toLowerCase().replaceAll("_", " "))}</p></div>
      </div>
      <div class="provider-sectors provider-sectors-dual">
        ${renderSector(provider, otherProvider, "luce", "Luce")}
        ${renderSector(provider, otherProvider, "gas", "Gas")}
      </div>
      ${renderGeneral(provider, otherProvider)}
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

  function comparisonItems(providerA, providerB) {
    const specs = [
      { indicator: "Rispetto standard risposta reclami", label: "Risposta ai reclami", direction: "higher", copy: (winner, loser, a, b, sector) => `${sector}: ${winner.name} rispetta più spesso i tempi di risposta (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Tempo medio risposta reclami", label: "Tempo medio di risposta", direction: "lower", copy: (winner, loser, a, b, sector) => `${sector}: ${winner.name} risponde mediamente più rapidamente (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Rispetto standard rettifica fatturazione", label: "Correzione bollette", direction: "higher", copy: (winner, loser, a, b, sector) => `${sector}: ${winner.name} conclude più spesso le correzioni della bolletta entro i tempi (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Tempo medio rettifica fatturazione", label: "Tempo correzione bollette", direction: "lower", copy: (winner, loser, a, b, sector) => `${sector}: ${winner.name} corregge mediamente le bollette più rapidamente (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Rispetto standard rettifica doppia fatturazione", label: "Doppia fatturazione", direction: "higher", copy: (winner, loser, a, b, sector) => `${sector}: ${winner.name} mostra una quota maggiore di rettifiche di doppia fatturazione entro i tempi (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` },
      { indicator: "Tempo medio rettifica doppia fatturazione", label: "Tempo doppia fatturazione", direction: "lower", copy: (winner, loser, a, b, sector) => `${sector}: ${winner.name} corregge mediamente più rapidamente i casi di doppia fatturazione (${metricValue(winner === providerA ? a : b)} vs ${metricValue(winner === providerA ? b : a)}).` }
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
        if (av === bv) {
          items.push({ text: `${sectorLabel}: ${spec.label} uguale nei dati confrontabili (${metricValue(a)}, ${year}).`, year, tie: true });
          return;
        }
        const aWins = spec.direction === "higher" ? av > bv : av < bv;
        const winner = aWins ? providerA : providerB;
        const loser = aWins ? providerB : providerA;
        items.push({ text: spec.copy(winner, loser, a, b, sectorLabel), year, winner: winner.key });
      });
    });
    return items;
  }

  function reasonComparisonItems(providerA, providerB) {
    const items = [];
    ["luce", "gas"].forEach((sector) => {
      const sectorLabel = sector === "luce" ? "Luce" : "Gas";
      marketReasons[sector].forEach((reason) => {
        const a = providerReason(providerA, reason, sector);
        const b = providerReason(providerB, reason, sector);
        if (!a || !b || String(a.year) !== String(b.year)) return;
        const av = Number(a.value);
        const bv = Number(b.value);
        if (!Number.isFinite(av) || !Number.isFinite(bv) || Math.abs(av - bv) < 0.005) return;
        const lower = av < bv ? providerA : providerB;
        const higher = av < bv ? providerB : providerA;
        const lowValue = av < bv ? av : bv;
        const highValue = av < bv ? bv : av;
        items.push({
          priority: Math.abs(av - bv),
          text: `${sectorLabel} · ${reason.label}: questo motivo pesa meno tra i reclami di ${lower.name} (${formatNumber(lowValue)}%) rispetto a ${higher.name} (${formatNumber(highValue)}%); mercato ARERA 2024 ${formatNumber(reason.value)}%.`
        });
      });
    });
    return items.sort((a, b) => b.priority - a.priority);
  }

  function renderComparisonSummary(providerA, providerB) {
    if (!comparisonSummary || !comparisonSummaryBody || !providerA || !providerB) {
      if (comparisonSummary) comparisonSummary.hidden = true;
      return;
    }
    const reasonItems = reasonComparisonItems(providerA, providerB);
    const serviceItems = comparisonItems(providerA, providerB);
    const items = [...reasonItems.map((item) => ({ text: item.text })), ...serviceItems];
    comparisonSummary.hidden = false;
    if (!items.length) {
      comparisonSummaryBody.innerHTML = `<p class="comparison-lead">Non ci sono ancora dati specifici abbastanza omogenei per confrontare direttamente questi due fornitori.</p><p class="comparison-note">Il riferimento ARERA sui motivi dei reclami resta visibile nelle schede, ma non viene attribuito al singolo fornitore.</p>`;
      return;
    }
    comparisonSummaryBody.innerHTML = `<ul>${items.slice(0, 4).map((item) => `<li>${escapeHtml(item.text)}</li>`).join("")}</ul><p class="comparison-note">Prima usiamo eventuali motivi di reclamo specifici e omogenei; poi i dati sulla gestione. Le percentuali dei motivi descrivono la composizione dei reclami, non la quota di clienti o fatture con problemi.</p>`;
  }

  function renderBoth() {
    infoPayloads.clear();
    infoCounter = 0;
    const providerA = providers.get(selectA.value) || null;
    const providerB = providers.get(selectB.value) || null;
    renderCard(providerA, providerB, bodyA);
    renderCard(providerB, providerA, bodyB);
    renderComparisonSummary(providerA, providerB);

    const url = new URL(window.location.href);
    if (providerA) url.searchParams.set("fornitore", providerA.key); else url.searchParams.delete("fornitore");
    if (providerB) url.searchParams.set("confronta", providerB.key); else url.searchParams.delete("confronta");
    const query = url.searchParams.toString();
    history.replaceState(null, "", `${url.pathname}${query ? `?${query}` : ""}#scheda-fornitore`);
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

  const params = new URLSearchParams(window.location.search);
  const requestedA = params.get("fornitore");
  const requestedB = params.get("confronta");
  if (requestedA && providers.has(requestedA)) selectA.value = requestedA;
  if (requestedB && providers.has(requestedB) && requestedB !== requestedA) selectB.value = requestedB;
  if (selectA.value || selectB.value) renderBoth();
})();
