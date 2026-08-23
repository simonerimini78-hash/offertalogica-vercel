(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";
  const DAYS = [7, 30, 90, 365];
  let mounted = false;
  let loading = false;
  let currentDays = 30;
  let snapshot = null;

  const byId = id => document.getElementById(id);
  const money = value => {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(number)
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
  const esc = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

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
    if (!token) throw new Error("Sessione Staff non disponibile.");
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
      const message = payload?.message || payload?.error || String(payload || `HTTP ${response.status}`);
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setStatus(kind, message) {
    const target = byId("economicStatus");
    if (!target) return;
    target.className = `economic-status ${kind || ""}`.trim();
    target.textContent = message || "";
    target.hidden = !message;
  }

  function injectStyle() {
    if (byId("economicDashboardStyle")) return;
    const style = document.createElement("style");
    style.id = "economicDashboardStyle";
    style.textContent = `
      .economic-dashboard{margin-top:14px;display:grid;gap:14px}
      .economic-toolbar{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
      .economic-toolbar select{width:auto;min-width:150px}
      .economic-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
      .economic-kpi{border:1px solid var(--line);border-radius:14px;padding:13px;background:#fff}
      .economic-kpi span{display:block;color:var(--muted);font-size:11px;font-weight:800}
      .economic-kpi strong{display:block;margin-top:5px;font-size:23px}
      .economic-kpi small{display:block;margin-top:4px;color:var(--muted);font-size:10px}
      .economic-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr);gap:14px}
      .economic-rate-list{display:grid;gap:8px}
      .economic-rate{display:grid;grid-template-columns:minmax(180px,1fr) 120px 90px 120px auto;gap:8px;align-items:end;border-bottom:1px solid #e7eeeb;padding:9px 0}
      .economic-rate label,.economic-manual-grid label{display:grid;gap:4px;color:var(--muted);font-size:10px;font-weight:800}
      .economic-rate input,.economic-rate select,.economic-manual-grid input,.economic-manual-grid select,.economic-manual-grid textarea{min-height:38px;padding:7px 9px}
      .economic-rate-copy strong{display:block;font-size:12px}.economic-rate-copy small{display:block;color:var(--muted);font-size:10px;margin-top:2px}
      .economic-manual-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .economic-manual-grid .full{grid-column:1/-1}
      .economic-table{width:100%;border-collapse:collapse;min-width:850px}
      .economic-table th,.economic-table td{padding:9px;border-bottom:1px solid #e7eeeb;text-align:left;vertical-align:top;font-size:11px}
      .economic-table th{background:#f8fbf9;position:sticky;top:0}
      .economic-status{border-radius:10px;padding:9px 11px;font-size:12px}.economic-status.info{color:var(--blue);background:var(--blue-soft)}.economic-status.ok{color:var(--ok);background:var(--ok-soft)}.economic-status.error{color:var(--danger);background:var(--danger-soft)}
      .economic-owner-only{border:1px solid #fedf89;border-radius:12px;padding:12px;color:#7a2e0e;background:#fffaeb}
      @media(max-width:1000px){.economic-grid{grid-template-columns:1fr}.economic-rate{grid-template-columns:1fr 1fr}.economic-rate-copy{grid-column:1/-1}.economic-manual-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }

  function mount() {
    if (mounted) return true;
    const costsView = document.querySelector('[data-staff-view="costs"]');
    if (!costsView) return false;
    injectStyle();

    const wrapper = document.createElement("section");
    wrapper.id = "economicDashboard";
    wrapper.className = "economic-dashboard";
    wrapper.innerHTML = `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Cruscotto economico Owner</h3>
            <small>Ricavi, costi reali/stimati, risultato, margine e tariffe versionate. Le modifiche non riscrivono lo storico.</small>
          </div>
          <div class="economic-toolbar">
            <select id="economicDays" aria-label="Periodo cruscotto economico">
              ${DAYS.map(day => `<option value="${day}" ${day === currentDays ? "selected" : ""}>Ultimi ${day} giorni</option>`).join("")}
            </select>
            <button class="button secondary compact" id="economicRefresh" type="button">Aggiorna</button>
          </div>
        </div>
        <div class="panel-body">
          <div id="economicStatus" class="economic-status" hidden></div>
          <div id="economicOwnerDenied" class="economic-owner-only" hidden>Cruscotto economico riservato al Proprietario.</div>
          <div id="economicOwnerContent">
            <div class="economic-kpis" id="economicKpis"></div>
          </div>
        </div>
      </section>

      <div class="economic-grid" id="economicOwnerGrid">
        <section class="panel">
          <div class="panel-head">
            <div><h3>Tariffe e parametri</h3><small>Ogni salvataggio crea una nuova versione valida da adesso.</small></div>
          </div>
          <div class="panel-body">
            <div id="economicRates" class="economic-rate-list"></div>
            <details style="margin-top:12px">
              <summary style="cursor:pointer;font-weight:850;font-size:12px">Aggiungi nuova tariffa</summary>
              <form id="economicNewRateForm" class="economic-manual-grid" style="margin-top:10px">
                <label class="full">Chiave interna
                  <input name="rate_key" required maxlength="80" placeholder="es. commercialista_monthly_eur">
                </label>
                <label class="full">Descrizione
                  <input name="label" required maxlength="120" placeholder="es. Commercialista">
                </label>
                <label>Categoria
                  <input name="category" required maxlength="80" placeholder="es. amministrazione">
                </label>
                <label>Tipo
                  <select name="rate_type">
                    <option value="per_unit">Per unità</option>
                    <option value="fixed">Fisso per evento</option>
                    <option value="per_hour">Per ora</option>
                    <option value="per_month">Mensile</option>
                    <option value="per_year">Annuale</option>
                    <option value="percent">Percentuale</option>
                    <option value="per_million">Per milione</option>
                  </select>
                </label>
                <label>Valore
                  <input name="rate_value" type="number" min="0" step="0.000001" required>
                </label>
                <label>Valuta
                  <input name="currency" value="EUR" maxlength="3">
                </label>
                <label>IVA %
                  <input name="vat_rate" type="number" min="0" max="100" step="0.01">
                </label>
                <label>Fonte
                  <select name="source_mode"><option value="manual">Manuale</option><option value="estimated">Stimata</option><option value="provider_list">Listino provider</option><option value="automatic">Automatica</option></select>
                </label>
                <label class="full">Nota / riferimento
                  <input name="source_reference" maxlength="240" placeholder="es. fattura, contratto, listino">
                </label>
                <div class="full"><button class="button primary" type="submit">AGGIUNGI TARIFFA</button></div>
              </form>
            </details>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div><h3>Movimento manuale</h3><small>Per costi, ricavi e rettifiche non disponibili automaticamente.</small></div>
          </div>
          <div class="panel-body">
            <form id="economicManualForm" class="economic-manual-grid">
              <label>Direzione
                <select name="direction"><option value="cost">Costo</option><option value="revenue">Ricavo</option><option value="adjustment">Rettifica</option></select>
              </label>
              <label>Stato
                <select name="status"><option value="incurred">Sostenuto</option><option value="paid">Pagato/incassato</option><option value="confirmed">Confermato</option><option value="expected">Atteso</option><option value="estimated">Stimato</option></select>
              </label>
              <label class="full">Categoria
                <input name="category" required maxlength="80" placeholder="es. commercialista, dominio, rimborso">
              </label>
              <label>Importo
                <input name="amount" type="number" step="0.000001" required>
              </label>
              <label>Base importo
                <select name="amount_basis"><option value="gross">Lordo</option><option value="net">Netto</option></select>
              </label>
              <label>IVA %
                <input name="vat_rate" type="number" min="0" max="100" step="0.01" placeholder="vuoto se non applicabile">
              </label>
              <label>Valuta
                <input name="currency" value="EUR" maxlength="3">
              </label>
              <label class="full">Nota
                <textarea name="notes" rows="3" maxlength="600" placeholder="Descrizione interna"></textarea>
              </label>
              <div class="full"><button class="button primary" type="submit">SALVA MOVIMENTO</button></div>
            </form>
          </div>
        </section>
      </div>

      <section class="panel" id="economicEntriesPanel">
        <div class="panel-head"><div><h3>Registro economico recente</h3><small>Automatico e manuale. Le voci senza prezzo restano evidenziate e non diventano zero.</small></div></div>
        <div class="table-wrap"><table class="economic-table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Origine</th><th>Stato</th><th>Netto</th><th>IVA</th><th>Lordo</th><th>Nota</th></tr></thead>
          <tbody id="economicEntries"></tbody>
        </table></div>
      </section>
    `;

    const existingGrid = costsView.querySelector(".grid-2");
    if (existingGrid) existingGrid.insertAdjacentElement("beforebegin", wrapper);
    else costsView.append(wrapper);

    byId("economicDays")?.addEventListener("change", event => {
      currentDays = Number(event.target.value) || 30;
      refresh();
    });
    byId("economicRefresh")?.addEventListener("click", refresh);
    byId("economicManualForm")?.addEventListener("submit", saveManualEntry);
    byId("economicNewRateForm")?.addEventListener("submit", saveNewRate);

    mounted = true;
    return true;
  }

  function renderKpis(data) {
    const kpi = data?.kpi || {};
    const breakdown = data?.breakdown || {};
    const target = byId("economicKpis");
    if (!target) return;
    const cards = [
      ["Ricavi confermati", money(kpi.revenue_confirmed_eur), `Commissioni confermate + Premium incassato`],
      ["Ricavi attesi", money(kpi.revenue_expected_eur), `Non sommati ai ricavi reali`],
      ["Costi reali", money(kpi.cost_real_eur), `IA ${money(breakdown.premium_ai_cost_eur)} · operatore ${money(breakdown.human_cost_eur)}`],
      ["Costi stimati", money(kpi.cost_estimated_eur), `Separati dai costi reali`],
      ["Risultato reale", money(kpi.result_real_eur), `Ricavi confermati − costi reali + rettifiche`],
      ["Risultato atteso", money(kpi.result_expected_eur), `Include ricavi attesi e costi stimati`],
      ["Margine reale", kpi.margin_real_pct == null ? "—" : `${number(kpi.margin_real_pct,2)}%`, `Sul ricavo confermato`],
      ["Voci senza prezzo", number(kpi.unpriced_count,0), `Non vengono conteggiate come zero`],
    ];
    target.innerHTML = cards.map(([label, value, meta]) =>
      `<article class="economic-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(meta)}</small></article>`
    ).join("");
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
      target.innerHTML = `<div class="empty">Nessuna tariffa configurata.</div>`;
      return;
    }
    target.innerHTML = rates.map(rate => `
      <form class="economic-rate" data-rate-key="${esc(rate.rate_key)}">
        <div class="economic-rate-copy">
          <strong>${esc(rate.label)}</strong>
          <small>${esc(rate.source_mode)} · valida dal ${esc(date(rate.valid_from))}${rate.source_reference ? ` · ${esc(rate.source_reference)}` : ""}</small>
        </div>
        <label>Valore
          <input name="value" type="number" min="0" step="0.000001" value="${esc(rate.rate_value)}" required>
        </label>
        <label>IVA %
          <input name="vat" type="number" min="0" max="100" step="0.01" value="${rate.vat_rate == null ? "" : esc(rate.vat_rate)}">
        </label>
        <label>Unità
          <input value="${esc(rateValueLabel(rate))}" disabled>
        </label>
        <button class="button secondary compact" type="submit">SALVA</button>
      </form>
    `).join("");
    target.querySelectorAll("form[data-rate-key]").forEach(form => form.addEventListener("submit", saveRate));
  }

  function renderEntries(entries = []) {
    const target = byId("economicEntries");
    if (!target) return;
    if (!entries.length) {
      target.innerHTML = `<tr><td colspan="9">Nessun movimento nel periodo.</td></tr>`;
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
        <td>${entry.vat_eur == null ? "—" : esc(money(entry.vat_eur))}${entry.vat_rate == null ? "" : ` <small>(${esc(number(entry.vat_rate,2))}%)</small>`}</td>
        <td>${esc(money(entry.amount_gross_eur))}</td>
        <td>${esc(entry.notes || "")}</td>
      </tr>
    `).join("");
  }

  async function refresh() {
    if (loading || !mount()) return;
    loading = true;
    setStatus("info", "Aggiornamento cruscotto economico…");
    try {
      const data = await rpc("premium_owner_economic_dashboard", { p_days: currentDays });
      snapshot = data || {};
      byId("economicOwnerDenied").hidden = true;
      byId("economicOwnerContent").hidden = false;
      byId("economicOwnerGrid").hidden = false;
      byId("economicEntriesPanel").hidden = false;
      renderKpis(snapshot);
      renderRates(Array.isArray(snapshot.rates) ? snapshot.rates : []);
      renderEntries(Array.isArray(snapshot.entries) ? snapshot.entries : []);
      setStatus("ok", `Dati aggiornati. Periodo: ultimi ${currentDays} giorni.`);
    } catch (error) {
      const denied = error?.status === 401 || error?.status === 403 || /owner|required|permission|42501/i.test(error?.message || "");
      if (denied) {
        byId("economicOwnerDenied").hidden = false;
        byId("economicOwnerContent").hidden = true;
        byId("economicOwnerGrid").hidden = true;
        byId("economicEntriesPanel").hidden = true;
        setStatus("", "");
      } else {
        setStatus("error", String(error?.message || error || "Cruscotto economico non disponibile."));
      }
    } finally {
      loading = false;
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
        p_rate_key: rate.rate_key,
        p_label: rate.label,
        p_category: rate.category,
        p_rate_type: rate.rate_type,
        p_rate_value: Number(form.elements.value.value),
        p_currency: rate.currency || "EUR",
        p_vat_rate: form.elements.vat.value === "" ? null : Number(form.elements.vat.value),
        p_source_mode: "manual",
        p_source_reference: "Modifica da Control Center Staff",
        p_notes: `Versione precedente conservata. Modifica manuale Owner del ${new Date().toISOString()}.`,
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
      form.reset();
      form.elements.currency.value = "EUR";
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
        p_fx_rate_to_eur: null,
        p_quantity: 1,
        p_unit: "event",
        p_occurred_at: new Date().toISOString(),
        p_competence_start: null,
        p_competence_end: null,
        p_notes: String(form.elements.notes.value || "").trim(),
        p_metadata: { entered_from: "staff_economic_dashboard" },
      });
      form.reset();
      form.elements.currency.value = "EUR";
      window.dispatchEvent(new Event("offertalogica:staff-save-complete"));
      loading = false;
      await refresh();
    } catch (error) {
      setStatus("error", String(error?.message || error || "Movimento non salvato."));
      loading = false;
    }
  }

  function costsVisible() {
    return document.querySelector('[data-staff-view="costs"]')?.classList.contains("active");
  }

  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest('[data-staff-tab="costs"]')) {
      window.setTimeout(() => { if (costsVisible()) refresh(); }, 0);
    }
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#costs") refresh(); });
  window.addEventListener("offertalogica:staff-context-changed", () => { if (costsVisible()) refresh(); });
  window.addEventListener("load", () => {
    mount();
    if (costsVisible()) refresh();
  }, { once: true });
})();
