function compactLeadForWebhook(lead, eventName = "lead_verified") {
  const calculation = lead.calculation || {};
  const business = calculation.businessProfile || null;
  const pdf = calculation.pdfData || null;
  const current = calculation.currentSupply || null;

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
    selectedOffer: lead.selectedOffer || null,
    monetization: lead.monetization || null,
    createdAt: lead.meta?.createdAt || null,
    source: lead.consents?.proof?.source || null,
  };
}

export async function notifyLeadVerified(lead, eventName = "lead_verified") {
  const webhookUrl = process.env.LEAD_WEBHOOK_URL;
  if (!webhookUrl) return { ok: true, skipped: true };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.LEAD_WEBHOOK_SECRET
        ? { "X-Lead-Webhook-Secret": process.env.LEAD_WEBHOOK_SECRET }
        : {}),
    },
    body: JSON.stringify(compactLeadForWebhook(lead, eventName)),
  });

  if (!response.ok) {
    throw new Error(`Lead webhook error ${response.status}`);
  }

  return { ok: true, skipped: false };
}
