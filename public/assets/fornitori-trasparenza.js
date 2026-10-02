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
  const comparisonBox = document.getElementById("provider-comparison-summary");
  const dialog = document.getElementById("metric-info-dialog");
  const dialogTitle = document.getElementById("metric-info-title");
  const dialogBody = document.getElementById("metric-info-body");
  const dialogClose = document.getElementById("metric-info-close");
  const infoPayloads = new Map();
  let infoCounter = 0;

  const conceptOrder = ["complaint-response", "billing-correction", "double-billing", "information", "complaint-volume", "indemnities"];
  const conceptTitles = {
    "complaint-response": "Risposta ai reclami",
    "billing-correction": "Correzione bollette",
    "double-billing": "Doppia fatturazione",
    "information": "Richieste di informazioni",
    "complaint-volume": "Reclami registrati",
    "indemnities": "Indennizzi"
  };

  const marketReasons = [
    { label: "Problemi con la bolletta", technical: "Fatturazione", luce: 38.84, gas: 46.31, explain: "Importi, consumi, conguagli, periodicità, pagamenti, rimborsi o voci della bolletta." },
    { label: "Problemi con il contratto", technical: "Contratti", luce: 15.57, gas: 21.54, explain: "Recesso, cambio di intestazione, voltura, subentro, perfezionamento o costi del contratto." },
    { label: "Cambio fornitore o offerta", technical: "Mercato", luce: 16.41, gas: 11.99, explain: "Conclusione di nuovi contratti, tempi dello switching o condizioni economiche applicate rispetto all'offerta." },
    { label: "Pagamenti e distacchi", technical: "Morosità e sospensione", luce: 11.62, gas: 8.44, explain: "Solleciti, morosità, sospensione della fornitura o contestazioni sui pagamenti." },
    { label: "Problemi tecnici o lavori", technical: "Connessioni, lavori e qualità tecnica", luce: 6.59, gas: 2.45, explain: "Segnalazioni collegate a connessioni, lavori o aspetti tecnici della fornitura." },
    { label: "Letture e contatore", technical: "Misura", luce: 3.54, gas: 5.01, explain: "Problemi legati alla misura dei consumi, letture o contatore." },
    { label: "Altri problemi", technical: "Altri argomenti", luce: 3.48, gas: 1.67, explain: "Casi residuali non ricondotti alle altre categorie ARERA." },
    { label: "Assistenza commerciale", technical: "Qualità commerciale", luce: 2.96, gas: 1.56, explain: "Problemi relativi alla qualità commerciale del servizio." },
    { label: "Bonus sociale", technical: "Bonus sociale", luce: 0.98, gas: 1.02, explain: "Segnalazioni relative al bonus sociale." }
  ];

  const comparisonDirection = new Map([
    ["Rispetto standard risposta reclami", "higher"],
    ["Tempo medio risposta reclami", "lower"],
    ["Rispetto standard rettifica fatturazione", "higher"],
    ["Tempo medio rettifica fatturazione", "lower"],
    ["Rispetto standard rettifica doppia fatturazione", "higher"],
    ["Tempo medio rettifica doppia fatturazione", "lower"],
    ["Risposte informazioni entro 30 giorni", "higher"]
  ]);

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
      "Tempo medio risposta reclami": ["Tempo medio di risposta", `In media, il fornitore risponde ai reclami in ${value}.`],
      "Rispetto standard rettifica fatturazione": ["Bollette corrette nei tempi", outOf100 === null ? "Quota di correzioni della bolletta concluse entro i tempi previsti." : `Circa ${outOf100} correzioni su 100 vengono concluse entro i tempi previsti.`],
      "Tempo medio rettifica fatturazione": ["Tempo medio correzione bolletta", `In media, una correzione della bolletta richiede ${value}.`],
      "Rispetto standard rettifica doppia fatturazione": ["Doppie bollette corrette nei tempi", outOf100 === 0 ? "La fonte indica 0% entro il termine. Senza il numero totale dei casi il dato va interpretato con cautela." : (outOf100 === null ? "Quota di doppie fatturazioni corrette entro il termine previsto." : `Circa ${outOf100} casi su 100 risultano corretti entro il termine previsto.`)],
      "Tempo medio rettifica doppia fatturazione": ["Tempo medio doppia bolletta", `In media, la correzione di una doppia fatturazione richiede ${value}.`],
      "Risposte informazioni entro 30 giorni": ["Informazioni entro 30 giorni", outOf100 === null ? "Quota di richieste di informazioni risposte entro 30 giorni." : `Circa ${outOf100} richieste su 100 ricevono risposta entro 30 giorni.`],
      "Reclami ricevuti": ["Reclami registrati", `La fonte registra ${value}. Il numero assoluto da solo non misura la qualità del fornitore.`],
      "Reclami gestiti": ["Reclami gestiti", `La fonte registra ${value}. Per confrontare fornitori servirebbe rapportare il dato ai clienti serviti.`],
      "Risposte reclami entro standard": ["Reclami risposti nei tempi", `La fonte registra ${value} entro il termine previsto.`],
      "Rettifiche fatturazione entro standard": ["Correzioni concluse nei tempi", `La fonte registra ${value} correzioni concluse entro il termine previsto.`],
      "Indennizzi reclami": ["Indennizzi legati ai reclami", `La fonte riporta ${value} di indennizzi nel perimetro indicato.`],
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

  function pairConcepts(providerA, providerB) {
    const concepts = new Set(["complaint-response", "billing-correction", "double-billing"]);
    [providerA, providerB].filter(Boolean).forEach((provider) => {
      officialMetrics(provider).forEach((metric) => concepts.add(metricConcept(metric)));
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
      html = `<p>${coverage?.status === "VERIFICATA" ? "La fonte è stata verificata, ma i valori non sono ancora normalizzati nel database OL." : "Non abbiamo un dato normalizzato e verificato per questo osservatorio."}</p>`;
    }
    if (coverage?.url) html += `<div class="info-dialog-meta"><a href="${escapeHtml(coverage.url)}" target="_blank" rel="noopener noreferrer">Apri la fonte ${escapeHtml(source)}</a></div>`;
    infoPayloads.set(id, { title: `${source} · ${provider.name}`, html });
    return id;
  }

  function registerMarketInfo(reason) {
    const id = `market-${++infoCounter}`;
    infoPayloads.set(id, {
      title: reason.label,
      html: `<p>${escapeHtml(reason.explain)}</p><div class="info-dialog-meta"><span><strong>Categoria ARERA:</strong> ${escapeHtml(reason.technical)}</span><span><strong>Anno:</strong> 2024</span><span><strong>Perimetro:</strong> mercato italiano; non è un dato del singolo fornitore</span><a href="https://www.arera.it/fileadmin/allegati/relaz_ann/25/VOLUME_1_definitivo.pdf" target="_blank" rel="noopener noreferrer">Apri la fonte ARERA</a></div>`
    });
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
      if (complaints) bits.push(`${formatNumber(complaints.value)} reclami ${complaints.year}`);
      if (resolved) {
        const match = String(resolved.unit || "").match(/su\s*(\d+)/i);
        const pct = match ? Math.round((Number(resolved.value) / Number(match[1])) * 100) : null;
        bits.push(pct ? `${pct}% casi risolti` : `${metricValue(resolved)} risolti`);
      }
      return bits.join(" · ") || `${metrics.length} dati`;
    }
    return metrics.map((metric) => `${metricCopy(metric).title}: ${metricValue(metric)}`).join(" · ");
  }

  function renderMetricCell(provider, sector, concept, otherProvider) {
    const metrics = pickMetrics(provider, sector, concept);
    if (!metrics.length) return `<span class="matrix-value is-missing">—</span>`;
    const reference = metrics.length ? metrics : pickMetrics(otherProvider, sector, concept);
    const title = conceptTitle(concept, reference);
    const infoId = registerMetricInfo(metrics, provider, title);
    const values = metrics.map((metric) => metricValue(metric)).join(" · ");
    const caution = metrics.some((metric) => metricCopy(metric).caution);
    return `<span class="matrix-value${caution ? " is-caution" : ""}"><strong>${values}</strong><button type="button" class="info-button info-button-small" data-metric-info="${infoId}" aria-label="Dettagli ${escapeHtml(title)} ${escapeHtml(sector)}">i</button></span>`;
  }

  function renderOfficialMatrix(provider, otherProvider) {
    const concepts = pairConcepts(provider, otherProvider);
    const rows = concepts.map((concept) => {
      const reference = ["luce", "gas", "general"].flatMap((sector) => pickMetrics(provider, sector, concept)).concat(["luce", "gas", "general"].flatMap((sector) => pickMetrics(otherProvider, sector, concept)));
      const title = conceptTitle(concept, reference);
      const luce = renderMetricCell(provider, "luce", concept, otherProvider);
      const gas = renderMetricCell(provider, "gas", concept, otherProvider);
      const general = pickMetrics(provider, "general", concept);
      let generalRow = "";
      if (general.length) {
        const infoId = registerMetricInfo(general, provider, title);
        const values = general.map((metric) => metricValue(metric)).join(" · ");
        generalRow = `<div class="matrix-general"><span>Luce + gas</span><strong>${values}</strong><button type="button" class="info-button info-button-small" data-metric-info="${infoId}" aria-label="Dettagli ${escapeHtml(title)} aggregato">i</button></div>`;
      }
      return `<div class="matrix-row"><span class="matrix-label">${escapeHtml(title)}</span>${luce}${gas}</div>${generalRow}`;
    }).join("");

    return `<section class="provider-data-section" aria-label="Dati ufficiali di ${escapeHtml(provider.name)}">
      <div class="matrix-head"><span>Dati ufficiali</span><strong>Luce</strong><strong>Gas</strong></div>
      <div class="provider-matrix">${rows}</div>
    </section>`;
  }

  function renderMarketReasons() {
    const rows = marketReasons.map((reason) => {
      const id = registerMarketInfo(reason);
      return `<div class="reason-row"><span>${escapeHtml(reason.label)}</span><strong>${formatNumber(reason.luce)}%</strong><strong>${formatNumber(reason.gas)}%</strong><button type="button" class="info-button info-button-small" data-metric-info="${id}" aria-label="Dettagli ${escapeHtml(reason.label)}">i</button></div>`;
    }).join("");
    return `<section class="provider-data-section reasons-section" aria-label="Motivi dei reclami nel mercato">
      <div class="section-inline-title"><strong>Motivi dei reclami</strong><span>mercato ARERA 2024 · non specifici del fornitore</span></div>
      <div class="reasons-head"><span>Motivo</span><strong>Luce</strong><strong>Gas</strong><span></span></div>
      <div class="reason-list">${rows}</div>
    </section>`;
  }

  function renderObservers(provider) {
    const rows = ["UNC", "Altroconsumo"].map((source) => {
      const id = registerObserverInfo(provider, source);
      return `<div class="observer-row"><strong>${escapeHtml(source)}</strong><span>${escapeHtml(observerSummary(provider, source))}</span><button type="button" class="info-button info-button-small" data-metric-info="${id}" aria-label="Dettagli ${escapeHtml(source)} per ${escapeHtml(provider.name)}">i</button></div>`;
    }).join("");
    return `<section class="provider-observers" aria-label="Osservatori consumatori"><div class="section-inline-title"><strong>Osservatori consumatori</strong><span>fonti separate dai dati ARERA/TIQV</span></div>${rows}</section>`;
  }

  function renderCard(provider, otherProvider, body) {
    if (!provider) {
      const isSecond = body === bodyB;
      body.innerHTML = `<div class="provider-empty"><strong>${isSecond ? "Aggiungi un confronto" : "Scegli un fornitore"}</strong><span>${isSecond ? "Scegli un secondo fornitore per leggere gli stessi dati nello stesso ordine." : "Vedrai qui luce, gas, motivi dei reclami e fonti nello stesso blocco."}</span></div>`;
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
      ${renderOfficialMatrix(provider, otherProvider)}
      ${renderMarketReasons()}
      ${renderObservers(provider)}
      <div class="provider-actions">
        <a class="btn btn-primary" href="/reclami-luce-gas.html?fornitore=${encodeURIComponent(provider.key)}#verifica-caso">Verifica un problema</a>
        <a class="btn btn-secondary" href="/?landing=0&from=fornitori-trasparenza&provider=${encodeURIComponent(provider.key)}">Vedi offerte</a>
        ${provider.partnerPage ? `<a class="partner-link" href="${escapeHtml(provider.partnerPage)}">Pagina dedicata ${escapeHtml(provider.name)}</a>` : ""}
      </div>`;
  }

  function comparablePairs(providerA, providerB) {
    if (!providerA || !providerB) return [];
    const a = officialMetrics(providerA).filter((m) => m.comparable && comparisonDirection.has(m.indicator));
    const b = officialMetrics(providerB).filter((m) => m.comparable && comparisonDirection.has(m.indicator));
    const pairs = [];
    a.forEach((ma) => {
      const match = b.find((mb) => mb.indicator === ma.indicator && mb.unit === ma.unit && String(mb.year) === String(ma.year) && bucket(mb.cluster) === bucket(ma.cluster));
      if (!match) return;
      const av = Number(ma.value);
      const bv = Number(match.value);
      if (!Number.isFinite(av) || !Number.isFinite(bv)) return;
      const direction = comparisonDirection.get(ma.indicator);
      const diff = av - bv;
      const winner = Math.abs(diff) < 0.0001 ? "tie" : ((direction === "higher" ? diff > 0 : diff < 0) ? "a" : "b");
      pairs.push({ a: ma, b: match, winner, sector: bucket(ma.cluster), title: metricCopy(ma).title });
    });
    const seen = new Set();
    return pairs.filter((pair) => {
      const key = `${pair.a.indicator}|${pair.a.unit}|${pair.a.year}|${pair.sector}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function renderComparisonSummary(providerA, providerB) {
    if (!comparisonBox) return;
    if (!providerA || !providerB) {
      comparisonBox.hidden = true;
      comparisonBox.innerHTML = "";
      return;
    }
    const pairs = comparablePairs(providerA, providerB);
    if (!pairs.length) {
      comparisonBox.hidden = false;
      comparisonBox.innerHTML = `<strong>Cosa emerge dal confronto</strong><p>Non ci sono ancora indicatori abbastanza omogenei per dire che uno dei due fornitori gestisce meglio i reclami. I dati restano consultabili nelle due schede.</p>`;
      return;
    }
    const winsA = pairs.filter((p) => p.winner === "a").length;
    const winsB = pairs.filter((p) => p.winner === "b").length;
    let lead = "Il confronto è misto: i due fornitori hanno punti diversi nei dati omogenei disponibili.";
    if (winsA > 0 && winsB === 0) lead = `${providerA.name} mostra una gestione più efficiente sui dati ufficiali direttamente confrontabili disponibili.`;
    else if (winsB > 0 && winsA === 0) lead = `${providerB.name} mostra una gestione più efficiente sui dati ufficiali direttamente confrontabili disponibili.`;
    else if (winsA > winsB) lead = `${providerA.name} mostra risultati migliori su più indicatori confrontabili; ${providerB.name} resta migliore su alcuni aspetti.`;
    else if (winsB > winsA) lead = `${providerB.name} mostra risultati migliori su più indicatori confrontabili; ${providerA.name} resta migliore su alcuni aspetti.`;
    else if (winsA === winsB) lead = "Non emerge un vantaggio netto: i risultati migliori si dividono tra i due fornitori.";

    const details = pairs.slice(0, 4).map((pair) => {
      const sectorLabel = pair.sector === "luce" ? "Luce" : pair.sector === "gas" ? "Gas" : "Luce e gas";
      if (pair.winner === "tie") return `<li><strong>${escapeHtml(pair.title)} · ${sectorLabel}:</strong> stesso risultato (${metricValue(pair.a)}).</li>`;
      const winner = pair.winner === "a" ? providerA : providerB;
      const winnerMetric = pair.winner === "a" ? pair.a : pair.b;
      const loserMetric = pair.winner === "a" ? pair.b : pair.a;
      return `<li><strong>${escapeHtml(pair.title)} · ${sectorLabel}:</strong> ${escapeHtml(winner.name)} ${metricValue(winnerMetric)} vs ${metricValue(loserMetric)}.</li>`;
    }).join("");

    comparisonBox.hidden = false;
    comparisonBox.innerHTML = `<strong>Cosa emerge dal confronto</strong><p>${escapeHtml(lead)}</p><ul>${details}</ul><small>La sintesi usa solo stesso indicatore, stessa unità, stesso anno e stesso settore. I motivi dei reclami ARERA mostrati nelle schede sono dati di mercato e non entrano nel giudizio sul singolo fornitore.</small>`;
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
