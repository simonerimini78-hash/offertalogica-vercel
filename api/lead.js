import { createId } from "@paralleldrive/cuid2";
import { clientIp, json, method, readJson } from "../lib/http.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { setJson } from "../lib/store.js";
import { sanitizeLead } from "../lib/validation.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!(await enforceRateLimit(req, res, { label: "lead", ...rateLimitConfig("LEAD", 30) }))) return;

  try {
    const body = await readJson(req);
    const lead = sanitizeLead(body);
    const id = createId();
    const retentionDays = Number(process.env.LEAD_RETENTION_DAYS || 30);
    const createdAt = new Date().toISOString();
    const privacyVersion = String(body.privacyVersion || "privacy-lead-v1").slice(0, 80);
    const clientProof = body.consentProof && typeof body.consentProof === "object" ? body.consentProof : {};
    const record = {
      id,
      ...lead,
      status: "pending_otp",
      calculation: body.calculation || null,
      consents: {
        service: lead.consentService,
        marketing: lead.consentMarketing,
        partners: lead.consentPartners,
        profiling: lead.consentProfiling,
        privacyVersion,
        proof: {
          version: privacyVersion,
          clientAcceptedAt: String(clientProof.acceptedAt || "").slice(0, 40),
          source: String(clientProof.source || "unknown").slice(0, 40),
          page: String(clientProof.page || "").slice(0, 180),
          serverReceivedAt: createdAt,
        },
      },
      meta: {
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] || "",
        createdAt,
      },
    };

    await setJson(`lead:${id}`, record, retentionDays * 24 * 3600);
    json(res, 200, { ok: true, leadId: id, status: record.status });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore creazione lead" });
  }
}
