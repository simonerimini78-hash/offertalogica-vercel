import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
test("manifest release e header impediscono cache stale", async () => {
  const [manifestRaw, vercelRaw, app, staff] = await Promise.all([read("public/version.json"), read("vercel.json"), read("public/app.html"), read("public/staff.html")]);
  const manifest = JSON.parse(manifestRaw); const vercel = JSON.parse(vercelRaw);
  assert.equal(manifest.version, "0.36.24");
  assert.equal(manifest.cache, "offertalogica-premium-v03624");
  for (const source of ["/sw.js", "/version.json", "/app.html", "/staff.html"]) {
    const rule = vercel.headers.find(item => item.source === source);
    assert.ok(rule, `header mancante: ${source}`);
    assert.match(rule.headers.map(item => item.value).join(" "), /no-store/);
  }
  for (const source of [app, staff]) {
    assert.match(source, /CURRENT_RELEASE="0\.36\.24"/);
    assert.match(source, /version\.json\?t=/);
  }
  assert.match(app, /updateViaCache:'none'/);
  assert.doesNotMatch(staff, /navigator\.serviceWorker\.register/);
});
