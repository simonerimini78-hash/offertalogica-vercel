import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFile(path.join(root, relative), "utf8");

test("v0.34 espone cancellazione singola e massiva in tutti i moduli staff", async () => {
  const [html, js, checksHtml, checksJs, pdf] = await Promise.all([
    read("public/staff.html"),
    read("public/staff.js"),
    read("public/staff-premium.html"),
    read("public/staff-premium.js"),
    read("public/staff-pdf.html"),
  ]);
  assert.match(html, /v0\.(?:34|36)/);
  for (const id of [
    "leadDeleteVisible", "leadReset", "customerDeleteVisible",
    "analyticsDeleteVisible", "analyticsReset", "costDeleteRuns", "costDeleteEvents"
  ]) assert.match(html, new RegExp(`id="${id}"`));
  for (const fn of [
    "deleteVisibleLeads", "deleteAnalyticsEvent", "deleteVisibleAnalytics", "resetAnalytics",
    "deleteCustomerBill", "deleteCustomerContract", "deleteCustomerUtility", "deleteCustomerBlock",
    "deleteVisibleCustomers", "deleteCostRun", "deleteVisibleCostRuns", "deleteCostEvent", "deleteVisibleCostEvents"
  ]) assert.match(js, new RegExp(`function ${fn}\\(`));
  assert.match(js, /premium_staff_delete_records/);
  assert.match(js, /storage\.from\("premium-bills"\)\.remove/);
  assert.match(checksHtml, /staffDeleteVisibleChecks/);
  assert.match(checksJs, /handleAdminDeleteCheck/);
  assert.match(checksJs, /handleAdminDeleteVisibleChecks/);
  assert.match(checksJs, /ELIMINA BOLLETTA E BLOCCO/);
  assert.match(pdf, /delete-visible-pdf/);
  assert.match(pdf, /delete-all-pdf/);
  assert.match(pdf, /deletePdfBlock/);
});

test("le API esistenti gestiscono cancellazioni massive senza nuova funzione Vercel", async () => {
  const [leadApi, analyticsApi, pdfApi, db, archive] = await Promise.all([
    read("api/staff-leads.js"),
    read("api/staff-analytics.js"),
    read("api/staff-pdf-analyses.js"),
    read("lib/customerDb.js"),
    read("lib/pdfArchive.js"),
  ]);
  assert.match(leadApi, /ELIMINA_LEAD_VISIBILI/);
  assert.match(analyticsApi, /\["GET", "DELETE"\]/);
  assert.match(analyticsApi, /AZZERA_ANALYTICS/);
  assert.match(analyticsApi, /ELIMINA_ANALYTICS_VISIBILI/);
  assert.match(pdfApi, /AZZERA_ARCHIVIO_PDF/);
  assert.match(pdfApi, /ELIMINA_PDF_VISIBILI/);
  assert.match(db, /export async function deleteCustomerAnalytics/);
  assert.match(archive, /export async function deletePdfAnalyses/);
  const apiFiles = (await fs.readdir(path.join(root, "api"))).filter(name => name.endsWith(".js"));
  assert.equal(apiFiles.length, 12);
  assert.ok(!apiFiles.includes("health.js"));
});

test("la migrazione rende atomiche le cancellazioni Premium e limita i reviewer", async () => {
  const [migration, verify] = await Promise.all([
    read("supabase/premium-staff-deletion-v0.34.sql"),
    read("supabase/premium-staff-deletion-v0.34-verify.sql"),
  ]);
  assert.match(migration, /create or replace function public\.premium_staff_delete_records/);
  assert.match(migration, /premium_staff_role\(\) <> 'admin'/);
  for (const resource of ["bills", "contracts", "utilities", "customers", "checks", "analysis_runs", "cost_events"]) {
    assert.match(migration, new RegExp(`v_resource = '${resource}'`));
  }
  assert.match(migration, /premium_bills_staff_select/);
  assert.match(migration, /premium_bills_admin_select/);
  assert.match(migration, /revoke all on function public\.premium_staff_delete_records.*anon/s);
  for (const field of [
    "deletion_rpc_present", "deletion_rpc_security_definer", "authenticated_can_execute_deletion_rpc",
    "anon_cannot_execute_deletion_rpc", "admin_bill_metadata_policy_present",
    "reviewer_bill_request_policy_present", "staff_all_policies_are_select_only",
    "storage_request_policy_still_present", "storage_admin_delete_policy_present"
  ]) assert.match(verify, new RegExp(field));
});
