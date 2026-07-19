import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PATCH_MARKER_V1 = "OFFERTALOGICA_SINGLE_SUPPLY_PARTNERS_V1";
export const PATCH_MARKER_V2 = "OFFERTALOGICA_SINGLE_SUPPLY_PARTNERS_V2";
export const UI_MARKER = "OFFERTALOGICA_PRICE_COMPARISON_PANEL_20260719";
export const DEDUP_MARKER = "OFFERTALOGICA_PROVIDER_DEDUP_20260719";
export const DEDUP_MARKER_V3 = "OFFERTALOGICA_PROVIDER_DEDUP_V3_20260719";
export const STRICT_TYPE_MARKER = "OFFERTALOGICA_STRICT_SELECTED_PRICE_TYPE_20260719";
export const PRICE_LABEL_MARKER = "OFFERTALOGICA_VISIBLE_PRICE_TYPE_20260719";
export const CERTIFIED_MONO_MARKER = "OFFERTALOGICA_CERTIFIED_MONO_ARERA_20260719";

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

export const OLD_CERTIFIED_MONO_LOOKUP = `  const esatta = rigaAreraDaCodice(codice);
  if (esatta) return esatta;

  const providerKey = chiaveFornitoreDaNome(offerta?.provider);`;

export const NEW_CERTIFIED_MONO_LOOKUP = `  const esatta = rigaAreraDaCodice(codice);
  if (esatta) return esatta;

  // ${CERTIFIED_MONO_MARKER}
  // Nelle proiezioni solo luce/gas usa prima l'abbinamento ARERA certificato
  // del partner originale; il riconoscimento per nome resta soltanto un fallback.
  const certificata = rigaAreraPartnerCertificata(offerta, commodity);
  if (certificata) return certificata;

  const providerKey = chiaveFornitoreDaNome(offerta?.provider);`;

export const OLD_PRICE_GROUP = `                    <div class="input-group">
                        <label for="master-luce-tipo">Tipo di Tariffa (Luce e Gas)</label>
                        <select id="master-luce-tipo">
                            <option value="fisso" selected>Prezzo Fisso (Bloccato)</option>
                            <option value="variabile">Prezzo Variabile (Indicizzato PUN/PSV)</option>
                        </select>
                    </div>`;

export const MOVED_PRICE_COMMENT =
  `                    <!-- ${UI_MARKER}: selezione prezzo spostata nel pannello comune -->`;

export const OLD_SUPPLY_TAIL = `                    <div class="input-group">
                        <label for="master-tipo-fornitura">Tipo di Fornitura</label>
                        <select id="master-tipo-fornitura">
                            <option value="luce">Solo luce</option>
                            <option value="gas">Solo gas</option>
                            <option value="separate">Forniture Separate (Fornitori diversi)</option>
                            <option value="dual" selected>Dual Fuel (Luce + Gas con lo stesso fornitore)</option>
                        </select>
                    </div>
                </div>

            </div>`;

export const NEW_SUPPLY_TAIL = `                    <div class="input-group">
                        <label for="master-tipo-fornitura">Tipo di Fornitura</label>
                        <select id="master-tipo-fornitura">
                            <option value="luce">Solo luce</option>
                            <option value="gas">Solo gas</option>
                            <option value="separate">Forniture Separate (Fornitori diversi)</option>
                            <option value="dual" selected>Dual Fuel (Luce + Gas con lo stesso fornitore)</option>
                        </select>
                    </div>
                </div>

            </div>

            <!-- ${UI_MARKER} -->
            <div id="master-prezzo-confronto-panel" class="column-energy" style="margin-top: 20px; padding: 16px; border: 1px solid #93c5fd; border-radius: 12px; background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);">
                <h4 style="color: var(--accent); margin-bottom: 12px;">Tipo di prezzo da confrontare</h4>
                <div class="input-group" style="margin-bottom: 0;">
                    <label for="master-luce-tipo">Quali offerte vuoi vedere?</label>
                    <select id="master-luce-tipo">
                        <option value="fisso" selected>Prezzo Fisso (Bloccato)</option>
                        <option value="variabile">Prezzo Variabile (Indicizzato PUN/PSV)</option>
                    </select>
                    <small class="provider-help">La bolletta imposta automaticamente la scelta iniziale. Puoi cambiarla: le classifiche verranno ricalcolate sullo stesso consumo.</small>
                </div>
            </div>`;

export const OLD_FILTER_KEY_FUNCTION = `function chiaveOffertaFiltro(offerta) {
  const provider = chiaveFornitoreDaNome(offerta?.provider) || testoFornitoreNormalizzato(offerta?.provider);
  return \`\${provider || offerta?.provider || offerta?.id}-\${offerta?.tipo}-\${offerta?.fornitura}\`;
}`;

export const V2_FILTER_KEY_FUNCTION = `// ${DEDUP_MARKER}
function ambitoEffettivoOfferta(offerta) {
  const haLuce = Boolean(offerta?.luce);
  const haGas = Boolean(offerta?.gas);
  if (haLuce && !haGas) return "luce";
  if (haGas && !haLuce) return "gas";
  return offerta?.fornitura === "dual" ? "dual" : "separate";
}

function chiaveProviderOfferta(offerta) {
  const componenti = offerta?.componentiSeparate;
  const luceKey = componenti?.luce?.providerKey || "";
  const gasKey = componenti?.gas?.providerKey || "";
  if (luceKey || gasKey) {
    return [luceKey, gasKey].filter(Boolean).sort().join("+");
  }
  return chiaveFornitoreDaNome(offerta?.provider)
    || testoFornitoreNormalizzato(offerta?.provider)
    || String(offerta?.id || "");
}

function chiaveOffertaFiltro(offerta) {
  return \`\${chiaveProviderOfferta(offerta)}-\${offerta?.tipo}-\${ambitoEffettivoOfferta(offerta)}\`;
}`;

export const NEW_FILTER_KEY_FUNCTION = `// ${DEDUP_MARKER_V3}
function ambitoEffettivoOfferta(offerta) {
  const haLuce = Boolean(offerta?.luce);
  const haGas = Boolean(offerta?.gas);
  if (haLuce && !haGas) return "luce";
  if (haGas && !haLuce) return "gas";
  return offerta?.fornitura === "dual" ? "dual" : "separate";
}

function normalizzaIdentitaProvider(value) {
  return testoFornitoreNormalizzato(value)
    .replace(/\\b(societa|srl|spa|energia|energy|italia|servizi|services|smart)\\b/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function offertaPartnerOriginale(offerta) {
  const originalId = offerta?.certificazione?.partnerOriginalId;
  if (originalId === undefined || originalId === null || originalId === "") return null;
  return OFFERTE_PROPOSTE.find((item) => String(item?.id) === String(originalId)) || null;
}

function identitaProviderOfferta(offerta) {
  const identities = new Set();
  const add = (prefix, value) => {
    const normalized = String(value || "").trim();
    if (normalized) identities.add(\`\${prefix}:\${normalized}\`);
  };

  const originale = offertaPartnerOriginale(offerta);
  const provider = originale?.provider || offerta?.provider || "";
  add("provider-key", chiaveFornitoreDaNome(provider));
  add("provider-name", normalizzaIdentitaProvider(provider));

  const componenti = offerta?.componentiSeparate;
  const componentKeys = [...new Set([
    componenti?.luce?.providerKey,
    componenti?.gas?.providerKey,
  ].filter(Boolean))];
  componentKeys.forEach((key) => add("provider-key", key));

  const codici = offerta?.certificazione?.codici || {};
  Object.values(codici).filter(Boolean).forEach((codice) => add("arera-code", codice));

  const monetizzazione = originale?.monetizzazione || offerta?.monetizzazione || {};
  if (monetizzazione.programId) add("program", monetizzazione.programId);

  return identities;
}

function offerteStessoFornitore(prima, seconda) {
  const identitaPrima = identitaProviderOfferta(prima);
  const identitaSeconda = identitaProviderOfferta(seconda);
  for (const identity of identitaPrima) {
    if (identitaSeconda.has(identity)) return true;
  }
  return false;
}

function chiaveProviderOfferta(offerta) {
  const identities = [...identitaProviderOfferta(offerta)];
  const providerKey = identities.find((value) => value.startsWith("provider-key:"));
  if (providerKey) return providerKey.slice("provider-key:".length);

  const providerName = identities.find((value) => value.startsWith("provider-name:"));
  if (providerName) return providerName.slice("provider-name:".length);

  return String(offerta?.id || "");
}

function chiaveOffertaFiltro(offerta) {
  return \`\${chiaveProviderOfferta(offerta)}-\${offerta?.tipo}-\${ambitoEffettivoOfferta(offerta)}\`;
}`;

export const OLD_GROUP_KEY_FUNCTION = `function chiaveGruppoPartner(item) {
  return chiaveOffertaFiltro(item?.offerta);
}`;

export const NEW_GROUP_KEY_FUNCTION = `function chiaveGruppoPartner(item) {
  // Il confronto corrente ha gia un solo tipo prezzo e un solo ambito:
  // per impedire doppioni fra i due gruppi basta la chiave del fornitore reale.
  return chiaveProviderOfferta(item?.offerta);
}`;

export const OLD_OFFER_DETAILS_FUNCTION = `function dettagliOfferta(offerta) {
  if (offertaSeparataMultiFornitore(offerta)) {
    return \`\${dettagliOffertaSeparata(offerta)} \${offerta.descrizione || ""}\`.trim();
  }
  const luce = offerta.luce
    ? \`Luce: \${prezzoOffertaTesto(offerta.luce, "luce")} | Fisso vendita: \${euro(offerta.luce.quotaFissaAnnua)}\`
    : "Luce non inclusa";
  const gas = offerta.gas
    ? \`Gas: \${prezzoOffertaTesto(offerta.gas, "gas")} | Fisso vendita: \${euro(offerta.gas.quotaFissaAnnua)}\`
    : "Gas non incluso";
  return \`\${luce} | \${gas}. \${offerta.descrizione}\`;
}`;

export const NEW_OFFER_DETAILS_FUNCTION = `// ${PRICE_LABEL_MARKER}
function dettagliOfferta(offerta) {
  const tipoPrezzo = offerta?.tipo === "variabile"
    ? "Prezzo variabile (indicizzato)"
    : "Prezzo fisso (bloccato)";
  const notaPrezzo = offerta?.tipo === "variabile"
    ? "Il valore unitario mostrato e il riferimento corrente usato per la stima e puo variare nel tempo."
    : "Il valore unitario e trattato come fisso secondo le condizioni economiche dell'offerta.";

  if (offertaSeparataMultiFornitore(offerta)) {
    return \`\${tipoPrezzo}. \${dettagliOffertaSeparata(offerta)} \${notaPrezzo} \${offerta.descrizione || ""}\`.trim();
  }
  const luce = offerta.luce
    ? \`Luce: \${prezzoOffertaTesto(offerta.luce, "luce")} | Fisso vendita: \${euro(offerta.luce.quotaFissaAnnua)}\`
    : "Luce non inclusa";
  const gas = offerta.gas
    ? \`Gas: \${prezzoOffertaTesto(offerta.gas, "gas")} | Fisso vendita: \${euro(offerta.gas.quotaFissaAnnua)}\`
    : "Gas non incluso";
  return \`\${tipoPrezzo}. \${luce} | \${gas}. \${notaPrezzo} \${offerta.descrizione || ""}\`.trim();
}`;


export const OLD_BADGE_DECLARATION = `      const badge = \`<span style="display:inline-block; margin:0 0 6px; padding:3px 8px; border:1px solid; border-radius:999px; font-size:11px; font-weight:800; \${stileBadgeOfferta({ posizioneEconomica, gruppoVisuale })}">\${badgeText}</span>\`;`;

export const NEW_BADGE_DECLARATION = `      const tipoPrezzoBadge = offerta?.tipo === "variabile" ? "Prezzo variabile" : "Prezzo fisso";
      const badge = \`<span style="display:inline-block; margin:0 0 6px; padding:3px 8px; border:1px solid; border-radius:999px; font-size:11px; font-weight:800; \${stileBadgeOfferta({ posizioneEconomica, gruppoVisuale })}">\${badgeText}</span><span style="display:inline-block; margin:0 0 6px 6px; padding:3px 8px; border:1px solid #bfdbfe; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-size:11px; font-weight:800;">\${tipoPrezzoBadge}</span>\`;`;

export const OLD_CONSULTANT_DEDUP_BLOCK = `  const chiaviPartnerAttivabili = new Set(attivabiliPrioritarie.map((item) => chiaveGruppoPartner(item)));
  const miglioriConConsulente = ordinateRanking
    .filter((item) => !item.attivabileOnline)
    .filter((item) => !chiaviPartnerAttivabili.has(chiaveGruppoPartner(item)))`;

export const NEW_CONSULTANT_DEDUP_BLOCK = `  // ${DEDUP_MARKER_V3}: un fornitore gia presente tra le attivabili
  // non puo ricomparire nel gruppo consulente, anche se la riga ARERA usa
  // un nome legale, un codice o una struttura tecnica differente.
  // ${STRICT_TYPE_MARKER}: il gruppo consulente deve rispettare esattamente
  // il tipo prezzo e la fornitura selezionati, senza alternative o fallback.
  const miglioriConConsulente = ordinateRanking
    .filter((item) => item.compatibileRanking && item.filtroEsatto)
    .filter((item) => item.offerta?.tipo === tipoTariffa)
    .filter((item) => offertaCoerenteConFornitura(item.offerta, tipoFornitura))
    .filter((item) => !item.attivabileOnline)
    .filter((item) => !attivabiliPrioritarie.some((partner) => (
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
      "Il file potrebbe appartenere a una versione diversa."
    );
  }
  return { source: source.replace(oldText, newText), changed: true };
}

function applyReplacement(state, oldText, newText, label) {
  const result = replaceExactlyOnce(state.source, oldText, newText, label);
  return {
    source: result.source,
    changed: state.changed || result.changed,
  };
}

export function patchSource(source) {
  if (typeof source !== "string") {
    throw new TypeError("Il contenuto di public/index.html non e valido.");
  }

  let state = { source, changed: false };

  if (!state.source.includes(PATCH_MARKER_V2)) {
    if (state.source.includes(PATCH_MARKER_V1)) {
      state = applyReplacement(state, V1_PARTNER_BLOCK, V2_PARTNER_BLOCK, "partner v1");
    } else {
      state = applyReplacement(state, OLD_PARTNER_BLOCK, V2_PARTNER_BLOCK, "offertePartnerDiretteAttivabili");
    }
  }

  state = applyReplacement(
    state,
    OLD_ARERA_LOOKUP,
    NEW_ARERA_LOOKUP,
    "associazione partner ARERA"
  );

  state = applyReplacement(
    state,
    OLD_CERTIFIED_MONO_LOOKUP,
    NEW_CERTIFIED_MONO_LOOKUP,
    "fallback ARERA mono-fornitura"
  );

  if (!state.source.includes(UI_MARKER)) {
    state = applyReplacement(
      state,
      OLD_PRICE_GROUP,
      MOVED_PRICE_COMMENT,
      "menu prezzo nella colonna luce"
    );
    state = applyReplacement(
      state,
      OLD_SUPPLY_TAIL,
      NEW_SUPPLY_TAIL,
      "pannello comune tipo fornitura/prezzo"
    );
  }

  if (!state.source.includes(DEDUP_MARKER_V3)) {
    if (state.source.includes(DEDUP_MARKER)) {
      state = applyReplacement(
        state,
        V2_FILTER_KEY_FUNCTION,
        NEW_FILTER_KEY_FUNCTION,
        "chiave filtro offerte v2"
      );
    } else {
      state = applyReplacement(
        state,
        OLD_FILTER_KEY_FUNCTION,
        NEW_FILTER_KEY_FUNCTION,
        "chiave filtro offerte"
      );
    }
  }

  state = applyReplacement(
    state,
    OLD_GROUP_KEY_FUNCTION,
    NEW_GROUP_KEY_FUNCTION,
    "deduplicazione gruppi"
  );

  state = applyReplacement(
    state,
    OLD_CONSULTANT_DEDUP_BLOCK,
    NEW_CONSULTANT_DEDUP_BLOCK,
    "esclusione duplicati e filtro esatto del gruppo consulente"
  );

  state = applyReplacement(
    state,
    OLD_OFFER_DETAILS_FUNCTION,
    NEW_OFFER_DETAILS_FUNCTION,
    "etichetta visibile del tipo prezzo"
  );

  state = applyReplacement(
    state,
    OLD_BADGE_DECLARATION,
    NEW_BADGE_DECLARATION,
    "badge fisso o variabile sulle schede"
  );

  const output = state.source;
  const requiredChecks = [
    [PATCH_MARKER_V2, "proiezione mono-fornitura"],
    [UI_MARKER, "pannello prezzo"],
    [DEDUP_MARKER_V3, "deduplicazione rigorosa per fornitore"],
    [STRICT_TYPE_MARKER, "filtro esatto del tipo prezzo"],
    [PRICE_LABEL_MARKER, "tipo prezzo visibile"],
    [CERTIFIED_MONO_MARKER, "abbinamento ARERA mono-fornitura"],
    ["partnerOriginalId: offerta.id", "ID partner originale"],
    [NEW_ARERA_LOOKUP, "ricerca ARERA con ID originale"],
    [NEW_CONSULTANT_DEDUP_BLOCK, "esclusione partner dal gruppo consulente"],
    ["function offerteStessoFornitore", "confronto identita fornitore"],
    [NEW_OFFER_DETAILS_FUNCTION, "dettagli con tipo prezzo"],
    [NEW_BADGE_DECLARATION, "badge tipo prezzo"],
    ['id="master-prezzo-confronto-panel"', "riquadro prezzo"],
    ['if (data.tipo_prezzo) setField("master-luce-tipo", data.tipo_prezzo);', "preselezione PDF"],
    ['"master-luce-tipo",', "evento cambio menu"],
  ];

  for (const [needle, label] of requiredChecks) {
    if (!output.includes(needle)) {
      throw new Error(`Verifica fallita: manca ${label}.`);
    }
  }

  const selectCount = output.split('id="master-luce-tipo"').length - 1;
  if (selectCount !== 1) {
    throw new Error(`Verifica fallita: atteso un solo menu prezzo, trovati ${selectCount}.`);
  }

  return {
    source: output,
    changed: state.changed,
    reason: state.changed ? "patched" : "already_patched",
  };
}

export async function applyPatch({
  targetPath = path.resolve(process.cwd(), "public/index.html"),
} = {}) {
  const original = await fs.readFile(targetPath, "utf8");
  const result = patchSource(original);

  if (!result.changed) {
    console.log("[incremental-price-filter] Patch gia presente.");
    return result;
  }

  await fs.writeFile(targetPath, result.source, "utf8");
  console.log("[incremental-price-filter] Filtro variabile rigoroso, deduplicazione e badge prezzo applicati a public/index.html.");
  return result;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  applyPatch().catch((error) => {
    console.error(`[incremental-price-filter] ${error.message}`);
    process.exitCode = 1;
  });
}
