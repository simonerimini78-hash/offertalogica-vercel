import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { cropPdfiumBitmap, pdfiumBitmapToBmp } from "./pdfOcrBitmap.js";
import { ocrMaxPages, ocrRenderScale, selectOcrPageIndexes } from "./pdfOcrPolicy.js";

const require = createRequire(import.meta.url);

function remainingMs(deadlineAt) {
  return Number.isFinite(deadlineAt) ? Math.max(0, deadlineAt - Date.now()) : Number.POSITIVE_INFINITY;
}

function thrownMessage(error) {
  if (typeof error === "string") return error.trim();
  if (error?.message) return String(error.message).trim();
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : "";
  } catch {
    return "";
  }
}

async function withDeadline(promise, deadlineAt, label) {
  const remaining = remainingMs(deadlineAt);
  if (remaining <= 0) throw new Error(`${label}_deadline`);
  let timer;
  try {
    const selected = Number.isFinite(remaining)
      ? Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label}_deadline`)), remaining);
            timer.unref?.();
          }),
        ])
      : promise;
    return await selected;
  } catch (error) {
    const message = thrownMessage(error);
    if (message === `${label}_deadline` || /_deadline$/.test(message)) {
      throw error instanceof Error ? error : new Error(message);
    }
    const detail = message && message !== "ocr_error"
      ? `:${message.slice(0, 120)}`
      : "";
    const wrapped = new Error(`${label}_error${detail}`);
    wrapped.code = `${label}_error`;
    throw wrapped;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function firstReadablePath(candidates, errorCode) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // prova il percorso successivo
    }
  }
  throw new Error(errorCode);
}

async function resolvePdfiumWasmPath() {
  let packageResolved = "";
  try {
    packageResolved = require.resolve("@hyzyla/pdfium/pdfium.wasm");
  } catch {
    // Il percorso esplicito process.cwd() è quello usato nel bundle Vercel.
  }
  return firstReadablePath([
    path.join(process.cwd(), "node_modules", "@hyzyla", "pdfium", "dist", "pdfium.wasm"),
    packageResolved,
  ], "ocr_asset_pdfium_wasm_missing");
}

async function resolveItalianLanguageData() {
  let packageResolved = "";
  try {
    packageResolved = require.resolve("@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz");
  } catch {
    // fallback esplicito sotto process.cwd()
  }
  const trainedData = await firstReadablePath([
    path.join(process.cwd(), "node_modules", "@tesseract.js-data", "ita", "4.0.0_best_int", "ita.traineddata.gz"),
    packageResolved,
  ], "ocr_asset_ita_missing");
  return {
    code: "ita",
    gzip: true,
    langPath: path.dirname(trainedData),
  };
}

async function resolveWorkerPath() {
  let packageResolved = "";
  try {
    packageResolved = require.resolve("tesseract.js/src/worker-script/node/index.js");
  } catch {
    // fallback esplicito sotto process.cwd()
  }
  return firstReadablePath([
    path.join(process.cwd(), "node_modules", "tesseract.js", "src", "worker-script", "node", "index.js"),
    packageResolved,
  ], "ocr_asset_worker_missing");
}


function shouldRunReceiptCrop(text) {
  const source = String(text || "");
  return /unoenergy/i.test(source)
    && /scontrino\s+dell['’]energia/i.test(source)
    && /energia\s+elettrica/i.test(source)
    && /quota\s+fissa/i.test(source);
}

function shouldRunUnoenergyHeaderCrop(text) {
  const source = String(text || "");
  return /unoenergy/i.test(source)
    && /codice\s+cliente/i.test(source)
    && /\b(?:POD|PDR)\b/i.test(source);
}

async function createItalianWorker(deadlineAt) {
  const importedTesseract = await import("tesseract.js");
  const tesseract = importedTesseract.default || importedTesseract;
  const [language, workerPath] = await Promise.all([
    resolveItalianLanguageData(),
    resolveWorkerPath(),
  ]);
  const worker = await withDeadline(
    tesseract.createWorker(language.code, tesseract.OEM?.LSTM_ONLY ?? 1, {
      langPath: language.langPath,
      gzip: language.gzip,
      cacheMethod: "none",
      workerPath,
      logger: () => {},
    }),
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
  pageSizes = [],
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
      asset_mode: "explicit_runtime_files",
    };
  }

  const [{ PDFiumLibrary }, pdfBuffer, pdfiumWasmPath] = await Promise.all([
    import("@hyzyla/pdfium"),
    fs.readFile(filePath),
    resolvePdfiumWasmPath(),
  ]);
  const wasmFile = await fs.readFile(pdfiumWasmPath);
  const wasmBinary = wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength);

  let library;
  let document;
  let worker;
  const pageTexts = [];
  const completedPages = [];
  const renderProfiles = [];
  let stoppedReason = "completed";
  const configuredMinimum = Number.parseInt(env.PDF_OCR_MIN_REMAINING_MS || "3000", 10);
  const minimumRemainingMs = Number.isFinite(configuredMinimum)
    ? Math.max(2000, Math.min(10_000, configuredMinimum))
    : 3000;

  try {
    library = await withDeadline(PDFiumLibrary.init({ wasmBinary }), deadlineAt, "pdfium_init");
    document = await withDeadline(library.loadDocument(pdfBuffer), deadlineAt, "pdfium_load");
    worker = await createItalianWorker(deadlineAt);

    for (const pageIndex of pageIndexes) {
      if (remainingMs(deadlineAt) < minimumRemainingMs) {
        stoppedReason = completedPages.length ? "deadline_after_partial_result" : "deadline_near";
        break;
      }

      const page = document.getPage(pageIndex);
      try {
        const renderScale = ocrRenderScale(pageSizes[pageIndex], env);
        const rendered = await withDeadline(page.render({
          scale: renderScale,
          render: "bitmap",
          colorSpace: "Gray",
        }), deadlineAt, "pdfium_render");
        renderProfiles.push({
          page: pageIndex + 1,
          scale: Math.round(renderScale * 1000) / 1000,
          width: rendered.width,
          height: rendered.height,
          pixels: rendered.width * rendered.height,
        });
        const bmp = pdfiumBitmapToBmp(rendered.data, rendered.width, rendered.height);
        const result = await withDeadline(worker.recognize(bmp), deadlineAt, "ocr_recognize");
        let text = String(result?.data?.text || "").trim();
        if (shouldRunUnoenergyHeaderCrop(text) && remainingMs(deadlineAt) >= minimumRemainingMs * 2) {
          const headerCrop = cropPdfiumBitmap(rendered.data, rendered.width, rendered.height, {
            left: 0.45,
            top: 0.01,
            right: 0.98,
            bottom: 0.16,
          });
          const headerBmp = pdfiumBitmapToBmp(headerCrop.data, headerCrop.width, headerCrop.height);
          const headerResult = await withDeadline(worker.recognize(headerBmp), deadlineAt, "ocr_header_crop");
          const headerText = String(headerResult?.data?.text || "").trim();
          if (headerText) text = `${text}\n\nOCR_CROP_HEADER\n${headerText}`;
        }
        if (shouldRunReceiptCrop(text) && remainingMs(deadlineAt) >= minimumRemainingMs * 2) {
          const crop = cropPdfiumBitmap(rendered.data, rendered.width, rendered.height, {
            left: 0.03,
            top: 0.12,
            right: 0.97,
            bottom: 0.52,
          });
          const cropBmp = pdfiumBitmapToBmp(crop.data, crop.width, crop.height);
          const cropResult = await withDeadline(worker.recognize(cropBmp), deadlineAt, "ocr_receipt_crop");
          const cropText = String(cropResult?.data?.text || "").trim();
          if (cropText) text = `${text}\n\nOCR_CROP_SCONTRINO\n${cropText}`;
        }
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
    asset_mode: "explicit_runtime_files",
    render_profiles: renderProfiles,
  };
}
