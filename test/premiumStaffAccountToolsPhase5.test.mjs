import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("fase 5: avviso spam visibile durante creazione account e reinvio conferma", () => {
  const html = read("public/app.html");
  assert.match(html, /auth-email-notice/);
  assert.match(html, /Spam\/Posta indesiderata/);
  assert.match(html, /premiumResendConfirmation/);
});

test("fase 5: assistente account rimuove lo stato rosso obsoleto entrando nella guida", () => {
  const js = read("public/app-support.js");
  assert.match(js, /function handleCategory\(category\) \{\s*setStatus\("", ""\);/);
  assert.match(js, /function yellowStep\(message, retryHandler, redAllowed = true\) \{\s*setStatus\("", ""\);/);
  assert.match(js, /Puoi usare la guida automatica\. Per aprire o leggere una pratica dello staff sarà necessario accedere nuovamente\./);
});

test("fase 5: percorso account propone cambio password e escalation solo dopo il tentativo", () => {
  const js = read("public/app-support.js");
  assert.match(js, /Se questa sessione funziona, prova prima a cambiare password da Sicurezza account/);
  assert.match(js, /Il problema continua e blocca il servizio/);
  assert.match(js, /prepareEscalation\("Problema persistente dopo il tentativo automatico"\)/);
});

test("fase 5: staff espone strumenti account solo dentro la pratica", () => {
  const js = read("public/staff.js");
  assert.match(js, /staffSupportAccountTools/);
  assert.match(js, /INVIA CONFERMA ACCOUNT/);
  assert.match(js, /INVIA RECUPERO PASSWORD/);
  assert.match(js, /activeSupportCase\?\.supportCategory === "account"/);
});

test("fase 5: staff verifica lo stato Auth con RPC dedicata", () => {
  const js = read("public/staff.js");
  assert.match(js, /premium_staff_account_support_snapshot/);
  assert.match(js, /staffSupportEmailConfirmed/);
  assert.match(js, /staffSupportLastSignIn/);
  assert.match(js, /staffSupportSubscriptionStatus/);
});

test("fase 5: staff usa API Supabase ufficiali per conferma e recupero", () => {
  const js = read("public/staff.js");
  assert.match(js, /client\.auth\.resend\(\{\s*type: "signup"/);
  assert.match(js, /emailRedirectTo: `\$\{PREMIUM_APP_URL\}\?auth=confirm#profile`/);
  assert.match(js, /client\.auth\.resetPasswordForEmail\(email/);
  assert.match(js, /redirectTo: `\$\{PREMIUM_APP_URL\}\?auth=recovery#profile`/);
});

test("fase 5: le azioni staff vengono annotate nella conversazione e ricordano lo spam", () => {
  const js = read("public/staff.js");
  assert.match(js, /appendSupportActionMessage/);
  assert.match(js, /Ho inviato una nuova email di conferma account/);
  assert.match(js, /Ho inviato un nuovo link per reimpostare la password/);
  assert.match(js, /Spam\/Posta indesiderata/);
});

test("fase 5: SQL espone solo snapshot operativo allo staff e non password", () => {
  const sql = read("supabase/premium-support-account-tools-v0.36.29.sql");
  assert.match(sql, /security definer/i);
  assert.match(sql, /public\.premium_is_staff\(\)/);
  assert.match(sql, /auth\.users/);
  assert.match(sql, /email_confirmed_at/);
  assert.match(sql, /last_sign_in_at/);
  assert.doesNotMatch(sql, /encrypted_password|password_hash|raw_password/i);
});

test("fase 5: service worker cambia cache per distribuire il pacchetto", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /offertalogica-premium-v03629-support5-(?:account|install-(?:focus|dynamic))/);
});
