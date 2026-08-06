import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("v0.36.22 applica 2 abitazioni, 60 bollette annue e 30 per abitazione", async () => {
  const [sql, app, auth, utilities, bills, terms, billing] = await Promise.all([
    read("supabase/premium-home-bill-limits-terms-v0.36.22.sql"), read("public/app.html"),
    read("public/app-auth.js"), read("public/app-utilities.js"), read("public/app-premium-bills.js"),
    read("public/termini-condizioni.html"), read("supabase/functions/premium-billing/index.ts")
  ]);
  assert.match(sql,/new\.included_utilities := 4/);
  assert.match(sql,/new\.included_bills_per_year := 60/);
  assert.match(sql,/home_bill_count[\s\S]*< 30/);
  assert.match(sql,/count\(\*\) from home_keys\) <= 2/);
  assert.match(sql,/premium-terms-v0\.36\.22-2026-08-06/);
  assert.match(app,/Fino a 60 bollette per ogni periodo annuale/);
  assert.match(app,/Fino a 2 abitazioni, con luce e gas/);
  assert.match(auth,/2 abitazioni · 60 bollette\/anno/);
  assert.match(utilities,/homes\.size > 2/);
  assert.match(bills,/60 bollette nel periodo annuale/);
  assert.match(terms,/massimo di 30 bollette per ciascuna abitazione/);
  assert.match(billing,/included_utilities: preserveTrial \? row\.included_utilities : 4/);
  assert.match(billing,/included_bills_per_year: preserveTrial \? row\.included_bills_per_year : 60/);
});

test("prova gratuita resta a una abitazione e quattro bollette", async () => {
  const [sql, app, utilities] = await Promise.all([read("supabase/premium-home-bill-limits-terms-v0.36.22.sql"),read("public/app.html"),read("public/app-utilities.js")]);
  assert.match(sql,/new\.included_utilities := 2/);
  assert.match(sql,/new\.included_bills_per_year := 4/);
  assert.match(app,/Massimo 4 bollette complessivamente caricate/);
  assert.match(app,/Fino a 2 utenze luce e gas della stessa abitazione/);
  assert.match(utilities,/Durante la prova le utenze luce e gas devono riferirsi alla stessa abitazione/);
});

test("Liquid Glass argento e testi piano sono più leggibili senza cambiare layout", async () => {
  const app=await read("public/app.html");
  assert.match(app,/v0\.36\.23 — fondo argento/);
  assert.match(app,/linear-gradient\(155deg,#eef2f0 0%,#d1d8d5 50%,#f3f5f4 100%\)/);
  assert.match(app,/linear-gradient\(145deg,#087b39 0%,#0ea046 48%,#7dcd2b 100%\)/);
  assert.match(app,/premium-plan-card \.premium-point\{[^}]*font-size:13px/);
  assert.match(app,/premium-renewal\{[^}]*font-size:12\.5px/);
  for (const id of ["view-home","view-bill","view-offers","view-profile"]) assert.match(app,new RegExp(`id="${id}"`));
});

test("app automatica e staff manuale usano il manifest anti-cache", async () => {
  const [app,staff,manifest,sw]=await Promise.all([read("public/app.html"),read("public/staff.html"),read("public/version.json"),read("public/sw.js")]);
  assert.equal(JSON.parse(manifest).version,"0.36.23");
  assert.match(sw,/offertalogica-premium-v03623/);
  assert.match(app,/setInterval\(checkForUpdate,30000\)/);
  assert.match(app,/worker\.postMessage\(\{type:'SKIP_WAITING'\}\)/);
  assert.match(staff,/id="staffApplyUpdate"/);
  assert.match(staff,/applyButton\?\.addEventListener\('click',applyUpdate\)/);
  assert.match(staff,/Aggiorna quando hai terminato il lavoro/);
});

test("v0.36.23 resta entro 12 funzioni Vercel", async () => {
  const api=(await readdir(new URL("../api/",import.meta.url))).filter(name=>name.endsWith(".js"));
  assert.equal(api.length,12);
});
