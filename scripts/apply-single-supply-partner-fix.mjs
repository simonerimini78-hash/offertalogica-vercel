import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PATCH_MARKER = "OFFERTALOGICA_SINGLE_SUPPLY_PARTNERS_V1";

export const OLD_BLOCK = `function offertePartnerDiretteAttivabili(tipoTariffa, tipoFornitura, attuale) {
  return OFFERTE_PROPOSTE
    .filter((offerta) => offertaAttivabileOnline(offerta))
    .filter((offerta) => offertaCompatibileConRanking(offerta, tipoTariffa, tipoFornitura))
    .map((offerta) => offertaPartnerConPrezziArera(offerta, attuale))
    .filter(Boolean)
    .filter((offerta) => offertaCalcolabileConIndici(offerta));
}`;

export const NEW_BLOCK = `// ${PATCH_MARKER}
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

export function patchSource(source) {
  if (typeof source !== "string") {
    throw new TypeError("Il contenuto di public/index.html non e valido.");
  }

  if (source.includes(PATCH_MARKER)) {
    return { source, changed: false, reason: "already_patched" };
  }

  const occurrences = source.split(OLD_BLOCK).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Patch non applicata: atteso 1 blocco offertePartnerDiretteAttivabili, trovati ${occurrences}. ` +
      "Il file potrebbe appartenere a una versione diversa: non viene modificato."
    );
  }

  const patched = source.replace(OLD_BLOCK, NEW_BLOCK);
  if (!patched.includes(PATCH_MARKER) || patched.includes(OLD_BLOCK)) {
    throw new Error("Verifica della patch fallita: public/index.html non e stato scritto.");
  }

  return { source: patched, changed: true, reason: "patched" };
}

export async function applyPatch({
  targetPath = path.resolve(process.cwd(), "public/index.html"),
} = {}) {
  const original = await fs.readFile(targetPath, "utf8");
  const result = patchSource(original);

  if (!result.changed) {
    console.log(`[single-supply-partners] Nessuna modifica: ${result.reason}.`);
    return result;
  }

  await fs.writeFile(targetPath, result.source, "utf8");
  console.log("[single-supply-partners] Patch applicata a public/index.html.");
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  applyPatch().catch((error) => {
    console.error(`[single-supply-partners] ${error.message}`);
    process.exitCode = 1;
  });
}
