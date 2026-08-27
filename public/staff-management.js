(() => {
  "use strict";

  const RELEASE = "0.36.71";
  const TIME_ZONE = "Europe/Rome";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const VIEW_ID = "staffManagementMonthlyView";
  const TAB_ID = "staffManagementMonthlyTab";
  const PRODUCT_CATALOG = Object.freeze({
    site_free_consumer: Object.freeze({ channel: "site", customerSegment: "consumer", productFamily: "site_free", enabled: true }),
    site_free_business: Object.freeze({ channel: "site", customerSegment: "business", productFamily: "site_free", enabled: true }),
    premium_casa: Object.freeze({ channel: "premium", customerSegment: "consumer", productFamily: "premium", enabled: true }),
    premium_business: Object.freeze({ channel: "premium", customerSegment: "business", productFamily: "premium", enabled: false }),
  });

  const monthFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  });
  const monthLabelFormatter = new Intl.DateTimeFormat("it-IT", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const moneyFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
  const numberFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
  const decimalFormatter = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

  let managementLoading = false;
  let managementSnapshot = null;
  let ownerObserver = null;

  function currentMonthKey(value = new Date()) {
    const parts = monthFormatter.formatToParts(value);
    const year = parts.find(part => part.type === "year")?.value || "";
    const month = parts.find(part => part.type === "month")?.value || "";
    return /^\d{4}$/.test(year) && /^\d{2}$/.test(month) ? `${year}-${month}` : "";
  }

  function normalizeMonthKey(value) {
    const key = String(value || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return "";
    return key;
  }

  function monthPeriod(monthKey = currentMonthKey()) {
    const month = normalizeMonthKey(monthKey) || currentMonthKey();
    return Object.freeze({ mode: "month", month, timeZone: TIME_ZONE });
  }

  function normalizeDimensions(input = {}) {
    const explicitProduct = String(input.productCode || input.product_code || "").trim().toLowerCase();
    if (explicitProduct && PRODUCT_CATALOG[explicitProduct]) {
      return Object.freeze({ productCode: explicitProduct, ...PRODUCT_CATALOG[explicitProduct] });
    }

    const channel = String(input.channel || "").trim().toLowerCase();
    const customerSegment = String(input.customerSegment || input.customer_segment || "").trim().toLowerCase();
    if (channel === "site" && customerSegment === "business") return Object.freeze({ productCode: "site_free_business", ...PRODUCT_CATALOG.site_free_business });
    if (channel === "site") return Object.freeze({ productCode: "site_free_consumer", ...PRODUCT_CATALOG.site_free_consumer });
    if (channel === "premium" && customerSegment === "business") return Object.freeze({ productCode: "premium_business", ...PRODUCT_CATALOG.premium_business });
    if (channel === "premium") return Object.freeze({ productCode: "premium_casa", ...PRODUCT_CATALOG.premium_casa });
    return Object.freeze({ productCode: "", channel: channel || "unknown", customerSegment: customerSegment || "unknown", productFamily: "unknown", enabled: false });
  }

  function syncVisibleRelease() {
    document.querySelectorAll(".brand p,.version").forEach(element => {
      const current = String(element.textContent || "");
      if (/v\d+\.\d+\.\d+/.test(current)) element.textContent = current.replace(/v\d+\.\d+\.\d+/g, `v${RELEASE}`);
    });
  }

  async function remoteRelease() {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return "";
    const payload = await response.json().catch(() => ({}));
    return String(payload?.version || "").trim();
  }

  function guardLegacyReleaseNotice() {
    const notice = document.getElementById("staffUpdateNotice");
    const button = document.getElementById("staffApplyUpdate");
    if (!notice) return;

    let checking = false;
    const reconcile = async () => {
      if (checking || !notice.classList.contains("show")) return;
      checking = true;
      try {
        const latest = await remoteRelease();
        // staff.html conserva il primo CURRENT_RELEASE statico. La guardia nasconde
        // esclusivamente il falso avviso quando version.json coincide con questo modulo.
        if (latest && latest === RELEASE) {
          notice.classList.remove("show");
          if (button) {
            button.hidden = true;
            button.disabled = false;
          }
        }
      } catch {
        // In caso di dubbio l'avviso esistente resta visibile.
      } finally {
        checking = false;
      }
    };

    const observer = new MutationObserver(() => { void reconcile(); });
    observer.observe(notice, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    void reconcile();
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function money(value, fallback = "0,00 €") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? moneyFormatter.format(parsed) : fallback;
  }

  function number(value) {
    return numberFormatter.format(numeric(value));
  }

  function percent(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${decimalFormatter.format(parsed)}%` : "—";
  }

  function duration(seconds) {
    const total = Math.max(0, Math.round(numeric(seconds)));
    if (total < 60) return `${total} sec`;
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    return remainder ? `${minutes} min ${remainder} sec` : `${minutes} min`;
  }

  function dateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? dateTimeFormatter.format(date) : "—";
  }

  function monthLabel(key) {
    const normalized = normalizeMonthKey(key);
    if (!normalized) return "Mese";
    const date = new Date(`${normalized}-15T12:00:00Z`);
    const label = monthLabelFormatter.format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function previousMonth(key) {
    const normalized = normalizeMonthKey(key) || currentMonthKey();
    const [year, month] = normalized.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 2, 15, 12));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function storedAccessToken() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return String(parsed?.access_token || parsed?.session?.access_token || parsed?.currentSession?.access_token || "").trim();
    } catch {
      return "";
    }
  }

  function injectStyles() {
    if (byId("staffManagementMonthlyStyles")) return;
    const style = document.createElement("style");
    style.id = "staffManagementMonthlyStyles";
    style.textContent = `
      .management-period-bar{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:15px;border:1px solid var(--line);border-radius:16px;padding:13px 14px;background:#fff;box-shadow:0 6px 20px rgba(16,35,31,.04)}
      .management-period-copy{min-width:0}.management-period-copy strong{display:block;font-size:14px}.management-period-copy small{display:block;margin-top:4px;color:var(--muted);line-height:1.4}
      .management-period-controls{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;justify-content:flex-end}.management-period-controls label{display:grid;gap:4px;color:var(--muted);font-size:10px;font-weight:850}.management-period-controls input{width:165px;min-height:38px;padding:7px 9px}
      .management-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:11px;margin-bottom:15px}.management-grid.six{grid-template-columns:repeat(6,minmax(130px,1fr))}.management-grid.costs{grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
      .management-card{border:1px solid var(--line);border-radius:15px;padding:14px;background:#fff;box-shadow:0 5px 18px rgba(16,35,31,.035)}.management-card.primary{border-color:#cde2da;background:linear-gradient(180deg,#fff,#f8fcfa)}.management-card span{display:block;color:var(--muted);font-size:10px;font-weight:850}.management-card strong{display:block;margin-top:5px;font-size:23px;line-height:1.05;overflow-wrap:anywhere}.management-card.primary strong{color:var(--green-dark)}.management-card small{display:block;margin-top:5px;color:var(--muted);font-size:10px;line-height:1.35}
      .management-delta.positive{color:var(--ok)}.management-delta.negative{color:var(--danger)}.management-delta.neutral{color:var(--muted)}
      .management-section{margin-top:14px}.management-section .panel-head>div>small{display:block;margin-top:3px;line-height:1.35}.management-table{min-width:1120px}.management-table td,.management-table th{white-space:nowrap}.management-table td:first-child,.management-table th:first-child{white-space:normal;min-width:190px}
      .management-status{margin-bottom:13px;border-radius:11px;padding:10px 12px;font-size:12px;line-height:1.45}.management-status.info{color:var(--blue);background:var(--blue-soft)}.management-status.error{color:var(--danger);background:var(--danger-soft)}.management-status.success{color:var(--ok);background:var(--ok-soft)}
      .management-note-list{display:grid;gap:7px;margin:0;padding:0;list-style:none}.management-note-list li{border:1px solid #e2ebe7;border-radius:10px;padding:9px 10px;color:#52635c;background:#fbfdfc;font-size:11px;line-height:1.45}
      .management-inline-badges{display:flex;gap:6px;flex-wrap:wrap}.management-empty{color:var(--muted);font-size:12px}
      @media (max-width:1200px){.management-grid.six{grid-template-columns:repeat(3,minmax(140px,1fr))}}
      @media (max-width:850px){.management-period-bar{align-items:stretch;flex-direction:column}.management-period-controls{justify-content:flex-start}.management-grid,.management-grid.six{grid-template-columns:repeat(2,minmax(130px,1fr))}}
      @media (max-width:520px){.management-grid,.management-grid.six{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function createManagementView() {
    if (byId(VIEW_ID)) return byId(VIEW_ID);
    const main = document.querySelector("#staffApp .main");
    if (!main) return null;
    const section = document.createElement("section");
    section.className = "view";
    section.id = VIEW_ID;
    section.setAttribute("aria-label", "Gestionale mensile");
    section.innerHTML = `
      <div class="view-head">
        <div><span class="control-kicker">Gestionale mensile</span><h2>Analisi mensile</h2><p>Economia, attività, Premium e lavoro Staff nello stesso mese civile. I dati precedenti al punto zero restano archiviati ma non entrano nei conteggi ufficiali.</p></div>
      </div>
      <div class="management-period-bar">
        <div class="management-period-copy"><strong id="managementPeriodTitle">Periodo gestionale</strong><small id="managementPeriodMeta">Seleziona un mese. Tutte le sezioni useranno lo stesso intervallo.</small></div>
        <div class="management-period-controls">
          <button class="button secondary compact" id="managementPreviousMonth" type="button">Mese precedente</button>
          <button class="button secondary compact" id="managementCurrentMonth" type="button">Mese corrente</button>
          <label>Mese<input id="managementMonth" type="month"></label>
          <button class="button primary compact" id="managementRefresh" type="button">Aggiorna</button>
        </div>
      </div>
      <div id="managementStatus" class="management-status info" hidden></div>

      <div class="management-grid" id="managementFinanceKpis"></div>

      <section class="panel management-section">
        <div class="panel-head"><div><h3>Attività del mese</h3><small>Sito e Premium letti nello stesso intervallo gestionale.</small></div></div>
        <div class="panel-body"><div class="management-grid six" id="managementActivityKpis" style="margin-bottom:0"></div></div>
      </section>

      <section class="panel management-section">
        <div class="panel-head"><div><h3>Prodotti e segmenti</h3><small>La struttura include già Premium Business, che resta non attivo finché non verrà attivato nel catalogo gestionale.</small></div></div>
        <div class="table-wrap"><table class="data-table management-table"><thead><tr><th>Prodotto</th><th>PDF / bollette</th><th>Analisi</th><th>Fallite</th><th>Confronti</th><th>Lead</th><th>OTP verificati</th><th>Ricavi confermati</th><th>Costo IA</th><th>Lavoro Staff</th></tr></thead><tbody id="managementSegmentRows"></tbody></table></div>
      </section>

      <section class="panel management-section">
        <div class="panel-head"><div><h3>Economia</h3><small>Costi registrati o calcolati da tariffe versionate; nessuna commissione lead attesa viene trattata come ricavo confermato.</small></div></div>
        <div class="panel-body"><div class="management-grid costs" id="managementCostKpis" style="margin-bottom:0"></div></div>
      </section>

      <section class="panel management-section">
        <div class="panel-head"><div><h3>Premium</h3><small>Attività e pagamenti con timestamp certo nel mese selezionato.</small></div></div>
        <div class="panel-body"><div class="management-grid six" id="managementPremiumKpis" style="margin-bottom:0"></div></div>
      </section>

      <section class="panel management-section">
        <div class="panel-head"><div><h3>Persone e lavoro</h3><small>I collaboratori rimossi restano nello storico e le attività già attribuite non vengono cancellate.</small></div></div>
        <div class="table-wrap"><table class="data-table management-table"><thead><tr><th>Persona</th><th>Ruolo</th><th>Stato</th><th>Operazioni</th><th>Controlli</th><th>Note</th><th>Comunicazioni</th><th>Tempo</th><th>Costo lavoro</th><th>Casa</th><th>Business</th></tr></thead><tbody id="managementPersonnelRows"></tbody></table></div>
      </section>

      <section class="panel management-section">
        <div class="panel-head"><div><h3>Qualità e criteri dei dati</h3><small>Segnalazioni che impediscono di interpretare come certi dati non storicizzabili.</small></div></div>
        <div class="panel-body"><ul class="management-note-list" id="managementQualityNotes"></ul></div>
      </section>
      <div class="version">Gestionale Staff v${RELEASE}</div>
    `;
    main.append(section);
    return section;
  }

  function createManagementTab() {
    if (byId(TAB_ID)) return byId(TAB_ID);
    const nav = document.querySelector("#staffApp .nav");
    if (!nav) return null;
    const group = byId("staffManagementGroup");
    const collaborators = byId("staffCollaboratorsTab");
    const button = document.createElement("button");
    button.type = "button";
    button.id = TAB_ID;
    button.textContent = "Gestionale";
    button.hidden = true;
    if (collaborators?.parentNode === nav) nav.insertBefore(button, collaborators);
    else if (group?.parentNode === nav) group.insertAdjacentElement("afterend", button);
    else nav.append(button);
    return button;
  }

  function setManagementStatus(kind, message) {
    const element = byId("managementStatus");
    if (!element) return;
    element.className = `management-status ${kind || "info"}`;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function closeManagementView(updateHash = false) {
    byId(VIEW_ID)?.classList.remove("active");
    byId(TAB_ID)?.classList.remove("active");
    if (updateHash && location.hash === "#management") history.replaceState(null, "", "#overview");
  }

  function openManagementView() {
    const view = byId(VIEW_ID) || createManagementView();
    const tab = byId(TAB_ID) || createManagementTab();
    if (!view || !tab || tab.hidden) return;
    document.querySelectorAll("[data-staff-view]").forEach(element => element.classList.remove("active"));
    document.querySelectorAll("[data-staff-tab]").forEach(element => element.classList.remove("active"));
    const economics = byId("staffEconomicsView");
    economics?.classList.remove("active");
    byId("staffEconomicsTab")?.classList.remove("active");
    view.classList.add("active");
    tab.classList.add("active");
    history.replaceState(null, "", "#management");
    void refreshManagementReport();
  }

  function syncOwnerVisibility() {
    const group = byId("staffManagementGroup");
    const button = byId(TAB_ID) || createManagementTab();
    if (!button || !group) return;
    const visible = !group.hidden;
    button.hidden = !visible;
    if (!visible) closeManagementView(true);
    if (visible && location.hash === "#management") openManagementView();
  }

  function deltaText(current, previous, formatter = number, suffix = "") {
    const currentValue = Number(current);
    const previousValue = Number(previous);
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return { text: "Mese precedente: —", className: "neutral" };
    const delta = currentValue - previousValue;
    const sign = delta > 0 ? "+" : "";
    const rendered = formatter(Math.abs(delta));
    return {
      text: `vs mese precedente: ${delta < 0 ? "−" : sign}${rendered}${suffix}`,
      className: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
    };
  }

  function card(label, value, meta = "", primary = false) {
    const article = document.createElement("article");
    article.className = `management-card${primary ? " primary" : ""}`;
    const span = document.createElement("span");
    span.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    article.append(span, strong);
    if (meta) {
      const small = document.createElement("small");
      small.textContent = meta;
      article.append(small);
    }
    return article;
  }

  function comparativeCard(label, current, previous, formatter, { primary = false, inverse = false, suffix = "", deltaFormatter = formatter } = {}) {
    const article = card(label, formatter(current), "", primary);
    const delta = deltaText(current, previous, deltaFormatter, suffix);
    const small = document.createElement("small");
    const positive = inverse ? delta.className === "negative" : delta.className === "positive";
    const negative = inverse ? delta.className === "positive" : delta.className === "negative";
    small.className = `management-delta ${positive ? "positive" : negative ? "negative" : "neutral"}`;
    small.textContent = delta.text;
    article.append(small);
    return article;
  }

  function replaceCards(id, cards) {
    const target = byId(id);
    if (!target) return;
    target.replaceChildren(...cards);
  }

  function productMap(snapshot) {
    return Object.fromEntries((Array.isArray(snapshot?.products) ? snapshot.products : []).map(product => [product.product_code, product]));
  }

  function rowCell(value, small = "") {
    const td = document.createElement("td");
    const strong = document.createElement("strong");
    strong.textContent = String(value ?? "—");
    td.append(strong);
    if (small) {
      const detail = document.createElement("small");
      detail.textContent = small;
      td.append(detail);
    }
    return td;
  }

  function renderFinance(snapshot) {
    const current = snapshot.current?.finance || {};
    const previous = snapshot.previous?.finance || {};
    replaceCards("managementFinanceKpis", [
      comparativeCard("Ricavi confermati", current.revenue_confirmed_eur, previous.revenue_confirmed_eur, money, { primary: true }),
      comparativeCard("Costi reali", current.cost_real_eur, previous.cost_real_eur, money, { inverse: true }),
      comparativeCard("Risultato reale", current.result_real_eur, previous.result_real_eur, money, { primary: true }),
      comparativeCard("Margine reale", current.margin_real_pct, previous.margin_real_pct, percent, { suffix: " p.p.", deltaFormatter: value => decimalFormatter.format(numeric(value)) }),
    ]);
  }

  function renderActivity(snapshot) {
    const current = snapshot.current?.totals || {};
    const previous = snapshot.previous?.totals || {};
    replaceCards("managementActivityKpis", [
      comparativeCard("Analisi PDF Sito", snapshot.current?.site?.total?.pdf_analyses_started, snapshot.previous?.site?.total?.pdf_analyses_started, number),
      comparativeCard("Bollette Premium", current.premium_bills, previous.premium_bills, number),
      comparativeCard("Analisi fallite", current.analysis_failures, previous.analysis_failures, number, { inverse: true }),
      comparativeCard("Confronti Sito", current.comparisons, previous.comparisons, number),
      comparativeCard("Lead", current.leads, previous.leads, number),
      comparativeCard("OTP verificati", current.otp_verified, previous.otp_verified, number),
      comparativeCard("Offerte sbloccate", current.offers_unlocked, previous.offers_unlocked, number),
      comparativeCard("Controlli Premium", current.premium_checks, previous.premium_checks, number),
      comparativeCard("Conversione OTP", snapshot.current?.site?.total?.otp_verification_pct, snapshot.previous?.site?.total?.otp_verification_pct, percent, { suffix: " p.p.", deltaFormatter: value => decimalFormatter.format(numeric(value)) }),
      comparativeCard("Lead / confronti", snapshot.current?.site?.total?.lead_per_comparison_pct, snapshot.previous?.site?.total?.lead_per_comparison_pct, percent, { suffix: " p.p.", deltaFormatter: value => decimalFormatter.format(numeric(value)) }),
    ]);
  }

  function renderSegments(snapshot) {
    const target = byId("managementSegmentRows");
    if (!target) return;
    const products = productMap(snapshot);
    const current = snapshot.current || {};
    const site = current.site?.segments || {};
    const siteAi = current.site_ai || {};
    const premium = current.premium_segments || {};

    const definitions = [
      {
        code: "site_free_consumer",
        values: site.consumer || {},
        pdf: numeric(site.consumer?.pdf_documents),
        analyses: numeric(site.consumer?.pdf_analyses_started),
        failed: numeric(siteAi.consumer?.failed),
        comparisons: numeric(site.consumer?.comparisons),
        leads: numeric(site.consumer?.leads),
        otp: numeric(site.consumer?.otp_verified),
        revenue: null,
        aiCost: numeric(siteAi.consumer?.cost_real_eur) + numeric(siteAi.consumer?.cost_estimated_eur),
        work: null,
      },
      {
        code: "site_free_business",
        values: site.business || {},
        pdf: numeric(site.business?.pdf_documents),
        analyses: numeric(site.business?.pdf_analyses_started),
        failed: numeric(siteAi.business?.failed),
        comparisons: numeric(site.business?.comparisons),
        leads: numeric(site.business?.leads),
        otp: numeric(site.business?.otp_verified),
        revenue: null,
        aiCost: numeric(siteAi.business?.cost_real_eur) + numeric(siteAi.business?.cost_estimated_eur),
        work: null,
      },
      {
        code: "premium_casa",
        values: premium.premium_casa || {},
        pdf: numeric(premium.premium_casa?.bills),
        analyses: numeric(premium.premium_casa?.analyses),
        failed: numeric(premium.premium_casa?.analysis_failed),
        comparisons: null,
        leads: null,
        otp: null,
        revenue: numeric(premium.premium_casa?.revenue_confirmed_eur),
        aiCost: numeric(premium.premium_casa?.ai_cost_eur),
        work: numeric(premium.premium_casa?.human_seconds),
      },
      {
        code: "premium_business",
        values: premium.premium_business || {},
        pdf: numeric(premium.premium_business?.bills),
        analyses: numeric(premium.premium_business?.analyses),
        failed: numeric(premium.premium_business?.analysis_failed),
        comparisons: null,
        leads: null,
        otp: null,
        revenue: numeric(premium.premium_business?.revenue_confirmed_eur),
        aiCost: numeric(premium.premium_business?.ai_cost_eur),
        work: numeric(premium.premium_business?.human_seconds),
      },
    ];

    const rows = definitions.map(definition => {
      const product = products[definition.code] || { label: definition.code, enabled: definition.code !== "premium_business" };
      const tr = document.createElement("tr");
      const status = product.enabled ? "Attivo" : "Predisposto · non attivo";
      tr.append(
        rowCell(product.label, status),
        (() => {
          if (!definition.code.startsWith("site_")) return rowCell(number(definition.pdf));
          const unknownCount = numeric(definition.values?.pdf_events_without_document_count);
          return rowCell(unknownCount > 0 ? "—" : number(definition.pdf), unknownCount > 0 ? `${number(definition.pdf)} documenti noti · ${number(unknownCount)} analisi senza conteggio documenti` : "");
        })(),
        rowCell(number(definition.analyses)),
        rowCell(number(definition.failed)),
        rowCell(definition.comparisons === null ? "—" : number(definition.comparisons)),
        rowCell(definition.leads === null ? "—" : number(definition.leads)),
        rowCell(definition.otp === null ? "—" : number(definition.otp)),
        rowCell(definition.revenue === null ? "—" : money(definition.revenue), definition.revenue === null ? "Ricavo lead confermato non storicizzato" : ""),
        rowCell(money(definition.aiCost)),
        rowCell(definition.work === null ? "—" : duration(definition.work)),
      );
      return tr;
    });
    target.replaceChildren(...rows);
  }

  function renderCosts(snapshot) {
    const current = snapshot.current || {};
    const costs = current.cost_breakdown || {};
    const finance = current.finance || {};
    const commercial = current.commercial || {};
    const siteConsumer = numeric(costs.site_ai_consumer_real_eur) + numeric(costs.site_ai_consumer_estimated_eur);
    const siteBusiness = numeric(costs.site_ai_business_real_eur) + numeric(costs.site_ai_business_estimated_eur);
    const sms = numeric(costs.sms_real_eur) + numeric(costs.sms_estimated_eur);
    const stripe = numeric(costs.stripe_real_eur) + numeric(costs.stripe_estimated_eur);
    const infrastructure = numeric(costs.infrastructure_real_eur) + numeric(costs.infrastructure_estimated_eur);
    const other = numeric(costs.legacy_recorded_eur) + numeric(costs.other_ledger_real_eur) + numeric(costs.other_ledger_estimated_eur);
    replaceCards("managementCostKpis", [
      card("IA Premium", money(costs.premium_ai_eur)),
      card("IA Sito · Privati", money(siteConsumer)),
      card("IA Sito · Business", money(siteBusiness)),
      card("SMS", money(sms)),
      card("Stripe", money(stripe), "Commissioni registrate/stimate"),
      card("Infrastruttura", money(infrastructure), "Include quote mensili pro-rata"),
      card("Operatori", money(costs.operator_eur), duration(costs.operator_seconds)),
      card("Altri costi", money(other)),
      card("Costo medio IA / analisi", finance.avg_ai_cost_per_analysis_eur == null ? "—" : money(finance.avg_ai_cost_per_analysis_eur)),
      card("Costo / cliente Premium attivo", finance.premium_cost_per_active_customer_eur == null ? "—" : money(finance.premium_cost_per_active_customer_eur), "Non stimato per utenti Sito anonimi"),
      card("Commissioni lead attese", money(commercial.expected_lead_commission_eur), "Previsione da eventi datati · non ricavo confermato", true),
      card("Movimenti senza prezzo", number(finance.unpriced_count), "Da completare prima della chiusura contabile"),
    ]);
  }

  function renderPremium(snapshot) {
    const current = snapshot.current?.totals || {};
    const previous = snapshot.previous?.totals || {};
    replaceCards("managementPremiumKpis", [
      comparativeCard("Clienti con attività/pagamento", current.premium_customers, previous.premium_customers, number),
      comparativeCard("Nuovi abbonamenti pagati", current.premium_new_paid_subscriptions, previous.premium_new_paid_subscriptions, number),
      comparativeCard("Cancellazioni", current.premium_cancellations, previous.premium_cancellations, number, { inverse: true }),
      comparativeCard("Bollette Premium", current.premium_bills, previous.premium_bills, number),
      comparativeCard("Analisi Premium", snapshot.current?.activity?.premium_analyses, snapshot.previous?.activity?.premium_analyses, number),
      comparativeCard("Controlli Staff", current.premium_checks, previous.premium_checks, number),
    ]);
  }

  function roleLabel(role) {
    return { owner: "Proprietario", admin: "Amministratore", technician: "Tecnico", reviewer: "Revisore" }[String(role || "").toLowerCase()] || "Staff";
  }

  function renderPersonnel(snapshot) {
    const target = byId("managementPersonnelRows");
    if (!target) return;
    const personnel = Array.isArray(snapshot.current?.personnel) ? snapshot.current.personnel : [];
    if (!personnel.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 11;
      td.className = "management-empty";
      td.textContent = "Nessuna persona Staff disponibile nel periodo.";
      tr.append(td);
      target.replaceChildren(tr);
      return;
    }
    const rows = personnel.map(person => {
      const tr = document.createElement("tr");
      const identity = String(person.email || "").trim() || `Account ${String(person.user_id || "").slice(0, 8)}…`;
      tr.append(
        rowCell(identity, person.active ? "Storico conservato" : "Account non attivo · storico conservato"),
        rowCell(roleLabel(person.role)),
        rowCell(person.active ? "Attivo" : "Rimosso / non attivo"),
        rowCell(number(person.operations)),
        rowCell(number(person.checks)),
        rowCell(number(person.notes)),
        rowCell(number(person.communications)),
        rowCell(duration(person.human_seconds)),
        rowCell(money(person.human_cost_eur)),
        rowCell(number(person.premium_casa_checks)),
        rowCell(number(person.premium_business_checks)),
      );
      return tr;
    });
    target.replaceChildren(...rows);
  }

  function renderQuality(snapshot) {
    const target = byId("managementQualityNotes");
    if (!target) return;
    const notes = Array.isArray(snapshot.quality_notes) ? [...snapshot.quality_notes] : [];
    if (snapshot.current?.site?.available === false && snapshot.current?.site?.reason) notes.push(`Dettaglio Customer DB: ${snapshot.current.site.reason}`);
    if (snapshot.current?.baseline_applied) notes.push("Il punto zero cade dentro il mese selezionato: il mese è conteggiato solo dal punto zero in avanti.");
    if (snapshot.previous?.empty) notes.push("Il mese precedente è vuoto rispetto al punto zero; il confronto resta a zero senza cancellare lo storico precedente.");
    const items = (notes.length ? notes : ["Nessuna anomalia di qualità dati rilevata."]).map(note => {
      const li = document.createElement("li");
      li.textContent = note;
      return li;
    });
    target.replaceChildren(...items);
  }

  function renderPeriod(snapshot) {
    const month = snapshot.month || byId("managementMonth")?.value || currentMonthKey();
    const current = snapshot.current || {};
    const previous = snapshot.previous || {};
    const title = byId("managementPeriodTitle");
    const meta = byId("managementPeriodMeta");
    if (title) title.textContent = `${monthLabel(month)} · confronto con ${monthLabel(previousMonth(month))}`;
    if (meta) {
      const effective = current.empty
        ? "Nessun evento ufficiale nel periodo dopo il punto zero."
        : `Intervallo effettivo: ${dateTime(current.effective_from)} → ${dateTime(current.effective_to)}.`;
      const baseline = snapshot.baseline_at ? ` Punto zero: ${dateTime(snapshot.baseline_at)}.` : " Punto zero non ancora impostato.";
      meta.textContent = `${effective}${baseline}`;
    }
  }

  function renderManagement(snapshot) {
    managementSnapshot = snapshot;
    renderPeriod(snapshot);
    renderFinance(snapshot);
    renderActivity(snapshot);
    renderSegments(snapshot);
    renderCosts(snapshot);
    renderPremium(snapshot);
    renderPersonnel(snapshot);
    renderQuality(snapshot);
  }

  async function refreshManagementReport() {
    if (managementLoading) return;
    const view = byId(VIEW_ID);
    if (!view?.classList.contains("active")) return;
    const input = byId("managementMonth");
    const selectedMonth = normalizeMonthKey(input?.value) || currentMonthKey();
    if (input) input.value = selectedMonth;
    const token = storedAccessToken();
    if (!token) {
      setManagementStatus("error", "Sessione Staff non disponibile. Accedi nuovamente.");
      return;
    }

    managementLoading = true;
    const refresh = byId("managementRefresh");
    if (refresh) refresh.disabled = true;
    setManagementStatus("info", `Caricamento gestionale ${monthLabel(selectedMonth)}…`);
    try {
      const response = await fetch(`/api/staff-leads?management=1&month=${encodeURIComponent(selectedMonth)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || `Errore HTTP ${response.status}`);
      renderManagement(payload);
      setManagementStatus("success", `Gestionale aggiornato · ${monthLabel(payload.month)} · dati verificati alle ${dateTime(payload.checkedAt)}.`);
    } catch (error) {
      setManagementStatus("error", String(error?.message || error || "Gestionale mensile non disponibile."));
    } finally {
      managementLoading = false;
      if (refresh) refresh.disabled = false;
    }
  }

  function bindManagementControls() {
    const month = byId("managementMonth");
    if (month) {
      month.value = currentMonthKey();
      month.max = currentMonthKey();
      month.addEventListener("change", () => void refreshManagementReport());
    }
    byId("managementRefresh")?.addEventListener("click", () => void refreshManagementReport());
    byId("managementCurrentMonth")?.addEventListener("click", () => {
      if (month) month.value = currentMonthKey();
      void refreshManagementReport();
    });
    byId("managementPreviousMonth")?.addEventListener("click", () => {
      if (month) month.value = previousMonth(month.value || currentMonthKey());
      void refreshManagementReport();
    });
  }

  function initManagementUi() {
    injectStyles();
    const view = createManagementView();
    const tab = createManagementTab();
    if (!view || !tab) return;
    bindManagementControls();
    tab.addEventListener("click", openManagementView);

    document.querySelector("#staffApp .nav")?.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!button || button === tab) return;
      if (button.matches("[data-staff-tab]") || button.id === "staffEconomicsTab") closeManagementView(false);
    });

    const group = byId("staffManagementGroup");
    if (group) {
      ownerObserver?.disconnect();
      ownerObserver = new MutationObserver(syncOwnerVisibility);
      ownerObserver.observe(group, { attributes: true, attributeFilter: ["hidden"] });
    }
    window.addEventListener("hashchange", () => {
      if (location.hash === "#management") syncOwnerVisibility();
      else closeManagementView(false);
    });
    window.addEventListener("pagehide", () => ownerObserver?.disconnect(), { once: true });
    syncOwnerVisibility();
  }

  const api = Object.freeze({
    release: RELEASE,
    timeZone: TIME_ZONE,
    productCatalog: PRODUCT_CATALOG,
    currentMonthKey,
    normalizeMonthKey,
    monthPeriod,
    normalizeDimensions,
    refreshMonthlyReport: refreshManagementReport,
    snapshot: () => managementSnapshot,
  });

  window.OffertaLogicaStaffManagement = api;
  syncVisibleRelease();
  guardLegacyReleaseNotice();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initManagementUi, { once: true });
  else initManagementUi();
  window.dispatchEvent(new CustomEvent("offertalogica:staff-management-ready", { detail: { release: RELEASE, timeZone: TIME_ZONE } }));
})();
