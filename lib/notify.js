import crypto from "node:crypto";

function compactLeadForWebhook(lead, eventName = "lead_verified") {
  const calculation = lead.calculation || {};
  const business = calculation.businessProfile || null;
  const pdf = calculation.pdfData || null;
  const current = calculation.currentSupply || null;
  const photovoltaic = calculation.photovoltaicProfile || null;

  return {
    event: eventName,
    id: lead.id,
    status: lead.status,
    verifiedAt: lead.verifiedAt,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    customerType: calculation.customerType || "privato",
    consents: lead.consents,
    bestSaving: calculation.bestSaving || 0,
    business,
    pdf,
    currentSupply: current,
    photovoltaic,
    requestType: calculation.requestType || "comparison",
    selectedOffer: lead.selectedOffer || null,
    monetization: lead.monetization || null,
    createdAt: lead.meta?.createdAt || null,
    source: lead.consents?.proof?.source || null,
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().slice(0, 320);
}

function emailAddressLooksValid(value) {
  const normalized = normalizeEmail(value);
  const match = normalized.match(/<([^<>]+)>$/);
  const address = match ? match[1] : normalized;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textValue(value, fallback = "—") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function numberValue(value, suffix = "") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  const formatted = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(parsed);
  return `${formatted}${suffix}`;
}

function ownershipLabel(value) {
  return ({ owner: "Proprietario", buying: "In acquisto", not_owner: "Non proprietario" })[value] || "Non indicato";
}

function timeframeLabel(value) {
  return ({
    "0_3": "Entro 3 mesi",
    "3_6": "Tra 3 e 6 mesi",
    "6_12": "Tra 6 e 12 mesi",
    exploring: "Sta ancora valutando",
  })[value] || "Non indicata";
}

function usageLabel(value) {
  return ({
    high: "Soprattutto di giorno",
    medium: "Tra giorno e sera",
    low: "Soprattutto mattina e sera",
    continuous: "Distribuito durante il giorno",
    bands: "Ricavato dalle fasce della bolletta",
    declared: "Dichiarato",
    unknown: "Non indicato",
  })[value] || textValue(value);
}

function photovoltaicRetentionDays() {
  const requested = Number(process.env.CUSTOMER_DB_PHOTOVOLTAIC_RETENTION_DAYS || 120);
  if (!Number.isFinite(requested)) return 120;
  return Math.max(1, Math.min(3650, Math.floor(requested)));
}

function photovoltaicRetentionDeadline(lead) {
  const source = Date.parse(String(lead?.meta?.createdAt || lead?.verifiedAt || ""));
  const base = Number.isFinite(source) ? source : Date.now();
  return new Date(base + photovoltaicRetentionDays() * 86_400_000).toISOString().slice(0, 10);
}

function photovoltaicEmailContent(lead) {
  const calculation = lead.calculation || {};
  const project = calculation.photovoltaicProfile || {};
  const customerType = calculation.customerType === "business" ? "Azienda" : "Privato";
  const source = project.source === "detailed" ? "Simulatore dettagliato" : project.source === "quick" ? "Valutazione rapida" : textValue(project.source);
  const subjectPlace = textValue(project.place, customerType);
  const subject = `[OffertaLogica] Nuova richiesta fotovoltaico verificata - ${subjectPlace}`.slice(0, 180);

  const rows = [
    ["Lead ID", lead.id],
    ["Verificata il", lead.verifiedAt],
    ["Nome", lead.name],
    ["Telefono verificato", lead.phone],
    ["Email", lead.email || "Non fornita"],
    ["Tipo cliente", customerType],
    ["Origine valutazione", source],
    ["Zona", project.place],
    ["Disponibilità immobile", ownershipLabel(project.ownership)],
    ["Tempistica", timeframeLabel(project.timeframe)],
    ["Consumo annuo", numberValue(project.annualConsumptionKwh, " kWh")],
    ["Profilo consumi", usageLabel(project.usageProfile)],
    ["Potenza scenario", numberValue(project.scenarioPowerKw, " kW")],
    ["Produzione stimata", numberValue(project.annualProductionKwh, " kWh/anno")],
    ["Autoconsumo stimato", numberValue(project.selfConsumptionKwh, " kWh/anno")],
    ["Energia residua da rete", numberValue(project.residualGridKwh, " kWh/anno")],
    ["Copertura consumi", numberValue(project.coveragePct, "%")],
    ["Valutazione", project.assessmentLabel || project.assessment],
    ["Affidabilità", project.confidence],
    ["Consenso comunicazione al consulente esterno", lead.consents?.partners ? "Sì" : "No"],
    ["Termine conservazione operativa", photovoltaicRetentionDeadline(lead)],
  ];

  const text = [
    "Nuova richiesta fotovoltaico verificata su OffertaLogica.",
    "",
    ...rows.map(([label, value]) => `${label}: ${textValue(value)}`),
    "",
    `IMPORTANTE PRIVACY: il cliente ha acconsentito alla comunicazione di questi dati al consulente tecnico esterno per il solo ricontatto e approfondimento fotovoltaico richiesto. Non inoltrare i dati a installatori o altre aziende senza una nuova conferma esplicita del cliente. Elimina il messaggio e le eventuali copie operative entro ${photovoltaicRetentionDeadline(lead)} salvo un diverso obbligo di legge documentato.`,
  ].join("\n");

  const htmlRows = rows
    .map(([label, value]) => `<tr><th align="left" style="padding:6px 10px 6px 0;vertical-align:top">${htmlEscape(label)}</th><td style="padding:6px 0">${htmlEscape(textValue(value))}</td></tr>`)
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033"><h2>Nuova richiesta fotovoltaico verificata</h2><table style="border-collapse:collapse">${htmlRows}</table><p style="margin-top:20px;padding:12px;background:#fff7ed;border-left:4px solid #f59e0b"><strong>Privacy:</strong> il cliente ha acconsentito alla comunicazione di questi dati al consulente tecnico esterno per il solo ricontatto e approfondimento fotovoltaico richiesto. Non inoltrare i dati a installatori o altre aziende senza una nuova conferma esplicita del cliente. Elimina il messaggio e le eventuali copie operative entro ${htmlEscape(photovoltaicRetentionDeadline(lead))} salvo un diverso obbligo di legge documentato.</p></div>`;
  return { subject, text, html };
}

function emailConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const to = normalizeEmail(process.env.LEAD_NOTIFICATION_EMAIL);
  const from = normalizeEmail(process.env.LEAD_NOTIFICATION_FROM);
  const configured = Boolean(apiKey && to && from);
  const partial = Boolean(apiKey || to || from) && !configured;
  return { apiKey, to, from, configured, partial };
}

function webhookConfig() {
  const url = String(process.env.LEAD_WEBHOOK_URL || "").trim();
  const secret = String(process.env.LEAD_WEBHOOK_SECRET || "").trim();
  return { url, secret, configured: Boolean(url) };
}

export function notificationChannelsStatus() {
  const email = emailConfig();
  const webhook = webhookConfig();
  return {
    emailConfigured: email.configured,
    emailPartial: email.partial,
    webhookConfigured: webhook.configured,
    photovoltaicDeliveryConfigured: email.configured || webhook.configured,
  };
}

async function sendLeadEmail(lead, eventName) {
  if (eventName !== "photovoltaic_consulting_request") return { ok: true, skipped: true };
  const config = emailConfig();
  if (!config.configured) {
    if (config.partial) throw new Error("Configurazione email lead incompleta");
    return { ok: true, skipped: true };
  }
  if (!emailAddressLooksValid(config.to) || !emailAddressLooksValid(config.from)) {
    throw new Error("Indirizzo email lead non valido");
  }

  const message = photovoltaicEmailContent(lead);
  const controller = new AbortController();
  const requestedTimeoutMs = Number(process.env.LEAD_EMAIL_TIMEOUT_MS || 8000);
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1000, Math.min(15_000, Math.floor(requestedTimeoutMs)))
    : 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${eventName}/${lead.id}`.slice(0, 256),
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    const payloadText = await response.text();
    if (!response.ok) throw new Error(`Lead email error ${response.status}: ${payloadText.slice(0, 240)}`);
    let messageId = "";
    try {
      messageId = String(JSON.parse(payloadText || "{}").id || "").slice(0, 120);
    } catch {
      messageId = "";
    }
    return { ok: true, skipped: false, provider: "resend", messageId };
  } finally {
    clearTimeout(timer);
  }
}

async function sendLeadWebhook(lead, eventName) {
  const { url: webhookUrl, secret } = webhookConfig();
  if (!webhookUrl) return { ok: true, skipped: true };

  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new Error("Lead webhook URL non valida");
  }
  const production = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  if (production && parsedUrl.protocol !== "https:") {
    throw new Error("Lead webhook HTTPS richiesto in produzione");
  }
  if (production && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Lead webhook secret non configurato");
  }

  const body = JSON.stringify(compactLeadForWebhook(lead, eventName));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = secret
    ? crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
    : "";
  const controller = new AbortController();
  const requestedTimeoutMs = Number(process.env.LEAD_WEBHOOK_TIMEOUT_MS || 8000);
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1000, Math.min(15_000, Math.floor(requestedTimeoutMs)))
    : 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsedUrl.href, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(secret
          ? {
            "X-Lead-Webhook-Secret": secret,
            "X-Lead-Webhook-Timestamp": timestamp,
            "X-Lead-Webhook-Signature": `sha256=${signature}`,
          }
          : {}),
      },
      body,
    });

    if (!response.ok) throw new Error(`Lead webhook error ${response.status}`);
    return { ok: true, skipped: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyLeadVerified(lead, eventName = "lead_verified") {
  const production = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const errors = [];
  let email = { ok: true, skipped: true };
  let webhook = { ok: true, skipped: true };

  try {
    email = await sendLeadEmail(lead, eventName);
  } catch (error) {
    errors.push(error?.message || "lead_email_error");
    email = { ok: false, skipped: false };
  }

  try {
    webhook = await sendLeadWebhook(lead, eventName);
  } catch (error) {
    errors.push(error?.message || "lead_webhook_error");
    webhook = { ok: false, skipped: false };
  }

  const emailSent = email.ok && !email.skipped;
  const webhookSent = webhook.ok && !webhook.skipped;
  const anySent = emailSent || webhookSent;
  const allSkipped = email.skipped && webhook.skipped;

  if (eventName === "photovoltaic_consulting_request" && production && !anySent) {
    if (allSkipped) throw new Error("Consegna lead fotovoltaico non configurata");
    throw new Error(errors.join(" | ") || "Consegna lead fotovoltaico fallita");
  }
  if (!anySent && errors.length && !allSkipped) {
    throw new Error(errors.join(" | "));
  }

  return {
    ok: true,
    skipped: allSkipped,
    emailSent,
    webhookSent,
    emailProvider: emailSent ? email.provider || "email" : null,
    emailMessageId: emailSent ? email.messageId || null : null,
    warnings: anySent && errors.length ? errors : [],
  };
}
