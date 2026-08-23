import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { staffPreviewTokenValid } from "../lib/staffAuth.js";

const STAFF_PREVIEW_VERIFY_URL = "https://staff.offertalogica.it/api/staff-preview";
const STAFF_PREVIEW_VERIFY_TIMEOUT_MS = 7000;

async function verifyWithStaffBackend(token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STAFF_PREVIEW_VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(STAFF_PREVIEW_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", token }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok && payload?.ok === true,
      status: response.status,
      error: String(payload?.error || ""),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforceRateLimit(req, res, { label: "staff-preview", ...rateLimitConfig("STAFF_PREVIEW", 20) }))) return;

  try {
    const body = await readJson(req);
    const token = String(body.token || "").trim();
    if (!token) {
      return json(res, 403, { ok: false, error: "Token staff non valido" });
    }

    // Compatibilità con il vecchio token condiviso e con installazioni in cui
    // i due deployment usano già la stessa chiave di firma.
    if (!staffPreviewTokenValid(token)) {
      // La fonte autorevole del ticket è il backend Staff che lo ha emesso.
      // In questo modo il sito pubblico non deve condividere segreti con il
      // deployment Staff e non può rifiutare ticket validi per chiavi diverse.
      let verified;
      try {
        verified = await verifyWithStaffBackend(token);
      } catch (error) {
        console.error("staff_preview_remote_verify_failed", {
          message: String(error?.message || error || "verification_failed").slice(0, 180),
        });
        return json(res, 503, {
          ok: false,
          error: "Verifica modalità Staff temporaneamente non disponibile",
          code: "staff_preview_verify_unavailable",
        });
      }

      if (!verified.ok) {
        return json(res, 403, {
          ok: false,
          error: verified.error || "Token staff non valido",
          code: "staff_preview_ticket_rejected",
        });
      }
    }

    return json(res, 200, {
      ok: true,
      mode: "staff",
      activatedAt: new Date().toISOString(),
    });
  } catch {
    return json(res, 400, { ok: false, error: "Richiesta staff non valida" });
  }
}
