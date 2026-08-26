(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const DAYS = [7, 30, 90, 365];
  let loading = false;
  let currentDays = 30;
  let snapshot = null;
  let installed = false;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const money = value => {
    if (value === null || value === undefined || value === "") return "—";
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(parsed)
      : "—";
  };
  const number = (value, digits = 2) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? new Intl.NumberFormat("it-IT", { maximumFractionDigits: digits }).format(parsed)
      : "—";
  };
  const date = value => {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(parsed);
  };

  function storedAccessToken() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return String(
        parsed?.access_token ||
        parsed?.session?.access_token ||
        parsed?.currentSession?.access_token ||
        ""
      ).trim();
    } catch {
      return "";
    }
  }

  async function rpc(name, body = {}) {
    const token = storedAccessToken();
    if (!token) throw Object.assign(new Error("Sessione Staff non disponibile."), { kind: "auth" });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const message = String(payload?.message || payload?.error || payload?.details || payload || `HTTP ${response.status}`);
      const code = String(payload?.code || "");
      const error = new Error(message);
      error.status = response.status;
      error.code = code;
      if (response.status === 404 || code === "PGRST202" || /could not find the function|schema cache/i.test(message)) error.kind = "not_installed";
      else if (response.status === 401) error.kind = "auth";
      else if (response.status === 403 || code === "42501" || /premium_owner_required|permission denied/i.test(message)) error.kind = "denied";
      else error.kind = "runtime";
      throw error;
    }
    return payload;
  }

  function injectStyle() {
    if (byId("economicDashboardStyle")) return;
    const style = document.createElement("style");
    style.id = "economicDashboardStyle";
    style.textContent = `
      .economic-page{display:grid;gap:14px}
      .economic-toolbar{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
      .economic-toolbar select{width:auto;min-width:150px}
      .economic-baseline-info{border:1px solid #d7e4de;border-radius:10px;padding:8px 10px;color:#51625c;background:#fbfdfc;font-size:11px;line-height:1.4}
      .economic-status{border-radius:11px;padding:10px 12px;font-size:12px;line-height:1.45}
      .economic-status.info{color:var(--blue);background:var(--blue-soft)}
      .economic-status.ok{color:var(--ok);background:var(--ok-soft)}
      .economic-status.error{color:var(--danger);background:var(--danger-soft)}
      .economic-status.warn{color:#7a2e0e;background:#fffaeb;border:1px solid #fedf89}
      .economic-kpis{display:grid;grid-template-columns:repeat(4,minmax(170px,1fr));gap:10px}
      .economic-kpi{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff;min-width:0}
      .economic-kpi.priority{border-color:#cde2da;background:linear-gradient(180deg,#fff,#f8fcfa)}
      .economic-kpi span{display:block;color:var(--muted);font-size:11px;font-weight:800}
      .economic-kpi strong{display:block;margin-top:5px;font-size:24px;line-height:1.08;overflow-wrap:anywhere}
      .economic-kpi.priority strong{color:var(--green-dark)}
      .economic-kpi small{display:block;margin-top:5px;color:var(--muted);font-size:10px;line-height:1.4}
      .economic-section-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .economic-breakdown{display:grid;gap:8px}
      .economic-breakdown-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid #e2ebe7;border-radius:11px;padding:10px 11px;background:#fbfdfc}
      .economic-breakdown-row strong{font-size:12px}.economic-breakdown-row small{display:block;margin-top:2px;color:var(--muted);font-size:10px}.economic-breakdown-row b{font-size:14px;color:var(--green-dark);white-space:nowrap}
      .economic-rate-list{display:grid;gap:8px}
      .economic-rate{display:grid;grid-template-columns:minmax(200px,1fr) 125px 95px 125px auto;gap:8px;align-items:end;border-bottom:1px solid #e7eeeb;padding:9px 0}
      .economic-rate label,.economic-manual-grid label{display:grid;gap:4px;color:var(--muted);font-size:10px;font-weight:800}
      .economic-rate input,.economic-rate select,.economic-manual-grid input,.economic-manual-grid select,.economic-manual-grid textarea{min-height:38px;padding:7px 9px}
      .economic-rate-copy strong{display:block;font-size:12px}.economic-rate-copy small{display:block;color:var(--muted);font-size:10px;margin-top:2px;line-height:1.4}
      .economic-manual-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .economic-manual-grid .full{grid-column:1/-1}
      .economic-table{width:100%;border-collapse:collapse;min-width:930px}
      .economic-table th,.economic-table td{padding:9px;border-bottom:1px solid #e7eeeb;text-align:left;vertical-align:top;font-size:11px}
      .economic-table th{background:#f8fbf9;position:sticky;top:0;z-index:1}
      .economic-empty{padding:22px;color:var(--muted);text-align:center;font-size:12px}
      .economic-source{display:inline-flex;border-radius:999px;padding:3px 6px;background:#eef2f1;color:#51625c;font-size:9px;font-weight:850}
      @media(max-width:1100px){.economic-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.economic-section-grid{grid-template-columns:1fr}.economic-rate{grid-template-columns:1fr 1fr}.economic-rate-copy{grid-column:1/-1}}
      @media(max-width:680px){.economic-kpis{grid-template-columns:1fr}.economic-manual-grid{grid-template-columns:1fr}.economic-manual-grid .full{grid-column:auto}.economic-toolbar{justify-content:flex-start}.economic-toolbar select{width:100%}}
    `;
    document.head.append(style);
  }

  function setStatus(kind, message) {
    const target = byId("economicStatus");
    if (!target) return;
    target.className = `economic-status ${kind || ""}`.trim();
    target.textContent = message || "";
    target.hidden = !message;
  }

  function ensureMarkup() {
    if (installed) return true;
    const view = document.querySelector('[data-staff-view="economics"]');
    if (!view) return false;
    injectStyle();
    view.innerHTML = `
      <div class="view-head">
        <div>
          <span class="control-kicker">Controllo economico</span>
          <h2>Cruscotto economico</h2>
          <p>Ricavi, costi reali e stimati, risultato, margine, tariffe versionate e movimenti manuali. Le modifiche non riscrivono lo storico.</p>
        </div>
        <div class="economic-toolbar">
          <select id="economicDays" aria-label="Periodo cruscotto economico">
            ${DAYS.map(day => `<option value="${day}" ${day === currentDays ? "selected" : ""}>Ultimi ${day} giorni</option>`).join("")}
          </select>
          <button class="button secondary" id="economicRefresh" type="button">Aggiorna</button>
          <button class="button danger" id="economicResetBaseline" type="button">AZZERA CONTEGGI</button>
        </div>
      </div>
      <div class="economic-page">
        <div id="economicBaselineInfo" class="economic-baseline-info" hidden></div>
        <div id="economicStatus" class="economic-status" hidden></div>
        <section class="panel">
          <div class="panel-head"><div><h3>Quadro generale</h3><small>Valori economici del periodo selezionato</small></div></div>
          <div class="panel-body"><div class="economic-kpis" id="economicKpis"><div class="economic-empty">Apri il cruscotto per caricare i dati.</div></div></div>
        </section>
        <div class="economic-section-grid">
          <section class="panel">
            <div class="panel-head"><div><h3>Ricavi</h3><small>Incassati, confermati e attesi</small></div></div>
            <div class="panel-body"><div id="economicRevenueBreakdown" class="economic-breakdown"></div></div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h3>Costi</h3><small>Automatici, operatore, registrati e ricorrenti</small></div></div>
            <div class="panel-body"><div id="economicCostBreakdown" class="economic-breakdown"></div></div>
          </section>
        </div>
        <div class="economic-section-grid">
          <section class="panel">
            <div class="panel-head"><div><h3>Tariffe e parametri</h3><small>Ogni salvataggio crea una nuova versione valida da quel momento.</small></div></div>
            <div class="panel-body">
              <div id="economicRates" class="economic-rate-list"></div>
              <details style="margin-top:12px">
                <summary style="cursor:pointer;font-weight:850;font-size:12px">Aggiungi nuova tariffa o costo ricorrente</summary>
                <form id="economicNewRateForm" class="economic-manual-grid" style="margin-top:10px">
                  <label class="full">Chiave interna<input name="rate_key" required maxlength="80" placeholder="es. commercialista_monthly_eur"></label>
                  <label class="full">Descrizione<input name="label" required maxlength="120" placeholder="es. Commercialista"></label>
                  <label>Categoria<input name="category" required maxlength="80" placeholder="es. amministrazione"></label>
                  <label>Tipo<select name="rate_type"><option value="per_unit">Per unità</option><option value="fixed">Fisso per evento</option><option value="per_hour">Per ora</option><option value="per_month">Mensile</option><option value="per_year">Annuale</option><option value="percent">Percentuale</option><option value="per_million">Per milione</option></select></label>
                  <label>Valore<input name="rate_value" type="number" min="0" step="0.000001" required></label>
                  <label>Valuta<input name="currency" value="EUR" maxlength="3"></label>
                  <label>IVA %<input name="vat_rate" type="number" min="0" max="100" step="0.01"></label>
                  <label>Fonte<select name="source_mode"><option value="manual">Manuale</option><option value="estimated">Stimata</option><option value="provider_list">Listino provider</option><option value="automatic">Automatica</option></select></label>
                  <label class="full">Nota / riferimento<input name="source_reference" maxlength="240" placeholder="es. fattura, contratto, listino"></label>
                  <div class="full"><button class="button primary" type="submit">AGGIUNGI TARIFFA</button></div>
                </form>
              </details>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h3>Movimento manuale</h3><small>Costi, ricavi e rettifiche non disponibili automaticamente.</small></div></div>
            <div class="panel-body">
              <form id="economicManualForm" class="economic-manual-grid">
                <label>Direzione<select name="direction"><option value="cost">Costo</option><option value="revenue">Ricavo</option><option value="adjustment">Rettifica</option></select></label>
                <label>Stato<select name="status"><option value="incurred">Sostenuto</option><option value="paid">Pagato/incassato</option><option value="confirmed">Confermato</option><option value="expected">Atteso</option><option value="estimated">Stimato</option></select></label>
                <label class="full">Categoria<input name="category" required maxlength="80" placeholder="es. commercialista, dominio, rimborso"></label>
                <label>Importo<input name="amount" type="number" step="0.000001" required></label>
                <label>Base importo<select name="amount_basis"><option value="gross">Lordo</option><option value="net">Netto</option></select></label>
                <label>IVA %<input name="vat_rate" type="number" min="0" max="100" step="0.01" placeholder="vuoto se non applicabile"></label>
                <label>Valuta<input name="currency" value="EUR" maxlength="3"></label>
                <label class="full">Nota<textarea name="notes" rows="3" maxlength="600" placeholder="Descrizione interna"></textarea></label>
                <div class="full"><button class="button primary" type="submit">SALVA MOVIMENTO</button></div>
              </form>
            </div>
          </section>
        </div>
        <section class="panel">
          <div class="panel-head"><div><h3>Registro economico</h3><small>Movimenti automatici e manuali del periodo. Le voci senza prezzo non vengono trasformate in zero.</small></div></div>
          <div class="table-wrap"><table class="economic-table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Origine</th><th>Stato</th><th>Netto</th><th>IVA</th><th>Lordo</th><th>Nota</th></tr></thead>
            <tbody id="economicEntries"></tbody>
          </table></div>
        </section>
      </div>
    `;
    byId("economicDays")?.addEventListener("change", event => { currentDays = Number(event.target.value) || 30; refresh(); });
    byId("economicRefresh")?.addEventListener("click", refresh);
    byId("economicResetBaseline")?.addEventListener("click", resetEconomicBaseline);
    byId("economicManualForm")?.addEventListener("submit", saveManualEntry);
    byId("economicNewRateForm")?.addEventListener("submit", saveNewRate);
    installed = true;
    return true;
  }

  function breakdownRow(label, value, note, source = "") {
    return `<div class="economic-breakdown-row"><div><strong>${esc(label)}</strong>${note ? `<small>${esc(note)}</small>` : ""}${source ? `<small><span class="economic-source">${esc(source)}</span></small>` : ""}</div><b>${esc(money(value))}</b></div>`;
  }

  function renderBaselineInfo(data) {
    const target = byId("economicBaselineInfo");
    if (!target) return;
    if (!data?.baseline_at) {
      target.hidden = true;
      target.textContent = "";
      return;
    }
    target.hidden = false;
    target.textContent = `Ultimo azzeramento conteggi: ${date(data.baseline_at)}. I dati precedenti restano archiviati ma non entrano nei conteggi quando la baseline limita il periodo selezionato.`;
  }

  function renderKpis(data) {
    const kpi = data?.kpi || {};
    const target = byId("economicKpis");
    if (!target) return;
    const cards = [
      ["Ricavi confermati", money(kpi.revenue_confirmed_eur), "Incassati/confermati nel periodo", true],
      ["Ricavi attesi", money(kpi.revenue_expected_eur), "Potenziali, separati dai ricavi reali", false],
      ["Costi reali", money(kpi.cost_real_eur), "Costi già sostenuti o confermati", false],
      ["Costi stimati", money(kpi.cost_estimated_eur), "Ricorrenti e stime non ancora reali", false],
      ["Risultato reale", money(kpi.result_real_eur), "Ricavi confermati − costi reali + rettifiche", true],
      ["Risultato atteso", money(kpi.result_expected_eur), "Scenario comprensivo di attesi e stimati", false],
      ["Margine reale", kpi.margin_real_pct == null ? "—" : `${number(kpi.margin_real_pct, 2)}%`, "Calcolato sui ricavi confermati", true],
      ["Voci senza prezzo", number(kpi.unpriced_count, 0), "Da completare: non vengono considerate zero", false],
    ];
    target.innerHTML = cards.map(([label, value, meta, priority]) => `<article class="economic-kpi${priority ? " priority" : ""}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></article>`).join("");
  }

  function siteAiNote(runs, failed, unpriced, estimated) {
    const parts = [`${number(runs, 0)} analisi`];
    if (Number(failed || 0) > 0) parts.push(`${number(failed, 0)} fallite`);
    if (Number(unpriced || 0) > 0) parts.push(`${number(unpriced, 0)} senza prezzo`);
    if (Number(estimated || 0) > 0) parts.push(`${money(estimated)} stimati`);
    return parts.join(" · ");
  }

  function renderBreakdowns(data) {
    const kpi = data?.kpi || {};
    const b = data?.breakdown || {};
    const leadPotentialOnly = Math.max(0, Number(b.lead_commission_expected_eur || 0) - Number(b.lead_commission_confirmed_eur || 0));
    const manualExpected = Math.max(0, Number(kpi.revenue_expected_eur || 0) - leadPotentialOnly);
    const revenue = byId("economicRevenueBreakdown");
    const costs = byId("economicCostBreakdown");
    if (revenue) revenue.innerHTML = [
      breakdownRow("Premium e altri ricavi registrati", b.premium_and_manual_revenue_real_eur, "Pagamenti e movimenti reali registrati", "automatico/manuale"),
      breakdownRow("Commissioni forniture confermate", b.lead_commission_confirmed_eur, "Solo stati economici confermati/pagati", "automatico"),
      breakdownRow("Commissioni forniture ancora attese", leadPotentialOnly, "Potenziale non incluso nei ricavi reali", "automatico"),
      breakdownRow("Altri ricavi attesi/stimati", manualExpected, "Movimenti economici attesi inseriti nel registro", "manuale/automatico"),
    ].join("");
    if (costs) {
      const rows = [
        breakdownRow("Analisi IA Premium", b.premium_ai_cost_eur, `${number(b.premium_ai_runs, 0)} analisi · ${number(b.premium_ai_failed, 0)} fallite`, "automatico"),
        breakdownRow("Analisi IA sito — Privati", b.site_pdf_ai_consumer_cost_real_eur,
          siteAiNote(b.site_pdf_ai_consumer_runs, b.site_pdf_ai_consumer_failed, b.site_pdf_ai_consumer_unpriced, b.site_pdf_ai_consumer_cost_estimated_eur), "automatico"),
        breakdownRow("Analisi IA sito — Business", b.site_pdf_ai_business_cost_real_eur,
          siteAiNote(b.site_pdf_ai_business_runs, b.site_pdf_ai_business_failed, b.site_pdf_ai_business_unpriced, b.site_pdf_ai_business_cost_estimated_eur), "automatico"),
      ];
      if (Number(b.site_pdf_ai_unknown_runs || 0) > 0) {
        rows.push(breakdownRow("Analisi IA sito — Tipo non determinato", b.site_pdf_ai_unknown_cost_real_eur,
          siteAiNote(b.site_pdf_ai_unknown_runs, b.site_pdf_ai_unknown_failed, b.site_pdf_ai_unknown_unpriced, b.site_pdf_ai_unknown_cost_estimated_eur), "automatico"));
      }
      rows.push(
        breakdownRow("Tempo operatore", b.human_cost_eur, `${number(Number(b.human_seconds || 0) / 3600, 2)} ore valorizzate con tariffa storica`, "automatico"),
        breakdownRow("Altri costi già registrati", b.legacy_recorded_cost_eur, "Eventi di costo esistenti non duplicati", "automatico"),
        breakdownRow("Altri costi reali nel registro economico", b.ledger_cost_real_other_eur, "Esclude le analisi IA del sito mostrate sopra", "registro"),
        breakdownRow("Altri costi stimati nel registro", b.ledger_cost_estimated_other_eur, "Esclude le analisi IA del sito mostrate sopra", "registro"),
        breakdownRow("Costi ricorrenti stimati", b.scheduled_cost_estimated_eur, "Prorata di tariffe mensili/annuali attive", "tariffe"),
      );
      costs.innerHTML = rows.join("");
    }
  }

  function rateValueLabel(rate) {
    if (rate.rate_type === "percent") return "%";
    if (rate.rate_type === "per_hour") return `${rate.currency || "EUR"}/h`;
    if (rate.rate_type === "per_month") return `${rate.currency || "EUR"}/mese`;
    if (rate.rate_type === "per_year") return `${rate.currency || "EUR"}/anno`;
    if (rate.rate_type === "per_million") return `${rate.currency || "EUR"}/1M`;
    return `${rate.currency || "EUR"}/${rate.rate_type === "fixed" ? "evento" : "unità"}`;
  }

  function renderRates(rates = []) {
    const target = byId("economicRates");
    if (!target) return;
    if (!rates.length) {
      target.innerHTML = `<div class="economic-empty">Nessuna tariffa configurata.</div>`;
      return;
    }
    target.innerHTML = rates.map(rate => `
      <form class="economic-rate" data-rate-key="${esc(rate.rate_key)}">
        <div class="economic-rate-copy"><strong>${esc(rate.label)}</strong><small>${esc(rate.category)} · ${esc(rate.source_mode)} · valida dal ${esc(date(rate.valid_from))}${rate.source_reference ? ` · ${esc(rate.source_reference)}` : ""}</small></div>
        <label>Valore<input name="value" type="number" min="0" step="0.000001" value="${esc(rate.rate_value)}" required></label>
        <label>IVA %<input name="vat" type="number" min="0" max="100" step="0.01" value="${rate.vat_rate == null ? "" : esc(rate.vat_rate)}"></label>
        <label>Unità<input value="${esc(rateValueLabel(rate))}" disabled></label>
        <button class="button secondary compact" type="submit">SALVA</button>
      </form>
    `).join("");
    target.querySelectorAll("form[data-rate-key]").forEach(form => form.addEventListener("submit", saveRate));
  }

  function renderEntries(entries = []) {
    const target = byId("economicEntries");
    if (!target) return;
    if (!entries.length) {
      target.innerHTML = `<tr><td colspan="9">Nessun movimento economico nel periodo.</td></tr>`;
      return;
    }
    target.innerHTML = entries.map(entry => `
      <tr>
        <td>${esc(date(entry.occurred_at))}</td>
        <td>${esc(entry.direction)}</td>
        <td><strong>${esc(entry.category)}</strong></td>
        <td>${esc(entry.source_system || "—")}</td>
        <td>${esc(entry.status)}</td>
        <td>${esc(money(entry.amount_net_eur))}</td>
        <td>${entry.vat_eur == null ? "—" : esc(money(entry.vat_eur))}${entry.vat_rate == null ? "" : ` <small>(${esc(number(entry.vat_rate, 2))}%)</small>`}</td>
        <td>${esc(money(entry.amount_gross_eur))}</td>
        <td>${esc(entry.notes || "")}</td>
      </tr>
    `).join("");
  }

  function clearEconomicData() {
    const baselineInfo = byId("economicBaselineInfo");
    if (baselineInfo) { baselineInfo.hidden = true; baselineInfo.textContent = ""; }
    const kpis = byId("economicKpis");
    if (kpis) kpis.innerHTML = `<div class="economic-empty">Dati non disponibili.</div>`;
    if (byId("economicRevenueBreakdown")) byId("economicRevenueBreakdown").innerHTML = "";
    if (byId("economicCostBreakdown")) byId("economicCostBreakdown").innerHTML = "";
    if (byId("economicRates")) byId("economicRates").innerHTML = "";
    if (byId("economicEntries")) byId("economicEntries").innerHTML = `<tr><td colspan="9">Dati non disponibili.</td></tr>`;
  }

  async function refresh() {
    if (loading || !ensureMarkup()) return;
    loading = true;
    setStatus("info", "Aggiornamento cruscotto economico…");
    try {
      const data = await rpc("premium_owner_economic_dashboard", { p_days: currentDays });
      snapshot = data || {};
      renderBaselineInfo(snapshot);
      renderKpis(snapshot);
      renderBreakdowns(snapshot);
      renderRates(Array.isArray(snapshot.rates) ? snapshot.rates : []);
      renderEntries(Array.isArray(snapshot.entries) ? snapshot.entries : []);
      setStatus("ok", `Dati aggiornati. Periodo: ultimi ${currentDays} giorni.`);
    } catch (error) {
      snapshot = null;
      clearEconomicData();
      if (error?.kind === "not_installed") {
        setStatus("warn", "Il modulo economico non è ancora installato nel database Supabase. Esegui la migrazione premium-economics-v0.36.58.sql, poi premi Aggiorna.");
      } else if (error?.kind === "denied") {
        setStatus("warn", "Cruscotto economico riservato al Proprietario.");
      } else if (error?.kind === "auth") {
        setStatus("error", "Sessione Staff non disponibile. Esci e accedi nuovamente.");
      } else {
        setStatus("error", String(error?.message || error || "Cruscotto economico non disponibile."));
      }
    } finally {
      loading = false;
    }
  }

  async function resetEconomicBaseline() {
    if (loading) return;
    const confirmed = window.confirm(
      "Azzerare i conteggi economici da questo momento?\n\n" +
      "I dati storici NON verranno cancellati dal database, ma le prove precedenti non entreranno più nei conteggi del Cruscotto. " +
      "Tariffe e parametri restano invariati."
    );
    if (!confirmed) return;

    const button = byId("economicResetBaseline");
    loading = true;
    if (button) button.disabled = true;
    setStatus("info", "Azzeramento conteggi economici…");
    try {
      const result = await rpc("premium_owner_reset_economic_baseline");
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      loading = false;
      await refresh();
      const baselineAt = result?.baseline_at || snapshot?.baseline_at;
      setStatus("ok", baselineAt
        ? `Conteggi azzerati. Nuova baseline: ${date(baselineAt)}. Lo storico non è stato cancellato.`
        : "Conteggi azzerati. Lo storico non è stato cancellato.");
    } catch (error) {
      setStatus("error", String(error?.message || error || "Impossibile azzerare i conteggi."));
      loading = false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function saveRate(event) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget;
    const key = form.dataset.rateKey;
    const rate = (snapshot?.rates || []).find(item => item.rate_key === key);
    if (!rate) return;
    loading = true;
    setStatus("info", `Salvataggio nuova versione: ${rate.label}…`);
    try {
      await rpc("premium_owner_set_economic_rate", {
        p_rate_key: rate.rate_key, p_label: rate.label, p_category: rate.category,
        p_rate_type: rate.rate_type, p_rate_value: Number(form.elements.value.value),
        p_currency: rate.currency || "EUR",
        p_vat_rate: form.elements.vat.value === "" ? null : Number(form.elements.vat.value),
        p_source_mode: "manual", p_source_reference: "Modifica da Control Center Staff",
        p_notes: `Versione precedente conservata. Modifica manuale del ${new Date().toISOString()}.`,
        p_valid_from: new Date().toISOString(),
      });
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      loading = false;
      await refresh();
    } catch (error) {
      setStatus("error", String(error?.message || error || "Tariffa non salvata."));
      loading = false;
    }
  }

  async function saveNewRate(event) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget;
    const key = String(form.elements.rate_key.value || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!key) return;
    loading = true;
    setStatus("info", "Creazione nuova tariffa…");
    try {
      await rpc("premium_owner_set_economic_rate", {
        p_rate_key: key,
        p_label: String(form.elements.label.value || "").trim(),
        p_category: String(form.elements.category.value || "").trim(),
        p_rate_type: String(form.elements.rate_type.value || "per_unit"),
        p_rate_value: Number(form.elements.rate_value.value),
        p_currency: String(form.elements.currency.value || "EUR").trim().toUpperCase(),
        p_vat_rate: form.elements.vat_rate.value === "" ? null : Number(form.elements.vat_rate.value),
        p_source_mode: String(form.elements.source_mode.value || "manual"),
        p_source_reference: String(form.elements.source_reference.value || "").trim(),
        p_notes: `Creata dal Control Center Staff il ${new Date().toISOString()}.`,
        p_valid_from: new Date().toISOString(),
      });
      form.reset(); form.elements.currency.value = "EUR";
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      loading = false;
      await refresh();
    } catch (error) {
      setStatus("error", String(error?.message || error || "Nuova tariffa non salvata."));
      loading = false;
    }
  }

  async function saveManualEntry(event) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget;
    loading = true;
    setStatus("info", "Salvataggio movimento economico…");
    try {
      await rpc("premium_owner_add_economic_entry", {
        p_direction: String(form.elements.direction.value),
        p_status: String(form.elements.status.value),
        p_category: String(form.elements.category.value).trim(),
        p_amount: Number(form.elements.amount.value),
        p_amount_basis: String(form.elements.amount_basis.value),
        p_vat_rate: form.elements.vat_rate.value === "" ? null : Number(form.elements.vat_rate.value),
        p_currency: String(form.elements.currency.value || "EUR").trim().toUpperCase(),
        p_fx_rate_to_eur: null, p_quantity: 1, p_unit: "event",
        p_occurred_at: new Date().toISOString(), p_competence_start: null, p_competence_end: null,
        p_notes: String(form.elements.notes.value || "").trim(),
        p_metadata: { entered_from: "staff_economic_dashboard" },
      });
      form.reset(); form.elements.currency.value = "EUR";
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      loading = false;
      await refresh();
    } catch (error) {
      setStatus("error", String(error?.message || error || "Movimento non salvato."));
      loading = false;
    }
  }

  function openEconomics({ updateHash = true } = {}) {
    if (!ensureMarkup()) return;
    document.querySelectorAll("[data-staff-tab]").forEach(button => button.classList.remove("active"));
    byId("staffEconomicsTab")?.classList.add("active");
    document.querySelectorAll("[data-staff-view]").forEach(view => view.classList.toggle("active", view.dataset.staffView === "economics"));
    const pageMessage = byId("staffPageMessage");
    if (pageMessage) { pageMessage.hidden = true; pageMessage.textContent = ""; }
    if (updateHash) history.replaceState(null, "", "#economics");
    refresh();
  }

  function bindNavigation() {
    byId("staffEconomicsTab")?.addEventListener("click", () => openEconomics());
    document.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("[data-staff-tab]")) byId("staffEconomicsTab")?.classList.remove("active");
    });
    window.addEventListener("hashchange", () => { if (location.hash === "#economics") openEconomics({ updateHash: false }); });
    window.addEventListener("offertalogica:staff-context-changed", () => { if (location.hash === "#economics") refresh(); });
    window.addEventListener("load", () => {
      ensureMarkup();
      if (location.hash === "#economics") window.setTimeout(() => openEconomics({ updateHash: false }), 0);
    }, { once: true });
  }

  bindNavigation();
})();
