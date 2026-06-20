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

async function kv(command, ...args) {
  const url = `${kvUrl}/${command}/${args.map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${kvToken}` },
  });
  if (!response.ok) throw new Error(`KV error ${response.status}`);
  const payload = await response.json();
  return payload.result;
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
