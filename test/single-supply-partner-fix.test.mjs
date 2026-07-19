import test from "node:test";
import assert from "node:assert/strict";
import {
  PATCH_MARKER_V2,
  OLD_PARTNER_BLOCK,
  V1_PARTNER_BLOCK,
  OLD_ARERA_LOOKUP,
  NEW_ARERA_LOOKUP,
  patchSource,
} from "../scripts/apply-single-supply-partner-fix.mjs";

const fixture = (partnerBlock = OLD_PARTNER_BLOCK, lookup = OLD_ARERA_LOOKUP) =>
  `inizio\n${lookup}\nintermedio\n${partnerBlock}\nfine`;

test("installa direttamente la v2 su una versione non ancora modificata", () => {
  const result = patchSource(fixture());
  assert.equal(result.changed, true);
  assert.match(result.source, new RegExp(PATCH_MARKER_V2));
  assert.match(result.source, /partnerOriginalId: offerta\.id/);
  assert.ok(result.source.includes(NEW_ARERA_LOOKUP));
  assert.equal(result.source.includes(OLD_PARTNER_BLOCK), false);
});

test("aggiorna correttamente il fix v1 alla v2", () => {
  const result = patchSource(fixture(V1_PARTNER_BLOCK));
  assert.equal(result.changed, true);
  assert.match(result.source, new RegExp(PATCH_MARKER_V2));
  assert.match(result.source, /partnerOriginalId: offerta\.id/);
  assert.ok(result.source.includes(NEW_ARERA_LOOKUP));
});

test("e idempotente dopo l'installazione", () => {
  const first = patchSource(fixture());
  const second = patchSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "already_patched");
  assert.equal(second.source, first.source);
});

test("mantiene la separazione della commodity selezionata", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /luce: commodity === "luce" \? offerta\.luce : null/);
  assert.match(result.source, /gas: commodity === "gas" \? offerta\.gas : null/);
});

test("si ferma su una versione non riconosciuta", () => {
  assert.throws(
    () => patchSource("function diversa() {}"),
    /Patch non applicata/
  );
});
