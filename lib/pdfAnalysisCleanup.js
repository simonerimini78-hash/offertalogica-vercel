import { defaultPdfQuestionTransport } from "./pdfAiQuestionSession.js";

export async function deleteOpenAiSessionFiles(session, { apiKey = process.env.OPENAI_API_KEY, transport = defaultPdfQuestionTransport } = {}) {
  const fileIds = [...new Set((session?.pages || []).map((item) => item?.file_id).filter(Boolean))];
  const results = [];
  for (const fileId of fileIds) {
    try {
      results.push(await transport.deleteFile({ fileId, apiKey }));
    } catch (error) {
      results.push({ deleted: false, fileId, reason: String(error?.message || "delete_failed").slice(0, 180) });
    }
  }
  return { processed: fileIds.length, deleted: results.filter((item) => item?.deleted !== false).length, results };
}
