import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  chunkStoragePaths,
  constantTimeStringEqual,
  normalizeCleanupLimit,
  runPremiumTrialCleanup,
} from "../supabase/functions/_shared/premium-trial-cleanup-core.mjs";

const edge = await readFile(new URL("../supabase/functions/premium-trial-cleanup/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/premium-trial-cleanup-v0.36.8.sql", import.meta.url), "utf8");
const verify = await readFile(new URL("../supabase/premium-trial-cleanup-v0.36.8-verify.sql", import.meta.url), "utf8");
const schedule = await readFile(new URL("../supabase/premium-trial-cleanup-v0.36.8-schedule-template.sql", import.meta.url), "utf8");
const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");

function fakeAdmin({ candidates = [], removeError = null, finalizeError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      if (name === "premium_begin_trial_cleanup_run") return { data: "run-1", error: null };
      if (name === "premium_trial_cleanup_candidates") return { data: candidates, error: null };
      if (name === "premium_finalize_trial_data_purge") {
        if (finalizeError) return { data: null, error: { message: finalizeError } };
        return { data: { purged_at: "2026-08-04T10:00:00Z", deleted_bills: 1, deleted_contracts: 1, deleted_utilities: 1 }, error: null };
      }
      if (name === "premium_finish_trial_cleanup_run") return { data: { ok: true }, error: null };
      throw new Error(`rpc inattesa: ${name}`);
    },
    storage: {
      from: (bucket) => ({
        remove: async (paths) => {
          calls.push(["remove", bucket, paths]);
          return removeError ? { data: null, error: { message: removeError } } : { data: paths, error: null };
        },
      }),
    },
  };
}

test("v0.36.8 limita batch e confronta il secret senza scorciatoie", () => {
  assert.equal(normalizeCleanupLimit(undefined), 25);
  assert.equal(normalizeCleanupLimit(0), 1);
  assert.equal(normalizeCleanupLimit(999), 100);
  assert.equal(constantTimeStringEqual("segreto", "segreto"), true);
  assert.equal(constantTimeStringEqual("segreto", "diverso"), false);
  assert.deepEqual(chunkStoragePaths(["a", "a", "b"], 1), [["a"], ["b"]]);
});

test("v0.36.8 elimina Storage prima della finalizzazione SQL", async () => {
  const admin = fakeAdmin({
    candidates: [{ user_id: "user-1", subscription_id: "sub-1", storage_paths: ["user-1/a.pdf"] }],
  });
  const result = await runPremiumTrialCleanup({ admin, dryRun: false, limit: 25 });
  assert.equal(result.ok, true);
  assert.equal(result.purged_count, 1);
  const removeIndex = admin.calls.findIndex((call) => call[0] === "remove");
  const finalizeIndex = admin.calls.findIndex((call) => call[1] === "premium_finalize_trial_data_purge");
  assert.ok(removeIndex >= 0 && finalizeIndex > removeIndex);
});

test("v0.36.8 non finalizza il database quando Storage fallisce", async () => {
  const admin = fakeAdmin({
    candidates: [{ user_id: "user-1", subscription_id: "sub-1", storage_paths: ["user-1/a.pdf"] }],
    removeError: "storage non disponibile",
  });
  const result = await runPremiumTrialCleanup({ admin, dryRun: false, limit: 25 });
  assert.equal(result.ok, false);
  assert.equal(result.failed_count, 1);
  assert.equal(admin.calls.some((call) => call[1] === "premium_finalize_trial_data_purge"), false);
});

test("v0.36.8 dry-run non cancella file o dati", async () => {
  const admin = fakeAdmin({
    candidates: [{ user_id: "user-1", subscription_id: "sub-1", storage_paths: ["user-1/a.pdf"] }],
  });
  const result = await runPremiumTrialCleanup({ admin, dryRun: true, limit: 25 });
  assert.equal(result.ok, true);
  assert.equal(result.candidate_count, 1);
  assert.equal(admin.calls.some((call) => call[0] === "remove"), false);
  assert.equal(admin.calls.some((call) => call[1] === "premium_finalize_trial_data_purge"), false);
});

test("v0.36.8 protegge funzione, registro e pianificazione", () => {
  assert.match(edge, /x-offertalogica-cron-secret/);
  assert.match(edge, /PREMIUM_CLEANUP_CRON_SECRET/);
  assert.match(edge, /SUPABASE_SECRET_KEYS/);
  assert.match(config, /\[functions\.premium-trial-cleanup\][\s\S]*verify_jwt = false/);
  assert.match(migration, /create table if not exists public\.premium_trial_cleanup_runs/);
  assert.match(migration, /premium_trial_cleanup_single_running_idx/);
  assert.match(migration, /premium_cleanup_already_running/);
  assert.match(migration, /grant execute on function public\.premium_begin_trial_cleanup_run[\s\S]*to service_role/);
  assert.match(verify, /premium_trial_cleanup_v0\.36\.8_ok/);
  assert.match(schedule, /cron\.schedule/);
  assert.match(schedule, /net\.http_post/);
  assert.match(schedule, /offertalogica_cleanup_cron_secret/);
  assert.doesNotMatch(migration, /delete from storage\.objects/i);
});
