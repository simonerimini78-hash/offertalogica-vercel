import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/staff-pdf.html", import.meta.url), "utf8");

test("staff mostra versione, provenienza, evidenza e policy di autocompilazione", () => {
  assert.match(html, /Contratto dati Step 5/);
  assert.match(html, /Versione contratto/);
  assert.match(html, /Provenienza/);
  assert.match(html, /Evidenza/);
  assert.match(html, /Autocompilazione/);
  assert.match(html, /safe_target_count/);
  assert.match(html, /blocked_field_count/);
});
