import { json } from "./http.js";

/**
 * Compatibilità fail-closed per il vecchio accesso Staff a token condiviso.
 * I flussi runtime devono usare requireStaffSession() e, per la preview sito,
 * i ticket firmati a breve scadenza emessi da /api/staff-preview.
 */
export function requireStaffToken(_req, res) {
  json(res, 410, {
    ok: false,
    error: "Autenticazione Staff legacy non più supportata",
    code: "staff_legacy_token_disabled",
  });
  return false;
}
