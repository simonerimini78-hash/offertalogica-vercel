import test from "node:test";
import assert from "node:assert/strict";

import {
  focusedRecoveryBudget,
  inferCommodityFromEvidence,
  isAverageBillPriceLabel,
  mergeFocusedVisualResults,
  withFocusedRecoveryStatus,
} from "../lib/pdfAiStability.js";

test("prezzo medio e costo medio restano informativi, non contrattuali", () => {
  assert.equal(isAverageBillPriceLabel("Prezzo medio 0,22 €/kWh"), true);
  assert.equal(isAverageBillPriceLabel("Costo medio unitario della bolletta"), true);
  assert.equal(isAverageBillPriceLabel("Average price for the billing period"), true);
  assert.equal(isAverageBillPriceLabel("Corrispettivo energia PUN + 0,015 €/kWh"), false);
});

test("documento dual resta dual con evidenze luce e gas anche senza POD confermato", () => {
  const result = inferCommodityFromEvidence({
    merged: { commodity: "dual", pdr: "03081001496205", potenza_impegnata_kw: 3 },
    selected: [
      { field: "pdr", value: "03081001496205" },
      { field: "potenza_impegnata_kw", value: 3 },
    ],
    ai: {
      page_map: [
        { page: 2, role: "gas_information", summary: "Dati della fornitura gas" },
        { page: 4, role: "electricity_information", summary: "Dati energia elettrica" },
      ],
      candidates: [],
    },
  });
  assert.equal(result, "dual");
});

test("una bolletta solo gas non diventa dual per una classificazione generica", () => {
  const result = inferCommodityFromEvidence({
    merged: { commodity: "gas", pdr: "03081001496205", consumo_gas_smc: 500 },
    selected: [{ field: "pdr", value: "03081001496205" }],
    ai: { page_map: [{ page: 1, role: "gas_bill", summary: "Bolletta gas naturale" }], candidates: [] },
  });
  assert.equal(result, "gas");
});

test("fusione focused conserva il primario, evita duplicati e aggiunge solo candidati nuovi", () => {
  const primary = {
    status: "completed",
    attempts: 1,
    candidates: [{ field: "pdr", value_text: "12345678901234", page: 2, semantic_role: "identifier" }],
  };
  const recovery = {
    status: "completed",
    candidates: [
      { field: "pdr", value_text: "12345678901234", page: 2, semantic_role: "identifier" },
      { field: "consumo_gas_smc", value_number: 500, unit: "Smc", page: 2, semantic_role: "actual_customer_value" },
    ],
  };
  const merged = mergeFocusedVisualResults(primary, recovery, ["consumo_gas_smc"]);
  assert.equal(merged.candidates.length, 2);
  assert.equal(merged.candidates[0], primary.candidates[0]);
  assert.deepEqual(merged.candidates[1].warnings, ["focused_visual_recovery"]);
  assert.equal(merged.focused_recovery.primary_preserved, true);
});

test("focused non parte senza un budget temporale noto", () => {
  assert.deepEqual(
    focusedRecoveryBudget({ deadlineAt: 0, now: 1_000, allowWithoutDeadline: false }),
    { attempt: false, status: "no_deadline_budget", timeout_ms: null, remaining_ms: null, reserve_ms: 3000 },
  );
});

test("focused usa un timeout ridotto e mantiene una riserva per la risposta", () => {
  const budget = focusedRecoveryBudget({ deadlineAt: 20_000, now: 10_000, configuredMs: 6_500, reserveMs: 3_000 });
  assert.equal(budget.attempt, true);
  assert.equal(budget.timeout_ms, 6_500);
  assert.equal(budget.remaining_ms, 7_000);
});

test("stato di errore focused non elimina il risultato primario", () => {
  const primary = { status: "completed", candidates: [{ field: "fornitore", value_text: "X" }], attempts: 1 };
  const result = withFocusedRecoveryStatus(primary, { attempted: true, status: "failed_non_blocking" }, true);
  assert.deepEqual(result.candidates, primary.candidates);
  assert.equal(result.status, "completed");
  assert.equal(result.attempts, 2);
  assert.equal(result.focused_recovery.primary_preserved, true);
});
