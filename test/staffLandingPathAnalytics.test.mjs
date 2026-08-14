import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const html = fs.readFileSync(path.join(root, "public", "staff.html"), "utf8");
const api = fs.readFileSync(path.join(root, "api", "staff-analytics.js"), "utf8");

test("Staff Statistiche espone il confronto dei due percorsi landing", () => {
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

test("L API esistente conta esattamente i tre eventi landing senza nuova route", () => {
  assert.match(api, /landing_view/);
  assert.match(api, /landing_self_service_click/);
  assert.match(api, /landing_assisted_click/);
  assert.match(api, /Prefer: "count=exact"/);
  assert.match(api, /Range: "0-0"/);
  assert.match(api, /content-range/);
  assert.match(api, /event_type: `eq\.\$\{eventType\}`/);
  assert.match(api, /created_at.*`gte\.\$\{from\}`/s);
});

test("Le percentuali sono calcolate solo sui click di scelta", () => {
  assert.match(api, /const totalSelections = selfServiceClicks \+ assistedClicks;/);
  assert.match(api, /selfServiceShare: percentage\(selfServiceClicks, totalSelections\)/);
  assert.match(api, /assistedShare: percentage\(assistedClicks, totalSelections\)/);
  assert.match(html, /Le percentuali confrontano esclusivamente i click sui due percorsi/);
});

test("Il pannello usa la sessione Staff e non espone credenziali Customer DB", () => {
  assert.match(html, /offertalogica-premium-staff-auth/);
  assert.match(html, /Authorization:`Bearer \$\{token\}`/);
  assert.doesNotMatch(html, /CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(api, /process\.env\.CUSTOMER_DB_SUPABASE_SERVICE_ROLE_KEY/);
});

test("La GET analytics mantiene il riepilogo esistente e aggiunge landingPath", () => {
  assert.match(api, /listCustomerAnalytics\(\{ limit \}\)/);
  assert.match(api, /loadLandingPathAnalytics\(landingRange\)/);
  assert.match(api, /\.\.\.result,\s*landingPath,/s);
  assert.match(api, /\["GET", "DELETE"\]/);
  assert.match(api, /AZZERA_ANALYTICS/);
});
