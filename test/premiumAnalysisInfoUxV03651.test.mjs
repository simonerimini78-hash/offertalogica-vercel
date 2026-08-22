import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPremiumCustomerBill } from "../lib/premiumAiBackend.js";

const premiumBills = await readFile(new URL("../public/app-premium-bills.js", import.meta.url), "utf8");
const premiumApi = await readFile(new URL("../api/premium-ai-analysis.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function jsonResponse(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const config = {
  supabaseUrl: "https://example.supabase.co",
  serviceKey: "secret",
  bucket: "premium-bills",
  maxPdfBytes: 20_000_000,
};

test("v0.36.51 una bolletta completed non può consumare una nuova analisi IA", async () => {
  const bill = {
    id: "bill-completed",
    user_id: "user-1",
    utility_id: "utility-1",
    contract_id: null,
    commodity: "gas",
    original_file_name: "bolletta-gas.pdf",
    file_size: 500000,
    storage_bucket: "premium-bills",
    storage_path: "user-1/bolletta-gas.pdf",
    processing_status: "completed",
    customer_status: "correct",
    automatic_screening_status: "clear",
    deleted_at: null,
    created_at: new Date().toISOString(),
  };
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("/rest/v1/premium_bills?") && (init.method || "GET") === "GET") {
      return jsonResponse([bill]);
    }
    throw new Error(`Unexpected ${(init.method || "GET")} ${target}`);
  };

  await assert.rejects(
    () => loadPremiumCustomerBill({ config, billId: bill.id, userId: bill.user_id, fetchImpl }),
    /premium_bill_not_auto_analyzable/,
  );

  assert.match(premiumBills, /function analysisIsReadyToStart\(bill\)[\s\S]*?\["pending", "not_run", ""\][\s\S]*?\["uploaded", "ready_for_review", ""\]/);
  assert.match(premiumBills, /function analysisNeedsRetry\(bill\)[\s\S]*?analysisIsStale\(bill\)[\s\S]*?automatic_screening_status === "failed"[\s\S]*?processing_status === "failed"/);
  assert.doesNotMatch(premiumBills, /analysisIsReadyToStart\(bill\)[\s\S]{0,350}?completed/);
});

test("v0.36.51 la precisione limitata è informazione, non anomalia gialla", () => {
  assert.match(premiumBills, /comparison_precision_limited_[^\n]*\)\) return "info"/);
  assert.match(premiumBills, /title: `Nota sul confronto \$\{commodity\}`/);
  assert.match(premiumBills, /kind: "info"/);
  assert.doesNotMatch(premiumBills, /title: `Prezzo \$\{commodity\} da verificare`/);
  assert.doesNotMatch(premiumBills, /kind: "attention",\n\s*};\n\s*}\n\s*return \{\n\s*title: reason/);
  assert.match(premiumBills, /Prezzo letto · confronto indicativo/);
});

test("v0.36.51 il backend salva la precisione limitata come nota neutra e può chiudere verde", () => {
  assert.match(premiumApi, /code\.startsWith\("comparison_precision_limited_"\)/);
  assert.match(premiumApi, /title: `Nota sul confronto \$\{commodity\}`/);
  assert.match(premiumApi, /source: "comparison_precision"/);
  assert.match(premiumApi, /trafficLight: "neutral"/);
  assert.match(premiumApi, /code\.startsWith\("coerenza_comparison_precision_limited_"\)/);
  assert.match(premiumApi, /const actionableReasons = reasons\.filter\(reason => !isInformationalReason\(reason\)\)/);
  assert.match(premiumApi, /status: "clear"[\s\S]*?trafficLight: "green"[\s\S]*?customerStatus: "correct"/);
});

test("v0.36.51 il service worker forza il rinnovo del frontend Premium", () => {
  assert.match(sw, /premium-analysis-info-ux-v03651/);
  assert.match(sw, /offertalogica-premium-v03651-analysis-info-ux/);
  assert.match(sw, /"\/app-premium-bills\.js"/);
});
