import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PARTNER_PATH_MARKER = "OFFERTALOGICA_ARERA_PARTNER_PATH_V4_20260719";
export const PARTNER_GROUP_MARKER = "OFFERTALOGICA_PARTNER_GROUP_EXCLUSION_V4_20260719";

export const OLD_COMMERCIAL_MATCH_BLOCK = `function miglioreOffertaCommerciale(providerKey, tipo, tipoFornitura, nomiArera = "") {
  const candidate = OFFERTE_PROPOSTE
    .filter((offerta) => chiaveFornitoreDaNome(offerta.provider) === providerKey)
    .filter((offerta) => offerta.tipo === tipo)
    .filter((offerta) => offertaCoerenteConFornitura(offerta, tipoFornitura))
    .sort((a, b) => {
      const activeScore = Number(offertaAttivabileOnline(b)) - Number(offertaAttivabileOnline(a));
      if (activeScore) return activeScore;
      return similaritaOfferta(nomiArera, b.nome) - similaritaOfferta(nomiArera, a.nome);
    })[0] || null;

  if (!candidate) return null;
  const score = similaritaOfferta(nomiArera, candidate.nome);
  return { offerta: candidate, score };
}`;

export const NEW_COMMERCIAL_MATCH_BLOCK = `// ${PARTNER_PATH_MARKER}
function percorsoCommercialeSupportaFornitura(offerta, tipoFornitura) {
  if (tipoFornitura === "luce") return Boolean(offerta?.luce);
  if (tipoFornitura === "gas") return Boolean(offerta?.gas);
  if (["dual", "separate"].includes(tipoFornitura)) return Boolean(offerta?.luce && offerta?.gas);
  return false;
}

function miglioreOffertaCommerciale(providerKey, tipo, tipoFornitura, nomiArera = "") {
  const candidate = OFFERTE_PROPOSTE
    .filter((offerta) => chiaveFornitoreDaNome(offerta.provider) === providerKey)
    .filter((offerta) => percorsoCommercialeSupportaFornitura(offerta, tipoFornitura))
    .sort((a, b) => {
      const activeScore = Number(offertaAttivabileOnline(b)) - Number(offertaAttivabileOnline(a));
      if (activeScore) return activeScore;

      const typeScore = Number(b.tipo === tipo) - Number(a.tipo === tipo);
      if (typeScore) return typeScore;

      const supplyScore = Number(offertaCoerenteConFornitura(b, tipoFornitura))
        - Number(offertaCoerenteConFornitura(a, tipoFornitura));
      if (supplyScore) return supplyScore;

      return similaritaOfferta(nomiArera, b.nome) - similaritaOfferta(nomiArera, a.nome);
    })[0] || null;

  if (!candidate) return null;
  const score = similaritaOfferta(nomiArera, candidate.nome);
  return { offerta: candidate, score };
}`;

export const OLD_ENRICH_BLOCK = `function arricchisciOffertaAreraConCommerciale(offerta, providerKey, tipo, tipoFornitura, nomiArera) {
  const match = miglioreOffertaCommerciale(providerKey, tipo, tipoFornitura, nomiArera);
  if (!match) return offerta;

  const commerciale = match.offerta;
  const copia = { ...offerta };
  const matchSufficiente = matchCommercialeSufficiente(providerKey, tipo, nomiArera, commerciale, match.score);
  if (offertaAttivabileOnline(commerciale) && matchSufficiente) {
    copia.link = commerciale.link;
    copia.destinationType = commerciale.destinationType;
    copia.destinationStatus = commerciale.destinationStatus;
    copia.monetizzazione = commerciale.monetizzazione;
    copia.descrizione = \`\${offerta.descrizione} Percorso partner disponibile per offerta coerente (\${commerciale.nome}).\`;
    copia.nome = offerta.nome;
    return copia;
  }

  if (commerciale.destinationType === "partner_lead" || commerciale.destinationStatus === "da_contattare") {
    copia.destinationType = "partner_lead";
    copia.destinationStatus = "da_contattare";
    copia.link = "#";
    copia.descrizione = \`\${offerta.descrizione} Richiede verifica consulenziale prima di eventuale attivazione.\`;
  }
  return copia;
}`;

export const NEW_ENRICH_BLOCK = `function arricchisciOffertaAreraConCommerciale(offerta, providerKey, tipo, tipoFornitura, nomiArera) {
  const match = miglioreOffertaCommerciale(providerKey, tipo, tipoFornitura, nomiArera);
  if (!match) return offerta;

  const commerciale = match.offerta;
  const copia = { ...offerta };
  const tipoCommercialeCoincide = commerciale.tipo === tipo;
  const matchSufficiente = tipoCommercialeCoincide
    ? matchCommercialeSufficiente(providerKey, tipo, nomiArera, commerciale, match.score)
    : percorsoCommercialeSupportaFornitura(commerciale, tipoFornitura);

  if (offertaAttivabileOnline(commerciale) && matchSufficiente) {
    copia.link = commerciale.link;
    copia.destinationType = commerciale.destinationType;
    copia.destinationStatus = commerciale.destinationStatus;
    copia.monetizzazione = commerciale.monetizzazione;
    copia.certificazione = {
      ...(offerta.certificazione || {}),
      partnerOriginalId: commerciale.id,
      percorsoPartnerDaCatalogo: true,
      percorsoPartnerTipoOriginale: commerciale.tipo,
      percorsoPartnerFornituraOriginale: commerciale.fornitura,
    };
    const notaPercorso = tipoCommercialeCoincide
      ? \`Percorso partner disponibile per offerta coerente (\${commerciale.nome}).\`
      : \`Percorso partner attivo disponibile tramite \${commerciale.provider}; condizioni economiche e tipologia restano quelle dell'offerta ARERA selezionata.\`;
    copia.descrizione = \`\${offerta.descrizione} \${notaPercorso}\`.trim();
    copia.nome = offerta.nome;
    return copia;
  }

  if (commerciale.destinationType === "partner_lead" || commerciale.destinationStatus === "da_contattare") {
    copia.destinationType = "partner_lead";
    copia.destinationStatus = "da_contattare";
    copia.link = "#";
    copia.descrizione = \`\${offerta.descrizione} Richiede verifica consulenziale prima di eventuale attivazione.\`;
  }
  return copia;
}`;

export const OLD_RANKING_GROUP_BLOCK = `  const attivabiliPrioritarie = deduplicaPartnerAttivabili(
    offerteCalcolate.filter((item) => item.attivabileCoerente)
  )
    .sort((a, b) => (a.costo - b.costo) || (b.differenza - a.differenza))
    .slice(0, 6)
    .map((item, index) => ({
      ...item,
      gruppoVisuale: "attivabile",
      posizioneGruppo: index + 1,
      posizioneEconomica: rankingGlobale.get(String(item.offerta.id)) || null,
    }));
  const chiaviPartnerAttivabili = new Set(attivabiliPrioritarie.map((item) => chiaveGruppoPartner(item)));
  const miglioriConConsulente = ordinateRanking
    .filter((item) => !item.attivabileOnline)
    .filter((item) => !chiaviPartnerAttivabili.has(chiaveGruppoPartner(item)))`;

export const CURRENT_RANKING_GROUP_BLOCK = `  const attivabiliPrioritarie = deduplicaPartnerAttivabili(
    offerteCalcolate.filter((item) => item.attivabileCoerente)
  )
    .sort((a, b) => (a.costo - b.costo) || (b.differenza - a.differenza))
    .slice(0, 6)
    .map((item, index) => ({
      ...item,
      gruppoVisuale: "attivabile",
      posizioneGruppo: index + 1,
      posizioneEconomica: rankingGlobale.get(String(item.offerta.id)) || null,
    }));
  // OFFERTALOGICA_PROVIDER_DEDUP_V3_20260719: un fornitore gia presente tra le attivabili
  // non puo ricomparire nel gruppo consulente, anche se la riga ARERA usa
  // un nome legale, un codice o una struttura tecnica differente.
  // OFFERTALOGICA_STRICT_SELECTED_PRICE_TYPE_20260719: il gruppo consulente deve rispettare esattamente
  // il tipo prezzo e la fornitura selezionati, senza alternative o fallback.
  const miglioriConConsulente = ordinateRanking
    .filter((item) => item.compatibileRanking && item.filtroEsatto)
    .filter((item) => item.offerta?.tipo === tipoTariffa)
    .filter((item) => offertaCoerenteConFornitura(item.offerta, tipoFornitura))
    .filter((item) => !item.attivabileOnline)
    .filter((item) => !attivabiliPrioritarie.some((partner) => (
      offerteStessoFornitore(item.offerta, partner.offerta)
    )))`;

export const NEW_RANKING_GROUP_BLOCK = `  // ${PARTNER_GROUP_MARKER}
  // Conserva tutti i partner attivabili coerenti prima del limite visuale di sei:
  // un eventuale settimo partner non deve ricomparire tra le offerte con consulente.
  const partnerAttivabiliCoerenti = deduplicaPartnerAttivabili(
    offerteCalcolate.filter((item) => item.attivabileCoerente)
  )
    .sort((a, b) => (a.costo - b.costo) || (b.differenza - a.differenza));

  const attivabiliPrioritarie = partnerAttivabiliCoerenti
    .slice(0, 6)
    .map((item, index) => ({
      ...item,
      gruppoVisuale: "attivabile",
      posizioneGruppo: index + 1,
      posizioneEconomica: rankingGlobale.get(String(item.offerta.id)) || null,
    }));

  // OFFERTALOGICA_PROVIDER_DEDUP_V3_20260719: un fornitore partner riconosciuto
  // non puo ricomparire nel gruppo consulente, anche se resta fuori dal limite visuale.
  // OFFERTALOGICA_STRICT_SELECTED_PRICE_TYPE_20260719: il gruppo consulente rispetta
  // esattamente tipo prezzo e fornitura selezionati.
  const miglioriConConsulente = ordinateRanking
    .filter((item) => item.compatibileRanking && item.filtroEsatto)
    .filter((item) => item.offerta?.tipo === tipoTariffa)
    .filter((item) => offertaCoerenteConFornitura(item.offerta, tipoFornitura))
    .filter((item) => !item.attivabileOnline)
    .filter((item) => !partnerAttivabiliCoerenti.some((partner) => (
      offerteStessoFornitore(item.offerta, partner.offerta)
    )))`;

function replaceExactlyOnce(source, oldText, newText, label) {
  const occurrences = source.split(oldText).length - 1;
  if (occurrences === 0 && source.includes(newText)) {
    return { source, changed: false };
  }
  if (occurrences !== 1) {
    throw new Error(
      `Patch non applicata: atteso 1 blocco ${label}, trovati ${occurrences}. ` +
      "Il progetto potrebbe appartenere a una versione diversa."
    );
  }
  return { source: source.replace(oldText, newText), changed: true };
}

function applyReplacement(state, oldText, newText, label) {
  const result = replaceExactlyOnce(state.source, oldText, newText, label);
  return { source: result.source, changed: state.changed || result.changed };
}

export function patchSource(source) {
  if (typeof source !== "string") {
    throw new TypeError("Il contenuto di public/index.html non e valido.");
  }

  let state = { source, changed: false };

  if (!state.source.includes(PARTNER_PATH_MARKER)) {
    state = applyReplacement(
      state,
      OLD_COMMERCIAL_MATCH_BLOCK,
      NEW_COMMERCIAL_MATCH_BLOCK,
      "ricerca percorso commerciale partner"
    );
    state = applyReplacement(
      state,
      OLD_ENRICH_BLOCK,
      NEW_ENRICH_BLOCK,
      "associazione offerta ARERA al partner attivo"
    );
  }

  if (!state.source.includes(PARTNER_GROUP_MARKER)) {
    if (state.source.includes(CURRENT_RANKING_GROUP_BLOCK)) {
      state = applyReplacement(
        state,
        CURRENT_RANKING_GROUP_BLOCK,
        NEW_RANKING_GROUP_BLOCK,
        "separazione partner e consulente v4"
      );
    } else {
      state = applyReplacement(
        state,
        OLD_RANKING_GROUP_BLOCK,
        NEW_RANKING_GROUP_BLOCK,
        "separazione partner e consulente legacy"
      );
    }
  }

  const output = state.source;
  const requiredChecks = [
    [PARTNER_PATH_MARKER, "ricerca partner indipendente dal tipo commerciale salvato"],
    [PARTNER_GROUP_MARKER, "esclusione completa dei partner dal gruppo consulente"],
    ["function percorsoCommercialeSupportaFornitura", "compatibilita del percorso partner"],
    ["partnerOriginalId: commerciale.id", "identita del partner originale"],
    ["percorsoPartnerTipoOriginale", "tracciamento del percorso commerciale"],
    ["const partnerAttivabiliCoerenti", "insieme completo dei partner attivabili"],
    ["!partnerAttivabiliCoerenti.some", "deduplicazione partner-consulente"],
    [".slice(0, 6)", "limite massimo di sei partner"],
    [".slice(0, 3)", "limite massimo di tre offerte consulente"],
  ];

  for (const [needle, label] of requiredChecks) {
    if (!output.includes(needle)) {
      throw new Error(`Verifica fallita: manca ${label}.`);
    }
  }

  const oldExactTypeFilter = `.filter((offerta) => offerta.tipo === tipo)\n    .filter((offerta) => offertaCoerenteConFornitura(offerta, tipoFornitura))`;
  if (output.includes(oldExactTypeFilter)) {
    throw new Error("Verifica fallita: la ricerca del percorso partner dipende ancora dal tipo commerciale esatto.");
  }

  return {
    source: output,
    changed: state.changed,
    reason: state.changed ? "patched" : "already_patched",
  };
}

async function applicaPatchPrerequisita(targetPath) {
  const prerequisiteUrl = new URL("./apply-single-supply-partner-fix.mjs", import.meta.url);
  let prerequisite;
  try {
    prerequisite = await import(prerequisiteUrl.href);
  } catch (error) {
    throw new Error(
      "Manca scripts/apply-single-supply-partner-fix.mjs: conserva lo script incrementale precedente nello stesso progetto. " +
      `(Dettaglio: ${error.message})`
    );
  }

  if (typeof prerequisite.applyPatch !== "function") {
    throw new Error("Lo script incrementale precedente non esporta applyPatch().");
  }
  await prerequisite.applyPatch({ targetPath });
}

export async function applyPatch({
  targetPath = path.resolve(process.cwd(), "public/index.html"),
  applyPrerequisite = true,
} = {}) {
  if (applyPrerequisite) await applicaPatchPrerequisita(targetPath);

  const original = await fs.readFile(targetPath, "utf8");
  const result = patchSource(original);

  if (!result.changed) {
    console.log("[variable-partner-arera-v4] Patch gia presente.");
    return result;
  }

  await fs.writeFile(targetPath, result.source, "utf8");
  console.log("[variable-partner-arera-v4] Percorsi partner ARERA e separazione consulente corretti in public/index.html.");
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  applyPatch().catch((error) => {
    console.error(`[variable-partner-arera-v4] ${error.message}`);
    process.exitCode = 1;
  });
}
