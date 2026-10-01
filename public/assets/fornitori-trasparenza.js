(() => {
  "use strict";
  const dataset = window.OL_PROVIDER_QUALITY_DATA;
  if (!dataset || !Array.isArray(dataset.providers)) return;

  const providers = new Map(dataset.providers.map((item) => [item.key, item]));
  const form = document.getElementById("provider-picker-form");
  const select = document.getElementById("provider-select");
  const panel = document.getElementById("provider-panel");
  const live = document.getElementById("provider-live");
  const compareSelect = document.getElementById("compare-select");
  const compareResult = document.getElementById("compare-result");

  const nameEl = document.getElementById("provider-name");
  const metaEl = document.getElementById("provider-meta");
  const logoEl = document.getElementById("provider-logo");
  const partnerLink = document.getElementById("provider-partner-link");
  const reclamiLink = document.getElementById("provider-reclami-link");
  const offersLink = document.getElementById("provider-offers-link");
  const kpis = document.getElementById("provider-kpis");
  const officialBody = document.getElementById("official-body");
  const uncBody = document.getElementById("unc-body");
  const altBody = document.getElementById("altroconsumo-body");
  const sourcesBody = document.getElementById("sources-body");
  const officialSummary = document.getElementById("official-summary");
  const uncSummary = document.getElementById("unc-summary");
  const altSummary = document.getElementById("altroconsumo-summary");

  const metricPriority = [
    "Tempo medio risposta reclami",
    "Rispetto standard risposta reclami",
    "Tempo medio rettifica fatturazione",
    "Rispetto standard rettifica fatturazione",
    "Tempo medio rettifica doppia fatturazione",
    "Rispetto standard rettifica doppia fatturazione",
    "Risposte informazioni entro 30 giorni"
  ];

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  }

  function formatNumber(value) {
    if (typeof value !== "number") return escapeHtml(value);
    return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
  }

  function metricValue(metric) {
    const base = formatNumber(metric.value);
    const unit = String(metric.unit || "").trim();
    if (unit === "%") return `${base}%`;
    if (unit === "euro") return `€ ${base}`;
    return unit ? `${base} ${escapeHtml(unit)}` : base;
  }

  function initials(name) {
    return String(name || "OL").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function sourceCount(provider) {
    const families = new Set(provider.metrics.map((metric) => metric.source));
    if (provider.coverage?.unc?.status === "VERIFICATA") families.add("UNC");
    if (provider.coverage?.altroconsumo?.status === "VERIFICATA") families.add("Altroconsumo");
    if (provider.coverage?.official?.url) families.add("Ufficiale TIQV");
    return families.size;
  }

  function officialMetrics(provider) {
    return provider.metrics.filter((metric) => metric.source === "Ufficiale TIQV");
  }

  function observatoryMetrics(provider, source) {
    return provider.metrics.filter((metric) => metric.source === source);
  }

  function preferredMetrics(provider) {
    const official = officialMetrics(provider).filter((metric) => metric.comparable);
    const ordered = [];
    metricPriority.forEach((indicator) => {
      const matches = official.filter((metric) => metric.indicator === indicator);
      if (matches.length) ordered.push(matches[0]);
    });
    official.forEach((metric) => { if (!ordered.includes(metric)) ordered.push(metric); });
    return ordered.slice(0, 2);
  }

  function renderKpis(provider) {
    const preferred = preferredMetrics(provider);
    const year = provider.coverage?.official?.year || preferred[0]?.year || "—";
    const cards = [
      { value: year || "—", label: "Ultimo anno ufficiale", meta: provider.coverage?.official?.status === "DATI DATATI" ? "Dato disponibile ma non recente" : "Anno del dato localizzato" },
      ...preferred.map((metric) => ({ value: metricValue(metric), label: metric.indicator, meta: `${metric.year} · ${metric.cluster}` })),
      { value: sourceCount(provider), label: "Famiglie di fonti", meta: "Ufficiali e osservatori tenuti separati" }
    ];
    while (cards.length < 4) cards.splice(cards.length - 1, 0, { value: "—", label: "Dato numerico", meta: "Non disponibile in forma confrontabile" });
    kpis.innerHTML = cards.slice(0, 4).map((card) => `<div class="kpi-card"><span class="kpi-value">${card.value}</span><span class="kpi-label">${escapeHtml(card.label)}</span><span class="kpi-meta">${escapeHtml(card.meta)}</span></div>`).join("");
  }

  function renderMetricList(metrics, emptyText) {
    if (!metrics.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return `<div class="metric-list">${metrics.map((metric) => `<article class="metric-item"><div class="metric-main"><span class="metric-name">${escapeHtml(metric.indicator)}</span><span class="metric-number">${metricValue(metric)}</span></div><div class="metric-meta">${escapeHtml(metric.year)} · ${escapeHtml(metric.cluster)}${metric.comparable ? " · dato confrontabile nel corretto perimetro" : " · dato descrittivo"}</div>${metric.note ? `<div class="metric-note">${escapeHtml(metric.note)}</div>` : ""}${metric.sourceUrl ? `<a class="metric-source" href="${escapeHtml(metric.sourceUrl)}" target="_blank" rel="noopener noreferrer">Apri la fonte</a>` : ""}</article>`).join("")}</div>`;
  }

  function renderSources(provider) {
    const entries = [
      ["Fonte ufficiale / TIQV", provider.coverage?.official],
      ["Unione Nazionale Consumatori", provider.coverage?.unc],
      ["Altroconsumo", provider.coverage?.altroconsumo]
    ];
    sourcesBody.innerHTML = `<div class="source-list">${entries.map(([label, source]) => {
      const status = source?.status || "NON VERIFICATA";
      const year = source?.year ? ` · ${source.year}` : "";
      const link = source?.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Apri fonte</a>` : "";
      return `<div class="source-card"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(status)}${escapeHtml(year)}</span>${link}</div>`;
    }).join("")}</div><p class="source-note" style="margin-top:10px"><strong>Regola OL:</strong> l'assenza di un dato non viene interpretata come qualità bassa. Anno, perimetro e provenienza restano sempre visibili.</p>`;
  }

  function renderGroups(provider) {
    const official = officialMetrics(provider);
    const unc = observatoryMetrics(provider, "UNC");
    const altro = observatoryMetrics(provider, "Altroconsumo");
    officialSummary.textContent = `${official.length} dati verificati`;
    uncSummary.textContent = unc.length ? `${unc.length} dati normalizzati` : (provider.coverage?.unc?.status === "VERIFICATA" ? "fonte verificata" : "nessun dato normalizzato");
    altSummary.textContent = altro.length ? `${altro.length} dati normalizzati` : (provider.coverage?.altroconsumo?.status === "VERIFICATA" ? "fonte verificata" : "nessun dato normalizzato");
    officialBody.innerHTML = `<p class="source-note"><strong>Dati regolatori separati dagli osservatori.</strong> I valori assoluti non sono classifiche: per confrontare fornitori servono indicatore, anno e perimetro omogenei.</p>${renderMetricList(official, "Non abbiamo ancora normalizzato un dato numerico ufficiale per questo fornitore. La fonte individuata resta indicata nella sezione Fonti e metodologia.")}`;
    uncBody.innerHTML = `<p class="source-note"><strong>UNC:</strong> questi numeri riguardano i casi transitati dall'Unione Nazionale Consumatori, non tutti i reclami ricevuti dal fornitore.</p>${renderMetricList(unc, provider.coverage?.unc?.status === "VERIFICATA" ? "La fonte UNC è verificata, ma i valori non sono ancora stati normalizzati nel database OL." : "Nessun dato UNC verificato e normalizzato per questo fornitore.")}`;
    altBody.innerHTML = `<p class="source-note"><strong>Altroconsumo:</strong> i dati di Reclama Facile restano distinti dagli indicatori TIQV e non confluiscono in un punteggio OL.</p>${renderMetricList(altro, provider.coverage?.altroconsumo?.status === "VERIFICATA" ? "La fonte Altroconsumo è stata individuata; i valori non ancora normalizzati non vengono ricostruiti da OL." : "Nessun dato Altroconsumo verificato e normalizzato per questo fornitore.")}`;
    renderSources(provider);
  }

  function bucket(cluster) {
    const value = String(cluster || "").toLowerCase();
    if (value.includes("dual")) return "dual";
    if (value.includes("luce") || value.includes("elettric")) return "luce";
    if (value.includes("gas")) return "gas";
    return "altro";
  }

  function commonComparableMetrics(a, b) {
    const left = officialMetrics(a).filter((metric) => metric.comparable);
    const right = officialMetrics(b).filter((metric) => metric.comparable);
    const matches = [];
    left.forEach((ma) => right.forEach((mb) => {
      if (ma.indicator !== mb.indicator) return;
      if (String(ma.unit) !== String(mb.unit)) return;
      if (String(ma.year) !== String(mb.year)) return;
      if (bucket(ma.cluster) !== bucket(mb.cluster)) return;
      matches.push([ma, mb]);
    }));
    const seen = new Set();
    return matches.filter(([ma]) => {
      const key = `${ma.indicator}|${ma.unit}|${ma.year}|${bucket(ma.cluster)}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 6);
  }

  function renderCompare(primary) {
    const other = providers.get(compareSelect.value);
    if (!other || other.key === primary.key) {
      compareResult.innerHTML = `<div class="empty-state">Scegli un secondo fornitore. OL mostrerà solo indicatori con stesso anno, unità e perimetro compatibile.</div>`;
      return;
    }
    const rows = commonComparableMetrics(primary, other);
    if (!rows.length) {
      compareResult.innerHTML = `<div class="empty-state">Non ci sono indicatori direttamente omogenei tra ${escapeHtml(primary.name)} e ${escapeHtml(other.name)} nel dataset verificato. OL non forza un confronto tra metriche diverse.</div>`;
      return;
    }
    compareResult.innerHTML = rows.map(([left, right]) => `<div class="compare-row"><span>${escapeHtml(left.indicator)}<br><small>${escapeHtml(left.year)} · ${escapeHtml(bucket(left.cluster))}</small></span><strong>${metricValue(left)}</strong><strong>${metricValue(right)}</strong></div>`).join("") + `<div class="compare-note">Colonna centrale: ${escapeHtml(primary.name)} · colonna destra: ${escapeHtml(other.name)}. Il confronto non produce un voto o un vincitore.</div>`;
  }

  function updateCompareOptions(primary) {
    const current = compareSelect.value;
    compareSelect.innerHTML = `<option value="">Scegli un altro fornitore</option>` + dataset.providers.filter((item) => item.key !== primary.key).map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.name)}</option>`).join("");
    if (current && current !== primary.key && providers.has(current)) compareSelect.value = current;
    renderCompare(primary);
  }

  function renderProvider(provider, focusPanel = false) {
    nameEl.textContent = provider.name;
    const year = provider.coverage?.official?.year || "anno non disponibile";
    metaEl.textContent = `Dati verificati · riferimento ufficiale: ${year}`;
    logoEl.innerHTML = provider.logo ? `<img src="${escapeHtml(provider.logo)}" alt="Logo ${escapeHtml(provider.name)}">` : `<span class="initials" aria-hidden="true">${escapeHtml(initials(provider.name))}</span>`;
    if (provider.partnerPage) {
      partnerLink.hidden = false;
      partnerLink.href = provider.partnerPage;
      partnerLink.textContent = "Apri la pagina dedicata OL";
    } else {
      partnerLink.hidden = true;
      partnerLink.removeAttribute("href");
    }
    reclamiLink.href = `/reclami-luce-gas.html?fornitore=${encodeURIComponent(provider.key)}#verifica-caso`;
    offersLink.href = `/?landing=0&from=fornitori-trasparenza&provider=${encodeURIComponent(provider.key)}`;
    renderKpis(provider);
    renderGroups(provider);
    updateCompareOptions(provider);
    panel.hidden = false;
    const url = new URL(window.location.href);
    url.searchParams.set("fornitore", provider.key);
    history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}#scheda-fornitore`);
    live.textContent = `Scheda ${provider.name} caricata.`;
    if (focusPanel) panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const provider = providers.get(select.value);
    if (!provider) { live.textContent = "Seleziona un fornitore dall'elenco."; select.focus(); return; }
    renderProvider(provider, true);
  });

  compareSelect?.addEventListener("change", () => {
    const primary = providers.get(select.value);
    if (primary) renderCompare(primary);
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-provider-link]");
    if (!link) return;
    const key = link.getAttribute("data-provider-link");
    if (!providers.has(key)) return;
    event.preventDefault();
    select.value = key;
    renderProvider(providers.get(key), true);
  });

  const requested = new URLSearchParams(window.location.search).get("fornitore");
  if (requested && providers.has(requested)) {
    select.value = requested;
    renderProvider(providers.get(requested), false);
  }
})();
