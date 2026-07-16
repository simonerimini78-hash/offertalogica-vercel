import fs from "node:fs";

const SOURCE_PAGE = "https://www.ilportaleofferte.it/portaleOfferte/it/open-data.page";
const BASE_URL = "https://www.ilportaleofferte.it";
const root = new URL("../", import.meta.url);
const outputPath = new URL("data/offerte-reali-arera-candidati.csv", root);
const metaPath = new URL("data/arera-sync-meta.json", root);

const HEADERS = [
  "provider_key",
  "fornitore",
  "commodity",
  "codice_offerta",
  "nome_offerta",
  "tipo_prezzo",
  "data_inizio",
  "data_fine",
  "url_offerta",
  "prezzi_variabili",
  "quote_fisse_annue",
  "prezzo_calcolo",
  "quota_fissa_calcolo",
  "utilizzabile_calcolatore",
  "fonte",
];

const FUORI_PERIMETRO = [
  "business",
  "azienda",
  "aziende",
  "pmi",
  "corporate",
  "condominio",
  "condomini",
  "partita iva",
  "professionisti",
  "microbusiness",
  "altri usi",
  "hotel",
  "pubblica amministrazione",
  "vacanze",
];

const KNOWN_PROVIDERS = [
  { key: "a2a", name: "A2A Energia", pattern: /(^|\.)a2aenergia\.|(^|\.)a2a\./i },
  { key: "acea", name: "Acea Energia", pattern: /aceaenergia|(^|\.)acea\./i },
  { key: "agasco", name: "Agasco", pattern: /agasco/i },
  { key: "alperia", name: "Alperia", pattern: /alperia/i },
  { key: "amga", name: "Amga", pattern: /amga/i },
  { key: "argos", name: "Argos", pattern: /argos/i },
  { key: "axpo", name: "Axpo Energia", pattern: /axpo/i },
  { key: "dolomiti", name: "Dolomiti Energia", pattern: /dolomitienergia|dolomiti/i },
  { key: "edison", name: "Edison Energia", pattern: /edisonenergia|(^|\.)edison\./i },
  { key: "enel", name: "Enel Energia", pattern: /(^|\.)enel\.|enelenergia/i },
  { key: "eni", name: "Eni Plenitude", pattern: /eniplenitude|plenitude/i },
  { key: "enercom", name: "Enercom", pattern: /enercom/i },
  { key: "engie", name: "Engie", pattern: /engie/i },
  { key: "eon", name: "E.ON Energia", pattern: /eon-energia|eonenergia|eon\.|e\.on/i },
  { key: "hera", name: "Hera Comm", pattern: /heracomm|gruppohera|hera/i },
  { key: "illum", name: "Illumia", pattern: /illumia/i },
  { key: "iren", name: "Iren Luce e Gas", pattern: /iren/i },
  { key: "magis", name: "Magis Energia", pattern: /magisenergia|magis/i },
  { key: "nen", name: "neN", pattern: /(^|\.)nen\.|nen\.it/i },
  { key: "nova", name: "Nova Aeg", pattern: /novaaeg|nova-aeg/i },
  { key: "octopus", name: "Octopus Energy", pattern: /octopusenergy|octopus/i },
  { key: "optima", name: "Optima Italia", pattern: /optimaitalia|optima/i },
  { key: "poste", name: "Poste Energia", pattern: /poste\.it|posteenergia/i },
  { key: "pulsee", name: "Pulsee Luce e Gas", pattern: /pulsee/i },
  { key: "sen", name: "Servizio Elettrico Nazionale", pattern: /servizioelettriconazionale/i },
  { key: "sorgenia", name: "Sorgenia", pattern: /sorgenia/i },
  { key: "tate", name: "Tate", pattern: /(^|\.)tate\.|tateenergia/i },
  { key: "vivi", name: "Vivi Energia", pattern: /vivienergia|vivi/i },
  { key: "wekiwi", name: "Wekiwi", pattern: /wekiwi/i },
  { key: "sinergy", name: "Sinergy", pattern: /sinergy/i },
];

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}

function tagBlocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"))].map((match) => match[0]);
}

function normalizeUrl(value) {
  const raw = decodeEntities(String(value || "")).trim();
  if (!raw) return "";
  if (raw === "-" || raw === "#") return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
  return "";
}

function hostFromUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";
  try {
    const candidate = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
    return new URL(candidate).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function providerInfoFromHost(host, piva) {
  for (const provider of KNOWN_PROVIDERS) {
    if (provider.pattern.test(host)) return provider;
  }
  const firstPart = host.split(".")[0] || "";
  if (!firstPart) {
    const fallbackName = piva ? `PIVA ${piva}` : "Venditore non identificato";
    return { key: piva ? `piva-${piva}` : "venditore-non-identificato", name: fallbackName };
  }
  const name = firstPart
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return { key: slug(firstPart), name };
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function uniq(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const number = Number(String(value || "").replace(",", "."));
    if (!Number.isFinite(number)) continue;
    const normalized = number.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function fuoriPerimetroText(...parts) {
  const text = parts.join(" ").toLowerCase();
  return FUORI_PERIMETRO.find((word) => text.includes(word)) || "";
}

function tipoPrezzoFromCode(code) {
  if (code === "01") return "fisso";
  if (code === "02") return "variabile";
  return "altro";
}

function formatSourceDate(url) {
  const match = String(url || "").match(/_(\d{8})\./);
  if (!match) return "";
  const raw = match[1];
  return `${raw.slice(6, 8)}/${raw.slice(4, 6)}/${raw.slice(0, 4)}`;
}

function absoluteUrl(href) {
  const clean = decodeEntities(href);
  return clean.startsWith("http") ? clean : new URL(clean, BASE_URL).toString();
}

function findHref(html, pattern) {
  const match = html.match(new RegExp(`href="([^"]*${pattern}[^"]*)"`, "i"));
  if (!match) throw new Error(`Link non trovato nella pagina Open Data: ${pattern}`);
  return absoluteUrl(match[1]);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "OffertaLogica/1.0 (+https://offertalogica.it)",
      "Accept": "text/html,application/xml,text/xml,text/csv,*/*",
    },
  });
  if (!response.ok) throw new Error(`Download fallito ${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

function extractPricesFromComponents(offerXml) {
  const variabili = [];
  const fisse = [];

  for (const componentXml of tagBlocks(offerXml, "ComponenteImpresa")) {
    const macroarea = tagText(componentXml, "MACROAREA");
    const prices = tagBlocks(componentXml, "IntervalloPrezzi")
      .map((block) => tagText(block, "PREZZO"))
      .filter(Boolean);

    if (macroarea === "01") fisse.push(...prices);
    if (macroarea === "04" || macroarea === "06") variabili.push(...prices);
  }

  return {
    prezziVariabili: uniq(variabili),
    quoteFisse: uniq(fisse),
  };
}

function parseOffers(xml, commodity, sourceUrl) {
  const sourceDate = formatSourceDate(sourceUrl);
  const fonte = `Portale Offerte ARERA/Acquirente Unico Open Data ${sourceDate || "ultimo file disponibile"}`;
  const rows = [];

  for (const offerXml of tagBlocks(xml, "offerta")) {
    const piva = tagText(offerXml, "PIVA_UTENTE");
    const codice = tagText(offerXml, "COD_OFFERTA");
    const nome = tagText(offerXml, "NOME_OFFERTA");
    const descrizione = tagText(offerXml, "DESCRIZIONE");
    const tipoCliente = tagText(offerXml, "TIPO_CLIENTE");
    const tipoPrezzoCode = tagText(offerXml, "TIPO_OFFERTA");
    const tipoPrezzo = tipoPrezzoFromCode(tipoPrezzoCode);
    const dataInizio = tagText(offerXml, "DATA_INIZIO");
    const dataFine = tagText(offerXml, "DATA_FINE");
    const siteUrl = normalizeUrl(tagText(offerXml, "URL_SITO_VENDITORE"));
    const offerUrl = normalizeUrl(tagText(offerXml, "URL_OFFERTA")) || siteUrl;
    const host = hostFromUrl(offerUrl || siteUrl);
    const provider = providerInfoFromHost(host, piva);
    const fornitore = provider.name;
    const providerKey = provider.key;
    const fuori = fuoriPerimetroText(nome, descrizione, offerUrl, codice);
    const { prezziVariabili, quoteFisse } = extractPricesFromComponents(offerXml);
    const prezzoCalcolo = prezziVariabili.length === 1 ? prezziVariabili[0] : "";
    const quotaFissaCalcolo = quoteFisse.length === 1 ? quoteFisse[0] : "";
    const strutturalmenteUsabile = (
      tipoCliente === "01" &&
      !fuori &&
      isHttpUrl(offerUrl) &&
      (tipoPrezzo === "fisso" || tipoPrezzo === "variabile") &&
      Boolean(prezzoCalcolo) &&
      Boolean(quotaFissaCalcolo)
    );

    rows.push({
      provider_key: providerKey || `piva-${piva}`,
      fornitore,
      commodity,
      codice_offerta: codice,
      nome_offerta: nome,
      tipo_prezzo: tipoPrezzo,
      data_inizio: dataInizio,
      data_fine: dataFine,
      url_offerta: offerUrl,
      prezzi_variabili: prezziVariabili.join("|"),
      quote_fisse_annue: quoteFisse.join("|"),
      prezzo_calcolo: prezzoCalcolo,
      quota_fissa_calcolo: quotaFissaCalcolo,
      utilizzabile_calcolatore: strutturalmenteUsabile ? "si" : "da_verificare",
      fonte,
    });
  }

  return rows;
}

function countLines(text) {
  return text.trim() ? text.trim().split(/\r?\n/).length : 0;
}

function writeCsv(rows) {
  const csv = [
    HEADERS.join(","),
    ...rows.map((row) => HEADERS.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(outputPath, `${csv}\n`);
}

async function main() {
  const page = await fetchText(SOURCE_PAGE);
  const sources = {
    offerteLuce: findHref(page, "PO_Offerte_E_MLIBERO_[^\"<>]+\\.xml"),
    parametriLuce: findHref(page, "PO_Parametri_Mercato_Libero_E_[^\"<>]+\\.csv"),
    offerteGas: findHref(page, "PO_Offerte_G_MLIBERO_[^\"<>]+\\.xml"),
    parametriGas: findHref(page, "PO_Parametri_Mercato_Libero_G_[^\"<>]+\\.csv"),
    offerteDual: findHref(page, "PO_Offerte_D_MLIBERO_[^\"<>]+\\.xml"),
  };

  const [luceXml, gasXml, parametriLuceCsv, parametriGasCsv, dualXml] = await Promise.all([
    fetchText(sources.offerteLuce),
    fetchText(sources.offerteGas),
    fetchText(sources.parametriLuce),
    fetchText(sources.parametriGas),
    fetchText(sources.offerteDual),
  ]);

  const rows = [
    ...parseOffers(luceXml, "luce", sources.offerteLuce),
    ...parseOffers(gasXml, "gas", sources.offerteGas),
  ].sort((a, b) => (
    a.fornitore.localeCompare(b.fornitore) ||
    a.commodity.localeCompare(b.commodity) ||
    a.nome_offerta.localeCompare(b.nome_offerta) ||
    a.codice_offerta.localeCompare(b.codice_offerta)
  ));

  writeCsv(rows);

  const counts = rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.commodity] = (acc[row.commodity] || 0) + 1;
    acc[row.utilizzabile_calcolatore] = (acc[row.utilizzabile_calcolatore] || 0) + 1;
    acc[row.tipo_prezzo] = (acc[row.tipo_prezzo] || 0) + 1;
    return acc;
  }, { total: 0 });

  const meta = {
    ok: true,
    generatedAt: new Date().toISOString(),
    sourcePage: SOURCE_PAGE,
    sources,
    output: "data/offerte-reali-arera-candidati.csv",
    counts,
    parametriLuceRows: Math.max(0, countLines(parametriLuceCsv) - 1),
    parametriGasRows: Math.max(0, countLines(parametriGasCsv) - 1),
    dualOffersDetected: tagBlocks(dualXml, "OffertaDual").length || tagBlocks(dualXml, "offerta").length,
    note: "Il sync aggiorna solo candidati e metadati. Le offerte pubbliche restano in data/offerte-proposte.json e vanno promosse dopo verifica.",
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    sourcePage: SOURCE_PAGE,
  }, null, 2));
  process.exit(1);
});
