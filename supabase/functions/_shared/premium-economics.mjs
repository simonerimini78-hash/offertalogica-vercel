function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function stripeEstimatedFee(amountEur, percentRate, fixedRate) {
  const amount = finite(amountEur);
  const pct = finite(percentRate);
  const fixed = finite(fixedRate);
  if (amount === null || pct === null || fixed === null) return null;
  return amount * pct / 100 + fixed;
}

export async function activeEconomicRate(admin, rateKey, at = new Date().toISOString()) {
  const result = await admin
    .from("premium_economic_rate_versions")
    .select("id,rate_key,rate_value,currency,vat_rate,source_mode,valid_from,valid_to")
    .eq("rate_key", rateKey)
    .lte("valid_from", at)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`economic_rate_lookup:${result.error.message || result.error}`);
  if (!result.data) return null;
  if (result.data.valid_to && new Date(result.data.valid_to) <= new Date(at)) return null;
  return result.data;
}

async function insertIdempotent(admin, row) {
  const result = await admin
    .from("premium_economic_entries")
    .upsert(row, {
      onConflict: "source_system,source_event_id,category",
      ignoreDuplicates: true,
    });
  if (result.error) throw new Error(`economic_entry_store:${result.error.message || result.error}`);
}

export async function recordStripeInvoiceEconomics(admin, invoice, userId, paidAt) {
  const amountPaidCents = Number(invoice?.amount_paid);
  if (!Number.isFinite(amountPaidCents) || amountPaidCents < 0 || !invoice?.id) return;
  const currency = String(invoice?.currency || "eur").toUpperCase();
  const grossEur = currency === "EUR" ? amountPaidCents / 100 : null;

  await insertIdempotent(admin, {
    direction: "revenue",
    status: grossEur === null ? "unpriced" : "paid",
    category: "premium_subscription_revenue",
    source_system: "stripe",
    source_event_id: String(invoice.id),
    user_id: userId || null,
    quantity: 1,
    unit: "invoice",
    original_amount: amountPaidCents / 100,
    original_currency: currency,
    fx_rate_to_eur: currency === "EUR" ? 1 : null,
    amount_net_eur: null,
    vat_rate: null,
    vat_eur: null,
    amount_gross_eur: grossEur,
    occurred_at: paidAt,
    metadata: {
      invoice_id: invoice.id,
      payment_intent_id:
        typeof invoice?.payment_intent === "string"
          ? invoice.payment_intent
          : invoice?.payment_intent?.id || null,
      billing_reason: invoice?.billing_reason || null,
    },
  });

  const [pctRate, fixedRate] = await Promise.all([
    activeEconomicRate(admin, "stripe_fee_percent", paidAt).catch(() => null),
    activeEconomicRate(admin, "stripe_fee_fixed_eur", paidAt).catch(() => null),
  ]);
  const estimatedFee = grossEur === null
    ? null
    : stripeEstimatedFee(grossEur, pctRate?.rate_value, fixedRate?.rate_value);

  await insertIdempotent(admin, {
    direction: "cost",
    status: estimatedFee === null ? "unpriced" : "estimated",
    category: "stripe_fee_estimate",
    source_system: "stripe",
    source_event_id: String(invoice.id),
    user_id: userId || null,
    rate_version_id: fixedRate?.id || pctRate?.id || null,
    quantity: 1,
    unit: "invoice",
    original_amount: estimatedFee,
    original_currency: "EUR",
    fx_rate_to_eur: 1,
    amount_net_eur: estimatedFee,
    vat_rate: null,
    vat_eur: null,
    amount_gross_eur: estimatedFee,
    occurred_at: paidAt,
    metadata: {
      invoice_id: invoice.id,
      percent_rate: finite(pctRate?.rate_value),
      fixed_rate_eur: finite(fixedRate?.rate_value),
      percent_rate_version_id: pctRate?.id || null,
      fixed_rate_version_id: fixedRate?.id || null,
      source_mode: "estimated_until_provider_fee_import",
    },
  });
}

export async function recordStripeRefundEconomics(admin, charge, occurredAt = new Date().toISOString()) {
  const refunds = Array.isArray(charge?.refunds?.data) ? charge.refunds.data : [];
  for (const refund of refunds) {
    if (!refund?.id) continue;
    const amountCents = Number(refund.amount);
    if (!Number.isFinite(amountCents) || amountCents < 0) continue;
    const currency = String(refund.currency || charge?.currency || "eur").toUpperCase();
    const grossEur = currency === "EUR" ? -(amountCents / 100) : null;
    await insertIdempotent(admin, {
      direction: "adjustment",
      status: grossEur === null ? "unpriced" : "refunded",
      category: "premium_refund",
      source_system: "stripe",
      source_event_id: String(refund.id),
      quantity: 1,
      unit: "refund",
      original_amount: -(amountCents / 100),
      original_currency: currency,
      fx_rate_to_eur: currency === "EUR" ? 1 : null,
      amount_net_eur: null,
      vat_rate: null,
      vat_eur: null,
      amount_gross_eur: grossEur,
      occurred_at: refund.created
        ? new Date(Number(refund.created) * 1000).toISOString()
        : occurredAt,
      metadata: {
        charge_id: charge?.id || null,
        refund_id: refund.id,
        payment_intent_id:
          typeof charge?.payment_intent === "string"
            ? charge.payment_intent
            : charge?.payment_intent?.id || null,
      },
    });
  }
}
