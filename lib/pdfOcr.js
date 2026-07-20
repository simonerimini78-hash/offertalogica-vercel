import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pdfiumBitmapToBmp } from "./pdfOcrBitmap.js";
import { ocrMaxPages, ocrScale, selectOcrPageIndexes } from "./pdfOcrPolicy.js";

const require = createRequire(import.meta.url);

function remainingMs(deadlineAt) {
  return Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - Date.now()) : Number.POSITIVE_INFINITY;
}

async function withDeadline(promise, deadlineAt, label) {
  const remaining = remainingMs(deadlineAt);
  if (!Number.isFinite(remaining)) return promise;
  if (remaining <= 0) throw new Error(`${label}_deadline`);
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_deadline`)), remaining);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveItalianLanguageData() {
  const trainedData = require.resolve("@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz");
  return {
    code: "ita",
    gzip: true,
    langPath: path.dirname(trainedData),
  };
}

function resolveWorkerPath() {
  try {
    return require.resolve("tesseract.js/src/worker-script/node/index.js");
  } catch {
    return undefined;
  }
}

async function createItalianWorker(deadlineAt) {
  const importedTesseract = await import("tesseract.js");
  const tesseract = importedTesseract.default || importedTesseract;
  const language = resolveItalianLanguageData();
  const workerOptions = {
    langPath: language.langPath,
    gzip: language.gzip,
    cacheMethod: "none",
    logger: () => {},
  };
  const workerPath = resolveWorkerPath();
  if (workerPath) workerOptions.workerPath = workerPath;

  const worker = await withDeadline(
    tesseract.createWorker(language.code, tesseract.OEM?.LSTM_ONLY ?? 1, workerOptions),
    deadlineAt,
    "ocr_worker",
  );
  await withDeadline(worker.setParameters({
    tessedit_pageseg_mode: tesseract.PSM?.AUTO ?? 3,
    preserve_interword_spaces: "1",
    user_defined_dpi: "180",
  }), deadlineAt, "ocr_parameters");
  return worker;
}

export async function runControlledPdfOcr(filePath, {
  pageCount,
  deadlineAt,
  env = process.env,
  onPageText,
} = {}) {
  const startedAt = Date.now();
  const maxPages = ocrMaxPages(env);
  const pageIndexes = selectOcrPageIndexes(pageCount, maxPages);
  if (!pageIndexes.length) {
    return {
      pageTexts: [],
      pages: [],
      elapsed_ms: Date.now() - startedAt,
      stopped_reason: "page_count_unavailable",
    };
  }

  const [{ PDFiumLibrary }, pdfBuffer] = await Promise.all([
    import("@hyzyla/pdfium"),
    fs.readFile(filePath),
  ]);

  let library;
  let document;
  let worker;
  const pageTexts = [];
  const completedPages = [];
  let stoppedReason = "completed";
  const configuredMinimum = Number.parseInt(env.PDF_OCR_MIN_REMAINING_MS || "3000", 10);
  const minimumRemainingMs = Number.isFinite(configuredMinimum)
    ? Math.max(2000, Math.min(10_000, configuredMinimum))
    : 3000;

  try {
    library = await withDeadline(PDFiumLibrary.init(), deadlineAt, "pdfium_init");
    document = await withDeadline(library.loadDocument(pdfBuffer), deadlineAt, "pdfium_load");
    worker = await createItalianWorker(deadlineAt);

    for (const pageIndex of pageIndexes) {
      if (remainingMs(deadlineAt) < minimumRemainingMs) {
        stoppedReason = "deadline_near";
        break;
      }

      const page = document.getPage(pageIndex);
      try {
        const rendered = await withDeadline(page.render({
          scale: ocrScale(env),
          render: "bitmap",
          colorSpace: "Gray",
        }), deadlineAt, "pdfium_render");
        const bmp = pdfiumBitmapToBmp(rendered.data, rendered.width, rendered.height);
        const result = await withDeadline(worker.recognize(bmp), deadlineAt, "ocr_recognize");
        const text = String(result?.data?.text || "").trim();
        pageTexts.push(text);
        completedPages.push(pageIndex + 1);
        const keepGoing = typeof onPageText === "function"
          ? await onPageText({ pageIndex, pageNumber: pageIndex + 1, text, pageTexts: [...pageTexts] })
          : true;
        if (keepGoing === false) {
          stoppedReason = "sufficient_result";
          break;
        }
      } catch (error) {
        const message = String(error?.message || "");
        const deadlineReached = /_deadline$/.test(message);
        if (deadlineReached && completedPages.length > 0) {
          // Non scartare il testo già ottenuto se una pagina successiva supera il limite.
          stoppedReason = "deadline_after_partial_result";
          break;
        }
        throw error;
      } finally {
        page.destroy?.();
      }
    }
  } finally {
    if (worker) await worker.terminate().catch(() => {});
    document?.destroy?.();
    library?.destroy?.();
  }

  return {
    pageTexts,
    pages: completedPages,
    elapsed_ms: Date.now() - startedAt,
    stopped_reason: stoppedReason,
  };
}
