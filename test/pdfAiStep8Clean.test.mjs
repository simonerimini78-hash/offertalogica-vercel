import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPdfAiBudgetPlan, pdfAiConfig } from "../lib/pdfAiConfig.js";
import {
  filterSafePdfAiCandidates,
  publicPdfAiStatus,
  runPdfAiPipeline,
} from "../lib/pdfAiPipeline.js";
import { buildRasterBatchPlan } from "../lib/pdfAiRasterBatchedReader.js";
import { buildRasterArchivePdf } from "../lib/pdfRasterArchive.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FALLBACK_ENV = Object.freeze({
  PDF_AI_MODE: "fallback",
  PDF_ANALYSIS_DEADLINE_MS: "55000",
  PDF_AI_RESPONSE_MARGIN_MS: "4000",
  PDF_AI_GENERAL_PHASE_MS: "24000",
  PDF_AI_CRITICAL_PHASE_MS: "22000",
});
const SHADOW_ENV = Object.freeze({
  ...FALLBACK_ENV,
  PDF_AI_MODE: "shadow",
});

function baseline(overrides = {}) {
  return {
    parser_version: "step7-test",
    page_count: 5,
    diagnostics: [],
    warnings: [],
    kind: "bolletta",
    commodity: "dual",
    customer_type: "privato",
    recognized: false,
    needsReview: true,
    ...overrides,
  };
}

function aiCandidate({
  field,
  value,
  unit = null,
  commodity = "dual",
  page = 1,
  label,
  evidence,
  semanticRole = "identifier",
  confidence = 94,
} = {}) {
  return {
    field,
    value_text: typeof value === "string" ? value : null,
    value_number: typeof value === "number" ? value : null,
    unit,
    commodity,
    page,
    label,
    evidence,
    semantic_role: semanticRole,
    confidence,
    agrees_with: [],
    contradicts: [],
  };
}

function validAiOutput({
  candidates = [],
  commodity = "dual",
  pageCount = 5,
  conflicts = [],
  reviewReasons = [],
} = {}) {
  return {
    document: {
      document_type: "bill",
      supplier: "Fornitore Test",
      commodity,
      customer_type: "consumer",
      page_count: pageCount,
    },
    quality: {
      native_text_quality: "none",
      visual_quality: "readable",
      table_density: "medium",
      ocr_recommended: true,
    },
    page_map: [{ page: 1, role: "riepilogo", summary: "Dati della fornitura" }],
    candidates,
    conflicts,
    review_reasons: reviewReasons,
  };
}

async function rasterFixture(t, pageCount = 5) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ol-step8-raster-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const filePath = path.join(directory, `page-${page}.jpg`);
    await fs.writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, page, 0xff, 0xd9]));
    files.push({ filePath, page, mimeType: "image/jpeg" });
  }
  return files;
}

function requestProfile(request) {
  return String(request?.text?.format?.name || "").replace("offertalogica_pdf_", "");
}

function requestPages(request) {
  const content = request?.input?.[1]?.content || [];
  return content
    .filter((item) => item?.type === "input_text")
    .flatMap((item) => [...String(item.text || "").matchAll(/original page (\d+)/g)])
    .map((match) => Number(match[1]));
}

function transportResponse(output, id = "resp_test") {
  return { id, output_text: JSON.stringify(output) };
}

function internalCandidate({
  field,
  value,
  unit,
  commodity,
  label,
  evidence,
  semanticRole,
} = {}) {
  return {
    id: `ai:${field}`,
    field,
    normalized_value: value,
    normalized_unit: unit,
    unit,
    commodity,
    page: 1,
    label,
    evidence,
    semantic_role: semanticRole,
    source: "ai",
    source_version: "test",
    confidence: 95,
    method: "gpt41_visual_test",
    warnings: [],
    status: "candidate",
  };
}

test("il budget Step 8 viene riservato prima delle chiamate", () => {
  const budget = createPdfAiBudgetPlan({
    raster: true,
    now: 1_000,
    deadlineAt: 56_000,
    env: FALLBACK_ENV,
  });
  assert.deepEqual(budget, {
    configVersion: "step8-clean-budget-v2-preview-active",
    mode: "fallback",
    totalBudgetMs: 55_000,
    responseMarginMs: 4_000,
    generalPhaseMs: 24_000,
    criticalPhaseMs: 22_000,
    generalRequestTimeoutMs: 23_250,
    criticalRequestTimeoutMs: 21_250,
    sufficient: true,
  });
});

test("la Preview attiva il fallback senza configurazione manuale e la produzione resta spenta", () => {
  assert.equal(pdfAiConfig({ VERCEL_ENV: "preview" }).mode, "fallback");
  assert.equal(pdfAiConfig({ VERCEL_ENV: "preview", PDF_AI_PREVIEW_MODE: "off" }).mode, "off");
  assert.equal(pdfAiConfig({ VERCEL_ENV: "production" }).mode, "off");
  assert.equal(pdfAiConfig({ PDF_AI_MODE: "shadow" }).mode, "shadow");
});

test("lo stato pubblico del lettore non espone errori grezzi del provider", () => {
  assert.deepEqual(publicPdfAiStatus({
    enabled: true,
    mode: "fallback",
    public_output: "step7_preserved_after_ai_failure",
    ai: {
      status: "failed",
      reason: "openai_http_400: dettagli privati del provider",
      candidate_count: 0,
      partial: false,
    },
    promoted: [],
  }), {
    mode: "fallback",
    status: "failed",
    reason: "openai_http_error",
    public_output: "step7_preserved_after_ai_failure",
    candidate_count: 0,
    promoted_count: 0,
    partial: false,
  });
});

test("una bolletta raster classificata dall'IA diventa riconosciuta e utilizzabile", async (t) => {
  const imageFiles = await rasterFixture(t);
  const result = await runPdfAiPipeline({
    imageFiles,
    filename: "bolletta-fotografata.pdf",
    normalized: baseline({ kind: "unknown", commodity: "unknown", recognized: false }),
    env: FALLBACK_ENV,
    apiKey: "test-key",
    transport: async ({ request }) => {
      const profile = requestProfile(request);
      const candidates = profile === "critical_luce"
        ? [aiCandidate({
          field: "consumo_luce_kwh",
          value: 2_700,
          unit: "kWh/anno",
          commodity: "electricity",
          label: "Consumo annuo energia elettrica",
          evidence: "Consumo annuo energia elettrica 2.700 kWh",
          semanticRole: "actual_customer_value",
        })]
        : profile === "critical_gas"
          ? [aiCandidate({
            field: "consumo_gas_smc",
            value: 640,
            unit: "Smc/anno",
            commodity: "gas",
            label: "Consumo annuo gas naturale",
            evidence: "Consumo annuo gas naturale 640 Smc",
            semanticRole: "actual_customer_value",
          })]
          : [];
      return transportResponse(validAiOutput({ candidates }), `resp_${profile}`);
    },
  });

  assert.equal(result.normalized.kind, "bolletta");
  assert.equal(result.normalized.commodity, "dual");
  assert.equal(result.normalized.fornitore, "Fornitore Test");
  assert.equal(result.normalized.recognized, true);
  assert.equal(result.normalized.consumo_luce_kwh, 2_700);
  assert.equal(result.normalized.consumo_gas_smc, 640);
  assert.equal(result.audit.public_output, "safe_review_merge");
  assert.equal(publicPdfAiStatus(result.audit).reason, null);
});

test("cinque pagine dual producono sempre il piano 3+2, luce critica e gas critico", async (t) => {
  const imageFiles = await rasterFixture(t);
  const plan = buildRasterBatchPlan({
    imageFiles,
    legacyNormalized: baseline(),
    now: 1_000,
    deadlineAt: 56_000,
    env: FALLBACK_ENV,
  });
  assert.deepEqual(
    plan.calls.map(({ id, phase, profile, model, pages }) => ({
      id,
      phase,
      profile,
      model,
      pages,
    })),
    [
      {
        id: "general-1",
        phase: "general",
        profile: "general",
        model: "gpt-4.1-mini-2025-04-14",
        pages: [1, 2, 3],
      },
      {
        id: "general-2",
        phase: "general",
        profile: "general",
        model: "gpt-4.1-mini-2025-04-14",
        pages: [4, 5],
      },
      {
        id: "critical-luce",
        phase: "critical",
        profile: "critical_luce",
        model: "gpt-4.1-2025-04-14",
        pages: [1, 2, 3, 4, 5],
      },
      {
        id: "critical-gas",
        phase: "critical",
        profile: "critical_gas",
        model: "gpt-4.1-2025-04-14",
        pages: [1, 2, 3, 4, 5],
      },
    ],
  );
});

test("un fallimento totale dell'IA conserva integralmente il risultato Step 7", async (t) => {
  const imageFiles = await rasterFixture(t);
  const original = baseline({ fornitore: "Parser Energia" });
  let calls = 0;
  const result = await runPdfAiPipeline({
    imageFiles,
    filename: "bolletta-scansionata.pdf",
    normalized: original,
    env: FALLBACK_ENV,
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      throw new Error("provider_down");
    },
  });
  assert.equal(calls, 4);
  assert.deepEqual(result.normalized, original);
  assert.equal(result.audit.ai.status, "failed");
  assert.equal(result.audit.public_output, "step7_preserved_after_ai_failure");
});

test("lo shadow arbitra i candidati per l'archivio ma non muta l'output pubblico Step 7", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ol-step8-shadow-"));
  const filePath = path.join(directory, "shadow.pdf");
  await fs.writeFile(filePath, Buffer.from("%PDF-1.4\nshadow"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const original = baseline({
    page_count: 1,
    commodity: "luce",
    fornitore: "Parser Energia",
  });

  const result = await runPdfAiPipeline({
    filePath,
    filename: "shadow.pdf",
    normalized: original,
    archiveReady: true,
    env: SHADOW_ENV,
    apiKey: "test-key",
    transport: async () => transportResponse(validAiOutput({
      commodity: "electricity",
      pageCount: 1,
      candidates: [aiCandidate({
        field: "consumo_luce_kwh",
        value: 2_700,
        unit: "kWh/anno",
        commodity: "electricity",
        label: "Consumo annuo",
        evidence: "Consumo annuo energia elettrica 2.700 kWh",
        semanticRole: "actual_customer_value",
      })],
    })),
  });

  assert.deepEqual(result.normalized, original);
  assert.equal(result.audit.mode, "shadow");
  assert.equal(result.audit.public_output, "step7_unchanged");
  assert.equal(result.audit.ai.status, "completed");
  assert.ok(result.audit.promoted.some((item) => item.field === "consumo_luce_kwh"));
  assert.ok(Array.isArray(result.audit.arbitration?.decisions));
});

test("un batch fallito non impedisce il recupero sicuro dagli altri batch", async (t) => {
  const imageFiles = await rasterFixture(t);
  const calls = [];
  const result = await runPdfAiPipeline({
    imageFiles,
    filename: "bolletta-scansionata.pdf",
    normalized: baseline(),
    env: FALLBACK_ENV,
    apiKey: "test-key",
    transport: async ({ request }) => {
      const profile = requestProfile(request);
      const pages = requestPages(request);
      calls.push({ profile, pages });
      if (profile === "general" && pages.includes(4)) throw new Error("batch_2_down");
      const candidates = profile === "critical_luce"
        ? [aiCandidate({
          field: "consumo_luce_kwh",
          value: 2_700,
          unit: "kWh/anno",
          commodity: "electricity",
          label: "Consumo annuo",
          evidence: "Consumo annuo energia elettrica 2.700 kWh",
          semanticRole: "actual_customer_value",
        })]
        : [];
      return transportResponse(validAiOutput({ candidates }), `resp_${profile}`);
    },
  });
  assert.equal(calls.length, 4);
  assert.equal(result.audit.ai.status, "completed");
  assert.equal(result.audit.ai.partial, true);
  assert.equal(result.normalized.consumo_luce_kwh, 2_700);
  assert.equal(result.normalized.field_status.consumo_luce_kwh.status, "da_verificare");
});

test("POD, PDR, codice fiscale e codice cliente in conflitto non vengono promossi", async (t) => {
  const imageFiles = await rasterFixture(t);
  const generalCandidates = [
    aiCandidate({ field: "pod", value: "IT001E12345678", commodity: "electricity", label: "POD", evidence: "Codice POD IT001E12345678" }),
    aiCandidate({ field: "pdr", value: "12345678901234", commodity: "gas", label: "PDR", evidence: "Codice PDR 12345678901234" }),
    aiCandidate({ field: "codice_fiscale", value: "RSSMRA80A01H501U", label: "Codice fiscale", evidence: "Codice fiscale RSSMRA80A01H501U" }),
    aiCandidate({ field: "codice_cliente", value: "CLIENTE123", label: "Codice cliente", evidence: "Codice cliente CLIENTE123" }),
  ];
  const luceCandidates = [
    aiCandidate({ field: "pod", value: "IT001E87654321", commodity: "electricity", label: "POD", evidence: "Codice POD IT001E87654321" }),
    aiCandidate({ field: "codice_fiscale", value: "BNCLGU80A01H501X", label: "Codice fiscale", evidence: "Codice fiscale BNCLGU80A01H501X" }),
    aiCandidate({ field: "codice_cliente", value: "CLIENTE987", label: "Codice cliente", evidence: "Codice cliente CLIENTE987" }),
  ];
  const gasCandidates = [
    aiCandidate({ field: "pdr", value: "98765432109876", commodity: "gas", label: "PDR", evidence: "Codice PDR 98765432109876" }),
    aiCandidate({ field: "codice_fiscale", value: "BNCLGU80A01H501X", label: "Codice fiscale", evidence: "Codice fiscale BNCLGU80A01H501X" }),
    aiCandidate({ field: "codice_cliente", value: "CLIENTE987", label: "Codice cliente", evidence: "Codice cliente CLIENTE987" }),
  ];
  const result = await runPdfAiPipeline({
    imageFiles,
    filename: "identificativi-in-conflitto.pdf",
    normalized: baseline(),
    env: FALLBACK_ENV,
    apiKey: "test-key",
    transport: async ({ request }) => {
      const profile = requestProfile(request);
      const candidates = profile === "general"
        ? generalCandidates
        : profile === "critical_luce"
          ? luceCandidates
          : gasCandidates;
      return transportResponse(validAiOutput({ candidates }), `resp_${profile}`);
    },
  });
  for (const field of ["pod", "pdr", "codice_fiscale", "codice_cliente"]) {
    assert.equal(result.normalized[field] ?? null, null);
    assert.ok(result.audit.conflicts.some((item) => item.field === field));
  }
});

test("i filtri economici escludono media bolletta, rete e quota mensile senza annualizzarla", () => {
  const candidates = [
    internalCandidate({
      field: "prezzo_luce_eur_kwh",
      value: 0.55,
      unit: "EUR/kWh",
      commodity: "luce",
      label: "Costo medio unitario",
      evidence: "Costo medio unitario della bolletta 0,55 EUR/kWh",
      semanticRole: "actual_customer_value",
    }),
    internalCandidate({
      field: "prezzo_luce_eur_kwh",
      value: 0.12,
      unit: "EUR/kWh",
      commodity: "luce",
      label: "Prezzo energia rete",
      evidence: "Prezzo energia rete e trasporto 0,12 EUR/kWh",
      semanticRole: "actual_customer_value",
    }),
    internalCandidate({
      field: "quota_fissa_vendita_luce_eur_anno",
      value: 12,
      unit: "EUR/mese",
      commodity: "luce",
      label: "Quota fissa mensile",
      evidence: "Quota fissa di vendita 12 EUR/mese",
      semanticRole: "sales_component",
    }),
  ];
  const result = filterSafePdfAiCandidates({ candidates, conflicts: [] });
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(
    result.rejected.map((item) => item.reason),
    [
      "average_or_bill_cost_not_contract_price",
      "regulated_or_non_sales_component",
      "monthly_fixed_fee_not_annualized",
    ],
  );
  assert.equal(result.rejected.some((item) => item.value === 144), false);
});

test("Costo per consumi con unità coerente è ammesso come prezzo contrattuale", () => {
  const candidate = internalCandidate({
    field: "prezzo_gas_eur_smc",
    value: 0.62,
    unit: "EUR/Smc",
    commodity: "gas",
    label: "Costo per consumi",
    evidence: "Costo per consumi gas naturale 0,620000 EUR/Smc",
    semanticRole: "actual_customer_value",
  });
  const result = filterSafePdfAiCandidates({ candidates: [candidate], conflicts: [] });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.accepted.length, 1);
});

test("un budget già scaduto non avvia chiamate e conserva Step 7", async (t) => {
  const imageFiles = await rasterFixture(t);
  const original = baseline({ fornitore: "Parser Energia" });
  let calls = 0;
  const result = await runPdfAiPipeline({
    imageFiles,
    filename: "timeout.pdf",
    normalized: original,
    deadlineAt: Date.now() - 1,
    env: FALLBACK_ENV,
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      return transportResponse(validAiOutput());
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.normalized, original);
  assert.equal(result.audit.ai.reason, "insufficient_reserved_budget");
});

test("le pagine JPEG viste dall'IA diventano un PDF privato archiviabile", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ol-step8-raster-archive-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  const imageFiles = [];
  for (let page = 1; page <= 2; page += 1) {
    const filePath = path.join(directory, `page-${page}.jpg`);
    await fs.writeFile(filePath, jpeg);
    imageFiles.push({ filePath, mimeType: "image/jpeg", page });
  }

  const archived = await buildRasterArchivePdf(imageFiles);
  t.after(() => fs.unlink(archived.filePath).catch(() => {}));
  const pdf = await fs.readFile(archived.filePath);
  const source = pdf.toString("latin1");
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(source, /\/Type \/Pages \/Count 2/);
  assert.equal((source.match(/\/Subtype \/Image/g) || []).length, 2);
  assert.match(source, /xref/);
  assert.equal(archived.pageCount, 2);
  assert.equal(archived.source, "client_raster_reconstruction");
});

test("frontend e API usano un solo percorso raster Step 8 senza nuove funzioni", async () => {
  const [html, apiSource, staffArchiveApi, apiEntries, pdfModule, pdfWorker] = await Promise.all([
    fs.readFile(path.join(ROOT, "public/index.html"), "utf8"),
    fs.readFile(path.join(ROOT, "api/analyze-pdf.js"), "utf8"),
    fs.readFile(path.join(ROOT, "api/staff-pdf-analyses.js"), "utf8"),
    fs.readdir(path.join(ROOT, "api"), { withFileTypes: true }),
    fs.stat(path.join(ROOT, "public/vendor/pdfjs/pdf.mjs")),
    fs.stat(path.join(ROOT, "public/vendor/pdfjs/pdf.worker.mjs")),
  ]);
  assert.match(html, /preparaPaginePdfGrande/);
  assert.match(html, /\/vendor\/pdfjs\/pdf\.mjs/);
  assert.match(html, /formData\.append\(\s*"pages"/);
  assert.match(apiSource, /runPdfAiPipeline/);
  assert.match(apiSource, /buildRasterArchivePdf/);
  assert.match(apiSource, /shadow:\s*pipeline\.audit/);
  assert.match(apiSource, /reader:\s*publicPdfAiStatus\(pipeline\.audit\)/);
  assert.match(html, /reader:\s*payload\.reader/);
  assert.doesNotMatch(apiSource, /ai:\s*pipeline\.audit/);
  assert.doesNotMatch(apiSource, /runPdfReaderShadow/);
  assert.match(staffArchiveApi, /action === "cleanup"/);
  assert.match(staffArchiveApi, /cleanupExpiredPdfAnalyses/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY/);
  assert.equal(
    apiEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".js")).length,
    12,
  );
  assert.ok(pdfModule.size > 100_000);
  assert.ok(pdfWorker.size > 500_000);
});
