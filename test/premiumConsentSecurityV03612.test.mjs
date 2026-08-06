import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/premium-consent-security-v0.36.12.sql", "utf8");
const verify = fs.readFileSync("supabase/premium-consent-security-v0.36.12-verify.sql", "utf8");
const auth = fs.readFileSync("public/app-auth.js", "utf8");
const app = fs.readFileSync("public/app.html", "utf8");
const staff = fs.readFileSync("public/staff.html", "utf8");
const sw = fs.readFileSync("public/sw.js", "utf8");

test("v0.36.12 rende invoker l RPC pubblico dei consensi", () => {
  assert.match(migration, /create or replace function public\.premium_accept_current_terms[\s\S]*?security invoker/i);
  assert.doesNotMatch(migration, /create or replace function public\.premium_accept_current_terms[\s\S]*?security definer/i);
  assert.match(migration, /grant execute on function public\.premium_accept_current_terms\(jsonb\)[\s\S]*?authenticated/i);
  assert.match(migration, /revoke all on function public\.premium_accept_current_terms\(jsonb\)[\s\S]*?public, anon/i);
});

test("v0.36.12 limita gli insert alle colonne necessarie", () => {
  assert.match(migration, /revoke insert on table public\.premium_consents from authenticated/i);
  assert.match(migration, /grant insert \(consent_type, version, granted, source, proof\)/i);
  assert.doesNotMatch(migration, /grant insert \([^)]*user_id/i);
  assert.match(migration, /alter column user_id set default auth\.uid\(\)/i);
});

test("v0.36.12 consente solo le versioni legali correnti", () => {
  assert.match(migration, /premium-terms-v0\.36\.7-2026-08-04/);
  assert.match(migration, /premium-privacy-v0\.36\.6-2026-08-04/);
  assert.match(migration, /premium-cloud-ai-v0\.36\.6-2026-08-04/);
  assert.match(migration, /source = 'premium_app'/);
  assert.match(migration, /granted = true/);
  assert.match(migration, /revoked_at is null/);
});

test("v0.36.12 normalizza prova e impedisce payload e duplicati", () => {
  assert.match(migration, /create or replace function public\.premium_prepare_legal_consent\(\)/i);
  assert.match(migration, /pg_column_size\(v_proof\) > 4096/i);
  assert.match(migration, /user_agent[\s\S]*?500/i);
  assert.match(migration, /server_recorded_at/);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /return null;/i);
});

test("v0.36.12 mantiene invariata la chiamata frontend", () => {
  assert.match(auth, /client\.rpc\("premium_accept_current_terms"/);
  assert.match(auth, /p_proof:/);
});

test("v0.36.12 include una verifica installabile", () => {
  assert.match(verify, /premium_consent_security_v0\.36\.12_ok/);
  assert.match(verify, /not \([\s\S]*?procedure\.prosecdef/i);
  assert.match(verify, /has_column_privilege/i);
  assert.match(verify, /premium_prepare_legal_consent_before_insert/);
});

test("v0.36.12 aggiorna versione app staff e cache", () => {
  assert.match(app, /APP Premium v0\.36\.22/);
  assert.match(staff, /Area staff unica v0\.36\.22/);
  assert.match(sw, /offertalogica-premium-v03622/);
});
