import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/staff-pdf.html", import.meta.url), "utf8");

test("l'area staff espone completezza, readiness e problemi di validazione Step 4", () => {
  for (const marker of [
    "Validazione e completezza Step 4",
    "normalized.completeness?.score",
    "readinessValue",
    "validation_issues",
    "Nessuna incoerenza deterministica rilevata",
  ]) assert.ok(html.includes(marker), `manca ${marker}`);
});
