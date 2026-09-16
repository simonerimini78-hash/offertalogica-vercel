import crypto from "node:crypto";
import { json } from "../lib/http.js";

const VERSION = "0.12.23";
const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SEARCH_CONSOLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const MAX_ROWS = 100000;
const PAGE_SIZE = 25000;
const DB_BATCH_SIZE = 500;

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
  const safeDays = [7, 28, 90].includes(Number(days)) ? Number(days) : 28;
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (safeDays - 1));
  return { days: safeDays, startDate: dateOnlyUtc(start), endDate: dateOnlyUtc(end) };
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

async function statusPayload() {
  const latest = await serviceFetch(
    "editorial_research_snapshots?select=id,source,period_start,period_end,captured_at,row_count,notes&source=eq.search_console&order=captured_at.desc&limit=1",
  );
  return {
    ok: true,
    version: VERSION,
    configured: searchConsoleConfigured(),
    site: searchConsoleConfigured() ? searchConsoleConfig().siteUrl : null,
    latest: latest?.[0] || null,
  };
}

export default async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method || '')) {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, error: "Metodo non consentito" });
    }

    const user = await authenticatedAdmin(req);
    if (!user) return json(res, 401, { ok: false, error: "Accesso amministratore richiesto" });

    const action = String(req.query?.action || "");
    if (req.method === "GET" && action === "editorial-research-status") {
      return json(res, 200, await statusPayload());
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
