function clean(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function config(env = process.env) {
  return {
    enabled: /^(?:1|true|yes|on)$/i.test(String(env.PDF_SESSION_AUDIT_SUPABASE || "")),
    url: clean(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL),
    key: clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY),
  };
}

export async function mirrorPdfAnalysisSession(session, env = process.env) {
  const cfg = config(env);
  if (!cfg.enabled || !cfg.url || !cfg.key || !session?.id) return { mirrored: false, reason: "disabled" };
  const answers = Object.values(session.answers || {});
  const row = {
    id: session.id,
    created_at: session.created_at,
    updated_at: session.updated_at,
    expires_at: session.expires_at,
    status: session.status || "uploading",
    original_file_name: session.filename || "documento.pdf",
    expected_page_count: Number(session.expected_page_count || 0),
    uploaded_page_count: Number(session.pages?.length || 0),
    question_count: Number(session.plan?.length || 0),
    completed_question_count: answers.filter((item) => ["completed", "not_found", "conflict", "failed", "skipped"].includes(item?.status)).length,
    accepted_question_count: answers.filter((item) => item?.status === "completed").length,
    session_version: session.version || "unknown",
    metadata: {
      baseline_parser_version: session.baseline?.parser_version || null,
      baseline_commodity: session.baseline?.commodity || null,
      archive_analysis_id: session.archive?.analysisId || null,
      final_ready: Boolean(session.final?.normalized),
    },
  };
  const response = await fetch(`${cfg.url}/rest/v1/pdf_analysis_sessions?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`pdf_session_audit_${response.status}`);
  return { mirrored: true };
}
