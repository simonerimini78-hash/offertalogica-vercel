import { json, method, readJson } from "../lib/http.js";
import { getJson } from "../lib/store.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;

  try {
    const { leadId } = await readJson(req);
    const lead = await getJson(`lead:${leadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });
    if (lead.status !== "verified") return json(res, 403, { ok: false, error: "Lead non verificato" });

    json(res, 200, {
      ok: true,
      unlocked: true,
      message: "Lead verificato: il frontend puo mostrare le offerte complete.",
    });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore sblocco offerte" });
  }
}
