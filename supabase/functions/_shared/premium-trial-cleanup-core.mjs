export const CLEANUP_BUCKET = "premium-bills";
export const DEFAULT_CANDIDATE_LIMIT = 25;
export const MAX_CANDIDATE_LIMIT = 100;
export const STORAGE_REMOVE_BATCH_SIZE = 1000;

export function normalizeCleanupLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CANDIDATE_LIMIT;
  return Math.max(1, Math.min(parsed, MAX_CANDIDATE_LIMIT));
}

export function uniqueStoragePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
}

export function chunkStoragePaths(paths, size = STORAGE_REMOVE_BATCH_SIZE) {
  const normalized = uniqueStoragePaths(paths);
  const safeSize = Math.max(1, Math.min(Number.parseInt(String(size), 10) || STORAGE_REMOVE_BATCH_SIZE, STORAGE_REMOVE_BATCH_SIZE));
  const chunks = [];
  for (let index = 0; index < normalized.length; index += safeSize) {
    chunks.push(normalized.slice(index, index + safeSize));
  }
  return chunks;
}

export function constantTimeStringEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left ?? ""));
  const rightBytes = new TextEncoder().encode(String(right ?? ""));
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function compactError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown_error");
  return message.replace(/\s+/g, " ").trim().slice(0, 500) || "unknown_error";
}

async function callRpc(admin, name, args) {
  const result = await admin.rpc(name, args);
  if (result?.error) throw new Error(`${name}:${compactError(result.error.message || result.error)}`);
  return result?.data;
}

async function finishRun(admin, payload) {
  return callRpc(admin, "premium_finish_trial_cleanup_run", {
    p_run_id: payload.runId,
    p_status: payload.status,
    p_candidate_count: payload.candidateCount,
    p_purged_count: payload.purgedCount,
    p_failed_count: payload.failedCount,
    p_details: payload.details,
    p_error_message: payload.errorMessage || "",
  });
}

export async function runPremiumTrialCleanup({ admin, dryRun = false, limit = DEFAULT_CANDIDATE_LIMIT, source = "cron" }) {
  if (!admin?.rpc || !admin?.storage?.from) throw new Error("premium_cleanup_admin_client_required");

  const normalizedLimit = normalizeCleanupLimit(limit);
  const runId = await callRpc(admin, "premium_begin_trial_cleanup_run", {
    p_source: source,
    p_dry_run: Boolean(dryRun),
    p_limit: normalizedLimit,
  });

  let candidateCount = 0;
  let purgedCount = 0;
  let failedCount = 0;
  const details = [];

  try {
    const candidates = (await callRpc(admin, "premium_trial_cleanup_candidates", {
      p_limit: normalizedLimit,
    })) || [];
    candidateCount = candidates.length;

    for (const candidate of candidates) {
      const paths = uniqueStoragePaths(candidate?.storage_paths);
      const detail = {
        subscription_id: candidate?.subscription_id || null,
        archive_access_until: candidate?.archive_access_until || null,
        storage_object_count: paths.length,
        status: dryRun ? "dry_run" : "pending",
      };

      if (dryRun) {
        details.push(detail);
        continue;
      }

      try {
        for (const batch of chunkStoragePaths(paths)) {
          const removal = await admin.storage.from(CLEANUP_BUCKET).remove(batch);
          if (removal?.error) throw new Error(`storage_remove:${compactError(removal.error.message || removal.error)}`);
        }

        const finalized = await callRpc(admin, "premium_finalize_trial_data_purge", {
          p_user_id: candidate.user_id,
        });
        purgedCount += 1;
        details.push({
          ...detail,
          status: "purged",
          purged_at: finalized?.purged_at || null,
          deleted_bills: finalized?.deleted_bills ?? null,
          deleted_contracts: finalized?.deleted_contracts ?? null,
          deleted_utilities: finalized?.deleted_utilities ?? null,
        });
      } catch (error) {
        failedCount += 1;
        details.push({ ...detail, status: "failed", error: compactError(error) });
      }
    }

    const status = failedCount === 0 ? "completed" : purgedCount > 0 ? "partial" : "failed";
    await finishRun(admin, {
      runId,
      status,
      candidateCount,
      purgedCount,
      failedCount,
      details,
      errorMessage: failedCount ? "one_or_more_candidates_failed" : "",
    });

    return {
      ok: failedCount === 0,
      run_id: runId,
      dry_run: Boolean(dryRun),
      requested_limit: normalizedLimit,
      candidate_count: candidateCount,
      purged_count: purgedCount,
      failed_count: failedCount,
      details,
    };
  } catch (error) {
    const message = compactError(error);
    try {
      await finishRun(admin, {
        runId,
        status: "failed",
        candidateCount,
        purgedCount,
        failedCount: Math.max(1, failedCount),
        details,
        errorMessage: message,
      });
    } catch {
      // Il log della funzione Edge conserva comunque l'errore originale.
    }
    throw new Error(message);
  }
}
