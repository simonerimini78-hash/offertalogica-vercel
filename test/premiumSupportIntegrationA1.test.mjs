import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const gitBlobSha = path => {
  const data = fs.readFileSync(new URL(`../${path}`, import.meta.url));
  const header = Buffer.from(`blob ${data.length}\0`);
  return crypto.createHash("sha1").update(Buffer.concat([header, data])).digest("hex");
};

test("A1: base installazione Premium resta byte-identica", () => {
  assert.equal(gitBlobSha("public/app-install.js"), "f8de9fd097f1508c9ec043e6cef8ceeb6838269e");
});

test("A1: modulo assistenza finale verificato viene integrato senza alterarlo", () => {
  assert.equal(gitBlobSha("public/app-support.js"), "f9a611371c8f903b4626554aadf8a5def078bc87");
  const js = read("public/app-support.js");
  assert.match(js, /Account e accesso/);
  assert.match(js, /Abbonamento e pagamento/);
  assert.match(js, /Installazione e aggiornamento app/);
  assert.match(js, /premium_communications/);
  assert.match(js, /CONTINUA CON ASSISTENZA AUTOMATICA/);
  assert.match(js, /ELIMINA RICHIESTA/);
  assert.match(js, /if \(existing\.openCase\)/);
});

test("A1: app Premium carica e inizializza il supporto", () => {
  const html = read("public/app.html");
  assert.match(html, /id="premiumSupportOpen"/);
  assert.match(html, /id="premiumSupportPanel"/);
  assert.match(html, /<script src="\/app-support\.js"><\/script>/);
  assert.match(html, /OffertaLogicaPremiumSupport\?\.init\(\)/);
  assert.match(html, /\.list-item-button\{/);
});

test("A1: non vengono trascinate modifiche Staff estranee", () => {
  const html = read("public/app.html");
  assert.doesNotMatch(html, /Spam\/Posta indesiderata/);
  assert.doesNotMatch(html, /Passaggio al piano pagato/);
  assert.match(html, /id="premiumSignupHint"/);
  assert.match(html, /<span>Dal secondo anno<\/span>/);
});

test("A1: service worker distribuisce il supporto mantenendo la shell esistente", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /offertalogica-premium-v03629-install-simple-support-a1/);
  assert.match(sw, /"\/app-support\.js"/);
  assert.match(sw, /"\/app-install\.js"/);
  assert.match(sw, /cache\.add\(new Request\(url, \{ cache: "reload" \}\)\)/);
});
