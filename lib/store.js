const memory = new Map();

const kvUrl =
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_KV_REST_API_URL;
const kvToken =
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
const hasKv = Boolean(kvUrl && kvToken);
const kvBaseUrl = String(kvUrl || "").replace(/\/+$/g, "");

const RATE_LIMIT_SCRIPT = `
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
if not limit or not ttl or limit <= 0 or ttl <= 0 then
  return redis.error_reply("invalid rate limit arguments")
end
if current >= limit then
  return {0, current}
end
current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ttl)
end
return {1, current}
`;

async function kv(command, ...args) {
  const url = `${kvUrl}/${command}/${args.map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${kvToken}` },
  });
  if (!response.ok) throw new Error(`KV error ${response.status}`);
  const payload = await response.json();
  return payload.result;
}

async function kvCommand(command) {
  if (!hasKv) throw new Error("KV non configurato");
  const response = await fetch(kvBaseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`KV error ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`KV error: ${String(payload.error).slice(0, 180)}`);
  return payload?.result;
}

export async function setJson(key, value, ttlSeconds) {
  const serialized = JSON.stringify(value);
  if (hasKv) {
    if (ttlSeconds) return kv("set", key, serialized, "EX", String(ttlSeconds));
    return kv("set", key, serialized);
  }
  memory.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
  return true;
}

export async function getJson(key) {
  if (hasKv) {
    const result = await kv("get", key);
    return result ? JSON.parse(result) : null;
  }
  const item = memory.get(key);
  if (!item) return null;
  if (item.expiresAt && item.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return item.value;
}

export async function del(key) {
  if (hasKv) return kv("del", key);
  memory.delete(key);
  return true;
}

export async function takeRateLimit(key, limit, ttlSeconds) {
  const safeKey = String(key || "").slice(0, 300);
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 0));
  const safeTtl = Math.max(1, Math.floor(Number(ttlSeconds) || 0));
  if (!safeKey) throw new Error("Rate limit key non valida");

  if (hasKv) {
    const result = await kvCommand([
      "EVAL",
      RATE_LIMIT_SCRIPT,
      "1",
      safeKey,
      String(safeLimit),
      String(safeTtl),
    ]);
    if (!Array.isArray(result) || result.length < 2) {
      throw new Error("KV rate limit response non valida");
    }
    const allowed = Number(result[0]) === 1;
    const count = Math.max(0, Number(result[1]) || 0);
    return { allowed, count, persistent: true };
  }

  const now = Date.now();
  const existing = memory.get(safeKey);
  if (existing?.expiresAt && existing.expiresAt <= now) memory.delete(safeKey);
  const active = memory.get(safeKey);
  const current = Math.max(0, Number(active?.value?.count ?? 0) || 0);
  if (current >= safeLimit) return { allowed: false, count: current, persistent: false };
  const count = current + 1;
  memory.set(safeKey, {
    value: { count },
    expiresAt: active?.expiresAt || (now + safeTtl * 1000),
  });
  return { allowed: true, count, persistent: false };
}

export function persistentStoreConfigured() {
  return hasKv;
}

export async function checkStore() {
  const key = `health:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const value = { ok: true, checkedAt: new Date().toISOString() };
  await setJson(key, value, 30);
  const stored = await getJson(key);
  await del(key);
  return Boolean(stored?.ok);
}
