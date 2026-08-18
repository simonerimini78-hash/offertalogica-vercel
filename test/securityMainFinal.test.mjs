import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function text(path) {
  return fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = String(value); },
    end(value = "") { this.body = String(value); },
  };
}

test("public API hardening is present in the consolidated main package", async () => {
  const [lead, sendOtp, verifyOtp, offerConsent, trackEvent, otp, store, rate, validation, pdfArchive] = await Promise.all([
    text("api/lead.js"),
    text("api/send-otp.js"),
    text("api/verify-otp.js"),
    text("api/offer-consent.js"),
    text("api/track-event.js"),
    text("lib/otp.js"),
    text("lib/store.js"),
    text("lib/rateLimit.js"),
    text("lib/validation.js"),
    text("lib/pdfArchive.js"),
  ]);

  assert.match(lead, /requireAllowedBrowserOrigin/);
  assert.match(lead, /sanitizeLeadCalculation/);
  assert.match(sendOtp, /send-otp-ip/);
  assert.match(sendOtp, /send-otp-lead/);
  assert.match(sendOtp, /send-otp-phone/);
  assert.match(sendOtp, /requireAllowedBrowserOrigin/);
  assert.match(verifyOtp, /requireAllowedBrowserOrigin/);
  assert.match(offerConsent, /loadOfferCatalog/);
  assert.match(offerConsent, /resolveCanonicalOffer/);
  assert.match(offerConsent, /requireAllowedBrowserOrigin/);
  assert.match(trackEvent, /ALLOWED_EVENT_TYPES/);
  assert.match(trackEvent, /VERIFIED_LEAD_EVENT_TYPES/);
  assert.doesNotMatch(otp, /dev-only-secret/);
  assert.match(otp, /Configurazione OTP non disponibile/);
  assert.match(store, /"EVAL"/);
  assert.match(store, /RATE_LIMIT_SCRIPT/);
  assert.match(rate, /persistentStoreConfigured/);
  assert.match(rate, /Servizio temporaneamente non disponibile/);
  assert.match(validation, /FORBIDDEN_JSON_KEYS/);
  assert.match(validation, /sanitizeLeadCalculation/);
  assert.match(pdfArchive, /PDF_UPLOAD_TICKET_SECRET/);
  assert.match(pdfArchive, /pdf_upload_ticket_secret_not_configured/);
});

test("legacy Staff data endpoints are closed on public main", async () => {
  const leadsModule = await import(`../api/staff-leads.js?test=${Date.now()}`);
  const analyticsModule = await import(`../api/staff-analytics.js?test=${Date.now()}`);

  for (const handler of [leadsModule.default, analyticsModule.default]) {
    const res = responseRecorder();
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: "Not found" });
  }

  const leads = await text("api/staff-leads.js");
  const analytics = await text("api/staff-analytics.js");
  assert.doesNotMatch(leads, /STAFF_PREVIEW_TOKEN|HEALTHCHECK_TOKEN/);
  assert.doesNotMatch(analytics, /STAFF_PREVIEW_TOKEN|HEALTHCHECK_TOKEN/);
});

test("legacy Staff PDF UI is closed while cleanup hook remains protected", async () => {
  const source = await text("api/staff-pdf-analyses.js");
  assert.doesNotMatch(source, /STAFF_PREVIEW_TOKEN|requireStaffToken/);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /action !== "cleanup"/);

  const pdfModule = await import(`../api/staff-pdf-analyses.js?test=${Date.now()}`);
  {
    const res = responseRecorder();
    await pdfModule.default({ method: "GET", headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 404);
  }
  {
    const res = responseRecorder();
    await pdfModule.default({ method: "GET", headers: {}, query: { action: "cleanup" } }, res);
    assert.equal(res.statusCode, 401);
  }

  for (const page of ["public/staff-leads.html", "public/staff-analytics.html", "public/staff-pdf.html"]) {
    const html = await text(page);
    assert.match(html, /vecchia area di amministrazione è stata disattivata/);
    assert.doesNotMatch(html, /STAFF_PREVIEW_TOKEN|HEALTHCHECK_TOKEN|\/api\/staff-/);
  }
});
