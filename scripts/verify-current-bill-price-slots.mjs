import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const failures = [];
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) failures.push(message);
};
const close = (a, b, tolerance = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tolerance;

function extractBetween(startToken, endToken) {
  const start = html.indexOf(startToken);
  if (start < 0) throw new Error(`Blocco iniziale non trovato: ${startToken}`);
  const end = html.indexOf(endToken, start);
  if (end < 0) throw new Error(`Blocco finale non trovato: ${endToken}`);
  return html.slice(start, end);
}

const code = [
  extractBetween("function pdfContractFieldEntry", "function pdfCommonExactValue"),
  extractBetween("function pdfValoreContrattoCompletoPerCalcolo", "const PDF_AUTOFILL_FIELD_IDS"),
  extractBetween("function numeroPrezzoSchedaPdf", "function mediaPrezziSchedaPdf"),
  extractBetween("function testoVocePrezzoAdattivaPdf", "function prezzoVenditaEsplicitoDaVociAdattivePdf"),
  extractBetween("function prezzoVenditaEsplicitoDaVociAdattivePdf", "function calcolaPrezzoBollettaLuceDaFasce"),
  extractBetween("function calcolaPrezzoBollettaLuceDaFasce", "function prezzoBollettaLuceDaContrattoPdf"),
  extractBetween("function fasceDaProfiloPdf", "function leggiOffertaAttuale"),
  extractBetween("function calcolaMateriaPerFasce", "function calcolaVoceEnergia"),
].join("\n\n");

const context = { PDF_PROFILE_STATE: { current: {}, offer: {} } };
vm.createContext(context);
vm.runInContext(`${code}\nthis.api = { pdfValoreContrattoCompletoPerCalcolo, prezzoVenditaEsplicitoDaVociAdattivePdf, calcolaPrezzoBollettaLuceDaFasce, fasceDaProfiloPdf, calcolaMateriaPerFasce };`, context);
const api = context.api;

const luceEstra = {
  kind: "bolletta",
  adaptive_form: {
    supplies: [{
      commodity: "luce",
      primary_price: null,
      price_items: [
        {
          label: "di cui spesa per vendita energia elettrica",
          value: 0.188041,
          value_text: "0,188041",
          unit: "€/kWh",
          // L'evidenza può contenere anche la riga vicina della rete: non deve invalidare l'etichetta corretta.
          evidence: "di cui spesa per vendita energia elettrica 0,188041 €/kWh; di cui spesa per la rete e gli oneri 0,045015 €/kWh",
        },
        { label: "di cui spesa per la rete e gli oneri generali", value: 0.045015, unit: "€/kWh" },
        { label: "PUN FASCE 05/2026 F1", value: 0.117887, unit: "€/kWh" },
      ],
    }],
  },
};
const gasEstra = {
  kind: "bolletta",
  adaptive_form: {
    supplies: [{
      commodity: "gas",
      primary_price: null,
      price_items: [
        {
          label: "di cui spesa per la materia gas naturale",
          value: 0.561228,
          value_text: "0,561228",
          unit: "€/Smc",
          evidence: "di cui spesa per la materia gas naturale 0,561228 €/Smc; rete e oneri 0,250468 €/Smc",
        },
        { label: "di cui spesa per la rete e gli oneri generali", value: 0.250468, unit: "€/Smc" },
        { label: "PSV 04/2026", value: 0.49163482, unit: "€/Smc" },
        { label: "SPREAD", value: 0.09, unit: "€/Smc" },
      ],
    }],
  },
};

assert(close(api.prezzoVenditaEsplicitoDaVociAdattivePdf(luceEstra, "luce")?.value, 0.188041), "Bolletta Estra luce: prezzo vendita esplicito non promosso");
assert(close(api.prezzoVenditaEsplicitoDaVociAdattivePdf(gasEstra, "gas")?.value, 0.561228), "Bolletta Estra gas: prezzo materia esplicito non promosso");
assert(api.prezzoVenditaEsplicitoDaVociAdattivePdf({ ...luceEstra, adaptive_form: { supplies: [{ commodity: "luce", price_items: [{ label: "rete e oneri", value: 0.045015, unit: "€/kWh" }] }] } }, "luce") === null, "La componente rete luce viene usata come prezzo vendita");
assert(api.prezzoVenditaEsplicitoDaVociAdattivePdf({ ...gasEstra, adaptive_form: { supplies: [{ commodity: "gas", price_items: [{ label: "rete e oneri", value: 0.250468, unit: "€/Smc" }] }] } }, "gas") === null, "La componente rete gas viene usata come prezzo vendita");
assert(api.prezzoVenditaEsplicitoDaVociAdattivePdf({ ...luceEstra, adaptive_form: { supplies: [{ commodity: "luce", price_items: [{ label: "PUN FASCE F1", value: 0.117887, unit: "€/kWh" }] }] } }, "luce") === null, "Il PUN mensile viene scambiato per prezzo vendita finale");
assert(api.prezzoVenditaEsplicitoDaVociAdattivePdf({ ...gasEstra, adaptive_form: { supplies: [{ commodity: "gas", price_items: [{ label: "PSV aprile", value: 0.49163482, unit: "€/Smc" }] }] } }, "gas") === null, "Il PSV mensile viene scambiato per prezzo vendita finale");

assert(close(api.calcolaPrezzoBollettaLuceDaFasce({ f0: 0.11, f1: 0.2, f23: 0.1 }, { f1: 40, f23: 60 })?.value, 0.11), "Bolletta: F0 non prioritario");
assert(close(api.calcolaPrezzoBollettaLuceDaFasce({ f1: 0.18, f2: 0.12, f3: 0.09 }, { f1: 33, f2: 31, f3: 36 })?.value, 0.129), "Bolletta: media ponderata F1/F2/F3 errata");
assert(close(api.calcolaPrezzoBollettaLuceDaFasce({ f1: 0.2, f23: 0.1 }, { f1: 40, f23: 60 })?.value, 0.14), "Bolletta: media ponderata F1/F23 errata");
assert(api.calcolaPrezzoBollettaLuceDaFasce({ f1: 0.18, f2: 0.12, f3: 0.09 }, {}) === null, "Bolletta: applicata media aritmetica senza consumi per fascia");
assert(api.calcolaPrezzoBollettaLuceDaFasce({ f1: 0.18, f2: 0.12 }, { f1: 33, f2: 31 }) === null, "Bolletta: prezzo inventato con fasce incomplete");

const f0Contract = {
  data_contract: { fields: { prezzo_luce_f0_eur_kwh: {
    status: "completo",
    normalized_value: 0.123,
    provenance: { origin: "pdf_visual_ai" },
    autofill: { allowed: false, reason: "campo_non_mappato" },
  } } },
};
assert(close(api.pdfValoreContrattoCompletoPerCalcolo(f0Contract, "prezzo_luce_f0_eur_kwh"), 0.123), "F0 completo ma non mappato non alimenta il calcolo derivato");
const blockedOcr = {
  data_contract: { fields: { prezzo_luce_f0_eur_kwh: {
    status: "completo",
    normalized_value: 0.123,
    provenance: { origin: "pdf_image_ocr" },
    autofill: { allowed: false, review_selectable: false },
  } } },
};
assert(api.pdfValoreContrattoCompletoPerCalcolo(blockedOcr, "prezzo_luce_f0_eur_kwh") === undefined, "OCR bloccato usato senza revisione");

context.PDF_PROFILE_STATE.current = {
  consumo_luce_f1_kwh: 513.811,
  consumo_luce_f2_kwh: 367.389,
  consumo_luce_f3_kwh: 449.1,
  prezzo_luce_f1_eur_kwh: 0.18,
  prezzo_luce_f2_eur_kwh: 0.12,
  prezzo_luce_f3_eur_kwh: 0.09,
};
const consumi = api.fasceDaProfiloPdf("current", "consumo_luce");
const prezzi = api.fasceDaProfiloPdf("current", "prezzo_luce");
assert(close(consumi.f1, 513.811) && close(consumi.f2, 367.389) && close(consumi.f3, 449.1), "Gli slot consumo con suffisso _kwh non vengono letti");
assert(close(prezzi.f1, 0.18) && close(prezzi.f2, 0.12) && close(prezzi.f3, 0.09), "Gli slot prezzo con suffisso _eur_kwh non vengono letti");
const materia = api.calcolaMateriaPerFasce({ f1: 10, f2: 20, f3: 30, f23: 50 }, { f1: 1, f2: 2, f3: 3, f23: 9 });
assert(materia?.modalitaPrezzo === "f1_f2_f3" && close(materia.quotaMateria, 140), "Il motore preferisce F1/F23 anche quando F1/F2/F3 sono complete");

assert(html.includes("OFFERTALOGICA_CURRENT_BILL_PRICE_SLOTS_20260729"), "Marker slot prezzo bolletta assente");
assert(html.includes('const lucePrice = safe("prezzo_luce_eur_kwh") ?? prezzoBollettaLuceDaContrattoPdf(data)?.value;'), "Il prezzo luce derivato non viene inserito nel campo principale");
assert(html.includes('const gasPrice = safe("prezzo_gas_eur_smc") ?? prezzoBollettaGasDaContrattoPdf(data)?.value;'), "Il prezzo gas adattivo non viene inserito nel campo principale");
assert(html.includes("aggiornaProfiloPdfDaDati(data, isOffer ? \"offer\" : \"current\")"), "I valori per fascia non vengono salvati nello slot del profilo");
assert(!html.includes("Catalogo ARERA del ${"), "Diagnostica del catalogo ARERA ancora visibile all'utente");
assert(!html.includes("sono presenti 4 dei 6 partner previsti"), "Messaggio 4/6 ancora visibile all'utente");
assert(!html.includes("Carica una bolletta o una scheda sintetica: l’IA leggerà"), "Testo introduttivo PDF ancora visibile");
assert(!html.includes("mantenendo anche fasce, formule e componenti presenti nel PDF"), "Testo tecnico fasce/formule ancora visibile");

const result = { ok: failures.length === 0, checks, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
