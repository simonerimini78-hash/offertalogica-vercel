import test from "node:test";
import assert from "node:assert/strict";
import {
  PATCH_MARKER_V2,
  UI_MARKER,
  DEDUP_MARKER_V3,
  STRICT_TYPE_MARKER,
  PRICE_LABEL_MARKER,
  CERTIFIED_MONO_MARKER,
  OLD_PARTNER_BLOCK,
  OLD_ARERA_LOOKUP,
  OLD_CERTIFIED_MONO_LOOKUP,
  OLD_PRICE_GROUP,
  OLD_SUPPLY_TAIL,
  OLD_FILTER_KEY_FUNCTION,
  OLD_GROUP_KEY_FUNCTION,
  OLD_CONSULTANT_DEDUP_BLOCK,
  OLD_OFFER_DETAILS_FUNCTION,
  OLD_BADGE_DECLARATION,
  NEW_CONSULTANT_DEDUP_BLOCK,
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

function fixture() {
  return [
    "<html>",
    OLD_PRICE_GROUP,
    OLD_SUPPLY_TAIL,
    "<script>",
    OLD_ARERA_LOOKUP,
    OLD_CERTIFIED_MONO_LOOKUP,
    OLD_PARTNER_BLOCK,
    OLD_FILTER_KEY_FUNCTION,
    "function unisciOfferteCandidati() {}",
    "function costruisciOfferteRanking() {}",
    OLD_GROUP_KEY_FUNCTION,
    OLD_CONSULTANT_DEDUP_BLOCK,
    OLD_OFFER_DETAILS_FUNCTION,
    "function render() {",
    OLD_BADGE_DECLARATION,
    "}",
    PDF_AUTO_SELECTION,
    MENU_CHANGE_LISTENER,
    "</script>",
    "</html>",
  ].join("\n");
}

test("applica il pacchetto incrementale completo", () => {
  const result = patchSource(fixture());
  assert.equal(result.changed, true);
  for (const marker of [
    PATCH_MARKER_V2,
    UI_MARKER,
    DEDUP_MARKER_V3,
    STRICT_TYPE_MARKER,
    PRICE_LABEL_MARKER,
    CERTIFIED_MONO_MARKER,
  ]) {
    assert.match(result.source, new RegExp(marker));
  }
});

test("il gruppo consulente rispetta esattamente tipo e fornitura selezionati", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /item\.compatibileRanking && item\.filtroEsatto/);
  assert.match(result.source, /item\.offerta\?\.tipo === tipoTariffa/);
  assert.match(result.source, /offertaCoerenteConFornitura\(item\.offerta, tipoFornitura\)/);
  assert.doesNotMatch(result.source, /chiaviPartnerAttivabili\.has/);
});

test("un fornitore attivabile non puo ricomparire con consulente", () => {
  const result = patchSource(fixture());
  assert.match(
    result.source,
    /!attivabiliPrioritarie\.some\(\(partner\) => \(\s*offerteStessoFornitore\(item\.offerta, partner\.offerta\)/
  );
});

test("ogni scheda mostra esplicitamente prezzo fisso o variabile", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /Prezzo variabile \(indicizzato\)/);
  assert.match(result.source, /Prezzo fisso \(bloccato\)/);
  assert.match(result.source, /tipoPrezzoBadge/);
  assert.match(result.source, />\$\{tipoPrezzoBadge\}<\/span>/);
});

test("spiega che il valore variabile non e bloccato", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /riferimento corrente usato per la stima e puo variare nel tempo/);
});

test("mantiene menu comune, preselezione PDF e ricalcolo", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /id="master-prezzo-confronto-panel"/);
  assert.equal(result.source.split('id="master-luce-tipo"').length - 1, 1);
  assert.ok(result.source.includes(PDF_AUTO_SELECTION));
  assert.ok(result.source.includes(MENU_CHANGE_LISTENER));
});

test("mantiene abbinamento ARERA certificato solo gas e solo luce", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /const certificata = rigaAreraPartnerCertificata\(offerta, commodity\)/);
  assert.match(result.source, /partnerOriginalId: offerta\.id/);
});

test("non trasforma offerte fisse in variabili per riempire la lista", () => {
  const result = patchSource(fixture());
  assert.match(result.source, /item\.offerta\?\.tipo === tipoTariffa/);
  assert.doesNotMatch(result.source, /tipo:\s*tipoTariffa/);
});

test("e idempotente", () => {
  const first = patchSource(fixture());
  const second = patchSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "already_patched");
  assert.equal(second.source, first.source);
});

test("si ferma su codice non riconosciuto", () => {
  assert.throws(
    () => patchSource("<html><script>function diversa() {}</script></html>"),
    /Patch non applicata|Verifica fallita/
  );
});
