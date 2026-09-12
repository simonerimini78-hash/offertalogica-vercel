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

export async function notifyLeadVerified(lead, eventName = "lead_verified") {
  const webhookUrl = String(process.env.LEAD_WEBHOOK_URL || "").trim();
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

  const secret = String(process.env.LEAD_WEBHOOK_SECRET || "").trim();
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
