import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";
import { persistentStoreConfigured } from "../lib/store.js";

const STAFF_PREVIEW_VERIFY_URL = "https://staff.offertalogica.it/api/staff-preview";
const STAFF_PREVIEW_VERIFY_TIMEOUT_MS = 7000;
const STAFF_PREVIEW_TARGETS = new Set([
  "/",
  "/speed-test.html",
  "/fotovoltaico.html",
  "/climatizzazione-pompa-di-calore.html",
]);

function normalizePreviewTarget(value) {
  const target = String(value || "/").trim();
  return STAFF_PREVIEW_TARGETS.has(target) ? target : "/";
}

function previewTarget(req) {
  try {
    const url = new URL(req.url || "/api/staff-preview", `https://${req.headers.host || "offertalogica.it"}`);
    return normalizePreviewTarget(url.searchParams.get("target"));
  } catch {
    return "/";
  }
}

function previewBootstrap(res, target) {
  const safeTarget = JSON.stringify(target);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  res.end(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anteprima Staff OffertaLogica</title><style>body{font-family:system-ui,sans-serif;padding:32px;color:#17342c}p{max-width:640px;line-height:1.5}</style></head><body><p id="status">Attivazione modalità Staff…</p><script>(async()=>{const status=document.getElementById("status");const params=new URLSearchParams(location.hash.slice(1));const ticket=String(params.get("staffPreview")||"").trim();history.replaceState(null,"",location.pathname+location.search);if(!ticket){status.textContent="Ticket Staff mancante.";return}try{const response=await fetch("/api/staff-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket,target:${safeTarget}}),cache:"no-store"});const payload=await response.json();if(!response.ok||payload?.ok!==true)throw new Error(payload?.error||"Ticket non valido");sessionStorage.setItem("offertalogicaStaffMode","true");location.replace(${safeTarget});}catch(error){status.textContent=String(error?.message||error||"Attivazione Staff non riuscita");}})();</script></body></html>`);
}

async function verifyWithStaffBackend(ticket, target) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STAFF_PREVIEW_VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(STAFF_PREVIEW_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", ticket, target }),
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

async function enforcePreviewRateLimit(req, res) {
  // I ticket sono HMAC a breve scadenza e vengono emessi solo a Staff autenticato.
  // Se il KV non è configurato, non rendiamo indisponibile la preview: il limite
  // persistente resta attivo automaticamente quando lo store è disponibile.
  if (!persistentStoreConfigured()) return true;
  return enforceRateLimit(req, res, { label: "staff-preview", ...rateLimitConfig("STAFF_PREVIEW", 20) });
}

export default async function handler(req, res) {
  if (!method(req, res, ["GET", "POST"])) return;
  if (req.method === "GET") {
    previewBootstrap(res, previewTarget(req));
    return;
  }
  if (!requireAllowedOrigin(req, res)) return;
  if (!(await enforcePreviewRateLimit(req, res))) return;

  try {
    const body = await readJson(req);
    const ticket = String(body.ticket || "").trim();
    const target = normalizePreviewTarget(body.target);
    if (!ticket) {
      return json(res, 403, {
        ok: false,
        error: "Ticket Staff non valido o scaduto",
        code: "staff_preview_ticket_missing",
      });
    }

    let verified;
    try {
      verified = await verifyWithStaffBackend(ticket, target);
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
        error: verified.error || "Ticket Staff non valido o scaduto",
        code: "staff_preview_ticket_rejected",
      });
    }

    return json(res, 200, {
      ok: true,
      mode: "staff",
      target,
      activatedAt: new Date().toISOString(),
    });
  } catch {
    return json(res, 400, { ok: false, error: "Richiesta staff non valida" });
  }
}
