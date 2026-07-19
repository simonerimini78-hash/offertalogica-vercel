import test from "node:test";
import assert from "node:assert/strict";
import {
  PATCH_MARKER,
  OLD_BLOCK,
  patchSource,
} from "../scripts/apply-single-supply-partner-fix.mjs";

test("sostituisce esclusivamente il blocco delle offerte partner", () => {
  const fixture = `prima\n${OLD_BLOCK}\ndopo`;
  const result = patchSource(fixture);

  assert.equal(result.changed, true);
  assert.match(result.source, new RegExp(PATCH_MARKER));
  assert.equal(result.source.includes(OLD_BLOCK), false);
  assert.match(result.source, /proiettaPartnerSuFornituraSingola/);
  assert.match(result.source, /luce: commodity === "luce" \? offerta\.luce : null/);
  assert.match(result.source, /gas: commodity === "gas" \? offerta\.gas : null/);
  assert.match(result.source, /offertaPartnerConPrezziArera\(offerta, attuale\)/);
});

test("e idempotente quando la patch e gia presente", () => {
  const first = patchSource(OLD_BLOCK);
  const second = patchSource(first.source);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "already_patched");
  assert.equal(second.source, first.source);
});

test("si ferma senza modificare una versione non riconosciuta", () => {
  assert.throws(
    () => patchSource("function diversa() {}"),
    /Patch non applicata/
  );
});

test("si ferma se il blocco compare piu di una volta", () => {
  assert.throws(
    () => patchSource(`${OLD_BLOCK}\n${OLD_BLOCK}`),
    /trovati 2/
  );
});
