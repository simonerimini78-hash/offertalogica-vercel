import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPdfAiPipeline } from "../lib/pdfAiPipeline.js";

const DEFAULT_RUNS = 3;
const DEFAULT_OUTPUT = "/private/tmp/offertalogica-step8-real-benchmark.json";
const SAFE_RESULT_FIELDS = [
  "parser_version",
  "kind",
  "commodity",
  "customer_type",
  "fornitore",
  "consumo_luce_kwh",
  "consumo_gas_smc",
  "potenza_impegnata_kw",
  "potenza_disponibile_kw",
  "prezzo_luce_eur_kwh",
  "prezzo_gas_eur_smc",
  "quota_fissa_vendita_luce_eur_anno",
  "quota_fissa_vendita_gas_eur_anno",
  "nome_offerta_luce",
  "nome_offerta_gas",
  "codice_offerta_luce",
  "codice_offerta_gas",
  "tipo_prezzo_luce",
  "tipo_prezzo_gas",
  "indice_riferimento_luce",
  "indice_riferimento_gas",
  "spread_luce_eur_kwh",
  "spread_gas_eur_smc",
  "needsReview",
];
const PRIVATE_IDENTIFIER_FIELDS = [
  "pod",
  "pdr",
  "codice_fiscale",
  "codice_cliente",
  "intestatario",
  "indirizzo_fornitura",
  "indirizzo_fornitura_luce",
  "indirizzo_fornitura_gas",
];

function argumentsMap(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    result[item.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--")
      ? argv[++index]
      : "true";
  }
  return result;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command}_failed_${code}:${stderr.slice(0, 500)}`));
    });
  });
}

async function rasterizePdf(pdfPath, outputDirectory) {
  const prefix = path.join(outputDirectory, "page");
  await runCommand("pdftoppm", [
    "-jpeg",
    "-scale-to",
    "1800",
    "-jpegopt",
    "quality=78",
    pdfPath,
    prefix,
  ]);
  const names = (await fs.readdir(outputDirectory))
    .filter((name) => /^page-\d+\.jpg$/i.test(name))
    .sort((left, right) => {
      const leftPage = Number(left.match(/\d+/)?.[0] || 0);
      const rightPage = Number(right.match(/\d+/)?.[0] || 0);
      return leftPage - rightPage;
    });
  if (!names.length) throw new Error("raster_pages_missing");
  return names.map((name, index) => ({
    filePath: path.join(outputDirectory, name),
    mimeType: "image/jpeg",
    page: index + 1,
  }));
}

function unknownBaseline(pageCount) {
  return {
    parser_version: "step8-real-benchmark",
    page_count: pageCount,
    diagnostics: [],
    warnings: ["benchmark_raster_reale"],
    kind: "unknown",
    commodity: "unknown",
    recognized: false,
    confidence: "low",
    needsReview: true,
    textExtracted: 0,
  };
}

function safeNormalized(normalized = {}) {
  return Object.fromEntries(
    SAFE_RESULT_FIELDS
      .filter((field) => normalized[field] !== undefined && normalized[field] !== null)
      .map((field) => [field, normalized[field]]),
  );
}

function privateFieldPresence(normalized = {}) {
  return Object.fromEntries(
    PRIVATE_IDENTIFIER_FIELDS.map((field) => [
      field,
      normalized[field] !== undefined
        && normalized[field] !== null
        && String(normalized[field]).trim() !== "",
    ]),
  );
}

function safeRunReport(result, elapsedMs) {
  return {
    elapsed_ms: elapsedMs,
    normalized: safeNormalized(result.normalized),
    private_field_presence: privateFieldPresence(result.normalized),
    ai: {
      status: result.audit?.ai?.status || "unknown",
      reason: result.audit?.ai?.reason || null,
      partial: Boolean(result.audit?.ai?.partial),
      candidate_count: Number(result.audit?.ai?.candidate_count || 0),
      batches: (result.audit?.ai?.batches || []).map((batch) => ({
        id: batch.id,
        phase: batch.phase,
        profile: batch.profile,
        model: batch.model,
        pages: batch.pages,
        status: batch.status,
        reason: batch.reason,
        elapsed_ms: batch.elapsed_ms,
        candidate_count: batch.candidate_count,
      })),
    },
    promoted_fields: [...new Set((result.audit?.promoted || []).map((item) => item.field))].sort(),
    rejected: (result.audit?.rejected || []).map((item) => ({
      field: item.field,
      reason: item.reason,
      page: item.page,
    })),
    conflicts: (result.audit?.conflicts || []).map((item) => ({
      field: item.field,
      reason: item.reason,
    })),
  };
}

function stabilityReport(runs) {
  const values = {};
  for (const field of SAFE_RESULT_FIELDS) {
    const distinct = [...new Set(
      runs
        .map((run) => run.normalized[field])
        .filter((value) => value !== undefined && value !== null)
        .map((value) => JSON.stringify(value)),
    )];
    if (distinct.length) values[field] = { stable: distinct.length === 1, distinct_values: distinct };
  }
  return {
    all_completed: runs.every((run) => run.ai.status === "completed"),
    any_partial: runs.some((run) => run.ai.partial),
    fields: values,
  };
}

async function benchmarkDocument({ label, pdfPath, runs, apiKey }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `offertalogica-step8-${label}-`));
  try {
    const imageFiles = await rasterizePdf(pdfPath, directory);
    const env = {
      PDF_AI_MODE: "fallback",
      PDF_ANALYSIS_DEADLINE_MS: "55000",
      PDF_AI_RESPONSE_MARGIN_MS: "4000",
      PDF_AI_GENERAL_PHASE_MS: "24000",
      PDF_AI_CRITICAL_PHASE_MS: "22000",
    };
    const results = [];
    for (let run = 1; run <= runs; run += 1) {
      const startedAt = Date.now();
      const result = await runPdfAiPipeline({
        imageFiles,
        filename: `${label}.pdf`,
        normalized: unknownBaseline(imageFiles.length),
        deadlineAt: Date.now() + 55_000,
        archiveReady: false,
        env,
        apiKey,
      });
      results.push({ run, ...safeRunReport(result, Date.now() - startedAt) });
      process.stdout.write(
        `[Step8] ${label} prova ${run}/${runs}: ${result.audit?.ai?.status || "unknown"}\n`,
      );
    }
    return {
      label,
      page_count: imageFiles.length,
      runs: results,
      stability: stabilityReport(results),
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY_missing");
  const irinaPath = path.resolve(args.irina || "/Users/simo78/Downloads/bolletta.Irina.pdf");
  const sorgeniaPath = path.resolve(args.sorgenia || "/Users/simo78/Downloads/sorgenia 2.pdf");
  const runs = Math.max(1, Math.min(5, Number.parseInt(args.runs || DEFAULT_RUNS, 10) || DEFAULT_RUNS));
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);

  await Promise.all([fs.access(irinaPath), fs.access(sorgeniaPath)]);
  const report = {
    generated_at: new Date().toISOString(),
    pipeline: "step8-clean-single-pipeline-v1",
    runs_per_document: runs,
    documents: [],
  };
  report.documents.push(await benchmarkDocument({
    label: "irina",
    pdfPath: irinaPath,
    runs,
    apiKey,
  }));
  report.documents.push(await benchmarkDocument({
    label: "sorgenia",
    pdfPath: sorgeniaPath,
    runs,
    apiKey,
  }));
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`[Step8] Report non anagrafico: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`[Step8] Benchmark fallito: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
