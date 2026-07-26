import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

async function loadUploadHelpers(fetchImpl) {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf("var PDF_DIRECT_UPLOAD_THRESHOLD_BYTES");
  const end = html.indexOf("function aggiornaInterfacciaSelezionePdf", start);
  assert.ok(start >= 0 && end > start, "helper upload PDF non trovati");
  const source = `${html.slice(start, end)}\nthis.__analyze = analizzaPdfSelezionato;`;
  const context = vm.createContext({
    fetch: fetchImpl,
    FormData,
    File,
    Response,
    JSON,
    Number,
    Error,
  });
  vm.runInContext(source, context);
  return context.__analyze;
}

test("frontend: un PDF grande usa upload firmato e invia alla Function solo JSON leggero", async () => {
  const calls = [];
  const analyze = await loadUploadHelpers(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        ok: true,
        upload: {
          uploadUrl: "https://example.supabase.co/storage/v1/object/upload/sign/test?token=abc",
          uploadTicket: "ticket.test",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (calls.length === 2) return new Response(JSON.stringify({ Key: "test" }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, normalized: { recognized: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const file = new File([new Uint8Array(5_000_000)], "irina.pdf", { type: "application/pdf" });
  const payload = await analyze(file, { sessionId: "session-test" });
  assert.equal(payload.normalized.recognized, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "/api/analyze-pdf");
  assert.equal(JSON.parse(String(calls[0].init.body)).action, "create_upload");
  assert.match(calls[1].url, /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\//);
  assert.equal(calls[1].init.method, "PUT");
  assert.ok(calls[1].init.body instanceof FormData);
  assert.equal(calls[2].url, "/api/analyze-pdf");
  const analysisBody = JSON.parse(String(calls[2].init.body));
  assert.equal(analysisBody.action, "analyze_uploaded_pdf");
  assert.equal(analysisBody.uploadTicket, "ticket.test");
  assert.ok(String(calls[2].init.body).length < 1000);
});

test("frontend: un PDF piccolo conserva il percorso multipart esistente", async () => {
  const calls = [];
  const analyze = await loadUploadHelpers(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, normalized: { recognized: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const file = new File([new Uint8Array(1_000_000)], "piccolo.pdf", { type: "application/pdf" });
  await analyze(file, { sessionId: "session-test" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/analyze-pdf");
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal(calls[0].init.body.get("pdf").name, "piccolo.pdf");
});
