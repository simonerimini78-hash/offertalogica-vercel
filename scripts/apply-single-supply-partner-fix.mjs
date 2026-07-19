import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PATCH_MARKER_V1 = "OFFERTALOGICA_SINGLE_SUPPLY_PARTNERS_V1";
export const PATCH_MARKER_V2 = "OFFERTALOGICA_SINGLE_SUPPLY_PARTNERS_V2";

export const OLD_PARTNER_BLOCK = `function offertePartnerDiretteAttivabili(tipoTariffa, tipoFornitura, attuale) {
  return OFFERTE_PROPOSTE
    .filter((offerta) => offertaAttivabileOnline(offerta))
    .filter((offerta) => offertaCompatibileConRanking(offerta, tipoTariffa, tipoFornitura))
    .map((offerta) => offertaPartnerConPrezziArera(offerta, attuale))
    .filter(Boolean)
    .filter((offerta) => offertaCalcolabileConIndici(offerta));
}`;

export const V1_PARTNER_BLOCK = `// ${PATCH_MARKER_V1}
function proiettaPartnerSuFornituraSingola(offerta, tipoFornitura) {
  if (!["luce", "gas"].includes(tipoFornitura)) return offerta;

  const commodity = tipoFornitura;
  const altraCommodity = commodity === "luce" ? "gas" : "luce";
  if (!offerta?.[commodity]) return null;

  // Le offerte gia mono-fornitura restano invariate.
  if (!offerta?.[altraCommodity]) return offerta;

  const label = commodity === "luce" ? "Solo luce" : "Solo gas";
  return {
    ...offerta,
    id: \`\${offerta.id}-\${commodity}\`,
    nome: \`\${offerta.nome} - \${label}\`,
    fornitura: "separate",
    luce: commodity === "luce" ? offerta.luce : null,
    gas: commodity === "gas" ? offerta.gas : null,
    descrizione: \`\${offerta.descrizione || ""} Confronto calcolato sulla sola fornitura \${commodity}. Il percorso partner puo richiedere di selezionare la singola fornitura nel funnel.\`.trim(),
    certificazione: {
      ...(offerta.certificazione || {}),
      derivataDaOffertaDual: true,
      fornituraCalcolata: commodity,
    },
  };
}

function offertePartnerDiretteAttivabili(tipoTariffa, tipoFornitura, attuale) {
  return OFFERTE_PROPOSTE
    .filter((offerta) => offertaAttivabileOnline(offerta))
    .map((offerta) => proiettaPartnerSuFornituraSingola(offerta, tipoFornitura))
    .filter(Boolean)
    .filter((offerta) => offertaCompatibileConRanking(offerta, tipoTariffa, tipoFornitura))
    .map((offerta) => offertaPartnerConPrezziArera(offerta, attuale))
    .filter(Boolean)
    .filter((offerta) => offertaCalcolabileConIndici(offerta));
}`;

export const V2_PARTNER_BLOCK = `// ${PATCH_MARKER_V2}
function proiettaPartnerSuFornituraSingola(offerta, tipoFornitura) {
  if (!["luce", "gas"].includes(tipoFornitura)) return offerta;

  const commodity = tipoFornitura;
  const altraCommodity = commodity === "luce" ? "gas" : "luce";
  if (!offerta?.[commodity]) return null;

  // Le offerte gia mono-fornitura restano invariate.
  if (!offerta?.[altraCommodity]) return offerta;

  const label = commodity === "luce" ? "Solo luce" : "Solo gas";
  return {
    ...offerta,
    id: \`\${offerta.id}-\${commodity}\`,
    nome: \`\${offerta.nome} - \${label}\`,
    fornitura: "separate",
    luce: commodity === "luce" ? offerta.luce : null,
    gas: commodity === "gas" ? offerta.gas : null,
    descrizione: \`\${offerta.descrizione || ""} Confronto calcolato sulla sola fornitura \${commodity}. Il percorso partner puo richiedere di selezionare la singola fornitura nel funnel.\`.trim(),
    certificazione: {
      ...(offerta.certificazione || {}),
      partnerOriginalId: offerta.id,
      derivataDaOffertaDual: true,
      fornituraCalcolata: commodity,
    },
  };
}

function offertePartnerDiretteAttivabili(tipoTariffa, tipoFornitura, attuale) {
  return OFFERTE_PROPOSTE
    .filter((offerta) => offertaAttivabileOnline(offerta))
    .map((offerta) => proiettaPartnerSuFornituraSingola(offerta, tipoFornitura))
    .filter(Boolean)
    .filter((offerta) => offertaCompatibileConRanking(offerta, tipoTariffa, tipoFornitura))
    .map((offerta) => offertaPartnerConPrezziArera(offerta, attuale))
    .filter(Boolean)
    .filter((offerta) => offertaCalcolabileConIndici(offerta));
}`;

export const OLD_ARERA_LOOKUP =
  `  const regola = ABBINAMENTI_PARTNER_ARERA[String(offerta?.id || "")]?.[commodity];`;

export const NEW_ARERA_LOOKUP =
  `  const partnerId = offerta?.certificazione?.partnerOriginalId || offerta?.id;\n` +
  `  const regola = ABBINAMENTI_PARTNER_ARERA[String(partnerId || "")]?.[commodity];`;

function replaceExactlyOnce(source, oldText, newText, label) {
  const occurrences = source.split(oldText).length - 1;
  if (occurrences === 0 && source.includes(newText)) {
    return { source, changed: false };
  }
  if (occurrences !== 1) {
    throw new Error(
      `Patch non applicata: atteso 1 blocco ${label}, trovati ${occurrences}. ` +
      "Il file potrebbe appartenere a una versione diversa."
    );
  }
  return { source: source.replace(oldText, newText), changed: true };
}

export function patchSource(source) {
  if (typeof source !== "string") {
    throw new TypeError("Il contenuto di public/index.html non e valido.");
  }

  let output = source;
  let changed = false;

  if (!output.includes(PATCH_MARKER_V2)) {
    if (output.includes(PATCH_MARKER_V1)) {
      const upgraded = replaceExactlyOnce(
        output,
        V1_PARTNER_BLOCK,
        V2_PARTNER_BLOCK,
        "partner v1"
      );
      output = upgraded.source;
      changed = changed || upgraded.changed;
    } else {
      const installed = replaceExactlyOnce(
        output,
        OLD_PARTNER_BLOCK,
        V2_PARTNER_BLOCK,
        "offertePartnerDiretteAttivabili"
      );
      output = installed.source;
      changed = changed || installed.changed;
    }
  }

  const lookup = replaceExactlyOnce(
    output,
    OLD_ARERA_LOOKUP,
    NEW_ARERA_LOOKUP,
    "associazione partner ARERA"
  );
  output = lookup.source;
  changed = changed || lookup.changed;

  if (!output.includes(PATCH_MARKER_V2)) {
    throw new Error("Verifica fallita: il marcatore v2 non e presente.");
  }
  if (!output.includes("partnerOriginalId: offerta.id")) {
    throw new Error("Verifica fallita: l'ID originale del partner non viene conservato.");
  }
  if (!output.includes(NEW_ARERA_LOOKUP)) {
    throw new Error("Verifica fallita: la ricerca ARERA non usa l'ID originale.");
  }

  return {
    source: output,
    changed,
    reason: changed ? "patched" : "already_patched",
  };
}

export async function applyPatch({
  targetPath = path.resolve(process.cwd(), "public/index.html"),
} = {}) {
  const original = await fs.readFile(targetPath, "utf8");
  const result = patchSource(original);

  if (!result.changed) {
    console.log("[single-supply-partners-v2] Patch gia presente.");
    return result;
  }

  await fs.writeFile(targetPath, result.source, "utf8");
  console.log("[single-supply-partners-v2] Patch applicata a public/index.html.");
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  applyPatch().catch((error) => {
    console.error(`[single-supply-partners-v2] ${error.message}`);
    process.exitCode = 1;
  });
}
