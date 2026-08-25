import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "public", "index.html"), "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("business: Agricoltura / Allevamento e una categoria esplicita senza cambiare la raccolta dati", () => {
  const businessSelect = between(html, '<select id="business-attivita">', '</select>');
  assert.match(businessSelect, /<option value="agricoltura">Agricoltura \/ Allevamento<\/option>/);
  assert.equal((businessSelect.match(/value="agricoltura"/g) || []).length, 1);
  assert.ok(
    businessSelect.indexOf('value="agricoltura"') < businessSelect.indexOf('value="negozio"'),
    "Agricoltura deve essere la prima categoria business esplicita",
  );
  assert.match(html, /attivita: leggiValore\("business-attivita"\)/);
});

test("staff: Home e la prima voce delle anteprime e torna alla landing pubblica", () => {
  const panel = between(html, 'panel.innerHTML = `', '`;\n  document.body.appendChild(panel);');
  assert.match(panel, /id="staff-preview-home">Home<\/button>/);
  assert.ok(
    panel.indexOf('id="staff-preview-home"') < panel.indexOf('id="staff-preview-otp"'),
    "Home deve precedere le altre anteprime",
  );
  assert.match(html, /document\.getElementById\("staff-preview-home"\)\?\.addEventListener\("click", apriHomeStaff\)/);
  const homeFn = between(html, "function apriHomeStaff()", "function apriArchivioPdfStaff()");
  assert.match(homeFn, /chiudiPannelloAnteprimeStaff\(\)/);
  assert.match(homeFn, /window\.location\.assign\("\/"\)/);
  assert.doesNotMatch(homeFn, /sessionStorage\.removeItem/);
  assert.doesNotMatch(homeFn, /LEAD_STATE\.staffMode\s*=\s*false/);
});

test("staff: banner e pannello restano utilizzabili sopra la Home senza interferire con Iubenda", () => {
  assert.match(html, /html\.social-entry-requested body > \.staff-mode-banner \{ display: flex !important; z-index: 9101; \}/);
  assert.match(html, /html\.social-entry-requested body > \.staff-preview-panel \{ display: block !important; z-index: 9100; \}/);
  assert.match(html, /html\.social-entry-requested body > \.staff-preview-panel\[hidden\] \{ display: none !important; \}/);
  assert.ok(9101 < 10000, "la UI staff deve restare sotto al modal Iubenda");
});
