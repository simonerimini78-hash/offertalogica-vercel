(() => {
  "use strict";

  const RELEASE = "0.36.92";
  if (window.OffertaLogicaStaffManagement?.release === RELEASE) return;

  const TIME_ZONE = "Europe/Rome";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const MONTH_STORAGE_KEY = "offertalogica-staff-management-month";
  const VIEW_STORAGE_KEY = "offertalogica-staff-management-view";
  const VIEW_ID = "staffManagementMonthlyView";
  const TAB_ID = "staffManagementMonthlyTab";
  const PAGE_SIZES = Object.freeze([25, 50, 100]);
  const SUBVIEWS = Object.freeze([
    ["summary", "Riepilogo"],
    ["economy", "Economia"],
    ["commercial", "Commerciale"],
    ["premium", "Premium"],
    ["personnel", "Personale"],
    ["quality", "Qualità dati"],
  ]);
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
  let managementSourceData = null;
  let managementSourceLoading = false;
  let managementSourceOpen = false;
  let managementSourceState = { search: "", type: "all", status: "all", page: 1, pageSize: 25 };
  let ownerObserver = null;
  let currentSubview = storedSubview();
  let personnelState = {
    search: "",
    role: "all",
    status: "all",
    sort: "activity_desc",
    page: 1,
    pageSize: 25,
  };
  let collaboratorPagerInstalled = false;
  let collaboratorApplying = false;
  let collaboratorObserver = null;
  let collaboratorState = {
    search: "",
    role: "all",
    status: "all",
    sort: "email_asc",
    page: 1,
    pageSize: 25,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function currentMonthKey(value = new Date()) {
    const parts = monthFormatter.formatToParts(value);
    const year = parts.find(part => part.type === "year")?.value || "";
    const month = parts.find(part => part.type === "month")?.value || "";
    return /^\d{4}$/.test(year) && /^\d{2}$/.test(month) ? `${year}-${month}` : "";
  }

  function normalizeMonthKey(value) {
    const key = String(value || "").trim();
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? key : "";
  }

  function storedMonth() {
    try {
      const month = normalizeMonthKey(localStorage.getItem(MONTH_STORAGE_KEY));
      return month && month <= currentMonthKey() ? month : currentMonthKey();
    } catch {
      return currentMonthKey();
    }
  }

  function storeMonth(month) {
    try { localStorage.setItem(MONTH_STORAGE_KEY, month); } catch {}
  }

  function storedSubview() {
    try {
      const candidate = String(localStorage.getItem(VIEW_STORAGE_KEY) || "").trim();
      return SUBVIEWS.some(([id]) => id === candidate) ? candidate : "summary";
    } catch {
      return "summary";
    }
  }

  function storeSubview(value) {
    try { localStorage.setItem(VIEW_STORAGE_KEY, value); } catch {}
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
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
    return `${minutes} min`;
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

  function roleLabel(role) {
    return {
      owner: "Proprietario",
      admin: "Amministratore",
      technician: "Tecnico",
      reviewer: "Revisore",
      support: "Supporto",
    }[String(role || "").toLowerCase()] || "Staff";
  }

  function injectStyles() {
    if (byId("staffManagementMonthlyStyles")) byId("staffManagementMonthlyStyles").remove();
    const style = document.createElement("style");
    style.id = "staffManagementMonthlyStyles";
    style.textContent = `
      .management-period-bar{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:12px;border:1px solid var(--line);border-radius:16px;padding:13px 14px;background:#fff;box-shadow:0 6px 20px rgba(16,35,31,.04)}
      .management-period-copy{min-width:0}.management-period-copy strong{display:block;font-size:14px}.management-period-copy small{display:block;margin-top:4px;color:var(--muted);line-height:1.4}
      .management-period-controls{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;justify-content:flex-end}.management-period-controls label{display:grid;gap:4px;color:var(--muted);font-size:10px;font-weight:850}.management-period-controls input{width:165px;min-height:38px;padding:7px 9px}
      .management-subnav{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px;padding:7px;border:1px solid var(--line);border-radius:14px;background:#f8fbf9}
      .management-subnav button{border:0;border-radius:9px;padding:9px 11px;color:#496058;background:transparent;font-size:12px;font-weight:850}
      .management-subnav button:hover,.management-subnav button.active{color:var(--green-dark);background:#fff;box-shadow:0 3px 10px rgba(16,35,31,.06)}
      .management-page{display:none}.management-page.active{display:block}
      .management-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:11px;margin-bottom:14px}.management-grid.six{grid-template-columns:repeat(6,minmax(130px,1fr))}.management-grid.costs{grid-template-columns:repeat(auto-fit,minmax(175px,1fr))}
      .management-card{border:1px solid var(--line);border-radius:15px;padding:14px;background:#fff;box-shadow:0 5px 18px rgba(16,35,31,.035)}.management-card.primary{border-color:#cde2da;background:linear-gradient(180deg,#fff,#f8fcfa)}.management-card.warning{border-color:#fedf89;background:#fffcf2}.management-card.danger{border-color:#fecdca;background:#fff8f7}
      .management-card span{display:block;color:var(--muted);font-size:10px;font-weight:850}.management-card strong{display:block;margin-top:5px;font-size:23px;line-height:1.05;overflow-wrap:anywhere}.management-card.primary strong{color:var(--green-dark)}.management-card small{display:block;margin-top:5px;color:var(--muted);font-size:10px;line-height:1.35}
      .management-delta.positive{color:var(--ok)}.management-delta.negative{color:var(--danger)}.management-delta.neutral{color:var(--muted)}
      .management-section{margin-top:14px}.management-section:first-child{margin-top:0}.management-section .panel-head>div>small{display:block;margin-top:3px;line-height:1.35}
      .management-table{min-width:1060px}.management-table td,.management-table th{white-space:nowrap}.management-table td:first-child,.management-table th:first-child{white-space:normal;min-width:190px}
      .management-status{margin-bottom:13px;border-radius:11px;padding:10px 12px;font-size:12px;line-height:1.45}.management-status.info{color:var(--blue);background:var(--blue-soft)}.management-status.error{color:var(--danger);background:var(--danger-soft)}.management-status.success{color:var(--ok);background:var(--ok-soft)}
      .management-note-list{display:grid;gap:7px;margin:0;padding:0;list-style:none}.management-note-list li{border:1px solid #e2ebe7;border-radius:10px;padding:10px 11px;color:#52635c;background:#fbfdfc;font-size:11px;line-height:1.45}.management-note-list li.actionable{border-color:#fedf89;background:#fffcf2;color:#7a2e0e}
      .management-business-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.management-business-actions .button{min-height:30px;padding:5px 8px;font-size:10px}.management-business-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--muted)}.management-business-toolbar{display:flex;gap:8px;flex-wrap:wrap}.management-business-toolbar .button{min-height:34px}.management-table td small{display:block;margin-top:3px;color:var(--muted);font-size:10px;line-height:1.35}
      .management-empty{color:var(--muted);font-size:12px}.management-toolbar{display:grid;grid-template-columns:minmax(190px,1fr) 155px 155px 175px 105px;gap:8px;padding:12px;border-bottom:1px solid var(--line);background:#fbfdfc}
      .management-toolbar input,.management-toolbar select{min-height:38px;padding:7px 9px;font-size:12px}.management-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;color:var(--muted);font-size:11px;background:#fbfdfc}.management-pagination>div{display:flex;align-items:center;gap:7px}.management-pagination button{min-width:84px}
      .management-signal{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:13px;padding:12px;background:#fff}.management-signal strong{display:block;font-size:12px}.management-signal small{display:block;margin-top:4px;color:var(--muted);line-height:1.4}.management-signal b{font-size:16px;color:var(--green-dark);white-space:nowrap}
      .management-signal-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
      .management-source-panel{margin:0 0 14px}.management-source-toolbar{display:grid;grid-template-columns:minmax(190px,1fr) 190px 170px 105px;gap:8px;padding:12px;border-bottom:1px solid var(--line);background:#fbfdfc}.management-source-toolbar input,.management-source-toolbar select{min-height:38px;padding:7px 9px;font-size:12px}.management-source-table{min-width:1280px}.management-source-table td,.management-source-table th{white-space:nowrap}.management-source-table td:nth-child(3){white-space:normal;min-width:210px}.management-source-table td:nth-child(4){white-space:normal;min-width:260px}.management-source-actions{display:flex;gap:5px;flex-wrap:wrap}.management-source-banner{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px 12px;border-bottom:1px solid var(--line);background:#f7fbf9;color:#52635c;font-size:11px;line-height:1.45}.management-source-banner strong{color:var(--green-dark)}
      .p7-collaborator-toolbar{display:grid;grid-template-columns:minmax(190px,1fr) 150px 150px 165px 105px;gap:8px;padding:12px;border:1px solid var(--line);border-bottom:0;border-radius:12px 12px 0 0;background:#fbfdfc}
      .p7-collaborator-toolbar input,.p7-collaborator-toolbar select{min-height:38px;padding:7px 9px;font-size:12px}
      .p7-collaborator-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line);border-top:0;border-radius:0 0 12px 12px;color:var(--muted);background:#fbfdfc;font-size:11px}.p7-collaborator-pagination>div{display:flex;gap:7px}
      @media (max-width:1200px){.management-grid.six{grid-template-columns:repeat(3,minmax(140px,1fr))}.management-toolbar,.management-source-toolbar,.p7-collaborator-toolbar{grid-template-columns:repeat(2,minmax(150px,1fr))}.management-signal-list{grid-template-columns:1fr}}
      @media (max-width:850px){.management-period-bar{align-items:stretch;flex-direction:column}.management-period-controls{justify-content:flex-start}.management-grid,.management-grid.six{grid-template-columns:repeat(2,minmax(130px,1fr))}}
      @media (max-width:560px){.management-grid,.management-grid.six{grid-template-columns:1fr}.management-toolbar,.management-source-toolbar,.p7-collaborator-toolbar{grid-template-columns:1fr}.management-pagination,.p7-collaborator-pagination{align-items:flex-start;flex-direction:column}}
    `;
    document.head.append(style);
  }

  function createManagementView() {
    const existing = byId(VIEW_ID);
    if (existing) existing.remove();
    const oldTab = byId(TAB_ID);
    if (oldTab) oldTab.remove();

    const main = document.querySelector("#staffApp .main");
    if (!main) return null;

    const section = document.createElement("section");
    section.className = "view";
    section.id = VIEW_ID;
    section.setAttribute("aria-label", "Gestionale mensile");
    section.innerHTML = `
      <div class="view-head">
        <div>
          <span class="control-kicker">Gestionale mensile</span>
          <h2>Gestionale</h2>
          <p>Report ufficiale per mese civile Europe/Rome. Tutte le viste condividono lo stesso periodo, punto zero e fonti dati.</p>
        </div>
        <div class="view-actions">
          <button class="button secondary" id="managementOpenOperational" type="button" hidden>Apri modulo operativo</button>
          <button class="button secondary" id="managementSourceToggle" type="button">Dati sorgente</button>
          <button class="button secondary" id="managementExportCsv" type="button">Esporta CSV</button>
        </div>
      </div>
      <div class="management-period-bar">
        <div class="management-period-copy">
          <strong id="managementPeriodTitle">Periodo gestionale</strong>
          <small id="managementPeriodMeta">Tutte le viste useranno lo stesso intervallo.</small>
        </div>
        <div class="management-period-controls">
          <button class="button secondary compact" id="managementPreviousMonth" type="button">Mese precedente</button>
          <button class="button secondary compact" id="managementCurrentMonth" type="button">Mese corrente</button>
          <label>Mese<input id="managementMonth" type="month"></label>
          <button class="button primary compact" id="managementRefresh" type="button">Aggiorna</button>
        </div>
      </div>
      <nav class="management-subnav" id="managementSubviewNav" aria-label="Sezioni Gestionale">
        ${SUBVIEWS.map(([id, label]) => `<button type="button" data-management-subview="${id}">${label}</button>`).join("")}
      </nav>
      <div id="managementStatus" class="management-status info" hidden></div>
      <section class="panel management-source-panel" id="managementSourcePanel" hidden>
        <div class="panel-head">
          <div><h3>Dati sorgente del mese</h3><small>Record che alimentano il Gestionale. Sono visibili anche prima del punto zero; puoi escluderli dai KPI senza cancellarli.</small></div>
          <button class="button secondary compact" id="managementSourceClose" type="button">Chiudi</button>
        </div>
        <div class="management-source-banner">
          <div><strong>Sito / Lead / Funnel</strong><br>I dati Customer DB restano gestiti nelle pagine operative, dove ogni lead ed evento ha già il pulsante Elimina. Qui sotto sono elencate le sorgenti Premium, economiche e Staff che alimentano direttamente il report mensile.</div>
          <div class="management-source-actions"><button class="button secondary compact" id="managementSourceOpenLeads" type="button">Lead e attivazioni</button><button class="button secondary compact" id="managementSourceOpenAnalytics" type="button">Funnel e traffico</button></div>
        </div>
        <div class="management-source-toolbar">
          <input id="managementSourceSearch" type="search" placeholder="Cerca ID, dettaglio, stato…" aria-label="Cerca dati sorgente">
          <select id="managementSourceType" aria-label="Filtra fonte"><option value="all">Tutte le fonti</option></select>
          <select id="managementSourceStatus" aria-label="Filtra uso"><option value="all">Tutti</option><option value="included">Inclusi nei calcoli</option><option value="excluded">Esclusi</option><option value="prebaseline">Pre-punto-zero</option></select>
          <select id="managementSourcePageSize" aria-label="Righe per pagina"><option>25</option><option>50</option><option>100</option></select>
        </div>
        <div class="table-wrap"><table class="data-table management-source-table">
          <thead><tr><th>Data</th><th>Fonte</th><th>Riferimento</th><th>Dettaglio</th><th>Valore / stato</th><th>Uso ufficiale</th><th>Azioni</th></tr></thead>
          <tbody id="managementSourceRows"><tr><td colspan="7">Apri o aggiorna i dati sorgente.</td></tr></tbody>
        </table></div>
        <div class="management-pagination"><span id="managementSourcePageInfo">0 risultati</span><div><button class="button secondary compact" id="managementSourcePrev" type="button">Precedente</button><button class="button secondary compact" id="managementSourceNext" type="button">Successiva</button></div></div>
      </section>

      <div class="management-page" data-management-page="summary">
        <div class="management-grid" id="managementSummaryFinance"></div>
        <div class="management-grid six" id="managementSummarySignals"></div>
        <section class="panel management-section">
          <div class="panel-head"><div><h3>Segnali del mese</h3><small>Solo indicatori decisionali; i dettagli restano nelle viste dedicate.</small></div></div>
          <div class="panel-body"><div class="management-signal-list" id="managementDecisionSignals"></div></div>
        </section>
      </div>

      <div class="management-page" data-management-page="economy">
        <div class="management-grid" id="managementEconomyFinance"></div>
        <section class="panel management-section">
          <div class="panel-head">
            <div><h3>Punto zero gestionale</h3><small id="managementBaselineMeta">Lo storico resta conservato; il rinnovo cambia solo l'inizio dei conteggi ufficiali.</small></div>
            <div class="management-business-toolbar"><button class="button secondary compact" id="managementResetBaseline" type="button">Rinnova punto zero</button></div>
          </div>
          <div class="panel-body"><div class="management-status info" id="managementBaselineStatus" hidden></div></div>
        </section>
        <section class="panel management-section">
          <div class="panel-head"><div><h3>Costi e componenti economiche</h3><small>Ricavi confermati separati da commissioni attese e movimenti ancora senza prezzo.</small></div></div>
          <div class="panel-body"><div class="management-grid costs" id="managementCostKpis" style="margin-bottom:0"></div></div>
        </section>
      </div>

      <div class="management-page" data-management-page="commercial">
        <div class="management-grid six" id="managementCommercialKpis"></div>
        <section class="panel management-section">
          <div class="panel-head"><div><h3>Privati / Business</h3><small>Funnel commerciale del sito nel mese selezionato, distinto per segmento quando il dato è disponibile.</small></div></div>
          <div class="table-wrap"><table class="data-table management-table">
            <thead><tr><th>Segmento</th><th>Analisi PDF</th><th>Documenti noti</th><th>Confronti</th><th>Lead</th><th>OTP inviati</th><th>OTP verificati</th><th>Offerte sbloccate</th><th>Redirect</th><th>Richieste consulente</th></tr></thead>
            <tbody id="managementCommercialRows"></tbody>
          </table></div>
        </section>
        <section class="panel management-section">
          <div class="panel-head"><div><h3>Destinazione Switcho</h3><small>Tutte le uscite verso Switcho, indipendentemente dal punto del percorso: landing assistita, Business, offerte non attivabili e recupero assistenza.</small></div></div>
          <div class="panel-body"><div class="management-grid" id="managementSwitchoKpis" style="margin-bottom:12px"></div></div>
          <div class="table-wrap"><table class="data-table management-table">
            <thead><tr><th>Data</th><th>Percorso</th><th>Segmento</th><th>Origine</th><th>Offerta / fornitore</th><th>Collegamento</th></tr></thead>
            <tbody id="managementSwitchoRows"></tbody>
          </table></div>
        </section>
        <section class="panel management-section">
          <div class="panel-head">
            <div><h3>Linee di business</h3><small>Verticali commerciali autonome. Visite, analisi, costi e contatti restano attribuiti alla linea che li ha generati.</small></div>
            <div class="management-business-toolbar"><button class="button secondary compact" id="managementAddBusinessLine" type="button">Nuova linea</button></div>
          </div>
          <div class="table-wrap"><table class="data-table management-table">
            <thead><tr><th>Linea</th><th>Stato</th><th>Sessioni</th><th>Visite</th><th>Analisi</th><th>Costo analisi</th><th>Lead</th><th>Contatti verificati</th><th>Monetizzabili</th><th>Conversione</th><th>Commissioni attese</th><th>Azioni</th></tr></thead>
            <tbody id="managementBusinessLineRows"></tbody>
          </table></div>
        </section>
        <section class="panel management-section">
          <div class="panel-head">
            <div><h3>Strumenti e pagine</h3><small>Ogni pagina/calcolatore è uno strumento associabile a una linea. Il catalogo è estensibile senza aggiungere nuove viste al Gestionale.</small></div>
            <div class="management-business-toolbar"><button class="button secondary compact" id="managementAddBusinessTool" type="button">Nuovo strumento</button></div>
          </div>
          <div class="table-wrap"><table class="data-table management-table">
            <thead><tr><th>Strumento</th><th>Linea</th><th>Stato</th><th>Sessioni</th><th>Visite</th><th>Avvii</th><th>Completati</th><th>Analisi</th><th>Costo analisi</th><th>Lead</th><th>Verificati</th><th>CTA</th><th>Errori</th><th>Azioni</th></tr></thead>
            <tbody id="managementToolRows"></tbody>
          </table></div>
          <div class="panel-body"><ul class="management-note-list">
            <li>Fotovoltaico, Fotovoltaico Azienda Agricola e Pompe di calore / climatizzazione usano il tracking nativo. Energia usa gli eventi di funnel già prodotti dal sito pubblico. Speed Test resta esplicitamente segnalato finché non dispone di telemetria.</li>
            <li>I costi mostrati arrivano dal registro economico ufficiale. I movimenti economici non vengono eliminati con i dati lead: restano rettificabili/escludibili secondo le regole contabili.</li>
            <li>“Contatti verificati” indica lead con verifica completata. La qualificazione commerciale finale resta distinta e non viene inventata dal Gestionale.</li>
          </ul></div>
        </section>
      </div>

      <div class="management-page" data-management-page="premium">
        <div class="management-grid six" id="managementPremiumKpis"></div>
        <section class="panel management-section">
          <div class="panel-head"><div><h3>Casa / Business</h3><small>Premium Business resta predisposto ma non viene trattato come attivo finché il catalogo gestionale non lo abilita realmente.</small></div></div>
          <div class="table-wrap"><table class="data-table management-table">
            <thead><tr><th>Prodotto</th><th>Stato</th><th>Bollette</th><th>Analisi</th><th>Fallite</th><th>Ricavi confermati</th><th>Costo IA</th><th>Lavoro Staff</th></tr></thead>
            <tbody id="managementPremiumRows"></tbody>
          </table></div>
        </section>
      </div>

      <div class="management-page" data-management-page="personnel">
        <div class="management-grid" id="managementPersonnelSummary"></div>
        <section class="panel management-section">
          <div class="panel-head"><div><h3>Persone e lavoro</h3><small>Storico conservato anche per collaboratori rimossi. Ricerca, filtri, ordinamento e paginazione evitano liste infinite.</small></div></div>
          <div class="management-toolbar">
            <input id="managementPersonnelSearch" type="search" placeholder="Cerca email o account" aria-label="Cerca personale">
            <select id="managementPersonnelRole" aria-label="Filtra ruolo">
              <option value="all">Tutti i ruoli</option><option value="owner">Proprietario</option><option value="admin">Amministratore</option><option value="technician">Tecnico</option><option value="reviewer">Revisore</option>
            </select>
            <select id="managementPersonnelStatus" aria-label="Filtra stato">
              <option value="all">Tutti gli stati</option><option value="active">Attivi</option><option value="removed">Rimossi / non attivi</option>
            </select>
            <select id="managementPersonnelSort" aria-label="Ordina personale">
              <option value="activity_desc">Più attività</option><option value="cost_desc">Costo lavoro</option><option value="time_desc">Tempo lavoro</option><option value="email_asc">Email A–Z</option><option value="role_asc">Ruolo</option>
            </select>
            <select id="managementPersonnelPageSize" aria-label="Righe per pagina">
              ${PAGE_SIZES.map(size => `<option value="${size}" ${size === 25 ? "selected" : ""}>${size} / pag.</option>`).join("")}
            </select>
          </div>
          <div class="table-wrap"><table class="data-table management-table">
            <thead><tr><th>Persona</th><th>Ruolo</th><th>Stato</th><th>Operazioni</th><th>Controlli</th><th>Note</th><th>Comunicazioni</th><th>Tempo</th><th>Costo lavoro</th><th>Casa</th><th>Business</th><th>Azioni</th></tr></thead>
            <tbody id="managementPersonnelRows"></tbody>
          </table></div>
          <div class="management-pagination">
            <span id="managementPersonnelPageInfo">0 risultati</span>
            <div><button class="button secondary compact" id="managementPersonnelPrev" type="button">Precedente</button><button class="button secondary compact" id="managementPersonnelNext" type="button">Successiva</button></div>
          </div>
        </section>
      </div>

      <div class="management-page" data-management-page="quality">
        <div class="management-grid" id="managementQualityKpis"></div>
        <section class="panel management-section">
          <div class="panel-head"><div><h3>Qualità e criteri dei dati</h3><small>Anomalie e limiti che impediscono di interpretare come certi dati mancanti o non storicizzabili.</small></div></div>
          <div class="panel-body"><ul class="management-note-list" id="managementQualityNotes"></ul></div>
        </section>
      </div>

      <div class="version">Gestionale Staff v${RELEASE}</div>
    `;
    main.append(section);
    createManagementTab();
    selectSubview(currentSubview);
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

  function selectSubview(id) {
    const next = SUBVIEWS.some(([key]) => key === id) ? id : "summary";
    currentSubview = next;
    storeSubview(next);
    document.querySelectorAll("[data-management-page]").forEach(page => page.classList.toggle("active", page.dataset.managementPage === next));
    document.querySelectorAll("[data-management-subview]").forEach(button => button.classList.toggle("active", button.dataset.managementSubview === next));
    syncOperationalButton();
  }

  function setManagementStatus(kind, message) {
    const element = byId("managementStatus");
    if (!element) return;
    element.className = `management-status ${kind || "info"}`;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function deltaDescriptor(current, previous, { inverse = false, format = number, points = false } = {}) {
    const currentValue = Number(current);
    const previousValue = Number(previous);
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return { text: "Mese precedente: —", className: "neutral" };
    const delta = currentValue - previousValue;
    const positiveRaw = delta > 0;
    const negativeRaw = delta < 0;
    const positive = inverse ? negativeRaw : positiveRaw;
    const negative = inverse ? positiveRaw : negativeRaw;
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
    const rendered = points ? decimalFormatter.format(Math.abs(delta)) : format(Math.abs(delta));
    return {
      text: `vs mese precedente: ${sign}${rendered}${points ? " p.p." : ""}`,
      className: positive ? "positive" : negative ? "negative" : "neutral",
    };
  }

  function card(label, value, meta = "", kind = "") {
    const article = document.createElement("article");
    article.className = `management-card${kind ? ` ${kind}` : ""}`;
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

  function comparativeCard(label, current, previous, format, options = {}) {
    const article = card(label, format(current), "", options.kind || "");
    const delta = deltaDescriptor(current, previous, {
      inverse: Boolean(options.inverse),
      format: options.deltaFormat || format,
      points: Boolean(options.points),
    });
    const small = document.createElement("small");
    small.className = `management-delta ${delta.className}`;
    small.textContent = delta.text;
    article.append(small);
    return article;
  }

  function replaceCards(id, cards) {
    const target = byId(id);
    if (target) target.replaceChildren(...cards);
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

  function productMap(snapshot) {
    return Object.fromEntries((Array.isArray(snapshot?.products) ? snapshot.products : []).map(product => [product.product_code, product]));
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
      const baseline = snapshot.baseline_at ? ` Punto zero: ${dateTime(snapshot.baseline_at)}.` : " Punto zero non disponibile.";
      meta.textContent = `${effective}${baseline}`;
    }
  }

  function renderSummary(snapshot) {
    const currentFinance = snapshot.current?.finance || {};
    const previousFinance = snapshot.previous?.finance || {};
    const current = snapshot.current?.totals || {};
    const previous = snapshot.previous?.totals || {};
    const siteCurrent = snapshot.current?.site?.total || {};
    const sitePrevious = snapshot.previous?.site?.total || {};
    const personnel = Array.isArray(snapshot.current?.personnel) ? snapshot.current.personnel : [];
    const activePersonnel = personnel.filter(person => person.active).length;
    const humanSeconds = personnel.reduce((sum, person) => sum + numeric(person.human_seconds), 0);
    const unpriced = numeric(currentFinance.unpriced_count);

    replaceCards("managementSummaryFinance", [
      comparativeCard("Ricavi confermati", currentFinance.revenue_confirmed_eur, previousFinance.revenue_confirmed_eur, money, { kind: "primary" }),
      comparativeCard("Costi reali", currentFinance.cost_real_eur, previousFinance.cost_real_eur, money, { inverse: true }),
      comparativeCard("Risultato reale", currentFinance.result_real_eur, previousFinance.result_real_eur, money, { kind: "primary" }),
      comparativeCard("Margine reale", currentFinance.margin_real_pct, previousFinance.margin_real_pct, percent, { points: true, deltaFormat: value => decimalFormatter.format(numeric(value)) }),
    ]);

    replaceCards("managementSummarySignals", [
      comparativeCard("Lead", current.leads, previous.leads, number),
      comparativeCard("Confronti", current.comparisons, previous.comparisons, number),
      comparativeCard("Conversione OTP", siteCurrent.otp_verification_pct, sitePrevious.otp_verification_pct, percent, { points: true, deltaFormat: value => decimalFormatter.format(numeric(value)) }),
      comparativeCard("Nuovi Premium pagati", current.premium_new_paid_subscriptions, previous.premium_new_paid_subscriptions, number),
      card("Staff attivi nel report", number(activePersonnel), `${duration(humanSeconds)} di lavoro attribuito`),
      card("Anomalie economiche", number(unpriced), unpriced ? "Movimenti senza prezzo da completare" : "Nessun movimento senza prezzo", unpriced ? "warning" : ""),
    ]);

    const signals = [
      ["Commerciale", `${number(current.leads)} lead`, `${number(current.comparisons)} confronti · ${percent(siteCurrent.lead_per_comparison_pct)} lead/confronti`],
      ["Premium", `${number(current.premium_customers)} clienti`, `${number(current.premium_new_paid_subscriptions)} nuovi pagati · ${number(current.premium_cancellations)} cancellazioni`],
      ["Operatività", `${number(current.analyses)} analisi`, `${number(current.analysis_failures)} fallite · ${number(current.premium_checks)} controlli Premium`],
      ["Qualità dati", unpriced ? `${number(unpriced)} da completare` : "Nessuna anomalia economica", `${Array.isArray(snapshot.quality_notes) ? snapshot.quality_notes.length : 0} note metodologiche/qualità`],
    ];
    const target = byId("managementDecisionSignals");
    if (target) {
      target.replaceChildren(...signals.map(([label, value, meta]) => {
        const item = document.createElement("div");
        item.className = "management-signal";
        const copy = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = label;
        const small = document.createElement("small");
        small.textContent = meta;
        copy.append(strong, small);
        const b = document.createElement("b");
        b.textContent = value;
        item.append(copy, b);
        return item;
      }));
    }
  }

  function renderEconomy(snapshot) {
    const current = snapshot.current || {};
    const previous = snapshot.previous || {};
    const finance = current.finance || {};
    const previousFinance = previous.finance || {};
    const costs = current.cost_breakdown || {};
    const commercial = current.commercial || {};
    const siteConsumer = numeric(costs.site_ai_consumer_real_eur) + numeric(costs.site_ai_consumer_estimated_eur);
    const siteBusiness = numeric(costs.site_ai_business_real_eur) + numeric(costs.site_ai_business_estimated_eur);
    const sms = numeric(costs.sms_real_eur) + numeric(costs.sms_estimated_eur);
    const stripe = numeric(costs.stripe_real_eur) + numeric(costs.stripe_estimated_eur);
    const infrastructure = numeric(costs.infrastructure_real_eur) + numeric(costs.infrastructure_estimated_eur);
    const other = numeric(costs.legacy_recorded_eur) + numeric(costs.other_ledger_real_eur) + numeric(costs.other_ledger_estimated_eur);
    const baselineMeta = byId("managementBaselineMeta");
    if (baselineMeta) baselineMeta.textContent = snapshot.baseline_at
      ? `Punto zero attuale: ${dateTime(snapshot.baseline_at)}. Lo storico precedente resta conservato.`
      : "Punto zero non ancora disponibile. Lo storico resta conservato anche dopo il rinnovo.";

    replaceCards("managementEconomyFinance", [
      comparativeCard("Ricavi confermati", finance.revenue_confirmed_eur, previousFinance.revenue_confirmed_eur, money, { kind: "primary" }),
      comparativeCard("Costi reali", finance.cost_real_eur, previousFinance.cost_real_eur, money, { inverse: true }),
      comparativeCard("Risultato reale", finance.result_real_eur, previousFinance.result_real_eur, money, { kind: "primary" }),
      card("Commissioni lead attese", money(commercial.expected_lead_commission_eur), "Eventi datati · non ricavo confermato"),
    ]);

    replaceCards("managementCostKpis", [
      card("IA Premium", money(costs.premium_ai_eur)),
      card("IA Sito · Privati", money(siteConsumer)),
      card("IA Sito · Business", money(siteBusiness)),
      card("SMS", money(sms)),
      card("Stripe", money(stripe), "Commissioni registrate/stimate"),
      card("Infrastruttura", money(infrastructure), "Quote mensili pro-rata"),
      card("Operatori", money(costs.operator_eur), duration(costs.operator_seconds)),
      card("Altri costi", money(other)),
      card("Costo medio IA / analisi", finance.avg_ai_cost_per_analysis_eur == null ? "—" : money(finance.avg_ai_cost_per_analysis_eur)),
      card("Costo / cliente Premium attivo", finance.premium_cost_per_active_customer_eur == null ? "—" : money(finance.premium_cost_per_active_customer_eur)),
      card("Movimenti senza prezzo", number(finance.unpriced_count), numeric(finance.unpriced_count) ? "Da completare prima della chiusura" : "Nessuna anomalia", numeric(finance.unpriced_count) ? "warning" : ""),
    ]);
  }

  function businessStatusLabel(value) {
    return ({ active: "Attiva", paused: "In pausa", archived: "Archiviata", draft: "Bozza" })[String(value || "").toLowerCase()] || "Bozza";
  }

  function businessTelemetryLabel(values = {}) {
    const status = String(values?.telemetry_status || "unknown").trim().toLowerCase();
    if (status === "active") {
      return values?.last_event_at
        ? `Telemetria attiva · ultimo evento ${dateTime(values.last_event_at)}`
        : "Telemetria attiva";
    }
    if (status === "ready") return "Telemetria disponibile · nessun evento nel periodo";
    if (status === "unavailable") return "Telemetria non disponibile dal sito";
    return "Copertura telemetria da verificare";
  }

  function businessCatalog(snapshot = managementSnapshot) {
    return {
      lines: Array.isArray(snapshot?.business_catalog?.lines) ? snapshot.business_catalog.lines : [],
      tools: Array.isArray(snapshot?.business_catalog?.tools) ? snapshot.business_catalog.tools : [],
      fallback: Boolean(snapshot?.business_catalog?.fallback),
    };
  }

  function businessActionCell(actions = []) {
    const td = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "management-business-actions";
    actions.forEach(({ label, action, kind = "secondary", title = "" }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `button ${kind} compact`;
      button.textContent = label;
      if (title) button.title = title;
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void action().catch(error => setManagementStatus("error", String(error?.message || error)));
      });
      wrap.append(button);
    });
    td.append(wrap);
    return td;
  }

  async function managementCatalogRequest(payload) {
    const token = storedAccessToken();
    if (!token) throw new Error("Sessione Staff non disponibile. Accedi nuovamente.");
    const response = await fetch("/api/staff-leads?management=1", {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) throw new Error(result?.error || `Errore HTTP ${response.status}`);
    return result;
  }

  async function managementBusinessDataDelete(scope, code, label) {
    const isLine = scope === "business_line_data";
    const confirmation = isLine ? "ELIMINA_DATI_LINEA" : "ELIMINA_DATI_STRUMENTO";
    const typed = window.prompt(
      `Stai per eliminare definitivamente lead e dati di traffico attribuiti a: ${label || code}.\\n\\nI movimenti economici non verranno cancellati: resteranno nello storico ufficiale.\\n\\nPer continuare digita esattamente: ${confirmation}`,
      "",
    );
    if (typed !== confirmation) return;
    const token = storedAccessToken();
    if (!token) throw new Error("Sessione Staff non disponibile. Accedi nuovamente.");
    const response = await fetch("/api/staff-leads?management=1", {
      method: "DELETE",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-staff-confirmation": confirmation,
      },
      body: JSON.stringify({ scope, code }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) throw new Error(result?.error || `Errore HTTP ${response.status}`);
    setManagementStatus("success", `${label || code}: eliminati ${number(result.deleted_leads)} lead e ${number(result.deleted_standalone_events)} eventi autonomi. I dati economici sono rimasti nello storico.`);
    await refreshManagementReport();
  }

  function normalizedBusinessCode(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  }

  function promptBusinessBoolean(label, currentValue = false) {
    const value = window.prompt(`${label} (true/false)`, currentValue ? "true" : "false");
    if (value == null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!["true", "false"].includes(normalized)) throw new Error("Inserisci true oppure false.");
    return normalized === "true";
  }

  async function editBusinessLine(existing = null) {
    const current = existing || {};
    const label = window.prompt("Nome della linea di business", String(current.label || ""));
    if (label == null || !String(label).trim()) return;
    const code = current.line_code || window.prompt("Codice stabile della linea (minuscolo, numeri e _)", normalizedBusinessCode(label));
    if (!code) return;
    const status = window.prompt("Stato: active, paused, draft oppure archived", String(current.status || "active"));
    if (status == null) return;
    const leadEnabled = promptBusinessBoolean("Questa linea può generare nuovi lead?", Boolean(current.lead_enabled));
    if (leadEnabled == null) return;
    const monetizationEnabled = promptBusinessBoolean("Questa linea può essere monetizzata?", Boolean(current.monetization_enabled));
    if (monetizationEnabled == null) return;
    const sortOrderRaw = window.prompt("Ordine nel Gestionale", String(current.sort_order ?? 100));
    if (sortOrderRaw == null) return;
    const notes = window.prompt("Note Owner (facoltative)", String(current.notes || ""));
    if (notes == null) return;
    await managementCatalogRequest({
      action: "upsert_line",
      line_code: normalizedBusinessCode(code),
      label: String(label).trim(),
      status: String(status || "draft").trim().toLowerCase(),
      lead_enabled: leadEnabled,
      monetization_enabled: monetizationEnabled,
      sort_order: Number(sortOrderRaw || 100),
      notes,
    });
    await refreshManagementReport();
  }

  async function editBusinessTool(existing = null) {
    const current = existing || {};
    const catalog = businessCatalog();
    const label = window.prompt("Nome dello strumento/pagina", String(current.label || ""));
    if (label == null || !String(label).trim()) return;
    const code = current.tool_code || window.prompt("Codice stabile dello strumento (minuscolo, numeri e _)", normalizedBusinessCode(label));
    if (!code) return;
    const lines = catalog.lines.map(line => `${line.line_code} = ${line.label}`).join("\\n");
    const lineCode = window.prompt(`Linea di business (vuoto = strumento tecnico)\\n\\n${lines}`, String(current.business_line_code || ""));
    if (lineCode == null) return;
    const pagePath = window.prompt("Percorso pagina, es. /eolico.html", String(current.page_path || ""));
    if (pagePath == null) return;
    const aliasesRaw = window.prompt("Alias sorgente separati da virgola", Array.isArray(current.source_aliases) ? current.source_aliases.join(", ") : "");
    if (aliasesRaw == null) return;
    const status = window.prompt("Stato: active, paused, draft oppure archived", String(current.status || "active"));
    if (status == null) return;
    const leadEnabled = lineCode.trim() ? promptBusinessBoolean("Questo strumento può generare nuovi lead?", Boolean(current.lead_enabled)) : false;
    if (leadEnabled == null) return;
    const monetizationEnabled = lineCode.trim() ? promptBusinessBoolean("Questo strumento può essere monetizzato?", Boolean(current.monetization_enabled)) : false;
    if (monetizationEnabled == null) return;
    const sortOrderRaw = window.prompt("Ordine nel Gestionale", String(current.sort_order ?? 100));
    if (sortOrderRaw == null) return;
    const notes = window.prompt("Note Owner (facoltative)", String(current.notes || ""));
    if (notes == null) return;
    await managementCatalogRequest({
      action: "upsert_tool",
      tool_code: normalizedBusinessCode(code),
      business_line_code: normalizedBusinessCode(lineCode),
      label: String(label).trim(),
      page_path: String(pagePath).trim(),
      source_aliases: String(aliasesRaw).split(",").map(item => normalizedBusinessCode(item)).filter(Boolean),
      status: String(status || "draft").trim().toLowerCase(),
      lead_enabled: leadEnabled,
      monetization_enabled: monetizationEnabled,
      sort_order: Number(sortOrderRaw || 100),
      notes,
    });
    await refreshManagementReport();
  }

  async function setBusinessLineStatus(line, status) {
    await managementCatalogRequest({ action: "set_line_status", line_code: line.line_code, status });
    await refreshManagementReport();
  }

  async function setBusinessToolStatus(tool, status) {
    await managementCatalogRequest({ action: "set_tool_status", tool_code: tool.tool_code, status });
    await refreshManagementReport();
  }

  async function deleteBusinessLine(line, catalog) {
    const tools = catalog.tools.filter(tool => tool.business_line_code === line.line_code);
    const confirmation = window.prompt(
      `${line.label}: eliminazione definitiva della VOCE catalogo.\\n${tools.length} strumenti collegati. I dati lead/eventi non vengono eliminati da questa operazione.\\n\\nDigita ELIMINA_LINEA_BUSINESS`,
      "",
    );
    if (confirmation !== "ELIMINA_LINEA_BUSINESS") return;
    const deleteTools = tools.length ? window.confirm(`Eliminare dal catalogo anche i ${tools.length} strumenti collegati?`) : false;
    await managementCatalogRequest({ action: "delete_line", line_code: line.line_code, confirmation, delete_tools: deleteTools });
    await refreshManagementReport();
  }

  async function deleteBusinessTool(tool) {
    const confirmation = window.prompt(
      `${tool.label}: eliminazione definitiva della VOCE catalogo. I lead/eventi restano presenti finché non usi “Elimina dati”.\\n\\nDigita ELIMINA_STRUMENTO`,
      "",
    );
    if (confirmation !== "ELIMINA_STRUMENTO") return;
    await managementCatalogRequest({ action: "delete_tool", tool_code: tool.tool_code, confirmation });
    await refreshManagementReport();
  }

  function switchoRouteLabel(value) {
    return ({
      landing_assisted: "Landing assistita",
      business: "Business",
      offer_not_activatable: "Offerta non attivabile online",
      assistance: "Assistenza / utente bloccato",
      other: "Altro percorso",
    })[String(value || "")] || "Altro percorso";
  }

  function switchoSegmentLabel(value) {
    return ({ consumer: "Privato", business: "Business", unknown: "Non classificato" })[String(value || "")] || "Non classificato";
  }

  function renderSwitcho(snapshot) {
    const current = snapshot.current?.site?.switcho || {};
    const previous = snapshot.previous?.site?.switcho || {};
    const routes = current.routes || {};
    const previousRoutes = previous.routes || {};
    replaceCards("managementSwitchoKpis", [
      comparativeCard("Uscite verso Switcho", current.total, previous.total, number, { kind: "primary" }),
      comparativeCard("Sessioni", current.unique_sessions, previous.unique_sessions, number),
      comparativeCard("Lead collegati", current.linked_leads, previous.linked_leads, number),
      card("Ultimo passaggio", current.last_event_at ? dateTime(current.last_event_at) : "—", current.fallback_events ? `${number(current.fallback_events)} eventi compatibili usati come fallback` : "Evento canonico Switcho"),
      comparativeCard("Landing assistita", routes.landing_assisted, previousRoutes.landing_assisted, number),
      comparativeCard("Business", routes.business, previousRoutes.business, number),
      comparativeCard("Offerte non attivabili", routes.offer_not_activatable, previousRoutes.offer_not_activatable, number),
      comparativeCard("Assistenza / blocco", routes.assistance, previousRoutes.assistance, number),
    ]);

    const target = byId("managementSwitchoRows");
    if (!target) return;
    const rows = Array.isArray(current.recent) ? current.recent.slice(0, 20) : [];
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "Nessun passaggio verso Switcho nel periodo selezionato.";
      tr.append(td);
      target.replaceChildren(tr);
      return;
    }
    target.replaceChildren(...rows.map(row => {
      const tr = document.createElement("tr");
      const origin = [row.source, row.data_origin, row.page].filter(Boolean).join(" · ") || "—";
      const offer = [row.offer_name, row.provider].filter(Boolean).join(" · ") || "—";
      const linkState = row.lead_linked ? "Lead collegato" : row.session_present ? "Solo sessione" : "Evento senza sessione";
      tr.append(
        rowCell(dateTime(row.created_at), row.fallback ? "Fallback deduplicato" : "Evento Switcho canonico"),
        rowCell(switchoRouteLabel(row.route)),
        rowCell(switchoSegmentLabel(row.customer_type)),
        rowCell(origin),
        rowCell(offer, row.offer_id || ""),
        rowCell(linkState),
      );
      return tr;
    }));
  }

  function renderCommercial(snapshot) {
    const current = snapshot.current || {};
    const previous = snapshot.previous || {};
    const totals = current.totals || {};
    const previousTotals = previous.totals || {};
    const site = current.site?.total || {};
    const previousSite = previous.site?.total || {};

    replaceCards("managementCommercialKpis", [
      comparativeCard("Confronti", totals.comparisons, previousTotals.comparisons, number),
      comparativeCard("Lead", totals.leads, previousTotals.leads, number, { kind: "primary" }),
      comparativeCard("OTP verificati", totals.otp_verified, previousTotals.otp_verified, number),
      comparativeCard("Offerte sbloccate", totals.offers_unlocked, previousTotals.offers_unlocked, number),
      comparativeCard("Conversione OTP", site.otp_verification_pct, previousSite.otp_verification_pct, percent, { points: true, deltaFormat: value => decimalFormatter.format(numeric(value)) }),
      comparativeCard("Lead / confronti", site.lead_per_comparison_pct, previousSite.lead_per_comparison_pct, percent, { points: true, deltaFormat: value => decimalFormatter.format(numeric(value)) }),
      card("Redirect offerte", number(totals.offer_redirects)),
      card("Richieste consulente", number(totals.consultant_requests)),
      card("Commissioni attese", money(current.commercial?.expected_lead_commission_eur), "Non sono ricavi confermati"),
    ]);

    const target = byId("managementCommercialRows");
    if (!target) return;
    const segments = current.site?.segments || {};
    const definitions = [
      ["consumer", "Privati"],
      ["business", "Business"],
      ["unknown", "Non classificato"],
    ];
    const rows = definitions.map(([key, label]) => {
      const segment = segments[key] || {};
      const missingDocuments = numeric(segment.pdf_events_without_document_count);
      const tr = document.createElement("tr");
      tr.append(
        rowCell(label, key === "unknown" ? "Dati senza segmento determinabile" : ""),
        rowCell(number(segment.pdf_analyses_started)),
        rowCell(missingDocuments ? "—" : number(segment.pdf_documents), missingDocuments ? `${number(segment.pdf_documents)} noti · ${number(missingDocuments)} analisi senza conteggio documenti` : ""),
        rowCell(number(segment.comparisons)),
        rowCell(number(segment.leads)),
        rowCell(number(segment.otp_sent)),
        rowCell(number(segment.otp_verified)),
        rowCell(number(segment.offers_unlocked)),
        rowCell(number(segment.offer_redirects)),
        rowCell(number(segment.consultant_requests)),
      );
      return tr;
    });
    target.replaceChildren(...rows);

    const catalog = businessCatalog(snapshot);
    const lineTarget = byId("managementBusinessLineRows");
    if (lineTarget) {
      const lineItems = current.site?.business_lines?.items || {};
      const lineRows = [...catalog.lines]
        .sort((a, b) => numeric(a.sort_order) - numeric(b.sort_order) || String(a.label || "").localeCompare(String(b.label || ""), "it"))
        .map(line => {
          const code = String(line.line_code || "");
          const values = lineItems[code] || {};
          const tr = document.createElement("tr");
          const lineTools = catalog.tools.filter(tool => tool.business_line_code === code);
          tr.append(
            rowCell(line.label || code, code),
            rowCell(businessStatusLabel(line.status), `${line.lead_enabled ? "Lead attivi" : "Lead disattivati"} · ${line.monetization_enabled ? "Monetizzazione attiva" : "Monetizzazione disattivata"} · ${lineTools.length} strumenti`),
            rowCell(number(values.unique_sessions)),
            rowCell(number(values.views)),
            rowCell(number(values.analyses), numeric(values.analysis_unpriced) ? `${number(values.analysis_unpriced)} senza prezzo` : ""),
            rowCell(money(values.analysis_cost_total_eur), numeric(values.analysis_cost_estimated_eur) ? `${money(values.analysis_cost_real_eur)} reali · ${money(values.analysis_cost_estimated_eur)} stimati` : "Costo registrato"),
            rowCell(number(values.leads)),
            rowCell(number(values.verified_leads), "Verifica completata"),
            rowCell(number(values.monetizable_leads), "Consenso partner disponibile"),
            rowCell(values.lead_conversion_pct == null ? "—" : percent(values.lead_conversion_pct), "Lead / sessioni"),
            rowCell(money(values.expected_commission_eur), "Non ricavo confermato"),
            businessActionCell([
              { label: "Modifica", action: () => editBusinessLine(line) },
              { label: line.status === "active" ? "Pausa" : "Attiva", action: () => setBusinessLineStatus(line, line.status === "active" ? "paused" : "active") },
              { label: "Archivia", action: () => setBusinessLineStatus(line, "archived") },
              { label: "Elimina dati", title: "Elimina lead ed eventi attribuiti, non i movimenti economici", action: () => managementBusinessDataDelete("business_line_data", code, line.label || code) },
              { label: "Elimina voce", action: () => deleteBusinessLine(line, catalog) },
            ]),
          );
          return tr;
        });
      lineTarget.replaceChildren(...lineRows);
    }

    const toolTarget = byId("managementToolRows");
    if (toolTarget) {
      const tools = current.site?.tools?.items || {};
      const lineLabels = Object.fromEntries(catalog.lines.map(line => [line.line_code, line.label]));
      const toolRows = [...catalog.tools]
        .sort((a, b) => numeric(a.sort_order) - numeric(b.sort_order) || String(a.label || "").localeCompare(String(b.label || ""), "it"))
        .map(tool => {
          const code = String(tool.tool_code || "");
          const values = tools[code] || {};
          const isCommercial = Boolean(tool.business_line_code);
          const tr = document.createElement("tr");
          tr.append(
            rowCell(tool.label || code, code),
            rowCell(isCommercial ? (lineLabels[tool.business_line_code] || tool.business_line_code) : "Tecnico", tool.page_path || ""),
            rowCell(
              businessStatusLabel(tool.status),
              `${tool.lead_enabled ? "Lead sì" : "Lead no"} · ${tool.monetization_enabled ? "Monetizzazione sì" : "Monetizzazione no"} · ${businessTelemetryLabel(values)}`,
            ),
            rowCell(number(values.unique_sessions)),
            rowCell(number(values.views)),
            rowCell(number(values.started)),
            rowCell(number(values.completed), values.completion_pct == null ? "" : `${percent(values.completion_pct)} completamento`),
            rowCell(number(values.analyses), numeric(values.analysis_unpriced) ? `${number(values.analysis_unpriced)} senza prezzo` : ""),
            rowCell(money(values.analysis_cost_total_eur), numeric(values.analysis_cost_estimated_eur) ? `${money(values.analysis_cost_real_eur)} reali · ${money(values.analysis_cost_estimated_eur)} stimati` : ""),
            rowCell(number(values.leads)),
            rowCell(number(values.verified_leads)),
            rowCell(number(values.cta_clicks)),
            rowCell(number(values.errors)),
            businessActionCell([
              { label: "Modifica", action: () => editBusinessTool(tool) },
              { label: tool.status === "active" ? "Pausa" : "Attiva", action: () => setBusinessToolStatus(tool, tool.status === "active" ? "paused" : "active") },
              { label: "Archivia", action: () => setBusinessToolStatus(tool, "archived") },
              ...(isCommercial ? [{ label: "Elimina dati", title: "Elimina lead ed eventi attribuiti, non i movimenti economici", action: () => managementBusinessDataDelete("business_tool_data", code, tool.label || code) }] : []),
              { label: "Elimina voce", action: () => deleteBusinessTool(tool) },
            ]),
          );
          return tr;
        });
      toolTarget.replaceChildren(...toolRows);
    }

    renderSwitcho(snapshot);
  }

  function renderPremium(snapshot) {
    const current = snapshot.current || {};
    const previous = snapshot.previous || {};
    const totals = current.totals || {};
    const previousTotals = previous.totals || {};
    replaceCards("managementPremiumKpis", [
      comparativeCard("Clienti con attività/pagamento", totals.premium_customers, previousTotals.premium_customers, number),
      comparativeCard("Nuovi abbonamenti pagati", totals.premium_new_paid_subscriptions, previousTotals.premium_new_paid_subscriptions, number, { kind: "primary" }),
      comparativeCard("Cancellazioni", totals.premium_cancellations, previousTotals.premium_cancellations, number, { inverse: true }),
      comparativeCard("Bollette", totals.premium_bills, previousTotals.premium_bills, number),
      comparativeCard("Analisi", current.activity?.premium_analyses, previous.activity?.premium_analyses, number),
      comparativeCard("Controlli Staff", totals.premium_checks, previousTotals.premium_checks, number),
    ]);

    const target = byId("managementPremiumRows");
    if (!target) return;
    const products = productMap(snapshot);
    const segments = current.premium_segments || {};
    const definitions = [
      ["premium_casa", "Premium Casa"],
      ["premium_business", "Premium Business"],
    ];
    const rows = definitions.map(([code, fallbackLabel]) => {
      const product = products[code] || { label: fallbackLabel, enabled: code !== "premium_business" };
      const values = segments[code] || {};
      const enabled = Boolean(product.enabled);
      const tr = document.createElement("tr");
      tr.append(
        rowCell(product.label || fallbackLabel),
        rowCell(enabled ? "Attivo" : "Predisposto · non attivo"),
        rowCell(number(values.bills)),
        rowCell(number(values.analyses)),
        rowCell(number(values.analysis_failed)),
        rowCell(enabled ? money(values.revenue_confirmed_eur) : money(0)),
        rowCell(enabled ? money(values.ai_cost_eur) : money(0)),
        rowCell(enabled ? duration(values.human_seconds) : duration(0)),
      );
      return tr;
    });
    target.replaceChildren(...rows);
  }

  function personnelFilteredRows(snapshot) {
    const raw = Array.isArray(snapshot.current?.personnel) ? [...snapshot.current.personnel] : [];
    const search = personnelState.search.trim().toLowerCase();
    const filtered = raw.filter(person => {
      const role = String(person.role || "").toLowerCase();
      const active = Boolean(person.active);
      const identity = `${person.email || ""} ${person.user_id || ""}`.toLowerCase();
      if (search && !identity.includes(search)) return false;
      if (personnelState.role !== "all" && role !== personnelState.role) return false;
      if (personnelState.status === "active" && !active) return false;
      if (personnelState.status === "removed" && active) return false;
      return true;
    });
    const activity = person => numeric(person.operations) + numeric(person.checks) + numeric(person.notes) + numeric(person.communications);
    filtered.sort((a, b) => {
      if (personnelState.sort === "email_asc") return String(a.email || a.user_id || "").localeCompare(String(b.email || b.user_id || ""), "it", { sensitivity: "base" });
      if (personnelState.sort === "role_asc") return roleLabel(a.role).localeCompare(roleLabel(b.role), "it", { sensitivity: "base" });
      if (personnelState.sort === "cost_desc") return numeric(b.human_cost_eur) - numeric(a.human_cost_eur);
      if (personnelState.sort === "time_desc") return numeric(b.human_seconds) - numeric(a.human_seconds);
      return activity(b) - activity(a);
    });
    return filtered;
  }

  function operationalRoute(view = currentSubview) {
    return {
      economy: { label: "Apri Contabilità e tariffe", selector: "#staffEconomicsTab" },
      commercial: { label: "Apri Lead e attivazioni", selector: '[data-staff-tab="leads"]' },
      premium: { label: "Apri Clienti e utenze", selector: '[data-staff-tab="customers"]' },
      personnel: { label: "Apri Collaboratori", selector: "#staffCollaboratorsTab" },
    }[view] || null;
  }

  function syncOperationalButton() {
    const button = byId("managementOpenOperational");
    if (!button) return;
    const route = operationalRoute();
    button.hidden = !route;
    if (route) button.textContent = route.label;
  }

  function openOperationalModule() {
    const route = operationalRoute();
    if (!route) return;
    byId("managementStatus")?.setAttribute("hidden", "");
    document.querySelector(route.selector)?.click();
  }

  async function runPersonnelOwnerAction(person, action) {
    const bridge = window.OffertaLogicaStaffCollaboratorActions;
    if (!bridge || typeof bridge[action] !== "function") {
      setManagementStatus("error", "Gestione Collaboratori non disponibile. Apri il modulo Collaboratori e riprova.");
      return;
    }
    const userId = String(person?.user_id || "").trim();
    if (!userId) {
      setManagementStatus("error", "Identificativo collaboratore non disponibile nel report.");
      return;
    }
    const ok = await bridge[action](userId);
    if (ok) await refreshManagementReport();
  }

  function focusPersonnelOwnerAction(person) {
    const bridge = window.OffertaLogicaStaffCollaboratorActions;
    if (!bridge?.focus) {
      document.querySelector("#staffCollaboratorsTab")?.click();
      return;
    }
    bridge.focus({ userId: person?.user_id, email: person?.email });
  }

  function personnelActionCell(person) {
    const td = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const manage = document.createElement("button");
    manage.type = "button";
    manage.className = "button secondary compact";
    manage.textContent = "Gestisci";
    manage.addEventListener("click", () => focusPersonnelOwnerAction(person));
    actions.append(manage);

    const role = String(person?.role || "").toLowerCase();
    if (role === "owner") {
      const protectedBadge = document.createElement("span");
      protectedBadge.className = "badge ok";
      protectedBadge.textContent = "Protetto";
      actions.append(protectedBadge);
    } else if (!person?.active) {
      if (person?.removed_at) {
        const restore = document.createElement("button");
        restore.type = "button";
        restore.className = "button primary compact";
        restore.textContent = "Ripristina";
        restore.addEventListener("click", () => void runPersonnelOwnerAction(person, "restore"));
        actions.append(restore);
      }
      const purge = document.createElement("button");
      purge.type = "button";
      purge.className = "button danger compact";
      purge.textContent = "Elimina definitivamente";
      purge.title = "Il database consente l’eliminazione solo se il collaboratore è già rimosso e senza attività storica reale";
      purge.addEventListener("click", () => void runPersonnelOwnerAction(person, "purge"));
      actions.append(purge);
    } else if (person?.active) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button danger compact";
      remove.textContent = "Rimuovi";
      remove.title = "Rimuove l’accesso Staff conservando lo storico";
      remove.addEventListener("click", () => void runPersonnelOwnerAction(person, "remove"));
      actions.append(remove);
    }
    td.append(actions);
    return td;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadCsv(filename, rows) {
    const content = "\ufeff" + rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportRowsForCurrentView(snapshot) {
    const current = snapshot?.current || {};
    if (currentSubview === "personnel") {
      const rows = Array.isArray(current.personnel) ? current.personnel : [];
      return [["Persona", "User ID", "Ruolo", "Attivo", "Operazioni", "Controlli", "Note", "Comunicazioni", "Secondi lavoro", "Costo lavoro EUR", "Casa", "Business"], ...rows.map(person => [
        person.email || "", person.user_id || "", roleLabel(person.role), person.active ? "sì" : "no", numeric(person.operations), numeric(person.checks), numeric(person.notes), numeric(person.communications), numeric(person.human_seconds), numeric(person.human_cost_eur), numeric(person.premium_casa_checks), numeric(person.premium_business_checks),
      ])];
    }
    if (currentSubview === "commercial") {
      const segments = current.site?.segments || {};
      const catalog = businessCatalog(snapshot);
      const lines = current.site?.business_lines?.items || {};
      const tools = current.site?.tools?.items || {};
      const rows = [
        ["SEZIONE SEGMENTI"],
        ["Segmento", "Analisi PDF", "Documenti noti", "Analisi senza conteggio documenti", "Confronti", "Lead", "OTP inviati", "OTP verificati", "Offerte sbloccate", "Redirect", "Richieste consulente"],
        ...[["consumer","Privati"],["business","Business"],["unknown","Non classificato"]].map(([key,label]) => {
          const x=segments[key] || {};
          return [label,numeric(x.pdf_analyses_started),numeric(x.pdf_documents),numeric(x.pdf_events_without_document_count),numeric(x.comparisons),numeric(x.leads),numeric(x.otp_sent),numeric(x.otp_verified),numeric(x.offers_unlocked),numeric(x.offer_redirects),numeric(x.consultant_requests)];
        }),
        [],
        ["SEZIONE LINEE BUSINESS"],
        ["Linea", "Codice", "Stato", "Sessioni", "Visite", "Analisi", "Costo analisi EUR", "Lead", "Contatti verificati", "Monetizzabili", "Conversione %", "Commissioni attese EUR"],
        ...catalog.lines.map(line => {
          const x=lines[line.line_code] || {};
          return [line.label,line.line_code,line.status,numeric(x.unique_sessions),numeric(x.views),numeric(x.analyses),numeric(x.analysis_cost_total_eur),numeric(x.leads),numeric(x.verified_leads),numeric(x.monetizable_leads),x.lead_conversion_pct == null ? "" : numeric(x.lead_conversion_pct),numeric(x.expected_commission_eur)];
        }),
        [],
        ["SEZIONE STRUMENTI"],
        ["Strumento", "Codice", "Linea", "Stato", "Sessioni", "Visite", "Avvii", "Completati", "Analisi", "Costo analisi EUR", "Lead", "Contatti verificati", "CTA", "Errori"],
        ...catalog.tools.map(tool => {
          const x=tools[tool.tool_code] || {};
          return [tool.label,tool.tool_code,tool.business_line_code || "",tool.status,numeric(x.unique_sessions),numeric(x.views),numeric(x.started),numeric(x.completed),numeric(x.analyses),numeric(x.analysis_cost_total_eur),numeric(x.leads),numeric(x.verified_leads),numeric(x.cta_clicks),numeric(x.errors)];
        }),
      ];
      return rows;
    }
    if (currentSubview === "premium") {
      const products = productMap(snapshot);
      const segments = current.premium_segments || {};
      return [["Prodotto", "Stato", "Bollette", "Analisi", "Fallite", "Ricavi confermati EUR", "Costo IA EUR", "Secondi lavoro Staff"], ...[["premium_casa","Premium Casa"],["premium_business","Premium Business"]].map(([code,label]) => {
        const product=products[code] || {label,enabled:code!=="premium_business"}; const x=segments[code] || {}; const enabled=Boolean(product.enabled);
        return [product.label || label,enabled?"attivo":"predisposto non attivo",numeric(x.bills),numeric(x.analyses),numeric(x.analysis_failed),enabled?numeric(x.revenue_confirmed_eur):0,enabled?numeric(x.ai_cost_eur):0,enabled?numeric(x.human_seconds):0];
      })];
    }
    if (currentSubview === "economy") {
      const f=current.finance || {}; const c=current.cost_breakdown || {}; const commercial=current.commercial || {};
      return [["Voce","Valore"],["Ricavi confermati EUR",numeric(f.revenue_confirmed_eur)],["Costi reali EUR",numeric(f.cost_real_eur)],["Risultato reale EUR",numeric(f.result_real_eur)],["Margine reale %",numeric(f.margin_real_pct)],["Commissioni lead attese EUR",numeric(commercial.expected_lead_commission_eur)],["Costo IA Premium EUR",numeric(c.premium_ai_eur)],["Costo operatori EUR",numeric(c.operator_eur)],["Secondi operatori",numeric(c.operator_seconds)],["Movimenti senza prezzo",numeric(f.unpriced_count)]];
    }
    if (currentSubview === "quality") {
      const f=current.finance || {}; const site=current.site || {}; const ai=current.site_ai || {}; const business=site.business_lines || {};
      const notes=Array.isArray(snapshot.quality_notes)?snapshot.quality_notes:[];
      return [["Voce","Valore"],["Catalogo Business",snapshot?.business_catalog?.fallback?"fallback":"persistente"],["Movimenti senza prezzo",numeric(f.unpriced_count)],["Analisi PDF senza conteggio documenti",numeric(site.total?.pdf_events_without_document_count)],["Eventi+lead sito non classificati",numeric(site.segments?.unknown?.events)+numeric(site.segments?.unknown?.leads)],["Run+fallimenti IA sito non classificati",numeric(ai.unknown?.runs)+numeric(ai.unknown?.failed)],["Lead business non attribuiti",numeric(business.unattributed_leads)],["Costi IA business non attribuiti",numeric(business.unattributed_economic_entries)],["Traffico tool filtrato",numeric(business.filtered_traffic)],...notes.map(note=>["Nota qualità",note])];
    }
    const f=current.finance || {}; const t=current.totals || {}; const site=current.site?.total || {}; const personnel=Array.isArray(current.personnel)?current.personnel:[];
    return [["Voce","Valore"],["Ricavi confermati EUR",numeric(f.revenue_confirmed_eur)],["Costi reali EUR",numeric(f.cost_real_eur)],["Risultato reale EUR",numeric(f.result_real_eur)],["Margine reale %",numeric(f.margin_real_pct)],["Lead",numeric(t.leads)],["Confronti",numeric(t.comparisons)],["Conversione OTP %",numeric(site.otp_verification_pct)],["Nuovi Premium pagati",numeric(t.premium_new_paid_subscriptions)],["Staff nel periodo",personnel.length],["Movimenti senza prezzo",numeric(f.unpriced_count)]];
  }

  async function exportCurrentManagementView() {
    if (!managementSnapshot) {
      setManagementStatus("error", "Carica prima il Gestionale.");
      return;
    }
    const month = managementSnapshot.month || byId("managementMonth")?.value || currentMonthKey();
    const rows = exportRowsForCurrentView(managementSnapshot);
    try {
      const audit = window.OffertaLogicaStaffAudit;
      if (!audit?.recordExport) throw new Error("Audit Staff non disponibile");
      await audit.recordExport("management", { targetId: `${month}:${currentSubview}`, metadata: { month, view: currentSubview, rows: Math.max(0, rows.length - 1) } });
      downloadCsv(`offertalogica-gestionale-${month}-${currentSubview}.csv`, rows);
      setManagementStatus("success", "CSV esportato e operazione registrata nell’Audit.");
    } catch (error) {
      setManagementStatus("error", `Esportazione bloccata: ${String(error?.message || error || "Audit non disponibile")}`);
    }
  }

  function renderPersonnel(snapshot) {
    const personnel = Array.isArray(snapshot.current?.personnel) ? snapshot.current.personnel : [];
    const active = personnel.filter(person => person.active).length;
    const removed = personnel.length - active;
    const seconds = personnel.reduce((sum, person) => sum + numeric(person.human_seconds), 0);
    const cost = personnel.reduce((sum, person) => sum + numeric(person.human_cost_eur), 0);
    replaceCards("managementPersonnelSummary", [
      card("Persone nel periodo", number(personnel.length)),
      card("Attive", number(active)),
      card("Rimosse / non attive", number(removed), "Storico conservato"),
      card("Tempo / costo lavoro", `${duration(seconds)} · ${money(cost)}`),
    ]);

    const rows = personnelFilteredRows(snapshot);
    const totalPages = Math.max(1, Math.ceil(rows.length / personnelState.pageSize));
    personnelState.page = Math.max(1, Math.min(personnelState.page, totalPages));
    const from = (personnelState.page - 1) * personnelState.pageSize;
    const pageRows = rows.slice(from, from + personnelState.pageSize);
    const target = byId("managementPersonnelRows");
    if (target) {
      if (!pageRows.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 12;
        td.className = "management-empty";
        td.textContent = personnel.length ? "Nessuna persona corrisponde ai filtri." : "Nessuna persona Staff disponibile nel periodo.";
        tr.append(td);
        target.replaceChildren(tr);
      } else {
        target.replaceChildren(...pageRows.map(person => {
          const tr = document.createElement("tr");
          const identity = String(person.email || "").trim() || `Account ${String(person.user_id || "").slice(0, 8)}…`;
          tr.append(
            rowCell(identity, person.active ? "Storico attribuito" : "Account non attivo · storico conservato"),
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
            personnelActionCell(person),
          );
          return tr;
        }));
      }
    }
    const info = byId("managementPersonnelPageInfo");
    if (info) {
      const start = rows.length ? from + 1 : 0;
      const end = Math.min(from + personnelState.pageSize, rows.length);
      info.textContent = `${number(rows.length)} risultati · ${number(start)}–${number(end)} · pagina ${personnelState.page}/${totalPages}`;
    }
    const prev = byId("managementPersonnelPrev");
    const next = byId("managementPersonnelNext");
    if (prev) prev.disabled = personnelState.page <= 1;
    if (next) next.disabled = personnelState.page >= totalPages;
  }

  function renderQuality(snapshot) {
    const current = snapshot.current || {};
    const finance = current.finance || {};
    const site = current.site || {};
    const siteAi = current.site_ai || {};
    const missingDocs = numeric(site.total?.pdf_events_without_document_count);
    const unknownSite = numeric(site.segments?.unknown?.events) + numeric(site.segments?.unknown?.leads);
    const unknownAi = numeric(siteAi.unknown?.runs) + numeric(siteAi.unknown?.failed);
    const unpriced = numeric(finance.unpriced_count);
    const business = site.business_lines || {};
    const unattributedLeads = numeric(business.unattributed_leads);
    const unattributedCosts = numeric(business.unattributed_economic_entries);
    const filteredTraffic = numeric(business.filtered_traffic);
    const catalogFallback = Boolean(snapshot?.business_catalog?.fallback);
    replaceCards("managementQualityKpis", [
      card("Catalogo Business", catalogFallback ? "Fallback" : "Persistente", catalogFallback ? "Cancellazioni dati bloccate" : "RPC P12 disponibile", catalogFallback ? "warning" : ""),
      card("Lead business non attribuiti", number(unattributedLeads), unattributedLeads ? "Fuori dai KPI verticali" : "Nessuno", unattributedLeads ? "warning" : ""),
      card("Costi IA non attribuiti", number(unattributedCosts), unattributedCosts ? "Nessuna ripartizione stimata" : "Nessuno", unattributedCosts ? "warning" : ""),
      card("Traffico tool filtrato", number(filteredTraffic), filteredTraffic ? "Bot/automazioni esclusi" : "Nessuno", ""),
      card("Movimenti senza prezzo", number(unpriced), unpriced ? "Richiede completamento" : "Nessuno", unpriced ? "warning" : ""),
      card("Analisi PDF senza n. documenti", number(missingDocs), missingDocs ? "Il gestionale non inventa il conteggio" : "Nessuna", missingDocs ? "warning" : ""),
      card("Sito non classificato", number(unknownSite), unknownSite ? "Eventi/lead senza segmento" : "Nessuno", unknownSite ? "warning" : ""),
      card("IA Sito non classificata", number(unknownAi), unknownAi ? "Mapping da verificare" : "Nessuna", unknownAi ? "warning" : ""),
    ]);

    const notes = Array.isArray(snapshot.quality_notes) ? [...snapshot.quality_notes] : [];
    if (site.available === false && site.reason) notes.push(`Dettaglio Customer DB: ${site.reason}`);
    if (current.baseline_applied) notes.push("Il punto zero cade dentro il mese selezionato: il mese è conteggiato solo dal punto zero in avanti.");
    if (snapshot.previous?.empty) notes.push("Il mese precedente è vuoto rispetto al punto zero; il confronto resta a zero senza cancellare lo storico precedente.");
    if (unpriced) notes.unshift(`${number(unpriced)} movimenti economici non hanno ancora un prezzo utilizzabile.`);
    const target = byId("managementQualityNotes");
    if (target) {
      const unique = [...new Set(notes.filter(Boolean))];
      const rendered = unique.length ? unique : ["Nessuna anomalia di qualità dati rilevata."];
      target.replaceChildren(...rendered.map(note => {
        const li = document.createElement("li");
        li.textContent = note;
        if (/senza prezzo|non hanno|non disponibile|non classific|senza conteggio|anomalia/i.test(note)) li.classList.add("actionable");
        return li;
      }));
    }
  }

  const MANAGEMENT_SOURCE_LABELS = Object.freeze({
    premium_bill: "Bolletta Premium",
    premium_analysis_run: "Analisi IA Premium",
    premium_check: "Verifica Premium",
    economic_entry: "Movimento economico",
    payment_event: "Evento pagamento",
    cost_event: "Costo tecnico",
    check_note: "Nota Staff",
    communication: "Comunicazione Staff",
    economic_rate_version: "Tariffa / ricorrente",
  });

  function sourceRoute(sourceType) {
    if (sourceType === "premium_bill") return "customers";
    if (sourceType === "premium_check" || sourceType === "check_note") return "checks";
    if (sourceType === "communication") return "cases";
    if (sourceType === "premium_analysis_run" || sourceType === "cost_event") return "costs";
    if (["economic_entry", "payment_event", "economic_rate_version"].includes(sourceType)) return "economics";
    return "overview";
  }

  function openSourceOperational(sourceType) {
    const route = sourceRoute(sourceType);
    managementSourceOpen = false;
    byId("managementSourcePanel")?.setAttribute("hidden", "");
    if (route === "economics") byId("staffEconomicsTab")?.click();
    else document.querySelector(`[data-staff-tab="${route}"]`)?.click();
  }

  function sourceSearchText(row) {
    return [row.source_type, row.source_label, row.source_id, row.reference, row.detail, row.status, row.exclusion_reason]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function filteredSourceRows() {
    const rows = Array.isArray(managementSourceData?.rows) ? managementSourceData.rows : [];
    const search = managementSourceState.search.trim().toLowerCase();
    return rows.filter(row => {
      if (search && !sourceSearchText(row).includes(search)) return false;
      if (managementSourceState.type !== "all" && row.source_type !== managementSourceState.type) return false;
      if (managementSourceState.status === "included" && (row.excluded || !row.official_eligible)) return false;
      if (managementSourceState.status === "excluded" && !row.excluded) return false;
      if (managementSourceState.status === "prebaseline" && row.official_eligible) return false;
      return true;
    });
  }

  function syncSourceTypeOptions() {
    const select = byId("managementSourceType");
    if (!select) return;
    const current = managementSourceState.type;
    const types = [...new Set((managementSourceData?.rows || []).map(row => row.source_type).filter(Boolean))].sort();
    select.replaceChildren(new Option("Tutte le fonti", "all"), ...types.map(type => new Option(MANAGEMENT_SOURCE_LABELS[type] || type, type)));
    select.value = types.includes(current) ? current : "all";
    managementSourceState.type = select.value;
  }

  function renderManagementSources() {
    syncSourceTypeOptions();
    const rows = filteredSourceRows();
    const totalPages = Math.max(1, Math.ceil(rows.length / managementSourceState.pageSize));
    managementSourceState.page = Math.max(1, Math.min(managementSourceState.page, totalPages));
    const from = (managementSourceState.page - 1) * managementSourceState.pageSize;
    const pageRows = rows.slice(from, from + managementSourceState.pageSize);
    const target = byId("managementSourceRows");
    if (target) {
      if (!pageRows.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td"); td.colSpan = 7; td.textContent = managementSourceLoading ? "Caricamento dati sorgente…" : "Nessun dato sorgente corrisponde ai filtri."; tr.append(td); target.replaceChildren(tr);
      } else {
        target.replaceChildren(...pageRows.map(row => {
          const tr = document.createElement("tr");
          const amount = row.amount_eur == null ? "" : money(row.amount_eur);
          const state = row.excluded ? "Escluso dai KPI" : row.official_eligible ? "Incluso" : "Pre-punto-zero";
          const detail = [row.detail, row.exclusion_reason ? `Motivo esclusione: ${row.exclusion_reason}` : ""].filter(Boolean).join(" · ");
          const actions = document.createElement("div"); actions.className = "management-source-actions";
          const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = `button ${row.excluded ? "primary" : "secondary"} compact`; toggle.textContent = row.excluded ? "Riattiva" : "Escludi dai calcoli";
          toggle.addEventListener("click", async () => {
            const api = window.OffertaLogicaStaffDataControl;
            if (!api) return setManagementStatus("error", "Controllo dati Owner non disponibile. Aggiorna la pagina.");
            const label = row.reference || row.source_id;
            const ok = row.excluded ? await api.restore(row.source_type, row.source_id, label) : await api.exclude(row.source_type, row.source_id, label);
            if (ok) { await refreshManagementSources(); await refreshManagementReport(); }
          });
          const open = document.createElement("button"); open.type = "button"; open.className = "button secondary compact"; open.textContent = "Apri modulo"; open.addEventListener("click", () => openSourceOperational(row.source_type));
          actions.append(toggle, open);
          tr.append(
            rowCell(dateTime(row.event_at)),
            rowCell(MANAGEMENT_SOURCE_LABELS[row.source_type] || row.source_label || row.source_type),
            rowCell(row.reference || row.source_id, row.source_id),
            rowCell(detail || "—"),
            rowCell([amount, row.status].filter(Boolean).join(" · ") || "—"),
            rowCell(state, row.excluded ? "Il record resta conservato" : row.official_eligible ? "Contribuisce al Gestionale" : "Visibile, ma fuori dai conteggi ufficiali"),
            (() => { const td=document.createElement("td"); td.append(actions); return td; })(),
          );
          return tr;
        }));
      }
    }
    const info = byId("managementSourcePageInfo");
    if (info) {
      const start = rows.length ? from + 1 : 0; const end = Math.min(from + managementSourceState.pageSize, rows.length);
      info.textContent = `${number(rows.length)} risultati · ${number(start)}–${number(end)} · pagina ${managementSourceState.page}/${totalPages}`;
    }
    if (byId("managementSourcePrev")) byId("managementSourcePrev").disabled = managementSourceState.page <= 1;
    if (byId("managementSourceNext")) byId("managementSourceNext").disabled = managementSourceState.page >= totalPages;
  }

  async function refreshManagementSources() {
    if (managementSourceLoading) return;
    const month = normalizeMonthKey(byId("managementMonth")?.value) || storedMonth();
    const api = window.OffertaLogicaStaffDataControl;
    if (!api) { setManagementStatus("error", "Controllo dati Owner non disponibile. Aggiorna la pagina."); return; }
    managementSourceLoading = true;
    renderManagementSources();
    try {
      managementSourceData = await api.list(month);
      renderManagementSources();
    } catch (error) {
      managementSourceData = { rows: [] };
      renderManagementSources();
      setManagementStatus("error", String(error?.message || error || "Dati sorgente non disponibili."));
    } finally {
      managementSourceLoading = false;
      renderManagementSources();
    }
  }

  function toggleManagementSources(force = null) {
    managementSourceOpen = force == null ? !managementSourceOpen : Boolean(force);
    const panel = byId("managementSourcePanel");
    if (panel) panel.hidden = !managementSourceOpen;
    const button = byId("managementSourceToggle");
    if (button) button.textContent = managementSourceOpen ? "Nascondi dati sorgente" : "Dati sorgente";
    if (managementSourceOpen) void refreshManagementSources();
  }

  function renderManagement(snapshot) {
    managementSnapshot = snapshot;
    renderPeriod(snapshot);
    renderSummary(snapshot);
    renderEconomy(snapshot);
    renderCommercial(snapshot);
    renderPremium(snapshot);
    renderPersonnel(snapshot);
    renderQuality(snapshot);
    selectSubview(currentSubview);
  }

  async function resetManagementBaseline() {
    const confirmation = window.prompt(
      "Il nuovo punto zero partirà da questo momento. Lo storico precedente NON viene cancellato.\n\nDigita RINNOVA_PUNTO_ZERO per confermare.",
      "",
    );
    if (confirmation !== "RINNOVA_PUNTO_ZERO") return;
    const status = byId("managementBaselineStatus");
    const button = byId("managementResetBaseline");
    if (button) button.disabled = true;
    if (status) {
      status.hidden = false;
      status.className = "management-status info";
      status.textContent = "Rinnovo del punto zero in corso…";
    }
    try {
      const result = await managementCatalogRequest({ action: "reset_economic_baseline", confirmation });
      const baselineAt = result?.result?.baseline_at || null;
      if (status) {
        status.className = "management-status success";
        status.textContent = baselineAt
          ? `Nuovo punto zero fissato al ${dateTime(baselineAt)}. Lo storico precedente è conservato.`
          : "Nuovo punto zero fissato. Lo storico precedente è conservato.";
      }
      await refreshManagementReport();
    } catch (error) {
      if (status) {
        status.className = "management-status error";
        status.textContent = String(error?.message || error || "Rinnovo punto zero non riuscito.");
      }
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function refreshManagementReport() {
    if (managementLoading) return;
    const view = byId(VIEW_ID);
    if (!view?.classList.contains("active")) return;
    const input = byId("managementMonth");
    const selectedMonth = normalizeMonthKey(input?.value) || storedMonth();
    if (input) input.value = selectedMonth;
    storeMonth(selectedMonth);
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
      if (managementSourceOpen) void refreshManagementSources();
      setManagementStatus("success", `Gestionale aggiornato · ${monthLabel(payload.month)} · dati verificati alle ${dateTime(payload.checkedAt)}.`);
    } catch (error) {
      setManagementStatus("error", String(error?.message || error || "Gestionale mensile non disponibile."));
    } finally {
      managementLoading = false;
      if (refresh) refresh.disabled = false;
    }
  }

  function resetPersonnelPage() {
    personnelState.page = 1;
    if (managementSnapshot) renderPersonnel(managementSnapshot);
  }

  function bindManagementControls() {
    const month = byId("managementMonth");
    if (month) {
      month.value = storedMonth();
      month.max = currentMonthKey();
      month.addEventListener("change", () => {
        const normalized = normalizeMonthKey(month.value) || currentMonthKey();
        month.value = normalized;
        storeMonth(normalized);
        void refreshManagementReport();
      });
    }
    byId("managementRefresh")?.addEventListener("click", () => void refreshManagementReport());
    byId("managementResetBaseline")?.addEventListener("click", () => void resetManagementBaseline());
    byId("managementAddBusinessLine")?.addEventListener("click", () => void editBusinessLine());
    byId("managementAddBusinessTool")?.addEventListener("click", () => void editBusinessTool());
    byId("managementExportCsv")?.addEventListener("click", exportCurrentManagementView);
    byId("managementOpenOperational")?.addEventListener("click", openOperationalModule);
    byId("managementSourceToggle")?.addEventListener("click", () => toggleManagementSources());
    byId("managementSourceClose")?.addEventListener("click", () => toggleManagementSources(false));
    byId("managementSourceOpenLeads")?.addEventListener("click", () => document.querySelector('[data-staff-tab="leads"]')?.click());
    byId("managementSourceOpenAnalytics")?.addEventListener("click", () => document.querySelector('[data-staff-tab="analytics"]')?.click());
    byId("managementSourceSearch")?.addEventListener("input", event => { managementSourceState.search=String(event.target.value||""); managementSourceState.page=1; renderManagementSources(); });
    byId("managementSourceType")?.addEventListener("change", event => { managementSourceState.type=String(event.target.value||"all"); managementSourceState.page=1; renderManagementSources(); });
    byId("managementSourceStatus")?.addEventListener("change", event => { managementSourceState.status=String(event.target.value||"all"); managementSourceState.page=1; renderManagementSources(); });
    byId("managementSourcePageSize")?.addEventListener("change", event => { const value=Number(event.target.value); managementSourceState.pageSize=PAGE_SIZES.includes(value)?value:25; managementSourceState.page=1; renderManagementSources(); });
    byId("managementSourcePrev")?.addEventListener("click", () => { managementSourceState.page=Math.max(1,managementSourceState.page-1); renderManagementSources(); });
    byId("managementSourceNext")?.addEventListener("click", () => { managementSourceState.page+=1; renderManagementSources(); });
    byId("managementCurrentMonth")?.addEventListener("click", () => {
      if (month) month.value = currentMonthKey();
      storeMonth(currentMonthKey());
      void refreshManagementReport();
    });
    byId("managementPreviousMonth")?.addEventListener("click", () => {
      const value = previousMonth(month?.value || storedMonth());
      if (month) month.value = value;
      storeMonth(value);
      void refreshManagementReport();
    });
    document.querySelectorAll("[data-management-subview]").forEach(button => {
      button.addEventListener("click", () => selectSubview(button.dataset.managementSubview));
    });

    byId("managementPersonnelSearch")?.addEventListener("input", event => {
      personnelState.search = String(event.target.value || "");
      resetPersonnelPage();
    });
    byId("managementPersonnelRole")?.addEventListener("change", event => {
      personnelState.role = String(event.target.value || "all");
      resetPersonnelPage();
    });
    byId("managementPersonnelStatus")?.addEventListener("change", event => {
      personnelState.status = String(event.target.value || "all");
      resetPersonnelPage();
    });
    byId("managementPersonnelSort")?.addEventListener("change", event => {
      personnelState.sort = String(event.target.value || "activity_desc");
      resetPersonnelPage();
    });
    byId("managementPersonnelPageSize")?.addEventListener("change", event => {
      const value = Number(event.target.value);
      personnelState.pageSize = PAGE_SIZES.includes(value) ? value : 25;
      resetPersonnelPage();
    });
    byId("managementPersonnelPrev")?.addEventListener("click", () => {
      personnelState.page = Math.max(1, personnelState.page - 1);
      if (managementSnapshot) renderPersonnel(managementSnapshot);
    });
    byId("managementPersonnelNext")?.addEventListener("click", () => {
      personnelState.page += 1;
      if (managementSnapshot) renderPersonnel(managementSnapshot);
    });
    window.addEventListener("offertalogica:management-source-changed", () => { if (managementSourceOpen) void refreshManagementSources(); });
  }

  function closeManagementView(updateHash = false) {
    byId(VIEW_ID)?.classList.remove("active");
    byId(TAB_ID)?.classList.remove("active");
    if (updateHash && location.hash === "#management") history.replaceState(null, "", "#overview");
  }

  function openManagementView() {
    const view = byId(VIEW_ID);
    const tab = byId(TAB_ID);
    if (!view || !tab || tab.hidden) return;
    document.querySelectorAll("[data-staff-view]").forEach(element => element.classList.remove("active"));
    document.querySelectorAll("[data-staff-tab]").forEach(element => element.classList.remove("active"));
    byId("staffEconomicsView")?.classList.remove("active");
    byId("staffEconomicsTab")?.classList.remove("active");
    view.classList.add("active");
    tab.classList.add("active");
    history.replaceState(null, "", "#management");
    const selected = normalizeMonthKey(byId("managementMonth")?.value) || storedMonth();
    if (!managementSnapshot || managementSnapshot.month !== selected) void refreshManagementReport();
  }

  function syncOwnerVisibility() {
    const group = byId("staffManagementGroup");
    const button = byId(TAB_ID);
    if (!button || !group) return;
    const visible = !group.hidden;
    button.hidden = !visible;
    if (!visible) closeManagementView(true);
    if (visible && location.hash === "#management") openManagementView();
  }

  function initManagementUi() {
    injectStyles();
    const view = createManagementView();
    const tab = byId(TAB_ID);
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

  // -----------------------------------------------------------------------
  // Collaboratori: livello di usabilità scalabile.
  // Non sostituisce premium_owner_list_staff_v2, non modifica ruoli/permessi
  // e non altera le azioni Owner già gestite da staff.js/governance.
  // -----------------------------------------------------------------------

  function collaboratorRows() {
    return Array.from(byId("collaboratorRows")?.querySelectorAll(":scope > tr") || [])
      .filter(row => row.querySelectorAll("td").length >= 3);
  }

  function collaboratorRowData(row) {
    const cells = row.querySelectorAll("td");
    const identity = String(cells[0]?.textContent || "").trim();
    const role = String(cells[1]?.textContent || "").trim();
    const status = String(cells[2]?.textContent || "").trim();
    return {
      identity,
      role,
      status,
      removed: row.dataset.staffRemoved === "true",
      active: /attivo/i.test(status) && !/disattivato|rimosso|non confermata|invito/i.test(status),
    };
  }

  function applyCollaboratorPagination() {
    if (collaboratorApplying) return;
    const body = byId("collaboratorRows");
    const rows = collaboratorRows();
    if (!rows.length || !body) {
      const info = byId("p7CollaboratorPageInfo");
      if (info) info.textContent = "0 risultati";
      return;
    }
    collaboratorApplying = true;
    collaboratorObserver?.disconnect();
    try {
      const search = collaboratorState.search.trim().toLowerCase();
      const filtered = rows.filter(row => {
        const data = collaboratorRowData(row);
        if (search && !data.identity.toLowerCase().includes(search)) return false;
        if (collaboratorState.role !== "all" && !data.role.toLowerCase().includes(collaboratorState.role)) return false;
        if (collaboratorState.status === "active" && !data.active) return false;
        if (collaboratorState.status === "inactive" && (data.active || data.removed)) return false;
        if (collaboratorState.status === "removed" && !data.removed) return false;
        return true;
      });

      filtered.sort((a, b) => {
        const left = collaboratorRowData(a);
        const right = collaboratorRowData(b);
        if (collaboratorState.sort === "role_asc") return left.role.localeCompare(right.role, "it", { sensitivity: "base" }) || left.identity.localeCompare(right.identity, "it", { sensitivity: "base" });
        if (collaboratorState.sort === "status_asc") return left.status.localeCompare(right.status, "it", { sensitivity: "base" }) || left.identity.localeCompare(right.identity, "it", { sensitivity: "base" });
        return left.identity.localeCompare(right.identity, "it", { sensitivity: "base" });
      });

      const unmatched = rows.filter(row => !filtered.includes(row));
      body.append(...filtered, ...unmatched);

      const totalPages = Math.max(1, Math.ceil(filtered.length / collaboratorState.pageSize));
      collaboratorState.page = Math.max(1, Math.min(collaboratorState.page, totalPages));
      const start = (collaboratorState.page - 1) * collaboratorState.pageSize;
      const visibleSet = new Set(filtered.slice(start, start + collaboratorState.pageSize));
      rows.forEach(row => { row.hidden = !visibleSet.has(row); });

      const info = byId("p7CollaboratorPageInfo");
      if (info) {
        const from = filtered.length ? start + 1 : 0;
        const to = Math.min(start + collaboratorState.pageSize, filtered.length);
        info.textContent = `${number(filtered.length)} risultati · ${number(from)}–${number(to)} · pagina ${collaboratorState.page}/${totalPages}`;
      }
      const prev = byId("p7CollaboratorPrev");
      const next = byId("p7CollaboratorNext");
      if (prev) prev.disabled = collaboratorState.page <= 1;
      if (next) next.disabled = collaboratorState.page >= totalPages;
    } finally {
      if (collaboratorObserver && body) collaboratorObserver.observe(body, { childList: true });
      queueMicrotask(() => { collaboratorApplying = false; });
    }
  }

  function resetCollaboratorPage() {
    collaboratorState.page = 1;
    applyCollaboratorPagination();
  }

  function installCollaboratorScalability() {
    if (collaboratorPagerInstalled) return;
    const body = byId("collaboratorRows");
    const tableWrap = body?.closest(".table-wrap");
    if (!body || !tableWrap) return;

    collaboratorPagerInstalled = true;
    const toolbar = document.createElement("div");
    toolbar.className = "p7-collaborator-toolbar";
    toolbar.id = "p7CollaboratorToolbar";
    toolbar.innerHTML = `
      <input id="p7CollaboratorSearch" type="search" placeholder="Cerca collaboratore" aria-label="Cerca collaboratore">
      <select id="p7CollaboratorRole" aria-label="Filtra ruolo collaboratore">
        <option value="all">Tutti i ruoli</option><option value="proprietario">Proprietario</option><option value="amministratore">Amministratore</option><option value="tecnico">Tecnico</option><option value="revisore">Revisore</option>
      </select>
      <select id="p7CollaboratorStatus" aria-label="Filtra stato collaboratore">
        <option value="all">Tutti gli stati caricati</option><option value="active">Attivi</option><option value="inactive">Disattivati / in attesa</option><option value="removed">Rimossi</option>
      </select>
      <select id="p7CollaboratorSort" aria-label="Ordina collaboratori">
        <option value="email_asc">Email A–Z</option><option value="role_asc">Ruolo</option><option value="status_asc">Stato</option>
      </select>
      <select id="p7CollaboratorPageSize" aria-label="Collaboratori per pagina">
        ${PAGE_SIZES.map(size => `<option value="${size}" ${size === 25 ? "selected" : ""}>${size} / pag.</option>`).join("")}
      </select>
    `;
    tableWrap.parentNode.insertBefore(toolbar, tableWrap);

    const pagination = document.createElement("div");
    pagination.className = "p7-collaborator-pagination";
    pagination.innerHTML = `<span id="p7CollaboratorPageInfo">0 risultati</span><div><button class="button secondary compact" id="p7CollaboratorPrev" type="button">Precedente</button><button class="button secondary compact" id="p7CollaboratorNext" type="button">Successiva</button></div>`;
    tableWrap.insertAdjacentElement("afterend", pagination);

    byId("p7CollaboratorSearch")?.addEventListener("input", event => {
      collaboratorState.search = String(event.target.value || "");
      resetCollaboratorPage();
    });
    byId("p7CollaboratorRole")?.addEventListener("change", event => {
      collaboratorState.role = String(event.target.value || "all");
      resetCollaboratorPage();
    });
    byId("p7CollaboratorStatus")?.addEventListener("change", event => {
      collaboratorState.status = String(event.target.value || "all");
      resetCollaboratorPage();
    });
    byId("p7CollaboratorSort")?.addEventListener("change", event => {
      collaboratorState.sort = String(event.target.value || "email_asc");
      resetCollaboratorPage();
    });
    byId("p7CollaboratorPageSize")?.addEventListener("change", event => {
      const value = Number(event.target.value);
      collaboratorState.pageSize = PAGE_SIZES.includes(value) ? value : 25;
      resetCollaboratorPage();
    });
    byId("p7CollaboratorPrev")?.addEventListener("click", () => {
      collaboratorState.page = Math.max(1, collaboratorState.page - 1);
      applyCollaboratorPagination();
    });
    byId("p7CollaboratorNext")?.addEventListener("click", () => {
      collaboratorState.page += 1;
      applyCollaboratorPagination();
    });

    collaboratorObserver?.disconnect();
    collaboratorObserver = new MutationObserver(() => {
      if (!collaboratorApplying) {
        collaboratorState.page = 1;
        applyCollaboratorPagination();
      }
    });
    collaboratorObserver.observe(body, { childList: true });
    window.addEventListener("offertalogica:collaborators-refreshed", () => {
      collaboratorState.page = 1;
      applyCollaboratorPagination();
    });
    window.addEventListener("pagehide", () => collaboratorObserver?.disconnect(), { once: true });
    applyCollaboratorPagination();
  }

  function init() {
    initManagementUi();
    installCollaboratorScalability();
  }

  const api = Object.freeze({
    release: RELEASE,
    timeZone: TIME_ZONE,
    productCatalog: PRODUCT_CATALOG,
    businessCatalog: () => businessCatalog(managementSnapshot),
    currentMonthKey,
    normalizeMonthKey,
    monthPeriod,
    normalizeDimensions,
    refreshMonthlyReport: refreshManagementReport,
    snapshot: () => managementSnapshot,
    selectView: selectSubview,
  });

  window.OffertaLogicaStaffManagement = api;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();

  window.dispatchEvent(new CustomEvent("offertalogica:staff-management-ready", {
    detail: { release: RELEASE, timeZone: TIME_ZONE, views: SUBVIEWS.map(([id]) => id) },
  }));
})();
