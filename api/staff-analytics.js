import { json } from "../lib/http.js";

// Legacy Staff endpoint retired from the public production branch.
// Analytics are available only through the dedicated authenticated Staff application.
export default function handler(_req, res) {
  return json(res, 404, { ok: false, error: "Not found" });
}
