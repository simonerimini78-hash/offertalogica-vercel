(() => {
  "use strict";

  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";
  const STORAGE_KEY = "offertalogica-premium-staff-auth";

  let client = null;
  let scenarios = [];
  let selectedId = null;

  const byId = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const demoId = prefix => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("it-IT", includeTime
      ? { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" }
      : { day:"2-digit", month:"2-digit", year:"numeric" }).format(date);
  }

  function formatMoney(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR" }).format(number)
      : "—";
  }

  function signalLabel(signal) {
    return { green:"Verde", yellow:"Giallo", red:"Rosso" }[signal] || "—";
  }

  function statusLabel(value) {
    return {
      pending:"Da verificare", assigned:"Assegnato", in_review:"In controllo",
      more_info_required:"Integrazione", completed:"Completato", canceled:"Annullato"
    }[value] || value || "—";
  }

  function outcomeLabel(value) {
    return {
      pending:"Non definito", correct:"Bolletta corretta", anomaly:"Anomalia",
      possible_saving:"Possibile risparmio", inconclusive:"Esito non conclusivo"
    }[value] || value || "—";
  }

  function screeningLabel(value) {
    return {
      clear:"Verde · Regolare",
      review_recommended:"Rosso · Anomalia importante",
      inconclusive:"Giallo · Avviso",
      failed:"Giallo · Documento da ricaricare"
    }[value] || "Non disponibile";
  }

  function categoryLabel(value) {
    return {
      price:"Prezzo", fixed_fee:"Quota fissa", discount:"Sconto", consumption:"Consumi",
      tax:"Imposte", adjustment:"Conguaglio", contract:"Contratto", duplicate:"Duplicazione", other:"Altro"
    }[value] || value || "Altro";
  }

  function severityLabel(value) {
    return { low:"Bassa", medium:"Media", high:"Alta", critical:"Critica" }[value] || value || "—";
  }

  function node(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }

  function badge(text, kind = "") {
    return node("span", `badge${kind ? ` ${kind}` : ""}`, text);
  }

  function info(label, value) {
    const item = node("div", "info");
    item.append(node("span", "", label), node("strong", "", value ?? "—"));
    return item;
  }

  function baseAnalysis(overrides = {}) {
    return {
      status:"completed",
      review_status:"pending",
      run_number:1,
      model:"gpt-5-mini",
      duration_ms:3400,
      estimated_cost_eur:0.0182,
      warnings:[],
      validation_metrics:null,
      validated_at:null,
      validation_seconds:0,
      extracted_data:{
        commodity:"luce",
        fornitore_luce:"Energia Demo",
        consumo_luce_kwh:2700,
        prezzo_luce_eur_kwh:0.125,
        quota_fissa_vendita_luce_eur_anno:108,
        tipo_prezzo_luce:"fisso",
        indice_riferimento_luce:"",
        formula_prezzo_luce:"0,125 €/kWh"
      },
      field_reviews:[],
      ...overrides
    };
  }

  function baseScenario(overrides = {}) {
    const id = overrides.id || demoId("scenario");
    return {
      id,
      signal:"green",
      title:"Scenario demo",
      description:"",
      profile:{ full_name:"Cliente Dimostrativo", email:"demo@offertalogica.invalid" },
      utility:{ label:"Casa principale", provider_name:"Energia Demo", address:"Via Esempio 10, Rimini" },
      bill:{
        original_file_name:`bolletta-demo-${id}.pdf`,
        commodity:"electricity",
        total_amount_eur:84.20,
        file_size:228000,
        created_at:nowIso(),
        automatic_screening_status:"clear",
        automatic_screening_summary:"Nessuna anomalia rilevante.",
        automatic_screening_reasons:[]
      },
      check:{
        status:"completed",
        outcome:"correct",
        assigned:"Tecnico demo",
        created_at:nowIso(),
        completed_at:nowIso(),
        human_seconds:480,
        summary:"Controllo concluso senza anomalie.",
        customer_message:"La bolletta risulta coerente con le condizioni disponibili."
      },
      anomalies:[],
      notes:[{ author:"Staff demo", note:"Scenario creato esclusivamente per il laboratorio Owner.", created_at:nowIso() }],
      analysis:baseAnalysis({
        review_status:"validated",
        validated_at:nowIso(),
        validation_seconds:180,
        validation_metrics:{ applicable_fields:8, approved_fields:8, corrected_fields:0, missing_fields:0, accuracy_pct:100, correction_rate_pct:0 }
      }),
      ...overrides
    };
  }

  function buildScenarios() {
    const list = [
      baseScenario({
        id:"green-regular",
        signal:"green",
        title:"Bolletta regolare",
        description:"Caso chiuso correttamente: nessuna anomalia e screening verde."
      }),
      baseScenario({
        id:"yellow-saving",
        signal:"yellow",
        title:"Possibile risparmio",
        description:"Condizioni corrette, ma l'offerta appare poco competitiva.",
        bill:{
          original_file_name:"demo-risparmio.pdf", commodity:"electricity", total_amount_eur:112.40, file_size:242000, created_at:nowIso(),
          automatic_screening_status:"inconclusive",
          automatic_screening_summary:"Le condizioni applicate risultano coerenti; è presente una possibile opportunità di risparmio.",
          automatic_screening_reasons:[{ title:"Possibile risparmio", description:"Il costo stimato è superiore a offerte comparabili.", source:"automatico", severity:"medium" }]
        },
        check:{ status:"completed", outcome:"possible_saving", assigned:"Tecnico demo", created_at:nowIso(), completed_at:nowIso(), human_seconds:420, summary:"Nessun errore di fatturazione. Possibile risparmio.", customer_message:"La bolletta è corretta; risultano disponibili condizioni potenzialmente più convenienti." },
        anomalies:[{ id:"a-saving", category:"price", severity:"low", title:"Opportunità di risparmio", description:"Differenziale stimato superiore alla soglia informativa.", estimated_impact_eur:76 }]
      }),
      baseScenario({
        id:"red-price",
        signal:"red",
        title:"Prezzo materia errato",
        description:"Prezzo applicato diverso da quello atteso: caso rosso da verificare.",
        bill:{
          original_file_name:"demo-prezzo-errato.pdf", commodity:"electricity", total_amount_eur:148.70, file_size:264000, created_at:nowIso(),
          automatic_screening_status:"review_recommended",
          automatic_screening_summary:"Il prezzo materia applicato non coincide con la condizione contrattuale attesa.",
          automatic_screening_reasons:[{ title:"Prezzo non coerente", description:"Rilevato 0,189 €/kWh rispetto a 0,129 €/kWh atteso.", source:"automatico", severity:"high" }]
        },
        check:{ status:"in_review", outcome:"pending", assigned:"Tecnico demo", created_at:nowIso(), completed_at:null, human_seconds:0, summary:"", customer_message:"Stiamo verificando una differenza sul prezzo applicato." },
        anomalies:[{ id:"a-price", category:"price", severity:"high", title:"Prezzo applicato diverso", description:"Il prezzo materia risulta superiore alla condizione prevista.", estimated_impact_eur:132 }],
        analysis:baseAnalysis({ extracted_data:{ commodity:"luce", fornitore_luce:"Energia Demo", consumo_luce_kwh:2850, prezzo_luce_eur_kwh:0.189, quota_fissa_vendita_luce_eur_anno:108, tipo_prezzo_luce:"fisso", indice_riferimento_luce:"", formula_prezzo_luce:"0,189 €/kWh" } })
      }),
      baseScenario({
        id:"red-fixed-fee",
        signal:"red",
        title:"Quota fissa incoerente",
        description:"Quota fissa annua più alta di quella prevista.",
        bill:{
          original_file_name:"demo-quota-fissa.pdf", commodity:"gas", total_amount_eur:96.10, file_size:236000, created_at:nowIso(),
          automatic_screening_status:"review_recommended",
          automatic_screening_summary:"La quota fissa di vendita richiede controllo manuale.",
          automatic_screening_reasons:[{ title:"Quota fissa differente", description:"Quota annua rilevata 180 € contro 96 € previsti.", source:"automatico", severity:"high" }]
        },
        utility:{ label:"Casa principale · Gas", provider_name:"Gas Demo", address:"Via Esempio 10, Rimini" },
        check:{ status:"assigned", outcome:"pending", assigned:"Tecnico demo", created_at:nowIso(), completed_at:null, human_seconds:0, summary:"", customer_message:"Il controllo è stato preso in carico." },
        anomalies:[{ id:"a-fee", category:"fixed_fee", severity:"high", title:"Quota fissa superiore", description:"La componente fissa rilevata non coincide con la condizione attesa.", estimated_impact_eur:84 }],
        analysis:baseAnalysis({ extracted_data:{ commodity:"gas", fornitore_gas:"Gas Demo", consumo_gas_smc:820, prezzo_gas_eur_smc:0.46, quota_fissa_vendita_gas_eur_anno:180, tipo_prezzo_gas:"fisso", indice_riferimento_gas:"", formula_prezzo_gas:"0,46 €/Smc" } })
      }),
      baseScenario({
        id:"red-consumption",
        signal:"red",
        title:"Consumi incoerenti",
        description:"Consumo fatturato incompatibile con il periodo e lo storico.",
        bill:{
          original_file_name:"demo-consumi.pdf", commodity:"electricity", total_amount_eur:219.30, file_size:251000, created_at:nowIso(),
          automatic_screening_status:"review_recommended",
          automatic_screening_summary:"I consumi del periodo risultano anomali rispetto ai dati disponibili.",
          automatic_screening_reasons:[{ title:"Consumo anomalo", description:"Il consumo del periodo è circa tre volte lo storico comparabile.", source:"automatico", severity:"high" }]
        },
        check:{ status:"in_review", outcome:"pending", assigned:"Tecnico demo", created_at:nowIso(), completed_at:null, human_seconds:0, summary:"", customer_message:"Stiamo verificando i consumi fatturati." },
        anomalies:[{ id:"a-cons", category:"consumption", severity:"high", title:"Consumo da verificare", description:"Lettura/consumo non coerente con lo storico disponibile.", estimated_impact_eur:118 }]
      }),
      baseScenario({
        id:"red-adjustment",
        signal:"red",
        title:"Conguaglio sospetto",
        description:"Conguaglio importante; servono informazioni o documenti aggiuntivi.",
        bill:{
          original_file_name:"demo-conguaglio.pdf", commodity:"gas", total_amount_eur:318.60, file_size:298000, created_at:nowIso(),
          automatic_screening_status:"review_recommended",
          automatic_screening_summary:"È presente un conguaglio di importo rilevante da ricostruire.",
          automatic_screening_reasons:[{ title:"Conguaglio rilevante", description:"La rettifica incide in modo significativo sull'importo totale.", source:"automatico", severity:"high" }]
        },
        utility:{ label:"Casa principale · Gas", provider_name:"Gas Demo", address:"Via Esempio 10, Rimini" },
        check:{ status:"more_info_required", outcome:"pending", assigned:"Tecnico demo", created_at:nowIso(), completed_at:null, human_seconds:0, summary:"", customer_message:"Per completare il controllo servono le letture o la bolletta precedente." },
        anomalies:[{ id:"a-adj", category:"adjustment", severity:"high", title:"Conguaglio da ricostruire", description:"Servono periodo, letture iniziali/finali e documento precedente.", estimated_impact_eur:164 }]
      }),
      baseScenario({
        id:"red-duplicate",
        signal:"red",
        title:"Possibile duplicazione",
        description:"Due addebiti sembrano riferirsi allo stesso periodo.",
        bill:{
          original_file_name:"demo-duplicazione.pdf", commodity:"electricity", total_amount_eur:173.80, file_size:271000, created_at:nowIso(),
          automatic_screening_status:"review_recommended",
          automatic_screening_summary:"Possibile duplicazione di una componente già fatturata.",
          automatic_screening_reasons:[{ title:"Duplicazione potenziale", description:"Periodo e importo coincidono con un addebito precedente.", source:"automatico", severity:"critical" }]
        },
        check:{ status:"in_review", outcome:"pending", assigned:"Tecnico demo", created_at:nowIso(), completed_at:null, human_seconds:0, summary:"", customer_message:"Stiamo verificando un possibile doppio addebito." },
        anomalies:[{ id:"a-dup", category:"duplicate", severity:"critical", title:"Possibile doppio addebito", description:"È necessario confrontare il documento con la fattura precedente.", estimated_impact_eur:86.90 }]
      }),
      baseScenario({
        id:"yellow-unreadable",
        signal:"yellow",
        title:"PDF non leggibile",
        description:"Lettura automatica fallita: il cliente deve ricaricare un PDF più leggibile.",
        bill:{
          original_file_name:"demo-pdf-illeggibile.pdf", commodity:"unknown", total_amount_eur:null, file_size:71000, created_at:nowIso(),
          automatic_screening_status:"failed",
          automatic_screening_summary:"Il documento non contiene testo o immagini sufficientemente leggibili.",
          automatic_screening_reasons:[{ title:"Documento da ricaricare", description:"La qualità non permette una verifica attendibile.", source:"automatico", severity:"medium" }]
        },
        check:{ status:"more_info_required", outcome:"pending", assigned:"Tecnico demo", created_at:nowIso(), completed_at:null, human_seconds:0, summary:"", customer_message:"Ricarica la bolletta originale o una scansione completa e leggibile." },
        anomalies:[],
        analysis:baseAnalysis({ status:"failed", extracted_data:{}, warnings:["pdf_text_insufficient"], review_status:"pending" })
      }),
      baseScenario({
        id:"yellow-ai-missing",
        signal:"yellow",
        title:"IA con dati mancanti",
        description:"PDF leggibile ma alcuni dati economici non vengono estratti.",
        bill:{
          original_file_name:"demo-dati-mancanti.pdf", commodity:"electricity", total_amount_eur:91.20, file_size:223000, created_at:nowIso(),
          automatic_screening_status:"inconclusive",
          automatic_screening_summary:"La bolletta è leggibile, ma un dato economico secondario non è stato estratto.",
          automatic_screening_reasons:[{ title:"Dato da verificare", description:"Quota fissa non individuata con sufficiente affidabilità.", source:"automatico", severity:"medium" }]
        },
        check:{ status:"assigned", outcome:"pending", assigned:"Tecnico demo", created_at:nowIso(), completed_at:null, human_seconds:0, summary:"", customer_message:"Il controllo è stato preso in carico." },
        anomalies:[],
        analysis:baseAnalysis({
          status:"partial",
          warnings:["fixed_fee_missing"],
          extracted_data:{ commodity:"luce", fornitore_luce:"Energia Demo", consumo_luce_kwh:2440, prezzo_luce_eur_kwh:0.119, quota_fissa_vendita_luce_eur_anno:null, tipo_prezzo_luce:"fisso", indice_riferimento_luce:"", formula_prezzo_luce:"0,119 €/kWh" }
        })
      }),
      baseScenario({
        id:"red-ai-corrected",
        signal:"red",
        title:"IA validata con correzione",
        description:"Esempio di dato IA corretto manualmente dallo staff.",
        bill:{
          original_file_name:"demo-validazione-correzione.pdf", commodity:"gas", total_amount_eur:122.50, file_size:289000, created_at:nowIso(),
          automatic_screening_status:"review_recommended",
          automatic_screening_summary:"Il prezzo gas richiede conferma perché il dato iniziale era incoerente.",
          automatic_screening_reasons:[{ title:"Prezzo da confermare", description:"Il dato iniziale IA è stato corretto durante la validazione.", source:"automatico", severity:"high" }]
        },
        utility:{ label:"Casa principale · Gas", provider_name:"Gas Demo", address:"Via Esempio 10, Rimini" },
        check:{ status:"completed", outcome:"anomaly", assigned:"Tecnico demo", created_at:nowIso(), completed_at:nowIso(), human_seconds:660, summary:"Prezzo gas corretto manualmente durante la validazione.", customer_message:"Abbiamo rilevato una differenza sul prezzo applicato e la pratica è stata verificata." },
        anomalies:[{ id:"a-ai", category:"price", severity:"high", title:"Prezzo gas non coerente", description:"Il valore corretto rilevato sul PDF è 0,52 €/Smc.", estimated_impact_eur:91 }],
        analysis:baseAnalysis({
          review_status:"validated",
          validated_at:nowIso(),
          validation_seconds:285,
          validation_metrics:{ applicable_fields:8, approved_fields:7, corrected_fields:1, missing_fields:0, accuracy_pct:87.5, correction_rate_pct:12.5 },
          extracted_data:{ commodity:"gas", fornitore_gas:"Gas Demo", consumo_gas_smc:760, prezzo_gas_eur_smc:0.62, quota_fissa_vendita_gas_eur_anno:96, tipo_prezzo_gas:"fisso", indice_riferimento_gas:"", formula_prezzo_gas:"0,62 €/Smc" },
          field_reviews:[{ key:"prezzo_gas_eur_smc", label:"Prezzo materia gas", ai:"0,62 €/Smc", decision:"Corretto", reviewed:"0,52 €/Smc" }]
        })
      })
    ];
    return list.map(item => ({ ...item, original: clone(item) }));
  }

  function signalKind(signal) {
    return signal === "red" ? "danger" : signal === "yellow" ? "warn" : "ok";
  }

  function renderMetrics() {
    byId("metricScenarios").textContent = scenarios.length;
    byId("metricRed").textContent = scenarios.filter(item => item.signal === "red").length;
    byId("metricYellow").textContent = scenarios.filter(item => item.signal === "yellow").length;
    byId("metricGreen").textContent = scenarios.filter(item => item.signal === "green").length;
  }

  function filteredScenarios() {
    const q = String(byId("scenarioSearch").value || "").trim().toLowerCase();
    const signal = byId("scenarioSignal").value;
    return scenarios.filter(item => {
      if (signal && item.signal !== signal) return false;
      const haystack = [
        item.title, item.description, item.utility?.provider_name, item.bill?.original_file_name,
        ...(item.anomalies || []).flatMap(a => [a.title, a.description, categoryLabel(a.category)])
      ].filter(Boolean).join(" ").toLowerCase();
      return !q || haystack.includes(q);
    });
  }

  function renderQueue() {
    const target = byId("scenarioQueue");
    target.replaceChildren();
    const list = filteredScenarios();
    byId("queueCount").textContent = `${list.length} ${list.length === 1 ? "scenario" : "scenari"}`;
    if (!list.length) {
      target.append(node("div", "empty", "Nessuno scenario corrisponde ai filtri."));
      return;
    }
    list.forEach(item => {
      const button = node("button", `queue-item${item.id === selectedId ? " active" : ""}`);
      button.type = "button";
      const top = node("div", "queue-top");
      const title = node("div", "queue-title");
      title.append(node("strong", "", item.title), node("span", "", item.description));
      top.append(title, badge(signalLabel(item.signal), signalKind(item.signal)));
      const meta = node("div", "queue-meta", `${statusLabel(item.check.status)} · ${item.utility.provider_name}`);
      const badges = node("div", "badges");
      badges.append(
        badge(outcomeLabel(item.check.outcome), item.check.outcome === "anomaly" ? "danger" : item.check.outcome === "possible_saving" ? "warn" : "info"),
        badge(screeningLabel(item.bill.automatic_screening_status), signalKind(item.signal))
      );
      button.append(top, meta, badges);
      button.addEventListener("click", () => {
        selectedId = item.id;
        renderQueue();
        renderDetail(item);
      });
      target.append(button);
    });
  }

  function renderAutomaticScreening(container, scenario) {
    const section = node("section", "section");
    const head = node("div", "section-head");
    const copy = node("div");
    copy.append(node("h3", "", "Screening automatico cliente"), node("p", "", scenario.signal === "red"
      ? "Anomalia rossa inviata allo staff."
      : "Avviso automatico o risultato informativo."));
    head.append(copy, badge(screeningLabel(scenario.bill.automatic_screening_status), signalKind(scenario.signal)));
    section.append(head);
    if (scenario.bill.automatic_screening_summary) section.append(node("p", "section-copy", scenario.bill.automatic_screening_summary));
    const timeline = node("div", "timeline");
    (scenario.bill.automatic_screening_reasons || []).forEach(reason => {
      const item = node("article", "timeline-item");
      item.append(node("strong", "", reason.title), node("p", "", reason.description), node("small", "", `${reason.source || "automatico"} · ${reason.severity || "medium"}`));
      timeline.append(item);
    });
    if (timeline.children.length) section.append(timeline);
    container.append(section);
  }

  function supplyRows(data = {}) {
    const list = [];
    if (data.fornitore_luce || data.consumo_luce_kwh != null || data.prezzo_luce_eur_kwh != null) {
      list.push({ label:"Luce", provider:data.fornitore_luce || "—", consumption:data.consumo_luce_kwh, unit:"kWh/anno", price:data.prezzo_luce_eur_kwh, priceUnit:"€/kWh", fixed:data.quota_fissa_vendita_luce_eur_anno, type:data.tipo_prezzo_luce, index:data.indice_riferimento_luce, formula:data.formula_prezzo_luce });
    }
    if (data.fornitore_gas || data.consumo_gas_smc != null || data.prezzo_gas_eur_smc != null) {
      list.push({ label:"Gas", provider:data.fornitore_gas || "—", consumption:data.consumo_gas_smc, unit:"Smc/anno", price:data.prezzo_gas_eur_smc, priceUnit:"€/Smc", fixed:data.quota_fissa_vendita_gas_eur_anno, type:data.tipo_prezzo_gas, index:data.indice_riferimento_gas, formula:data.formula_prezzo_gas });
    }
    return list;
  }

  function renderAi(container, scenario) {
    const section = node("section", "section");
    section.append(node("h3", "", "Dati letti dalla bolletta"));
    const analysis = scenario.analysis || null;
    if (!analysis) {
      section.append(node("div", "timeline-item", "Nessuna lettura disponibile."));
      container.append(section);
      return;
    }
    if (analysis.status === "failed") {
      section.append(node("div", "demo-note", "La lettura automatica non è riuscita. Nel caso reale il tecnico deve aprire il PDF, svolgere la verifica manuale oppure chiedere un nuovo documento."));
      container.append(section);
      return;
    }

    const supplies = supplyRows(analysis.extracted_data || {});
    const grid = node("div", "ai-grid");
    supplies.forEach(supply => {
      const card = node("article", "ai-card");
      const head = node("div", "ai-card-title");
      head.append(node("strong", "", supply.label), badge(analysis.status === "partial" ? "Bozza parziale" : "Bozza completa", analysis.status === "partial" ? "warn" : "ok"));
      const values = node("div", "ai-values");
      values.append(
        info("Consumo annuo", supply.consumption == null ? "—" : `${supply.consumption} ${supply.unit}`),
        info("Prezzo materia", supply.price == null ? "—" : `${String(supply.price).replace(".", ",")} ${supply.priceUnit}`),
        info("Quota fissa", supply.fixed == null ? "—" : `${formatMoney(supply.fixed)}/anno`),
        info("Tipo prezzo", supply.type || "—"),
        info("Indice", supply.index || "—"),
        info("Formula", supply.formula || "—")
      );
      card.append(head, node("p", "", supply.provider), values);
      grid.append(card);
    });
    if (grid.children.length) section.append(grid);

    const technical = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Dettagli tecnici IA e validazione";
    technical.append(summary);
    const meta = node("div", "info-grid");
    meta.append(
      info("Stato IA", analysis.status === "partial" ? "Bozza parziale" : "Bozza completa"),
      info("Esecuzione", `n. ${analysis.run_number || 1}`),
      info("Modello", analysis.model || "—"),
      info("Durata", `${(Number(analysis.duration_ms || 0) / 1000).toFixed(1).replace(".", ",")} s`),
      info("Costo stimato", formatMoney(analysis.estimated_cost_eur)),
      info("Validazione", analysis.review_status === "validated" ? "Validata dallo staff" : "Da validare")
    );
    technical.append(meta);

    if ((analysis.warnings || []).length) {
      const warning = node("div", "demo-note");
      warning.append(node("strong", "", "Verifiche richieste"));
      (analysis.warnings || []).forEach(item => warning.append(node("div", "", String(item).replaceAll("_", " "))));
      technical.append(warning);
    }

    const validation = node("div", "validation");
    const metrics = analysis.validation_metrics;
    if (metrics) {
      validation.append(node("p", "section-copy", `Campi applicabili ${metrics.applicable_fields} · confermati ${metrics.approved_fields} · corretti ${metrics.corrected_fields} · mancanti ${metrics.missing_fields} · accordo IA/staff ${metrics.accuracy_pct}%`));
    }
    const reviews = analysis.field_reviews || [];
    if (reviews.length) {
      reviews.forEach(review => {
        const row = node("div", "validation-row");
        const a = node("div"); a.append(node("span", "", review.label), node("strong", "", review.key));
        const b = node("div"); b.append(node("span", "", "Valore IA"), node("strong", "", review.ai));
        const c = node("div"); c.append(node("span", "", review.decision), node("strong", "", review.reviewed));
        row.append(a,b,c);
        validation.append(row);
      });
    } else {
      const data = analysis.extracted_data || {};
      const defs = [
        ["commodity","Tipo fornitura",data.commodity],
        ["fornitore_luce","Fornitore luce",data.fornitore_luce],
        ["consumo_luce_kwh","Consumo annuo luce",data.consumo_luce_kwh],
        ["prezzo_luce_eur_kwh","Prezzo materia luce",data.prezzo_luce_eur_kwh],
        ["quota_fissa_vendita_luce_eur_anno","Quota fissa luce",data.quota_fissa_vendita_luce_eur_anno],
        ["fornitore_gas","Fornitore gas",data.fornitore_gas],
        ["consumo_gas_smc","Consumo annuo gas",data.consumo_gas_smc],
        ["prezzo_gas_eur_smc","Prezzo materia gas",data.prezzo_gas_eur_smc],
        ["quota_fissa_vendita_gas_eur_anno","Quota fissa gas",data.quota_fissa_vendita_gas_eur_anno]
      ].filter(([, , value]) => value !== undefined);
      defs.forEach(([key,label,value]) => {
        const row = node("div", "validation-row");
        const a = node("div"); a.append(node("span", "", label), node("strong", "", key));
        const b = node("div"); b.append(node("span", "", "Valore IA"), node("strong", "", value == null || value === "" ? "Dato non trovato" : String(value).replace(".", ",")));
        const decision = value == null || value === "" ? "Dato mancante" : "Confermato";
        const c = node("div"); c.append(node("span", "", "Decisione demo"), node("strong", "", decision));
        row.append(a,b,c);
        validation.append(row);
      });
    }
    technical.append(validation);
    section.append(technical);
    container.append(section);
  }

  function renderAnomalies(container, scenario) {
    const section = node("section", "section");
    section.append(node("h3", "", "Anomalie e opportunità"));
    const timeline = node("div", "timeline");
    if (!scenario.anomalies.length) {
      timeline.append(node("div", "timeline-item", "Nessuna anomalia registrata."));
    } else {
      scenario.anomalies.forEach(anomaly => {
        const item = node("article", "timeline-item anomaly-item");
        const impact = anomaly.estimated_impact_eur == null ? "" : ` · Impatto ${formatMoney(anomaly.estimated_impact_eur)}`;
        item.append(
          node("strong", "", anomaly.title),
          node("p", "", anomaly.description || "Nessuna descrizione."),
          node("small", "", `${categoryLabel(anomaly.category)} · Gravità ${severityLabel(anomaly.severity)}${impact}`)
        );
        timeline.append(item);
      });
    }
    section.append(timeline);

    if (!["completed","canceled"].includes(scenario.check.status)) {
      const form = node("form", "workflow-grid");
      form.innerHTML = `
        <div class="field"><label>Categoria</label><select name="category">
          <option value="price">Prezzo</option><option value="fixed_fee">Quota fissa</option>
          <option value="consumption">Consumi</option><option value="adjustment">Conguaglio</option>
          <option value="duplicate">Duplicazione</option><option value="contract">Contratto</option><option value="other">Altro</option>
        </select></div>
        <div class="field"><label>Gravità</label><select name="severity">
          <option value="medium">Media</option><option value="high">Alta</option><option value="critical">Critica</option><option value="low">Bassa</option>
        </select></div>
        <div class="field full"><label>Titolo</label><input name="title" placeholder="Titolo sintetico"></div>
        <div class="field"><label>Impatto stimato €</label><input name="impact" inputmode="decimal" placeholder="0,00"></div>
        <div class="field full"><label>Descrizione</label><textarea name="description" placeholder="Descrizione dell'anomalia"></textarea></div>
      `;
      const actions = node("div", "form-actions");
      const submit = node("button", "button secondary", "REGISTRA ANOMALIA DEMO"); submit.type = "submit";
      actions.append(submit);
      form.append(actions);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const title = String(form.elements.title.value || "").trim();
        if (!title) return;
        const impactRaw = String(form.elements.impact.value || "").replace(",", ".").trim();
        scenario.anomalies.unshift({
          id:demoId("anomaly"),
          category:form.elements.category.value,
          severity:form.elements.severity.value,
          title,
          description:String(form.elements.description.value || "").trim(),
          estimated_impact_eur:impactRaw === "" ? null : Number(impactRaw)
        });
        form.reset();
        renderDetail(scenario);
      });
      section.append(form);
    }
    container.append(section);
  }

  function renderWorkflow(container, scenario) {
    const section = node("section", "section");
    section.append(node("h3", "", "Lavorazione"));
    const actions = node("div", "form-actions");

    if (scenario.check.status === "pending") {
      const claim = node("button", "button primary", "PRENDI IN CARICO"); claim.type = "button";
      claim.addEventListener("click", () => {
        scenario.check.status = "assigned";
        scenario.check.assigned = "Owner demo";
        renderAll(scenario);
      });
      actions.append(claim);
    }

    if (!["completed","canceled"].includes(scenario.check.status)) {
      [["in_review","IN CONTROLLO"],["more_info_required","RICHIEDI INTEGRAZIONE"],["canceled","ANNULLA"]].forEach(([status,label]) => {
        const button = node("button", "button secondary", label); button.type = "button";
        button.addEventListener("click", () => {
          scenario.check.status = status;
          if (status === "more_info_required") scenario.check.customer_message = "Per completare il controllo servono ulteriori informazioni.";
          renderAll(scenario);
        });
        actions.append(button);
      });
    }
    section.append(actions);

    if (!["completed","canceled"].includes(scenario.check.status) && scenario.check.status !== "pending") {
      const form = node("form", "workflow-grid");
      form.innerHTML = `
        <div class="field"><label>Esito</label><select name="outcome">
          <option value="correct">Bolletta corretta</option><option value="anomaly">Anomalia</option>
          <option value="possible_saving">Possibile risparmio</option><option value="inconclusive">Esito non conclusivo</option>
        </select></div>
        <div class="field"><label>Minuti revisione</label><input name="minutes" type="number" min="0" value="8"></div>
        <div class="field full"><label>Sintesi tecnica</label><textarea name="summary">Sintesi dimostrativa del controllo.</textarea></div>
        <div class="field full"><label>Messaggio cliente</label><textarea name="message">Messaggio dimostrativo visibile al cliente.</textarea></div>
      `;
      const submit = node("button", "button primary", "COMPLETA CONTROLLO DEMO"); submit.type = "submit";
      const formActions = node("div", "form-actions"); formActions.append(submit); form.append(formActions);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const outcome = form.elements.outcome.value;
        if (["anomaly","possible_saving"].includes(outcome) && !scenario.anomalies.length) {
          alert("Nel flusso reale serve almeno un'anomalia/opportunità registrata prima di chiudere con questo esito.");
          return;
        }
        scenario.check.status = "completed";
        scenario.check.outcome = outcome;
        scenario.check.summary = String(form.elements.summary.value || "");
        scenario.check.customer_message = String(form.elements.message.value || "");
        scenario.check.human_seconds = Math.max(0, Number(form.elements.minutes.value || 0) * 60);
        scenario.check.completed_at = nowIso();
        renderAll(scenario);
      });
      section.append(form);
    } else if (scenario.check.status === "completed") {
      const item = node("article", "timeline-item");
      item.append(
        node("strong", "", outcomeLabel(scenario.check.outcome)),
        node("p", "", scenario.check.customer_message || scenario.check.summary || "Controllo chiuso."),
        node("small", "", `Concluso ${formatDate(scenario.check.completed_at, true)} · Revisione ${Math.round(Number(scenario.check.human_seconds || 0)/60)} min`)
      );
      section.append(item);
    }

    const reset = node("button", "button danger", "RESET SCENARIO"); reset.type = "button";
    reset.addEventListener("click", () => {
      const restored = clone(scenario.original);
      restored.original = clone(scenario.original);
      const index = scenarios.findIndex(item => item.id === scenario.id);
      scenarios[index] = restored;
      selectedId = restored.id;
      renderAll(restored);
    });
    section.append(node("div", "form-actions", ""), reset);
    section.append(node("div", "demo-note", "Tutte le azioni di questa sezione modificano soltanto lo scenario in memoria. Nessuna RPC, tabella, Storage, email o API viene chiamata."));
    container.append(section);
  }

  function renderNotes(container, scenario) {
    const section = node("section", "section");
    section.append(node("h3", "", "Note interne"));
    const timeline = node("div", "timeline");
    scenario.notes.forEach(note => {
      const item = node("article", "timeline-item");
      item.append(node("strong", "", note.author), node("p", "", note.note), node("small", "", formatDate(note.created_at, true)));
      timeline.append(item);
    });
    section.append(timeline);
    container.append(section);
  }

  function renderDetail(scenario) {
    const target = byId("scenarioDetail");
    target.replaceChildren();
    const body = node("div", "detail-body");
    const title = node("div");
    title.append(node("h2", "", scenario.bill.original_file_name), node("p", "", `${scenario.profile.full_name} · ${scenario.profile.email}`));
    const actions = node("div", "detail-actions");
    actions.append(
      badge(signalLabel(scenario.signal), signalKind(scenario.signal)),
      badge(statusLabel(scenario.check.status), "info")
    );
    const head = node("div", "detail-title"); head.append(title, actions); body.append(head);

    const grid = node("div", "info-grid");
    grid.append(
      info("Stato", statusLabel(scenario.check.status)),
      info("Esito", outcomeLabel(scenario.check.outcome)),
      info("Assegnazione", scenario.check.assigned || "Non assegnato"),
      info("Richiesta", formatDate(scenario.check.created_at, true)),
      info("Utenza", scenario.utility.label),
      info("Fornitore", scenario.utility.provider_name),
      info("Indirizzo", scenario.utility.address),
      info("Documento", `${Math.max(1, Math.round(Number(scenario.bill.file_size || 0)/1000))} KB`),
      info("Importo", formatMoney(scenario.bill.total_amount_eur)),
      info("Screening IA", screeningLabel(scenario.bill.automatic_screening_status))
    );
    body.append(grid);

    renderAutomaticScreening(body, scenario);
    renderAi(body, scenario);
    renderAnomalies(body, scenario);
    renderWorkflow(body, scenario);
    renderNotes(body, scenario);
    body.append(node("div", "status-line", "Laboratorio Owner · dati esclusivamente dimostrativi"));
    target.append(body);
  }

  function renderAll(scenario) {
    renderMetrics();
    renderQueue();
    renderDetail(scenario);
  }

  async function verifyOwner() {
    const access = byId("labAccess");
    const app = byId("labApp");
    const text = byId("labAccessText");
    const openStaff = byId("labOpenStaff");

    if (!window.supabase?.createClient) {
      text.textContent = "Il collegamento Supabase non è disponibile.";
      return;
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth:{ storageKey:STORAGE_KEY, persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }
    });

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData?.session?.user) {
      text.textContent = "Sessione Staff non disponibile. Accedi prima al Control Center.";
      openStaff.hidden = false;
      return;
    }

    const { data: role, error: roleError } = await client.rpc("premium_staff_raw_role");
    if (roleError) {
      text.textContent = "Non è stato possibile verificare il ruolo Staff.";
      openStaff.hidden = false;
      return;
    }
    if (String(role || "").trim().toLowerCase() !== "owner") {
      text.textContent = "Accesso negato: il Laboratorio è riservato al Proprietario.";
      byId("labIdentity").textContent = "Accesso non autorizzato";
      openStaff.hidden = false;
      return;
    }

    byId("labIdentity").textContent = `Proprietario · ${sessionData.session.user.email || "Owner"}`;
    access.hidden = true;
    app.hidden = false;
    scenarios = buildScenarios();
    selectedId = scenarios[0]?.id || null;
    renderMetrics();
    renderQueue();
    if (scenarios[0]) renderDetail(scenarios[0]);
  }

  function init() {
    byId("labBack").addEventListener("click", () => { location.href = "/staff.html#checks"; });
    byId("labOpenStaff").addEventListener("click", () => { location.href = "/staff.html"; });
    byId("scenarioSearch").addEventListener("input", renderQueue);
    byId("scenarioSignal").addEventListener("change", renderQueue);
    verifyOwner().catch(error => {
      byId("labAccessText").textContent = `Errore laboratorio: ${String(error?.message || error)}`;
      byId("labOpenStaff").hidden = false;
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
