(() => {
  "use strict";

  const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active"]);
  const BUCKET = "premium-bills";
  const MAX_FILE_SIZE = 20_000_000;
  const BILL_COLUMNS = "id, user_id, utility_id, contract_id, commodity, billing_period_start, billing_period_end, issue_date, due_date, total_amount_eur, original_file_name, file_size, file_sha256, storage_bucket, storage_path, processing_status, customer_status, automatic_screening_status, automatic_screening_summary, automatic_screening_reasons, automatic_screened_at, automatic_analysis_run_id, created_at";
  const UTILITY_COLUMNS = "id, label, supply_type, expected_bills_per_year, status";
  const CONTRACT_COLUMNS = "id, user_id, utility_id, provider_name, offer_name, pricing_type, contract_start, contract_end, fixed_price_expiry, electricity_price_eur_kwh, gas_price_eur_smc, electricity_fixed_fee_eur_year, gas_fixed_fee_eur_year, source, verification_status, is_current, arera_offer_code_electricity, arera_offer_code_gas, electricity_index_name, gas_index_name, electricity_spread_eur_kwh, gas_spread_eur_smc, electricity_formula, gas_formula, automatic_match_status, automatic_match_confidence, automatic_match_method, automatic_match_candidates, automatic_matched_at, automatic_match_catalog_version, customer_confirmation_status, customer_confirmed_at, customer_rejected_at, customer_selected_candidates, customer_confirmation_version, created_at, updated_at";
  const CHECK_COLUMNS = "id, bill_id, user_id, status, outcome, summary, customer_message, started_at, completed_at, created_at, updated_at";
  const ANOMALY_COLUMNS = "id, bill_id, check_id, category, severity, status, title, description, estimated_impact_eur, created_at";

  let client = null;
  let initialized = false;
  let authSubscription = null;
  let syncSequence = 0;
  let currentUser = null;
  let currentSubscription = null;
  let maintenanceMode = false;
  let operationBlockReason = "";
  let utilities = [];
  let bills = [];
  let contracts = [];
  let checks = [];
  let anomalies = [];
  let periodBillCount = 0;
  let busy = false;
  const expandedBillIds = new Set();
  const analysisInFlightIds = new Set();
  let pollTimer = null;

  const byId = id => document.getElementById(id);

  const state = {
    card: null,
    statusBadge: null,
    quota: null,
    locked: null,
    lockedTitle: null,
    lockedCopy: null,
    enabled: null,
    noUtilities: null,
    utilitySelect: null,
    fileInput: null,
    uploadButton: null,
    uploadButtonLabel: null,
    message: null,
    empty: null,
    list: null,
    homeCount: null,
    profileCount: null,
    profileSize: null,
    spendTotal: null,
    spendMeta: null,
    spendYear: null
  };

  function setText(element, value) {
    if (element) element.textContent = value;
  }

  function setMessage(kind, message) {
    if (!state.message) return;
    state.message.className = `cloud-bill-message${kind ? ` ${kind}` : ""}`;
    state.message.textContent = message || "";
    state.message.hidden = !message;
  }

  function setBusy(value) {
    busy = Boolean(value);
    if (state.utilitySelect) state.utilitySelect.disabled = busy || maintenanceMode || !utilities.length;
    if (state.uploadButton) state.uploadButton.disabled = busy || !canUpload();
    if (state.fileInput) state.fileInput.disabled = busy || maintenanceMode || !utilities.length;
    if (state.uploadButtonLabel) state.uploadButtonLabel.textContent = busy ? "OPERAZIONE…" : "SCEGLI PDF";
    state.list?.querySelectorAll("button, select").forEach(control => {
      control.disabled = Boolean(busy) || control.dataset.permanentDisabled === "true";
    });
    state.card?.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
  }

  function formatSize(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 KB";
    if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1000))} KB`;
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(".", ",")} MB`;
  }

  function formatMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(amount);
  }

  function validDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function billReferenceDate(bill) {
    return validDate(bill.billing_period_end) || validDate(bill.issue_date) || new Date(bill.created_at);
  }

  function formatPeriod(bill) {
    const start = validDate(bill.billing_period_start);
    const end = validDate(bill.billing_period_end);
    if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
    if (end) return `fino al ${formatDate(end)}`;
    if (start) return `dal ${formatDate(start)}`;
    return "Periodo non letto";
  }

  function supplyLabel(value) {
    return {
      electricity: "Luce",
      gas: "Gas",
      dual: "Luce e gas"
    }[value] || "Utenza";
  }

  function trafficLight(bill, check) {
    if (check?.status && !["completed", "canceled"].includes(check.status)) return "red";
    if (check?.status === "completed") {
      if (check.outcome === "anomaly") return "red";
      if (["possible_saving", "inconclusive"].includes(check.outcome)) return "yellow";
      if (check.outcome === "correct") return "green";
    }
    if (bill.automatic_screening_status === "review_recommended") return "red";
    if (["inconclusive", "failed"].includes(bill.automatic_screening_status)) return "yellow";
    if (bill.automatic_screening_status === "clear") return "green";
    return "neutral";
  }

  function statusLabel(bill, check) {
    if (check?.status === "pending") return "Verifica richiesta";
    if (["assigned", "in_review"].includes(check?.status)) return "Verifica in corso";
    if (check?.status === "more_info_required") return "Integrazione";
    if (check?.status === "completed") {
      return {
        correct: "Verde · Regolare",
        anomaly: "Rosso · Anomalia",
        possible_saving: "Giallo · Avviso",
        inconclusive: "Giallo · Avviso"
      }[check.outcome] || "Completato";
    }
    if (check?.status === "canceled") return "Annullato";
    if (["pending", "running"].includes(bill.automatic_screening_status) || ["queued", "analyzing"].includes(bill.processing_status)) return "Analisi in corso";
    if (bill.automatic_screening_status === "clear") return "Verde · Regolare";
    if (bill.automatic_screening_status === "review_recommended") return "Rosso · Anomalia";
    if (["inconclusive", "failed"].includes(bill.automatic_screening_status)) return "Giallo · Avviso";
    if (bill.processing_status === "failed") return "Giallo · Avviso";
    return "Archiviata";
  }

  function isBetaTrial() {
    return currentSubscription?.status === "trialing" && currentSubscription?.plan_code === "premium-beta";
  }

  function currentPeriodStartTime() {
    const start = new Date(currentSubscription?.current_period_start || 0).getTime();
    return Number.isFinite(start) && start > 0 ? start : Date.now() - 365 * 24 * 60 * 60 * 1000;
  }

  function trialStaffCheckUsed() {
    if (!isBetaTrial()) return false;
    const start = currentPeriodStartTime();
    const end = new Date(currentSubscription?.current_period_end || 0).getTime();
    return checks.some(check => {
      const created = new Date(check.created_at).getTime();
      return Number.isFinite(created)
        && created >= start
        && (!Number.isFinite(end) || end <= 0 || created < end);
    });
  }

  function isRedCheckRequestable(bill, check) {
    if (maintenanceMode || check) return false;
    return bill.automatic_screening_status === "review_recommended"
      && bill.customer_status === "anomaly_found"
      && bill.processing_status === "completed";
  }

  function canRequestCheck(bill, check) {
    return isRedCheckRequestable(bill, check) && !trialStaffCheckUsed();
  }

  function hasActiveHumanCheck(check) {
    return ["pending", "assigned", "in_review", "more_info_required"].includes(check?.status);
  }

  function canDeleteBill(bill, check) {
    return !hasActiveHumanCheck(check)
      && ["uploaded", "completed", "failed"].includes(bill.processing_status)
      && bill.automatic_screening_status !== "running";
  }

  function checkTitle(check) {
    if (!check) return "Controllo non richiesto";
    if (check.status === "pending") return "Richiesta ricevuta";
    if (check.status === "assigned") return "Controllo assegnato";
    if (check.status === "in_review") return "Controllo in corso";
    if (check.status === "more_info_required") return "Servono informazioni aggiuntive";
    if (check.status === "canceled") return "Controllo annullato";
    if (check.status === "completed") {
      return {
        correct: "Bolletta corretta",
        anomaly: "Anomalia rilevata",
        possible_saving: "Possibile risparmio",
        inconclusive: "Controllo non conclusivo"
      }[check.outcome] || "Controllo completato";
    }
    return "Stato del controllo";
  }

  function checkCopy(check) {
    const staffMessage = String(check?.customer_message || "").trim();
    if (staffMessage) return staffMessage;
    if (check?.status === "pending") return "La bolletta è in coda e sarà presa in carico dallo staff autorizzato.";
    if (check?.status === "assigned") return "La richiesta è stata assegnata a un operatore.";
    if (check?.status === "in_review") return "Lo staff sta verificando prezzi, condizioni e possibili anomalie.";
    if (check?.status === "more_info_required") return "Apri le comunicazioni quando disponibili per vedere cosa occorre integrare.";
    if (check?.status === "completed") {
      const summary = String(check.summary || "").trim();
      if (summary) return summary;
      return "Il controllo è terminato. L’esito è indicato sopra.";
    }
    if (check?.status === "canceled") return "La richiesta non è più attiva.";
    return "La verifica dello staff è disponibile soltanto per le anomalie rosse e dopo la tua richiesta.";
  }

  function friendlyError(error) {
    const raw = String(error?.message || "").trim();
    const message = raw.toLowerCase();
    if (!message) return "Operazione non riuscita. Riprova.";
    if (message.includes("premium_trial_bill_limit_reached") || message.includes("premium bill limit reached") || message.includes("premium_bill_limit_reached") || message.includes("row-level security")) {
      return isBetaTrial()
        ? "Hai già caricato le 4 bollette complessive incluse nella prova gratuita. Eliminare un documento non libera un nuovo caricamento."
        : "Il caricamento non è autorizzato oppure hai raggiunto il limite del piano.";
    }
    if (message.includes("premium_bill_storage_missing")) {
      return "Il PDF non risulta salvato nel cloud. Il caricamento è stato annullato senza consumare la quota della prova.";
    }
    if (message.includes("premium_reserve_trial_bill_upload") || message.includes("premium_mark_bill_upload_complete") || message.includes("premium_trial_bill_usage_count")) {
      return "L’aggiornamento del limite della prova non è ancora installato nel database.";
    }
    if (message.includes("premium_trial_staff_limit_reached")) {
      return "La verifica staff inclusa nella prova è già stata utilizzata.";
    }
    if (message.includes("premium_bill_not_requestable")) {
      return "La verifica dello staff è disponibile soltanto per le anomalie rosse.";
    }
    if (message.includes("premium_bill_not_auto_analyzable")) {
      return "La bolletta non è nello stato corretto per l’analisi automatica.";
    }
    if (message.includes("premium_ai_already_running")) {
      return "L’analisi automatica è già in corso.";
    }
    if (message.includes("premium_service_access_required") || message.includes("premium_auth_required")) {
      return "Il controllo richiede un account e un abbonamento attivo.";
    }
    if (message.includes("premium_legal_acceptance_required") || message.includes("PREMIUM_LEGAL_ACCEPTANCE_REQUIRED")) {
      return "Accetta le condizioni Premium correnti dalla sezione Profilo prima di continuare.";
    }
    if (message.includes("premium_bill_not_found")) {
      return "La bolletta non è più disponibile nell’archivio cloud.";
    }
    if (message.includes("premium_checks_bill_active_uidx")) {
      return "Il controllo di questa bolletta è già stato richiesto.";
    }
    if (message.includes("duplicate key") || message.includes("premium_bills_user_sha_active_uidx")) {
      return "Questa bolletta risulta già presente nell’archivio cloud.";
    }
    if (message.includes("payload too large") || message.includes("maximum allowed size")) {
      return "Il PDF supera il limite massimo di 20 MB.";
    }
    if (message.includes("mime") || message.includes("content type")) {
      return "Il file selezionato non è un PDF valido.";
    }
    if (message.includes("object not found") || message.includes("not found")) {
      return "Il PDF non è più disponibile nell’archivio cloud.";
    }
    if (message.includes("permission denied")) {
      return "Operazione non autorizzata. Verifica che l’abbonamento sia attivo.";
    }
    if (message.includes("failed to fetch") || message.includes("network")) {
      return "Connessione non disponibile. Controlla la rete e riprova.";
    }
    return raw || "Operazione non riuscita. Riprova.";
  }

  function subscriptionIsActive(profile, subscription) {
    if (profile?.account_status !== "active" || !subscription) return false;
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return false;
    if (!subscription.current_period_end) return true;
    const end = new Date(subscription.current_period_end);
    return !Number.isNaN(end.getTime()) && end > new Date();
  }

  function archiveIsAvailable(profile, subscription) {
    if (!profile || !["active", "deletion_requested"].includes(profile.account_status)) return false;
    if (!subscription || subscription.data_purged_at || !subscription.archive_access_until) return false;
    const end = new Date(subscription.archive_access_until);
    return !Number.isNaN(end.getTime()) && end > new Date();
  }

  async function refreshTrialLifecycle() {
    const { error } = await client.rpc("premium_refresh_trial_lifecycle");
    if (!error) return;
    const message = String(error.message || error || "").toLowerCase();
    if (message.includes("premium_refresh_trial_lifecycle") || message.includes("schema cache") || message.includes("function")) return;
    throw error;
  }

  function planLimit() {
    const fallback = isBetaTrial() ? 4 : 12;
    return Math.max(1, Number(currentSubscription?.included_bills_per_year || fallback));
  }

  function canUpload() {
    return Boolean(!maintenanceMode && currentUser && currentSubscription && utilities.length && periodBillCount < planLimit() && !busy);
  }

  function renderLocked(title, copy, badge = "BLOCCATO", quota = "Non attivo") {
    currentSubscription = null;
    maintenanceMode = false;
    operationBlockReason = "";
    utilities = [];
    bills = [];
    contracts = [];
    checks = [];
    anomalies = [];
    expandedBillIds.clear();
    periodBillCount = 0;
    if (state.locked) state.locked.hidden = false;
    if (state.enabled) state.enabled.hidden = true;
    setText(state.lockedTitle, title);
    setText(state.lockedCopy, copy);
    setText(state.statusBadge, badge);
    setText(state.quota, quota);
    setText(state.homeCount, "—");
    setText(state.profileCount, "0");
    setText(state.profileSize, "0 KB");
    setMessage("", "");
  }

  function renderLoading() {
    if (state.locked) state.locked.hidden = false;
    if (state.enabled) state.enabled.hidden = true;
    setText(state.lockedTitle, "Verifica dell’archivio cloud…");
    setText(state.lockedCopy, "Controllo account, abbonamento, utenze e bollette.");
    setText(state.statusBadge, "ATTENDI");
    setText(state.quota, "—");
    setText(state.homeCount, "—");
    setMessage("", "");
  }

  function renderUtilityOptions() {
    if (!state.utilitySelect) return;
    const previous = state.utilitySelect.value;
    state.utilitySelect.replaceChildren();

    utilities.forEach(utility => {
      const option = document.createElement("option");
      option.value = utility.id;
      option.textContent = `${utility.label} · ${supplyLabel(utility.supply_type)}`;
      state.utilitySelect.append(option);
    });

    if (previous && utilities.some(utility => utility.id === previous)) {
      state.utilitySelect.value = previous;
    }
  }

  function renderEnabled() {
    if (state.locked) state.locked.hidden = true;
    if (state.enabled) state.enabled.hidden = false;
    const legalBlocked = maintenanceMode && operationBlockReason === "legal";
    setText(state.statusBadge, legalBlocked ? "CONDIZIONI" : (maintenanceMode ? "ARCHIVIO" : (currentSubscription?.status === "trialing" ? "PROVA" : "ATTIVO")));
    setText(state.quota, legalBlocked
      ? "Accettazione richiesta"
      : (maintenanceMode
        ? (operationBlockReason === "archive" ? `Sola lettura fino al ${formatDate(currentSubscription?.archive_access_until)}` : "Sola gestione")
        : (isBetaTrial() ? `${periodBillCount} / ${planLimit()} bollette complessive della prova` : `${periodBillCount} / ${planLimit()}`)));
    setText(state.homeCount, String(bills.length));
    setText(state.profileCount, String(bills.length));
    setText(state.profileSize, formatSize(bills.reduce((sum, bill) => sum + Number(bill.file_size || 0), 0)));

    renderUtilityOptions();
    if (state.noUtilities) state.noUtilities.hidden = maintenanceMode || utilities.length > 0;
    if (state.utilitySelect) state.utilitySelect.hidden = maintenanceMode || utilities.length === 0;
    if (state.uploadButton) state.uploadButton.hidden = maintenanceMode || utilities.length === 0;
    setBusy(false);
    renderCloudSpend();
    renderList();
    if (!maintenanceMode) scheduleAutomaticWork();
    else if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function renderCloudSpend() {
    if (!state.spendTotal || !state.spendMeta || !state.spendYear) return;
    const availableYears = [...new Set(bills.map(bill => billReferenceDate(bill)?.getFullYear()).filter(Number.isFinite))].sort((a, b) => b - a);
    const current = Number(state.spendYear.value);
    state.spendYear.replaceChildren();
    if (!availableYears.length) availableYears.push(new Date().getFullYear());
    availableYears.forEach(year => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      state.spendYear.append(option);
    });
    state.spendYear.value = availableYears.includes(current) ? String(current) : String(availableYears[0]);
    const year = Number(state.spendYear.value);
    const included = bills.filter(bill => billReferenceDate(bill)?.getFullYear() === year && Number.isFinite(Number(bill.total_amount_eur)));
    const total = included.reduce((sum, bill) => sum + Number(bill.total_amount_eur || 0), 0);
    setText(state.spendTotal, formatMoney(total));
    setText(state.spendMeta, included.length
      ? `${included.length === 1 ? "Importo di 1 bolletta archiviata" : `Somma degli importi di ${included.length} bollette archiviate`} nel ${year}.`
      : `Nessuna bolletta con importo disponibile nel ${year}.`);
  }

  function priceTypeLabel(value) {
    return ({ fixed: "Prezzo fisso", indexed: "Prezzo indicizzato", mixed: "Prezzo misto", unknown: "Tipo non definito" })[value] || "Tipo non definito";
  }

  function formatUnitPrice(value, unit) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return `${amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",")} ${unit}`;
  }

  function contractForBill(bill) {
    if (!bill?.contract_id) return null;
    return contracts.find(contract => contract.id === bill.contract_id) || null;
  }

  function offerBadge(contract) {
    if (contract?.customer_confirmation_status === "confirmed") return "CONFERMATA";
    if (contract?.customer_confirmation_status === "rejected" || contract?.verification_status === "rejected") return "NON CONFERMATA";
    if (contract?.verification_status === "verified") return "IDENTIFICATA";
    if (contract?.customer_confirmation_status === "pending") return "DA CONFERMARE";
    return "PROVVISORIA";
  }

  function offerIntro(contract) {
    if (contract?.customer_confirmation_status === "confirmed") {
      return "Hai confermato questa corrispondenza. Le condizioni registrate vengono usate anche per ricontrollare la bolletta senza una nuova lettura IA.";
    }
    if (contract?.verification_status === "verified") {
      return "L’offerta è stata identificata automaticamente nello storico ARERA con corrispondenza sufficientemente affidabile.";
    }
    if (contract?.customer_confirmation_status === "rejected" || contract?.verification_status === "rejected") {
      return "Hai indicato che la proposta non corrisponde alla tua offerta. La scheda resta esclusa dai controlli contrattuali automatici.";
    }
    if (contract?.customer_confirmation_status === "pending") {
      return "Il sistema ha trovato una o più offerte compatibili. Serve soltanto riconoscere quella corretta oppure indicare che non è presente.";
    }
    return "La scheda è stata ricostruita dalla bolletta, ma non è stata verificata nello storico ARERA.";
  }

  function candidateGroups(contract) {
    return (Array.isArray(contract?.automatic_match_candidates) ? contract.automatic_match_candidates : [])
      .filter(group => group && ["luce", "gas"].includes(group.commodity))
      .map(group => ({
        commodity: group.commodity,
        candidates: (Array.isArray(group.candidates) ? group.candidates : []).filter(Boolean)
      }));
  }

  function candidateText(candidate) {
    const parts = [candidate.offerName || "Offerta senza nome"];
    if (candidate.providerName) parts.push(candidate.providerName);
    if (candidate.priceType === "fisso" && Number.isFinite(Number(candidate.price))) {
      parts.push(formatUnitPrice(candidate.price, candidate.commodity === "gas" ? "€/Smc" : "€/kWh"));
    } else if (candidate.priceType === "variabile") {
      const index = candidate.indexName || (candidate.commodity === "gas" ? "PSV" : "PUN");
      const spread = Number(candidate.spreadEstimate);
      parts.push(Number.isFinite(spread) ? `${index} + ${formatUnitPrice(spread, candidate.commodity === "gas" ? "€/Smc" : "€/kWh")}` : index);
    }
    if (Number.isFinite(Number(candidate.annualFixedFee))) parts.push(`${formatMoney(candidate.annualFixedFee)}/anno`);
    return parts.join(" · ");
  }

  function offerRows(contract) {
    const rows = [];
    if (contract.provider_name) rows.push(["Fornitore", contract.provider_name]);
    if (contract.offer_name) rows.push(["Offerta", contract.offer_name]);
    rows.push(["Struttura", priceTypeLabel(contract.pricing_type)]);
    if (contract.arera_offer_code_electricity) rows.push(["Codice luce", contract.arera_offer_code_electricity]);
    if (contract.arera_offer_code_gas) rows.push(["Codice gas", contract.arera_offer_code_gas]);
    if (Number.isFinite(Number(contract.electricity_price_eur_kwh))) rows.push(["Prezzo luce", formatUnitPrice(contract.electricity_price_eur_kwh, "€/kWh")]);
    if (Number.isFinite(Number(contract.gas_price_eur_smc))) rows.push(["Prezzo gas", formatUnitPrice(contract.gas_price_eur_smc, "€/Smc")]);
    if (contract.electricity_index_name) {
      const spread = Number(contract.electricity_spread_eur_kwh);
      rows.push(["Formula luce", Number.isFinite(spread) ? `${contract.electricity_index_name} + ${formatUnitPrice(spread, "€/kWh")}` : contract.electricity_index_name]);
    }
    if (contract.gas_index_name) {
      const spread = Number(contract.gas_spread_eur_smc);
      rows.push(["Formula gas", Number.isFinite(spread) ? `${contract.gas_index_name} + ${formatUnitPrice(spread, "€/Smc")}` : contract.gas_index_name]);
    }
    if (Number.isFinite(Number(contract.electricity_fixed_fee_eur_year))) rows.push(["Quota fissa luce", `${formatMoney(contract.electricity_fixed_fee_eur_year)}/anno`]);
    if (Number.isFinite(Number(contract.gas_fixed_fee_eur_year))) rows.push(["Quota fissa gas", `${formatMoney(contract.gas_fixed_fee_eur_year)}/anno`]);
    if (contract.fixed_price_expiry) rows.push(["Scadenza condizioni", formatDate(contract.fixed_price_expiry)]);
    return rows;
  }

  function canConfirmOffer(contract) {
    const groups = candidateGroups(contract);
    return contract?.customer_confirmation_status === "pending"
      && contract?.verification_status === "needs_review"
      && groups.length > 0
      && groups.every(group => group.candidates.length > 0);
  }

  function renderOfferCard(bill, contract, { allowActions = true } = {}) {
    const card = document.createElement("section");
    card.className = "cloud-offer-card";
    card.dataset.cloudOfferContract = contract.id;

    const head = document.createElement("div");
    head.className = "cloud-offer-head";
    const title = document.createElement("div");
    const eyebrow = document.createElement("small");
    eyebrow.textContent = "OFFERTA ATTIVA";
    const strong = document.createElement("strong");
    strong.textContent = contract.offer_name || contract.provider_name || "Offerta ricostruita";
    title.append(eyebrow, strong);
    const badge = document.createElement("span");
    badge.className = "cloud-offer-badge";
    badge.textContent = offerBadge(contract);
    head.append(title, badge);

    const intro = document.createElement("p");
    intro.textContent = offerIntro(contract);
    card.append(head, intro);

    const rows = offerRows(contract);
    if (rows.length) {
      const grid = document.createElement("div");
      grid.className = "cloud-offer-grid";
      rows.forEach(([label, value]) => {
        const row = document.createElement("div");
        row.className = "cloud-offer-row";
        const key = document.createElement("span");
        key.textContent = label;
        const text = document.createElement("strong");
        text.textContent = value;
        row.append(key, text);
        grid.append(row);
      });
      card.append(grid);
    }

    if (allowActions && canConfirmOffer(contract)) {
      const groups = candidateGroups(contract);
      const candidates = document.createElement("div");
      candidates.className = "cloud-offer-candidates";
      groups.forEach(group => {
        const field = document.createElement("label");
        field.className = "cloud-offer-field";
        const fieldLabel = document.createElement("span");
        fieldLabel.textContent = group.commodity === "gas" ? "Offerta gas" : "Offerta luce";
        const select = document.createElement("select");
        select.dataset.offerCandidateSelect = contract.id;
        select.dataset.offerCandidateCommodity = group.commodity;
        select.setAttribute("aria-label", fieldLabel.textContent);
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Seleziona l’offerta che riconosci";
        select.append(placeholder);
        group.candidates.forEach((candidate, index) => {
          const option = document.createElement("option");
          option.value = candidate.key || "";
          option.textContent = candidateText(candidate);
          if (contract.automatic_match_status === "matched" && index === 0) option.selected = true;
          select.append(option);
        });
        field.append(fieldLabel, select);
        candidates.append(field);
      });
      card.append(candidates);

      const actions = document.createElement("div");
      actions.className = "cloud-offer-actions";
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = "cloud-bill-btn primary";
      confirmButton.dataset.offerConfirm = contract.id;
      confirmButton.dataset.offerBill = bill.id;
      confirmButton.textContent = "CONFERMA OFFERTA";
      const rejectButton = document.createElement("button");
      rejectButton.type = "button";
      rejectButton.className = "cloud-bill-btn";
      rejectButton.dataset.offerReject = contract.id;
      rejectButton.dataset.offerBill = bill.id;
      rejectButton.textContent = "NON È QUESTA";
      actions.append(confirmButton, rejectButton);
      card.append(actions);
    }

    return card;
  }

  function automaticTitle(bill) {
    return ({
      clear: "Tutto regolare",
      review_recommended: "Anomalia importante",
      inconclusive: "Avviso",
      failed: "Documento da ricaricare",
      running: "Analisi in corso",
      pending: "Analisi in attesa"
    })[bill.automatic_screening_status] || "Analisi";
  }

  function renderAutomaticDetail(bill) {
    const detail = document.createElement("section");
    detail.className = "cloud-check-detail automatic";
    detail.dataset.cloudAutomaticDetail = bill.id;
    detail.hidden = !expandedBillIds.has(bill.id);
    const head = document.createElement("div");
    head.className = "cloud-check-detail-head";
    const title = document.createElement("strong");
    title.textContent = automaticTitle(bill);
    const badge = document.createElement("span");
    badge.className = `cloud-check-detail-badge ${trafficLight(bill, null)}`;
    badge.textContent = statusLabel(bill, null);
    head.append(title, badge);
    const copy = document.createElement("p");
    copy.textContent = bill.automatic_screening_summary || (bill.automatic_screening_status === "running"
      ? "Analisi della bolletta in corso."
      : "Il risultato automatico sarà disponibile al termine dell’analisi.");
    detail.append(head, copy);
    const contract = contractForBill(bill);
    if (contract) detail.append(renderOfferCard(bill, contract, { allowActions: !maintenanceMode }));
    const reasons = Array.isArray(bill.automatic_screening_reasons) ? bill.automatic_screening_reasons : [];
    if (reasons.length) {
      const list = document.createElement("div");
      list.className = "cloud-anomaly-list";
      reasons.forEach(reason => {
        const item = document.createElement("div");
        item.className = "cloud-anomaly-item";
        const reasonTitle = document.createElement("strong");
        reasonTitle.textContent = reason.title || "Elemento da approfondire";
        const description = document.createElement("p");
        description.textContent = reason.description || "Consulta il dettaglio dell’avviso.";
        item.classList.add(reason.trafficLight === "red" ? "red" : "yellow");
        item.append(reasonTitle, description);
        list.append(item);
      });
      detail.append(list);
    }
    if (bill.automatic_screened_at) {
      const meta = document.createElement("small");
      meta.textContent = `Analisi automatica del ${formatDate(bill.automatic_screened_at)}`;
      detail.append(meta);
    }
    return detail;
  }

  function renderCheckDetail(bill, check, billAnomalies) {
    const detail = document.createElement("section");
    detail.className = "cloud-check-detail";
    detail.dataset.cloudCheckDetail = bill.id;
    detail.hidden = !expandedBillIds.has(bill.id);

    const head = document.createElement("div");
    head.className = "cloud-check-detail-head";
    const title = document.createElement("strong");
    title.textContent = checkTitle(check);
    const stateBadge = document.createElement("span");
    stateBadge.className = `cloud-check-detail-badge ${trafficLight(bill, check)}`;
    stateBadge.textContent = statusLabel(bill, check);
    head.append(title, stateBadge);

    const copy = document.createElement("p");
    copy.textContent = checkCopy(check);
    detail.append(head, copy);
    const contract = contractForBill(bill);
    if (contract) detail.append(renderOfferCard(bill, contract, { allowActions: false }));

    if (check) {
      const meta = document.createElement("small");
      const parts = [`Richiesto il ${formatDate(check.created_at)}`];
      if (check.started_at) parts.push(`iniziato il ${formatDate(check.started_at)}`);
      if (check.completed_at) parts.push(`concluso il ${formatDate(check.completed_at)}`);
      meta.textContent = parts.join(" · ");
      detail.append(meta);
    }

    if (billAnomalies.length) {
      const list = document.createElement("div");
      list.className = "cloud-anomaly-list";
      billAnomalies.forEach(anomaly => {
        const item = document.createElement("div");
        item.className = "cloud-anomaly-item";
        const anomalyTitle = document.createElement("strong");
        anomalyTitle.textContent = anomaly.title || "Anomalia";
        const anomalyCopy = document.createElement("p");
        anomalyCopy.textContent = anomaly.description || "Dettaglio disponibile nel controllo.";
        item.append(anomalyTitle, anomalyCopy);
        const impactValue = Number(anomaly.estimated_impact_eur);
        if (Number.isFinite(impactValue)) {
          const impactText = document.createElement("small");
          impactText.textContent = `Impatto stimato: ${formatMoney(impactValue)}`;
          item.append(impactText);
        }
        list.append(item);
      });
      detail.append(list);
    }

    return detail;
  }

  function renderList() {
    if (!state.list || !state.empty) return;
    state.list.replaceChildren();

    if (!bills.length) {
      state.empty.hidden = false;
      state.list.hidden = true;
      return;
    }

    state.empty.hidden = true;
    state.list.hidden = false;

    const utilityMap = new Map(utilities.map(utility => [utility.id, utility]));
    const checkMap = new Map();
    checks.forEach(check => {
      if (!checkMap.has(check.bill_id)) checkMap.set(check.bill_id, check);
    });
    const anomalyMap = new Map();
    anomalies.forEach(anomaly => {
      const group = anomalyMap.get(anomaly.bill_id) || [];
      group.push(anomaly);
      anomalyMap.set(anomaly.bill_id, group);
    });

    bills.forEach(bill => {
      const utility = utilityMap.get(bill.utility_id);
      const check = checkMap.get(bill.id) || null;
      const contract = contractForBill(bill);
      const billAnomalies = anomalyMap.get(bill.id) || [];
      const article = document.createElement("article");
      article.className = `cloud-bill-item${check ? " has-check" : ""}`;
      article.dataset.cloudBillId = bill.id;

      const icon = document.createElement("div");
      icon.className = "cloud-bill-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "PDF";

      const copy = document.createElement("div");
      copy.className = "cloud-bill-copy";
      const title = document.createElement("strong");
      title.textContent = bill.original_file_name || "Bolletta.pdf";
      const utilityName = document.createElement("span");
      utilityName.textContent = utility?.label || "Utenza";
      const meta = document.createElement("small");
      const amount = Number.isFinite(Number(bill.total_amount_eur)) ? formatMoney(bill.total_amount_eur) : "Importo in lettura";
      meta.textContent = `${formatPeriod(bill)} · ${amount} · ${formatSize(bill.file_size)}`;
      copy.append(title, utilityName, meta);
      if (contract) {
        const offerMeta = document.createElement("small");
        offerMeta.textContent = `Offerta: ${contract.offer_name || contract.provider_name || "provvisoria"} · ${offerBadge(contract).toLowerCase()}`;
        copy.append(offerMeta);
      }

      const badge = document.createElement("span");
      badge.className = `cloud-bill-status ${trafficLight(bill, check)}`;
      badge.textContent = statusLabel(bill, check);

      const actions = document.createElement("div");
      actions.className = "cloud-bill-actions";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "cloud-bill-btn";
      openButton.dataset.cloudBillOpen = bill.id;
      openButton.textContent = "APRI";
      actions.append(openButton);

      if (check) {
        const toggleButton = document.createElement("button");
        toggleButton.type = "button";
        toggleButton.className = "cloud-bill-btn primary";
        toggleButton.dataset.cloudCheckToggle = bill.id;
        toggleButton.textContent = expandedBillIds.has(bill.id) ? "CHIUDI" : (check.status === "completed" ? "VEDI ESITO" : "VEDI STATO");
        actions.append(toggleButton);
      } else {
        if (!["not_run"].includes(bill.automatic_screening_status)) {
          const toggleButton = document.createElement("button");
          toggleButton.type = "button";
          toggleButton.className = "cloud-bill-btn";
          toggleButton.dataset.cloudAutomaticToggle = bill.id;
          toggleButton.textContent = expandedBillIds.has(bill.id) ? "CHIUDI" : "VEDI ANALISI";
          actions.append(toggleButton);
        }
        if (canRequestCheck(bill, check)) {
          const requestButton = document.createElement("button");
          requestButton.type = "button";
          requestButton.className = "cloud-bill-btn primary";
          requestButton.dataset.cloudCheckRequest = bill.id;
          requestButton.textContent = "RICHIEDI CONTROLLO";
          actions.append(requestButton);
        } else if (isRedCheckRequestable(bill, check) && trialStaffCheckUsed()) {
          const usedButton = document.createElement("button");
          usedButton.type = "button";
          usedButton.className = "cloud-bill-btn";
          usedButton.dataset.permanentDisabled = "true";
          usedButton.disabled = true;
          usedButton.textContent = "CONTROLLO PROVA GIÀ USATO";
          actions.append(usedButton);
        }
        if (!maintenanceMode && bill.automatic_screening_status === "failed") {
          const retryButton = document.createElement("button");
          retryButton.type = "button";
          retryButton.className = "cloud-bill-btn";
          retryButton.dataset.cloudAnalysisRetry = bill.id;
          retryButton.textContent = "RIPROVA ANALISI";
          actions.append(retryButton);
        }
      }

      if (canDeleteBill(bill, check)) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "cloud-bill-btn danger";
        deleteButton.dataset.cloudBillDelete = bill.id;
        deleteButton.textContent = "ELIMINA";
        actions.append(deleteButton);
      }

      article.append(icon, copy, badge, actions);
      if (check) article.append(renderCheckDetail(bill, check, billAnomalies));
      else if (bill.automatic_screening_status !== "not_run") article.append(renderAutomaticDetail(bill));
      state.list.append(article);
    });
  }

  function validateFile(file) {
    if (!(file instanceof File)) throw new Error("Seleziona un PDF.");
    const name = String(file.name || "").trim();
    const extensionIsPdf = name.toLowerCase().endsWith(".pdf");
    const mimeIsAllowed = !file.type || file.type === "application/pdf";
    if (!extensionIsPdf || !mimeIsAllowed) throw new Error("Seleziona un file PDF valido.");
    if (!file.size) throw new Error("Il PDF selezionato è vuoto.");
    if (file.size > MAX_FILE_SIZE) throw new Error("Il PDF supera il limite massimo di 20 MB.");
  }

  function safeFileName(value) {
    const normalized = String(value || "bolletta.pdf")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 110);
    const base = normalized || "bolletta.pdf";
    return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  }

  function createUuid() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function sha256(file) {
    if (!crypto.subtle) throw new Error("Questo dispositivo non supporta il controllo sicuro dei duplicati.");
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  async function uploadFile(file) {
    if (!client || !currentUser || !currentSubscription || !canUpload()) {
      setMessage("error", "Il caricamento cloud non è disponibile.");
      return;
    }

    try {
      validateFile(file);
    } catch (error) {
      setMessage("error", error.message);
      return;
    }

    const utility = utilities.find(item => item.id === state.utilitySelect?.value);
    if (!utility) {
      setMessage("error", "Seleziona l’utenza da associare alla bolletta.");
      return;
    }

    setBusy(true);
    setMessage("info", "Controllo del PDF e caricamento protetto nel cloud…");

    let storagePath = "";
    try {
      const fingerprint = await sha256(file);
      if (bills.some(bill => bill.file_sha256 && bill.file_sha256 === fingerprint)) {
        throw new Error("Questa bolletta risulta già presente nell’archivio cloud.");
      }

      const billId = createUuid();
      storagePath = `${currentUser.id}/${billId}/${Date.now()}-${safeFileName(file.name)}`;

      const reservationResult = await client.rpc("premium_reserve_trial_bill_upload", { p_bill_id: billId });
      if (reservationResult.error) throw reservationResult.error;

      const releaseReservation = async () => {
        try {
          await client.rpc("premium_release_trial_bill_upload", { p_bill_id: billId });
        } catch {}
      };

      const insertResult = await client
        .from("premium_bills")
        .insert({
          id: billId,
          user_id: currentUser.id,
          utility_id: utility.id,
          commodity: utility.supply_type,
          original_file_name: file.name,
          file_size: file.size,
          file_sha256: fingerprint,
          storage_bucket: BUCKET,
          storage_path: storagePath,
          processing_status: "uploaded",
          customer_status: "awaiting_review",
          metadata: {
            source: "premium_app",
            app_version: "0.36.15",
            automatic_analysis: true,
            upload_complete: false
          }
        })
        .select(BILL_COLUMNS)
        .single();
      if (insertResult.error) {
        await releaseReservation();
        throw insertResult.error;
      }

      const uploadResult = await client.storage
        .from(BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: "application/pdf",
          upsert: false
        });

      if (uploadResult.error) {
        await client.storage.from(BUCKET).remove([storagePath]);
        await client
          .from("premium_bills")
          .delete()
          .eq("id", billId)
          .eq("user_id", currentUser.id);
        await releaseReservation();
        throw uploadResult.error;
      }

      const commitResult = await client.rpc("premium_mark_bill_upload_complete", { p_bill_id: billId });
      if (commitResult.error) {
        const confirmationResult = await client
          .from("premium_bills")
          .select("metadata")
          .eq("id", billId)
          .eq("user_id", currentUser.id)
          .maybeSingle();
        const uploadWasCommitted = confirmationResult.data?.metadata?.upload_complete === true;
        if (!uploadWasCommitted) {
          await client.storage.from(BUCKET).remove([storagePath]);
          await client
            .from("premium_bills")
            .delete()
            .eq("id", billId)
            .eq("user_id", currentUser.id);
          await releaseReservation();
          throw commitResult.error;
        }
      }

      bills = [insertResult.data, ...bills];
      periodBillCount += 1;
      renderEnabled();
      setMessage("info", "Bolletta salvata. Analisi in corso.");
      window.dispatchEvent(new CustomEvent("offertalogica:cloud-bills-changed"));
      await runAutomaticAnalysis(billId, { announce: true });
    } catch (error) {
      setBusy(false);
      setMessage("error", friendlyError(error));
    } finally {
      if (state.fileInput) state.fileInput.value = "";
    }
  }

  function selectedOfferCandidates(contractId) {
    const selects = [...state.list.querySelectorAll("[data-offer-candidate-select]")]
      .filter(select => select.dataset.offerCandidateSelect === contractId);
    if (!selects.length) throw new Error("Le offerte compatibili non sono disponibili.");
    return selects.map(select => {
      if (!select.value) throw new Error("Seleziona l’offerta che riconosci prima di confermare.");
      return { commodity: select.dataset.offerCandidateCommodity, key: select.value };
    });
  }

  async function sendOfferDecision(contractId, billId, decision) {
    if (!client || !currentUser || busy) return;
    if (maintenanceMode) {
      setMessage("error", operationBlockReason === "legal"
        ? "Accetta le condizioni Premium correnti dalla sezione Profilo prima di confermare l’offerta."
        : "La conferma dell’offerta richiede un abbonamento attivo.");
      return;
    }
    const contract = contracts.find(item => item.id === contractId);
    if (!contract || contract.customer_confirmation_status !== "pending") {
      setMessage("error", "Questa proposta non è più in attesa di conferma.");
      return;
    }

    let selections = [];
    if (decision === "confirm") {
      try { selections = selectedOfferCandidates(contractId); }
      catch (error) { setMessage("error", friendlyError(error)); return; }
    } else {
      const confirmed = window.confirm("Confermi che la proposta mostrata non corrisponde alla tua offerta attiva?");
      if (!confirmed) return;
    }

    setBusy(true);
    setMessage("info", decision === "confirm" ? "Registrazione e nuovo controllo delle condizioni…" : "Registrazione della mancata corrispondenza…");
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("premium_auth_required");
      const response = await fetch("/api/premium-ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          action: decision === "confirm" ? "confirm_offer" : "reject_offer",
          contractId,
          billId,
          selections
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) throw new Error(body?.error || body?.code || "Conferma non riuscita");
      expandedBillIds.add(billId);
      await loadData(currentUser, currentSubscription);
      if (decision === "confirm") {
        const kind = body?.screening?.status === "clear" ? "success" : "info";
        setMessage(kind, body?.screening?.summary || "Offerta confermata e condizioni registrate.");
      } else {
        setMessage("success", "Proposta esclusa. La scheda resta provvisoria e non viene usata per i controlli contrattuali.");
      }
      window.dispatchEvent(new CustomEvent("offertalogica:offer-confirmation-changed", {
        detail: { billId, contractId, decision, screening: body?.screening || null }
      }));
    } catch (error) {
      setMessage("error", friendlyError(error));
    } finally {
      setBusy(false);
      renderEnabled();
    }
  }

  async function requestCheck(id) {
    if (maintenanceMode) {
      setMessage("error", operationBlockReason === "legal"
        ? "Accetta le condizioni Premium correnti dalla sezione Profilo prima di richiedere il controllo."
        : "La richiesta di controllo richiede un abbonamento attivo.");
      return;
    }
    const bill = bills.find(item => item.id === id);
    if (!bill || !client || !currentUser || busy) return;
    if (checks.some(check => check.bill_id === bill.id && check.status !== "canceled")) {
      setMessage("info", "Il controllo di questa bolletta è già stato richiesto.");
      return;
    }
    if (trialStaffCheckUsed()) {
      setMessage("error", "La verifica staff inclusa nella prova è già stata utilizzata.");
      return;
    }
    if (!canRequestCheck(bill, null)) {
      setMessage("error", "La verifica dello staff è disponibile soltanto per le anomalie rosse.");
      return;
    }

    const confirmed = window.confirm(`Inviare “${bill.original_file_name}” al controllo professionale OffertaLogica? Autorizzi lo staff incaricato ad accedere al PDF esclusivamente per questa verifica. Dopo la presa in carico non potrai eliminarlo dall’app.`);
    if (!confirmed) return;

    setBusy(true);
    setMessage("info", "Invio della richiesta di controllo…");
    const result = await client.rpc("premium_request_check", { p_bill_id: bill.id });
    if (result.error) {
      setBusy(false);
      setMessage("error", friendlyError(result.error));
      return;
    }

    try {
      expandedBillIds.add(bill.id);
      await loadData(currentUser, currentSubscription);
      setMessage("success", "Richiesta inviata. La bolletta risulta ora da verificare.");
      window.dispatchEvent(new CustomEvent("offertalogica:professional-checks-changed", {
        detail: { billId: bill.id, checkId: result.data }
      }));
    } catch (error) {
      setBusy(false);
      setMessage("error", `La richiesta è stata registrata, ma lo stato non si è aggiornato: ${friendlyError(error)}`);
    }
  }

  async function runAutomaticAnalysis(id, { announce = false } = {}) {
    if (maintenanceMode) return;
    const bill = bills.find(item => item.id === id);
    if (!bill || !client || !currentUser || analysisInFlightIds.has(id)) return;
    analysisInFlightIds.add(id);
    bill.automatic_screening_status = "running";
    bill.processing_status = "analyzing";
    renderEnabled();
    if (announce) setMessage("info", "Analisi in corso. Puoi continuare a usare l’app.");
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error("premium_auth_required");
      const response = await fetch("/api/premium-ai-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ billId: id })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) throw new Error(body?.error || body?.code || "Analisi automatica non riuscita");
      await loadData(currentUser, currentSubscription);
      const updated = bills.find(item => item.id === id);
      if (announce || updated?.automatic_screening_status !== "clear") {
        setMessage(updated?.automatic_screening_status === "clear" ? "success" : "info",
          updated?.automatic_screening_summary || "Analisi automatica completata.");
      }
      window.dispatchEvent(new CustomEvent("offertalogica:automatic-analysis-completed", { detail: { billId: id, screening: body.screening } }));
    } catch (error) {
      await loadData(currentUser, currentSubscription).catch(() => {});
      setMessage("error", `${friendlyError(error)} Riprova oppure carica un PDF più leggibile.`);
    } finally {
      analysisInFlightIds.delete(id);
      renderEnabled();
    }
  }

  function scheduleAutomaticWork() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    const recentPending = bills.find(bill =>
      bill.automatic_screening_status === "pending"
      && bill.processing_status === "uploaded"
      && Date.now() - new Date(bill.created_at).getTime() < 24 * 60 * 60 * 1000
      && !analysisInFlightIds.has(bill.id)
    );
    if (recentPending) {
      window.setTimeout(() => runAutomaticAnalysis(recentPending.id), 100);
      return;
    }
    if (bills.some(bill => bill.processing_status === "analyzing" || bill.automatic_screening_status === "running")) {
      pollTimer = window.setTimeout(async () => {
        try { await loadData(currentUser, currentSubscription); } catch {}
      }, 5000);
    }
  }

  async function openBill(id) {
    const bill = bills.find(item => item.id === id);
    if (!bill || !client || busy) return;

    setBusy(true);
    setMessage("info", "Apertura del PDF cloud…");
    const result = await client.storage.from(BUCKET).download(bill.storage_path);
    setBusy(false);

    if (result.error) {
      setMessage("error", friendlyError(result.error));
      return;
    }

    setMessage("", "");
    try {
      globalThis.OffertaLogicaAppBrowser?.openPdf(result.data, bill.original_file_name, {
        subtitle: "Documento cloud Premium"
      });
    } catch (error) {
      setMessage("error", friendlyError(error));
    }
  }

  async function deleteBill(id) {
    const bill = bills.find(item => item.id === id);
    if (!bill || !client || !currentUser || busy) return;
    const check = checks.find(item => item.bill_id === bill.id && item.status !== "canceled") || null;
    if (!canDeleteBill(bill, check)) {
      const message = hasActiveHumanCheck(check)
        ? "La bolletta è coinvolta in un controllo umano ancora attivo. Potrai eliminarla dopo la chiusura o l’annullamento del controllo."
        : "La bolletta non può essere eliminata mentre l’analisi automatica è in corso.";
      setMessage("error", message);
      return;
    }

    const confirmed = window.confirm(`Eliminare definitivamente “${bill.original_file_name}” dall’archivio cloud?`);
    if (!confirmed) return;

    setBusy(true);
    setMessage("info", "Eliminazione della bolletta cloud…");

    const storageResult = await client.storage.from(BUCKET).remove([bill.storage_path]);
    if (storageResult.error) {
      setBusy(false);
      setMessage("error", friendlyError(storageResult.error));
      return;
    }

    const databaseResult = await client
      .from("premium_bills")
      .delete()
      .eq("id", bill.id)
      .eq("user_id", currentUser.id);

    setBusy(false);
    if (databaseResult.error) {
      setMessage("error", "Il PDF è stato rimosso, ma il registro non si è aggiornato. Ricarica la pagina prima di altre operazioni.");
      return;
    }

    bills = bills.filter(item => item.id !== bill.id);
    checks = checks.filter(item => item.bill_id !== bill.id);
    anomalies = anomalies.filter(item => item.bill_id !== bill.id);
    const createdAt = new Date(bill.created_at).getTime();
    if (!isBetaTrial() && Number.isFinite(createdAt) && createdAt >= currentPeriodStartTime()) {
      periodBillCount = Math.max(0, periodBillCount - 1);
    }
    renderEnabled();
    setMessage("success", "Bolletta eliminata dall’archivio cloud.");
    window.dispatchEvent(new CustomEvent("offertalogica:cloud-bills-changed"));
  }

  async function loadData(user, subscription, { blockReason = "", readOnly = false } = {}) {
    const countStart = subscription?.current_period_start
      ? new Date(subscription.current_period_start).toISOString()
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const [utilitiesResult, billsResult, countResult, trialUsageResult, contractsResult, checksResult, anomaliesResult] = await Promise.all([
      client
        .from("premium_utilities")
        .select(UTILITY_COLUMNS)
        .eq("user_id", user.id)
        .neq("status", "archived")
        .order("created_at", { ascending: true }),
      client
        .from("premium_bills")
        .select(BILL_COLUMNS)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("premium_bills")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .gte("created_at", countStart),
      client.rpc("premium_trial_bill_usage_count"),
      client
        .from("premium_contracts")
        .select(CONTRACT_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("premium_checks")
        .select(CHECK_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
      client
        .from("premium_anomalies")
        .select(ANOMALY_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(300)
    ]);

    if (utilitiesResult.error) throw utilitiesResult.error;
    if (billsResult.error) throw billsResult.error;
    if (countResult.error) throw countResult.error;
    if (trialUsageResult.error) {
      const usageMessage = String(trialUsageResult.error.message || trialUsageResult.error || "").toLowerCase();
      const missingUsageFunction = usageMessage.includes("premium_trial_bill_usage_count")
        || usageMessage.includes("schema cache")
        || usageMessage.includes("could not find the function");
      if (!missingUsageFunction) throw trialUsageResult.error;
    }
    if (contractsResult.error) throw contractsResult.error;
    if (checksResult.error) throw checksResult.error;
    if (anomaliesResult.error) throw anomaliesResult.error;

    currentUser = user;
    currentSubscription = subscription;
    maintenanceMode = readOnly || !subscription;
    operationBlockReason = maintenanceMode ? blockReason : "";
    utilities = Array.isArray(utilitiesResult.data) ? utilitiesResult.data : [];
    bills = Array.isArray(billsResult.data) ? billsResult.data : [];
    contracts = Array.isArray(contractsResult.data) ? contractsResult.data : [];
    checks = Array.isArray(checksResult.data) ? checksResult.data : [];
    anomalies = Array.isArray(anomaliesResult.data) ? anomaliesResult.data : [];
    periodBillCount = isBetaTrial()
      ? Number(trialUsageResult.data ?? countResult.count ?? 0)
      : Number(countResult.count || 0);
    renderEnabled();
  }

  async function syncSession(session) {
    const sequence = ++syncSequence;
    currentUser = session?.user || null;
    currentSubscription = null;
    maintenanceMode = false;
    operationBlockReason = "";
    utilities = [];
    bills = [];
    contracts = [];
    checks = [];
    anomalies = [];
    expandedBillIds.clear();
    periodBillCount = 0;

    if (!session?.user) {
      renderLocked("Accedi per usare l’archivio cloud", "Le bollette cloud sono disponibili soltanto con account e abbonamento Premium.", "ACCESSO", "Non collegato");
      return;
    }

    renderLoading();
    const userId = session.user.id;
    try {
      await refreshTrialLifecycle();
    } catch (error) {
      setMessage("info", "Lo stato della prova non è stato aggiornato. Ricarica la pagina se la scadenza non risulta corretta.");
    }
    if (sequence !== syncSequence) return;
    const [profileResult, subscriptionResult, acceptanceResult] = await Promise.all([
      client
        .from("premium_profiles")
        .select("account_status")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("premium_subscriptions")
        .select("status, plan_code, current_period_start, current_period_end, archive_access_until, data_purged_at, included_bills_per_year, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client.rpc("premium_has_current_acceptances")
    ]);

    if (sequence !== syncSequence) return;
    if (profileResult.error) {
      renderLocked("Profilo non disponibile", "Non è stato possibile verificare il profilo Premium.", "ERRORE", "—");
      setMessage("error", friendlyError(profileResult.error));
      return;
    }
    if (subscriptionResult.error) {
      renderLocked("Abbonamento non verificabile", "Non è stato possibile controllare lo stato del servizio.", "ERRORE", "—");
      setMessage("error", friendlyError(subscriptionResult.error));
      return;
    }
    if (acceptanceResult.error) {
      renderLocked("Condizioni non verificabili", "Non è stato possibile verificare le accettazioni Premium correnti.", "ERRORE", "—");
      setMessage("error", friendlyError(acceptanceResult.error));
      return;
    }

    const profile = profileResult.data;
    const subscription = subscriptionResult.data;
    if (!profile) {
      renderLocked("Profilo Premium non abilitato", "L’account email è valido, ma non risulta associato al servizio Premium.", "DA VERIFICARE", "Non disponibile");
      return;
    }
    const activeSubscription = subscriptionIsActive(profile, subscription) ? subscription : null;
    const archiveSubscription = !activeSubscription && archiveIsAvailable(profile, subscription) ? subscription : null;
    const dataSubscription = activeSubscription || archiveSubscription;
    const legalReady = acceptanceResult.data === true;
    const operationalSubscription = activeSubscription && legalReady ? activeSubscription : null;
    const blockReason = activeSubscription && !legalReady ? "legal" : (archiveSubscription ? "archive" : (!activeSubscription ? "subscription" : ""));

    try {
      await loadData(session.user, operationalSubscription || dataSubscription, {
        blockReason,
        readOnly: !operationalSubscription,
      });
      if (activeSubscription && !legalReady) {
        setMessage("info", "Accetta le condizioni Premium correnti dalla sezione Profilo. Le bollette già presenti restano consultabili ed eliminabili.");
      } else if (archiveSubscription) {
        setMessage("info", `Prova terminata: archivio in sola lettura fino al ${formatDate(subscription.archive_access_until)}. Puoi aprire, scaricare o eliminare i documenti già salvati.`);
      } else if (!activeSubscription) {
        setMessage("info", "Il periodo di accesso all’archivio Premium è terminato.");
      }
    } catch (error) {
      if (sequence !== syncSequence) return;
      renderLocked("Archivio cloud non disponibile", "Il profilo è attivo, ma non è stato possibile caricare le bollette.", "ERRORE", "—");
      setMessage("error", friendlyError(error));
    }
  }

  function collectElements() {
    state.card = byId("premiumCloudBillsCard");
    state.statusBadge = byId("premiumCloudBillsStatus");
    state.quota = byId("premiumCloudBillsQuota");
    state.locked = byId("premiumCloudBillsLocked");
    state.lockedTitle = byId("premiumCloudBillsLockedTitle");
    state.lockedCopy = byId("premiumCloudBillsLockedCopy");
    state.enabled = byId("premiumCloudBillsEnabled");
    state.noUtilities = byId("premiumCloudBillsNoUtilities");
    state.utilitySelect = byId("premiumCloudBillUtility");
    state.fileInput = byId("premiumCloudBillFile");
    state.uploadButton = byId("premiumCloudBillUpload");
    state.uploadButtonLabel = byId("premiumCloudBillUploadLabel");
    state.message = byId("premiumCloudBillMessage");
    state.empty = byId("premiumCloudBillEmpty");
    state.list = byId("premiumCloudBillList");
    state.homeCount = byId("homeCloudBillCount");
    state.profileCount = byId("profileCloudBillCount");
    state.profileSize = byId("profileCloudBillSize");
    state.spendTotal = byId("premiumCloudSpendTotal");
    state.spendMeta = byId("premiumCloudSpendMeta");
    state.spendYear = byId("premiumCloudSpendYear");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    collectElements();
    if (!state.card) return;

    client = globalThis.OffertaLogicaPremiumAuth?.getClient?.() || null;
    if (!client) {
      renderLocked("Collegamento non disponibile", "Ricarica la pagina con una connessione attiva.", "ERRORE", "—");
      return;
    }

    state.uploadButton?.addEventListener("click", () => {
      if (maintenanceMode) {
        setMessage("error", operationBlockReason === "legal"
          ? "Accetta le condizioni Premium correnti dalla sezione Profilo prima di caricare nuove bollette."
          : "L’abbonamento non è attivo. Puoi consultare o eliminare i dati già archiviati.");
        return;
      }
      if (!utilities.length) {
        setMessage("error", "Aggiungi prima un’utenza dalla sezione Profilo.");
        return;
      }
      if (periodBillCount >= planLimit()) {
        setMessage("error", isBetaTrial()
          ? "Hai già caricato le 4 bollette complessive incluse nella prova gratuita. Eliminare un documento non libera un nuovo caricamento."
          : "Hai raggiunto il numero di bollette incluso nel piano.");
        return;
      }
      state.fileInput?.click();
    });

    state.fileInput?.addEventListener("change", () => {
      const file = state.fileInput.files?.[0];
      if (file) uploadFile(file);
    });

    state.spendYear?.addEventListener("change", renderCloudSpend);

    state.list?.addEventListener("click", event => {
      const openButton = event.target.closest("[data-cloud-bill-open]");
      if (openButton) {
        openBill(openButton.dataset.cloudBillOpen);
        return;
      }
      const requestButton = event.target.closest("[data-cloud-check-request]");
      if (requestButton) {
        requestCheck(requestButton.dataset.cloudCheckRequest);
        return;
      }
      const toggleButton = event.target.closest("[data-cloud-check-toggle]");
      if (toggleButton) {
        const billId = toggleButton.dataset.cloudCheckToggle;
        if (expandedBillIds.has(billId)) expandedBillIds.delete(billId);
        else expandedBillIds.add(billId);
        renderList();
        return;
      }
      const automaticToggle = event.target.closest("[data-cloud-automatic-toggle]");
      if (automaticToggle) {
        const billId = automaticToggle.dataset.cloudAutomaticToggle;
        if (expandedBillIds.has(billId)) expandedBillIds.delete(billId);
        else expandedBillIds.add(billId);
        renderList();
        return;
      }
      const offerConfirmButton = event.target.closest("[data-offer-confirm]");
      if (offerConfirmButton) {
        sendOfferDecision(offerConfirmButton.dataset.offerConfirm, offerConfirmButton.dataset.offerBill, "confirm");
        return;
      }
      const offerRejectButton = event.target.closest("[data-offer-reject]");
      if (offerRejectButton) {
        sendOfferDecision(offerRejectButton.dataset.offerReject, offerRejectButton.dataset.offerBill, "reject");
        return;
      }
      const retryButton = event.target.closest("[data-cloud-analysis-retry]");
      if (retryButton) {
        runAutomaticAnalysis(retryButton.dataset.cloudAnalysisRetry, { announce: true });
        return;
      }
      const deleteButton = event.target.closest("[data-cloud-bill-delete]");
      if (deleteButton) deleteBill(deleteButton.dataset.cloudBillDelete);
    });

    authSubscription = client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => syncSession(session), 0);
    });

    client.auth.getSession().then(({ data, error }) => {
      if (error) {
        renderLocked("Sessione non disponibile", "Non è stato possibile verificare l’account.", "ERRORE", "—");
        setMessage("error", friendlyError(error));
        return;
      }
      syncSession(data.session);
    });

    window.addEventListener("offertalogica:utilities-changed", () => {
      client.auth.getSession().then(({ data }) => syncSession(data.session));
    });

    window.addEventListener("pagehide", () => {
      authSubscription?.data?.subscription?.unsubscribe?.();
      if (pollTimer) clearTimeout(pollTimer);
    }, { once: true });
  }

  globalThis.OffertaLogicaPremiumBills = Object.freeze({ init });
})();
