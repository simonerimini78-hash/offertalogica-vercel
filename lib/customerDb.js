import crypto from "node:crypto";

const SUPABASE_URL =
  process.env.CUSTOMER_DB_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const LEADS_TABLE = process.env.CUSTOMER_DB_LEADS_TABLE || "lead_records";
const EVENTS_TABLE = process.env.CUSTOMER_DB_EVENTS_TABLE || "lead_events";

function configured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function baseUrl() {
  return String(SUPABASE_URL || "").replace(/\/+$/, "");
}

function tableUrl(table, query = "") {
  return `${baseUrl()}/rest/v1/${table}${query}`;
}

function headers(prefer = "return=minimal") {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

function cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cleanUndefined(item)])
  );
}

function hashValue(value) {
  const secret = process.env.CUSTOMER_DB_HASH_SECRET || process.env.OTP_SECRET || "";
  if (!secret || !value) return null;
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scrubRecord(lead) {
  const record = cleanUndefined(JSON.parse(JSON.stringify(lead || {})));
  const ipHash = hashValue(record.meta?.ip);
  if (record.meta?.ip) delete record.meta.ip;
  if (ipHash) record.meta = { ...record.meta, ipHash };
  return record;
}

function rowFromLead(lead) {
  const calculation = lead?.calculation || {};
  const consents = lead?.consents || {};
  const proof = consents.proof || {};
  return cleanUndefined({
    id: lead.id,
    created_at: lead.meta?.createdAt || lead.verifiedAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: lead.status || null,
    customer_type: calculation.customerType || "privato",
    name: lead.name || null,
    email: lead.email || null,
    phone: lead.phone || null,
    source: proof.source || null,
    privacy_version: consents.privacyVersion || proof.version || null,
    consent_service: Boolean(consents.service ?? lead.consentService),
    consent_marketing: Boolean(consents.marketing ?? lead.consentMarketing),
    consent_partners: Boolean(consents.partners ?? lead.consentPartners),
    consent_profiling: Boolean(consents.profiling ?? lead.consentProfiling),
    best_saving: numberOrNull(calculation.bestSaving),
    selected_offer: lead.selectedOffer || null,
    calculation,
    record: scrubRecord(lead),
  });
}

async function upsertLeadRow(lead) {
  const response = await fetch(tableUrl(LEADS_TABLE, "?on_conflict=id"), {
    method: "POST",
    headers: headers("resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify([rowFromLead(lead)]),
  });
  if (!response.ok) throw new Error(`Customer DB lead error ${response.status}`);
  return true;
}

async function insertEvent(lead, eventType, payload = {}) {
  const response = await fetch(tableUrl(EVENTS_TABLE), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify([cleanUndefined({
      lead_id: lead.id,
      event_type: eventType,
      created_at: new Date().toISOString(),
      payload: {
        status: lead.status || null,
        selectedOffer: lead.selectedOffer || null,
        monetization: lead.monetization || null,
        notification: lead.notification || null,
        customerType: lead.calculation?.customerType || "privato",
        ...payload,
      },
    })]),
  });
  if (!response.ok) throw new Error(`Customer DB event error ${response.status}`);
  return true;
}

export function customerDbConfigured() {
  return configured();
}

export async function persistLeadSnapshot(lead, eventType, payload = {}) {
  if (!configured()) return { ok: true, skipped: true, reason: "not_configured" };
  if (!lead?.id) return { ok: false, skipped: false, error: "lead_id_missing" };
  try {
    await upsertLeadRow(lead);
    if (eventType) await insertEvent(lead, eventType, payload);
    return { ok: true, skipped: false };
  } catch (error) {
    return { ok: false, skipped: false, error: error.message || "customer_db_error" };
  }
}

export async function checkCustomerDb() {
  if (!configured()) return { ok: true, configured: false, status: "not_configured" };
  try {
    const response = await fetch(tableUrl(LEADS_TABLE, "?select=id&limit=1"), {
      method: "GET",
      headers: headers("return=minimal"),
    });
    return {
      ok: response.ok,
      configured: true,
      status: response.ok ? "ready" : `error_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: "error",
      error: error.message || "customer_db_error",
    };
  }
}
