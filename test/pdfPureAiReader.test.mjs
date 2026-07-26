import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import {
  PDF_PURE_AI_QUESTION_IDS,
  buildPdfPureAiRequest,
  extractPdfPureAi,
  grayBitmapToPng,
  normalizePureAiOutput,
} from "../lib/pdfPureAiReader.js";

function pngChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

function emptyAnswers() {
  return PDF_PURE_AI_QUESTION_IDS.map((question_id) => ({
    question_id,
    found: false,
    value_text: null,
    value_number: null,
    unit: null,
    period: "none",
    page: null,
    label: null,
    evidence: null,
    confidence: 0,
  }));
}

function setAnswer(answers, questionId, patch) {
  const answer = answers.find((item) => item.question_id === questionId);
  Object.assign(answer, {
    found: true,
    value_text: null,
    value_number: null,
    unit: null,
    period: "none",
    page: 1,
    label: questionId,
    evidence: "evidenza",
    confidence: 92,
    ...patch,
  });
}

test("grayBitmapToPng crea un PNG grayscale valido", () => {
  const png = grayBitmapToPng(Uint8Array.from([0, 64, 128, 255]), 2, 2);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = pngChunks(png);
  assert.equal(chunks[0].type, "IHDR");
  assert.equal(chunks[0].data.readUInt32BE(0), 2);
  assert.equal(chunks[0].data.readUInt32BE(4), 2);
  const raw = inflateSync(Buffer.concat(chunks.filter((item) => item.type === "IDAT").map((item) => item.data)));
  assert.deepEqual([...raw], [0, 0, 64, 0, 128, 255]);
});

test("buildPdfPureAiRequest invia pagine PNG come immagini high detail", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  const image = grayBitmapToPng(Uint8Array.from([255]), 1, 1);
  const { request, raster } = await buildPdfPureAiRequest({
    filePath,
    renderPages: async () => ({ mode: "raster", images: [{ page: 1, mimeType: "image/png", bytes: image }], pageCount: 1, scale: 2.2 }),
  });
  assert.equal(raster.mode, "raster");
  const userContent = request.input[1].content;
  const imageInput = userContent.find((item) => item.type === "input_image");
  assert.ok(imageInput.image_url.startsWith("data:image/png;base64,"));
  assert.equal(imageInput.detail, "high");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(userContent.some((item) => item.type === "input_file"), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("normalizePureAiOutput produce il contratto esistente e annualizza solo la quota mensile", () => {
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Hera Comm", evidence: "Fornitore Hera Comm" });
  setAnswer(answers, "customer_type", { value_text: "Domestico residente", evidence: "Tipologia cliente Domestico residente" });
  setAnswer(answers, "intestatario", { value_text: "Mario Rossi", evidence: "Intestatario Mario Rossi" });
  setAnswer(answers, "codice_fiscale", { value_text: "RSSMRA80A01H501U", evidence: "Codice fiscale RSSMRA80A01H501U" });
  setAnswer(answers, "pod", { value_text: "IT001E12345678", evidence: "POD IT001E12345678" });
  setAnswer(answers, "potenza_impegnata_kw", { value_text: "3 kW", value_number: 3, unit: "kW", evidence: "Potenza impegnata 3 kW" });
  setAnswer(answers, "consumo_luce_kwh", { value_text: "2.740 kWh", value_number: 2740, unit: "kWh", evidence: "Consumo annuo 2.740 kWh" });
  setAnswer(answers, "prezzo_luce_eur_kwh", { value_text: "0,123456 €/kWh", value_number: 0.123456, unit: "€/kWh", evidence: "di cui vendita energia elettrica 0,123456 €/kWh" });
  setAnswer(answers, "quota_fissa_vendita_luce", { value_text: "7,10 €/mese", value_number: 7.1, unit: "€/mese", period: "month", evidence: "di cui vendita energia elettrica 7,10 €/mese" });
  setAnswer(answers, "tipo_prezzo_luce", { value_text: "Variabile", evidence: "Tipo prezzo Variabile" });
  setAnswer(answers, "indice_riferimento_luce", { value_text: "PUN", evidence: "Indice PUN" });
  setAnswer(answers, "spread_luce_eur_kwh", { value_text: "0,025 €/kWh", value_number: 0.025, unit: "€/kWh", evidence: "Spread 0,025 €/kWh" });

  const normalized = normalizePureAiOutput({
    document: { kind: "bill", commodity: "electricity", customer_type: "consumer", page_count: 4 },
    answers,
  }, { model: "test-model", responseId: "resp_test", transportMode: "server_rasterized_png_pages", raster: { pageCount: 4, scale: 2.2 } });

  assert.equal(normalized.kind, "bolletta");
  assert.equal(normalized.commodity, "luce");
  assert.equal(normalized.customer_type, "privato");
  assert.equal(normalized.consumo_luce_kwh, 2740);
  assert.equal(normalized.quota_fissa_vendita_luce_eur_anno, 85.2);
  assert.equal(normalized.ai.applied, true);
  assert.ok(normalized.ai.filled_fields.includes("consumo_luce_kwh"));
  const fixed = normalized.data_contract.fields.quota_fissa_vendita_luce_eur_anno;
  assert.equal(fixed.provenance.source, "ai");
  assert.equal(fixed.provenance.origin, "pdf_visual_ai");
  assert.equal(fixed.derivation.original_value, 7.1);
  assert.equal(fixed.derivation.factor, 12);
  assert.equal(fixed.autofill.allowed, true);
  assert.equal(fixed.autofill.reason, "ia_visuale_completa_con_conferma_utente");
  assert.equal(normalized.data_contract.autofill_plan.requires_user_confirmation, true);
});

test("extractPdfPureAi usa il fallback PDF diretto se la rasterizzazione non è disponibile", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pure-ai-"));
  const filePath = path.join(dir, "bolletta.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  const answers = emptyAnswers();
  setAnswer(answers, "fornitore", { value_text: "Estra Energie", evidence: "Fornitore Estra Energie" });
  setAnswer(answers, "pdr", { value_text: "12345678901234", evidence: "PDR 12345678901234" });
  setAnswer(answers, "consumo_gas_smc", { value_text: "680 Smc", value_number: 680, unit: "Smc", evidence: "Consumo annuo 680 Smc" });
  setAnswer(answers, "prezzo_gas_eur_smc", { value_text: "0,45 €/Smc", value_number: 0.45, unit: "€/Smc", evidence: "Vendita gas 0,45 €/Smc" });
  setAnswer(answers, "quota_fissa_vendita_gas", { value_text: "120 €/anno", value_number: 120, unit: "€/anno", period: "year", evidence: "Quota fissa vendita 120 €/anno" });
  const output = JSON.stringify({ document: { kind: "bill", commodity: "gas", customer_type: "consumer", page_count: 3 }, answers });
  let capturedRequest;
  const normalized = await extractPdfPureAi({
    filePath,
    apiKey: "test-key",
    deadlineAt: Date.now() + 30_000,
    renderPages: async () => { throw new Error("raster_test_failure"); },
    transport: async ({ request }) => {
      capturedRequest = request;
      return { id: "resp_test", output_text: output };
    },
  });
  assert.equal(capturedRequest.input[1].content.some((item) => item.type === "input_file"), true);
  assert.equal(normalized.ai.transport_mode, "pdf_originale");
  assert.equal(normalized.consumo_gas_smc, 680);
  assert.equal(normalized.data_contract.fields.consumo_gas_smc.autofill.allowed, true);
  await fs.rm(dir, { recursive: true, force: true });
});
