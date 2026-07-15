import { json, method } from "../lib/http.js";
import { requireStaffToken } from "../lib/staffAuth.js";
import { createPdfSignedUrl } from "../lib/pdfArchive.js";

export default async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  if (!requireStaffToken(req, res)) return;
  const id = String(req.query?.id || "").trim();
  if (!id) return json(res, 400, { ok: false, error: "Analisi PDF mancante" });

  try {
    const signedUrl = await createPdfSignedUrl(id, 300);
    if (!signedUrl) return json(res, 404, { ok: false, error: "PDF non trovato" });
    return json(res, 200, { ok: true, signedUrl, expiresIn: 300 });
  } catch {
    return json(res, 500, { ok: false, error: "PDF non disponibile" });
  }
}
