import { json, method, readJson, requireAllowedBrowserOrigin, requireLeadSession } from "../lib/http.js";
import { getJson } from "../lib/store.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedBrowserOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "unlock-offers", ...rateLimitConfig("UNLOCK_OFFERS", 60, 3600) }))) return;

  try {
    const { leadId } = await readJson(req);
    const normalizedLeadId = String(leadId || "").trim().slice(0, 100);
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(normalizedLeadId)) {
      return json(res, 400, { ok: false, error: "Lead non valido" });
    }
    if (!requireLeadSession(req, res, normalizedLeadId)) return;
    const lead = await getJson(`lead:${normalizedLeadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });
    if (lead.status !== "verified") return json(res, 403, { ok: false, error: "Lead non verificato" });

    json(res, 200, {
      ok: true,
      unlocked: true,
      message: "Lead verificato: il frontend puo mostrare le offerte complete.",
    });
  } catch (error) {
    console.error("unlock_offers_failed", {
      message: String(error?.message || "unlock_offers_error").slice(0, 240),
    });
    json(res, 400, { ok: false, error: "Impossibile sbloccare le offerte. Riprova." });
  }
}
