import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSafeAiVisualCandidates,
  safeVisualFieldThreshold,
} from "../lib/pdfAiVisualRecovery.js";

test("un POD formalmente valido ma letto una sola volta non supera la soglia", () => {
  const candidate = {
    field: "pod",
    normalized_value: "IT001E49734340",
    label: "POD",
    evidence: "POD IT001E49734340",
    confidence: 90,
    warnings: [],
  };
  assert.equal(safeVisualFieldThreshold(candidate), null);
});

test("PDR identico nei passaggi primario e focused ottiene consenso, sempre da confermare", () => {
  const ai = {
    candidates: [
      { field: "pdr", normalized_value: "03081001496205", label: "PDR", evidence: "PDR 03081001496205", confidence: 90, warnings: [] },
      { field: "pdr", normalized_value: "03081001496205", label: "Punto di riconsegna", evidence: "Punto di riconsegna 03081001496205", confidence: 90, warnings: ["focused_visual_recovery"] },
    ],
  };
  prepareSafeAiVisualCandidates(ai);
  assert.equal(ai.candidates.every((candidate) => candidate.confidence >= 94), true);
  assert.equal(ai.candidates.every((candidate) => candidate.warnings.includes("cross_pass_visual_consensus")), true);
  assert.equal(safeVisualFieldThreshold(ai.candidates[0]), 90);
});

test("due POD discordanti non vengono promossi", () => {
  const ai = {
    candidates: [
      { field: "pod", normalized_value: "IT001E49734340", label: "POD", evidence: "POD IT001E49734340", confidence: 90, warnings: [] },
      { field: "pod", normalized_value: "IT001E44733440", label: "POD", evidence: "POD IT001E44733440", confidence: 90, warnings: ["focused_visual_recovery"] },
    ],
  };
  prepareSafeAiVisualCandidates(ai);
  assert.equal(ai.candidates.some((candidate) => candidate.warnings.includes("cross_pass_visual_consensus")), false);
  assert.equal(ai.candidates.every((candidate) => safeVisualFieldThreshold(candidate) === null), true);
});

test("consumo annuo esplicito a confidenza 90 è revisionabile", () => {
  const candidate = {
    field: "consumo_gas_smc",
    value_number: 516.41,
    unit: "Smc",
    label: "Consumo annuo",
    evidence: "Consumo annuo 516,41 Smc",
    semantic_role: "actual_customer_value",
    confidence: 90,
  };
  assert.equal(safeVisualFieldThreshold(candidate), 90);
});

test("consumo fatturato del periodo resta bloccato", () => {
  const candidate = {
    field: "consumo_gas_smc",
    value_number: 177.685828,
    unit: "Smc",
    label: "Consumo totale fatturato",
    evidence: "Consumo totale fatturato del periodo 177,685828 Smc",
    semantic_role: "billing_period",
    confidence: 95,
  };
  assert.equal(safeVisualFieldThreshold(candidate), null);
});
