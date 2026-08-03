import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staff = await readFile(new URL("../public/staff-premium.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/staff-premium.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("v0.29.1 elimina il testo null generato dagli argomenti di form.append", () => {
  assert.doesNotMatch(staff, /!canValidate\s*\?[^\n]+:\s*null,\s*\n\s*node\("div", \{ className: "form-actions"/);
  assert.match(staff, /if \(!canValidate\) \{\s*form\.append/);
});

test("v0.29.1 conserva e ripristina una bozza locale per ogni analisi e operatore", () => {
  assert.match(staff, /VALIDATION_DRAFT_PREFIX/);
  assert.match(staff, /localStorage\.setItem\(validationDraftKey\(latest\.id\)/);
  assert.match(staff, /loadValidationDraft\(latest\.id, latest\.validated_at\)/);
  assert.match(staff, /draftField\?\.decision \|\| existing\?\.decision/);
  assert.match(staff, /clearValidationDraft\(latest\.id\)/);
});

test("v0.29.1 mostra un timer leggibile e mantiene il tempo della bozza", () => {
  assert.match(staff, /Tempo di validazione in corso/);
  assert.match(staff, /formatDurationSeconds\(latest\.validation_seconds\)/);
  assert.match(staff, /startValidationTimer\(latest\.id, Number\(draft\.started_at\), timer\)/);
});

test("v0.29.1 aggiorna indicatori e cache", () => {
  assert.match(app, /APP Premium v0\.30/);
  assert.match(html, /Area riservata allo staff autorizzato · v0\.30/);
  assert.match(sw, /offertalogica-premium-v30/);
});
