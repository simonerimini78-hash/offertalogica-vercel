import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../public/app.html", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

test("Premium installata ha naming distinto", () => {
  assert.equal(manifest.name, "OffertaLogica Premium");
  assert.equal(manifest.short_name, "OffertaLogica Premium");
  assert.match(app, /apple-mobile-web-app-title" content="OffertaLogica Premium"/);
  assert.match(app, /<title>OffertaLogica Premium<\/title>/);
});

test("Manifest conserva identità tecnica e icone esistenti", () => {
  assert.equal(manifest.id, "/app.html");
  assert.equal(manifest.start_url, "/app.html");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(
    manifest.icons.map(icon => icon.src),
    [
      "/assets/app-icon-192.png?v=6",
      "/assets/app-icon-512.png?v=6",
      "/assets/app-icon-1024.png?v=6"
    ]
  );
});

test("Service worker conserva shell Premium e forza nuovo cache key", () => {
  assert.match(sw, /identity-name/);
  assert.match(sw, /"\/manifest\.webmanifest"/);
  assert.match(sw, /"\/app-install\.js"/);
  assert.match(sw, /"\/app-support\.js"/);
});

test("Nessuna regressione del titolo Premium browser", () => {
  assert.match(app, /<meta name="offertalogica-app-version" content="APP v0\.36\.29">/);
  assert.match(app, /<title>OffertaLogica Premium<\/title>/);
});
