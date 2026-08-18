import test from "node:test";
import assert from "node:assert/strict";

function clearKvEnv() {
  for (const name of [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "UPSTASH_REDIS_KV_REST_API_URL",
    "UPSTASH_REDIS_KV_REST_API_TOKEN",
  ]) delete process.env[name];
}

test("persistent rate limit uses one EVAL command per request and caps concurrent requests", async () => {
  clearKvEnv();
  process.env.UPSTASH_REDIS_KV_REST_API_URL = "https://example.upstash.test";
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN = "test-token";

  const counters = new Map();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls += 1;
    assert.equal(String(url), "https://example.upstash.test");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-token");
    const command = JSON.parse(String(init.body || "[]"));
    assert.equal(command[0], "EVAL");
    assert.match(command[1], /redis\.call\("GET"/);
    assert.match(command[1], /redis\.call\("INCR"/);
    assert.match(command[1], /redis\.call\("EXPIRE"/);
    assert.equal(command[2], "1");
    const key = command[3];
    const limit = Number(command[4]);
    const current = counters.get(key) || 0;
    const allowed = current < limit;
    const next = allowed ? current + 1 : current;
    counters.set(key, next);
    return new Response(JSON.stringify({ result: [allowed ? 1 : 0, next] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const store = await import(`../lib/store.js?persistent=${Date.now()}`);
    assert.equal(store.persistentStoreConfigured(), true);
    const results = await Promise.all(
      Array.from({ length: 100 }, () => store.takeRateLimit("rate:test:key", 10, 120)),
    );
    assert.equal(results.filter(item => item.allowed).length, 10);
    assert.equal(results.filter(item => !item.allowed).length, 90);
    assert.equal(calls, 100);
    assert.equal(Math.max(...results.map(item => item.count)), 10);
  } finally {
    globalThis.fetch = originalFetch;
    clearKvEnv();
  }
});

test("local memory fallback also never exceeds the configured limit", async () => {
  clearKvEnv();
  const store = await import(`../lib/store.js?memory=${Date.now()}`);
  assert.equal(store.persistentStoreConfigured(), false);
  const results = await Promise.all(
    Array.from({ length: 40 }, () => store.takeRateLimit("rate:memory:key", 7, 60)),
  );
  assert.equal(results.filter(item => item.allowed).length, 7);
  assert.equal(results.filter(item => !item.allowed).length, 33);
  assert.equal(Math.max(...results.map(item => item.count)), 7);
});

test("Vercel fails closed when persistent Redis is not configured", async () => {
  clearKvEnv();
  process.env.VERCEL = "1";
  process.env.NODE_ENV = "test";
  const rate = await import(`../lib/rateLimit.js?failclosed=${Date.now()}`);
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader(name, value) { headers[name] = String(value); },
    end(value = "") { this.body = value ? JSON.parse(String(value)) : null; },
  };
  const allowed = await rate.enforceRateLimit({ headers: { "x-forwarded-for": "203.0.113.5" } }, res, {
    label: "test-fail-closed",
    limit: 3,
    windowSeconds: 60,
  });
  assert.equal(allowed, false);
  assert.equal(res.statusCode, 503);
  assert.equal(headers["Retry-After"], "30");
  assert.deepEqual(res.body, { ok: false, error: "Servizio temporaneamente non disponibile" });
  delete process.env.VERCEL;
});
