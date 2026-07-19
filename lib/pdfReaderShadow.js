import { runPdfAiShadow } from "./pdfAiReader.js";
import { pdfArchiveConfigured } from "./pdfArchive.js";
import { legacyPdfToCandidates, PDF_CANDIDATE_CONTRACT_VERSION } from "./pdfReaderContract.js";
import { arbitratePdfCandidates, PDF_EVIDENCE_POLICY_VERSION } from "./pdfEvidencePolicy.js";

export const PDF_READER_SHADOW_VERSION = "shadow-gpt41-v1";

export async function runPdfReaderShadow({ filePath, filename, legacyNormalized = {}, deadlineAt = null, transport, apiKey, archiveReady = pdfArchiveConfigured() } = {}) {
  if (String(process.env.PDF_AI_MODE || "off").trim().toLowerCase() !== "shadow") {
    return { enabled: false, pipeline_version: PDF_READER_SHADOW_VERSION };
  }
  if (String(process.env.PDF_ARCHIVE_MODE || "off").trim().toLowerCase() === "off") {
    return { enabled: false, pipeline_version: PDF_READER_SHADOW_VERSION, reason: "archive_disabled" };
  }
  if (!archiveReady) {
    return { enabled: false, pipeline_version: PDF_READER_SHADOW_VERSION, reason: "archive_unavailable" };
  }

  const parserCandidates = legacyPdfToCandidates(legacyNormalized);
  const ai = await runPdfAiShadow({
    filePath,
    filename,
    legacyNormalized,
    parserCandidates,
    deadlineAt,
    transport,
    apiKey,
  });
  const candidates = [...parserCandidates, ...(ai.candidates || [])];
  const arbitration = arbitratePdfCandidates({ normalized: legacyNormalized, candidates });
  return {
    enabled: true,
    mode: "shadow",
    pipeline_version: PDF_READER_SHADOW_VERSION,
    candidate_contract_version: PDF_CANDIDATE_CONTRACT_VERSION,
    evidence_policy_version: PDF_EVIDENCE_POLICY_VERSION,
    created_at: new Date().toISOString(),
    public_output: "legacy_unchanged",
    legacy_parser_version: legacyNormalized.parser_version || "unknown",
    ai: {
      status: ai.status,
      reason: ai.reason || null,
      model: ai.model || null,
      response_id: ai.response_id || null,
      quality: ai.quality || null,
      page_map: ai.page_map || [],
      conflicts: ai.conflicts || [],
      review_reasons: ai.review_reasons || [],
    },
    candidates,
    arbitration,
    summary: {
      parser_candidates: parserCandidates.length,
      ai_candidates: (ai.candidates || []).length,
      calculator_ready: arbitration.calculator_ready,
      ...arbitration.counts,
    },
  };
}
