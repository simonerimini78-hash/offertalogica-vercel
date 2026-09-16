import crypto from "node:crypto";
import { json } from "../lib/http.js";

const VERSION = "0.12.24";
const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SEARCH_CONSOLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const MAX_ROWS = 100000;
const PAGE_SIZE = 25000;
const DB_BATCH_SIZE = 500;
const ANALYSIS_PAGE_SIZE = 1000;
const ANALYSIS_MAX_ROWS_PER_SNAPSHOT = 20000;
const ANALYSIS_WINDOWS = [7, 28, 90];

function env(name) {
  return String(process.env[name] || "").trim();
}

function bearerToken(req) {
  const auth = String(req.headers?.authorization || "");
  return auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
}

function supabaseConfig() {
  return {
    url: env("SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function searchConsoleConfig() {
  return {
    clientEmail: env("GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL"),
    privateKey: env("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    siteUrl: env("GOOGLE_SEARCH_CONSOLE_SITE_URL"),
  };
}

function searchConsoleConfigured() {
  const cfg = searchConsoleConfig();
  return Boolean(cfg.clientEmail && cfg.privateKey && cfg.siteUrl);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function serviceFetch(path, { method = "GET", body, prefer } = {}) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Supabase server non configurato");

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Supabase ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function authenticatedAdmin(req) {
  const token = bearerToken(req);
  if (!token) return null;

  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Supabase server non configurato");

  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!userResponse.ok) return null;

  const user = await userResponse.json().catch(() => null);
  if (!user?.id) return null;

  const rows = await serviceFetch(
    `editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
  );
  const member = rows?.[0];
  if (!member?.active || member.role !== "admin") return null;
  return user;
}

async function googleAccessToken() {
  const { clientEmail, privateKey } = searchConsoleConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope: SEARCH_CONSOLE_SCOPE,
    aud: SEARCH_CONSOLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(privateKey).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch(SEARCH_CONSOLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Autenticazione Google non riuscita");
  }
  return data.access_token;
}

function dateOnlyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function stablePeriod(days) {
  const safeDays = ANALYSIS_WINDOWS.includes(Number(days)) ? Number(days) : 28;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));
  return { days: safeDays, startDate: dateOnlyUtc(start), endDate: dateOnlyUtc(end) };
}

function snapshotDays(snapshot) {
  const start = Date.parse(`${snapshot?.period_start || ""}T00:00:00Z`);
  const end = Date.parse(`${snapshot?.period_end || ""}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86400000) + 1;
}

async function querySearchConsole({ startDate, endDate }) {
  const { siteUrl } = searchConsoleConfig();
  const accessToken = await googleAccessToken();
  const rows = [];
  let startRow = 0;
  let pages = 0;

  while (startRow < MAX_ROWS) {
    const response = await fetch(
      `${SEARCH_CONSOLE_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["date", "query", "page"],
          type: "web",
          dataState: "final",
          aggregationType: "auto",
          rowLimit: PAGE_SIZE,
          startRow,
        }),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error?.message || `Search Console ${response.status}`;
      throw new Error(message);
    }

    const batch = Array.isArray(data?.rows) ? data.rows : [];
    pages += 1;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    startRow += PAGE_SIZE;
  }

  return { rows: rows.slice(0, MAX_ROWS), pages };
}

async function insertRowsBatched(path, rows) {
  for (let index = 0; index < rows.length; index += DB_BATCH_SIZE) {
    await serviceFetch(path, {
      method: "POST",
      prefer: "return=minimal",
      body: rows.slice(index, index + DB_BATCH_SIZE),
    });
  }
}

async function collectSearchConsole(user, days) {
  if (!searchConsoleConfigured()) throw new Error("Search Console non configurata lato server");

  const period = stablePeriod(days);
  const { rows, pages } = await querySearchConsole(period);
  const normalized = rows
    .map((row) => {
      const keys = Array.isArray(row?.keys) ? row.keys : [];
      const [date, query, pageUrl] = keys;
      if (!date || !query) return null;
      return {
        query: String(query).slice(0, 1000),
        page_url: pageUrl ? String(pageUrl).slice(0, 2000) : null,
        clicks: Number.isFinite(Number(row.clicks)) ? Math.max(0, Math.trunc(Number(row.clicks))) : null,
        impressions: Number.isFinite(Number(row.impressions)) ? Math.max(0, Math.trunc(Number(row.impressions))) : null,
        ctr: Number.isFinite(Number(row.ctr)) ? Math.min(1, Math.max(0, Number(row.ctr))) : null,
        avg_position: Number.isFinite(Number(row.position)) ? Math.max(0, Number(row.position)) : null,
        observed_at: `${date}T12:00:00.000Z`,
        dimensions: { date, source: "search_console", search_type: "web" },
      };
    })
    .filter(Boolean);

  const { siteUrl } = searchConsoleConfig();
  const snapshotRows = await serviceFetch("editorial_research_snapshots", {
    method: "POST",
    prefer: "return=representation",
    body: {
      source: "search_console",
      period_start: period.startDate,
      period_end: period.endDate,
      granularity: "daily",
      row_count: normalized.length,
      raw_payload: {
        version: VERSION,
        site_url: siteUrl,
        data_state: "final",
        search_type: "web",
        dimensions: ["date", "query", "page"],
        pages_fetched: pages,
        row_limit: MAX_ROWS,
      },
      notes: `Search Console · acquisizione manuale ${period.days} giorni`,
      created_by: user.id,
    },
  });
  const snapshot = snapshotRows?.[0];
  if (!snapshot?.id) throw new Error("Snapshot Search Console non creato");

  try {
    if (normalized.length) {
      await insertRowsBatched(
        "editorial_research_queries",
        normalized.map((row) => ({ snapshot_id: snapshot.id, ...row })),
      );
    }
  } catch (error) {
    await serviceFetch(`editorial_research_snapshots?id=eq.${encodeURIComponent(snapshot.id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    }).catch(() => {});
    throw error;
  }

  return {
    snapshot_id: snapshot.id,
    source: "search_console",
    period_start: period.startDate,
    period_end: period.endDate,
    row_count: normalized.length,
    captured_at: snapshot.captured_at,
    days: period.days,
  };
}

async function searchConsoleSnapshots() {
  const rows = await serviceFetch(
    "editorial_research_snapshots?select=id,source,period_start,period_end,captured_at,row_count,notes&source=eq.search_console&order=captured_at.desc&limit=24",
  );
  return (rows || []).map((row) => ({ ...row, days: snapshotDays(row) }));
}

function latestWindowSnapshots(rows) {
  const found = new Map();
  for (const row of rows || []) {
    const days = Number(row?.days);
    if (ANALYSIS_WINDOWS.includes(days) && !found.has(days)) found.set(days, row);
  }
  return ANALYSIS_WINDOWS.map((days) => found.get(days)).filter(Boolean);
}

async function statusPayload() {
  const allSnapshots = await searchConsoleSnapshots();
  const snapshots = latestWindowSnapshots(allSnapshots);
  return {
    ok: true,
    version: VERSION,
    configured: searchConsoleConfigured(),
    site: searchConsoleConfigured() ? searchConsoleConfig().siteUrl : null,
    latest: allSnapshots?.[0] || null,
    snapshots,
    analysis_ready: ANALYSIS_WINDOWS.every((days) => snapshots.some((row) => row.days === days)),
  };
}

async function snapshotQueryRows(snapshotId) {
  const rows = [];
  let offset = 0;
  while (offset < ANALYSIS_MAX_ROWS_PER_SNAPSHOT) {
    const batch = await serviceFetch(
      `editorial_research_queries?select=query,page_url,clicks,impressions,avg_position,observed_at&snapshot_id=eq.${encodeURIComponent(snapshotId)}&order=id.asc&limit=${ANALYSIS_PAGE_SIZE}&offset=${offset}`,
    );
    const safeBatch = Array.isArray(batch) ? batch : [];
    rows.push(...safeBatch);
    if (safeBatch.length < ANALYSIS_PAGE_SIZE) break;
    offset += ANALYSIS_PAGE_SIZE;
  }
  return {
    rows: rows.slice(0, ANALYSIS_MAX_ROWS_PER_SNAPSHOT),
    truncated: rows.length >= ANALYSIS_MAX_ROWS_PER_SNAPSHOT,
  };
}

const TOPIC_STOPWORDS = new Set([
  "a","ad","ai","al","alla","alle","allo","agli","con","da","dal","dalla","dalle","dallo",
  "dei","del","della","delle","dello","di","e","ed","gli","i","il","in","la","le","lo",
  "nel","nella","nelle","nello","o","per","su","tra","fra","un","una","uno",
]);

function cleanToken(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function topicKeyForQuery(query) {
  const normalized = cleanToken(query);
  const tokens = normalized
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !TOPIC_STOPWORDS.has(token));
  const useful = [...new Set(tokens)];
  if (!useful.length) return normalized || "altro";
  return useful.sort((a, b) => a.localeCompare(b, "it")).join(" ");
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function aggregateSnapshot(rows) {
  const topics = new Map();
  for (const row of rows || []) {
    const key = topicKeyForQuery(row.query);
    if (!key) continue;
    let topic = topics.get(key);
    if (!topic) {
      topic = {
        key,
        display_query: String(row.query || key),
        display_impressions: -1,
        clicks: 0,
        impressions: 0,
        position_weighted: 0,
        position_weight: 0,
        queries: new Set(),
        pages: new Set(),
      };
      topics.set(key, topic);
    }

    const impressions = Math.max(0, numeric(row.impressions));
    const clicks = Math.max(0, numeric(row.clicks));
    const position = Math.max(0, numeric(row.avg_position));
    topic.clicks += clicks;
    topic.impressions += impressions;
    topic.queries.add(String(row.query || ""));
    if (row.page_url) topic.pages.add(String(row.page_url));

    if (impressions > topic.display_impressions) {
      topic.display_impressions = impressions;
      topic.display_query = String(row.query || key);
    }
    if (position > 0) {
      const weight = impressions > 0 ? impressions : 1;
      topic.position_weighted += position * weight;
      topic.position_weight += weight;
    }
  }

  return new Map([...topics.entries()].map(([key, topic]) => [key, {
    key,
    display_query: topic.display_query,
    clicks: Math.round(topic.clicks),
    impressions: Math.round(topic.impressions),
    ctr: topic.impressions > 0 ? topic.clicks / topic.impressions : 0,
    avg_position: topic.position_weight > 0 ? topic.position_weighted / topic.position_weight : null,
    query_count: topic.queries.size,
    page_count: topic.pages.size,
  }]));
}

function logRelative(value, maxValue) {
  if (value <= 0 || maxValue <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(maxValue));
}

function positionOpportunity(position) {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (position <= 3) return 0.15;
  if (position <= 10) return 0.4 + ((position - 3) / 7) * 0.6;
  if (position <= 20) return 1 - ((position - 10) / 10) * 0.5;
  if (position <= 40) return Math.max(0, 0.5 - ((position - 20) / 20) * 0.5);
  return 0;
}

function momentumScore(seven, twentyEight) {
  if (!seven || !twentyEight || twentyEight.impressions <= 0) return { score: 0, ratio: null };
  const recentDaily = seven.impressions / 7;
  const baselineDaily = twentyEight.impressions / 28;
  if (baselineDaily <= 0) return { score: 0, ratio: null };
  const ratio = recentDaily / baselineDaily;
  return {
    ratio,
    score: Math.max(0, Math.min(1, (ratio - 0.5) / 1.5)),
  };
}

function roundMetric(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function analysisPayload() {
  const allSnapshots = await searchConsoleSnapshots();
  const snapshots = latestWindowSnapshots(allSnapshots);
  const missing = ANALYSIS_WINDOWS.filter((days) => !snapshots.some((row) => row.days === days));
  if (missing.length) {
    return {
      ok: true,
      version: VERSION,
      ready: false,
      missing,
      snapshots,
      signals: [],
    };
  }

  const byDays = new Map();
  let truncated = false;
  for (const snapshot of snapshots) {
    const result = await snapshotQueryRows(snapshot.id);
    byDays.set(snapshot.days, aggregateSnapshot(result.rows));
    truncated = truncated || result.truncated;
  }

  const sevenMap = byDays.get(7) || new Map();
  const twentyEightMap = byDays.get(28) || new Map();
  const ninetyMap = byDays.get(90) || new Map();
  const keys = new Set([...sevenMap.keys(), ...twentyEightMap.keys(), ...ninetyMap.keys()]);

  let maxImpressions = 0;
  let maxClicks = 0;
  for (const key of keys) {
    const basis = ninetyMap.get(key) || twentyEightMap.get(key) || sevenMap.get(key);
    maxImpressions = Math.max(maxImpressions, basis?.impressions || 0);
    maxClicks = Math.max(maxClicks, basis?.clicks || 0);
  }

  const signals = [];
  for (const key of keys) {
    const seven = sevenMap.get(key) || null;
    const twentyEight = twentyEightMap.get(key) || null;
    const ninety = ninetyMap.get(key) || null;
    const basis = ninety || twentyEight || seven;
    if (!basis || basis.impressions <= 0) continue;

    const momentum = momentumScore(seven, twentyEight);
    const demand = logRelative(basis.impressions, maxImpressions);
    const engagement = logRelative(basis.clicks, maxClicks);
    const position = positionOpportunity(basis.avg_position);
    const score = Math.round(
      Math.min(100, Math.max(0, 40 * demand + 25 * momentum.score + 20 * position + 15 * engagement)),
    );

    signals.push({
      topic_key: key,
      topic: basis.display_query,
      score,
      query_count: Math.max(seven?.query_count || 0, twentyEight?.query_count || 0, ninety?.query_count || 0),
      page_count: Math.max(seven?.page_count || 0, twentyEight?.page_count || 0, ninety?.page_count || 0),
      momentum_ratio: roundMetric(momentum.ratio, 3),
      metrics: {
        "7": seven ? {
          clicks: seven.clicks,
          impressions: seven.impressions,
          ctr: roundMetric(seven.ctr, 4),
          avg_position: roundMetric(seven.avg_position, 2),
        } : null,
        "28": twentyEight ? {
          clicks: twentyEight.clicks,
          impressions: twentyEight.impressions,
          ctr: roundMetric(twentyEight.ctr, 4),
          avg_position: roundMetric(twentyEight.avg_position, 2),
        } : null,
        "90": ninety ? {
          clicks: ninety.clicks,
          impressions: ninety.impressions,
          ctr: roundMetric(ninety.ctr, 4),
          avg_position: roundMetric(ninety.avg_position, 2),
        } : null,
      },
    });
  }

  signals.sort((a, b) => b.score - a.score || (b.metrics["90"]?.impressions || 0) - (a.metrics["90"]?.impressions || 0));

  return {
    ok: true,
    version: VERSION,
    ready: true,
    snapshots,
    truncated,
    methodology: {
      demand_weight: 40,
      momentum_weight: 25,
      position_weight: 20,
      engagement_weight: 15,
      grouping: "cluster lessicale deterministico delle query Search Console",
      writes_database: false,
    },
    signals: signals.slice(0, 20),
  };
}

export default async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method || "")) {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, error: "Metodo non consentito" });
    }

    const user = await authenticatedAdmin(req);
    if (!user) return json(res, 401, { ok: false, error: "Accesso amministratore richiesto" });

    const action = String(req.query?.action || "");
    if (req.method === "GET" && action === "editorial-research-status") {
      return json(res, 200, await statusPayload());
    }

    if (req.method === "GET" && action === "editorial-research-analysis") {
      return json(res, 200, await analysisPayload());
    }

    if (req.method === "POST" && action === "collect-search-console") {
      const result = await collectSearchConsole(user, req.body?.days);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    return json(res, 404, { ok: false, error: "Azione non trovata" });
  } catch (error) {
    console.error("editorial_research_api_failed", error);
    return json(res, 500, { ok: false, error: error?.message || "Errore interno" });
  }
}
