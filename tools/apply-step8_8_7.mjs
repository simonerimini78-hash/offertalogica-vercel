#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const STEP_8_8_7_MARKER = "OFFERTALOGICA_STEP_8_8_7_AI_FRONTEND_BRIDGE";

const BRIDGE_BLOCK = `
/* OFFERTALOGICA_STEP_8_8_7_AI_FRONTEND_BRIDGE
 * Mantiene la commodity finale duale quando la lettura visuale riconosce entrambe
 * le forniture, espone nell'anteprima anche i dati per l'attivazione e conserva
 * l'obbligo di selezione esplicita per OCR/IA.
 * Non rende applicabili consumi di periodo, costi medi o altri valori diagnostici.
 */
(function installaStep887AiFrontendBridge() {
  if (globalThis.__OFFERTALOGICA_STEP_8_8_7_INSTALLED__) return;
  globalThis.__OFFERTALOGICA_STEP_8_8_7_INSTALLED__ = true;

  const hasValue887 = (value) => {
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  };

  const normalizedSource887 = (entry) => String(
    entry?.provenance?.source || entry?.provenance?.origin || ""
  ).toLowerCase();

  const isAiOrOcr887 = (entry) => {
    const source = normalizedSource887(entry);
    return source.includes("ai") || source.includes("ocr") || source.includes("visual");
  };

  const isReviewSelectable887 = (entry) => Boolean(
    entry &&
    hasValue887(entry.normalized_value) &&
    ["da_verificare", "parziale", "review"].includes(String(entry.status || "").toLowerCase()) &&
    (
      entry?.autofill?.review_selectable === true ||
      entry?.autofill?.requires_explicit_selection === true ||
      entry?.review_required === true
    ) &&
    isAiOrOcr887(entry)
  );

  const originalMergePdfDocuments887 = typeof mergePdfDocuments === "function"
    ? mergePdfDocuments
    : null;

  if (originalMergePdfDocuments887) {
    mergePdfDocuments = function mergePdfDocumentsStep887(documents) {
      const merged = originalMergePdfDocuments887(documents) || {};
      const valid = (Array.isArray(documents) ? documents : []).filter((doc) => {
        if (!doc || doc.error) return false;
        if (typeof risultatoPdfUtilizzabile === "function") return risultatoPdfUtilizzabile(doc);
        return doc.recognized !== false && doc.kind !== "unknown";
      });

      const commoditySet = new Set(valid
        .map((doc) => String(doc?.commodity || "").toLowerCase())
        .filter((value) => ["luce", "gas", "dual"].includes(value)));

      const contractHasLuce = valid.some((doc) => Boolean(
        doc?.data_contract?.supplies?.luce ||
        doc?.data_contract?.readiness?.dati_bolletta?.luce
      ));
      const contractHasGas = valid.some((doc) => Boolean(
        doc?.data_contract?.supplies?.gas ||
        doc?.data_contract?.readiness?.dati_bolletta?.gas
      ));

      const hasLuce = commoditySet.has("dual") || commoditySet.has("luce") || contractHasLuce || Boolean(
        merged.fornitore_luce ||
        merged.indirizzo_fornitura_luce ||
        merged.pod ||
        merged.consumo_luce_kwh ||
        merged.prezzo_luce_eur_kwh ||
        merged.quota_fissa_vendita_luce_eur_anno
      );
      const hasGas = commoditySet.has("dual") || commoditySet.has("gas") || contractHasGas || Boolean(
        merged.fornitore_gas ||
        merged.indirizzo_fornitura_gas ||
        merged.pdr ||
        merged.consumo_gas_smc ||
        merged.prezzo_gas_eur_smc ||
        merged.quota_fissa_vendita_gas_eur_anno
      );

      merged.commodity = hasLuce && hasGas ? "dual" : hasGas ? "gas" : hasLuce ? "luce" : (merged.commodity || "unknown");

      const contractPlan = merged?.data_contract?.autofill_plan;
      if (contractPlan && !merged.autofill_plan) merged.autofill_plan = contractPlan;
      return merged;
    };
  }

  const originalPdfSafeAutofillValue887 = typeof pdfSafeAutofillValue === "function"
    ? pdfSafeAutofillValue
    : null;

  if (originalPdfSafeAutofillValue887) {
    pdfSafeAutofillValue = function pdfSafeAutofillValueStep887(data, field) {
      const original = originalPdfSafeAutofillValue887(data, field);
      if (original !== undefined) return original;
      const entry = data?.data_contract?.fields?.[field] || null;
      return isReviewSelectable887(entry) ? entry.normalized_value : undefined;
    };
  }

  const activationFields887 = Object.freeze([
    ["intestatario", "Intestatario (per attivazione)", null],
    ["codice_fiscale", "Codice fiscale / Partita IVA (per attivazione)", null],
    ["codice_cliente", "Codice cliente (per attivazione)", null],
    ["codice_cliente_luce", "Codice cliente luce (per attivazione)", null],
    ["codice_cliente_gas", "Codice cliente gas (per attivazione)", null],
    ["pod", "POD luce (per attivazione)", null],
    ["pdr", "PDR gas (per attivazione)", null],
    ["indirizzo_fornitura_luce", "Indirizzo fornitura luce (per attivazione)", null],
    ["indirizzo_fornitura_gas", "Indirizzo fornitura gas (per attivazione)", null],
    ["potenza_impegnata_kw", "Potenza impegnata (per attivazione)", "kW"],
  ]);

  const originalBuildPdfAutofillSpecs887 = typeof buildPdfAutofillSpecs === "function"
    ? buildPdfAutofillSpecs
    : null;

  if (originalBuildPdfAutofillSpecs887) {
    buildPdfAutofillSpecs = function buildPdfAutofillSpecsStep887(data, customerType = "privato") {
      const specs = originalBuildPdfAutofillSpecs887(data, customerType) || [];
      if (!data?.data_contract?.fields || data?.kind === "scheda_offerta") return specs;

      const existingFields = new Set(specs.map((spec) => spec?.field).filter(Boolean));
      activationFields887.forEach(([field, label, unit]) => {
        if (existingFields.has(field)) return;
        const entry = data.data_contract.fields[field];
        const value = typeof pdfSafeAutofillValue === "function"
          ? pdfSafeAutofillValue(data, field)
          : undefined;
        if (value === undefined || !entry) return;

        const source = normalizedSource887(entry);
        specs.push({
          id: \`step887-activation-\${field}\`,
          field,
          label,
          value,
          target_ids: [],
          kind: "activation_review",
          compare_mode: typeof value === "number" ? "number" : "text",
          unit: unit || entry.unit || null,
          input_id: null,
          unit_id: null,
          transform: null,
          use: "activation_helper",
          provenance: source,
          requires_explicit_selection: true,
        });
        existingFields.add(field);
      });
      return specs;
    };
  }

  const originalPdfAutofillCurrentState887 = typeof pdfAutofillCurrentState === "function"
    ? pdfAutofillCurrentState
    : null;

  if (originalPdfAutofillCurrentState887) {
    pdfAutofillCurrentState = function pdfAutofillCurrentStateStep887(spec) {
      if (spec?.kind !== "activation_review") return originalPdfAutofillCurrentState887(spec);
      const approved = LEAD_STATE?.pdfAutofill?.approvedActivationFields?.[spec.field];
      const hasApproved = hasValue887(approved);
      return {
        has_value: hasApproved,
        comparable_value: hasApproved ? approved : null,
        display: hasApproved ? String(approved) : "Non ancora confermato",
        manually_touched: false,
        all_equal: hasApproved && String(approved) === String(spec.value),
      };
    };
  }

  const originalBuildPdfAutofillPreviewRows887 = typeof buildPdfAutofillPreviewRows === "function"
    ? buildPdfAutofillPreviewRows
    : null;

  if (originalBuildPdfAutofillPreviewRows887) {
    buildPdfAutofillPreviewRows = function buildPdfAutofillPreviewRowsStep887(data, customerType = "privato") {
      const rows = originalBuildPdfAutofillPreviewRows887(data, customerType) || [];
      return rows.map((row) => {
        const entry = data?.data_contract?.fields?.[row.field] || null;
        const explicit = Boolean(
          row.requires_explicit_selection ||
          row.kind === "activation_review" ||
          isReviewSelectable887(entry) ||
          isAiOrOcr887(entry)
        );
        const activation = row.kind === "activation_review";
        return {
          ...row,
          requires_explicit_selection: explicit,
          selected: explicit ? false : Boolean(row.selected),
          status: activation
            ? "dato_attivazione_da_confermare"
            : explicit && !row.same_value && !row.manually_protected
              ? "lettura_da_verificare"
              : row.status,
        };
      });
    };
  }

  const originalPdfAutofillStatusLabel887 = typeof pdfAutofillStatusLabel === "function"
    ? pdfAutofillStatusLabel
    : null;

  if (originalPdfAutofillStatusLabel887) {
    pdfAutofillStatusLabel = function pdfAutofillStatusLabelStep887(status) {
      if (status === "lettura_da_verificare") return "Lettura OCR/IA da verificare e selezionare";
      if (status === "dato_attivazione_da_confermare") return "Dato per attivazione: conferma esplicita richiesta";
      return originalPdfAutofillStatusLabel887(status);
    };
  }

  const originalApplicaRigheAutocompilazionePdf887 = typeof applicaRigheAutocompilazionePdf === "function"
    ? applicaRigheAutocompilazionePdf
    : null;

  if (originalApplicaRigheAutocompilazionePdf887) {
    applicaRigheAutocompilazionePdf = function applicaRigheAutocompilazionePdfStep887(rows) {
      const selected = Array.isArray(rows) ? rows : [];
      const activationRows = selected.filter((row) => row?.kind === "activation_review");
      const moduleRows = selected.filter((row) => row?.kind !== "activation_review");

      if (activationRows.length) {
        LEAD_STATE.pdfAutofill = LEAD_STATE.pdfAutofill || {};
        LEAD_STATE.pdfAutofill.approvedActivationFields = {
          ...(LEAD_STATE.pdfAutofill.approvedActivationFields || {}),
        };
        activationRows.forEach((row) => {
          LEAD_STATE.pdfAutofill.approvedActivationFields[row.field] = row.value;
        });
      }

      const appliedModule = originalApplicaRigheAutocompilazionePdf887(moduleRows) || 0;
      if (typeof aggiornaAssistenteAttivazioneVisibilita === "function") aggiornaAssistenteAttivazioneVisibilita();
      return Number(appliedModule) + activationRows.length;
    };
  }

  const originalApriAnteprimaAutocompilazionePdf887 = typeof apriAnteprimaAutocompilazionePdf === "function"
    ? apriAnteprimaAutocompilazionePdf
    : null;

  if (originalApriAnteprimaAutocompilazionePdf887) {
    apriAnteprimaAutocompilazionePdf = function apriAnteprimaAutocompilazionePdfStep887(data) {
      const promise = originalApriAnteprimaAutocompilazionePdf887(data);
      const rows = Array.isArray(PDF_AUTOFILL_PREVIEW_ROWS) ? PDF_AUTOFILL_PREVIEW_ROWS : [];
      const activationCount = rows.filter((row) => row?.kind === "activation_review").length;
      const reviewCount = rows.filter((row) => row?.requires_explicit_selection).length;
      const copy = document.getElementById("pdf-autofill-preview-copy");
      if (copy && reviewCount) {
        copy.textContent = \`\${reviewCount} campi provengono da OCR/IA e restano deselezionati finché non li scegli. \${activationCount ? \`\${activationCount} sono dati per l'attivazione e non valori economici del confronto. \` : ""}I valori mostrati solo nel pannello diagnostico, come consumi del periodo e costi medi, non sono applicabili.\`;
      }
      return promise;
    };
  }
})();
`;

function findScriptInsertionPoint(html) {
  const bodyClose = html.lastIndexOf("</body>");
  const searchEnd = bodyClose >= 0 ? bodyClose : html.length;
  const scriptClose = html.lastIndexOf("</script>", searchEnd);
  if (scriptClose < 0) throw new Error("Nessun blocco <script> trovato nel file HTML");
  return scriptClose;
}

function validateTarget(html, filename = "index.html") {
  const required = [
    "function mergePdfDocuments",
    "pdf-autofill-preview",
    "function buildPdfAutofillSpecs",
    "function applicaRigheAutocompilazionePdf",
  ];
  const missing = required.filter((token) => !html.includes(token));
  if (missing.length) {
    throw new Error(`${filename}: struttura frontend PDF non riconosciuta (${missing.join(", ")})`);
  }
}

export function patchHtml(html, filename = "index.html") {
  if (html.includes(STEP_8_8_7_MARKER)) {
    return { html, changed: false, reason: "already_patched" };
  }
  validateTarget(html, filename);
  const insertionPoint = findScriptInsertionPoint(html);
  const patched = `${html.slice(0, insertionPoint)}\n${BRIDGE_BLOCK}\n${html.slice(insertionPoint)}`;
  return { html: patched, changed: true, reason: "patched" };
}

function parseArgs(argv) {
  const options = { dryRun: false, root: process.cwd(), targets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--root") options.root = path.resolve(argv[++index] || ".");
    else if (arg === "--target") options.targets.push(argv[++index]);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return options;
}

function usage() {
  return `Uso:\n  node tools/apply-step8_8_7.mjs --dry-run\n  node tools/apply-step8_8_7.mjs\n\nOpzioni:\n  --root <cartella>   root del repository (default: directory corrente)\n  --target <file>     file HTML relativo da correggere; ripetibile\n  --dry-run           verifica senza scrivere file`;
}

function candidateTargets(root, explicitTargets) {
  if (explicitTargets.length) return explicitTargets.map((item) => path.resolve(root, item));
  const publicIndex = path.resolve(root, "public/index.html");
  if (fs.existsSync(publicIndex)) return [publicIndex];
  const rootIndex = path.resolve(root, "index.html");
  return fs.existsSync(rootIndex) ? [rootIndex] : [];
}

function backupPathFor(file) {
  const safe = file.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const dir = path.join(os.homedir(), ".offertalogica-backups", "step8.8.7");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}-${safe}`);
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const targets = candidateTargets(options.root, options.targets);
  if (!targets.length) throw new Error("Nessun index.html trovato nel repository");

  const reports = [];
  for (const file of targets) {
    const relative = path.relative(options.root, file) || path.basename(file);
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes("function mergePdfDocuments") || !source.includes("pdf-autofill-preview")) {
      reports.push({ file: relative, status: "ignorato", detail: "nessuna pipeline PDF compatibile" });
      continue;
    }
    const result = patchHtml(source, relative);
    if (!result.changed) {
      reports.push({ file: relative, status: "già aggiornato", detail: STEP_8_8_7_MARKER });
      continue;
    }
    if (!options.dryRun) {
      const backup = backupPathFor(file);
      fs.copyFileSync(file, backup);
      fs.writeFileSync(file, result.html, "utf8");
      reports.push({ file: relative, status: "aggiornato", detail: `backup: ${backup}` });
    } else {
      reports.push({ file: relative, status: "pronto", detail: "nessuna scrittura (--dry-run)" });
    }
  }

  const actionable = reports.filter((item) => ["pronto", "aggiornato", "già aggiornato"].includes(item.status));
  reports.forEach((item) => console.log(`${item.status.toUpperCase()}: ${item.file} — ${item.detail}`));
  if (!actionable.length) throw new Error("Nessun frontend PDF compatibile è stato trovato");
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`ERRORE Step 8.8.7: ${error.message}`);
    process.exitCode = 1;
  }
}
