import test from "node:test";
import assert from "node:assert/strict";
import {
  loadPremiumCustomerBill,
  createPremiumAnalysisRun,
} from "../lib/premiumAiBackend.js";

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
  model: "gpt-4.1-2025-04-14",
};

function analyzingBill() {
  return {
    id: "bill-hera",
    user_id: "user-1",
    utility_id: "utility-1",
    contract_id: null,
    commodity: "electricity",
    original_file_name: "bolletta.hera.alessio.pdf",
    file_size: 497000,
    storage_bucket: "premium-bills",
    storage_path: "user-1/bolletta.hera.alessio.pdf",
    processing_status: "analyzing",
    customer_status: "awaiting_review",
    automatic_screening_status: "running",
    deleted_at: null,
    created_at: new Date(Date.now() - 300000).toISOString(),
  };
}

test("v0.36.50 recupera una bolletta analyzing con run stale senza creare un blocco permanente", async () => {
  const calls = [];
  const bill = analyzingBill();
  const staleStartedAt = new Date(Date.now() - 180000).toISOString();

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    const body = String(init.body || "");
    calls.push({ target, method, body });

    if (target.includes("/rest/v1/premium_bills?") && method === "GET") {
      return jsonResponse([bill]);
    }
    if (target.includes("status=in.%28queued%2Crunning%29") && method === "GET") {
      return jsonResponse([{
        id: "run-stale",
        status: "running",
        run_number: 1,
        started_at: staleStartedAt,
      }]);
    }
    if (target.includes("/rest/v1/premium_analysis_runs?") && method === "PATCH") {
      return jsonResponse([{ id: "run-stale" }]);
    }
    if (target.includes("order=run_number.desc") && method === "GET") {
      return jsonResponse([{ run_number: 1 }]);
    }
    if (target.endsWith("/rest/v1/premium_analysis_runs") && method === "POST") {
      return jsonResponse([{ id: "run-2", run_number: 2 }], 201);
    }
    if (target.includes("/rest/v1/premium_bills?") && method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${method} ${target}`);
  };

  const loaded = await loadPremiumCustomerBill({
    config,
    billId: bill.id,
    userId: bill.user_id,
    fetchImpl,
  });
  assert.equal(loaded.processing_status, "analyzing");

  const run = await createPremiumAnalysisRun({
    config,
    bill: loaded,
    requestedByUserId: bill.user_id,
    origin: "customer_upload",
    staleAfterMs: 90000,
    fetchImpl,
  });

  assert.equal(run.id, "run-2");

  const stalePatch = calls.find(
    call => call.method === "PATCH" && call.target.includes("premium_analysis_runs"),
  );
  assert.ok(stalePatch, "il vecchio run stale deve essere chiuso");
  assert.match(stalePatch.body, /premium_analysis_stale_recovered/);

  const runPosts = calls.filter(
    call => call.method === "POST" && call.target.endsWith("/rest/v1/premium_analysis_runs"),
  );
  assert.equal(runPosts.length, 1, "deve essere creato un solo nuovo run");

  assert.ok(calls.some(
    call => call.method === "PATCH"
      && call.target.includes("/rest/v1/premium_bills?")
      && call.body.includes('"automatic_screening_status":"running"'),
  ));
});

test("v0.36.50 non duplica un run analyzing ancora realmente attivo", async () => {
  const calls = [];
  const bill = analyzingBill();

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method || "GET";
    const body = String(init.body || "");
    calls.push({ target, method, body });

    if (target.includes("/rest/v1/premium_bills?") && method === "GET") {
      return jsonResponse([bill]);
    }
    if (target.includes("status=in.%28queued%2Crunning%29") && method === "GET") {
      return jsonResponse([{
        id: "run-active",
        status: "running",
        run_number: 1,
        started_at: new Date().toISOString(),
      }]);
    }
    throw new Error(`Unexpected ${method} ${target}`);
  };

  const loaded = await loadPremiumCustomerBill({
    config,
    billId: bill.id,
    userId: bill.user_id,
    fetchImpl,
  });

  await assert.rejects(
    () => createPremiumAnalysisRun({
      config,
      bill: loaded,
      requestedByUserId: bill.user_id,
      origin: "customer_upload",
      staleAfterMs: 90000,
      fetchImpl,
    }),
    /premium_analysis_already_running/,
  );

  assert.equal(
    calls.some(call => call.method === "POST" && call.target.endsWith("/rest/v1/premium_analysis_runs")),
    false,
    "un run attivo non deve essere duplicato",
  );
});

test("v0.36.50 non rende riavviabili stati estranei come queued", async () => {
  const bill = { ...analyzingBill(), processing_status: "queued" };
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes("/rest/v1/premium_bills?") && (init.method || "GET") === "GET") {
      return jsonResponse([bill]);
    }
    throw new Error(`Unexpected ${(init.method || "GET")} ${target}`);
  };

  await assert.rejects(
    () => loadPremiumCustomerBill({
      config,
      billId: bill.id,
      userId: bill.user_id,
      fetchImpl,
    }),
    /premium_bill_not_auto_analyzable/,
  );
});
