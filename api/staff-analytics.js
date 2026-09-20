import { json } from "../lib/http.js";

// Endpoint Staff legacy ritirato: analytics operative disponibili solo
// nel Control Center Staff autenticato con MFA.
export default function handler(_req, res) {
  return json(res, 404, { ok: false, error: "Not found" });
}
