import { defaultPdfQuestionTransport } from "./pdfAiQuestionSession.js";

export const PDF_AI_PAGE_INDEX_VERSION = "step8-page-index-v1-single-page";

function outputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
      if (content?.type === "refusal") throw new Error("openai_refusal");
    }
  }
  throw new Error("openai_output_text_missing");
}

function schema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      readable: { type: "boolean" },
      scopes: {
        type: "array",
        items: { type: "string", enum: ["shared", "luce", "gas", "totals", "offer_terms", "unknown"] },
      },
      anchors: { type: "array", items: { type: "string" } },
      summary: { type: ["string", "null"] },
    },
    required: ["readable", "scopes", "anchors", "summary"],
  };
}

export async function indexUploadedPdfPage({ fileId, page, apiKey, model, transport = defaultPdfQuestionTransport, signal } = {}) {
  if (!fileId) throw new Error("page_file_id_missing");
  const request = {
    model,
    store: false,
    max_output_tokens: 500,
    input: [{
      role: "user",
      content: [
        { type: "input_image", file_id: fileId, detail: "high" },
        { type: "input_text", text: `Questa è esclusivamente la pagina ${page} di una bolletta italiana. Non estrarre valori. Indica soltanto quali aree sono realmente visibili e copia le etichette stampate utili tra: Società emittente, Intestata a, Codice fiscale, Codice cliente, Consumo annuo, POD, PDR, Potenza impegnata, Servizio fornito in, Quota consumi, Quota fissa, di cui per la vendita di energia elettrica, di cui per la vendita di gas naturale, Nome offerta, Codice offerta, Indice di riferimento, Scadenza condizioni economiche. Non inventare etichette assenti.` },
      ],
    }],
    text: { format: { type: "json_schema", name: "offertalogica_page_index", strict: true, schema: schema() } },
  };
  const body = await transport.createResponse({ request, apiKey, signal });
  const parsed = JSON.parse(outputText(body));
  const scopes = [...new Set((parsed.scopes || []).filter((item) => ["shared", "luce", "gas", "totals", "offer_terms", "unknown"].includes(item)))];
  return {
    version: PDF_AI_PAGE_INDEX_VERSION,
    page: Number(page),
    readable: Boolean(parsed.readable),
    scopes: scopes.length ? scopes : ["unknown"],
    anchors: (parsed.anchors || []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 40),
    summary: String(parsed.summary || "").trim().slice(0, 400) || null,
    response_id: body?.id || null,
  };
}
