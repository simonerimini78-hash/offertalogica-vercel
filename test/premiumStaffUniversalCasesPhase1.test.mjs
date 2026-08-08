import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const htmlPath = new URL("../public/staff.html", import.meta.url);
const jsPath = new URL("../public/staff.js", import.meta.url);

async function source() {
  const [html, js] = await Promise.all([
    readFile(htmlPath, "utf8"),
    readFile(jsPath, "utf8"),
  ]);
  return { html, js };
}

test("fase 1 rende Pratiche il punto di ingresso operativo senza sostituire le verifiche bollette", async () => {
  const { html, js } = await source();
  assert.match(html, /data-staff-tab="cases"[^>]*>Pratiche/);
  assert.match(html, /data-staff-view="cases"/);
  assert.match(html, /<h2>Pratiche operative<\/h2>/);
  assert.match(html, /data-staff-tab="checks"[^>]*>Verifiche bollette/);
  assert.match(js, /VALID_TABS = new Set\(\["overview", "cases", "leads", "checks"/);
});

test("fase 1 aggrega soltanto segnali già esistenti: bollette, cancellazioni, pagamenti e IA fallita", async () => {
  const { js } = await source();
  for (const type of ["bill_check", "account_deletion", "payment", "ai_failure"]) {
    assert.match(js, new RegExp(`type: "${type}"`));
  }
  assert.match(js, /client\.from\("premium_checks"\)/);
  assert.match(js, /client\.from\("premium_analysis_runs"\)/);
  assert.match(js, /cache\.customers\.forEach/);
  assert.doesNotMatch(js, /premium_support_cases/);
});

test("fase 1 resta senza una nuova API o tabella dedicata alle Pratiche anche dopo le estensioni successive", async () => {
  const { html, js } = await source();
  assert.match(html, /senza cambiare database, API o flussi cliente/);
  assert.doesNotMatch(js, /premium_support_cases/);
  assert.doesNotMatch(js, /staffFetch\(["'`]\/api\/support/);
  assert.match(js, /client\.from\("premium_checks"\)/);
  assert.match(js, /client\.from\("premium_communications"\)/);
});
