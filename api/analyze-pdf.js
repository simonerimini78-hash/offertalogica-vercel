import formidable from "formidable";
import { json, method } from "../lib/http.js";
import { extractPdf } from "../lib/pdfExtract.js";

export const config = {
  api: { bodyParser: false },
};

function parseForm(req) {
  const maxFileSize = Number(process.env.MAX_PDF_BYTES || 8_000_000);
  const form = formidable({
    multiples: false,
    maxFileSize,
    filter: (part) => part.mimetype === "application/pdf",
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) reject(error);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;

  try {
    const { files } = await parseForm(req);
    const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf;
    if (!file) return json(res, 400, { ok: false, error: "PDF mancante" });

    const normalized = await extractPdf(file.filepath);
    json(res, 200, { ok: true, normalized });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore analisi PDF" });
  }
}
