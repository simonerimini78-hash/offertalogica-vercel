import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTNER_PATH_MARKER,
  PARTNER_GROUP_MARKER,
  OLD_COMMERCIAL_MATCH_BLOCK,
  NEW_COMMERCIAL_MATCH_BLOCK,
  OLD_ENRICH_BLOCK,
  NEW_ENRICH_BLOCK,
  CURRENT_RANKING_GROUP_BLOCK,
  NEW_RANKING_GROUP_BLOCK,
  patchSource,
} from "../scripts/apply-variable-partner-arera-fix.mjs";

function fixture() {
  return [
    "function similaritaOfferta() { return 0; }",
    OLD_COMMERCIAL_MATCH_BLOCK,
    "function matchCommercialeSufficiente() { return false; }",
    OLD_ENRICH_BLOCK,
    CURRENT_RANKING_GROUP_BLOCK,
    "const limiteConsulente = ordinateRanking.slice(0, 3);",
  ].join("\n\n");
}

test("applica la patch v4 e resta idempotente", () => {
  const first = patchSource(fixture());
  assert.equal(first.changed, true);
  assert.match(first.source, new RegExp(PARTNER_PATH_MARKER));
  assert.match(first.source, new RegExp(PARTNER_GROUP_MARKER));
  assert.ok(first.source.includes(NEW_COMMERCIAL_MATCH_BLOCK));
  assert.ok(first.source.includes(NEW_ENRICH_BLOCK));
  assert.ok(first.source.includes(NEW_RANKING_GROUP_BLOCK));
  assert.ok(!first.source.includes(OLD_COMMERCIAL_MATCH_BLOCK));

  const second = patchSource(first.source);
  assert.equal(second.changed, false);
  assert.equal(second.reason, "already_patched");
  assert.equal(second.source, first.source);
});

test("un partner con catalogo fisso dual puo arricchire una riga ARERA variabile solo luce", () => {
  const OFFERTE_PROPOSTE = [
    {
      id: 2,
      provider: "A2A",
      nome: "A2A Start Luce e Gas",
      tipo: "fisso",
      fornitura: "dual",
      link: "https://partner.example/a2a",
      destinationType: "affiliazione",
      destinationStatus: "attiva",
      monetizzazione: { network: "test" },
      luce: { prezzoVariabile: 0.1 },
      gas: { prezzoVariabile: 0.4 },
    },
  ];

  const factory = new Function(
    "OFFERTE_PROPOSTE",
    "chiaveFornitoreDaNome",
    "offertaAttivabileOnline",
    "offertaCoerenteConFornitura",
    "similaritaOfferta",
    "matchCommercialeSufficiente",
    `${NEW_COMMERCIAL_MATCH_BLOCK}\n${NEW_ENRICH_BLOCK}\nreturn { miglioreOffertaCommerciale, arricchisciOffertaAreraConCommerciale };`
  );

  const runtime = factory(
    OFFERTE_PROPOSTE,
    (provider) => provider.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    (offerta) => offerta.destinationStatus === "attiva" && offerta.link !== "#",
    (offerta, tipoFornitura) => {
      if (tipoFornitura === "luce") return Boolean(offerta.luce) && !offerta.gas;
      if (tipoFornitura === "gas") return Boolean(offerta.gas) && !offerta.luce;
      return offerta.fornitura === tipoFornitura;
    },
    () => 0,
    () => false,
  );

  const arera = {
    id: "arera-a2a-variabile-luce-1",
    provider: "A2A Energia",
    nome: "A2A Smart Casa Luce Variabile",
    tipo: "variabile",
    fornitura: "separate",
    link: "#",
    destinationType: "partner_lead",
    destinationStatus: "da_contattare",
    luce: { prezzoVariabile: 0.13 },
    gas: null,
    descrizione: "Ranking tecnico ARERA.",
    certificazione: { codici: { luce: "ARERA-LUCE-1" } },
  };

  const result = runtime.arricchisciOffertaAreraConCommerciale(
    arera,
    "a2a",
    "variabile",
    "luce",
    "A2A Smart Casa Luce Variabile",
  );

  assert.equal(result.destinationStatus, "attiva");
  assert.equal(result.destinationType, "affiliazione");
  assert.equal(result.link, "https://partner.example/a2a");
  assert.equal(result.tipo, "variabile");
  assert.equal(result.luce.prezzoVariabile, 0.13);
  assert.equal(result.gas, null);
  assert.equal(result.certificazione.partnerOriginalId, 2);
  assert.equal(result.certificazione.percorsoPartnerTipoOriginale, "fisso");
});

test("supporta anche il blocco ranking precedente alla patch v3", async () => {
  const { OLD_RANKING_GROUP_BLOCK } = await import("../scripts/apply-variable-partner-arera-fix.mjs");
  const source = [
    OLD_COMMERCIAL_MATCH_BLOCK,
    OLD_ENRICH_BLOCK,
    OLD_RANKING_GROUP_BLOCK,
    "const miglioriTre = ordinateRanking.slice(0, 3);",
  ].join("\n\n");
  const result = patchSource(source);
  assert.equal(result.changed, true);
  assert.ok(result.source.includes(PARTNER_GROUP_MARKER));
  assert.ok(result.source.includes("partnerAttivabiliCoerenti"));
});

test("rifiuta una versione sorgente non riconosciuta", () => {
  assert.throws(
    () => patchSource("<html>versione non compatibile</html>"),
    /Patch non applicata/,
  );
});
