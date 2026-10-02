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

  function renderSector(provider, otherProvider, sector, label) {
    const concepts = pairConcepts(provider, otherProvider, sector);
    if (!concepts.length) return "";
    const rows = concepts.map((concept) => {
      const reference = pickMetrics(provider, sector, concept).length ? pickMetrics(provider, sector, concept) : pickMetrics(otherProvider, sector, concept);
      const title = conceptTitle(concept, reference);
      const metrics = pickMetrics(provider, sector, concept);
      if (!metrics.length) {
        return `<div class="metric-row is-missing"><span class="metric-row-label">${escapeHtml(title)}</span><span class="metric-row-value"><strong>—</strong><small>non disponibile</small></span><span aria-hidden="true"></span></div>`;
      }
      const infoId = registerMetricInfo(metrics, provider, title);
      const values = metrics.map((metric) => metricValue(metric)).join(" · ");
      const years = [...new Set(metrics.map((metric) => String(metric.year)))];
      const allComparable = metrics.every((metric) => metric.comparable);
      const caution = metrics.some((metric) => metricCopy(metric).caution);
      const meta = `${years.join("/")}${allComparable ? "" : " · non confrontabile"}`;
      return `<div class="metric-row${caution ? " is-caution" : ""}"><span class="metric-row-label">${escapeHtml(title)}</span><span class="metric-row-value"><strong>${values}</strong><small>${escapeHtml(meta)}</small></span><button type="button" class="info-button" data-metric-info="${infoId}" aria-label="Spiega ${escapeHtml(title)}">i</button></div>`;
    }).join("");
    return `<section class="sector-box"><div class="sector-head"><strong>${escapeHtml(label)}</strong><span>${concepts.length} ${concepts.length === 1 ? "voce" : "voci"}</span></div><div class="metric-rows">${rows}</div></section>`;
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
      body.innerHTML = `<div class="provider-empty"><strong>${isSecond ? "Aggiungi un confronto" : "Scegli un fornitore"}</strong><span>${isSecond ? "Scegli un secondo fornitore per leggere gli stessi dati nello stesso ordine." : "Vedrai qui tutti i dati disponibili su luce, gas e reclami."}</span></div>`;
      return;
    }

    const officialYear = provider.coverage?.official?.year || "anno non disponibile";
    const status = provider.coverage?.official?.status || "NON VERIFICATA";
    const logo = provider.logo ? `<img src="${escapeHtml(provider.logo)}" alt="Logo ${escapeHtml(provider.name)}">` : `<span class="initials" aria-hidden="true">${escapeHtml(initials(provider.name))}</span>`;
    const sectors = [
      renderSector(provider, otherProvider, "luce", "Luce"),
      renderSector(provider, otherProvider, "gas", "Gas"),
      renderSector(provider, otherProvider, "general", "Luce e gas / generale")
    ].filter(Boolean).join("");

    body.innerHTML = `
      <div class="provider-card-head">
        <div class="provider-logo">${logo}</div>
        <div class="provider-card-title"><h3>${escapeHtml(provider.name)}</h3><p>Dati ufficiali ${escapeHtml(officialYear)} · ${escapeHtml(status.toLowerCase().replaceAll("_", " "))}</p></div>
      </div>
      <div class="provider-sectors">${sectors || `<section class="sector-box"><div class="sector-head"><strong>Dati ufficiali</strong></div><div class="metric-row is-missing"><span class="metric-row-label">Nessun dato numerico ufficiale normalizzato</span><span class="metric-row-value"><strong>—</strong></span><span></span></div></section>`}</div>
      <div class="provider-observers">${renderObservers(provider)}</div>
      <div class="provider-actions">
        <a class="btn btn-primary" href="/reclami-luce-gas.html?fornitore=${encodeURIComponent(provider.key)}#verifica-caso">Verifica un problema</a>
        <a class="btn btn-secondary" href="/?landing=0&from=fornitori-trasparenza&provider=${encodeURIComponent(provider.key)}">Vedi offerte</a>
      </div>`;
  }

  function renderBoth() {
    infoPayloads.clear();
    infoCounter = 0;
    const providerA = providers.get(selectA.value) || null;
    const providerB = providers.get(selectB.value) || null;
    renderCard(providerA, providerB, bodyA);
    renderCard(providerB, providerA, bodyB);

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
    const staticButton = event.target.closest("[data-info-title]");
    if (staticButton) {
      openInfo(staticButton.getAttribute("data-info-title"), `<p>${escapeHtml(staticButton.getAttribute("data-info-body") || "")}</p><div class="info-dialog-meta"><span><strong>Fonte:</strong> ARERA · dati 2024</span></div>`);
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

  document.querySelectorAll("[data-market-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-market-tab");
      document.querySelectorAll("[data-market-tab]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.querySelectorAll("[data-market-panel]").forEach((panel) => {
        panel.hidden = panel.getAttribute("data-market-panel") !== target;
      });
    });
  });

  const params = new URLSearchParams(window.location.search);
  const requestedA = params.get("fornitore");
  const requestedB = params.get("confronta");
  if (requestedA && providers.has(requestedA)) selectA.value = requestedA;
  if (requestedB && providers.has(requestedB) && requestedB !== requestedA) selectB.value = requestedB;
  if (selectA.value || selectB.value) renderBoth();
})();
