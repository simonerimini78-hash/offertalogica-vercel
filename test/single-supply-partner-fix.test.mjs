import test from "node:test";
import assert from "node:assert/strict";
import {
  PATCH_MARKER_V2,
  UI_MARKER,
  DEDUP_MARKER,
  CERTIFIED_MONO_MARKER,
  OLD_PARTNER_BLOCK,
  V1_PARTNER_BLOCK,
  OLD_ARERA_LOOKUP,
  NEW_ARERA_LOOKUP,
  OLD_CERTIFIED_MONO_LOOKUP,
  OLD_PRICE_GROUP,
  OLD_SUPPLY_TAIL,
  OLD_FILTER_KEY_FUNCTION,
  OLD_GROUP_KEY_FUNCTION,
  patchSource,
} from "../scripts/apply-single-supply-partner-fix.mjs";

const PDF_AUTO_SELECTION =
  'if (data.tipo_prezzo) setField("master-luce-tipo", data.tipo_prezzo);';

const MENU_CHANGE_LISTENER = `[
    "master-luce-consumo",
    "master-gas-consumo",
    "master-luce-potenza",
    "master-gas-regione",
    "master-luce-tipo",
    "master-tipo-fornitura",
  ].forEach((id) => {`;

function fixture(partnerBlock = OLD_PARTNER_BLOCK) {
  return [
    "<html>",
    OLD_PRICE_GROUP,
    OLD_SUPPLY_TAIL,
    "<script>",
    OLD_ARERA_LOOKUP,
    OLD_CERTIFIED_MONO_LOOKUP,
    partnerBlock,
    OLD_FILTER_KEY_FUNCTION,
    "function unisciOfferteCandidati() {}",
    "function costruisciOfferteRanking() {}",
    OLD_GROUP_KEY_FUNCTION,
    PDF_AUTO_SELECTION,
    MENU_CHANGE_LISTENER,
    "</script>",
    "</html>",
  ].join("\n");
}

test("applica tutte le migliorie incrementali al codice corrente", () => {
  const result = patchSource(fixture());
  assert.equal(result.changed, true);
  assert.match(result.source, new RegExp(PATCH_MARKER_V2));
  assert.match(result.source, new RegExp(UI_MARKER));
  assert.match(result.source, new RegExp(DEDUP_MARKER));
  assert.match(result.source, new RegExp(CERTIFIED_MONO_MARKER));
  assert.ok(result.source.includes(NEW_ARERA_LOOKUP));
});

test("sposta il menu in un riquadro comune senza duplicarlo", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /id="master-prezzo-confronto-panel"/);
  assert.match(result.source, /Tipo di prezzo da confrontare/);
  assert.match(result.source, /La bolletta imposta automaticamente la scelta iniziale/);
  assert.equal(result.source.split('id="master-luce-tipo"').length - 1, 1);
});

test("mantiene la preselezione automatica dal PDF", () => {
  const result = patchSource(fixture());
  assert.ok(result.source.includes(PDF_AUTO_SELECTION));
});

test("mantiene il ricalcolo quando cambia il menu", () => {
  const result = patchSource(fixture());
  assert.ok(result.source.includes(MENU_CHANGE_LISTENER));
});

test("usa prima l'abbinamento ARERA certificato per solo luce o solo gas", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /const certificata = rigaAreraPartnerCertificata\(offerta, commodity\)/);
  assert.match(result.source, /if \(certificata\) return certificata/);
});

test("deduplica partner e consulente usando il fornitore reale", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /function chiaveProviderOfferta/);
  assert.match(result.source, /return chiaveProviderOfferta\(item\?\.offerta\)/);
  assert.doesNotMatch(result.source, /return chiaveOffertaFiltro\(item\?\.offerta\)/);
});

test("non trasforma offerte fisse in variabili per riempire la lista", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /if \(offerta\.tipo !== tipoTariffa\) return false|offertaCompatibileConRanking/);
  assert.doesNotMatch(result.source, /tipo:\s*tipoTariffa/);
});

test("aggiorna anche il precedente fix v1", () => {
  const result = patchSource(fixture(V1_PARTNER_BLOCK));
  assert.equal(result.changed, true);
  assert.match(result.source, new RegExp(PATCH_MARKER_V2));
  assert.match(result.source, /partnerOriginalId: offerta\.id/);
});

test("e idempotente", () => {
  const first = patchSource(fixture());
  const second = patchSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "already_patched");
  assert.equal(second.source, first.source);
});

test("si ferma senza modificare versioni non riconosciute", () => {
  assert.throws(
    () => patchSource("<html><script>function diversa() {}</script></html>"),
    /Patch non applicata|Verifica fallita/
  );
});
