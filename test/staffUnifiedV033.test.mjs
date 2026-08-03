import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireStaffSession } from "../lib/staffSessionAuth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFile(path.join(root, relative), "utf8");

function responseStub() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    end(value = "") { this.body = String(value); },
  };
}

test("v0.33 espone una sola area staff con tutti i moduli operativi", async () => {
  const [html, js] = await Promise.all([read("public/staff.html"), read("public/staff.js")]);
  assert.match(html, /Area staff OffertaLogica/);
  assert.match(html, /Accesso staff unico/);
  assert.match(html, /v0\.33/);
  for (const tab of ["overview", "leads", "checks", "customers", "analytics", "pdf", "costs"]) {
    assert.match(html, new RegExp(`data-staff-tab="${tab}"`));
    assert.match(html, new RegExp(`data-staff-view="${tab}"`));
  }
  assert.match(js, /offertalogica-premium-staff-auth/);
  assert.match(js, /premium_staff_members/);
  assert.match(js, /staff-leads/);
  assert.match(js, /staff-analytics/);
  assert.doesNotMatch(html, /Token staff|#token=|x-staff-token/i);
  assert.doesNotMatch(js, /STAFF_PREVIEW_TOKEN|x-staff-token|tokenFromHash/);
});

test("le vecchie pagine staff confluiscono nella pagina unica", async () => {
  const [leads, analytics, premium, pdf] = await Promise.all([
    read("public/staff-leads.html"),
    read("public/staff-analytics.html"),
    read("public/staff-premium.html"),
    read("public/staff-pdf.html"),
  ]);
  assert.match(leads, /staff\.html#leads/);
  assert.match(analytics, /staff\.html#analytics/);
  assert.match(premium, /staff\.html#checks/);
  assert.match(premium, /get\("embedded"\) === "1"/);
  assert.match(pdf, /staff\.html#pdf/);
  assert.match(pdf, /get\("embedded"\) === "1"/);
  assert.match(pdf, /Authorization:`Bearer \$\{accessToken\}`/);
  assert.doesNotMatch(pdf, /TOKEN_STAFF|x-staff-token|STAFF_PREVIEW_TOKEN/);
});

test("le API staff usano la sessione Supabase senza aggiungere funzioni Vercel", async () => {
  const [leads, analytics, pdfApi, helper] = await Promise.all([
    read("api/staff-leads.js"),
    read("api/staff-analytics.js"),
    read("api/staff-pdf-analyses.js"),
    read("lib/staffSessionAuth.js"),
  ]);
  for (const source of [leads, analytics, pdfApi]) {
    assert.match(source, /requireStaffSession/);
    assert.doesNotMatch(source, /STAFF_PREVIEW_TOKEN|requestToken\(|isAuthorized\(/);
  }
  assert.match(leads, /roles: \["admin"\]/);
  assert.match(pdfApi, /req\.method === "DELETE" \? \["admin"\]/);
  assert.match(pdfApi, /requireAllowedOrigin/);
  assert.match(helper, /verifyPremiumStaff/);

  const apiFiles = (await fs.readdir(path.join(root, "api"))).filter(name => name.endsWith(".js"));
  assert.equal(apiFiles.length, 12);
  assert.ok(!apiFiles.includes("health.js"));
});

test("l'autorizzatore accetta un admin Supabase e applica il vincolo di ruolo", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "service-secret";
  try {
    const fetchImpl = async url => {
      if (String(url).includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200 });
      }
      if (String(url).includes("premium_staff_members")) {
        return new Response(JSON.stringify([{ user_id: "11111111-1111-4111-8111-111111111111", role: "admin", active: true }]), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    };
    const req = { method: "GET", headers: { authorization: "Bearer customer-session" } };
    const acceptedRes = responseStub();
    const accepted = await requireStaffSession(req, acceptedRes, { roles: ["admin"], fetchImpl });
    assert.equal(accepted?.staff?.role, "admin");
    assert.equal(accepted?.authorizedBy, "supabase");

    const deniedRes = responseStub();
    const denied = await requireStaffSession(req, deniedRes, { roles: ["reviewer"], fetchImpl });
    assert.equal(denied, null);
    assert.equal(deniedRes.statusCode, 403);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousSecret;
  }
});
