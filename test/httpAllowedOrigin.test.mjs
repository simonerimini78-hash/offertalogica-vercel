import test from "node:test";
import assert from "node:assert/strict";
import { requireAllowedOrigin } from "../lib/http.js";

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = String(value); },
  };
}

function request(origin, host, extraHeaders = {}) {
  return { headers: { origin, host, ...extraHeaders } };
}

test("accetta richieste senza header Origin", () => {
  const res = responseRecorder();
  assert.equal(requireAllowedOrigin({ headers: {} }, res), true);
  assert.equal(res.statusCode, 200);
});

test("accetta il dominio di produzione configurato", () => {
  const res = responseRecorder();
  assert.equal(
    requireAllowedOrigin(request("https://offertalogica.it", "offertalogica.it"), res),
    true,
  );
});

test("accetta una Preview Vercel quando Origin e Host coincidono", () => {
  const preview = "offertalogica-vercel-git-lettore-pdf-plus-team.vercel.app";
  const res = responseRecorder();
  assert.equal(requireAllowedOrigin(request(`https://${preview}`, preview), res), true);
  assert.equal(res.statusCode, 200);
});

test("usa x-forwarded-host per riconoscere la Preview", () => {
  const preview = "offertalogica-vercel-abc123-team.vercel.app";
  const res = responseRecorder();
  assert.equal(
    requireAllowedOrigin(
      request(`https://${preview}`, "internal.vercel.app", { "x-forwarded-host": preview }),
      res,
    ),
    true,
  );
});

test("accetta VERCEL_URL anche quando non coincide con Host", () => {
  const previous = process.env.VERCEL_URL;
  process.env.VERCEL_URL = "offertalogica-vercel-preview.vercel.app";
  try {
    const res = responseRecorder();
    assert.equal(
      requireAllowedOrigin(
        request("https://offertalogica-vercel-preview.vercel.app", "internal.vercel.app"),
        res,
      ),
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = previous;
  }
});

test("accetta un'origine personalizzata configurata", () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://preview.example.test";
  try {
    const res = responseRecorder();
    assert.equal(
      requireAllowedOrigin(request("https://preview.example.test", "api.example.test"), res),
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous;
  }
});

test("rifiuta un dominio Vercel estraneo", () => {
  const res = responseRecorder();
  assert.equal(
    requireAllowedOrigin(
      request("https://progetto-estraneo.vercel.app", "offertalogica-vercel.vercel.app"),
      res,
    ),
    false,
  );
  assert.equal(res.statusCode, 403);
  assert.deepEqual(JSON.parse(res.body), {
    ok: false,
    error: "Origine richiesta non autorizzata",
  });
});

test("rifiuta un Origin non valido", () => {
  const res = responseRecorder();
  assert.equal(requireAllowedOrigin(request("non-un-url", "offertalogica.it"), res), false);
  assert.equal(res.statusCode, 403);
});
