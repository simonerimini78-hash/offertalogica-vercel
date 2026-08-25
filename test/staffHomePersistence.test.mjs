import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const indexPath = path.join(root, "public", "index.html");
const html = fs.readFileSync(indexPath, "utf8");

function bootstrapSource() {
  const anchor = "window.__OFFERTALOGICA_LANDING_REQUESTED__";
  const anchorAt = html.indexOf(anchor);
  assert.ok(anchorAt >= 0, "bootstrap landing non trovato");
  const open = html.lastIndexOf("<script>", anchorAt);
  const close = html.indexOf("</script>", anchorAt);
  assert.ok(open >= 0 && close > open, "script bootstrap non isolabile");
  return html.slice(open + "<script>".length, close);
}

function runBootstrap({ href = "https://offertalogica.it/", staffSession = false } = {}) {
  const url = new URL(href);
  const added = [];
  const storage = new Map(staffSession ? [["offertalogicaStaffMode", "true"]] : []);
  const window = {
    location: { search: url.search, hash: url.hash },
    __OFFERTALOGICA_LANDING_FORCE__: false,
  };
  const context = {
    window,
    URLSearchParams,
    sessionStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    },
    document: {
      documentElement: {
        classList: { add(value) { added.push(value); } },
      },
    },
  };
  vm.runInNewContext(bootstrapSource(), context);
  return { window, added };
}

test("Home staff: una sessione staff attiva impedisce alla landing pubblica di prendere il controllo", () => {
  const result = runBootstrap({ staffSession: true });
  assert.equal(result.window.__OFFERTALOGICA_LANDING_REQUESTED__, false);
  assert.equal(result.window.__OFFERTALOGICA_SOCIAL_ENTRY_REQUESTED__, false);
  assert.deepEqual(result.added, []);
});

test("Home pubblica normale: senza sessione staff la landing continua ad avviarsi", () => {
  const result = runBootstrap();
  assert.equal(result.window.__OFFERTALOGICA_LANDING_REQUESTED__, true);
  assert.equal(result.window.__OFFERTALOGICA_SOCIAL_ENTRY_REQUESTED__, true);
  assert.deepEqual(result.added, ["social-entry-requested"]);
});

test("Link staff protetto: il token nell'URL continua a bypassare la landing", () => {
  const result = runBootstrap({ href: "https://offertalogica.it/#staff=test-token" });
  assert.equal(result.window.__OFFERTALOGICA_LANDING_REQUESTED__, false);
  assert.deepEqual(result.added, []);
});

test("Pulsante Home staff mantiene il reload su / senza cancellare la sessione", () => {
  const match = html.match(/function apriHomeStaff\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, "funzione apriHomeStaff non trovata");
  const body = match[1];
  assert.match(body, /chiudiPannelloAnteprimeStaff\(\)/);
  assert.match(body, /window\.location\.assign\("\/"\)/);
  assert.doesNotMatch(body, /sessionStorage\.removeItem/);
});

test("Ripristino staff da sessione resta attivo dopo il reload della Home", () => {
  assert.match(html, /if \(sessionStorage\.getItem\(STAFF_MODE_STORAGE_KEY\) === "true"\)\s*\{\s*abilitaModalitaStaff\("session"\);\s*\}/);
  assert.match(html, /<button type="button" id="staff-preview-toggle"[^>]*>Anteprime<\/button>/);
});
