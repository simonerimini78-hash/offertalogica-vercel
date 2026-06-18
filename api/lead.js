import { createId } from "@paralleldrive/cuid2";
import { clientIp, json, method, readJson } from "../lib/http.js";
import { setJson } from "../lib/store.js";
import { sanitizeLead } from "../lib/validation.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;

  try {
    const body = await readJson(req);
    const lead = sanitizeLead(body);
    const id = createId();
    const retentionDays = Number(process.env.LEAD_RETENTION_DAYS || 30);
    const record = {
      id,
      ...lead,
      status: "pending_otp",
      calculation: body.calculation || null,
      consents: {
        service: lead.consentService,
        marketing: lead.consentMarketing,
        privacyVersion: body.privacyVersion || "v1",
      },
      meta: {
        ip: clientIp(req),
        userAgent: req.headers["user-agent"] || "",
        createdAt: new Date().toISOString(),
      },
    };

    await setJson(`lead:${id}`, record, retentionDays * 24 * 3600);
    json(res, 200, { ok: true, leadId: id, status: record.status });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore creazione lead" });
  }
}
