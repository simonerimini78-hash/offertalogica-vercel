import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const checkoutSha = "11d5960a326750d5838078e36cf38b85af677262";
const setupPythonSha = "a26af69be951a213d495a4c3e4e4022e16d87065";

const updateWorkflow = fs.readFileSync(new URL("../.github/workflows/update-arera-menu.yml", import.meta.url), "utf8");
const diagnosticWorkflow = fs.readFileSync(new URL("../.github/workflows/diagnostica-arera.yml", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

function headersFor(source) {
  const block = vercel.headers.find(item => item.source === source);
  assert.ok(block, `header block missing: ${source}`);
  return Object.fromEntries(block.headers.map(item => [item.key, item.value]));
}

test("GitHub Actions are pinned to immutable commit SHAs", () => {
  assert.match(updateWorkflow, new RegExp(`actions/checkout@${checkoutSha}`));
  assert.match(updateWorkflow, new RegExp(`actions/setup-python@${setupPythonSha}`));
  assert.match(diagnosticWorkflow, new RegExp(`actions/setup-python@${setupPythonSha}`));
  assert.doesNotMatch(updateWorkflow, /uses:\s+[^\s]+@v\d+/);
  assert.doesNotMatch(diagnosticWorkflow, /uses:\s+[^\s]+@v\d+/);
});

test("blocking Staff CSP disables inline script attributes", () => {
  for (const route of ["/staff.html", "/staff-mfa.html", "/staff-premium.html", "/staff-pdf.html", "/staff-owner-lab.html", "/staff-analytics.html", "/staff-leads.html"]) {
    const csp = headersFor(route)["Content-Security-Policy"];
    assert.ok(csp, `${route} missing blocking CSP`);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /upgrade-insecure-requests/);
  }
});

test("Owner Lab no longer needs unsafe-inline scripts", () => {
  const csp = headersFor("/staff-owner-lab.html")["Content-Security-Policy"];
  const scriptDirective = csp.split(";").find(part => part.trim().startsWith("script-src ")) || "";
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/);
});

test("legacy Staff redirects allow only their exact inline script hashes", () => {
  for (const route of ["/staff-analytics.html", "/staff-leads.html"]) {
    const csp = headersFor(route)["Content-Security-Policy"];
    const scriptDirective = csp.split(";").find(part => part.trim().startsWith("script-src ")) || "";
    assert.match(scriptDirective, /'sha256-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(scriptDirective, /unsafe-inline|cdn\.jsdelivr/);
  }
});

test("all sensitive Staff HTML routes are no-store", () => {
  for (const route of ["/staff.html", "/staff-mfa.html", "/staff-activate.html", "/staff-premium.html", "/staff-pdf.html", "/staff-owner-lab.html", "/staff-analytics.html", "/staff-leads.html"]) {
    assert.equal(headersFor(route)["Cache-Control"], "no-store, max-age=0, must-revalidate");
  }
});

test("staff activation remains Report-Only until a real invite flow is tested", () => {
  const headers = headersFor("/staff-activate.html");
  assert.ok(headers["Content-Security-Policy-Report-Only"]);
  assert.equal(headers["Content-Security-Policy"], undefined);
});
