import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyLandingPathRows } from "../api/staff-analytics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const html = fs.readFileSync(path.join(root, "public", "staff.html"), "utf8");
const staffJs = fs.readFileSync(path.join(root, "public", "staff.js"), "utf8");
const api = fs.readFileSync(path.join(root, "api", "staff-analytics.js"), "utf8");

test("Staff Statistiche conserva il confronto dei due percorsi landing", () => {
  for (const id of [
    "landingPathPanel",
    "landingPathViews",
    "landingPathSelections",
    "landingPathSelfCount",
    "landingPathAssistedCount",
    "landingPathSelfShare",
    "landingPathAssistedShare",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Confronto in autonomia/);
  assert.match(html, /Preferisco essere guidato/);
  assert.match(html, /quota dei click di scelta, non le vendite/);
});

test("Il periodo landing offre 7 giorni, 30 giorni e totale con default 30 giorni", () => {
  assert.match(html, /id="landingPathRange"/);
  assert.match(html, /<option value="7d">Ultimi 7 giorni<\/option>/);
  assert.match(html, /<option value="30d" selected>Ultimi 30 giorni<\/option>/);
  assert.match(html, /<option value="all">Tutto<\/option>/);
  assert.match(api, /new Set\(\["7d", "30d", "all"\]\)/);
  assert.match(api, /String\(value \|\| "30d"\)/);
});

test("Le impressioni landing sono separate in probabili persone, bot-automazioni e non determinabili", () => {
  const result = classifyLandingPathRows([
    { id: 1, event_type: "landing_view", payload: { sessionId: "human-a", trafficAgent: "browser" } },
    { id: 2, event_type: "landing_self_service_click", payload: { sessionId: "human-a", trafficAgent: "browser" } },
    { id: 3, event_type: "landing_view", payload: { sessionId: "human-b", trafficAgent: "browser" } },
    { id: 4, event_type: "landing_assisted_click", payload: { sessionId: "human-b", trafficAgent: "browser" } },
    { id: 5, event_type: "landing_view", payload: { sessionId: "bot", trafficAgent: "known_bot" } },
    { id: 6, event_type: "landing_self_service_click", payload: { sessionId: "bot", trafficAgent: "known_bot" } },
    { id: 7, event_type: "landing_view", payload: { sessionId: "auto", trafficAgent: "automation" } },
    { id: 8, event_type: "landing_view", payload: { sessionId: "browser-only", trafficAgent: "browser" } },
    { id: 9, event_type: "landing_view", payload: { sessionId: "legacy" } },
  ]);

  assert.equal(result.views, 6);
  assert.equal(result.traffic.probablePersonViews, 2);
  assert.equal(result.traffic.knownBotViews, 1);
  assert.equal(result.traffic.automationViews, 1);
  assert.equal(result.traffic.suspiciousViews, 2);
  assert.equal(result.traffic.undeterminedViews, 2);
  assert.equal(result.traffic.probablePersonShare, 33.3);

  // Le percentuali commerciali usano solo click di sessioni classificate
  // come probabili persone: il click del bot resta nel dato grezzo ma non
  // entra nel confronto dei due percorsi.
  assert.equal(result.rawTotalSelections, 3);
  assert.equal(result.totalSelections, 2);
  assert.equal(result.selfServiceClicks, 1);
  assert.equal(result.assistedClicks, 1);
  assert.equal(result.selfServiceShare, 50);
  assert.equal(result.assistedShare, 50);
});

test("Una firma bot prevale su browser e interazioni della stessa sessione", () => {
  const result = classifyLandingPathRows([
    { id: 1, event_type: "landing_view", payload: { sessionId: "mixed", trafficAgent: "browser" } },
    { id: 2, event_type: "lead_modal_opened", payload: { sessionId: "mixed", trafficAgent: "browser" } },
    { id: 3, event_type: "landing_self_service_click", payload: { sessionId: "mixed", trafficAgent: "known_bot" } },
  ]);
  assert.equal(result.traffic.probablePersonViews, 0);
  assert.equal(result.traffic.knownBotViews, 1);
  assert.equal(result.totalSelections, 0);
  assert.equal(result.rawTotalSelections, 1);
});

test("L API usa i segnali server già registrati e pagina gli eventi rilevanti senza nuova tabella", () => {
  assert.match(api, /landing_view/);
  assert.match(api, /landing_self_service_click/);
  assert.match(api, /landing_assisted_click/);
  assert.match(api, /trafficAgent/);
  assert.match(api, /LANDING_SIGNAL_PAGE_SIZE = 1000/);
  assert.match(api, /LANDING_SIGNAL_MAX_ROWS = 20000/);
  assert.match(api, /event_type: `in\.\(\$\{\[\.\.\.LANDING_SIGNAL_EVENT_TYPES\]\.join\(","\)\}\)`/);
  assert.match(api, /created_at.*`gte\.\$\{from\}`/s);
  assert.match(api, /Volume statistiche landing oltre il limite di lettura sicura/);
});

test("Il Control Center aggiunge una lettura esplicita della qualità delle impressioni", () => {
  for (const id of [
    "landingTrafficMetrics",
    "landingTrafficProbable",
    "landingTrafficSuspicious",
    "landingTrafficSuspiciousDetail",
    "landingTrafficUndetermined",
    "landingTrafficProbableShare",
  ]) {
    assert.match(staffJs, new RegExp(id));
  }
  assert.match(staffJs, /Probabili persone/);
  assert.match(staffJs, /Automazioni \/ bot/);
  assert.match(staffJs, /Non determinabili/);
  assert.match(staffJs, /Scelte probabili persone/);
  assert.match(staffJs, /landingRange=.*encodeURIComponent\(landingRange\)/);
});

test("Il pannello usa la sessione Staff e non espone credenziali Customer DB", () => {
  assert.match(html, /offertalogica-premium-staff-auth/);
  assert.match(html, /Authorization:`Bearer \$\{token\}`/);
  assert.doesNotMatch(html, /CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(staffJs, /CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(api, /process\.env\.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY/);
});

test("La GET analytics mantiene autorizzazioni, cancellazione e risposta landingPath", () => {
  assert.match(api, /listCustomerAnalytics\(\{ limit \}\)/);
  assert.match(api, /loadLandingPathAnalytics\(landingRange\)/);
  assert.match(api, /\.\.\.result,\s*landingPath,/s);
  assert.match(api, /\["GET", "DELETE"\]/);
  assert.match(api, /requireStaffSession/);
  assert.match(api, /AZZERA_ANALYTICS/);
  assert.match(api, /ELIMINA_ANALYTICS_VISIBILI/);
});


test("Il funnel operativo esclude bot e automazioni e conserva il grezzo per audit", () => {
  assert.match(api, /const probableEvents = events\.filter\(\(event\) => event\.visitorType === "probable_person"\)/);
  assert.match(api, /funnel: funnelFromProbablePeople\(probableEvents\)/);
  assert.match(api, /rawFunnel: result\.summary\?\.funnel/);
  assert.match(api, /uniqueSessions: probableSessions\.size/);
  assert.match(api, /linkedLeads: probableLeads\.size/);
});
