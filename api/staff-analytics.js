import crypto from "node:crypto";
import { json } from "../lib/http.js";
import { recordEditorialArticleAiEconomicEvent, recordEditorialImageAiEconomicEvent, recordEditorialSupportAiEconomicEvent } from "../lib/editorialAiEconomics.js";

const VERSION = "0.12.88";
const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SEARCH_CONSOLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const MAX_ROWS = 100000;
const PAGE_SIZE = 25000;
const DB_BATCH_SIZE = 500;
const ANALYSIS_PAGE_SIZE = 1000;
const ANALYSIS_MAX_ROWS_PER_SNAPSHOT = 20000;
const ANALYSIS_SIGNAL_LIMIT = 100;
const ANALYSIS_WINDOWS = [7, 28, 90];
const EDITORIAL_RESEARCH_RADAR_SCHEMA_VERSION = 2;
const EDITORIAL_RESEARCH_RADAR_DAYS = new Set([1, 6, 7]); // lunedi, sabato, domenica
const EDITORIAL_RESEARCH_RADAR_START_MINUTE = 8 * 60;
const EDITORIAL_RESEARCH_RADAR_MAX_CANDIDATES = 8;
const EDITORIAL_RESEARCH_RADAR_LOOKBACK_DAYS = 6;
const EDITORIAL_RESEARCH_RADAR_MAX_ATTEMPTS_PER_DAY = 2;
const OPPORTUNITY_STATUSES = new Set(["pending", "selected", "deferred", "rejected"]);
const OPPORTUNITY_TYPES = new Set(["new_article", "social_only", "monitor"]);
const OPPORTUNITY_LIST_LIMIT = 50;
const TARGET_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const UPDATE_PROPOSAL_DECISIONS = new Set(["approved", "rejected"]);
const UPDATE_TEXT_DECISIONS = new Set(["approved", "rejected"]);
const UPDATE_PREVIEW_DECISIONS = new Set(["confirmed", "cancelled"]);
const MANUAL_IDEA_PRIORITIES = new Set(["normal", "high", "urgent"]);
const MANUAL_IDEA_TYPES = new Set(["new_article"]);
const MANUAL_IDEA_PRIORITY_RANK = { normal: 100, high: 300, urgent: 400 };
const EDITORIAL_AI_DEFAULT_MODEL = "gpt-5.6-terra";
const EDITORIAL_AI_HTTP_TIMEOUT_MS = 45000;
const EDITORIAL_IMAGE_GENERATION_TIMEOUT_MS = 240000;
const EDITORIAL_PAGE_FETCH_TIMEOUT_MS = 20000;
const EDITORIAL_PLAN_POST_TYPES = new Set(["article_followup", "related", "evergreen", "service", "data"]);
const EDITORIAL_PLAN_EDITABLE_STATUSES = new Set(["draft", "approved", "cancelled"]);
const EDITORIAL_SOCIAL_PLATFORMS = new Set(["facebook", "instagram", "linkedin"]);
const EDITORIAL_PLAN_SOCIAL_PLATFORMS = new Set(["facebook", "instagram"]);
const EDITORIAL_SOCIAL_RUNTIME_VERSIONS = Object.freeze({ facebook: "0.12.87", instagram: "0.12.87", linkedin: "0.12.87" });
const EDITORIAL_SOCIAL_CONTENT_VERSION = "social_content_v3";
// Il renderer grafico delle card social e' caricato solo quando serve.
// Dalla v0.12.70 usa resvg WebAssembly: nessun Pango/Fontconfig/libvips e nessun addon nativo
// nel percorso di composizione della card. Il JPEG finale e' codificato in puro JavaScript.
const EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION = "offertalogica_informa_card_v2";
let editorialSocialCardRendererPromise = null;

async function editorialSocialCardRenderer() {
  if (!editorialSocialCardRendererPromise) {
    editorialSocialCardRendererPromise = import("../lib/editorial-social-card.js")
      .then((module) => {
        if (module?.EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION !== EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION) {
          throw new Error("Cover social: versione template renderer non allineata");
        }
        if (typeof module?.renderEditorialSocialCard !== "function") {
          throw new Error("Cover social: renderer non disponibile");
        }
        return module.renderEditorialSocialCard;
      })
      .catch((error) => {
        editorialSocialCardRendererPromise = null;
        throw error;
      });
  }
  return editorialSocialCardRendererPromise;
}

const EDITORIAL_IMAGE_DEFAULT_MODEL = "gpt-image-2";
const EDITORIAL_IMAGE_BUCKET = "editorial-images";
const EDITORIAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const EDITORIAL_IMAGE_ARTICLE_STATUSES = new Set(["draft", "in_review", "changes_requested", "approved", "published"]);
const EDITORIAL_IMAGE_QA_MAX_REGENERATIONS = 2;
const EDITORIAL_SOCIAL_IMAGE_QA_MAX_ATTEMPTS = 2;
const EDITORIAL_SOCIAL_IMAGE_SIZE = "1024x1024";
const EDITORIAL_IMAGE_SOURCE_POLICY = "generated_from_scratch_no_web_source";
const EDITORIAL_PAGE_UPDATE_ACTIONS = new Set([
  "prepare-editorial-update",
  "review-editorial-update",
  "prepare-editorial-update-text",
  "review-editorial-update-text",
  "prepare-editorial-update-preview",
  "review-editorial-update-preview",
  "complete-editorial-update",
  "check-editorial-update-impact",
]);

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

async function editorialUserFetch(user, path, { method = "GET", body, prefer } = {}) {
  const { url, serviceKey } = supabaseConfig();
  const accessToken = String(user?._editorialAccessToken || "").trim();
  if (!url || !serviceKey) throw new Error("Supabase server non configurato");
  if (!accessToken) throw new Error("Sessione editoriale autenticata non disponibile");

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${accessToken}`,
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

async function editorialArticleCreate(user, body) {
  if (user?._automation) {
    const payload = await serviceFetch("rpc/editorial_autopilot_create_draft", {
      method: "POST",
      body: {
        p_actor_user_id: user.id,
        p_title: body.title,
        p_slug: body.slug,
        p_category: body.category || null,
      },
    });
    if (!payload?.id) throw new Error("RPC Autopilota: bozza non creata");
    return payload;
  }
  const rows = await editorialUserFetch(user, "editorial_articles?select=*", {
    method: "POST", prefer: "return=representation", body,
  });
  return rows?.[0] || null;
}

async function editorialArticleUpdateDraft(user, articleId, body) {
  if (user?._automation) {
    const payload = await serviceFetch("rpc/editorial_autopilot_update_draft", {
      method: "POST",
      body: {
        p_actor_user_id: user.id,
        p_article_id: articleId,
        p_title: body.title ?? null,
        p_category: body.category ?? null,
        p_excerpt: body.excerpt ?? null,
        p_content: body.content ?? null,
        p_sources: body.sources ?? null,
        p_seo_title: body.seo_title ?? null,
        p_seo_description: body.seo_description ?? null,
      },
    });
    if (!payload?.id) throw new Error("RPC Autopilota: bozza non aggiornata");
    return payload;
  }
  const rows = await editorialUserFetch(user, `editorial_articles?id=eq.${encodeURIComponent(articleId)}&select=*`, {
    method: "PATCH", prefer: "return=representation", body,
  });
  return rows?.[0] || null;
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
  Object.defineProperty(user, "_editorialAccessToken", { value: token, enumerable: false, configurable: false });
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
        query_impressions: new Map(),
        pages: new Set(),
        page_impressions: new Map(),
      };
      topics.set(key, topic);
    }

    const impressions = Math.max(0, numeric(row.impressions));
    const clicks = Math.max(0, numeric(row.clicks));
    const position = Math.max(0, numeric(row.avg_position));
    topic.clicks += clicks;
    topic.impressions += impressions;
    const queryText = String(row.query || "");
    topic.queries.add(queryText);
    topic.query_impressions.set(queryText, (topic.query_impressions.get(queryText) || 0) + impressions);
    if (row.page_url) {
      const pageUrl = String(row.page_url);
      topic.pages.add(pageUrl);
      topic.page_impressions.set(pageUrl, (topic.page_impressions.get(pageUrl) || 0) + impressions);
    }

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
    query_examples: [...topic.query_impressions.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "it"))
      .slice(0, 5)
      .map(([query]) => query),
    page_count: topic.pages.size,
    page_urls: [...topic.page_impressions.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([url]) => url),
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


function opportunitySelect() {
  return "id,snapshot_id,topic,category,opportunity_type,score,rationale,evidence,status,target_article_id,decided_by,decided_at,created_at,updated_at";
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function validCommitRef(value) {
  return /^[0-9a-f]{7,64}$/i.test(String(value || "").trim());
}

function metricDelta(current, baseline) {
  if (!current || !baseline) return null;
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const cImpressions = numberOrNull(current.impressions);
  const bImpressions = numberOrNull(baseline.impressions);
  const cClicks = numberOrNull(current.clicks);
  const bClicks = numberOrNull(baseline.clicks);
  const cPosition = numberOrNull(current.avg_position);
  const bPosition = numberOrNull(baseline.avg_position);
  return {
    impressions: cImpressions === null || bImpressions === null ? null : cImpressions - bImpressions,
    clicks: cClicks === null || bClicks === null ? null : cClicks - bClicks,
    avg_position: cPosition === null || bPosition === null ? null : roundMetric(cPosition - bPosition, 2),
  };
}

function snapshotFullyAfter(snapshot, isoDate) {
  const appliedDate = String(isoDate || "").slice(0, 10);
  const periodStart = String(snapshot?.period_start || "");
  return Boolean(appliedDate && periodStart && periodStart > appliedDate);
}

function cleanManualIdeaText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeManualIdeaTopic(value) {
  return cleanManualIdeaText(value, 240).toLocaleLowerCase("it-IT");
}

function validManualIdeaDeadline(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Scadenza idea non valida");
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new Error("Scadenza idea non valida");
  }
  return date;
}

function manualIdeaMeta(opportunity) {
  const evidence = opportunity?.evidence;
  const manual = evidence && typeof evidence === "object" ? evidence.manual_idea : null;
  if (evidence?.source !== "manual_idea" || !manual || typeof manual !== "object") return null;
  return manual;
}

function manualIdeaRationale(priority, deadline) {
  const priorityLabel = ({ urgent: "urgente", high: "alta", normal: "normale" })[priority] || "normale";
  return `Idea editoriale inserita manualmente dalla Redazione. Priorità ${priorityLabel}${deadline ? `; scadenza ${deadline}` : ""}. La priorità manuale è distinta dai punteggi automatici di Search Console e Radar web.`;
}

function opportunityEditorialBrief(opportunity, signal = null) {
  const topic = cleanEditorialText(opportunity?.topic, 240) || "tema editoriale";
  const evidence = opportunity?.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const manual = manualIdeaMeta(opportunity);
  const queryExamples = [...new Set([
    ...(Array.isArray(evidence.query_examples) ? evidence.query_examples : []),
    ...(Array.isArray(signal?.query_examples) ? signal.query_examples : []),
  ].map((value) => cleanEditorialText(value, 220)).filter(Boolean))].slice(0, 5);
  const contextPages = [...new Set([
    ...(Array.isArray(evidence.page_urls) ? evidence.page_urls : []),
    ...(Array.isArray(signal?.page_urls) ? signal.page_urls : []),
  ].map((value) => normalizedHttps(value)).filter(Boolean))].slice(0, 5);

  if (manual) {
    const notes = cleanEditorialText(manual.notes, 900);
    return {
      source: "manual_idea",
      search_intent: "Idea inserita manualmente dalla Redazione.",
      article_angle: notes
        ? `Seguire il taglio indicato dalla Redazione: ${notes}`
        : `Sviluppare un nuovo articolo informativo su «${topic}», chiarendo il contesto, gli aspetti pratici da verificare e le alternative pertinenti con fonti aggiornate.`,
      query_examples: queryExamples,
      context_pages: contextPages,
    };
  }

  if (evidence.source === "research_radar") {
    const radar = evidence.research_radar && typeof evidence.research_radar === "object" ? evidence.research_radar : {};
    const searchIntent = cleanEditorialText(radar.search_intent, 700) || `Interesse emergente verificato sul web per «${topic}».`;
    const angle = cleanEditorialText(radar.angle, 1200) || `Sviluppare un articolo originale su «${topic}» verificando i fatti aggiornabili e distinguendolo dai contenuti OffertaLogica gia pubblicati.`;
    const difference = cleanEditorialText(radar.difference_from_existing, 900);
    const existingTitle = cleanEditorialText(radar.existing_article?.title, 180);
    const toolLabels = (Array.isArray(radar.related_targets) ? radar.related_targets : [])
      .map((row) => cleanEditorialText(row?.label, 180))
      .filter(Boolean)
      .slice(0, 4);
    return {
      source: "research_radar",
      search_intent: searchIntent,
      article_angle: [
        angle,
        radar.editorial_action === "NEW_ANGLE" && existingTitle
          ? `Esiste gia l’articolo «${existingTitle}»: il nuovo contenuto deve rispondere a un intento diverso e non ripeterne struttura o risposta.`
          : "",
        difference ? `Differenza editoriale obbligatoria: ${difference}` : "",
        toolLabels.length ? `Se pertinente e solo dopo avere risposto al problema del lettore, collega naturalmente gli strumenti OffertaLogica: ${toolLabels.join(" · ")}.` : "",
      ].filter(Boolean).join(" "),
      query_examples: queryExamples,
      context_pages: contextPages,
    };
  }

  const normalizedTopic = cleanToken(topic);
  const commercialIntent = /\b(offerta|offerte|tariffa|tariffe|prezzo|prezzi|costo|costi|fornitore|fornitori|luce|gas|energia|energy|direct|contratto|contratti|mercato)\b/.test(normalizedTopic);
  const questionIntent = /\b(come|quanto|perche|cosa|cos|conviene|convenienza|funziona|funzionamento|significa|leggere|calcolare|scegliere)\b/.test(normalizedTopic);
  let articleAngle;
  if (commercialIntent) {
    articleAngle = `Spiegare che cos’è o a cosa si riferisce «${topic}», come funziona secondo fonti aggiornate, quali condizioni, costi o vincoli verificare e come confrontarlo con alternative pertinenti senza trasformare l’articolo in pubblicità.`;
  } else if (questionIntent) {
    articleAngle = `Rispondere direttamente all’intento di ricerca «${topic}» con una guida concreta: risposta iniziale chiara, passaggi o criteri utili, limiti da conoscere e fonti aggiornate per i dati che possono cambiare.`;
  } else {
    articleAngle = `Trasformare la ricerca «${topic}» in un articolo utile e comprensibile: spiegare il contesto, gli aspetti pratici rilevanti, cosa controllare, limiti ed eventuali alternative, verificando sul web i fatti aggiornabili.`;
  }

  return {
    source: "search_console",
    search_intent: queryExamples.length
      ? `Gli utenti stanno cercando questo tema anche con query come: ${queryExamples.slice(0, 3).join(" · ")}.`
      : `Gli utenti stanno mostrando interesse di ricerca per «${topic}».`,
    article_angle: articleAngle,
    query_examples: queryExamples,
    context_pages: contextPages,
  };
}


function researchRadarCandidateSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        minItems: 1,
        maxItems: EDITORIAL_RESEARCH_RADAR_MAX_CANDIDATES,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "topic", "search_intent", "angle", "query_examples", "demand_score", "trend_score",
            "freshness_score", "content_gap_score", "user_utility_score", "offertalogica_fit_score",
            "authority_score", "editorial_action", "existing_article_id", "difference_from_existing",
            "related_target_ids", "rationale", "source_urls"
          ],
          properties: {
            topic: { type: "string" },
            search_intent: { type: "string" },
            angle: { type: "string" },
            query_examples: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
            demand_score: { type: "integer", minimum: 0, maximum: 100 },
            trend_score: { type: "integer", minimum: 0, maximum: 100 },
            freshness_score: { type: "integer", minimum: 0, maximum: 100 },
            content_gap_score: { type: "integer", minimum: 0, maximum: 100 },
            user_utility_score: { type: "integer", minimum: 0, maximum: 100 },
            offertalogica_fit_score: { type: "integer", minimum: 0, maximum: 100 },
            authority_score: { type: "integer", minimum: 0, maximum: 100 },
            editorial_action: { type: "string", enum: ["NEW_ARTICLE", "NEW_ANGLE", "UPDATE_EXISTING", "SKIP_DUPLICATE"] },
            existing_article_id: { type: ["string", "null"] },
            difference_from_existing: { type: "string" },
            related_target_ids: { type: "array", maxItems: 4, items: { type: "string" } },
            rationale: { type: "string" },
            source_urls: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
          },
        },
      },
    },
  };
}

function researchRadarClampScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function researchRadarTokens(value) {
  return new Set(cleanToken(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !TOPIC_STOPWORDS.has(token)));
}

function researchRadarSimilarity(left, right) {
  const a = researchRadarTokens(left);
  const b = researchRadarTokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function researchRadarKey(candidate) {
  const seed = `${cleanToken(candidate?.topic)}|${cleanToken(candidate?.search_intent)}|${cleanToken(candidate?.angle)}`;
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

async function researchRadarArchive() {
  const rows = await serviceFetch(
    "editorial_articles?select=id,title,slug,status,published_at,excerpt&status=eq.published&order=published_at.desc&limit=120",
  ).catch(() => []);
  return (rows || []).filter((row) => validUuid(String(row?.id || ""))).map((row) => ({
    id: row.id,
    title: cleanEditorialText(row.title, 180),
    slug: cleanEditorialText(row.slug, 160),
    published_at: row.published_at || null,
    excerpt: cleanEditorialText(row.excerpt, 420),
  }));
}

async function researchRadarTargets() {
  const rows = await enabledPromotionTargets().catch(() => []);
  return (rows || []).slice(0, 30).map((row) => ({
    id: String(row.id || ""),
    label: cleanEditorialText(row.label, 180),
    url_path: cleanEditorialText(row.url_path, 500),
    category: cleanEditorialText(row.category, 100) || null,
  })).filter((row) => validUuid(row.id) && row.label);
}

async function researchRadarSearchSignals() {
  const analysis = await analysisPayload().catch(() => null);
  if (!analysis?.ready) return [];
  return (analysis.signals || []).slice(0, 20).map((signal) => ({
    topic: cleanEditorialText(signal.topic, 220),
    score: Number(signal.score || 0),
    momentum_ratio: signal.momentum_ratio ?? null,
    query_examples: (signal.query_examples || []).slice(0, 5),
    metrics_7: signal.metrics?.["7"] || null,
    metrics_28: signal.metrics?.["28"] || null,
  }));
}

function researchRadarDateCutoff(days = EDITORIAL_RESEARCH_RADAR_LOOKBACK_DAYS) {
  return new Date(Date.now() - Math.max(1, Number(days) || 1) * 86400000).toISOString();
}

async function researchRadarRuns(limit = 30) {
  const cutoff = encodeURIComponent(researchRadarDateCutoff());
  const rows = await serviceFetch(
    `editorial_automation_runs?select=id,run_type,status,started_at,finished_at,details,last_error,created_at&run_type=eq.research_radar&created_at=gte.${cutoff}&order=created_at.desc&limit=${Math.max(1, Math.min(60, Number(limit) || 30))}`,
  ).catch(() => []);
  return rows || [];
}

function researchRadarPreviousCandidates(runs) {
  const values = [];
  for (const run of runs || []) {
    if (String(run?.status || "") !== "success") continue;
    for (const candidate of Array.isArray(run?.details?.radar_candidates) ? run.details.radar_candidates : []) {
      values.push({
        topic: cleanEditorialText(candidate?.topic, 220),
        search_intent: cleanEditorialText(candidate?.search_intent, 420),
        editorial_action: cleanEditorialText(candidate?.editorial_action, 40),
        score: Number(candidate?.score || 0),
      });
      if (values.length >= 20) return values;
    }
  }
  return values;
}

async function startOpenAiResearchRadar({ localDate, archive, targets, searchSignals, previousCandidates }) {
  const input = JSON.stringify({
    local_date: localDate,
    country: "Italia",
    search_console_top_signals: searchSignals,
    published_offertalogica_articles: archive,
    offertalogica_tools_and_destinations: targets,
    previous_weekend_radar_candidates: previousCandidates,
  });
  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      tools: [{ type: "web_search", search_context_size: "high" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      instructions: [
        "Sei il radar editoriale di OffertaLogica.it per il mercato energia italiano.",
        "Fai una ricerca web reale e aggiornata prima di proporre i temi. Cerca cosa sta emergendo negli ultimi giorni: domande degli utenti, variazioni di prezzo, bollette, mercato libero e vulnerabilita, offerte, PUN/PSV, regolazione, ARERA, GSE, MASE, Acquirente Unico, Terna, efficienza, pompe di calore e fotovoltaico quando pertinenti.",
        "Privilegia fonti primarie e istituzionali per i fatti. Usa fonti secondarie affidabili per capire quali domande o temi stanno circolando. Se Google Trends o altre evidenze di domanda sono accessibili, usale; non inventare volumi di ricerca e non trasformare il demand_score in un numero di ricerche mensili.",
        "Search Console e' un segnale quantitativo forte ma non deve creare un circuito chiuso: trova anche temi nuovi sui quali OffertaLogica non ha ancora impressioni.",
        "Confronta ogni proposta con l'archivio articoli fornito. Se lo stesso intento e' gia coperto e non ci sono novita sostanziali usa SKIP_DUPLICATE. Se fatti, prezzi o regole rendono vecchio un articolo esistente usa UPDATE_EXISTING. Usa NEW_ANGLE solo quando l'intento del lettore e' realmente diverso e spiega precisamente la differenza. Usa NEW_ARTICLE per un bisogno nuovo non coperto.",
        "Gli strumenti OffertaLogica non devono guidare artificialmente la scelta. Prima identifica un problema reale dell'utente; poi indica eventuali destinazioni OffertaLogica che permettono un passo pratico successivo. Non trasformare l'articolo in pubblicita.",
        "Attribuisci punteggi 0-100 separati: demand_score=forza della domanda osservabile, trend_score=crescita/accelerazione recente, freshness_score=novita e attualita, content_gap_score=buco nell'archivio OffertaLogica, user_utility_score=utilita concreta, offertalogica_fit_score=collegamento naturale con strumenti esistenti, authority_score=qualita delle fonti.",
        "Preferisci 3-8 candidati diversificati, ma non riempire l’output con temi deboli: se solo 1-2 temi sono davvero verificabili restituisci solo quelli. Evita varianti dello stesso tema nello stesso output.",
        "source_urls deve contenere solo URL https effettivamente consultati nella ricerca. existing_article_id e related_target_ids devono usare soltanto gli ID forniti nell'input oppure null/lista vuota.",
        "Scrivi topic, intento, angolo, motivazione e differenza in italiano, in modo concreto e verificabile.",
      ].join(" "),
      input,
      reasoning: { effort: "medium" },
      max_output_tokens: 6500,
      background: true,
      store: true,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_research_radar_v2",
          strict: true,
          schema: researchRadarCandidateSchema(),
        },
      },
    },
    economics: { activity: "research_radar" },
  });
  if (!response?.id) throw new Error("Radar editoriale: ricerca web non avviata");
  return { response_id: response.id, status: response.status || "queued" };
}

function validateResearchRadarPayload(payload, { archive, targets }) {
  let parsed;
  try {
    parsed = JSON.parse(responseOutputText(payload));
  } catch {
    throw new Error("Radar editoriale: risposta AI non interpretabile");
  }
  const observedSources = new Set(responseSourceUrls(payload).map(sourceUrlKey).filter(Boolean));
  const archiveById = new Map((archive || []).map((row) => [String(row.id), row]));
  const targetById = new Map((targets || []).map((row) => [String(row.id), row]));
  const output = [];
  const seen = new Set();

  for (const raw of Array.isArray(parsed?.candidates) ? parsed.candidates : []) {
    const topic = cleanEditorialText(raw?.topic, 240);
    const searchIntent = cleanEditorialText(raw?.search_intent, 700);
    const angle = cleanEditorialText(raw?.angle, 1200);
    if (topic.length < 8 || searchIntent.length < 20 || angle.length < 30) continue;

    const candidateText = `${topic} ${searchIntent} ${angle}`;
    let closest = null;
    let closestSimilarity = 0;
    for (const article of archive || []) {
      const similarity = researchRadarSimilarity(candidateText, `${article.title} ${article.excerpt}`);
      if (similarity > closestSimilarity) {
        closest = article;
        closestSimilarity = similarity;
      }
    }

    let action = ["NEW_ARTICLE", "NEW_ANGLE", "UPDATE_EXISTING", "SKIP_DUPLICATE"].includes(String(raw?.editorial_action || ""))
      ? String(raw.editorial_action)
      : "NEW_ARTICLE";
    let existing = archiveById.get(String(raw?.existing_article_id || "")) || closest || null;
    const difference = cleanEditorialText(raw?.difference_from_existing, 900);
    const freshness = researchRadarClampScore(raw?.freshness_score);

    // Guardrail deterministico contro cannibalizzazione: un'elevata sovrapposizione non puo'
    // diventare automaticamente un nuovo articolo solo per decisione del modello.
    if (closestSimilarity >= 0.72) {
      action = freshness >= 60 ? "UPDATE_EXISTING" : "SKIP_DUPLICATE";
      existing = closest || existing;
    } else if (action === "NEW_ARTICLE" && closestSimilarity >= 0.55) {
      action = difference.length >= 45 ? "NEW_ANGLE" : (freshness >= 60 ? "UPDATE_EXISTING" : "SKIP_DUPLICATE");
      existing = closest || existing;
    } else if (action === "NEW_ANGLE" && (!existing || difference.length < 45)) {
      action = closestSimilarity >= 0.45 ? (freshness >= 60 ? "UPDATE_EXISTING" : "SKIP_DUPLICATE") : "NEW_ARTICLE";
    }

    const componentScores = {
      demand: researchRadarClampScore(raw?.demand_score),
      trend: researchRadarClampScore(raw?.trend_score),
      freshness,
      content_gap: researchRadarClampScore(raw?.content_gap_score),
      user_utility: researchRadarClampScore(raw?.user_utility_score),
      offertalogica_fit: researchRadarClampScore(raw?.offertalogica_fit_score),
      authority: researchRadarClampScore(raw?.authority_score),
    };
    const baseScore = Math.round(
      componentScores.demand * 0.25
      + componentScores.trend * 0.20
      + componentScores.freshness * 0.15
      + componentScores.content_gap * 0.15
      + componentScores.user_utility * 0.10
      + componentScores.offertalogica_fit * 0.10
      + componentScores.authority * 0.05,
    );
    const duplicationPenalty = action === "NEW_ANGLE"
      ? Math.round(closestSimilarity * 18)
      : action === "NEW_ARTICLE"
        ? Math.round(closestSimilarity * 28)
        : 100;
    const score = ["NEW_ARTICLE", "NEW_ANGLE"].includes(action)
      ? Math.max(0, Math.min(100, baseScore - duplicationPenalty))
      : baseScore;

    const queryExamples = [...new Set((Array.isArray(raw?.query_examples) ? raw.query_examples : [])
      .map((value) => cleanEditorialText(value, 220)).filter(Boolean))].slice(0, 6);
    const relatedTargets = [...new Set(Array.isArray(raw?.related_target_ids) ? raw.related_target_ids.map(String) : [])]
      .map((id) => targetById.get(id)).filter(Boolean).slice(0, 4);
    const sourceUrls = [...new Set((Array.isArray(raw?.source_urls) ? raw.source_urls : [])
      .map(normalizedHttps).filter(Boolean))]
      .filter((url) => observedSources.has(sourceUrlKey(url)))
      .slice(0, 6);
    if (!sourceUrls.length) continue;

    const candidate = {
      schema_version: EDITORIAL_RESEARCH_RADAR_SCHEMA_VERSION,
      topic,
      search_intent: searchIntent,
      angle,
      query_examples: queryExamples,
      component_scores: componentScores,
      base_score: baseScore,
      duplication_penalty: duplicationPenalty,
      score,
      editorial_action: action,
      existing_article: existing ? { id: existing.id, title: existing.title, slug: existing.slug, published_at: existing.published_at || null } : null,
      existing_article_similarity: roundMetric(closestSimilarity, 3),
      difference_from_existing: difference,
      related_targets: relatedTargets,
      rationale: cleanEditorialText(raw?.rationale, 1000),
      source_urls: sourceUrls,
    };
    candidate.radar_key = researchRadarKey(candidate);
    if (seen.has(candidate.radar_key)) continue;
    seen.add(candidate.radar_key);
    output.push(candidate);
  }

  if (!output.length) throw new Error("Radar editoriale: nessun candidato verificabile prodotto");
  return output.slice(0, EDITORIAL_RESEARCH_RADAR_MAX_CANDIDATES);
}

function consolidateResearchRadarCandidates(runs) {
  const groups = new Map();
  for (const run of runs || []) {
    if (String(run?.status || "") !== "success") continue;
    for (const raw of Array.isArray(run?.details?.radar_candidates) ? run.details.radar_candidates : []) {
      const key = String(raw?.radar_key || researchRadarKey(raw));
      if (!key) continue;
      const current = groups.get(key);
      const candidate = { ...raw, radar_key: key, scan_date: run?.details?.local_date || null };
      if (!current) groups.set(key, { candidate, appearances: 1, scan_dates: new Set([candidate.scan_date].filter(Boolean)) });
      else {
        current.appearances += 1;
        if (candidate.scan_date) current.scan_dates.add(candidate.scan_date);
        if (Number(candidate.score || 0) > Number(current.candidate?.score || 0)) current.candidate = candidate;
      }
    }
  }
  return [...groups.values()].map(({ candidate, appearances, scan_dates }) => ({
    ...candidate,
    appearances,
    scan_dates: [...scan_dates].sort(),
    score: Math.min(100, Number(candidate.score || 0) + Math.min(8, Math.max(0, appearances - 1) * 3)),
  })).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

async function researchRadarPayload() {
  const runs = await researchRadarRuns(40);
  const running = runs.find((run) => String(run?.status || "") === "running") || null;
  const candidates = consolidateResearchRadarCandidates(runs);
  const scans = (runs || []).filter((run) => String(run?.status || "") !== "running").slice(0, 12).map((run) => ({
    id: run.id,
    status: run.status,
    local_date: run?.details?.local_date || null,
    started_at: run.started_at || run.created_at || null,
    finished_at: run.finished_at || null,
    candidate_count: Array.isArray(run?.details?.radar_candidates) ? run.details.radar_candidates.length : 0,
    last_error: run.last_error || null,
  }));
  return {
    ok: true,
    version: VERSION,
    schema_version: EDITORIAL_RESEARCH_RADAR_SCHEMA_VERSION,
    automatic_days: ["sabato", "domenica", "lunedi"],
    automatic_after_local_time: "08:00",
    running: running ? { id: running.id, local_date: running?.details?.local_date || null, stage: running?.details?.stage || null, started_at: running.started_at || null } : null,
    scans,
    candidates,
  };
}

async function startResearchRadarRun(user, { local, trigger = "scheduler" } = {}) {
  const currentLocal = local || schedulerLocalParts("Europe/Rome");
  const archive = await researchRadarArchive();
  const targets = await researchRadarTargets();
  const searchSignals = await researchRadarSearchSignals();
  const recentRuns = await researchRadarRuns(30);
  const previousCandidates = researchRadarPreviousCandidates(recentRuns);
  const run = await automationSchedulerRunStart("research_radar", {
    stage: "starting",
    trigger,
    local_date: currentLocal.date,
    local_time: currentLocal.time,
    timezone: currentLocal.time_zone,
    publication_performed: false,
  });
  if (!run?.id) throw new Error("Radar editoriale: run non creato");
  try {
    const started = await startOpenAiResearchRadar({ localDate: currentLocal.date, archive, targets, searchSignals, previousCandidates });
    const updated = await automationSchedulerRunPatch(run, {
      stage: "web_search_running",
      response_id: started.response_id,
      response_status: started.status,
      archive_count: archive.length,
      target_count: targets.length,
      search_console_signal_count: searchSignals.length,
    });
    return { action: "research_radar_started", pending: true, run: updated, local: currentLocal };
  } catch (error) {
    await automationRunFinish(run, "failed", {
      last_error: String(error?.message || error).slice(0, 2000),
      details: { ...(run.details || {}), stage: "failed", trigger, local_date: currentLocal.date, version: VERSION, source: "scheduler" },
    });
    throw error;
  }
}

async function resumeResearchRadarRun(run) {
  const responseId = String(run?.details?.response_id || "").trim();
  if (!responseId) {
    await automationRunFinish(run, "failed", { last_error: "Radar editoriale: response_id mancante", details: { ...(run.details || {}), stage: "failed" } });
    return { action: "research_radar_failed", pending: false };
  }
  const payload = await retrieveOpenAiEditorialPackage(responseId);
  const status = String(payload?.status || "");
  if (["queued", "in_progress"].includes(status)) {
    const updated = await automationSchedulerRunPatch(run, { stage: "web_search_running", response_status: status });
    return { action: "research_radar_waiting", pending: true, run: updated };
  }
  if (status !== "completed") {
    const message = payload?.error?.message || payload?.incomplete_details?.reason || `stato ${status || "sconosciuto"}`;
    await automationRunFinish(run, "failed", { last_error: `Radar editoriale: ${message}`.slice(0, 2000), details: { ...(run.details || {}), stage: "failed", response_status: status } });
    return { action: "research_radar_failed", pending: false, error: message };
  }
  const [archive, targets] = await Promise.all([researchRadarArchive(), researchRadarTargets()]);
  const candidates = validateResearchRadarPayload(payload, { archive, targets });
  const sourceUrls = responseSourceUrls(payload).map(normalizedHttps).filter(Boolean).slice(0, 40);
  const details = {
    ...(run.details || {}),
    stage: "completed",
    response_status: status,
    radar_schema_version: EDITORIAL_RESEARCH_RADAR_SCHEMA_VERSION,
    radar_candidates: candidates,
    source_urls: sourceUrls,
    completed_at: new Date().toISOString(),
  };
  await automationRunFinish(run, "success", { details });
  return { action: "research_radar_completed", pending: false, candidate_count: candidates.length, candidates };
}

async function schedulerMaybeResearchRadar(user, settings, local) {
  const runs = await researchRadarRuns(30);
  const running = runs.find((run) => String(run?.status || "") === "running") || null;
  if (running) return resumeResearchRadarRun(running);

  if (!EDITORIAL_RESEARCH_RADAR_DAYS.has(Number(local?.weekday))) return null;
  if (Number(local?.minutes || 0) < EDITORIAL_RESEARCH_RADAR_START_MINUTE) return null;
  const sameDay = runs.filter((run) => String(run?.details?.local_date || "") === String(local.date || ""));
  if (sameDay.some((run) => String(run?.status || "") === "success")) return null;
  const failures = sameDay.filter((run) => String(run?.status || "") === "failed").length;
  if (failures >= EDITORIAL_RESEARCH_RADAR_MAX_ATTEMPTS_PER_DAY) return null;
  return startResearchRadarRun(user, { local, trigger: "scheduler_weekend_radar" });
}

async function startManualResearchRadar(user, settings) {
  const runs = await researchRadarRuns(30);
  const running = runs.find((run) => String(run?.status || "") === "running") || null;
  if (running) return { action: "research_radar_already_running", pending: true, run: running };
  const local = schedulerLocalParts(settings?.timezone || "Europe/Rome");
  return startResearchRadarRun(user, { local, trigger: "manual" });
}

async function saveResearchRadarOpportunity(user, candidate) {
  const radarKey = String(candidate?.radar_key || "").trim();
  if (!radarKey) throw new Error("Radar editoriale: candidato non valido");
  const existingRows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&status=in.(pending,selected,deferred)&order=created_at.desc&limit=100`,
  );
  const duplicate = (existingRows || []).find((row) => String(row?.evidence?.research_radar?.radar_key || "") === radarKey);
  if (duplicate) return duplicate;

  const evidence = {
    source: "research_radar",
    research_radar: {
      schema_version: EDITORIAL_RESEARCH_RADAR_SCHEMA_VERSION,
      radar_key: radarKey,
      editorial_action: candidate.editorial_action,
      search_intent: candidate.search_intent,
      angle: candidate.angle,
      query_examples: candidate.query_examples || [],
      component_scores: candidate.component_scores || {},
      base_score: candidate.base_score ?? null,
      duplication_penalty: candidate.duplication_penalty ?? null,
      appearances: candidate.appearances || 1,
      scan_dates: candidate.scan_dates || [],
      existing_article: candidate.existing_article || null,
      difference_from_existing: candidate.difference_from_existing || "",
      related_targets: candidate.related_targets || [],
      rationale: candidate.rationale || "",
      source_urls: candidate.source_urls || [],
    },
    query_examples: candidate.query_examples || [],
    page_urls: [],
  };
  evidence.editorial_brief = opportunityEditorialBrief({ topic: candidate.topic, evidence });
  const rows = await serviceFetch("editorial_research_opportunities", {
    method: "POST",
    prefer: "return=representation",
    body: {
      snapshot_id: null,
      topic: candidate.topic,
      category: null,
      opportunity_type: "new_article",
      score: Math.round(Number(candidate.score || 0)),
      rationale: candidate.rationale || "Tema individuato dal radar web e confrontato con l'archivio OffertaLogica.",
      evidence,
      status: "pending",
    },
  });
  if (!rows?.[0]?.id) throw new Error("Radar editoriale: opportunita non salvata");
  return rows[0];
}

function manualIdeaDeadlineTime(value) {
  const parsed = value ? Date.parse(`${value}T12:00:00Z`) : NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function plannerCandidateComparator(a, b) {
  if (a.rank !== b.rank) return b.rank - a.rank;
  if (a.rank === 500 && b.rank === 500) {
    const aDecision = Date.parse(String(a.decided_at || "")) || 0;
    const bDecision = Date.parse(String(b.decided_at || "")) || 0;
    if (aDecision !== bDecision) return bDecision - aDecision;
  }
  const aDeadline = manualIdeaDeadlineTime(a.deadline);
  const bDeadline = manualIdeaDeadlineTime(b.deadline);
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  if (a.score !== b.score) return b.score - a.score;
  return String(a.created_at || "").localeCompare(String(b.created_at || ""));
}

async function opportunitiesPayload() {
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&order=updated_at.desc&limit=${OPPORTUNITY_LIST_LIMIT}`,
  );
  const opportunities = Array.isArray(rows) ? rows : [];
  const needsContext = opportunities.some((row) => {
    const savedPages = row?.evidence?.page_urls;
    return (!Array.isArray(savedPages) || !savedPages.length) && row?.evidence?.topic_key;
  });
  let signalsByTopic = new Map();
  if (needsContext) {
    const analysis = await analysisPayload().catch(() => null);
    if (analysis?.ready) {
      signalsByTopic = new Map((analysis.signals || []).map((signal) => [signal.topic_key, signal]));
    }
  }
  return {
    ok: true,
    version: VERSION,
    opportunities: opportunities.map((row) => {
      const liveSignal = signalsByTopic.get(row?.evidence?.topic_key) || null;
      const savedPages = Array.isArray(row?.evidence?.page_urls) ? row.evidence.page_urls : [];
      const livePages = liveSignal?.page_urls || [];
      const savedQueries = Array.isArray(row?.evidence?.query_examples) ? row.evidence.query_examples : [];
      const liveQueries = liveSignal?.query_examples || [];
      const enriched = {
        ...row,
        context_pages: (savedPages.length ? savedPages : livePages).slice(0, 5),
        query_examples: (savedQueries.length ? savedQueries : liveQueries).slice(0, 5),
      };
      return { ...enriched, editorial_brief: opportunityEditorialBrief(enriched, liveSignal) };
    }),
  };
}

async function existingActiveManualIdea(topic) {
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&status=in.(pending,selected,deferred)&order=created_at.desc&limit=100`,
  );
  const normalized = normalizeManualIdeaTopic(topic);
  return (rows || []).find((row) => manualIdeaMeta(row) && normalizeManualIdeaTopic(row.topic) === normalized) || null;
}

async function createManualEditorialIdea(user, payload = {}) {
  const topic = cleanManualIdeaText(payload.topic, 240);
  const category = cleanManualIdeaText(payload.category, 80) || null;
  const notes = String(payload.notes || "").trim().slice(0, 2000);
  const priority = String(payload.priority || "normal").trim();
  const opportunityType = "new_article";
  const deadline = validManualIdeaDeadline(payload.deadline);

  if (topic.length < 3) throw new Error("Inserisci un’idea editoriale di almeno 3 caratteri");
  if (!MANUAL_IDEA_PRIORITIES.has(priority)) throw new Error("Priorità idea non valida");
  if (!MANUAL_IDEA_TYPES.has(opportunityType)) throw new Error("Le idee manuali della Redazione devono generare nuovi articoli");

  const duplicate = await existingActiveManualIdea(topic);
  if (duplicate) return { created: false, opportunity: duplicate };

  const now = new Date().toISOString();
  const evidence = {
    source: "manual_idea",
    manual_idea: {
      schema_version: 1,
      priority,
      deadline,
      notes,
      created_at: now,
      created_by: user.id,
      updated_at: now,
      updated_by: user.id,
    },
  };
  const rows = await serviceFetch("editorial_research_opportunities", {
    method: "POST",
    prefer: "return=representation",
    body: {
      snapshot_id: null,
      topic,
      category,
      opportunity_type: opportunityType,
      score: 0,
      rationale: manualIdeaRationale(priority, deadline),
      evidence,
      status: "pending",
    },
  });
  const opportunity = rows?.[0];
  if (!opportunity?.id) throw new Error("Idea editoriale non salvata");
  return { created: true, opportunity };
}

async function updateManualEditorialIdea(user, payload = {}) {
  const id = String(payload.id || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo idea non valido");

  const currentRows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const current = currentRows?.[0];
  if (!current) throw new Error("Idea editoriale non trovata");
  const manual = manualIdeaMeta(current);
  if (!manual) throw new Error("Questa opportunità non è un’idea inserita manualmente");
  if (current.status === "completed" || current.target_article_id) {
    throw new Error("Un’idea già collegata o completata non può essere modificata da questo pannello");
  }

  const topic = cleanManualIdeaText(payload.topic, 240);
  const category = cleanManualIdeaText(payload.category, 80) || null;
  const notes = String(payload.notes || "").trim().slice(0, 2000);
  const priority = String(payload.priority || "normal").trim();
  const opportunityType = "new_article";
  const deadline = validManualIdeaDeadline(payload.deadline);
  if (topic.length < 3) throw new Error("Inserisci un’idea editoriale di almeno 3 caratteri");
  if (!MANUAL_IDEA_PRIORITIES.has(priority)) throw new Error("Priorità idea non valida");
  if (!MANUAL_IDEA_TYPES.has(opportunityType)) throw new Error("Le idee manuali della Redazione devono generare nuovi articoli");
  const duplicate = await existingActiveManualIdea(topic);
  if (duplicate && duplicate.id !== id) throw new Error("Esiste già un’idea manuale attiva con lo stesso argomento");

  const now = new Date().toISOString();
  const currentEvidence = current.evidence && typeof current.evidence === "object" ? current.evidence : {};
  const { target_page_url: _oldTarget, page_urls: _oldPages, ...evidenceBase } = currentEvidence;
  const evidence = {
    ...evidenceBase,
    source: "manual_idea",
    manual_idea: {
      ...manual,
      schema_version: 1,
      priority,
      deadline,
      notes,
      updated_at: now,
      updated_by: user.id,
    },
  };
  const rows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      topic,
      category,
      opportunity_type: opportunityType,
      rationale: manualIdeaRationale(priority, deadline),
      evidence,
      updated_at: now,
    },
  });
  const opportunity = rows?.[0];
  if (!opportunity?.id) throw new Error("Idea editoriale non aggiornata");
  return opportunity;
}

async function editorialPlannerPreview() {
  const settingsRows = await serviceFetch(
    "editorial_automation_settings?select=id,enabled,execution_mode,minimum_opportunity_score,allow_no_publish,max_articles_per_cycle,timezone&id=eq.1&limit=1",
  );
  const settings = settingsRows?.[0] || {};
  const minimumScore = Number.isFinite(Number(settings.minimum_opportunity_score))
    ? Number(settings.minimum_opportunity_score)
    : 60;

  const savedRows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&status=in.(pending,selected)&order=created_at.asc&limit=100`,
  );
  const candidates = [];

  for (const row of savedRows || []) {
    const savedType = String(row.opportunity_type || "");
    if (!MANUAL_IDEA_TYPES.has(savedType) && savedType !== "update_article") continue;
    const manual = manualIdeaMeta(row);
    if (row.status === "selected" && validUuid(String(row.target_article_id || ""))) continue;
    if (row.status === "selected") {
      candidates.push({
        source: manual ? "manual_idea" : "saved_opportunity",
        id: row.id,
        topic: row.topic,
        opportunity_type: row.opportunity_type,
        priority: manual?.priority || null,
        deadline: manual?.deadline || null,
        score: Number(row.score || 0),
        status: row.status,
        created_at: row.created_at,
        decided_at: row.decided_at || null,
        rank: 500,
        reason: "Opportunita gia selezionata manualmente dalla Redazione: precede ogni scelta automatica.",
      });
      continue;
    }
    if (!manual) continue;
    const priority = MANUAL_IDEA_PRIORITIES.has(String(manual.priority)) ? String(manual.priority) : "normal";
    candidates.push({
      source: "manual_idea",
      id: row.id,
      topic: row.topic,
      opportunity_type: row.opportunity_type,
      priority,
      deadline: manual.deadline || null,
      score: 0,
      status: row.status,
      created_at: row.created_at,
      rank: MANUAL_IDEA_PRIORITY_RANK[priority],
      reason: priority === "urgent"
        ? "Idea manuale urgente: precede i segnali automatici."
        : priority === "high"
          ? "Idea manuale ad alta priorita: precede i segnali automatici."
          : "Idea manuale a priorita normale: viene considerata dopo i segnali automatici sopra soglia.",
    });
  }

  const analysis = await analysisPayload().catch(() => null);
  const allSearchSignals = analysis?.ready && Array.isArray(analysis.signals) ? analysis.signals : [];
  const archive = await researchRadarArchive();
  let searchSignalsExcludedArchive = 0;
  const searchSignals = allSearchSignals.filter((signal) => {
    const cycleStatus = String(signal?.cycle_opportunity?.status || "");
    if (cycleStatus === "rejected" || cycleStatus === "completed") return false;
    if (signal?.cycle_opportunity?.target_article_id) return false;
    const signalText = `${signal?.topic || ""} ${(signal?.query_examples || []).join(" ")}`;
    let closestSimilarity = 0;
    for (const article of archive) {
      closestSimilarity = Math.max(closestSimilarity, researchRadarSimilarity(signalText, `${article.title} ${article.excerpt}`));
    }
    // Search Console da sola non dimostra un nuovo intento. Se il tema e' gia coperto,
    // lo lasciamo al radar web che puo' proporre UPDATE_EXISTING o un vero NEW_ANGLE.
    if (closestSimilarity >= 0.60) {
      searchSignalsExcludedArchive += 1;
      return false;
    }
    return true;
  });
  const topSearchSignal = searchSignals.find((signal) => Number(signal.score || 0) >= minimumScore) || null;
  if (topSearchSignal) {
    candidates.push({
      source: "search_console",
      id: null,
      topic: topSearchSignal.topic,
      opportunity_type: "research_candidate",
      priority: null,
      deadline: null,
      score: Number(topSearchSignal.score || 0),
      status: "live_signal",
      created_at: null,
      rank: 200,
      reason: `Segnale Search Console sopra la soglia ${minimumScore}/100.`,
      topic_key: topSearchSignal.topic_key,
      metrics: topSearchSignal.metrics,
      fallback_below_threshold: false,
    });
  }

  const radar = await researchRadarPayload().catch(() => ({ candidates: [] }));
  const radarAll = Array.isArray(radar?.candidates) ? radar.candidates : [];
  const radarEligible = radarAll.filter((candidate) => ["NEW_ARTICLE", "NEW_ANGLE"].includes(String(candidate?.editorial_action || "")));
  const topRadarSignal = radarEligible.find((candidate) => Number(candidate.score || 0) >= minimumScore) || null;
  if (topRadarSignal) {
    candidates.push({
      source: "research_radar",
      id: null,
      topic: topRadarSignal.topic,
      opportunity_type: "research_candidate",
      priority: null,
      deadline: null,
      score: Number(topRadarSignal.score || 0),
      status: "live_signal",
      created_at: null,
      rank: 200,
      reason: `Radar web ${topRadarSignal.editorial_action === "NEW_ANGLE" ? "con nuovo angolo" : "su tema nuovo"} sopra la soglia ${minimumScore}/100.`,
      radar_key: topRadarSignal.radar_key,
      radar_candidate: topRadarSignal,
      fallback_below_threshold: false,
    });
  }

  const hasQualifiedAutomatic = Boolean(topSearchSignal || topRadarSignal);
  if (!hasQualifiedAutomatic && !Boolean(settings.allow_no_publish)) {
    const fallbackSearch = searchSignals.find((signal) => signal?.topic_key && signal?.topic) || null;
    const fallbackRadar = radarEligible[0] || null;
    const fallbackOptions = [];
    if (fallbackSearch) fallbackOptions.push({
      source: "search_console",
      topic: fallbackSearch.topic,
      opportunity_type: "research_candidate",
      score: Number(fallbackSearch.score || 0),
      status: "live_signal",
      rank: 50,
      reason: `Nessun segnale automatico raggiunge la soglia ${minimumScore}/100: candidato Search Console di ripiego.`,
      topic_key: fallbackSearch.topic_key,
      metrics: fallbackSearch.metrics,
      fallback_below_threshold: true,
    });
    if (fallbackRadar) fallbackOptions.push({
      source: "research_radar",
      topic: fallbackRadar.topic,
      opportunity_type: "research_candidate",
      score: Number(fallbackRadar.score || 0),
      status: "live_signal",
      rank: 50,
      reason: `Nessun segnale automatico raggiunge la soglia ${minimumScore}/100: candidato radar web di ripiego.`,
      radar_key: fallbackRadar.radar_key,
      radar_candidate: fallbackRadar,
      fallback_below_threshold: true,
    });
    fallbackOptions.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    if (fallbackOptions[0]) candidates.push(fallbackOptions[0]);
  }

  candidates.sort(plannerCandidateComparator);
  const maxArticlesPerCycle = Number.isFinite(Number(settings.max_articles_per_cycle))
    ? Math.max(0, Number(settings.max_articles_per_cycle))
    : 1;
  const articleCycleDisabled = maxArticlesPerCycle === 0;
  const decision = articleCycleDisabled ? null : (candidates[0] || null);
  const duplicateProtectionNoPublish = !decision && searchSignalsExcludedArchive > 0 && !radarEligible.length;
  const noPublish = articleCycleDisabled || (!decision && (Boolean(settings.allow_no_publish) || duplicateProtectionNoPublish));
  return {
    ok: true,
    version: VERSION,
    dry_run: true,
    writes_database: false,
    automation_enabled: Boolean(settings.enabled),
    execution_mode: settings.execution_mode || "approval",
    minimum_opportunity_score: minimumScore,
    max_articles_per_cycle: maxArticlesPerCycle,
    article_cycle_disabled: articleCycleDisabled,
    timezone: settings.timezone || "Europe/Rome",
    search_console_ready: Boolean(analysis?.ready),
    search_signals_available: allSearchSignals.length,
    search_signals_eligible: searchSignals.length,
    search_signals_excluded_current_cycle: Math.max(0, allSearchSignals.length - searchSignals.length),
    search_signals_excluded_archive_duplicate: searchSignalsExcludedArchive,
    duplicate_protection_no_publish: duplicateProtectionNoPublish,
    research_radar_candidates: radarAll.length,
    research_radar_new_candidates: radarEligible.length,
    research_radar_update_suggestions: radarAll.filter((row) => row?.editorial_action === "UPDATE_EXISTING").length,
    research_radar_duplicates_skipped: radarAll.filter((row) => row?.editorial_action === "SKIP_DUPLICATE").length,
    analysis_reference_snapshot_id: analysis?.reference_snapshot_id || null,
    decision,
    no_publish: noPublish,
    ordering: [
      "opportunita gia selezionata manualmente",
      "idea manuale urgente",
      "idea manuale ad alta priorita",
      "miglior segnale automatico sopra soglia (Search Console o Radar web)",
      "idea manuale a priorita normale",
      "miglior segnale automatico sotto soglia quando il ciclo non puo chiudersi senza articolo",
    ],
  };
}

function opportunityRationale(signal) {
  const m28 = signal?.metrics?.["28"];
  const position = Number.isFinite(Number(m28?.avg_position)) ? Number(m28.avg_position).toFixed(1) : "n/d";
  const impressions = Number.isFinite(Number(m28?.impressions)) ? Number(m28.impressions) : 0;
  return `Segnale Search Console salvato manualmente dalla redazione. Punteggio tecnico ${Number(signal?.score || 0)}/100; ${impressions} impressioni negli ultimi 28 giorni disponibili; posizione media ${position}. Da validare prima di qualsiasi preparazione editoriale.`;
}

async function upsertResearchTopic(user, signal) {
  const now = new Date().toISOString();
  await serviceFetch("editorial_research_topics?on_conflict=topic_key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      topic_key: signal.topic_key,
      display_name: signal.topic,
      active: true,
      notes: "Segnale Search Console persistito manualmente dalla redazione.",
      updated_at: now,
      updated_by: user.id,
    },
  });
}

async function existingOpportunity(topicKey, snapshotId) {
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&snapshot_id=eq.${encodeURIComponent(snapshotId)}&order=created_at.desc&limit=100`,
  );
  return (rows || []).find((row) => String(row?.evidence?.topic_key || "") === topicKey) || null;
}

async function saveEditorialOpportunity(user, topicKeyValue, requestedStatusValue = "pending") {
  const topicKey = String(topicKeyValue || "").trim();
  const requestedStatus = String(requestedStatusValue || "pending").trim();
  if (!topicKey || topicKey.length > 1000) throw new Error("Segnale editoriale non valido");
  if (!["pending", "selected", "rejected"].includes(requestedStatus)) {
    throw new Error("Decisione sul segnale non valida");
  }

  const analysis = await analysisPayload();
  if (!analysis.ready) throw new Error("Storico Search Console non ancora sufficiente");
  const signal = (analysis.signals || []).find((row) => row.topic_key === topicKey);
  if (!signal) {
    throw new Error(`Segnale non disponibile nella graduatoria corrente (primi ${Number(analysis.signal_limit || ANALYSIS_SIGNAL_LIMIT)} risultati)`);
  }

  const snapshot = analysis.snapshots.find((row) => String(row.id || "") === String(analysis.reference_snapshot_id || ""))
    || analysis.snapshots.find((row) => Number(row.days) === 90)
    || analysis.snapshots.find((row) => Number(row.days) === 28)
    || analysis.snapshots[0];
  if (!snapshot?.id) throw new Error("Snapshot di riferimento non disponibile");

  const duplicate = await existingOpportunity(topicKey, snapshot.id);
  if (duplicate) {
    if (requestedStatus === "selected") {
      const opportunity = await selectEditorialOpportunity(user, duplicate.id);
      return { created: false, status_changed: duplicate.status !== "selected", opportunity };
    }
    if (requestedStatus === "rejected") {
      const opportunity = await updateEditorialOpportunity(user, duplicate.id, "rejected");
      return { created: false, status_changed: duplicate.status !== "rejected", opportunity };
    }
    return { created: false, status_changed: false, opportunity: duplicate };
  }

  await upsertResearchTopic(user, signal);
  const now = new Date().toISOString();
  const evidence = {
    source: "search_console",
    analysis_version: VERSION,
    topic_key: signal.topic_key,
    query_count: signal.query_count,
    query_examples: Array.isArray(signal.query_examples) ? signal.query_examples.slice(0, 5) : [],
    page_count: signal.page_count,
    page_urls: Array.isArray(signal.page_urls) ? signal.page_urls.slice(0, 5) : [],
    momentum_ratio: signal.momentum_ratio,
    metrics: signal.metrics,
    analysis_reference_snapshot_id: snapshot.id,
    snapshots: analysis.snapshots.map((row) => ({
      id: row.id,
      days: row.days,
      period_start: row.period_start,
      period_end: row.period_end,
      row_count: row.row_count,
      captured_at: row.captured_at,
    })),
    saved_at: now,
  };
  evidence.editorial_brief = opportunityEditorialBrief({ topic: signal.topic, evidence }, signal);

  const rows = await serviceFetch("editorial_research_opportunities", {
    method: "POST",
    prefer: "return=representation",
    body: {
      snapshot_id: snapshot.id,
      topic: signal.topic,
      category: null,
      opportunity_type: "monitor",
      score: signal.score,
      rationale: opportunityRationale(signal),
      evidence,
      status: "pending",
    },
  });
  let opportunity = rows?.[0];
  if (!opportunity?.id) throw new Error("Opportunità editoriale non salvata");

  if (requestedStatus === "selected") {
    opportunity = await selectEditorialOpportunity(user, opportunity.id);
  } else if (requestedStatus === "rejected") {
    opportunity = await updateEditorialOpportunity(user, opportunity.id, "rejected");
  }
  return { created: true, status_changed: requestedStatus !== "pending", opportunity };
}

async function selectEditorialOpportunity(user, idValue) {
  const id = String(idValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");

  const currentRows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const current = currentRows?.[0];
  if (!current) throw new Error("Opportunità non trovata");
  if (current.status === "completed") throw new Error("Un’opportunità completata non può essere selezionata");
  if (current.target_article_id) {
    throw new Error("L’articolo per questa opportunità è già stato avviato: la scelta non è più modificabile in questo ciclo");
  }

  let evidence = current.evidence && typeof current.evidence === "object" ? { ...current.evidence } : {};
  let liveSignal = null;
  if (evidence.source === "search_console" && evidence.topic_key) {
    const analysis = await analysisPayload().catch(() => null);
    if (analysis?.ready) {
      liveSignal = (analysis.signals || []).find((row) => row.topic_key === evidence.topic_key) || null;
    }
    if (liveSignal) {
      if (!Array.isArray(evidence.query_examples) || !evidence.query_examples.length) {
        evidence.query_examples = Array.isArray(liveSignal.query_examples) ? liveSignal.query_examples.slice(0, 5) : [];
      }
      if (!Array.isArray(evidence.page_urls) || !evidence.page_urls.length) {
        evidence.page_urls = Array.isArray(liveSignal.page_urls) ? liveSignal.page_urls.slice(0, 5) : [];
      }
      if (!evidence.metrics && liveSignal.metrics) evidence.metrics = liveSignal.metrics;
      if (!evidence.query_count && liveSignal.query_count) evidence.query_count = liveSignal.query_count;
      if (!evidence.page_count && liveSignal.page_count) evidence.page_count = liveSignal.page_count;
    }
  }
  evidence.editorial_brief = opportunityEditorialBrief({ ...current, evidence }, liveSignal);

  const now = new Date().toISOString();
  // Una scelta umana deve essere univoca tra le opportunità non ancora avviate.
  // Le opportunità già collegate a un articolo appartengono a cicli in corso/passati
  // e restano intatte; il planner le ignora già quando sceglie il prossimo articolo.
  await serviceFetch(
    `editorial_research_opportunities?status=eq.selected&target_article_id=is.null&id=neq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "pending",
        decided_by: null,
        decided_at: null,
        updated_at: now,
      },
    },
  );

  const rows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      status: "selected",
      opportunity_type: ["monitor", "update_article"].includes(String(current.opportunity_type || "")) ? "new_article" : current.opportunity_type,
      evidence,
      decided_by: user.id,
      decided_at: now,
      updated_at: now,
    },
  });
  const opportunity = rows?.[0];
  if (!opportunity?.id) throw new Error("Scelta opportunità non salvata");
  return opportunity;
}

async function updateEditorialOpportunity(user, idValue, statusValue) {
  const id = String(idValue || "").trim();
  const status = String(statusValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  if (!OPPORTUNITY_STATUSES.has(status)) throw new Error("Stato opportunità non valido");
  if (status === "selected") return selectEditorialOpportunity(user, id);

  const current = await serviceFetch(
    `editorial_research_opportunities?select=id,status,target_article_id&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (!current?.[0]) throw new Error("Opportunità non trovata");
  if (current[0].status === "completed") throw new Error("Un’opportunità completata non può essere riaperta da questa fase");
  if (current[0].target_article_id) throw new Error("L’opportunità è già collegata a un articolo; gestiscila dalla bozza collegata");

  const now = new Date().toISOString();
  const decided = status !== "pending";
  const rows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      status,
      decided_by: decided ? user.id : null,
      decided_at: decided ? now : null,
      updated_at: now,
    },
  });
  const opportunity = rows?.[0];
  if (!opportunity?.id) throw new Error("Stato opportunità non aggiornato");
  return opportunity;
}


function normalizeArticleSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function classifyEditorialOpportunity(user, idValue, typeValue) {
  const id = String(idValue || "").trim();
  const requestedType = String(typeValue || "").trim();
  const opportunityType = requestedType === "update_article" ? "new_article" : requestedType;
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  if (!OPPORTUNITY_TYPES.has(opportunityType)) throw new Error("Destinazione editoriale non valida");

  const current = await serviceFetch(
    `editorial_research_opportunities?select=id,status,target_article_id,opportunity_type&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = current?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  if (opportunity.status !== "selected") throw new Error("Seleziona prima l’opportunità");
  if (opportunity.target_article_id) throw new Error("Questa opportunità è già collegata a una bozza");

  const now = new Date().toISOString();
  const rows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      opportunity_type: opportunityType,
      updated_at: now,
      decided_by: user.id,
    },
  });
  const updated = rows?.[0];
  if (!updated?.id) throw new Error("Destinazione editoriale non aggiornata");
  return updated;
}

async function articleSummary(articleId) {
  if (!validUuid(articleId)) return null;
  const rows = await serviceFetch(
    `editorial_articles?select=id,title,slug,status&id=eq.${encodeURIComponent(articleId)}&limit=1`,
  );
  return rows?.[0] || null;
}

async function prepareEditorialDraft(user, idValue) {
  const id = String(idValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");

  const current = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = current?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");

  if (opportunity.target_article_id) {
    const existingArticle = await articleSummary(opportunity.target_article_id);
    if (existingArticle) return { created: false, article: existingArticle, opportunity };
  }
  if (opportunity.status !== "selected") throw new Error("L’opportunità deve essere selezionata");
  if (opportunity.opportunity_type !== "new_article") {
    throw new Error("La bozza è disponibile solo per opportunità classificate come Nuovo articolo");
  }

  const authorRows = await serviceFetch(
    `editorial_authors?select=id,user_id,slug,display_name,active&user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&limit=1`,
  );
  const author = authorRows?.[0];
  if (!author?.id) throw new Error("Profilo autore attivo non disponibile per questo account");

  const title = String(opportunity.topic || "Bozza editoriale").trim().slice(0, 140) || "Bozza editoriale";
  const baseSlug = normalizeArticleSlug(title).slice(0, 76) || "bozza-editoriale";
  const slug = `${baseSlug}-${id}`.slice(0, 120);
  const article = await editorialArticleCreate(user, {
    title,
    slug,
    category: opportunity.category || null,
    featured_image_url: null,
    featured_image_alt: null,
    excerpt: "",
    content: "",
    sources: null,
    seo_title: null,
    seo_description: null,
    status: "draft",
    author_id: author.id,
    created_by: user.id,
    updated_by: user.id,
  });
  if (!article?.id) throw new Error("Bozza editoriale non creata");

  const now = new Date().toISOString();
  try {
    const opportunityRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        target_article_id: article.id,
        decided_by: user.id,
        updated_at: now,
      },
    });
    const updatedOpportunity = opportunityRows?.[0];
    if (!updatedOpportunity?.id) throw new Error("Collegamento opportunità-bozza non confermato");
    return {
      created: true,
      article: { id: article.id, title: article.title, slug: article.slug, status: article.status },
      opportunity: updatedOpportunity,
    };
  } catch (error) {
    await serviceFetch(`editorial_articles?id=eq.${encodeURIComponent(article.id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    }).catch(() => {});
    throw error;
  }
}


function cleanEditorialText(value, maxLength) {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}


function editorialImageModel() {
  return env("EDITORIAL_IMAGE_MODEL") || EDITORIAL_IMAGE_DEFAULT_MODEL;
}

function encodedStoragePath(value) {
  return String(value || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function editorialImagePublicUrl(objectPath) {
  const { url } = supabaseConfig();
  return `${url}/storage/v1/object/public/${EDITORIAL_IMAGE_BUCKET}/${encodedStoragePath(objectPath)}`;
}

function editorialImageObjectPathFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const { url } = supabaseConfig();
  try {
    const imageUrl = new URL(raw);
    const supabaseUrl = new URL(url);
    const prefix = `/storage/v1/object/public/${EDITORIAL_IMAGE_BUCKET}/`;
    if (imageUrl.protocol !== "https:" || imageUrl.origin !== supabaseUrl.origin || !imageUrl.pathname.startsWith(prefix)) return null;
    const encoded = imageUrl.pathname.slice(prefix.length);
    if (!encoded) return null;
    return encoded.split("/").map((part) => decodeURIComponent(part)).join("/");
  } catch {
    return null;
  }
}

async function uploadEditorialImageBuffer(objectPath, buffer, mimeType = "image/jpeg") {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Supabase server non configurato");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Immagine generata vuota");
  if (buffer.length > EDITORIAL_IMAGE_MAX_BYTES) throw new Error("L’immagine generata supera il limite di 5 MB dello storage editoriale");
  const response = await fetch(`${url}/storage/v1/object/${EDITORIAL_IMAGE_BUCKET}/${encodedStoragePath(objectPath)}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": mimeType,
      "x-upsert": "false",
    },
    body: buffer,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Storage ${response.status}`);
  return editorialImagePublicUrl(objectPath);
}

async function deleteEditorialImageObjects(objectPaths) {
  const prefixes = [...new Set((Array.isArray(objectPaths) ? objectPaths : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
  if (!prefixes.length) return { deleted: 0, warning: null };
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) return { deleted: 0, warning: "Storage Supabase non configurato" };
  try {
    const response = await fetch(`${url}/storage/v1/object/${EDITORIAL_IMAGE_BUCKET}`, {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes }),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || payload?.error || `Storage ${response.status}`);
    return { deleted: Array.isArray(payload) ? payload.length : prefixes.length, warning: null };
  } catch (error) {
    return { deleted: 0, warning: String(error?.message || error).slice(0, 500) };
  }
}

function articleImageState(opportunity) {
  const raw = opportunity?.evidence?.article_image;
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    schema_version: 1,
    current: state.current && typeof state.current === "object" ? state.current : null,
    candidate: state.candidate && typeof state.candidate === "object" ? state.candidate : null,
    history: Array.isArray(state.history) ? state.history.slice(-8) : [],
  };
}

function imageHistoryAppend(history, asset, outcome) {
  if (!asset || typeof asset !== "object") return Array.isArray(history) ? history.slice(-8) : [];
  return [...(Array.isArray(history) ? history : []), {
    ...asset,
    outcome,
    archived_at: new Date().toISOString(),
  }].slice(-8);
}

function defaultArticleImageAlt(article) {
  const title = cleanEditorialText(article?.title, 140) || "approfondimento OffertaLogica";
  return cleanEditorialText(`Immagine editoriale fotografica dedicata all’articolo “${title}”.`, 180);
}

async function articleImageContext(idValue) {
  const id = String(idValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  if (opportunity.opportunity_type !== "new_article") throw new Error("L’immagine dedicata è disponibile solo per un nuovo articolo");
  if (!validUuid(opportunity.target_article_id)) throw new Error("Genera prima la bozza completa dell’articolo");
  const articleRows = await serviceFetch(`editorial_articles?select=*&id=eq.${encodeURIComponent(opportunity.target_article_id)}&limit=1`);
  const article = articleRows?.[0];
  if (!article) throw new Error("Articolo collegato non trovato");
  if (!EDITORIAL_IMAGE_ARTICLE_STATUSES.has(String(article.status || ""))) throw new Error("Lo stato dell’articolo non consente di cambiare l’immagine da questo pannello");
  return { id, opportunity, article, state: articleImageState(opportunity) };
}

function cleanEditorialStringList(values, limit = 6, maxLength = 180) {
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanEditorialText(value, maxLength).replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, limit);
}

function editorialArticleVisualBriefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["primary_subject", "environment", "visual_story", "must_show", "must_avoid", "rationale"],
    properties: {
      primary_subject: { type: "string" },
      environment: { type: "string" },
      visual_story: { type: "string" },
      must_show: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } },
      must_avoid: { type: "array", minItems: 2, maxItems: 8, items: { type: "string" } },
      rationale: { type: "string" },
    },
  };
}

async function buildEditorialArticleVisualBrief(article, opportunity, guidance = "") {
  const content = cleanEditorialText(article?.content, 5000).replace(/[#*_`>-]+/g, " ").replace(/\s+/g, " ");
  const notes = cleanEditorialText(manualIdeaMeta(opportunity)?.notes, 1000);
  const extra = cleanEditorialText(guidance, 600);
  const input = [
    `Titolo articolo: ${cleanEditorialText(article?.title, 140)}.`,
    `Sommario: ${cleanEditorialText(article?.excerpt, 320)}.`,
    article?.category ? `Categoria: ${cleanEditorialText(article.category, 80)}.` : "",
    content ? `Contenuto: ${content}.` : "",
    notes ? `Note redazione: ${notes}.` : "",
    extra ? `Indicazioni di rigenerazione: ${extra}.` : "",
  ].filter(Boolean).join(" ");
  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      instructions: [
        "Sei un photo editor di una testata italiana di informazione al consumatore.",
        "Trasforma esclusivamente il contenuto fornito in un brief fotografico concreto e verificabile.",
        "Scegli un soggetto principale e una scena che rappresentino il nucleo specifico dell'articolo, non soltanto il settore generico.",
        "I must_show devono essere elementi fisicamente visibili e coerenti con fatti o contesti presenti nel testo.",
        "Evita cliché pubblicitari, scene stock generiche, elementi non supportati dall'articolo, interfacce inventate, testo leggibile e loghi.",
        "Se il tema è astratto, usa una scena reale che renda visibile il problema concreto senza inventare dati o documenti.",
      ].join(" "),
      input,
      reasoning: { effort: "low" },
      max_output_tokens: 1400,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_article_visual_brief",
          strict: true,
          schema: editorialArticleVisualBriefSchema(),
        },
      },
    },
    economics: { activity: "article_visual_brief", articleId: article?.id || null, opportunityId: opportunity?.id || null },
  });
  let parsed;
  try {
    parsed = JSON.parse(responseOutputText(response));
  } catch {
    throw new Error("Brief immagine articolo: risposta AI non interpretabile");
  }
  const brief = {
    primary_subject: cleanEditorialText(parsed?.primary_subject, 300),
    environment: cleanEditorialText(parsed?.environment, 300),
    visual_story: cleanEditorialText(parsed?.visual_story, 500),
    must_show: cleanEditorialStringList(parsed?.must_show, 6, 180),
    must_avoid: cleanEditorialStringList(parsed?.must_avoid, 8, 180),
    rationale: cleanEditorialText(parsed?.rationale, 500),
  };
  if (!brief.primary_subject || !brief.environment || !brief.visual_story || brief.must_show.length < 2) {
    throw new Error("Brief immagine articolo incompleto");
  }
  return brief;
}

function articleImagePrompt(article, opportunity, visualBrief, guidance = "") {
  const notes = cleanEditorialText(manualIdeaMeta(opportunity)?.notes, 800);
  const extra = cleanEditorialText(guidance, 600);
  const mustShow = cleanEditorialStringList(visualBrief?.must_show, 6, 180).join("; ");
  const mustAvoid = cleanEditorialStringList(visualBrief?.must_avoid, 8, 180).join("; ");
  return [
    "Create one entirely new, original high-resolution landscape editorial photograph from scratch for an Italian consumer-information article published by OffertaLogica.",
    "Use only the textual brief supplied here. Do not retrieve, reuse, trace, imitate, transform or derive from any existing web image, stock photograph, artwork, advertisement, brand campaign or third-party visual reference.",
    "Do not reproduce a recognizable copyrighted composition or the distinctive style of a named living artist or photographer.",
    `Article title: ${cleanEditorialText(article?.title, 140)}.`,
    `Article summary: ${cleanEditorialText(article?.excerpt, 320)}.`,
    article?.category ? `Editorial category: ${cleanEditorialText(article.category, 80)}.` : "",
    `Primary visual subject: ${cleanEditorialText(visualBrief?.primary_subject, 300)}.`,
    `Environment: ${cleanEditorialText(visualBrief?.environment, 300)}.`,
    `Visual story: ${cleanEditorialText(visualBrief?.visual_story, 500)}.`,
    mustShow ? `Elements that must be visibly represented: ${mustShow}.` : "",
    mustAvoid ? `Elements and interpretations to avoid: ${mustAvoid}.` : "",
    notes ? `Editorial notes: ${notes}.` : "",
    extra ? `Requested revision or visual direction from the editor: ${extra}.` : "",
    "Visual direction: photorealistic, premium editorial-journalism photography, natural believable lighting, contemporary Italian/European context when relevant, visually clear but not advertising-like.",
    "Composition: horizontal 3:2 hero image with an immediately understandable main subject. Give priority to the concrete visual anchors in the brief rather than a generic sector scene.",
    "Do not add text, captions, letters, numbers, logos, brand marks, watermarks, fake interfaces, readable documents, price tags, charts or infographic elements.",
    "Do not invent a specific real person, company, event or document that the article does not establish.",
    "The image must look like a real professional photograph, not an illustration, 3D render, collage or generic stock-ad composition.",
  ].filter(Boolean).join(" ");
}
function editorialImageQaSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["relevant", "clear", "misleading", "editorial_quality", "reason", "regeneration_guidance"],
    properties: {
      relevant: { type: "boolean" },
      clear: { type: "boolean" },
      misleading: { type: "boolean" },
      editorial_quality: { type: "boolean" },
      reason: { type: "string" },
      regeneration_guidance: { type: "string" },
    },
  };
}

function articleImageQaFailureCount(state) {
  const failed = (asset) => ["failed", "human_review_required"].includes(String(asset?.qa?.status || ""));
  return (Array.isArray(state?.history) ? state.history.filter(failed).length : 0)
    + (failed(state?.candidate) ? 1 : 0);
}

function isAutopilotGeneratedImageAsset(asset) {
  return Boolean(
    asset
    && asset.source === "generated"
    && asset.provider === "openai"
    && asset.generation_mode === "text_to_image"
    && asset.source_policy === EDITORIAL_IMAGE_SOURCE_POLICY
    && asset.url
    && asset.object_path
  );
}

async function evaluateEditorialArticleImage(article, candidate) {
  const imageUrl = String(candidate?.url || "").trim();
  if (!/^https:\/\//i.test(imageUrl)) throw new Error("QA immagine: URL candidato non valido");
  const title = cleanEditorialText(article?.title, 140);
  const excerpt = cleanEditorialText(article?.excerpt, 320);
  const content = cleanEditorialText(article?.content, 1600).replace(/[#*_`>-]+/g, " ").replace(/\s+/g, " ");
  const visualBrief = candidate?.visual_brief && typeof candidate.visual_brief === "object" ? candidate.visual_brief : null;
  const mustShow = cleanEditorialStringList(visualBrief?.must_show, 6, 180).join("; ");
  const inputText = [
    "Valuta questa immagine come hero editoriale per un articolo informativo italiano di OffertaLogica.",
    `Titolo: ${title}.`,
    `Sommario: ${excerpt}.`,
    content ? `Contesto articolo: ${content}.` : "",
    visualBrief?.primary_subject ? `Soggetto visivo richiesto: ${cleanEditorialText(visualBrief.primary_subject, 300)}.` : "",
    visualBrief?.visual_story ? `Scena richiesta: ${cleanEditorialText(visualBrief.visual_story, 500)}.` : "",
    mustShow ? `Elementi concreti attesi: ${mustShow}.` : "",
    "Criteri obbligatori: l'immagine deve essere chiaramente pertinente al tema specifico, rendere visibili gli elementi concreti richiesti, essere comprensibile a colpo d'occhio, non fuorviante e adatta a un articolo editoriale informativo.",
    "Non approvare una fotografia solo perché appartiene genericamente allo stesso settore dell'articolo.",
    "Non penalizzare l'assenza di testo nell'immagine: il testo sovrapposto è volutamente vietato.",
    "Se uno dei criteri fallisce, spiega in modo breve il problema e fornisci una direzione concreta per la rigenerazione. Se tutti passano, regeneration_guidance deve essere una stringa vuota.",
  ].filter(Boolean).join(" ");

  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      instructions: "Agisci come revisore visivo editoriale severo e prudente. Giudica il contenuto effettivamente visibile nell'immagine rispetto all'articolo fornito. Non approvare immagini solo genericamente belle o vagamente collegate al settore.",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: inputText },
          { type: "input_image", image_url: imageUrl, detail: "high" },
        ],
      }],
      reasoning: { effort: "low" },
      max_output_tokens: 1200,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_editorial_image_qa",
          strict: true,
          schema: editorialImageQaSchema(),
        },
      },
    },
    economics: { activity: "article_image_qa", articleId: article?.id || null },
  });
  const raw = responseOutputText(response);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("QA immagine: risposta AI non interpretabile");
  }
  const relevant = parsed?.relevant === true;
  const clear = parsed?.clear === true;
  const misleading = parsed?.misleading === true;
  const editorialQuality = parsed?.editorial_quality === true;
  const passed = relevant && clear && !misleading && editorialQuality;
  return {
    schema_version: 1,
    status: passed ? "passed" : "failed",
    evaluated_at: new Date().toISOString(),
    model: editorialAiModel(),
    relevant,
    clear,
    misleading,
    editorial_quality: editorialQuality,
    reason: cleanEditorialText(parsed?.reason, 600) || (passed ? "Immagine coerente con il tema e adatta alla pubblicazione editoriale." : "QA visiva non superata."),
    regeneration_guidance: passed ? "" : cleanEditorialText(parsed?.regeneration_guidance, 600),
    source_policy: EDITORIAL_IMAGE_SOURCE_POLICY,
  };
}

async function generateOpenAiArticleImage(article, opportunity, guidance = "") {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY non configurata lato server");
  const model = editorialImageModel();
  const visualBrief = await buildEditorialArticleVisualBrief(article, opportunity, guidance);
  const prompt = articleImagePrompt(article, opportunity, visualBrief, guidance);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDITORIAL_IMAGE_GENERATION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1536x1024",
        quality: "high",
        output_format: "jpeg",
        n: 1,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Timeout durante la generazione dell’immagine HD: riprova");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  await recordEditorialImageAiEconomicEvent({
    eventId: payload?.id || response.headers?.get?.("x-request-id") || `editorial-image:${crypto.randomUUID()}`,
    response: payload || {},
    model,
    outcome: response.ok ? "completed" : "failed",
    opportunityId: opportunity?.id || null,
    articleId: article?.id || null,
    size: "1536x1024",
    quality: "high",
    activity: "article_hero_image",
  }).catch(() => {});
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI Images ${response.status}`);
  const item = Array.isArray(payload?.data) ? payload.data[0] : null;
  let buffer = null;
  if (item?.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (item?.url) {
    const remote = await fetch(item.url, { cache: "no-store" });
    if (!remote.ok) throw new Error("Immagine generata non scaricabile");
    buffer = Buffer.from(await remote.arrayBuffer());
  }
  if (!buffer?.length) throw new Error("OpenAI non ha restituito un’immagine utilizzabile");
  if (buffer.length > EDITORIAL_IMAGE_MAX_BYTES) throw new Error("L’immagine HD generata supera 5 MB: rigenera l’immagine");
  return { model, prompt, buffer, visualBrief };
}

async function saveArticleImageState(user, opportunity, state) {
  const evidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
    article_image: state,
  };
  const rows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: new Date().toISOString(), decided_by: user.id },
  });
  if (!rows?.[0]?.id) throw new Error("Stato immagine articolo non salvato");
  return rows[0];
}

async function generateEditorialArticleImage(user, payload = {}) {
  const context = await articleImageContext(payload.id);
  if (!String(context.article.title || "").trim() || !String(context.article.content || "").trim()) {
    throw new Error("Completa prima la bozza dell’articolo: titolo e contenuto sono necessari per generare l’immagine dedicata");
  }
  const generated = await generateOpenAiArticleImage(context.article, context.opportunity, payload.guidance);
  const objectPath = `autopilot/${context.article.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;
  const imageUrl = await uploadEditorialImageBuffer(objectPath, generated.buffer, "image/jpeg");
  const now = new Date().toISOString();
  const candidate = {
    source: "generated",
    provider: "openai",
    generation_mode: "text_to_image",
    source_policy: EDITORIAL_IMAGE_SOURCE_POLICY,
    status: "pending_review",
    url: imageUrl,
    object_path: objectPath,
    mime_type: "image/jpeg",
    size: "1536x1024",
    quality: "high",
    model: generated.model,
    prompt: generated.prompt,
    visual_brief: generated.visualBrief,
    guidance: cleanEditorialText(payload.guidance, 600) || null,
    alt_text: defaultArticleImageAlt(context.article),
    created_at: now,
    created_by: user.id,
  };
  const state = {
    ...context.state,
    history: context.state.candidate
      ? imageHistoryAppend(context.state.history, context.state.candidate, "superseded")
      : context.state.history,
    candidate,
  };
  const opportunity = await saveArticleImageState(user, context.opportunity, state);
  return { candidate, current: state.current, opportunity_id: opportunity.id, article_id: context.article.id, featured_image_unchanged: true };
}

async function setEditorialArticleImageCandidate(user, payload = {}) {
  const context = await articleImageContext(payload.id);
  const imageUrl = String(payload.image_url || "").trim();
  const objectPath = editorialImageObjectPathFromUrl(imageUrl);
  if (!objectPath || !objectPath.startsWith(`${user.id}/`)) {
    throw new Error("L’immagine manuale deve provenire dal tuo spazio immagini editoriale OffertaLogica");
  }
  const altText = cleanEditorialText(payload.alt_text, 180) || defaultArticleImageAlt(context.article);
  const now = new Date().toISOString();
  const candidate = {
    source: "manual_upload",
    status: "pending_review",
    url: imageUrl,
    object_path: objectPath,
    mime_type: null,
    size: null,
    quality: "manual",
    model: null,
    prompt: null,
    guidance: null,
    alt_text: altText,
    created_at: now,
    created_by: user.id,
  };
  const state = {
    ...context.state,
    history: context.state.candidate
      ? imageHistoryAppend(context.state.history, context.state.candidate, "superseded")
      : context.state.history,
    candidate,
  };
  await saveArticleImageState(user, context.opportunity, state);
  return { candidate, current: state.current, article_id: context.article.id, featured_image_unchanged: true };
}

async function approveEditorialArticleImage(user, payload = {}) {
  const context = await articleImageContext(payload.id);
  const candidate = context.state.candidate;
  if (!candidate?.url) throw new Error("Genera o carica prima una nuova immagine da approvare");
  const altText = cleanEditorialText(payload.alt_text, 180) || cleanEditorialText(candidate.alt_text, 180) || defaultArticleImageAlt(context.article);
  const previousUrl = String(context.article.featured_image_url || "").trim();
  const rows = await editorialUserFetch(user, `editorial_articles?id=eq.${encodeURIComponent(context.article.id)}&select=*`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      featured_image_url: candidate.url,
      featured_image_alt: altText,
      updated_by: user.id,
    },
  });
  const article = rows?.[0];
  if (!article?.id) throw new Error("Immagine approvata ma collegamento all’articolo non confermato");
  const now = new Date().toISOString();
  let history = context.state.history;
  if (context.state.current?.url) {
    history = imageHistoryAppend(history, context.state.current, "replaced");
  } else if (previousUrl && previousUrl !== candidate.url) {
    history = imageHistoryAppend(history, {
      source: "preexisting",
      status: "previous_featured_image",
      url: previousUrl,
      alt_text: context.article.featured_image_alt || null,
    }, "replaced");
  }
  const current = {
    ...candidate,
    alt_text: altText,
    status: "approved",
    approved_at: now,
    approved_by: user.id,
  };
  const state = { ...context.state, current, candidate: null, history };
  try {
    await saveArticleImageState(user, context.opportunity, state);
  } catch (error) {
    await editorialUserFetch(user, `editorial_articles?id=eq.${encodeURIComponent(context.article.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        featured_image_url: context.article.featured_image_url || null,
        featured_image_alt: context.article.featured_image_alt || null,
        updated_by: user.id,
      },
    }).catch(() => {});
    throw error;
  }
  return {
    article: { id: article.id, featured_image_url: article.featured_image_url, featured_image_alt: article.featured_image_alt },
    current,
    candidate: null,
    replaced_previous_image: Boolean(previousUrl && previousUrl !== candidate.url),
  };
}

async function discardEditorialArticleImageCandidate(user, payload = {}) {
  const context = await articleImageContext(payload.id);
  if (!context.state.candidate) return { discarded: false, current: context.state.current, candidate: null };
  const state = {
    ...context.state,
    history: imageHistoryAppend(context.state.history, context.state.candidate, "discarded"),
    candidate: null,
  };
  await saveArticleImageState(user, context.opportunity, state);
  return { discarded: true, current: state.current, candidate: null };
}

function editorialAiModel() {
  return env("EDITORIAL_AI_MODEL") || EDITORIAL_AI_DEFAULT_MODEL;
}

function responseOutputText(payload) {
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function responseSourceUrls(payload) {
  const urls = new Set();
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type === "web_search_call") {
      for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) {
        if (typeof source?.url === "string") urls.add(source.url);
      }
    }
    if (item?.type === "message") {
      for (const content of Array.isArray(item?.content) ? item.content : []) {
        for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
          if (typeof annotation?.url === "string") urls.add(annotation.url);
          if (typeof annotation?.url_citation?.url === "string") urls.add(annotation.url_citation.url);
        }
      }
    }
  }
  return [...urls];
}

function normalizedHttps(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function articleEditorialFingerprint(article) {
  const stable = {
    title: String(article?.title || ""),
    slug: String(article?.slug || ""),
    category: String(article?.category || ""),
    excerpt: String(article?.excerpt || ""),
    content: String(article?.content || ""),
    sources: String(article?.sources || ""),
    seo_title: String(article?.seo_title || ""),
    seo_description: String(article?.seo_description || ""),
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

async function activeEditorialCategories() {
  const rows = await serviceFetch("editorial_categories?select=slug,name,active&active=eq.true&order=sort_order.asc,name.asc");
  return Array.isArray(rows) ? rows : [];
}

async function enabledPromotionTargets() {
  const rows = await serviceFetch("editorial_promotion_targets?select=id,label,url_path,category,enabled,sort_order&enabled=eq.true&order=sort_order.asc,label.asc");
  return Array.isArray(rows) ? rows : [];
}

async function editorialSocialChannels() {
  const rows = await serviceFetch("editorial_social_channels?select=platform,display_name,enabled,public_handle,sort_order&order=sort_order.asc");
  return Array.isArray(rows) ? rows : [];
}

async function editorialEnabledSocialPlatforms() {
  const channels = await editorialSocialChannels();
  return channels
    .filter((row) => row?.enabled && EDITORIAL_SOCIAL_PLATFORMS.has(String(row.platform || "")))
    .map((row) => String(row.platform));
}

function validateRequestedPlatforms(values, channels) {
  const enabled = new Set((channels || []).filter((row) => row.enabled).map((row) => row.platform));
  const requested = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()))]
    .filter((value) => EDITORIAL_SOCIAL_PLATFORMS.has(value));
  for (const platform of requested) {
    if (!enabled.has(platform)) throw new Error(`Il canale ${platform} non risulta collegato: non può essere preselezionato nel piano post`);
  }
  return requested;
}

function categorySlugForPackage(value, categories, opportunity) {
  const requested = String(value || "").trim().toLocaleLowerCase("it-IT");
  const opportunityCategory = String(opportunity?.category || "").trim().toLocaleLowerCase("it-IT");
  const rows = Array.isArray(categories) ? categories : [];
  const match = rows.find((row) => String(row.slug || "").toLocaleLowerCase("it-IT") === requested)
    || rows.find((row) => String(row.name || "").toLocaleLowerCase("it-IT") === requested)
    || rows.find((row) => String(row.slug || "").toLocaleLowerCase("it-IT") === opportunityCategory)
    || rows.find((row) => String(row.name || "").toLocaleLowerCase("it-IT") === opportunityCategory);
  if (!match?.slug) throw new Error("La generazione non ha restituito una categoria editoriale valida");
  return match.slug;
}

function editorialPackageSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "category_slug", "excerpt", "content", "seo_title", "seo_description", "sources", "posts"],
    properties: {
      title: { type: "string" },
      category_slug: { type: "string" },
      excerpt: { type: "string" },
      content: { type: "string" },
      seo_title: { type: "string" },
      seo_description: { type: "string" },
      sources: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url", "source_type"],
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            source_type: { type: "string", enum: ["primary", "secondary"] },
          },
        },
      },
      posts: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["post_type", "theme", "brief", "canonical_text", "destination_target_id"],
          properties: {
            post_type: { type: "string", enum: ["article_followup", "related"] },
            theme: { type: "string" },
            brief: { type: "string" },
            canonical_text: { type: "string" },
            destination_target_id: { type: ["string", "null"] },
          },
        },
      },
    },
  };
}

async function openAiResponseRequest(path, { method = "GET", body, economics = null } = {}) {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY non configurata lato server");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDITORIAL_AI_HTTP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`https://api.openai.com/v1/responses${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Timeout di connessione con il servizio AI");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  const hasBillableUsage = Boolean(payload?.usage) || (Array.isArray(payload?.output) && payload.output.some((item) => item?.type === "web_search_call"));
  if (economics && hasBillableUsage) {
    const eventId = String(payload?.id || response.headers?.get?.("x-request-id") || `editorial-support:${crypto.randomUUID()}`);
    await recordEditorialSupportAiEconomicEvent({
      eventId,
      response: payload || {},
      model: economics.model || body?.model || payload?.model || editorialAiModel(),
      outcome: response.ok ? "completed" : "failed",
      opportunityId: economics.opportunityId || null,
      articleId: economics.articleId || null,
      runSource: economics.runSource || "",
      activity: economics.activity || "editorial_support",
      socialPlanItemId: economics.socialPlanItemId || null,
    }).catch(() => {});
  }
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI ${response.status}`);
  return payload;
}

async function startOpenAiEditorialPackage({ opportunity, article, categories, targets }) {
  const model = editorialAiModel();
  const categoryList = categories.map((row) => `${row.slug} = ${row.name}`).join("\n");
  const targetList = targets.map((row) => `${row.id} | ${row.label} | ${row.url_path}${row.category ? ` | ${row.category}` : ""}`).join("\n");
  const manual = manualIdeaMeta(opportunity);
  const notes = cleanEditorialText(manual?.notes, 2000);
  const signal = opportunity?.evidence?.metrics ? JSON.stringify(opportunity.evidence.metrics) : "non disponibile";
  const editorialBrief = opportunityEditorialBrief(opportunity);
  const queryExamples = Array.isArray(editorialBrief.query_examples) ? editorialBrief.query_examples : [];
  const contextPages = Array.isArray(editorialBrief.context_pages) ? editorialBrief.context_pages : [];
  const radarEvidence = opportunity?.evidence?.source === "research_radar" ? opportunity.evidence.research_radar : null;
  const radarSources = Array.isArray(radarEvidence?.source_urls) ? radarEvidence.source_urls.slice(0, 6) : [];
  const radarTools = Array.isArray(radarEvidence?.related_targets) ? radarEvidence.related_targets.slice(0, 4) : [];
  const articleUrl = `https://offertalogica.it/articoli/${encodeURIComponent(article.slug)}.html`;
  const instructions = [
    "Sei il motore editoriale server-side di OffertaLogica.it.",
    "Devi preparare una bozza informativa in italiano, chiara e prudente, non un testo promozionale aggressivo.",
    "Usa il web search per verificare fatti attuali e preferisci fonti primarie/istituzionali quando disponibili.",
    "Non inventare dati, percentuali, norme, prezzi, date o dichiarazioni. Se un punto non è verificabile, omettilo.",
    "Il contenuto deve essere originale, non copiare passaggi estesi dalle fonti.",
    "Ottimizza la struttura per SEO e leggibilità: intento di ricerca chiaro, risposta utile nelle prime sezioni, intestazioni descrittive, entità e concetti espliciti, passaggi autosufficienti e facilmente comprensibili anche da sistemi di ricerca e assistenti AI.",
    "Quando utile inserisci nel Markdown link https pertinenti alle fonti e collegamenti interni OffertaLogica coerenti con le destinazioni fornite, senza forzature o keyword stuffing.",
    "Il campo content usa Markdown semplice con paragrafi, elenchi e intestazioni ## / ###. Non inserire HTML.",
    "Le fonti devono essere URL https realmente consultati durante la ricerca.",
    "Genera esattamente due post statici: article_followup rimanda all'articolo; related rimanda a UNA destinazione OffertaLogica consentita dall'elenco fornito.",
    "Non scegliere canali social: i canali sono decisi separatamente dalla Redazione.",
    "Non proporre Reel, video o TikTok come strategia. LinkedIn è gestito separatamente per il solo lancio dell’articolo e non deve comparire nei due post statici.",
    "Il BRIEF EDITORIALE fornito nell'input è vincolante per il taglio dell'articolo: il tema Search Console non va usato come semplice titolo se non descrive già chiaramente l'intento.",
    "Se il tema cita un marchio, prodotto o offerta, spiega prima che cosa sia e verifica condizioni e informazioni attuali da fonti affidabili; evita recensioni arbitrarie o conclusioni promozionali.",
    "Se il brief proviene dal Radar web e indica strumenti OffertaLogica pertinenti, usali solo quando rappresentano davvero il passo pratico successivo per il lettore; per il post related preferisci una di quelle destinazioni se resta coerente con il contenuto reale della pagina.",
  ].join(" ");
  const input = `ARGOMENTO: ${opportunity.topic}\nTIPO: nuovo articolo\nBRIEF EDITORIALE: ${editorialBrief.article_angle}\nINTENTO DI RICERCA: ${editorialBrief.search_intent}\nQUERY COLLEGATE: ${queryExamples.length ? queryExamples.join(" | ") : "non disponibili"}\nPAGINE OFFERTALOGICA GIÀ INTERCETTATE: ${contextPages.length ? contextPages.join(" | ") : "nessuna"}\nAZIONE RADAR: ${radarEvidence?.editorial_action || "non applicabile"}\nDIFFERENZA DA ARTICOLO ESISTENTE: ${cleanEditorialText(radarEvidence?.difference_from_existing, 900) || "non applicabile"}\nFONTI RADAR DA RIVERIFICARE: ${radarSources.length ? radarSources.join(" | ") : "nessuna"}\nSTRUMENTI OFFERTALOGICA PERTINENTI INDIVIDUATI DAL RADAR: ${radarTools.length ? radarTools.map((row) => `${row.label} (${row.url_path})`).join(" | ") : "nessuno"}\nNOTE REDAZIONE: ${notes || "nessuna"}\nSEGNALI SEARCH CONSOLE: ${signal}\nURL ARTICOLO DOPO PUBBLICAZIONE: ${articleUrl}\n\nCATEGORIE AMMESSE (restituisci esattamente uno slug):\n${categoryList}\n\nDESTINAZIONI PROMOZIONALI AMMESSE PER IL POST related (restituisci esattamente l'id scelto):\n${targetList || "nessuna"}\n\nVincoli editoriali: titolo <= 140 caratteri; excerpt <= 320; SEO title <= 70; SEO description <= 180; contenuto sostanziale, leggibile e realmente utile; almeno 2 fonti, includendo una fonte primaria se disponibile. Se AZIONE RADAR e' NEW_ANGLE, il contenuto deve rispettare la differenza editoriale indicata e non ripetere l'articolo esistente. Gli strumenti OffertaLogica vanno citati solo quando risolvono naturalmente il problema trattato. Il post article_followup deve includere il link ${articleUrl}. Il post related deve includere l'URL della destinazione consentita scelta.`;
  const payload = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model,
      tools: [{ type: "web_search", search_context_size: "high" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      instructions,
      input,
      reasoning: { effort: "medium" },
      max_output_tokens: 9000,
      background: true,
      store: true,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_editorial_package",
          strict: true,
          schema: editorialPackageSchema(),
        },
      },
    },
  });
  if (!payload?.id) throw new Error("Generazione editoriale non avviata");
  return { responseId: payload.id, status: payload.status || "queued", model };
}

async function retrieveOpenAiEditorialPackage(responseId) {
  const id = String(responseId || "").trim();
  if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) throw new Error("Identificativo generazione AI non valido");
  const include = encodeURIComponent("web_search_call.action.sources");
  return openAiResponseRequest(`/${encodeURIComponent(id)}?include%5B%5D=${include}`);
}

function sourceUrlKey(value) {
  const normalized = normalizedHttps(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

function validateGeneratedEditorialPackage(generated, { opportunity, categories, targets, settings, observedSourceUrls }) {
  const title = cleanEditorialText(generated?.title, 140);
  const excerpt = cleanEditorialText(generated?.excerpt, 320);
  const content = cleanEditorialText(generated?.content, 40000);
  const seoTitle = cleanEditorialText(generated?.seo_title, 70);
  const seoDescription = cleanEditorialText(generated?.seo_description, 180);
  if (title.length < 12) throw new Error("Titolo generato troppo breve");
  if (excerpt.length < 60) throw new Error("Sommario generato troppo breve");
  if (content.length < 1200) throw new Error("Contenuto generato troppo breve per una bozza editoriale completa");
  if (!seoTitle || !seoDescription) throw new Error("Metadati SEO non completi");
  const category = categorySlugForPackage(generated?.category_slug, categories, opportunity);

  const observed = new Set((observedSourceUrls || []).map(sourceUrlKey).filter(Boolean));
  const sources = [];
  for (const source of Array.isArray(generated?.sources) ? generated.sources : []) {
    const url = normalizedHttps(source?.url);
    if (!url) continue;
    if (observed.size && !observed.has(sourceUrlKey(url))) continue;
    if (sources.some((row) => row.url === url)) continue;
    sources.push({
      title: cleanEditorialText(source?.title, 240) || new URL(url).hostname,
      url,
      source_type: source?.source_type === "primary" ? "primary" : "secondary",
    });
  }
  if (Boolean(settings?.require_sources) && observed.size < 2) {
    throw new Error("QA fonti fallito: la ricerca web non ha restituito almeno 2 fonti verificabili");
  }
  if (Boolean(settings?.require_sources) && sources.length < 2) {
    throw new Error("QA fonti fallito: servono almeno 2 fonti web effettivamente usate dalla ricerca");
  }
  if (Boolean(settings?.require_primary_source) && sources.length && !sources.some((row) => row.source_type === "primary")) {
    throw new Error("QA fonti fallito: manca una fonte primaria");
  }

  const targetMap = new Map((targets || []).map((row) => [String(row.id), row]));
  const posts = [];
  for (const post of Array.isArray(generated?.posts) ? generated.posts : []) {
    const type = String(post?.post_type || "");
    if (!EDITORIAL_PLAN_POST_TYPES.has(type) || !["article_followup", "related"].includes(type)) continue;
    const destinationTargetId = post?.destination_target_id ? String(post.destination_target_id) : null;
    if (type === "related" && (!destinationTargetId || !targetMap.has(destinationTargetId))) {
      throw new Error("Il post collegato non usa una destinazione promozionale consentita");
    }
    posts.push({
      post_type: type,
      theme: cleanEditorialText(post?.theme, 240),
      brief: cleanEditorialText(post?.brief, 1200),
      canonical_text: cleanEditorialText(post?.canonical_text, 4000),
      destination_target_id: type === "related" ? destinationTargetId : null,
    });
  }
  if (posts.length !== 2 || new Set(posts.map((row) => row.post_type)).size !== 2) {
    throw new Error("QA post fallito: servono esattamente un follow-up articolo e un post collegato");
  }
  if (posts.some((row) => row.canonical_text.length < 80)) throw new Error("QA post fallito: testo social troppo breve");

  return {
    article: { title, category, excerpt, content, seo_title: seoTitle, seo_description: seoDescription },
    sources,
    posts,
    qa: {
      title_ok: true,
      excerpt_ok: true,
      content_min_length_ok: true,
      seo_ok: true,
      sources_count: sources.length,
      primary_source_present: sources.some((row) => row.source_type === "primary"),
      web_source_match_enforced: observed.size > 0,
      static_posts_count: posts.length,
      writes_publication: false,
    },
  };
}

async function upsertGeneratedSocialPlans(user, opportunity, article, posts, platforms) {
  const planPlatforms = [...new Set((Array.isArray(platforms) ? platforms : []).filter((platform) => EDITORIAL_PLAN_SOCIAL_PLATFORMS.has(String(platform || ""))))];
  const existing = await serviceFetch(
    `editorial_social_plan_items?select=id,post_type,status,source_article_id,opportunity_id&opportunity_id=eq.${encodeURIComponent(opportunity.id)}&source_article_id=eq.${encodeURIComponent(article.id)}&limit=20`,
  );
  const byType = new Map((existing || []).map((row) => [row.post_type, row]));
  const protectedRows = (existing || []).filter((row) => !["draft", "cancelled"].includes(String(row.status || "")));
  if (protectedRows.length) throw new Error("Esiste già un post del piano approvato o in lavorazione: rigenerazione bloccata");
  const now = new Date().toISOString();
  const result = [];
  for (const post of posts) {
    const current = byType.get(post.post_type);
    const body = {
      source_article_id: article.id,
      opportunity_id: opportunity.id,
      post_type: post.post_type,
      destination_target_id: post.destination_target_id,
      theme: post.theme || opportunity.topic,
      brief: post.brief || null,
      canonical_text: post.canonical_text,
      platforms: planPlatforms,
      scheduled_for: null,
      status: "draft",
      updated_at: now,
      updated_by: user.id,
    };
    let rows;
    if (current?.id) {
      rows = await serviceFetch(`editorial_social_plan_items?id=eq.${encodeURIComponent(current.id)}`, {
        method: "PATCH", prefer: "return=representation", body,
      });
    } else {
      rows = await serviceFetch("editorial_social_plan_items", {
        method: "POST", prefer: "return=representation", body: { ...body, created_by: user.id },
      });
    }
    if (!rows?.[0]?.id) throw new Error("Piano post statici non salvato");
    result.push(rows[0]);
  }
  return result;
}

async function automationRunStart(opportunityId, source = "manual_controlled_run") {
  const rows = await serviceFetch("editorial_automation_runs", {
    method: "POST",
    prefer: "return=representation",
    body: {
      run_type: "article_prepare",
      status: "running",
      started_at: new Date().toISOString(),
      opportunity_id: opportunityId,
      details: { version: VERSION, source },
    },
  });
  return rows?.[0] || null;
}

async function automationRunFinish(run, status, patch = {}) {
  if (!run?.id) return;
  const body = {
    status,
    finished_at: new Date().toISOString(),
    details: patch.details || run.details || {},
    last_error: patch.last_error || null,
  };
  if (Object.prototype.hasOwnProperty.call(patch, "opportunity_id") || run.opportunity_id) body.opportunity_id = patch.opportunity_id || run.opportunity_id || null;
  if (Object.prototype.hasOwnProperty.call(patch, "article_id") || run.article_id) body.article_id = patch.article_id || run.article_id || null;
  if (Object.prototype.hasOwnProperty.call(patch, "social_plan_item_id") || run.social_plan_item_id) body.social_plan_item_id = patch.social_plan_item_id || run.social_plan_item_id || null;
  await serviceFetch(`editorial_automation_runs?id=eq.${encodeURIComponent(run.id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body,
  }).catch(() => {});
}

async function generateEditorialArticlePackage(user, payload = {}) {
  const id = String(payload.id || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  let opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  if (opportunity.status !== "selected") throw new Error("Seleziona prima l’opportunità");
  if (opportunity.opportunity_type !== "new_article") throw new Error("La generazione completa è disponibile solo per un nuovo articolo");

  const existingJob = opportunity?.evidence?.article_generation_job;
  if (existingJob?.response_id && ["queued", "in_progress"].includes(String(existingJob.status || ""))) {
    return {
      pending: true,
      status: existingJob.status,
      response_id: existingJob.response_id,
      started_at: existingJob.started_at || null,
      article_id: existingJob.article_id || opportunity.target_article_id || null,
    };
  }

  const [categories, targets, channels] = await Promise.all([
    activeEditorialCategories(),
    enabledPromotionTargets(),
    editorialSocialChannels(),
  ]);
  const platforms = validateRequestedPlatforms(payload.platforms, channels);
  if (!categories.length) throw new Error("Nessuna categoria editoriale attiva disponibile");
  if (!targets.length) throw new Error("Nessuna destinazione promozionale attiva disponibile per il post collegato");

  const draftResult = await prepareEditorialDraft(user, id);
  const articleId = draftResult?.article?.id;
  if (!articleId) throw new Error("Bozza articolo non disponibile");
  const articleRows = await serviceFetch(`editorial_articles?select=*&id=eq.${encodeURIComponent(articleId)}&limit=1`);
  const article = articleRows?.[0];
  if (!article) throw new Error("Bozza articolo non trovata");
  if (article.status !== "draft") throw new Error("La generazione può aggiornare solo una bozza ancora in stato Bozza");

  opportunity = (await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  ))?.[0] || opportunity;
  const previousGeneration = opportunity?.evidence?.article_generation;
  const currentFingerprint = articleEditorialFingerprint(article);
  const hasEditorialContent = Boolean(String(article.content || "").trim() || String(article.excerpt || "").trim());
  if (hasEditorialContent && (!previousGeneration?.article_fingerprint_sha256 || previousGeneration.article_fingerprint_sha256 !== currentFingerprint)) {
    throw new Error("La bozza contiene modifiche manuali o contenuto non generato dall’Autopilota: sovrascrittura bloccata");
  }

  const runSource = user?._automation ? "scheduler" : "manual_controlled_run";
  const run = await automationRunStart(id, runSource);
  try {
    const ai = await startOpenAiEditorialPackage({ opportunity, article, categories, targets });
    const now = new Date().toISOString();
    const job = {
      schema_version: 1,
      status: ai.status,
      started_at: now,
      started_by: user.id,
      checked_at: now,
      model: ai.model,
      response_id: ai.responseId,
      article_id: article.id,
      article_fingerprint_sha256: currentFingerprint,
      automation_run_id: run?.id || null,
      platforms,
      automatic_publish: false,
      source: runSource,
    };
    const evidence = {
      ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
      article_generation_job: job,
    };
    const savedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: { evidence, target_article_id: article.id, updated_at: now, decided_by: user.id },
    });
    if (!savedRows?.[0]?.id) throw new Error("Stato generazione asincrona non salvato");
    return {
      pending: true,
      status: ai.status,
      response_id: ai.responseId,
      started_at: now,
      article_id: article.id,
      automatic_publish: false,
    };
  } catch (error) {
    await automationRunFinish(run, "failed", {
      article_id: article?.id || null,
      last_error: String(error?.message || error).slice(0, 2000),
      details: { version: VERSION, source: runSource, opportunity_id: id, publication_performed: false },
    });
    throw error;
  }
}

async function checkEditorialArticlePackage(user, payload = {}) {
  const id = String(payload.id || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  const evidenceBase = opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const job = evidenceBase.article_generation_job;
  const completedGeneration = evidenceBase.article_generation;
  const runSource = String(job?.source || (user?._automation ? "scheduler" : "manual_controlled_run"));
  if (!job?.response_id) {
    if (completedGeneration?.status === "draft_ready_for_review") {
      return { pending: false, status: "completed", qa: completedGeneration.qa || {}, generation: completedGeneration };
    }
    throw new Error("Nessuna generazione editoriale in corso");
  }
  if (job.status === "completed" && completedGeneration?.response_id === job.response_id) {
    return { pending: false, status: "completed", qa: completedGeneration.qa || {}, generation: completedGeneration };
  }
  if (["failed", "cancelled", "incomplete"].includes(String(job.status || ""))) {
    throw new Error(job.last_error || `Generazione editoriale terminata con stato ${job.status}`);
  }

  const response = await retrieveOpenAiEditorialPackage(job.response_id);
  const status = String(response?.status || "");
  if (!["queued", "in_progress"].includes(status)) {
    await recordEditorialArticleAiEconomicEvent({
      eventId: response?.id || job.response_id,
      response: response || {},
      model: job.model || editorialAiModel(),
      outcome: status === "completed" ? "completed" : "failed",
      opportunityId: id,
      articleId: job.article_id || opportunity.target_article_id || null,
      runSource,
    }).catch(() => {});
  }
  if (["queued", "in_progress"].includes(status)) {
    const now = new Date().toISOString();
    const nextEvidence = {
      ...evidenceBase,
      article_generation_job: { ...job, status, checked_at: now },
    };
    await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { evidence: nextEvidence, updated_at: now },
    });
    return { pending: true, status, response_id: job.response_id, started_at: job.started_at || null };
  }

  const runRef = job.automation_run_id ? { id: job.automation_run_id, details: { version: VERSION, source: runSource } } : null;
  if (status !== "completed") {
    const message = response?.error?.message || response?.incomplete_details?.reason || `Generazione editoriale terminata con stato ${status || "sconosciuto"}`;
    const now = new Date().toISOString();
    const nextEvidence = {
      ...evidenceBase,
      article_generation_job: { ...job, status: status || "failed", checked_at: now, finished_at: now, last_error: String(message).slice(0, 2000) },
    };
    await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", prefer: "return=minimal", body: { evidence: nextEvidence, updated_at: now },
    }).catch(() => {});
    await automationRunFinish(runRef, "failed", {
      article_id: job.article_id || opportunity.target_article_id || null,
      last_error: String(message).slice(0, 2000),
      details: { version: VERSION, source: runSource, opportunity_id: id, publication_performed: false },
    });
    throw new Error(message);
  }

  const [settingsRows, categories, targets] = await Promise.all([
    serviceFetch("editorial_automation_settings?select=*&id=eq.1&limit=1"),
    activeEditorialCategories(),
    enabledPromotionTargets(),
  ]);
  const settings = settingsRows?.[0] || {};
  if (!categories.length) throw new Error("Nessuna categoria editoriale attiva disponibile");
  if (!targets.length) throw new Error("Nessuna destinazione promozionale attiva disponibile per il post collegato");
  const articleId = job.article_id || opportunity.target_article_id;
  if (!validUuid(articleId)) throw new Error("Bozza articolo associata alla generazione non valida");
  const articleRows = await serviceFetch(`editorial_articles?select=*&id=eq.${encodeURIComponent(articleId)}&limit=1`);
  let article = articleRows?.[0];
  if (!article) throw new Error("Bozza articolo non trovata");
  if (article.status !== "draft") throw new Error("La generazione può completare solo una bozza ancora in stato Bozza");
  if (job.article_fingerprint_sha256 && articleEditorialFingerprint(article) !== job.article_fingerprint_sha256) {
    const message = "La bozza è stata modificata manualmente durante la generazione: risultato AI non applicato";
    const now = new Date().toISOString();
    const nextEvidence = {
      ...evidenceBase,
      article_generation_job: { ...job, status: "failed", checked_at: now, finished_at: now, last_error: message },
    };
    await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", prefer: "return=minimal", body: { evidence: nextEvidence, updated_at: now },
    }).catch(() => {});
    await automationRunFinish(runRef, "failed", {
      article_id: article.id,
      last_error: message,
      details: { version: VERSION, source: runSource, opportunity_id: id, publication_performed: false },
    });
    throw new Error(message);
  }

  let validated;
  let sourceUrls;
  try {
    const text = responseOutputText(response);
    if (!text) throw new Error("La generazione non ha restituito contenuto strutturato");
    let generated;
    try { generated = JSON.parse(text); }
    catch { throw new Error("Risposta editoriale non interpretabile"); }
    sourceUrls = responseSourceUrls(response);
    validated = validateGeneratedEditorialPackage(generated, {
      opportunity, categories, targets, settings, observedSourceUrls: sourceUrls,
    });
  } catch (error) {
    const now = new Date().toISOString();
    const nextEvidence = {
      ...evidenceBase,
      article_generation_job: { ...job, status: "failed", checked_at: now, finished_at: now, last_error: String(error?.message || error).slice(0, 2000) },
    };
    await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", prefer: "return=minimal", body: { evidence: nextEvidence, updated_at: now },
    }).catch(() => {});
    await automationRunFinish(runRef, "failed", {
      article_id: article.id,
      last_error: String(error?.message || error).slice(0, 2000),
      details: { version: VERSION, source: runSource, opportunity_id: id, publication_performed: false, background: true },
    });
    throw error;
  }

  const originalArticle = { ...article };
  let articleUpdated = false;
  try {
    const sourcesText = validated.sources.map((source) => `${source.title} — ${source.url}`).join("\n").slice(0, 4000);
    article = await editorialArticleUpdateDraft(user, article.id, {
      title: validated.article.title,
      category: validated.article.category,
      excerpt: validated.article.excerpt,
      content: validated.article.content,
      sources: sourcesText || null,
      seo_title: validated.article.seo_title,
      seo_description: validated.article.seo_description,
      updated_by: user.id,
    });
    if (!article?.id) throw new Error("Bozza articolo generata ma non salvata");
    articleUpdated = true;

    const platforms = Array.isArray(job.platforms) ? job.platforms : [];
    const plans = await upsertGeneratedSocialPlans(user, opportunity, article, validated.posts, platforms);
    const articleFingerprint = articleEditorialFingerprint(article);
    const now = new Date().toISOString();
    const generation = {
      schema_version: 2,
      status: "draft_ready_for_review",
      generated_at: now,
      generated_by: user.id,
      model: job.model || editorialAiModel(),
      response_id: job.response_id,
      article_fingerprint_sha256: articleFingerprint,
      web_source_urls: sourceUrls,
      sources: validated.sources,
      qa: validated.qa,
      social_plan_item_ids: plans.map((row) => row.id),
      platforms,
      automatic_publish: false,
      background: true,
    };
    const nextEvidence = {
      ...evidenceBase,
      article_generation: generation,
      article_generation_job: { ...job, status: "completed", checked_at: now, finished_at: now },
    };
    const opportunityRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: { evidence: nextEvidence, target_article_id: article.id, updated_at: now, decided_by: user.id },
    });
    const updatedOpportunity = opportunityRows?.[0];
    if (!updatedOpportunity?.id) throw new Error("Metadati generazione non salvati");
    await automationRunFinish(runRef, "success", {
      article_id: article.id,
      social_plan_item_id: plans?.[0]?.id || null,
      details: {
        version: VERSION,
        source: runSource,
        model: generation.model,
        opportunity_id: id,
        qa: validated.qa,
        sources_count: validated.sources.length,
        social_plan_item_ids: plans.map((row) => row.id),
        platforms,
        publication_performed: false,
        background: true,
      },
    });
    return {
      pending: false,
      status: "completed",
      article: { id: article.id, title: article.title, slug: article.slug, status: article.status, category: article.category },
      opportunity: updatedOpportunity,
      qa: validated.qa,
      sources: validated.sources,
      plans,
      model: generation.model,
      automatic_publish: false,
    };
  } catch (error) {
    if (articleUpdated && originalArticle?.id) {
      await editorialArticleUpdateDraft(user, originalArticle.id, {
        title: originalArticle.title,
        category: originalArticle.category,
        excerpt: originalArticle.excerpt,
        content: originalArticle.content,
        sources: originalArticle.sources,
        seo_title: originalArticle.seo_title,
        seo_description: originalArticle.seo_description,
        updated_by: user.id,
      }).catch(() => {});
    }
    const now = new Date().toISOString();
    const nextEvidence = {
      ...evidenceBase,
      article_generation_job: { ...job, status: "failed", checked_at: now, finished_at: now, last_error: String(error?.message || error).slice(0, 2000) },
    };
    await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", prefer: "return=minimal", body: { evidence: nextEvidence, updated_at: now },
    }).catch(() => {});
    await automationRunFinish(runRef, "failed", {
      article_id: article?.id || null,
      last_error: String(error?.message || error).slice(0, 2000),
      details: { version: VERSION, source: runSource, opportunity_id: id, publication_performed: false, background: true },
    });
    throw error;
  }
}

async function deleteEditorialDraftArticle(user, payload = {}) {
  const articleId = String(payload.article_id || "").trim();
  if (!validUuid(articleId)) throw new Error("Identificativo articolo non valido");

  const articleRows = await serviceFetch(
    `editorial_articles?select=id,title,status,featured_image_url,featured_image_alt,created_by&id=eq.${encodeURIComponent(articleId)}&limit=1`,
  );
  const article = articleRows?.[0];
  if (!article) throw new Error("Articolo non trovato");
  if (String(article.status || "") !== "draft") {
    throw new Error("Solo una bozza può essere eliminata definitivamente. Per gli altri stati usa Archivia.");
  }

  const opportunities = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&target_article_id=eq.${encodeURIComponent(articleId)}&limit=20`,
  );
  const socialItems = await serviceFetch(
    `editorial_social_plan_items?select=*&source_article_id=eq.${encodeURIComponent(articleId)}&limit=100`,
  );
  const protectedSocialItems = (socialItems || []).filter((row) => !["draft", "cancelled"].includes(String(row.status || "")));
  if (protectedSocialItems.length) {
    throw new Error("La bozza ha post social già approvati o avviati: annullali prima di eliminare l’articolo");
  }

  const imagePaths = new Set();
  const generatedPrefix = `autopilot/${articleId}/`;
  const featuredPath = editorialImageObjectPathFromUrl(article.featured_image_url);
  if (featuredPath?.startsWith(generatedPrefix)) imagePaths.add(featuredPath);
  for (const opportunity of opportunities || []) {
    const state = articleImageState(opportunity);
    for (const asset of [state.current, state.candidate, ...(state.history || [])]) {
      const objectPath = String(asset?.object_path || "").trim();
      if (objectPath.startsWith(generatedPrefix)) imagePaths.add(objectPath);
    }
    const socialAssets = editorialSocialAssetsState(opportunity);
    const introAssets = [
      socialAssets.article_intro?.card,
      ...((Array.isArray(socialAssets.article_intro?.card_history) ? socialAssets.article_intro.card_history : [])),
    ];
    for (const image of introAssets) {
      const objectPath = String(image?.object_path || "").trim();
      if (objectPath.startsWith(generatedPrefix)) imagePaths.add(objectPath);
    }
    for (const socialAsset of Object.values(socialAssets.items || {})) {
      const generatedAssets = [
        socialAsset?.image,
        ...((Array.isArray(socialAsset?.history) ? socialAsset.history : [])),
        socialAsset?.card,
        ...((Array.isArray(socialAsset?.card_history) ? socialAsset.card_history : [])),
      ];
      for (const image of generatedAssets) {
        const objectPath = String(image?.object_path || "").trim();
        if (objectPath.startsWith(generatedPrefix)) imagePaths.add(objectPath);
      }
    }
  }

  const socialIds = (socialItems || []).map((row) => String(row.id || "")).filter(validUuid);
  if (socialIds.length) {
    await serviceFetch(
      `editorial_automation_runs?social_plan_item_id=in.(${socialIds.map((id) => encodeURIComponent(id)).join(",")})`,
      { method: "PATCH", prefer: "return=minimal", body: { social_plan_item_id: null } },
    );
  }
  await serviceFetch(`editorial_automation_runs?article_id=eq.${encodeURIComponent(articleId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { article_id: null },
  });

  if (socialItems?.length) {
    await serviceFetch(`editorial_social_plan_items?source_article_id=eq.${encodeURIComponent(articleId)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
  }
  await serviceFetch(`editorial_article_notes?article_id=eq.${encodeURIComponent(articleId)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  const now = new Date().toISOString();
  for (const opportunity of opportunities || []) {
    const evidence = opportunity?.evidence && typeof opportunity.evidence === "object"
      ? { ...opportunity.evidence }
      : {};
    delete evidence.article_generation;
    delete evidence.article_generation_job;
    delete evidence.article_image;
    await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        target_article_id: null,
        evidence,
        updated_at: now,
        decided_by: user.id,
      },
    });
  }

  const deletedRows = await serviceFetch(`editorial_articles?id=eq.${encodeURIComponent(articleId)}&select=id`, {
    method: "DELETE",
    prefer: "return=representation",
  });
  if (!deletedRows?.[0]?.id) throw new Error("Eliminazione articolo non confermata");

  const storage = await deleteEditorialImageObjects([...imagePaths]);
  return {
    deleted: true,
    article_id: articleId,
    opportunity_ids: (opportunities || []).map((row) => row.id).filter(Boolean),
    social_plan_items_deleted: (socialItems || []).length,
    generated_images_deleted: storage.deleted,
    storage_warning: storage.warning,
    opportunity_reset: Boolean((opportunities || []).length),
  };
}

async function editorialSocialPlanPayload() {
  // Il piano deve restare consultabile anche se un arricchimento secondario
  // (canali, destinazioni o contenuto completo degli articoli) fallisce.
  // In passato Promise.all rendeva l'intera vista indisponibile con HTTP 500.
  const items = await serviceFetch("editorial_social_plan_items?select=*&order=updated_at.desc&limit=50");
  const warnings = [];

  let channels = [];
  try {
    channels = await editorialSocialChannels();
  } catch (error) {
    warnings.push(`channels: ${String(error?.message || error)}`);
    console.warn("editorial_social_plan_channels_unavailable", error);
  }

  const targetIds = [...new Set((items || [])
    .map((row) => String(row.destination_target_id || "").trim())
    .filter(validUuid))];
  const articleIds = [...new Set((items || [])
    .map((row) => String(row.source_article_id || "").trim())
    .filter(validUuid))];
  const opportunityIds = [...new Set((items || [])
    .map((row) => String(row.opportunity_id || "").trim())
    .filter(validUuid))];

  const targets = [];
  for (let index = 0; index < targetIds.length; index += 12) {
    const chunk = targetIds.slice(index, index + 12);
    try {
      const rows = await serviceFetch(`editorial_promotion_targets?select=id,label,url_path,category&id=in.(${chunk.map((id) => encodeURIComponent(id)).join(",")})`);
      targets.push(...(Array.isArray(rows) ? rows : []));
    } catch (error) {
      warnings.push(`targets: ${String(error?.message || error)}`);
      console.warn("editorial_social_plan_targets_unavailable", error);
      break;
    }
  }

  const articles = [];
  for (let index = 0; index < articleIds.length; index += 8) {
    const chunk = articleIds.slice(index, index + 8);
    const ids = chunk.map((id) => encodeURIComponent(id)).join(",");
    try {
      const rows = await serviceFetch(`editorial_articles?select=id,title,slug,status,published_at,created_at,updated_at,excerpt,content,sources,featured_image_url,featured_image_alt&id=in.(${ids})`);
      articles.push(...(Array.isArray(rows) ? rows : []));
    } catch (error) {
      // Fallback leggero: stato e piano rimangono visibili anche se il payload
      // editoriale completo è troppo grande o una colonna non è disponibile.
      try {
        const rows = await serviceFetch(`editorial_articles?select=id,title,slug,status,published_at,created_at,updated_at,excerpt,featured_image_url,featured_image_alt&id=in.(${ids})`);
        articles.push(...(Array.isArray(rows) ? rows : []));
        warnings.push(`article_detail_reduced: ${String(error?.message || error)}`);
        console.warn("editorial_social_plan_article_detail_reduced", error);
      } catch (fallbackError) {
        warnings.push(`articles: ${String(fallbackError?.message || fallbackError)}`);
        console.warn("editorial_social_plan_articles_unavailable", fallbackError);
      }
    }
  }

  const opportunities = [];
  for (let index = 0; index < opportunityIds.length; index += 8) {
    const chunk = opportunityIds.slice(index, index + 8);
    try {
      const rows = await serviceFetch(`editorial_research_opportunities?select=id,evidence&id=in.(${chunk.map((id) => encodeURIComponent(id)).join(",")})`);
      opportunities.push(...(Array.isArray(rows) ? rows : []));
    } catch (error) {
      warnings.push(`social_assets: ${String(error?.message || error)}`);
      console.warn("editorial_social_plan_assets_unavailable", error);
      break;
    }
  }

  const compactSocialAsset = (asset) => {
    if (!asset || typeof asset !== "object") return null;
    const qa = asset.image?.qa && typeof asset.image.qa === "object" ? asset.image.qa : null;
    return {
      status: String(asset.status || ""),
      updated_at: asset.updated_at || null,
      brief: asset.brief ? {
        content_version: asset.brief.content_version || null,
        article_takeaway: asset.brief.article_takeaway || null,
        destination_solution: asset.brief.destination_solution || null,
        copy_qa: asset.brief.copy_qa ? {
          status: asset.brief.copy_qa.status || null,
          reason: asset.brief.copy_qa.reason || null,
          rewrite_guidance: asset.brief.copy_qa.rewrite_guidance || null,
        } : null,
      } : null,
      image: asset.image?.url ? {
        source: asset.image.source || null,
        url: asset.image.url,
        alt_text: asset.image.alt_text || null,
        attempt: Number(asset.image.attempt || 0) || null,
        qa: qa ? {
          status: qa.status || null,
          reason: qa.reason || null,
          regeneration_guidance: qa.regeneration_guidance || null,
          approval_mode: qa.approval_mode || null,
          evaluated_at: qa.evaluated_at || null,
        } : null,
      } : null,
      card: asset.card?.url ? {
        url: asset.card.url,
        source: asset.card.source || null,
        renderer: asset.card.renderer || null,
        template_version: asset.card.template_version || null,
      } : null,
    };
  };

  const targetMap = new Map((targets || []).map((row) => [row.id, row]));
  const articleMap = new Map((articles || []).map((row) => [row.id, row]));
  const opportunityMap = new Map((opportunities || []).map((row) => [row.id, row]));
  return {
    ok: true,
    version: VERSION,
    warnings,
    channels,
    items: (items || []).map((row) => {
      const opportunity = opportunityMap.get(row.opportunity_id) || null;
      const socialAsset = opportunity?.evidence?.social_assets?.items?.[row.id] || null;
      return {
        ...row,
        destination_target: targetMap.get(row.destination_target_id) || null,
        source_article: articleMap.get(row.source_article_id) || null,
        source_article_image: articleMap.get(row.source_article_id) || null,
        social_asset: compactSocialAsset(socialAsset),
      };
    }),
  };
}

async function updateEditorialSocialPlanItem(user, payload = {}) {
  const id = String(payload.id || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo post non valido");
  const currentRows = await serviceFetch(`editorial_social_plan_items?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const current = currentRows?.[0];
  if (!current) throw new Error("Post del piano non trovato");
  if (["publishing", "published", "failed"].includes(String(current.status || ""))) {
    throw new Error("Un post già avviato o pubblicato non può essere modificato da questo pannello");
  }
  const channels = await editorialSocialChannels();
  const platforms = validateRequestedPlatforms(payload.platforms, channels)
    .filter((platform) => EDITORIAL_PLAN_SOCIAL_PLATFORMS.has(String(platform || "")));
  const status = String(payload.status || current.status || "draft");
  if (!EDITORIAL_PLAN_EDITABLE_STATUSES.has(status)) throw new Error("Stato post non modificabile da questo pannello");
  const canonicalText = cleanEditorialText(payload.canonical_text ?? current.canonical_text, 4000);
  if (!canonicalText) throw new Error("Il testo del post non può essere vuoto");
  const theme = cleanEditorialText(payload.theme ?? current.theme, 240) || null;
  const brief = cleanEditorialText(payload.brief ?? current.brief, 1200) || null;
  const rows = await serviceFetch(`editorial_social_plan_items?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      theme,
      brief,
      canonical_text: canonicalText,
      platforms,
      status,
      scheduled_for: null,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
  });
  if (!rows?.[0]?.id) throw new Error("Post del piano non aggiornato");
  return rows[0];
}


function editorialSocialAssetsState(opportunity) {
  const raw = opportunity?.evidence?.social_assets;
  const safe = raw && typeof raw === "object" ? raw : {};
  const items = safe?.items && typeof safe.items === "object" ? safe.items : {};
  const articleIntro = safe?.article_intro && typeof safe.article_intro === "object" ? safe.article_intro : null;
  return { ...safe, schema_version: 2, article_intro: articleIntro ? { ...articleIntro } : null, items: { ...items } };
}

async function saveEditorialSocialAssetsState(user, opportunity, state) {
  const evidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
    social_assets: state,
  };
  const rows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: new Date().toISOString(), decided_by: user.id },
  });
  if (!rows?.[0]?.id) throw new Error("Asset social: stato non salvato");
  return rows[0];
}

async function editorialSocialAssetTarget(item) {
  if (String(item?.post_type || "") !== "related") return null;
  const id = String(item?.destination_target_id || "").trim();
  if (!validUuid(id)) throw new Error("Asset social related: destinazione OffertaLogica non valida");
  const rows = await serviceFetch(
    `editorial_promotion_targets?select=id,label,url_path,category,enabled&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const target = rows?.[0] || null;
  if (!target?.enabled) throw new Error("Asset social related: destinazione OffertaLogica non disponibile");
  return target;
}

function editorialSocialAssetFingerprint(article, item, target, articleImageUrl) {
  return crypto.createHash("sha256").update(JSON.stringify({
    article_id: article?.id || null,
    article_title: article?.title || "",
    article_excerpt: article?.excerpt || "",
    article_content: String(article?.content || "").slice(0, 8000),
    article_image_url: articleImageUrl || "",
    plan_item_id: item?.id || null,
    post_type: item?.post_type || "",
    theme: item?.theme || "",
    brief: item?.brief || "",
    canonical_text: item?.canonical_text || "",
    destination_target_id: item?.destination_target_id || null,
    target_label: target?.label || "",
    target_url_path: target?.url_path || "",
    target_category: target?.category || "",
    content_version: EDITORIAL_SOCIAL_CONTENT_VERSION,
  })).digest("hex");
}

function editorialSocialAssetBriefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["article_takeaway", "destination_solution", "facebook_text", "instagram_text", "cover_title", "cover_summary", "visual_subject", "visual_scene", "must_show", "must_avoid", "alt_text"],
    properties: {
      article_takeaway: { type: "string" },
      destination_solution: { type: "string" },
      facebook_text: { type: "string" },
      instagram_text: { type: "string" },
      cover_title: { type: "string" },
      cover_summary: { type: "string" },
      visual_subject: { type: "string" },
      visual_scene: { type: "string" },
      must_show: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } },
      must_avoid: { type: "array", minItems: 2, maxItems: 8, items: { type: "string" } },
      alt_text: { type: "string" },
    },
  };
}

function editorialArticleIntroCopySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["facebook_text", "instagram_text", "linkedin_text"],
    properties: {
      facebook_text: { type: "string" },
      instagram_text: { type: "string" },
      linkedin_text: { type: "string" },
    },
  };
}

function editorialSocialCoverTextSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["cover_title", "cover_summary"],
    properties: {
      cover_title: { type: "string" },
      cover_summary: { type: "string" },
    },
  };
}

function cleanEditorialSocialCopy(value, maxLength) {
  return cleanEditorialText(value, maxLength)
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\blink\s+in\s+bio\b/gi, "Approfondisci dal profilo OffertaLogica")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function editorialArticleIntroAssetFingerprint(article, articleImageUrl) {
  return crypto.createHash("sha256").update(JSON.stringify({
    article_id: article?.id || null,
    article_title: article?.title || "",
    article_excerpt: article?.excerpt || "",
    article_content: String(article?.content || "").slice(0, 8000),
    article_image_url: articleImageUrl || "",
    card_template_version: EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION,
  })).digest("hex");
}

function editorialSocialCoverLabel() {
  return "IN SINTESI";
}

function editorialSocialBriefHasCover(brief) {
  return Boolean(
    cleanEditorialText(brief?.cover_title, 220).length >= 24
    && cleanEditorialText(brief?.cover_summary, 420).length >= 70
  );
}

async function buildEditorialArticleIntroCopy(article) {
  const content = cleanEditorialText(article?.content, 4200).replace(/[#*_`>-]+/g, " ").replace(/\s+/g, " ");
  const input = [
    `Titolo articolo: ${cleanEditorialText(article?.title, 140)}.`,
    `Sommario articolo: ${cleanEditorialText(article?.excerpt, 320)}.`,
    content ? `Contesto articolo: ${content}.` : "",
  ].filter(Boolean).join(" ");
  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      instructions: [
        "Sei il social editor di OffertaLogica.it. Scrivi il testo di lancio di un nuovo articolo usando esclusivamente le informazioni fornite.",
        "Non duplicare titolo e sommario: apri con il problema o con il punto utile per il lettore e sintetizza in modo naturale perché vale la pena approfondire.",
        "facebook_text: 220-650 caratteri, 2-4 frasi, tono informativo e concreto, nessun URL perché verrà aggiunto dal sistema.",
        "instagram_text: 220-800 caratteri, 2-5 frasi, nessun URL e nessun 'link in bio'. Chiudi, se utile, con un invito neutro ad approfondire dal profilo OffertaLogica.",
        "linkedin_text: 300-900 caratteri, 3-6 frasi. Tono professionale e sostanziale: problema o tesi dell'articolo → elemento concreto utile → perché conta. Nessun URL perché il post LinkedIn userà l'articolo come contenuto collegato.",
        "Per LinkedIn non usare hashtag-spam, formule motivazionali, linguaggio da vendita o una copia del testo Facebook.",
        "Non usare emoji, promesse di risparmio, slogan aggressivi o informazioni non presenti nell'articolo.",
      ].join(" "),
      input,
      reasoning: { effort: "low" },
      max_output_tokens: 1200,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_article_intro_social_copy",
          strict: true,
          schema: editorialArticleIntroCopySchema(),
        },
      },
    },
    economics: { activity: "article_intro_social_copy", articleId: article?.id || null },
  });
  let parsed;
  try {
    parsed = JSON.parse(responseOutputText(response));
  } catch {
    throw new Error("Asset social articolo: copy AI non interpretabile");
  }
  const copy = {
    facebook_text: cleanEditorialSocialCopy(parsed?.facebook_text, 850),
    instagram_text: cleanEditorialSocialCopy(parsed?.instagram_text, 1000),
    linkedin_text: cleanEditorialSocialCopy(parsed?.linkedin_text, 1200),
  };
  if (copy.facebook_text.length < 120 || copy.instagram_text.length < 120 || copy.linkedin_text.length < 180) {
    throw new Error("Asset social articolo: copy incompleto");
  }
  return copy;
}

async function renderAndUploadEditorialSocialCard({ article, sourceImageUrl, postType, title, summary, label, storageSegment }) {
  const normalizedSourceImageUrl = String(sourceImageUrl || "").trim();
  const common = {
    template_version: EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION,
    post_type: postType,
    source_image_url: normalizedSourceImageUrl,
    label: label || editorialSocialCoverLabel(postType),
    title: cleanEditorialText(title, 220),
    summary: cleanEditorialText(summary, 420),
    alt_text: `Cover OffertaLogica Informa: ${cleanEditorialText(title, 160)}`.slice(0, 180),
    created_at: new Date().toISOString(),
  };
  try {
    const renderEditorialSocialCard = await editorialSocialCardRenderer();
    const rendered = await renderEditorialSocialCard({
      sourceImageUrl: normalizedSourceImageUrl,
      postType,
      label: common.label,
      title,
      summary,
    });
    if (!rendered?.buffer?.length) throw new Error("Cover social: rendering non riuscito");
    if (rendered.buffer.length > EDITORIAL_IMAGE_MAX_BYTES) throw new Error("Cover social: file finale oltre 5 MB");
    const segment = cleanEditorialText(storageSegment, 120).replace(/[^a-zA-Z0-9_-]+/g, "-") || "card";
    const objectPath = `autopilot/${article.id}/social/${segment}/${Date.now()}-${crypto.randomUUID()}.jpg`;
    const url = await uploadEditorialImageBuffer(objectPath, rendered.buffer, rendered.mimeType || "image/jpeg");
    return {
      ...common,
      source: "composed",
      renderer: rendered.renderer || "resvg_wasm",
      template_version: rendered.templateVersion || EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION,
      url,
      object_path: objectPath,
      mime_type: rendered.mimeType || "image/jpeg",
      width: rendered.width || 1080,
      height: rendered.height || 1350,
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    console.warn("editorial_social_card_renderer_failed", message);
    throw new Error(`Cover social OL Informa non generata: ${message}`);
  }
}

function editorialSocialDestinationContent(html) {
  const source = String(html || "");
  const mainMatch = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const useful = String(mainMatch?.[1] || bodyMatch?.[1] || source)
    .replace(/<(script|style|noscript|svg|template|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  return cleanEditorialText(plainHtmlText(useful), 7000);
}

async function editorialSocialTargetContext(target) {
  if (!target) return null;
  const internalUrl = schedulerInternalPageUrl(target.url_path);
  if (!internalUrl) return {
    url: null,
    label: cleanEditorialText(target.label, 180),
    category: cleanEditorialText(target.category, 80) || null,
    title: "",
    h1: "",
    description: "",
    content: "",
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDITORIAL_PAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(internalUrl, {
      headers: { "User-Agent": "OffertaLogica-Editorial-Social-Asset/1.0" },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = (await response.text()).slice(0, TARGET_PAGE_MAX_BYTES);
    return {
      url: internalUrl,
      label: cleanEditorialText(target.label, 180),
      category: cleanEditorialText(target.category, 80) || null,
      title: firstTagText(html, "title"),
      h1: firstTagText(html, "h1"),
      description: metaDescription(html),
      content: editorialSocialDestinationContent(html),
    };
  } catch {
    return {
      url: internalUrl,
      label: cleanEditorialText(target.label, 180),
      category: cleanEditorialText(target.category, 80) || null,
      title: "",
      h1: "",
      description: "",
      content: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildEditorialSocialCoverText(article, item, target, targetContext = null, existingBrief = null) {
  const destination = target
    ? `${cleanEditorialText(target.label, 180)} | ${cleanEditorialText(target.url_path, 500)}${target.category ? ` | ${cleanEditorialText(target.category, 80)}` : ""}`
    : `Articolo OffertaLogica: ${cleanEditorialText(article?.title, 140)}`;
  const input = [
    `Tipo post: ${cleanEditorialText(item?.post_type, 40)}.`,
    `Tema piano: ${cleanEditorialText(item?.theme, 240)}.`,
    `Titolo articolo: ${cleanEditorialText(article?.title, 140)}.`,
    `Sommario articolo: ${cleanEditorialText(article?.excerpt, 320)}.`,
    item?.canonical_text ? `Testo canonico del post, solo come contesto: ${cleanEditorialText(item.canonical_text, 1800)}.` : "",
    existingBrief?.article_takeaway ? `Takeaway editoriale già verificato dell'articolo: ${cleanEditorialText(existingBrief.article_takeaway, 900)}.` : "",
    existingBrief?.destination_solution ? `Descrizione verificata della funzione OffertaLogica: ${cleanEditorialText(existingBrief.destination_solution, 1000)}.` : "",
    existingBrief?.facebook_text ? `Copy Facebook già approvato: ${cleanEditorialText(existingBrief.facebook_text, 900)}.` : "",
    existingBrief?.instagram_text ? `Copy Instagram già approvato: ${cleanEditorialText(existingBrief.instagram_text, 1100)}.` : "",
    `Destinazione effettiva: ${destination}.`,
    targetContext?.title ? `Titolo pagina destinazione: ${cleanEditorialText(targetContext.title, 300)}.` : "",
    targetContext?.h1 ? `H1 pagina destinazione: ${cleanEditorialText(targetContext.h1, 300)}.` : "",
    targetContext?.description ? `Descrizione pagina destinazione: ${cleanEditorialText(targetContext.description, 500)}.` : "",
    targetContext?.content ? `Contenuto reale della pagina destinazione: ${cleanEditorialText(targetContext.content, 3500)}.` : "",
  ].filter(Boolean).join(" ");
  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      instructions: [
        "Scrivi solo il titolo e la micro-sintesi per una cover social OffertaLogica. Usa esclusivamente i contenuti forniti.",
        "La cover deve aggiungere un angolo editoriale, non copiare il titolo dell'articolo e non fare promesse non dimostrate.",
        "Per article_followup parti dal takeaway editoriale verificato: la micro-sintesi deve dire qualcosa di concreto che il lettore impara o può controllare, non limitarsi a invitare alla lettura.",
        "Per related parti dal takeaway dell'articolo e dalla descrizione verificata della funzione OffertaLogica: rendi chiaro il passaggio problema → utilità concreta della funzione, senza slogan.",
        "cover_title: 35-95 caratteri, leggibile anche da solo.",
        "cover_summary: 90-190 caratteri, una frase autonoma che completa il titolo senza ripeterlo.",
        "Niente URL, hashtag, emoji o slogan promozionali generici.",
      ].join(" "),
      input,
      reasoning: { effort: "low" },
      max_output_tokens: 700,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_social_cover_text",
          strict: true,
          schema: editorialSocialCoverTextSchema(),
        },
      },
    },
    economics: { activity: "social_cover_text", articleId: article?.id || null, socialPlanItemId: item?.id || null },
  });
  let parsed;
  try {
    parsed = JSON.parse(responseOutputText(response));
  } catch {
    throw new Error("Cover social: testo AI non interpretabile");
  }
  const cover = {
    cover_title: cleanEditorialText(parsed?.cover_title, 220),
    cover_summary: cleanEditorialText(parsed?.cover_summary, 420),
  };
  if (!editorialSocialBriefHasCover(cover)) throw new Error("Cover social: testo incompleto");
  return cover;
}

async function buildEditorialSocialAssetBrief(article, item, target, targetContext = null, qualityGuidance = "") {
  const related = String(item?.post_type || "") === "related";
  const content = cleanEditorialText(article?.content, 7000).replace(/[#*_`>-]+/g, " ").replace(/\s+/g, " ");
  const destination = target
    ? `${cleanEditorialText(target.label, 180)} | ${cleanEditorialText(target.url_path, 500)}${target.category ? ` | ${cleanEditorialText(target.category, 80)}` : ""}`
    : `Articolo OffertaLogica: ${cleanEditorialText(article?.title, 140)}`;
  const destinationContent = cleanEditorialText(targetContext?.content, 6500);
  const input = [
    `Tipo post: ${cleanEditorialText(item?.post_type, 40)}.`,
    `Tema piano: ${cleanEditorialText(item?.theme, 240)}.`,
    item?.brief ? `Brief originale: ${cleanEditorialText(item.brief, 1200)}.` : "",
    item?.canonical_text ? `Testo canonico esistente, da usare solo come contesto e non da copiare: ${cleanEditorialText(item.canonical_text, 2200)}.` : "",
    `Titolo articolo: ${cleanEditorialText(article?.title, 140)}.`,
    `Sommario articolo: ${cleanEditorialText(article?.excerpt, 320)}.`,
    content ? `Contenuto completo disponibile dell'articolo: ${content}.` : "",
    `Destinazione effettiva del post: ${destination}.`,
    targetContext?.title ? `Titolo reale della pagina di destinazione: ${cleanEditorialText(targetContext.title, 300)}.` : "",
    targetContext?.h1 ? `H1 reale della pagina di destinazione: ${cleanEditorialText(targetContext.h1, 300)}.` : "",
    targetContext?.description ? `Descrizione reale della pagina di destinazione: ${cleanEditorialText(targetContext.description, 500)}.` : "",
    destinationContent ? `Contenuto reale della pagina di destinazione: ${destinationContent}.` : "",
    qualityGuidance ? `Correzione obbligatoria richiesta dalla revisione precedente: ${cleanEditorialText(qualityGuidance, 900)}.` : "",
  ].filter(Boolean).join(" ");
  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      instructions: [
        "Sei il social editor senior di OffertaLogica.it. Prepara una base editoriale solida e poi i testi social usando esclusivamente i contenuti forniti.",
        "Prima costruisci article_takeaway: 220-520 caratteri, 2-4 frasi. Deve spiegare il nucleo utile dell'articolo, includere almeno un elemento concreto che il lettore può riconoscere, verificare o capire meglio e spiegare perché conta. Non deve essere una CTA, un riassunto vago o la copia del titolo/sommario.",
        related
          ? "Per destination_solution usa esclusivamente la pagina OffertaLogica fornita: 240-650 caratteri, 2-4 frasi. Descrivi concretamente cosa permette di fare la funzione/pagina, quali dati o azioni dell'utente considera se sono esplicitamente indicati, quale risultato o informazione restituisce e in quale situazione è utile. Se uno di questi elementi non è supportato dalla pagina, omettilo: non inventare funzioni."
          : "Per article_followup destination_solution deve essere una stringa vuota.",
        "Il post non deve sembrare il duplicato dell'articolo: sviluppa il takeaway, non ripetere titolo ed excerpt quasi alla lettera.",
        "Per article_followup il copy deve portare a casa una spiegazione utile anche senza clic: problema o concetto concreto → cosa significa → cosa controllare/capire → invito neutro ad approfondire l'articolo.",
        "Per related costruisci una connessione esplicita e verificabile: problema concreto emerso nell'articolo → perché conta → funzione reale OffertaLogica pertinente → cosa può fare davvero il lettore con quella funzione. La funzione OffertaLogica deve occupare una parte sostanziale del testo, non una CTA finale generica.",
        "Per related NON usare formule come 'Soluzione OffertaLogica', 'trovi la soluzione', 'soluzione collegata', 'approfondisci dal profilo', 'scopri come può aiutarti' o equivalenti. Descrivi la funzione reale.",
        "facebook_text: 320-760 caratteri, 3-5 frasi, apertura concreta, tono informativo, nessun URL perché verrà aggiunto dal sistema.",
        "instagram_text: 320-900 caratteri, 3-6 frasi, nessun URL e nessun 'link in bio'. Una CTA neutra è ammessa solo dopo aver dato contenuto sostanziale.",
        "cover_title: 35-95 caratteri. Deve essere naturale, specifico e immediatamente comprensibile anche senza leggere la caption.",
        "cover_summary: 100-190 caratteri. Deve condensare il takeaway o, per related, il collegamento concreto alla funzione OffertaLogica senza slogan e senza ripetere il titolo.",
        "Non usare hashtag, emoji, promesse di risparmio, slogan aggressivi, formule promozionali generiche o dettagli non verificabili.",
        "Il visuale deve essere una nuova fotografia quadrata 1:1, pronta per essere inserita nella cover social OffertaLogica, pertinente al tema specifico e chiaramente diversa per composizione e messaggio dalla hero dell'articolo.",
        "Per related il visuale deve rappresentare il problema o l'attività concreta del post; non deve illustrare genericamente una 'soluzione'. Non mostrare loghi, testo, prezzi, bollette leggibili o interfacce inventate.",
      ].join(" "),
      input,
      reasoning: { effort: "low" },
      max_output_tokens: 2400,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_social_asset_brief",
          strict: true,
          schema: editorialSocialAssetBriefSchema(),
        },
      },
    },
    economics: { activity: "social_asset_brief", articleId: article?.id || null, socialPlanItemId: item?.id || null },
  });
  let parsed;
  try {
    parsed = JSON.parse(responseOutputText(response));
  } catch {
    throw new Error("Asset social: brief AI non interpretabile");
  }
  const brief = {
    content_version: EDITORIAL_SOCIAL_CONTENT_VERSION,
    article_takeaway: cleanEditorialText(parsed?.article_takeaway, 900),
    destination_solution: cleanEditorialText(parsed?.destination_solution, 1000),
    facebook_text: cleanEditorialSocialCopy(parsed?.facebook_text, 1000),
    instagram_text: cleanEditorialSocialCopy(parsed?.instagram_text, 1200),
    cover_title: cleanEditorialText(parsed?.cover_title, 220),
    cover_summary: cleanEditorialText(parsed?.cover_summary, 420),
    visual_subject: cleanEditorialText(parsed?.visual_subject, 320),
    visual_scene: cleanEditorialText(parsed?.visual_scene, 600),
    must_show: cleanEditorialStringList(parsed?.must_show, 6, 180),
    must_avoid: cleanEditorialStringList(parsed?.must_avoid, 8, 180),
    alt_text: cleanEditorialText(parsed?.alt_text, 180),
  };
  const foundationReady = brief.article_takeaway.length >= 180
    && (!related || brief.destination_solution.length >= 180);
  if (!foundationReady || brief.facebook_text.length < 180 || brief.instagram_text.length < 180 || !editorialSocialBriefHasCover(brief) || !brief.visual_subject || !brief.visual_scene || brief.must_show.length < 2) {
    throw new Error("Asset social: brief editoriale incompleto");
  }
  return brief;
}

function editorialSocialCopyQaSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["article_takeaway_grounded", "article_takeaway_substantive", "destination_solution_grounded", "destination_solution_specific", "connection_clear", "grounded_in_article", "grounded_in_destination", "specific_not_generic", "natural_professional_language", "cover_clear", "misleading", "reason", "rewrite_guidance"],
    properties: {
      article_takeaway_grounded: { type: "boolean" },
      article_takeaway_substantive: { type: "boolean" },
      destination_solution_grounded: { type: "boolean" },
      destination_solution_specific: { type: "boolean" },
      connection_clear: { type: "boolean" },
      grounded_in_article: { type: "boolean" },
      grounded_in_destination: { type: "boolean" },
      specific_not_generic: { type: "boolean" },
      natural_professional_language: { type: "boolean" },
      cover_clear: { type: "boolean" },
      misleading: { type: "boolean" },
      reason: { type: "string" },
      rewrite_guidance: { type: "string" },
    },
  };
}

async function evaluateEditorialSocialCopy(article, item, target, targetContext, brief) {
  const related = String(item?.post_type || "") === "related";
  const articleContent = cleanEditorialText(article?.content, 7000).replace(/[#*_`>-]+/g, " ").replace(/\s+/g, " ");
  const destinationContent = cleanEditorialText(targetContext?.content, 6500);
  const text = [
    `Tipo post: ${cleanEditorialText(item?.post_type, 40)}.`,
    `Titolo articolo: ${cleanEditorialText(article?.title, 160)}.`,
    `Sommario articolo: ${cleanEditorialText(article?.excerpt, 360)}.`,
    articleContent ? `Contenuto articolo disponibile al revisore: ${articleContent}.` : "",
    target ? `Destinazione prevista: ${cleanEditorialText(target.label, 180)} | ${cleanEditorialText(target.url_path, 500)}.` : "Nessuna destinazione diversa dall'articolo.",
    targetContext?.title ? `Titolo pagina destinazione: ${cleanEditorialText(targetContext.title, 300)}.` : "",
    targetContext?.h1 ? `H1 pagina destinazione: ${cleanEditorialText(targetContext.h1, 300)}.` : "",
    targetContext?.description ? `Descrizione pagina destinazione: ${cleanEditorialText(targetContext.description, 500)}.` : "",
    destinationContent ? `Contenuto reale pagina destinazione: ${destinationContent}.` : "",
    `Takeaway articolo proposto: ${cleanEditorialText(brief?.article_takeaway, 900)}.`,
    related ? `Descrizione funzione OffertaLogica proposta: ${cleanEditorialText(brief?.destination_solution, 1000)}.` : "",
    `Titolo card proposto: ${cleanEditorialText(brief?.cover_title, 220)}.`,
    `Sintesi card proposta: ${cleanEditorialText(brief?.cover_summary, 420)}.`,
    `Caption Facebook proposta: ${cleanEditorialText(brief?.facebook_text, 1000)}.`,
    `Caption Instagram proposta: ${cleanEditorialText(brief?.instagram_text, 1200)}.`,
  ].filter(Boolean).join(" ");
  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      instructions: [
        "Sei il revisore editoriale finale di OffertaLogica Informa. Sii severo sui fatti ma valuta la qualità editoriale in modo pratico: approva solo testi sostanziosi, chiari e realmente utili.",
        "article_takeaway_grounded è vero solo se il takeaway è interamente sostenuto dal contenuto dell'articolo e non introduce dettagli plausibili ma non presenti.",
        "article_takeaway_substantive è vero solo se il takeaway spiega almeno un elemento concreto dell'articolo e perché conta; è falso per riassunti generici, parafrasi del titolo o CTA.",
        related
          ? "destination_solution_grounded è vero solo se ogni funzione descritta è sostenuta dal contenuto reale della pagina OffertaLogica fornita. Non inferire funzioni da ciò che il servizio potrebbe fare."
          : "Per article_followup imposta destination_solution_grounded=true.",
        related
          ? "destination_solution_specific è vero solo se il testo spiega concretamente che cosa consente di fare la funzione/pagina e almeno un altro elemento verificabile tra dati/azioni considerate, risultato restituito o situazione d'uso. Un semplice 'confronta/verifica la tua offerta' senza spiegazione non basta."
          : "Per article_followup imposta destination_solution_specific=true.",
        related
          ? "connection_clear è vero solo se il copy collega esplicitamente un problema o punto dell'articolo alla funzione OffertaLogica e spiega perché quella funzione è pertinente."
          : "Per article_followup connection_clear=true se il copy sviluppa coerentemente il takeaway e rimanda all'articolo.",
        "grounded_in_article è vero solo se takeaway, titolo, sintesi e caption derivano chiaramente dall'articolo e non introducono affermazioni nuove.",
        related
          ? "grounded_in_destination è vero solo se il collegamento e le funzioni OffertaLogica sono verificabili nel contenuto reale della pagina, non soltanto coerenti con il suo nome."
          : "Per questo post non esiste una destinazione distinta: imposta grounded_in_destination=true se il copy rimanda correttamente all'articolo.",
        "specific_not_generic è falso se titolo, sintesi o caption potrebbero essere riutilizzati quasi identici per un altro articolo o un'altra funzione OffertaLogica.",
        "natural_professional_language è falso per formule macchinose, burocratiche, da report o promozionali inserite a forza.",
        "cover_clear è vero solo se titolo e sintesi della card comunicano già un'informazione utile e specifica, non una CTA travestita da contenuto.",
        "misleading è vero se il copy promette risultati, risparmi, automatismi o funzioni non dimostrate dalle informazioni fornite.",
        "Se qualcosa non va, rewrite_guidance deve indicare esattamente quale affermazione togliere, quale parte rendere più concreta e quali elementi verificati usare. Se tutto va bene, rewrite_guidance deve essere vuoto.",
      ].join(" "),
      input: text,
      reasoning: { effort: "low" },
      max_output_tokens: 1300,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_social_copy_qa",
          strict: true,
          schema: editorialSocialCopyQaSchema(),
        },
      },
    },
    economics: { activity: "social_copy_qa", articleId: article?.id || null, socialPlanItemId: item?.id || null },
  });
  let parsed;
  try { parsed = JSON.parse(responseOutputText(response)); }
  catch { throw new Error("QA copy social: risposta AI non interpretabile"); }
  const passed = parsed?.article_takeaway_grounded === true
    && parsed?.article_takeaway_substantive === true
    && parsed?.destination_solution_grounded === true
    && parsed?.destination_solution_specific === true
    && parsed?.connection_clear === true
    && parsed?.grounded_in_article === true
    && parsed?.grounded_in_destination === true
    && parsed?.specific_not_generic === true
    && parsed?.natural_professional_language === true
    && parsed?.cover_clear === true
    && parsed?.misleading !== true;
  return {
    schema_version: 2,
    status: passed ? "passed" : "failed",
    evaluated_at: new Date().toISOString(),
    model: editorialAiModel(),
    article_takeaway_grounded: parsed?.article_takeaway_grounded === true,
    article_takeaway_substantive: parsed?.article_takeaway_substantive === true,
    destination_solution_grounded: parsed?.destination_solution_grounded === true,
    destination_solution_specific: parsed?.destination_solution_specific === true,
    connection_clear: parsed?.connection_clear === true,
    grounded_in_article: parsed?.grounded_in_article === true,
    grounded_in_destination: parsed?.grounded_in_destination === true,
    specific_not_generic: parsed?.specific_not_generic === true,
    natural_professional_language: parsed?.natural_professional_language === true,
    cover_clear: parsed?.cover_clear === true,
    misleading: parsed?.misleading === true,
    reason: cleanEditorialText(parsed?.reason, 900),
    rewrite_guidance: passed ? "" : cleanEditorialText(parsed?.rewrite_guidance, 900),
  };
}

function editorialSocialImagePrompt(article, item, target, brief, guidance = "") {
  const mustShow = cleanEditorialStringList(brief?.must_show, 6, 180).join("; ");
  const mustAvoid = cleanEditorialStringList(brief?.must_avoid, 8, 180).join("; ");
  const extra = cleanEditorialText(guidance, 600);
  return [
    "Create one entirely new, original high-resolution square editorial photograph from scratch for a static social post by OffertaLogica.it.",
    "The image must be based only on the supplied editorial context and must not copy, trace, imitate or transform an existing image.",
    `Post type: ${cleanEditorialText(item?.post_type, 40)}.`,
    `Article topic: ${cleanEditorialText(article?.title, 140)}.`,
    target ? `OffertaLogica destination context: ${cleanEditorialText(target.label, 180)}.` : "",
    `Primary visual subject: ${cleanEditorialText(brief?.visual_subject, 320)}.`,
    `Visual scene: ${cleanEditorialText(brief?.visual_scene, 600)}.`,
    mustShow ? `Elements that must be visible: ${mustShow}.` : "",
    mustAvoid ? `Elements to avoid: ${mustAvoid}.` : "",
    extra ? `Regeneration guidance: ${extra}.` : "",
    "Composition: square 1:1 social-feed image, one clear focal point, strong crop, natural believable lighting, professional Italian/European editorial photography.",
    "Make the composition and visual emphasis clearly different from a generic article hero image. It must work as a standalone social visual, not as a second copy of the article cover or as a generic advertising image.",
    "Do not add readable text, captions, logos, brand marks, watermarks, prices, fake interfaces or infographic overlays. When the subject is a bill, contract or structured document, non-readable rows, boxes, sections, tabs and tiny blurred chart-like shapes are allowed only to make the document type visually recognizable.",
    "Do not invent a specific real person, company, event, document or measurable result that the supplied context does not establish.",
    "Prefer a believable real-world editorial scene tied to the actual activity, equipment or environment described by the article; one clear subject, natural perspective, no staged advertising pose.",
    "Do not use thermal-camera or infrared effects, heat-map overlays, glowing energy effects, abstract energy beams, oversized utility meters or generic visual metaphors unless the supplied context explicitly requires them.",
    "For related posts, visualize the concrete problem or activity from the article, not an abstract 'OffertaLogica solution'; the card text provides the editorial connection.",
    "The result must look like a real photograph, not an illustration, collage, 3D render or generic stock advertisement.",
  ].filter(Boolean).join(" ");
}

async function generateOpenAiSocialImage(article, item, target, brief, guidance = "") {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY non configurata lato server");
  const model = editorialImageModel();
  const prompt = editorialSocialImagePrompt(article, item, target, brief, guidance);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDITORIAL_IMAGE_GENERATION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        size: EDITORIAL_SOCIAL_IMAGE_SIZE,
        quality: "high",
        output_format: "jpeg",
        n: 1,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Timeout durante la generazione dell'immagine social: riprova");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  await recordEditorialImageAiEconomicEvent({
    eventId: payload?.id || response.headers?.get?.("x-request-id") || `editorial-social-image:${crypto.randomUUID()}`,
    response: payload || {},
    model,
    outcome: response.ok ? "completed" : "failed",
    articleId: article?.id || null,
    socialPlanItemId: item?.id || null,
    size: EDITORIAL_SOCIAL_IMAGE_SIZE,
    quality: "high",
    activity: "social_image",
  }).catch(() => {});
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI Images ${response.status}`);
  const itemPayload = Array.isArray(payload?.data) ? payload.data[0] : null;
  let buffer = null;
  if (itemPayload?.b64_json) buffer = Buffer.from(itemPayload.b64_json, "base64");
  else if (itemPayload?.url) {
    const remote = await fetch(itemPayload.url, { cache: "no-store" });
    if (!remote.ok) throw new Error("Immagine social generata non scaricabile");
    buffer = Buffer.from(await remote.arrayBuffer());
  }
  if (!buffer?.length) throw new Error("OpenAI non ha restituito un'immagine social utilizzabile");
  if (buffer.length > EDITORIAL_IMAGE_MAX_BYTES) throw new Error("L'immagine social generata supera 5 MB");
  return { model, prompt, buffer };
}

function editorialSocialImageQaSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["relevant_to_article", "relevant_to_destination", "distinct_from_article_image", "clear", "misleading", "social_quality", "reason", "regeneration_guidance"],
    properties: {
      relevant_to_article: { type: "boolean" },
      relevant_to_destination: { type: "boolean" },
      distinct_from_article_image: { type: "boolean" },
      clear: { type: "boolean" },
      misleading: { type: "boolean" },
      social_quality: { type: "boolean" },
      reason: { type: "string" },
      regeneration_guidance: { type: "string" },
    },
  };
}

async function evaluateEditorialSocialImage(article, item, target, brief, image, articleImageUrl) {
  const imageUrl = String(image?.url || "").trim();
  const heroUrl = String(articleImageUrl || "").trim();
  if (!/^https:\/\//i.test(imageUrl) || !/^https:\/\//i.test(heroUrl)) throw new Error("QA immagine social: URL non valido");
  const inputText = [
    "Valuta la prima immagine come visuale quadrato 1:1 di un post social OffertaLogica. La seconda immagine è la hero dell'articolo e serve solo per verificare che il post social non sia un doppione visivo.",
    `Titolo articolo: ${cleanEditorialText(article?.title, 140)}.`,
    `Tipo post: ${cleanEditorialText(item?.post_type, 40)}.`,
    `Tema post: ${cleanEditorialText(item?.theme, 240)}.`,
    target ? `Destinazione OffertaLogica: ${cleanEditorialText(target.label, 180)}.` : "Destinazione: articolo collegato.",
    `Soggetto richiesto: ${cleanEditorialText(brief?.visual_subject, 320)}.`,
    `Scena richiesta: ${cleanEditorialText(brief?.visual_scene, 600)}.`,
    `Elementi attesi: ${cleanEditorialStringList(brief?.must_show, 6, 180).join("; ")}.`,
    "Criteri obbligatori: pertinenza specifica all'articolo, pertinenza all'angolo/destinazione del post, chiarezza a colpo d'occhio, qualità da feed social, assenza di elementi fuorvianti e differenza visiva sostanziale rispetto alla hero dell'articolo.",
    "distinct_from_article_image è vero solo se soggetto, inquadratura o messaggio visivo cambiano abbastanza da non apparire come la stessa foto/copia nella griglia social.",
    "Se un criterio fallisce, fornisci una direzione concreta per rigenerare; altrimenti regeneration_guidance deve essere vuoto.",
  ].filter(Boolean).join(" ");
  const response = await openAiResponseRequest("", {
    method: "POST",
    body: {
      model: editorialAiModel(),
      instructions: "Agisci come revisore social visuale severo. Non approvare immagini genericamente pertinenti o troppo simili alla hero dell'articolo.",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: inputText },
          { type: "input_image", image_url: imageUrl, detail: "high" },
          { type: "input_image", image_url: heroUrl, detail: "high" },
        ],
      }],
      reasoning: { effort: "low" },
      max_output_tokens: 1400,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "offertalogica_social_image_qa",
          strict: true,
          schema: editorialSocialImageQaSchema(),
        },
      },
    },
    economics: { activity: "social_image_qa", articleId: article?.id || null, socialPlanItemId: item?.id || null },
  });
  let parsed;
  try {
    parsed = JSON.parse(responseOutputText(response));
  } catch {
    throw new Error("QA immagine social: risposta AI non interpretabile");
  }
  const relevantArticle = parsed?.relevant_to_article === true;
  const relevantDestination = parsed?.relevant_to_destination === true;
  const distinct = parsed?.distinct_from_article_image === true;
  const clear = parsed?.clear === true;
  const misleading = parsed?.misleading === true;
  const socialQuality = parsed?.social_quality === true;
  const passed = relevantArticle && relevantDestination && distinct && clear && !misleading && socialQuality;
  return {
    schema_version: 1,
    status: passed ? "passed" : "failed",
    evaluated_at: new Date().toISOString(),
    model: editorialAiModel(),
    relevant_to_article: relevantArticle,
    relevant_to_destination: relevantDestination,
    distinct_from_article_image: distinct,
    clear,
    misleading,
    social_quality: socialQuality,
    reason: cleanEditorialText(parsed?.reason, 600) || (passed ? "Visuale social coerente, distinta e pronta." : "QA visuale social non superata."),
    regeneration_guidance: passed ? "" : cleanEditorialText(parsed?.regeneration_guidance, 600),
  };
}

function editorialFallbackSourceText(value, maxChars = 12000) {
  return cleanEditorialText(value, maxChars)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`~>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editorialFallbackSentences(value, maxChars = 520, maxSentences = 3) {
  const clean = cleanEditorialText(value, Math.max(maxChars * 4, 1600))
    .replace(/[#*_`>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
  const selected = [];
  for (const sentence of sentences) {
    const normalized = String(sentence || "").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const candidate = [...selected, normalized].join(" ").trim();
    if (candidate.length > maxChars && selected.length) break;
    selected.push(normalized);
    if (selected.length >= maxSentences) break;
  }
  let out = selected.join(" ").trim() || clean;
  if (out.length > maxChars) {
    const clipped = out.slice(0, maxChars + 1);
    const boundary = clipped.lastIndexOf(" ");
    out = clipped.slice(0, boundary >= Math.floor(maxChars * 0.72) ? boundary : maxChars).trim();
    out = out.replace(/[,:;\-–—]+$/g, "").trim();
    if (out && !/[.!?]$/.test(out)) out += ".";
  }
  return out;
}

function editorialFallbackCoverText(article, item, target, articleTakeaway, destinationSolution) {
  const related = String(item?.post_type || "") === "related";
  const sourceTitle = cleanEditorialText(article?.title, 180) || "Approfondimento OffertaLogica";
  let coverTitle = sourceTitle;
  if (coverTitle.length > 95) coverTitle = editorialFallbackSentences(coverTitle, 92, 1).replace(/[.!?]$/g, "");
  if (coverTitle.length < 35) {
    const prefix = related && target?.label ? `${cleanEditorialText(target.label, 45)}: ` : "Da sapere: ";
    coverTitle = cleanEditorialText(`${prefix}${coverTitle}`, 95);
  }
  let coverSummary = editorialFallbackSentences(
    related ? [articleTakeaway, destinationSolution].filter(Boolean).join(" ") : articleTakeaway,
    188,
    2,
  );
  if (coverSummary.length < 90) {
    const source = cleanEditorialText(article?.excerpt || article?.content || sourceTitle, 900);
    coverSummary = editorialFallbackSentences(`${coverSummary} ${source}`.trim(), 188, 2);
  }
  if (coverSummary.length < 70) {
    coverSummary = cleanEditorialText(`${coverSummary} L'articolo spiega il contesto e i controlli utili per interpretare correttamente il tema.`, 188);
  }
  return { cover_title: coverTitle, cover_summary: coverSummary };
}

function buildEditorialGroundedCopyFallback(article, item, target, targetContext, brief = {}) {
  const related = String(item?.post_type || "") === "related";
  // Non riutilizzare i campi AI appena bocciati dalla QA: il fallback deve dipendere
  // soltanto dalle fonti reali per non reintrodurre affermazioni non verificate.
  const articleSource = editorialFallbackSourceText([article?.content, article?.excerpt, article?.title].filter(Boolean).join(" "));
  const articleTakeaway = editorialFallbackSentences(articleSource, 520, 3)
    || cleanEditorialText(article?.title, 180);
  const solutionSource = editorialFallbackSourceText([
    targetContext?.content,
    targetContext?.description,
    targetContext?.h1,
    targetContext?.title,
  ].filter(Boolean).join(" "));
  const destinationSolution = related
    ? editorialFallbackSentences(solutionSource, 620, 3)
    : "";
  const articleName = cleanEditorialText(article?.title, 180);
  const destinationName = cleanEditorialText(target?.label || targetContext?.label, 160);

  const followupCore = [
    articleTakeaway,
    articleName ? `L'approfondimento «${articleName}» raccoglie il contesto e i controlli descritti nell'articolo.` : "",
  ].filter(Boolean).join(" ");
  const relatedCore = [
    articleTakeaway,
    destinationName && destinationSolution ? `Nella sezione ${destinationName}, ${destinationSolution}` : destinationSolution,
  ].filter(Boolean).join(" ");
  const core = related ? relatedCore : followupCore;
  const facebookText = cleanEditorialSocialCopy(core, 1000);
  const instagramText = cleanEditorialSocialCopy(core, 1200);
  const cover = editorialFallbackCoverText(article, item, target, articleTakeaway, destinationSolution);

  return {
    ...brief,
    content_version: EDITORIAL_SOCIAL_CONTENT_VERSION,
    article_takeaway: articleTakeaway,
    destination_solution: destinationSolution,
    facebook_text: facebookText.length >= 180 ? facebookText : cleanEditorialSocialCopy(`${core} Nell'articolo completo trovi il quadro e le verifiche descritte dalla Redazione.`, 1000),
    instagram_text: instagramText.length >= 180 ? instagramText : cleanEditorialSocialCopy(`${core} L'articolo completo raccoglie il quadro e le verifiche descritte dalla Redazione.`, 1200),
    ...cover,
  };
}

async function schedulerPrepareMissingSocialAsset(user, options = {}) {
  const targetPlatforms = Array.isArray(options?.targetPlatforms)
    ? [...new Set(options.targetPlatforms.map((value) => String(value || "")).filter((value) => EDITORIAL_SOCIAL_PLATFORMS.has(value)))]
    : null;
  const targetPostType = ["article_intro", "article_followup", "related"].includes(String(options?.targetPostType || ""))
    ? String(options.targetPostType)
    : "";
  const selectedOnly = options?.selectedOnly === true;
  const statusFilter = selectedOnly ? "eq.selected" : "in.(selected,completed)";
  const rows = await serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&status=${statusFilter}&opportunity_type=eq.new_article&order=updated_at.asc&limit=80`);
  // Il ciclo editoriale corrente ha priorita' sulle rigenerazioni manuali di cicli gia' chiusi:
  // un vecchio post non deve mai impedire bozza/pubblicazione/follow-up del nuovo articolo.
  const orderedRows = [...(rows || [])].sort((left, right) => {
    const rank = (row) => String(row?.status || "") === "selected" ? 0 : 1;
    return rank(left) - rank(right);
  });
  for (const opportunity of orderedRows) {
    const evidence = opportunity?.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
    const regeneration = evidence?.social_regeneration && typeof evidence.social_regeneration === "object" ? evidence.social_regeneration : null;
    const regenerationItemId = validUuid(String(regeneration?.item_id || "")) && ["requested", "preparing"].includes(String(regeneration?.status || ""))
      ? String(regeneration.item_id)
      : "";
    if (String(opportunity.status || "") === "completed" && !regenerationItemId) continue;
    if (evidence?.article_generation_job?.source !== "scheduler") continue;
    if (evidence?.article_generation?.status !== "draft_ready_for_review") continue;
    if (!validUuid(String(opportunity.target_article_id || ""))) continue;

    const articleRows = await serviceFetch(`editorial_articles?select=*&id=eq.${encodeURIComponent(opportunity.target_article_id)}&limit=1`);
    const article = articleRows?.[0] || null;
    if (!article?.id) continue;
    const articleImage = articleImageState(opportunity);
    const heroAsset = articleImage.current?.url
      ? articleImage.current
      : (String(articleImage.candidate?.qa?.status || "") === "passed" ? articleImage.candidate : null);
    const articleImageUrl = String(heroAsset?.url || article.featured_image_url || "").trim();
    if (!/^https:\/\//i.test(articleImageUrl)) continue;

    const state = editorialSocialAssetsState(opportunity);

    const articleFeaturedImageUrl = String(article.featured_image_url || "").trim();
    const introImageUrl = /^https:\/\//i.test(articleFeaturedImageUrl) ? articleFeaturedImageUrl : articleImageUrl;
    const introFingerprint = editorialArticleIntroAssetFingerprint(article, introImageUrl);
    const introNeedsMetaCard = targetPlatforms === null
      ? true
      : targetPlatforms.some((platform) => EDITORIAL_PLAN_SOCIAL_PLATFORMS.has(platform));
    const introCopyCurrent = Boolean(
      state.article_intro?.copy?.facebook_text
      && state.article_intro?.copy?.instagram_text
      && state.article_intro?.copy?.linkedin_text
    );
    const introCardCurrent = Boolean(
      /^https:\/\//i.test(String(state.article_intro?.card?.url || ""))
      && String(state.article_intro?.card?.template_version || "") === EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION
      && String(state.article_intro?.card?.source || "") === "composed"
      && String(state.article_intro?.card?.renderer || "") === "resvg_wasm"
    );
    const introAlreadyCurrent = Boolean(
      state.article_intro?.fingerprint === introFingerprint
      && String(state.article_intro?.status || "") === "ready"
      && introCopyCurrent
      && (!introNeedsMetaCard || introCardCurrent)
    );

    // Prepara la stessa cover editoriale anche dopo la pubblicazione se manca o e' stale:
    // evita che un article_intro resti bloccato in waiting_assets quando articolo e social
    // vengono schedulati nello stesso ciclo.
    if ((!targetPostType || targetPostType === "article_intro") && !regenerationItemId && (String(article.status || "") !== "published" || !introAlreadyCurrent)) {
      let intro = state.article_intro && state.article_intro.fingerprint === introFingerprint
        ? state.article_intro
        : {
            schema_version: 2,
            article_id: article.id,
            fingerprint: introFingerprint,
            source_article: {
              title: article.title || "",
              excerpt: article.excerpt || "",
              featured_image_url: introImageUrl,
            },
            copy: null,
            card: null,
            card_history: [],
            status: "pending",
            updated_at: new Date().toISOString(),
          };

      if (!intro.copy?.facebook_text || !intro.copy?.instagram_text || !intro.copy?.linkedin_text) {
        const copy = await buildEditorialArticleIntroCopy(article);
        intro = { ...intro, copy, status: "copy_ready", updated_at: new Date().toISOString() };
        state.article_intro = intro;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "article_intro_social_copy_generated", opportunity_id: opportunity.id, article_id: article.id };
      }

      const introCardValid = Boolean(
        /^https:\/\//i.test(String(intro.card?.url || ""))
        && String(intro.card?.template_version || "") === EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION
        && String(intro.card?.source || "") === "composed"
        && String(intro.card?.renderer || "") === "resvg_wasm"
        && String(intro.card?.source_image_url || "") === introImageUrl
        && String(intro.card?.title || "") === cleanEditorialText(article.title, 220)
        && String(intro.card?.summary || "") === cleanEditorialText(article.excerpt, 420)
      );
      if (introNeedsMetaCard && !introCardValid) {
        const card = await renderAndUploadEditorialSocialCard({
          article,
          sourceImageUrl: introImageUrl,
          postType: "article_intro",
          title: article.title,
          summary: article.excerpt,
          label: editorialSocialCoverLabel("article_intro"),
          storageSegment: "article-intro",
        });
        const cardHistory = intro.card?.url
          ? [...(Array.isArray(intro.card_history) ? intro.card_history : []), { ...intro.card, outcome: "superseded", archived_at: new Date().toISOString() }].slice(-3)
          : (Array.isArray(intro.card_history) ? intro.card_history : []);
        intro = { ...intro, card, card_history: cardHistory, status: "ready", updated_at: new Date().toISOString() };
        state.article_intro = intro;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "article_intro_social_card_generated", opportunity_id: opportunity.id, article_id: article.id, template_version: card.template_version };
      }

      if (String(intro.status || "") !== "ready") {
        intro = { ...intro, status: "ready", updated_at: new Date().toISOString() };
        state.article_intro = intro;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "article_intro_social_ready", opportunity_id: opportunity.id, article_id: article.id };
      }
    }

    if (targetPostType === "article_intro") continue;

    const items = await serviceFetch(
      `editorial_social_plan_items?select=*&source_article_id=eq.${encodeURIComponent(article.id)}&opportunity_id=eq.${encodeURIComponent(opportunity.id)}&status=in.(draft,approved,failed)&order=created_at.asc&limit=20`,
    );
    for (const item of items || []) {
      if (!["article_followup", "related"].includes(String(item.post_type || ""))) continue;
      if (targetPostType && String(item.post_type || "") !== targetPostType) continue;
      if (regenerationItemId && String(item.id || "") !== regenerationItemId) continue;
      const target = await editorialSocialAssetTarget(item);
      const fingerprint = editorialSocialAssetFingerprint(article, item, target, articleImageUrl);
      let asset = state.items[item.id] && state.items[item.id].fingerprint === fingerprint
        ? state.items[item.id]
        : {
            schema_version: 2,
            plan_item_id: item.id,
            post_type: item.post_type,
            fingerprint,
            source_item: {
              post_type: item.post_type || null,
              destination_target_id: item.destination_target_id || null,
              theme: item.theme || "",
              brief: item.brief || "",
              canonical_text: item.canonical_text || "",
            },
            target: target ? { id: target.id, label: target.label, url_path: target.url_path, category: target.category || null } : null,
            brief: null,
            image: null,
            card: null,
            history: [],
            card_history: [],
            status: "pending",
            updated_at: new Date().toISOString(),
          };

      if (!asset.brief) {
        const targetContext = await editorialSocialTargetContext(target);
        if (String(item.post_type || "") === "related" && !cleanEditorialText([targetContext?.title, targetContext?.h1, targetContext?.description, targetContext?.content].filter(Boolean).join(" "), 1200)) {
          throw new Error("Asset social related: pagina OffertaLogica di destinazione non verificabile; pubblicazione bloccata");
        }
        let brief = await buildEditorialSocialAssetBrief(article, item, target, targetContext);
        let copyQa = await evaluateEditorialSocialCopy(article, item, target, targetContext, brief);
        let copyRewriteAttempts = 0;
        if (copyQa.status !== "passed") {
          const guidance = copyQa.rewrite_guidance || copyQa.reason || "Riscrivi con un angolo più concreto, naturale e specifico.";
          brief = await buildEditorialSocialAssetBrief(article, item, target, targetContext, guidance);
          copyQa = await evaluateEditorialSocialCopy(article, item, target, targetContext, brief);
          copyRewriteAttempts = 1;
        }
        brief = { ...brief, copy_qa: copyQa };
        const copyReady = copyQa.status === "passed";
        asset = { ...asset, schema_version: 2, brief, target_context: targetContext, copy_rewrite_attempts: copyRewriteAttempts, status: copyReady ? "brief_ready" : "human_review_required", updated_at: new Date().toISOString() };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return {
          action: copyReady ? "social_asset_brief_generated" : "social_asset_copy_human_review_required",
          opportunity_id: opportunity.id,
          article_id: article.id,
          social_plan_item_id: item.id,
          post_type: item.post_type,
          copy_qa: copyQa,
        };
      }

      if (asset.brief?.copy_qa && String(asset.brief.copy_qa.status || "") !== "passed") {
        // Un copy gia' bocciato non deve restare bloccato per sempre.
        // Le versioni precedenti facevano un solo rewrite immediato e poi lasciavano
        // l'asset in human_review_required a ogni heartbeat successivo.
        // Prima rivalutiamo il copy con il contenuto completo dell'articolo; se serve,
        // applichiamo ancora la rewrite_guidance, con un limite complessivo di 3 rewrite.
        const targetContext = asset.target_context || await editorialSocialTargetContext(target);
        let brief = { ...asset.brief };
        let copyQa = await evaluateEditorialSocialCopy(article, item, target, targetContext, brief);
        let copyRewriteAttempts = Number.isFinite(Number(asset.copy_rewrite_attempts))
          ? Math.max(0, Number(asset.copy_rewrite_attempts))
          : 1;
        if (copyQa.status !== "passed" && copyRewriteAttempts < 3) {
          const guidance = copyQa.rewrite_guidance || copyQa.reason || "Riscrivi eliminando ogni affermazione non esplicitamente supportata dall'articolo.";
          brief = await buildEditorialSocialAssetBrief(article, item, target, targetContext, guidance);
          copyQa = await evaluateEditorialSocialCopy(article, item, target, targetContext, brief);
          copyRewriteAttempts += 1;
        }
        let copyFallbackApplied = false;
        if (copyQa.status !== "passed" && copyRewriteAttempts >= 3) {
          brief = buildEditorialGroundedCopyFallback(article, item, target, targetContext, brief);
          copyQa = {
            ...copyQa,
            schema_version: 2,
            status: "passed",
            evaluated_at: new Date().toISOString(),
            model: null,
            reason: "Fallback deterministico: copy ricostruito esclusivamente da articolo e contenuto reale della destinazione dopo tre revisioni AI non concluse.",
            rewrite_guidance: "",
            fallback_mode: "deterministic_grounded",
          };
          copyFallbackApplied = true;
        }
        brief = { ...brief, copy_qa: copyQa };
        const copyReady = copyQa.status === "passed";
        asset = {
          ...asset,
          schema_version: 2,
          brief,
          target_context: targetContext,
          copy_rewrite_attempts: copyRewriteAttempts,
          copy_fallback_applied: copyFallbackApplied || asset.copy_fallback_applied === true,
          status: copyReady ? "brief_ready" : "human_review_required",
          updated_at: new Date().toISOString(),
        };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return {
          action: copyReady ? "social_asset_copy_recovered" : "social_asset_copy_human_review_required",
          opportunity_id: opportunity.id,
          article_id: article.id,
          social_plan_item_id: item.id,
          post_type: item.post_type,
          copy_qa: copyQa,
          copy_rewrite_attempts: copyRewriteAttempts,
        };
      }

      if (!editorialSocialBriefHasCover(asset.brief)) {
        const targetContext = asset.target_context || await editorialSocialTargetContext(target);
        const cover = await buildEditorialSocialCoverText(article, item, target, targetContext, asset.brief);
        asset = {
          ...asset,
          schema_version: 2,
          brief: { ...asset.brief, ...cover },
          target_context: targetContext,
          card: null,
          status: String(asset.image?.qa?.status || "") === "passed" ? "card_pending" : "brief_ready",
          updated_at: new Date().toISOString(),
        };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "social_asset_cover_text_generated", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, post_type: item.post_type };
      }

      if (!asset.image?.url) {
        const generated = await generateOpenAiSocialImage(article, item, target, asset.brief, "");
        const objectPath = `autopilot/${article.id}/social/${item.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;
        const imageUrl = await uploadEditorialImageBuffer(objectPath, generated.buffer, "image/jpeg");
        asset = {
          ...asset,
          schema_version: 2,
          image: {
            source: "generated",
            provider: "openai",
            generation_mode: "text_to_image",
            source_policy: EDITORIAL_IMAGE_SOURCE_POLICY,
            url: imageUrl,
            object_path: objectPath,
            mime_type: "image/jpeg",
            size: EDITORIAL_SOCIAL_IMAGE_SIZE,
            quality: "high",
            model: generated.model,
            prompt: generated.prompt,
            alt_text: asset.brief.alt_text || defaultArticleImageAlt(article),
            attempt: 1,
            qa: null,
            created_at: new Date().toISOString(),
          },
          card: null,
          status: "image_generated",
          updated_at: new Date().toISOString(),
        };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "social_asset_image_generated", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, post_type: item.post_type };
      }

      const qaStatus = String(asset.image?.qa?.status || "");
      if (!qaStatus) {
        const qa = await evaluateEditorialSocialImage(article, item, target, asset.brief, asset.image, articleImageUrl);
        asset = {
          ...asset,
          schema_version: 2,
          image: { ...asset.image, qa },
          card: qa.status === "passed" ? asset.card || null : null,
          status: qa.status === "passed" ? "card_pending" : "qa_failed",
          updated_at: new Date().toISOString(),
        };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: qa.status === "passed" ? "social_asset_image_qa_passed" : "social_asset_qa_failed", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, post_type: item.post_type, qa };
      }

      if (qaStatus === "failed") {
        const attempt = Math.max(1, Number(asset.image?.attempt) || 1);
        if (attempt < EDITORIAL_SOCIAL_IMAGE_QA_MAX_ATTEMPTS) {
          const guidance = cleanEditorialText(asset.image?.qa?.regeneration_guidance, 600)
            || "Rendi il visuale più specifico rispetto al tema del post e chiaramente diverso dalla hero dell'articolo.";
          const generated = await generateOpenAiSocialImage(article, item, target, asset.brief, guidance);
          const objectPath = `autopilot/${article.id}/social/${item.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;
          const imageUrl = await uploadEditorialImageBuffer(objectPath, generated.buffer, "image/jpeg");
          const history = [...(Array.isArray(asset.history) ? asset.history : []), { ...asset.image, outcome: "qa_failed", archived_at: new Date().toISOString() }].slice(-4);
          asset = {
            ...asset,
            schema_version: 2,
            history,
            image: {
              source: "generated",
              provider: "openai",
              generation_mode: "text_to_image",
              source_policy: EDITORIAL_IMAGE_SOURCE_POLICY,
              url: imageUrl,
              object_path: objectPath,
              mime_type: "image/jpeg",
              size: EDITORIAL_SOCIAL_IMAGE_SIZE,
              quality: "high",
              model: generated.model,
              prompt: generated.prompt,
              alt_text: asset.brief.alt_text || defaultArticleImageAlt(article),
              attempt: attempt + 1,
              qa: null,
              created_at: new Date().toISOString(),
            },
            card: null,
            status: "image_regenerated",
            updated_at: new Date().toISOString(),
          };
          state.items[item.id] = asset;
          await saveEditorialSocialAssetsState(user, opportunity, state);
          return { action: "social_asset_regenerated_after_qa", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, post_type: item.post_type, attempt: attempt + 1 };
        }

        const now = new Date().toISOString();
        const history = [...(Array.isArray(asset.history) ? asset.history : []), { ...asset.image, outcome: "qa_failed_fallback_to_article_image", archived_at: now }].slice(-4);
        asset = {
          ...asset,
          schema_version: 2,
          history,
          image: {
            source: "article_image_fallback",
            provider: "offertalogica",
            generation_mode: "reuse_article_image",
            source_policy: "approved_article_image_fallback",
            url: articleImageUrl,
            object_path: heroAsset?.object_path || null,
            mime_type: heroAsset?.mime_type || null,
            size: heroAsset?.size || null,
            quality: heroAsset?.quality || null,
            model: null,
            prompt: null,
            alt_text: cleanEditorialText(article.featured_image_alt, 180) || defaultArticleImageAlt(article),
            attempt,
            qa: {
              schema_version: 1,
              status: "passed",
              evaluated_at: now,
              model: null,
              relevant_to_article: true,
              relevant_to_destination: true,
              distinct_from_article_image: false,
              clear: true,
              misleading: false,
              social_quality: true,
              reason: "Fallback automatico: riuso dell'immagine già approvata e pubblicata con l'articolo dopo due QA social fallite.",
              regeneration_guidance: "",
              approval_mode: "article_image_fallback",
            },
            fallback: {
              reason: "social_image_qa_exhausted",
              failed_attempts: attempt,
              applied_at: now,
            },
            created_at: now,
          },
          card: null,
          status: "card_pending",
          updated_at: now,
        };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);

        const card = await renderAndUploadEditorialSocialCard({
          article,
          sourceImageUrl: articleImageUrl,
          postType: item.post_type,
          title: asset.brief.cover_title,
          summary: asset.brief.cover_summary,
          label: editorialSocialCoverLabel(item.post_type),
          storageSegment: `${item.id}-card`,
        });
        asset = { ...asset, card, status: "ready", updated_at: new Date().toISOString() };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "social_asset_article_image_fallback_ready", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, post_type: item.post_type, failed_attempts: attempt };
      }

      if (qaStatus !== "passed") continue;

      const cardValid = Boolean(
        /^https:\/\//i.test(String(asset.card?.url || ""))
        && String(asset.card?.template_version || "") === EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION
        && String(asset.card?.source || "") === "composed"
        && String(asset.card?.renderer || "") === "resvg_wasm"
        && String(asset.card?.source_image_url || "") === String(asset.image.url || "")
        && String(asset.card?.title || "") === cleanEditorialText(asset.brief.cover_title, 220)
        && String(asset.card?.summary || "") === cleanEditorialText(asset.brief.cover_summary, 420)
      );
      if (!cardValid) {
        const card = await renderAndUploadEditorialSocialCard({
          article,
          sourceImageUrl: asset.image.url,
          postType: item.post_type,
          title: asset.brief.cover_title,
          summary: asset.brief.cover_summary,
          label: editorialSocialCoverLabel(item.post_type),
          storageSegment: `${item.id}-card`,
        });
        const cardHistory = asset.card?.url
          ? [...(Array.isArray(asset.card_history) ? asset.card_history : []), { ...asset.card, outcome: "superseded", archived_at: new Date().toISOString() }].slice(-3)
          : (Array.isArray(asset.card_history) ? asset.card_history : []);
        asset = { ...asset, schema_version: 2, card, card_history: cardHistory, status: "ready", updated_at: new Date().toISOString() };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "social_asset_card_generated", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, post_type: item.post_type, template_version: card.template_version };
      }

      if (String(asset.status || "") !== "ready") {
        asset = { ...asset, schema_version: 2, status: "ready", updated_at: new Date().toISOString() };
        state.items[item.id] = asset;
        await saveEditorialSocialAssetsState(user, opportunity, state);
        return { action: "social_asset_ready", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, post_type: item.post_type };
      }
    }
  }
  return null;
}

async function requestEditorialSocialRegeneration(user, payload = {}) {
  const itemId = String(payload.id || "").trim();
  if (!validUuid(itemId)) throw new Error("Identificativo post non valido");
  const itemRows = await serviceFetch(`editorial_social_plan_items?select=*&id=eq.${encodeURIComponent(itemId)}&limit=1`);
  const item = itemRows?.[0] || null;
  if (!item?.id) throw new Error("Post del piano non trovato");
  if (!["article_followup", "related"].includes(String(item.post_type || ""))) throw new Error("Rigenerazione disponibile solo per i post del ciclo articolo");
  if (!validUuid(String(item.opportunity_id || "")) || !validUuid(String(item.source_article_id || ""))) throw new Error("Post non collegato correttamente a opportunità e articolo");

  const [oppRows, articleRows] = await Promise.all([
    serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(item.opportunity_id)}&limit=1`),
    serviceFetch(`editorial_articles?select=id,title,status,slug&id=eq.${encodeURIComponent(item.source_article_id)}&limit=1`),
  ]);
  const opportunity = oppRows?.[0] || null;
  const article = articleRows?.[0] || null;
  if (!opportunity?.id || !article?.id) throw new Error("Articolo o opportunità collegata non trovati");
  if (String(article.status || "") !== "published") throw new Error("La rigenerazione social è consentita solo per un articolo già pubblicato");

  const evidence = opportunity.evidence && typeof opportunity.evidence === "object" ? { ...opportunity.evidence } : {};
  const state = editorialSocialAssetsState(opportunity);
  const previous = state.items?.[itemId] || null;
  const history = Array.isArray(previous?.history) ? previous.history : [];
  const cardHistory = Array.isArray(previous?.card_history) ? previous.card_history : [];
  if (previous?.image) history.push({ ...previous.image, outcome: "manual_regeneration_requested", archived_at: new Date().toISOString() });
  if (previous?.card) cardHistory.push({ ...previous.card, outcome: "manual_regeneration_requested", archived_at: new Date().toISOString() });
  const previousBrief = previous?.brief && typeof previous.brief === "object" ? previous.brief : null;
  const reusableBrief = previousBrief
    ? {
        ...previousBrief,
        // Il testo social esistente resta invariato: la rigenerazione manuale serve a rifare
        // solo visuale e impaginazione. Titolo/sintesi cover vengono ricostruiti per evitare
        // di trascinare vecchie formule promozionali o badge non più ammessi.
        cover_title: "",
        cover_summary: "",
      }
    : null;
  state.items[itemId] = {
    schema_version: 2,
    plan_item_id: itemId,
    post_type: item.post_type,
    fingerprint: previous?.fingerprint || null,
    source_item: previous?.source_item || null,
    target: previous?.target || null,
    target_context: previous?.target_context || null,
    brief: reusableBrief,
    image: null,
    card: null,
    history: history.slice(-4),
    card_history: cardHistory.slice(-3),
    status: reusableBrief ? "brief_ready" : "pending",
    updated_at: new Date().toISOString(),
  };
  evidence.social_assets = state;
  evidence.social_regeneration = {
    schema_version: 1,
    item_id: itemId,
    post_type: item.post_type,
    status: "requested",
    requested_at: new Date().toISOString(),
    requested_by: user.id,
  };
  await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, {
    method: "PATCH", prefer: "return=minimal", body: { evidence, updated_at: new Date().toISOString(), decided_by: user.id },
  });
  await serviceFetch(`editorial_social_plan_publications?social_plan_item_id=eq.${encodeURIComponent(itemId)}`, {
    method: "DELETE", prefer: "return=minimal",
  }).catch(() => {});
  const updatedRows = await serviceFetch(`editorial_social_plan_items?id=eq.${encodeURIComponent(itemId)}`, {
    method: "PATCH", prefer: "return=representation", body: { status: "approved", scheduled_for: null, updated_at: new Date().toISOString(), updated_by: user.id },
  });

  // La rigenerazione manuale viene accodata e ripresa dallo scheduler a piccoli passi.
  // Evita timeout lunghi e collisioni tra generazione immagine, QA, card e heartbeat.
  return {
    requested: true,
    immediate: false,
    published: false,
    queued: true,
    item: updatedRows?.[0] || { ...item, status: "approved" },
    article,
  };
}


async function reviewEditorialSocialImage(user, payload = {}) {
  const itemId = String(payload.id || "").trim();
  const decision = String(payload.decision || "").trim();
  if (!validUuid(itemId)) throw new Error("Identificativo post non valido");
  if (!["approve", "use_article_image"].includes(decision)) throw new Error("Decisione immagine social non valida");

  const itemRows = await serviceFetch(`editorial_social_plan_items?select=*&id=eq.${encodeURIComponent(itemId)}&limit=1`);
  const item = itemRows?.[0] || null;
  if (!item?.id || !validUuid(String(item.opportunity_id || "")) || !validUuid(String(item.source_article_id || ""))) {
    throw new Error("Post social non collegato correttamente");
  }
  if (["publishing", "published"].includes(String(item.status || ""))) {
    throw new Error("L'immagine di un post già avviato o pubblicato non può essere sostituita da questo pannello");
  }

  const [opportunityRows, articleRows] = await Promise.all([
    serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(item.opportunity_id)}&limit=1`),
    serviceFetch(`editorial_articles?select=id,title,status,featured_image_url,featured_image_alt&id=eq.${encodeURIComponent(item.source_article_id)}&limit=1`),
  ]);
  const opportunity = opportunityRows?.[0] || null;
  const article = articleRows?.[0] || null;
  if (!opportunity?.id || !article?.id) throw new Error("Articolo o opportunità collegata non trovati");

  const state = editorialSocialAssetsState(opportunity);
  let asset = state.items?.[itemId] || null;
  if (!asset) throw new Error("Asset social non ancora disponibile");
  if (!editorialSocialBriefHasCover(asset.brief)) throw new Error("Testo della card social non ancora pronto");

  const now = new Date().toISOString();
  const cardHistory = asset.card?.url
    ? [...(Array.isArray(asset.card_history) ? asset.card_history : []), { ...asset.card, outcome: "manual_image_review", archived_at: now }].slice(-3)
    : (Array.isArray(asset.card_history) ? asset.card_history : []);

  if (decision === "approve") {
    if (!/^https:\/\//i.test(String(asset.image?.url || ""))) throw new Error("Immagine social corrente non disponibile");
    asset = {
      ...asset,
      schema_version: 2,
      image: {
        ...asset.image,
        qa: {
          ...(asset.image?.qa && typeof asset.image.qa === "object" ? asset.image.qa : {}),
          schema_version: 1,
          status: "passed",
          evaluated_at: now,
          reason: "Immagine approvata manualmente dalla Redazione.",
          regeneration_guidance: "",
          approval_mode: "manual_editorial",
          approved_at: now,
          approved_by: user.id,
        },
      },
      card: null,
      card_history: cardHistory,
      status: "card_pending",
      updated_at: now,
    };
  } else {
    const articleImage = articleImageState(opportunity);
    const heroAsset = articleImage.current?.url
      ? articleImage.current
      : (String(articleImage.candidate?.qa?.status || "") === "passed" ? articleImage.candidate : null);
    const articleImageUrl = String(heroAsset?.url || article.featured_image_url || "").trim();
    if (!/^https:\/\//i.test(articleImageUrl)) throw new Error("Immagine approvata dell'articolo non disponibile");
    const history = asset.image?.url
      ? [...(Array.isArray(asset.history) ? asset.history : []), { ...asset.image, outcome: "manual_fallback_to_article_image", archived_at: now }].slice(-4)
      : (Array.isArray(asset.history) ? asset.history : []);
    asset = {
      ...asset,
      schema_version: 2,
      history,
      image: {
        source: "article_image_fallback",
        provider: "offertalogica",
        generation_mode: "reuse_article_image",
        source_policy: "approved_article_image_fallback",
        url: articleImageUrl,
        object_path: heroAsset?.object_path || null,
        mime_type: heroAsset?.mime_type || null,
        size: heroAsset?.size || null,
        quality: heroAsset?.quality || null,
        model: null,
        prompt: null,
        alt_text: cleanEditorialText(article.featured_image_alt, 180) || defaultArticleImageAlt(article),
        attempt: Math.max(1, Number(asset.image?.attempt) || 1),
        qa: {
          schema_version: 1,
          status: "passed",
          evaluated_at: now,
          model: null,
          relevant_to_article: true,
          relevant_to_destination: true,
          distinct_from_article_image: false,
          clear: true,
          misleading: false,
          social_quality: true,
          reason: "Immagine dell'articolo selezionata manualmente dalla Redazione come fallback social.",
          regeneration_guidance: "",
          approval_mode: "manual_article_image_fallback",
          approved_at: now,
          approved_by: user.id,
        },
        fallback: {
          reason: "manual_editorial_choice",
          applied_at: now,
        },
        created_at: now,
      },
      card: null,
      card_history: cardHistory,
      status: "card_pending",
      updated_at: now,
    };
  }

  state.items[itemId] = asset;
  await saveEditorialSocialAssetsState(user, opportunity, state);

  const card = await renderAndUploadEditorialSocialCard({
    article,
    sourceImageUrl: asset.image.url,
    postType: item.post_type,
    title: asset.brief.cover_title,
    summary: asset.brief.cover_summary,
    label: editorialSocialCoverLabel(item.post_type),
    storageSegment: `${item.id}-card`,
  });
  asset = { ...asset, card, status: "ready", updated_at: new Date().toISOString() };
  state.items[itemId] = asset;
  await saveEditorialSocialAssetsState(user, opportunity, state);

  return {
    reviewed: true,
    decision,
    opportunity_id: opportunity.id,
    article_id: article.id,
    social_plan_item_id: itemId,
    status: asset.status,
    image: asset.image,
    card: asset.card,
  };
}

async function schedulerPublishRequestedSocialRegeneration(user) {
  const opportunities = await serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&order=updated_at.desc&limit=80`);
  for (const opportunity of opportunities || []) {
    const evidence = opportunity?.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
    const regeneration = evidence?.social_regeneration && typeof evidence.social_regeneration === "object" ? evidence.social_regeneration : null;
    const itemId = String(regeneration?.item_id || "");
    if (!validUuid(itemId) || !["requested", "preparing"].includes(String(regeneration?.status || ""))) continue;
    if (!validUuid(String(opportunity.target_article_id || ""))) continue;
    const [articleRows, itemRows] = await Promise.all([
      serviceFetch(`editorial_articles?select=*&id=eq.${encodeURIComponent(opportunity.target_article_id)}&limit=1`),
      serviceFetch(`editorial_social_plan_items?select=*&id=eq.${encodeURIComponent(itemId)}&limit=1`),
    ]);
    const article = articleRows?.[0] || null;
    const item = itemRows?.[0] || null;
    if (!article?.id || !item?.id) continue;
    const context = { opportunity, article };
    if (!schedulerPlanAssetIsOlInforma(context, item)) {
      if (String(regeneration.status || "") !== "preparing") {
        const nextEvidence = { ...evidence, social_regeneration: { ...regeneration, status: "preparing", updated_at: new Date().toISOString() } };
        await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, { method: "PATCH", prefer: "return=minimal", body: { evidence: nextEvidence, updated_at: new Date().toISOString() } });
      }
      continue;
    }
    const enabledPlatforms = await editorialEnabledSocialPlatforms();
    const run = await automationSchedulerRunStart(String(item.post_type || "") === "related" ? "social_related" : "social_followup", {
      stage: "manual_regeneration",
      regeneration_item_id: itemId,
      slot_only: false,
    }, opportunity.id);
    try {
      const slotKind = String(item.post_type || "") === "related" ? "social_related" : "social_followup";
      const result = await schedulerPublishPlanItem(user, context, slotKind, enabledPlatforms);
      if (result.retry_pending) {
        const nextEvidence = {
          ...evidence,
          social_regeneration: { ...regeneration, status: "preparing", updated_at: new Date().toISOString(), last_wait_reason: result.retry_reason || "social_retry" },
        };
        await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, { method: "PATCH", prefer: "return=minimal", body: { evidence: nextEvidence, updated_at: new Date().toISOString() } });
        await automationRunFinish(run, "success", { opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, details: { ...(run?.details || {}), stage: "waiting_social_retry", publication_performed: false, reason: result.retry_reason || "social_retry" } });
        return { action: "social_regeneration_waiting", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, result };
      }
      const nextEvidence = {
        ...evidence,
        social_regeneration: { ...regeneration, status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      };
      await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, { method: "PATCH", prefer: "return=minimal", body: { evidence: nextEvidence, updated_at: new Date().toISOString() } });
      await automationRunFinish(run, "success", { opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, details: { ...(run?.details || {}), stage: "completed", publication_performed: true } });
      return { action: "social_regeneration_published", opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, result };
    } catch (error) {
      await automationRunFinish(run, "failed", { opportunity_id: opportunity.id, article_id: article.id, social_plan_item_id: item.id, last_error: String(error?.message || error).slice(0, 2000), details: { ...(run?.details || {}), stage: "failed" } });
      throw error;
    }
  }
  return null;
}

async function automationRunsPayload() {
  const rows = await serviceFetch("editorial_automation_runs?select=id,run_type,status,scheduled_for,started_at,finished_at,opportunity_id,article_id,social_plan_item_id,details,last_error,created_at&order=created_at.desc&limit=100");
  return { ok: true, version: VERSION, runs: rows || [] };
}


function automationCronSecretEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function automationPersistTickState(result = null, error = null) {
  let opportunityId = String(result?.opportunity_id || "").trim();
  let opportunity = null;

  if (validUuid(opportunityId)) {
    const rows = await serviceFetch(`editorial_research_opportunities?select=id,evidence&id=eq.${encodeURIComponent(opportunityId)}&limit=1`);
    opportunity = rows?.[0] || null;
  } else {
    const rows = await serviceFetch("editorial_research_opportunities?select=id,evidence&status=eq.selected&target_article_id=not.is.null&order=updated_at.desc&limit=1");
    opportunity = rows?.[0] || null;
    opportunityId = String(opportunity?.id || "").trim();
  }

  if (!validUuid(opportunityId) || !opportunity?.id) return;
  const evidence = opportunity?.evidence && typeof opportunity.evidence === "object" ? { ...opportunity.evidence } : {};
  const now = new Date().toISOString();
  const heartbeat = {
    at: now,
    ok: !error,
    action: error ? "failed" : String(result?.action || "idle"),
    slot_kind: error ? null : String(result?.slot?.kind || "") || null,
    slot_label: error ? null : String(result?.slot?.label || "") || null,
    error: error ? String(error?.message || error).slice(0, 800) : null,
    version: VERSION,
  };
  await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunityId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: { evidence: { ...evidence, scheduler_heartbeat: heartbeat } },
  });
}

async function automationCronAuthorized(req) {
  // Vercel Cron, quando CRON_SECRET e' configurato, invia
  // Authorization: Bearer <CRON_SECRET>. Manteniamo anche il vecchio
  // header dedicato per eventuali trigger esterni gia' configurati.
  const authorization = String(req.headers?.authorization || "").trim();
  const bearerSecret = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const vercelCronSecret = env("CRON_SECRET");
  if (vercelCronSecret && automationCronSecretEqual(bearerSecret, vercelCronSecret)) return true;

  const legacySecret = String(req.headers?.["x-offertalogica-autopilot-secret"] || bearerSecret || "").trim();
  if (legacySecret.length < 32 || legacySecret.length > 256) return false;
  try {
    const verified = await serviceFetch("rpc/editorial_autopilot_verify_cron_secret", {
      method: "POST",
      body: { p_secret: legacySecret },
    });
    return verified === true || verified?.verified === true;
  } catch {
    return false;
  }
}

async function automationSchedulerSettings() {
  const rows = await serviceFetch("editorial_automation_settings?select=*&id=eq.1&limit=1");
  return rows?.[0] || null;
}

async function automationSchedulerUser(settings) {
  const userId = String(settings?.updated_by || "").trim();
  if (!validUuid(userId)) throw new Error("Autopilota: amministratore responsabile non configurato. Salva di nuovo la configurazione dalla Redazione.");
  const [members, authors] = await Promise.all([
    serviceFetch(`editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(userId)}&limit=1`),
    serviceFetch(`editorial_authors?select=id,user_id,active&user_id=eq.${encodeURIComponent(userId)}&active=eq.true&limit=1`),
  ]);
  if (!members?.[0]?.active || members[0].role !== "admin") throw new Error("Autopilota: l’utente responsabile non è più un amministratore attivo");
  if (!authors?.[0]?.id) throw new Error("Autopilota: l’amministratore responsabile non ha un profilo autore attivo");
  return { id: userId, _automation: true };
}

function schedulerLocalParts(timeZone, date = new Date()) {
  const zone = String(timeZone || "Europe/Rome").trim() || "Europe/Rome";
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit",
      weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    throw new Error(`Fuso orario Autopilota non valido: ${zone}`);
  }
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  return {
    time_zone: zone,
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: weekdayMap[value("weekday")] || 0,
    minutes: hour * 60 + minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function schedulerSlotMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

const SCHEDULER_SLOT_MAX_ATTEMPTS_PER_DAY = 3;

function schedulerSlotAttemptState(runs, schedulerKey) {
  const matching = (runs || []).filter((run) => run?.details?.scheduler_key === schedulerKey);
  const failedAttempts = matching.filter((run) => String(run?.status || "") === "failed").length;
  const consumed = matching.some((run) => String(run?.status || "") !== "failed")
    || failedAttempts >= SCHEDULER_SLOT_MAX_ATTEMPTS_PER_DAY;
  return { failedAttempts, consumed };
}

async function automationSchedulerRuns(limit = 100) {
  const rows = await serviceFetch(`editorial_automation_runs?select=id,run_type,status,scheduled_for,started_at,finished_at,opportunity_id,article_id,social_plan_item_id,details,last_error,created_at&order=created_at.desc&limit=${Math.max(1, Math.min(200, Number(limit) || 100))}`);
  return rows || [];
}

async function automationSchedulerRunStart(runType, details = {}, opportunityId = null) {
  const now = new Date().toISOString();
  const rows = await serviceFetch("editorial_automation_runs", {
    method: "POST",
    prefer: "return=representation",
    body: {
      run_type: runType,
      status: "running",
      scheduled_for: now,
      started_at: now,
      opportunity_id: validUuid(opportunityId) ? opportunityId : null,
      details: { version: VERSION, source: "scheduler", ...details },
    },
  });
  return rows?.[0] || null;
}

async function automationSchedulerRunPatch(run, detailsPatch = {}) {
  if (!run?.id) return null;
  const details = { ...(run.details && typeof run.details === "object" ? run.details : {}), ...detailsPatch, version: VERSION, source: "scheduler" };
  const rows = await serviceFetch(`editorial_automation_runs?id=eq.${encodeURIComponent(run.id)}`, {
    method: "PATCH", prefer: "return=representation", body: { details },
  });
  return rows?.[0] || { ...run, details };
}

function schedulerInternalPageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://offertalogica.it");
    if (url.protocol !== "https:" || !["offertalogica.it", "www.offertalogica.it"].includes(url.hostname.toLowerCase())) return null;
    return `https://offertalogica.it${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

async function schedulerSelectOpportunity(user, settings) {
  const preview = await editorialPlannerPreview();
  const decision = preview?.decision;
  if (!decision) return null;
  let opportunity = null;
  if (decision.id) {
    const rows = await serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(decision.id)}&limit=1`);
    opportunity = rows?.[0] || null;
  } else if (decision.source === "search_console" && decision.topic_key) {
    const saved = await saveEditorialOpportunity(user, decision.topic_key);
    opportunity = saved?.opportunity || null;
  } else if (decision.source === "research_radar" && decision.radar_candidate) {
    opportunity = await saveResearchRadarOpportunity(user, decision.radar_candidate);
  }
  if (!opportunity?.id) return null;
  if (opportunity.status === "pending") opportunity = await updateEditorialOpportunity(user, opportunity.id, "selected");
  if (opportunity.status !== "selected") return opportunity;

  if (["monitor", "update_article"].includes(String(opportunity.opportunity_type || ""))) {
    const freshRows = await serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(opportunity.id)}&limit=1`);
    const fresh = freshRows?.[0] || opportunity;
    // L'Editoriale usa eventuali pagine Search Console solo come contesto:
    // non propone e non applica mai aggiornamenti alle pagine esistenti del sito.
    opportunity = await classifyEditorialOpportunity(user, fresh.id, "new_article");
  }
  if (opportunity && typeof opportunity === "object") {
    Object.defineProperty(opportunity, "_schedulerSelection", {
      value: {
        source: decision.source || null,
        score: Number.isFinite(Number(decision.score)) ? Number(decision.score) : null,
        reason: decision.reason || null,
        fallback_below_threshold: Boolean(decision.fallback_below_threshold),
        radar_key: decision.radar_key || null,
        editorial_action: decision.radar_candidate?.editorial_action || null,
      },
      enumerable: false,
      configurable: false,
    });
  }
  return opportunity;
}

function schedulerEditorialWeekStartMs(timeZone, value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const local = schedulerLocalParts(timeZone || "Europe/Rome", date);
  const [year, month, day] = String(local.date || "").split("-").map(Number);
  if (!year || !month || !day || !local.weekday) return null;
  return Date.UTC(year, month - 1, day) - (local.weekday - 1) * 86400000;
}

function schedulerArticleFrequencyAllows(settings, runs, now = Date.now()) {
  const weeks = Math.max(1, Math.min(4, Number(settings?.article_frequency_weeks) || 1));
  const last = (runs || []).find((run) =>
    run.run_type === "article_prepare"
    && run.status === "success"
    && run?.details?.source === "scheduler"
    && validUuid(String(run?.article_id || ""))
    && !["skipped", "waiting_human_approval"].includes(String(run?.details?.stage || ""))
  );
  if (!last) return true;
  const when = Date.parse(last.finished_at || last.started_at || last.created_at || "");
  if (!Number.isFinite(when)) return true;

  const zone = String(settings?.timezone || "Europe/Rome").trim() || "Europe/Rome";
  const currentWeekStart = schedulerEditorialWeekStartMs(zone, new Date(now));
  const lastWeekStart = schedulerEditorialWeekStartMs(zone, new Date(when));
  if (!Number.isFinite(currentWeekStart) || !Number.isFinite(lastWeekStart)) return true;
  return currentWeekStart - lastWeekStart >= weeks * 7 * 86400000;
}

function schedulerArticlePublishAuthRecoverable(slot, runs, schedulerKey) {
  if (String(slot?.kind || "") !== "article_publish") return false;
  const matching = (runs || []).filter((run) => run?.details?.scheduler_key === schedulerKey);
  if (matching.some((run) => String(run?.status || "") !== "failed")) return false;
  const failed = matching.filter((run) => String(run?.status || "") === "failed");
  if (failed.length !== SCHEDULER_SLOT_MAX_ATTEMPTS_PER_DAY) return false;
  if (failed.some((run) => String(run?.details?.recovery_reason || "") === "social_auth_secret_v0.12.50")) return false;
  return failed.every((run) => String(run?.last_error || "").includes("Sessione Redazione non valida o scaduta"));
}

function schedulerArticlePublishHumanReviewRecoverable(slot, runs, schedulerKey) {
  if (String(slot?.kind || "") !== "article_publish") return false;
  const matching = (runs || []).filter((run) => run?.details?.scheduler_key === schedulerKey);
  if (matching.some((run) =>
    String(run?.status || "") === "success"
    && (run?.details?.publication_performed === true || String(run?.details?.stage || "") === "completed")
  )) return false;
  return matching.some((run) =>
    String(run?.status || "") === "success"
    && String(run?.details?.stage || "") === "waiting_human_review"
    && run?.details?.publication_performed !== true
  );
}

function schedulerSocialRetryRecoverable(slot, runs, schedulerKey) {
  if (!["article_publish", "social_followup", "social_related"].includes(String(slot?.kind || ""))) return false;
  const matching = (runs || []).filter((run) => run?.details?.scheduler_key === schedulerKey);
  const failedAttempts = matching.filter((run) => String(run?.status || "") === "failed").length;
  if (failedAttempts >= SCHEDULER_SLOT_MAX_ATTEMPTS_PER_DAY) return false;
  if (matching.some((run) => run?.details?.publication_performed === true)) return false;

  // Recupera soltanto se l'ultimo esito non fallito dello slot è davvero un'attesa
  // tecnica. Un esito ambiguo, un blocco umano o una pubblicazione confermata non
  // devono essere riaperti da un vecchio waiting_social_retry, per evitare doppioni.
  const nonFailed = matching
    .filter((run) => String(run?.status || "") !== "failed")
    .sort((left, right) => String(right?.created_at || right?.started_at || "").localeCompare(String(left?.created_at || left?.started_at || "")));
  const latest = nonFailed[0] || null;
  return Boolean(
    latest
    && String(latest.status || "") === "success"
    && String(latest?.details?.stage || "") === "waiting_social_retry"
    && latest?.details?.publication_performed !== true
  );
}

function schedulerArticlePrepareRecoverable(slot, settings, runs, schedulerKey, now = Date.now()) {
  if (String(slot?.kind || "") !== "article_prepare") return false;
  if (Number(settings?.max_articles_per_cycle) <= 0) return false;

  const matching = (runs || []).filter((run) => run?.details?.scheduler_key === schedulerKey);
  const failedAttempts = matching.filter((run) => String(run?.status || "") === "failed").length;
  if (failedAttempts >= SCHEDULER_SLOT_MAX_ATTEMPTS_PER_DAY) return false;

  const nonFailed = matching.filter((run) => String(run?.status || "") !== "failed");
  if (!nonFailed.length) return false;
  const recoverable = nonFailed.every((run) => {
    if (String(run?.status || "") !== "success") return false;
    const stage = String(run?.details?.stage || "");
    const reason = String(run?.details?.reason || "");
    return (stage === "skipped" && reason === "article_frequency_weeks")
      || (stage === "completed" && reason === "no_opportunity")
      || stage === "update_proposal_ready";
  });
  if (!recoverable) return false;
  if (!schedulerArticleFrequencyAllows(settings, runs, now)) return false;

  const noOpportunityRuns = nonFailed.filter((run) =>
    String(run?.details?.stage || "") === "completed"
    && String(run?.details?.reason || "") === "no_opportunity"
  );
  if (!noOpportunityRuns.length) return true;
  if (Boolean(settings?.allow_no_publish)) return false;

  // Un solo recupero aggiuntivo evita loop ogni 15 minuti se Search Console
  // non contiene davvero alcun segnale utilizzabile.
  return noOpportunityRuns.length < 2;
}

async function schedulerProcessResearchRun(run, user, settings) {
  const stage = String(run?.details?.stage || "collect_7");
  try {
    if (stage === "collect_7") {
      const result = await collectSearchConsole(user, 7);
      const next = await automationSchedulerRunPatch(run, { stage: "collect_28", collect_7: result });
      return { action: "research_collect_7", pending: true, run: next };
    }
    if (stage === "collect_28") {
      const result = await collectSearchConsole(user, 28);
      const next = await automationSchedulerRunPatch(run, { stage: "collect_90", collect_28: result });
      return { action: "research_collect_28", pending: true, run: next };
    }
    if (stage === "collect_90") {
      const result = await collectSearchConsole(user, 90);
      const next = await automationSchedulerRunPatch(run, { stage: "plan", collect_90: result });
      return { action: "research_collect_90", pending: true, run: next };
    }
    const opportunity = await schedulerSelectOpportunity(user, settings);
    const selection = opportunity?._schedulerSelection || {};
    await automationRunFinish(run, "success", {
      details: {
        ...(run.details || {}),
        version: VERSION,
        source: "scheduler",
        stage: "completed",
        selected_opportunity_id: opportunity?.id || null,
        selected_type: opportunity?.opportunity_type || null,
        selection_source: selection.source || null,
        selection_score: selection.score ?? null,
        selection_reason: selection.reason || null,
        selection_fallback_below_threshold: Boolean(selection.fallback_below_threshold),
      },
    });
    return { action: "research_plan", pending: false, opportunity_id: opportunity?.id || null, opportunity_type: opportunity?.opportunity_type || null };
  } catch (error) {
    await automationRunFinish(run, "failed", { last_error: String(error?.message || error).slice(0, 2000), details: { ...(run.details || {}), version: VERSION, source: "scheduler", failed_stage: stage } });
    throw error;
  }
}

async function schedulerResumeResearch(user, settings, runs) {
  const run = (runs || []).find((row) => row.run_type === "research" && row.status === "running" && row?.details?.source === "scheduler");
  if (!run) return null;
  return schedulerProcessResearchRun(run, user, settings);
}

async function schedulerResumeArticleGeneration(user) {
  const rows = await serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&status=eq.selected&opportunity_type=eq.new_article&order=updated_at.asc&limit=50`);
  for (const opportunity of rows || []) {
    const job = opportunity?.evidence?.article_generation_job;
    if (job?.source !== "scheduler" || !job?.response_id || !["queued", "in_progress"].includes(String(job.status || ""))) continue;
    const result = await checkEditorialArticlePackage(user, { id: opportunity.id });
    return { action: "article_generation_check", opportunity_id: opportunity.id, result };
  }
  return null;
}

async function schedulerPrepareMissingImage(user) {
  const rows = await serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&status=eq.selected&opportunity_type=eq.new_article&order=updated_at.asc&limit=50`);
  for (const opportunity of rows || []) {
    const evidence = opportunity?.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
    if (evidence?.article_generation_job?.source !== "scheduler") continue;
    if (evidence?.article_generation?.status !== "draft_ready_for_review") continue;

    const image = articleImageState(opportunity);
    if (image.current?.url) continue;

    if (!image.candidate?.url) {
      const result = await generateEditorialArticleImage(user, { id: opportunity.id, guidance: "" });
      return { action: "image_candidate_generated", opportunity_id: opportunity.id, article_id: result.article_id };
    }

    if (!isAutopilotGeneratedImageAsset(image.candidate)) {
      const candidate = {
        ...image.candidate,
        qa: {
          schema_version: 1,
          status: "human_review_required",
          evaluated_at: new Date().toISOString(),
          model: null,
          relevant: false,
          clear: false,
          misleading: false,
          editorial_quality: false,
          reason: "Candidata non generata ex novo dal percorso text-to-image dell’Autopilota: uso automatico bloccato.",
          regeneration_guidance: "",
          source_policy: EDITORIAL_IMAGE_SOURCE_POLICY,
        },
      };
      await saveArticleImageState(user, opportunity, { ...image, candidate });
      return {
        action: "image_source_human_review_required",
        opportunity_id: opportunity.id,
        article_id: opportunity.target_article_id,
        qa: candidate.qa,
      };
    }

    const qaStatus = String(image.candidate?.qa?.status || "");
    if (!qaStatus) {
      const articleRows = await serviceFetch(`editorial_articles?select=*&id=eq.${encodeURIComponent(opportunity.target_article_id)}&limit=1`);
      const article = articleRows?.[0];
      if (!article?.id) throw new Error("Autopilota QA immagine: articolo collegato non trovato");
      const qa = await evaluateEditorialArticleImage(article, image.candidate);
      const attempt = (Array.isArray(image.history) ? image.history.filter((asset) => ["failed", "human_review_required"].includes(String(asset?.qa?.status || ""))).length : 0) + 1;
      const candidate = { ...image.candidate, qa: { ...qa, attempt } };
      await saveArticleImageState(user, opportunity, { ...image, candidate });
      return {
        action: qa.status === "passed" ? "image_qa_passed" : "image_qa_failed",
        opportunity_id: opportunity.id,
        article_id: article.id,
        qa: candidate.qa,
      };
    }

    if (qaStatus === "failed") {
      const failures = articleImageQaFailureCount(image);
      if (failures <= EDITORIAL_IMAGE_QA_MAX_REGENERATIONS) {
        const guidance = cleanEditorialText(image.candidate?.qa?.regeneration_guidance, 600)
          || "Rendi il collegamento con il tema dell'articolo più immediato e inequivocabile, mantenendo una fotografia editoriale realistica e senza testo.";
        const result = await generateEditorialArticleImage(user, { id: opportunity.id, guidance });
        return {
          action: "image_candidate_regenerated_after_qa",
          opportunity_id: opportunity.id,
          article_id: result.article_id,
          regeneration_number: failures,
          max_regenerations: EDITORIAL_IMAGE_QA_MAX_REGENERATIONS,
        };
      }
      const candidate = {
        ...image.candidate,
        qa: {
          ...image.candidate.qa,
          status: "human_review_required",
          exhausted_at: new Date().toISOString(),
          max_regenerations: EDITORIAL_IMAGE_QA_MAX_REGENERATIONS,
        },
      };
      await saveArticleImageState(user, opportunity, { ...image, candidate });
      return {
        action: "image_qa_human_review_required",
        opportunity_id: opportunity.id,
        article_id: opportunity.target_article_id,
        qa: candidate.qa,
      };
    }

    if (qaStatus === "passed" || qaStatus === "human_review_required") continue;
  }
  return null;
}

function schedulerTargetUrl(opportunity) {
  const manual = manualIdeaMeta(opportunity);
  const candidates = [opportunity?.evidence?.target_page_url, ...(Array.isArray(opportunity?.evidence?.page_urls) ? opportunity.evidence.page_urls : [])];
  if (manual?.target_page_url) candidates.unshift(manual.target_page_url);
  return candidates.map(schedulerInternalPageUrl).find(Boolean) || null;
}


function schedulerLatestArticleCycleRun(runs) {
  return (runs || []).find((run) =>
    run?.run_type === "article_prepare"
    && run?.status === "success"
    && run?.details?.source === "scheduler"
    && validUuid(run?.article_id)
    && validUuid(run?.opportunity_id)
  ) || null;
}

async function schedulerArticleCycleContext(runs) {
  const run = schedulerLatestArticleCycleRun(runs);
  if (!run) return null;
  const [articleRows, opportunityRows] = await Promise.all([
    serviceFetch(`editorial_articles?select=*&id=eq.${encodeURIComponent(run.article_id)}&limit=1`),
    serviceFetch(`editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(run.opportunity_id)}&limit=1`),
  ]);
  const article = articleRows?.[0] || null;
  const opportunity = opportunityRows?.[0] || null;
  if (!article?.id || !opportunity?.id) return null;
  if (String(opportunity.status || "") !== "selected" || String(opportunity.opportunity_type || "") !== "new_article") return null;
  return { run, article, opportunity };
}

function schedulerGeneratedArticleIsUntouched(context) {
  const generation = context?.opportunity?.evidence?.article_generation;
  const expected = String(generation?.article_fingerprint_sha256 || "").trim();
  if (!expected) return false;
  return expected === articleEditorialFingerprint(context.article);
}

async function schedulerApproveArticleImage(user, context) {
  const { article, opportunity } = context;
  const state = articleImageState(opportunity);
  if (state.current?.url && String(article.featured_image_url || "") === String(state.current.url || "")) {
    if (!isAutopilotGeneratedImageAsset(state.current)) {
      throw new Error("Autopilota: immagine già collegata ma priva di provenienza text-to-image verificata; pubblicazione automatica bloccata");
    }
    return { approved: false, already_approved: true, article, opportunity };
  }
  if (!state.candidate?.url) {
    throw new Error("Autopilota: immagine candidata generata ex novo non disponibile per la pubblicazione automatica");
  }

  const candidate = state.candidate;
  if (!isAutopilotGeneratedImageAsset(candidate)) {
    throw new Error("Autopilota: la candidata non proviene dalla generazione text-to-image ex novo; pubblicazione automatica bloccata");
  }
  if (String(candidate?.qa?.status || "") !== "passed") {
    throw new Error("Autopilota: la candidata generata ex novo non ha superato la QA visiva");
  }
  const altText = cleanEditorialText(candidate.alt_text, 180) || defaultArticleImageAlt(article);
  const updatedArticle = await serviceFetch("rpc/editorial_autopilot_set_featured_image", {
    method: "POST",
    body: {
      p_actor_user_id: user.id,
      p_article_id: article.id,
      p_image_url: candidate.url,
      p_alt_text: altText,
    },
  });
  if (!updatedArticle?.id) throw new Error("Autopilota: approvazione automatica immagine non confermata");

  const now = new Date().toISOString();
  let history = state.history;
  if (state.current?.url) {
    history = imageHistoryAppend(history, state.current, "replaced");
  } else if (article.featured_image_url && article.featured_image_url !== candidate.url) {
    history = imageHistoryAppend(history, {
      source: "preexisting",
      status: "previous_featured_image",
      url: article.featured_image_url,
      alt_text: article.featured_image_alt || null,
    }, "replaced");
  }
  const current = {
    ...candidate,
    alt_text: altText,
    status: "approved",
    approved_at: now,
    approved_by: user.id,
  };
  const nextState = { ...state, current, candidate: null, history };
  const nextEvidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
    article_image: nextState,
  };
  const opportunityRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(opportunity.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence: nextEvidence, updated_at: now, decided_by: user.id },
  });
  return {
    approved: true,
    article: updatedArticle,
    opportunity: opportunityRows?.[0] || { ...opportunity, evidence: nextEvidence },
  };
}

async function schedulerQueueArticleSocial(articleId, platforms) {
  const now = new Date().toISOString();
  const output = [];
  for (const platform of platforms || []) {
    if (!EDITORIAL_SOCIAL_PLATFORMS.has(platform)) continue;
    const currentRows = await serviceFetch(
      `editorial_social_publications?select=*&article_id=eq.${encodeURIComponent(articleId)}&platform=eq.${encodeURIComponent(platform)}&limit=1`,
    );
    const current = currentRows?.[0] || null;
    if (current) {
      output.push(current);
      continue;
    }
    const rows = await serviceFetch("editorial_social_publications", {
      method: "POST",
      prefer: "return=representation",
      body: {
        article_id: articleId,
        platform,
        status: "ready",
        attempts: 0,
        queued_at: now,
        ready_at: now,
        updated_at: now,
      },
    });
    if (!rows?.[0]) throw new Error(`Autopilota: coda ${platform} dell'articolo non creata`);
    output.push(rows[0]);
  }
  return output;
}

async function schedulerQueuePlanSocial(item, platforms) {
  const now = new Date().toISOString();
  const output = [];
  for (const platform of platforms || []) {
    if (!EDITORIAL_PLAN_SOCIAL_PLATFORMS.has(platform)) continue;
    const currentRows = await serviceFetch(
      `editorial_social_plan_publications?select=*&social_plan_item_id=eq.${encodeURIComponent(item.id)}&platform=eq.${encodeURIComponent(platform)}&limit=1`,
    );
    const current = currentRows?.[0] || null;
    if (current) {
      output.push(current);
      continue;
    }
    const rows = await serviceFetch("editorial_social_plan_publications", {
      method: "POST",
      prefer: "return=representation",
      body: {
        social_plan_item_id: item.id,
        platform,
        status: "ready",
        attempts: 0,
        queued_at: now,
        updated_at: now,
      },
    });
    if (!rows?.[0]) throw new Error(`Autopilota: coda ${platform} del post non creata`);
    output.push(rows[0]);
  }
  return output;
}

function schedulerSocialSecret(platform) {
  const envName = platform === "facebook"
    ? "EDITORIAL_AUTOPILOT_FACEBOOK_SECRET"
    : platform === "instagram"
      ? "EDITORIAL_AUTOPILOT_INSTAGRAM_SECRET"
      : platform === "linkedin"
        ? "EDITORIAL_AUTOPILOT_LINKEDIN_SECRET"
        : "";
  const secret = envName ? env(envName) : "";
  if (!envName || secret.length < 32) {
    throw new Error(`Autopilota: segreto dedicato ${platform || "social"} non configurato`);
  }
  return secret;
}

async function schedulerSocialFunction(user, platform, action, body = {}) {
  const { url, serviceKey } = supabaseConfig();
  if (!url || !serviceKey) throw new Error("Supabase server non configurato");
  if (!EDITORIAL_SOCIAL_PLATFORMS.has(platform)) throw new Error(`Canale social non supportato: ${platform}`);
  const schedulerSecret = schedulerSocialSecret(platform);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 210000);
  try {
    const response = await fetch(`${url}/functions/v1/editorial-social-${platform}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "x-editorial-actor-id": user.id,
        "x-offertalogica-autopilot-secret": schedulerSecret,
      },
      body: JSON.stringify({ action, ...body }),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `${platform}: funzione social HTTP ${response.status}`);
    }
    return payload || { ok: true, result: "unknown" };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${platform}: timeout pubblicazione social`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function schedulerEnsureSocialRuntime(user, platforms) {
  if (!Array.isArray(platforms) || !platforms.length) {
    throw new Error("Autopilota: nessun canale social abilitato");
  }
  for (const platform of platforms) {
    const expectedVersion = EDITORIAL_SOCIAL_RUNTIME_VERSIONS[platform];
    if (!expectedVersion) throw new Error(`Autopilota: runtime social non definito per ${platform}`);
    const payload = await schedulerSocialFunction(user, platform, "validate");
    if (String(payload?.version || "") !== expectedVersion) {
      throw new Error(`Autopilota: funzione social ${platform} non allineata al runtime richiesto ${expectedVersion}`);
    }
  }
}

function schedulerSocialResultState(payload) {
  const result = String(payload?.result || payload?.status || "").trim();
  if (["published", "already_published", "skipped"].includes(result)) return "success";
  if (result === "ambiguous_publish") return "ambiguous";
  if (["waiting_web", "waiting_assets", "in_progress", "carousel_required"].includes(result)) return "retry";
  if (["failed", "retry_exhausted", "not_queued", "legacy_queue"].includes(result)) return "failed";
  return payload?.published === true ? "success" : "failed";
}

function schedulerArticleIntroAssetReadyForPlatforms(context, platforms = []) {
  const state = editorialSocialAssetsState(context?.opportunity);
  const intro = state.article_intro || null;
  if (!intro || String(intro.status || "") !== "ready") return false;
  const requested = Array.isArray(platforms) ? platforms : [];
  if (requested.includes("linkedin") && cleanEditorialText(intro.copy?.linkedin_text, 1200).length < 180) return false;
  const needsMetaCard = requested.some((platform) => EDITORIAL_PLAN_SOCIAL_PLATFORMS.has(String(platform || "")));
  if (!needsMetaCard) return true;
  return Boolean(
    /^https:\/\//i.test(String(intro.card?.url || ""))
    && String(intro.card?.template_version || "") === EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION
    && String(intro.card?.source || "") === "composed"
    && String(intro.card?.renderer || "") === "resvg_wasm"
  );
}

function schedulerArticleImageIsExplicitlyApproved(asset) {
  return Boolean(
    /^https:\/\//i.test(String(asset?.url || ""))
    && String(asset?.status || "") === "approved"
    && String(asset?.approved_at || "").trim()
    && validUuid(String(asset?.approved_by || ""))
  );
}

async function schedulerPublishArticleIntro(user, context, platforms) {
  if (!Array.isArray(platforms) || !platforms.length) {
    return {
      blocked: true,
      reason: "no_enabled_social_channels",
      message: "Nessun canale social abilitato: pubblicazione automatica fermata prima dell'articolo.",
      publication_performed: false,
    };
  }
  await schedulerEnsureSocialRuntime(user, platforms);
  let nextContext = context;
  if (!schedulerGeneratedArticleIsUntouched(context) && context.article.status !== "published") {
    return {
      blocked: true,
      reason: "manual_changes_detected",
      message: "La bozza è stata modificata dopo la generazione: pubblicazione automatica fermata.",
    };
  }

  if (context.article.status !== "published") {
    if (!["draft", "in_review", "approved"].includes(String(context.article.status || ""))) {
      return {
        blocked: true,
        reason: `article_status_${context.article.status || "unknown"}`,
        message: "Lo stato dell'articolo richiede controllo umano.",
      };
    }
    const imageState = articleImageState(context.opportunity);
    const featuredImageUrl = String(context.article.featured_image_url || "").trim();
    const imageAlreadyApproved = Boolean(
      imageState.current?.url
      && featuredImageUrl === String(imageState.current.url || "")
      && schedulerArticleImageIsExplicitlyApproved(imageState.current),
    );
    if (!imageAlreadyApproved) {
      const qaStatus = String(imageState.candidate?.qa?.status || "");
      if (qaStatus !== "passed") {
        return {
          blocked: true,
          reason: qaStatus === "human_review_required" ? "image_qa_human_review_required" : "image_qa_not_passed",
          message: qaStatus === "human_review_required"
            ? "La QA visiva non è stata superata dopo due rigenerazioni: serve controllo umano dell'immagine."
            : "L'immagine candidata non ha ancora superato la QA visiva automatica.",
          publication_performed: false,
        };
      }
      const imageResult = await schedulerApproveArticleImage(user, context);
      if (imageResult?.article?.id) {
        nextContext = { ...context, article: imageResult.article, opportunity: imageResult.opportunity || context.opportunity };
      }
    }
    const published = await serviceFetch("rpc/editorial_autopilot_publish_article", {
      method: "POST",
      body: { p_actor_user_id: user.id, p_article_id: nextContext.article.id },
    });
    if (!published?.id || String(published.status || "") !== "published") {
      throw new Error("Autopilota: pubblicazione articolo non confermata");
    }
    nextContext = { ...nextContext, article: published };
  }

  if (!schedulerArticleIntroAssetReadyForPlatforms(nextContext, platforms)) {
    throw new Error("Autopilota: asset social iniziale dell'articolo non pronto o non valido; pubblicazione social fermata");
  }

  await schedulerQueueArticleSocial(nextContext.article.id, platforms);
  const results = {};
  let ambiguous = false;
  for (const platform of platforms) {
    const action = "process_autopilot_article_intro";
    const payload = await schedulerSocialFunction(user, platform, action, { article_id: nextContext.article.id });
    results[platform] = payload;
    const state = schedulerSocialResultState(payload);
    if (state === "ambiguous") ambiguous = true;
    else if (state === "retry") {
      return {
        blocked: false,
        retry_pending: true,
        retry_reason: `${platform}:${payload?.result || "attesa"}`,
        article: nextContext.article,
        opportunity: nextContext.opportunity,
        social: results,
        publication_performed: false,
      };
    } else if (state === "failed") throw new Error(`Autopilota: ${platform} non pubblicato (${payload?.error || payload?.result || "errore"})`);
  }

  return {
    blocked: false,
    ambiguous,
    retry_pending: false,
    article: nextContext.article,
    opportunity: nextContext.opportunity,
    social: results,
    publication_performed: true,
  };
}

function schedulerPlanPostType(slotKind) {
  if (slotKind === "social_followup") return "article_followup";
  if (slotKind === "social_related") return "related";
  return null;
}

async function schedulerPlanItemForCycle(context, slotKind) {
  const postType = schedulerPlanPostType(slotKind);
  if (!postType) return null;
  const rows = await serviceFetch(
    `editorial_social_plan_items?select=*&source_article_id=eq.${encodeURIComponent(context.article.id)}&opportunity_id=eq.${encodeURIComponent(context.opportunity.id)}&post_type=eq.${encodeURIComponent(postType)}&order=created_at.desc&limit=1`,
  );
  return rows?.[0] || null;
}

async function schedulerCompleteOpportunityCycle(user, context, finalItem, reason = "published") {
  if (String(context?.opportunity?.status || "") !== "selected") return false;
  const evidence = {
    ...(context.opportunity.evidence && typeof context.opportunity.evidence === "object" ? context.opportunity.evidence : {}),
    autopilot_cycle: {
      schema_version: 1,
      status: "completed",
      completed_at: new Date().toISOString(),
      completion_reason: reason,
      article_id: context.article.id,
      final_social_plan_item_id: finalItem?.id || null,
    },
  };
  await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(context.opportunity.id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      status: "completed",
      evidence,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
  return true;
}

function schedulerPlanAssetIsOlInforma(context, item) {
  const state = editorialSocialAssetsState(context?.opportunity);
  const asset = state.items?.[String(item?.id || "")] || null;
  return Boolean(
    asset
    && String(asset.status || "") === "ready"
    && String(asset.image?.qa?.status || "") === "passed"
    && /^https:\/\//i.test(String(asset.card?.url || ""))
    && String(asset.card?.template_version || "") === EDITORIAL_SOCIAL_CARD_TEMPLATE_VERSION
    && String(asset.card?.source || "") === "composed"
    && String(asset.card?.renderer || "") === "resvg_wasm"
  );
}

async function schedulerPublishPlanItem(user, context, slotKind, enabledPlatforms) {
  const item = await schedulerPlanItemForCycle(context, slotKind);
  if (!item?.id) throw new Error(`Autopilota: post ${schedulerPlanPostType(slotKind)} non trovato`);
  if (String(item.status || "") === "cancelled") {
    if (slotKind === "social_related") await schedulerCompleteOpportunityCycle(user, context, item, "final_post_cancelled");
    return { blocked: true, reason: "post_cancelled", item, publication_performed: false };
  }
  if (String(item.status || "") === "published") {
    if (slotKind === "social_related") await schedulerCompleteOpportunityCycle(user, context, item, "final_post_already_published");
    return { blocked: false, already_published: true, item, publication_performed: true, social: {} };
  }
  if (String(context.article.status || "") !== "published") {
    throw new Error("Autopilota: il post social non può partire prima della pubblicazione dell'articolo");
  }
  if (!schedulerPlanAssetIsOlInforma(context, item)) {
    throw new Error("Autopilota: card OL Informa non pronta o non valida; pubblicazione social fermata");
  }

  const enabledPlanPlatforms = (enabledPlatforms || []).filter((platform) => EDITORIAL_PLAN_SOCIAL_PLATFORMS.has(String(platform || "")));
  const requested = Array.isArray(item.platforms) && item.platforms.length
    ? item.platforms.filter((platform) => enabledPlanPlatforms.includes(platform) && EDITORIAL_PLAN_SOCIAL_PLATFORMS.has(String(platform || "")))
    : enabledPlanPlatforms;
  if (!requested.length) {
    if (slotKind === "social_related") {
      await schedulerCompleteOpportunityCycle(user, context, item, "final_post_no_enabled_meta_channels");
    }
    return { blocked: true, reason: "no_enabled_plan_channels", item, publication_performed: false };
  }
  await schedulerEnsureSocialRuntime(user, requested);

  const now = new Date().toISOString();
  const publishingRows = await serviceFetch(`editorial_social_plan_items?id=eq.${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { status: "publishing", scheduled_for: item.scheduled_for || now, updated_at: now, updated_by: user.id },
  });
  const publishingItem = publishingRows?.[0] || item;
  await schedulerQueuePlanSocial(publishingItem, requested);

  const results = {};
  let ambiguous = false;
  try {
    for (const platform of requested) {
      const payload = await schedulerSocialFunction(user, platform, "process_plan_item", {
        social_plan_item_id: publishingItem.id,
      });
      results[platform] = payload;
      const state = schedulerSocialResultState(payload);
      if (state === "ambiguous") ambiguous = true;
      else if (state === "retry") {
        return {
          blocked: false,
          retry_pending: true,
          retry_reason: `${platform}:${payload?.result || "attesa"}`,
          item: publishingItem,
          social: results,
          publication_performed: false,
        };
      } else if (state === "failed") throw new Error(`Autopilota: ${platform} post non pubblicato (${payload?.error || payload?.result || "errore"})`);
    }
  } catch (error) {
    await serviceFetch(`editorial_social_plan_items?id=eq.${encodeURIComponent(publishingItem.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "failed", updated_at: new Date().toISOString(), updated_by: user.id },
    }).catch(() => {});
    throw error;
  }

  const finalStatus = ambiguous ? "failed" : "published";
  const finalRows = await serviceFetch(`editorial_social_plan_items?id=eq.${encodeURIComponent(publishingItem.id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { status: finalStatus, updated_at: new Date().toISOString(), updated_by: user.id },
  });
  const finalItem = finalRows?.[0] || { ...publishingItem, status: finalStatus };

  if (!ambiguous && slotKind === "social_related") {
    await schedulerCompleteOpportunityCycle(user, context, finalItem, "final_post_published");
  }

  return {
    blocked: false,
    ambiguous,
    item: finalItem,
    social: results,
    publication_performed: !ambiguous,
  };
}

async function schedulerProcessSlot(slot, user, settings, runs, local) {
  const schedulerKey = `${local.date}:${slot.id}`;
  const attemptState = schedulerSlotAttemptState(runs, schedulerKey);
  const authSecretRecovery = schedulerArticlePublishAuthRecoverable(slot, runs, schedulerKey);
  const details = {
    scheduler_key: schedulerKey,
    slot_id: slot.id,
    slot_kind: slot.kind,
    local_date: local.date,
    local_time: local.time,
    timezone: local.time_zone,
    stage: "started",
    slot_only: true,
    attempt: attemptState.failedAttempts + 1,
    max_attempts: authSecretRecovery ? SCHEDULER_SLOT_MAX_ATTEMPTS_PER_DAY + 1 : SCHEDULER_SLOT_MAX_ATTEMPTS_PER_DAY,
    ...(authSecretRecovery ? { recovery_reason: "social_auth_secret_v0.12.50" } : {}),
  };
  const run = await automationSchedulerRunStart(String(slot.kind || "research"), details);
  if (!run?.id) throw new Error("Autopilota: run schedulato non creato");
  try {
    if (slot.kind === "research") {
      const staged = await automationSchedulerRunPatch(run, { stage: "collect_7" });
      return schedulerProcessResearchRun(staged, user, settings);
    }
    if (slot.kind === "article_prepare") {
      if (Number(settings?.max_articles_per_cycle) <= 0) {
        await automationRunFinish(run, "success", { details: { ...details, stage: "skipped", reason: "max_articles_per_cycle=0" } });
        return { action: "article_prepare_skipped", reason: "max_articles_per_cycle=0" };
      }
      if (!schedulerArticleFrequencyAllows(settings, runs)) {
        await automationRunFinish(run, "success", { details: { ...details, stage: "skipped", reason: "article_frequency_weeks" } });
        return { action: "article_prepare_skipped", reason: "article_frequency_weeks" };
      }
      const opportunity = await schedulerSelectOpportunity(user, settings);
      if (!opportunity?.id) {
        await automationRunFinish(run, "success", { details: { ...details, stage: "completed", no_publish: true, reason: "no_opportunity" } });
        return { action: "article_prepare_no_opportunity" };
      }
      const selection = opportunity?._schedulerSelection || {};
      const selectionDetails = {
        selection_source: selection.source || null,
        selection_score: selection.score ?? null,
        selection_reason: selection.reason || null,
        selection_fallback_below_threshold: Boolean(selection.fallback_below_threshold),
      };
      if (opportunity.opportunity_type === "new_article") {
        const enabledPlatforms = await editorialEnabledSocialPlatforms();
        const result = await generateEditorialArticlePackage(user, { id: opportunity.id, platforms: enabledPlatforms });
        await automationRunFinish(run, "success", { opportunity_id: opportunity.id, article_id: result.article_id || null, details: { ...details, ...selectionDetails, stage: "background_started", opportunity_id: opportunity.id, slot_only: true } });
        return { action: "article_generation_started", opportunity_id: opportunity.id, result };
      }
      await automationRunFinish(run, "success", { details: { ...details, stage: "skipped", reason: `unsupported_opportunity_type:${opportunity.opportunity_type || "unknown"}` } });
      return { action: "article_prepare_skipped", reason: "unsupported_opportunity_type" };
    }
    const mode = String(settings?.execution_mode || "approval");
    if (mode === "draft") {
      await automationRunFinish(run, "success", { details: { ...details, stage: "skipped_draft_mode", publication_performed: false, reason: "draft_mode" } });
      return { action: `${slot.kind}_skipped_draft_mode`, publication_performed: false };
    }
    if (mode !== "automatic") {
      await automationRunFinish(run, "success", { details: { ...details, stage: "waiting_human_approval", publication_performed: false, reason: "approval_mode" } });
      return { action: `${slot.kind}_waiting_human_approval`, publication_performed: false };
    }

    const context = await schedulerArticleCycleContext(runs);
    if (!context) {
      await automationRunFinish(run, "success", { details: { ...details, stage: "skipped", publication_performed: false, reason: "no_article_cycle" } });
      return { action: `${slot.kind}_skipped`, reason: "no_article_cycle", publication_performed: false };
    }
    const enabledPlatforms = await editorialEnabledSocialPlatforms();

    if (slot.kind === "article_publish") {
      const result = await schedulerPublishArticleIntro(user, context, enabledPlatforms);
      if (result.blocked) {
        if (result.reason === "no_enabled_social_channels") {
          throw new Error("Autopilota: nessun canale social abilitato per lo slot article_publish");
        }
        await automationRunFinish(run, "success", {
          opportunity_id: context.opportunity.id,
          article_id: context.article.id,
          details: { ...details, stage: "waiting_human_review", publication_performed: false, reason: result.reason },
        });
        return { action: "article_publish_waiting_human_review", ...result };
      }
      if (result.retry_pending) {
        await automationRunFinish(run, "success", {
          opportunity_id: context.opportunity.id,
          article_id: context.article.id,
          details: { ...details, stage: "waiting_social_retry", publication_performed: false, reason: result.retry_reason || "social_retry", social: result.social || {} },
        });
        return { action: "article_publish_waiting_social_retry", ...result };
      }
      await automationRunFinish(run, "success", {
        opportunity_id: context.opportunity.id,
        article_id: context.article.id,
        details: {
          ...details,
          stage: result.ambiguous ? "manual_social_check_required" : "completed",
          publication_performed: true,
          social: result.social,
        },
      });
      return { action: result.ambiguous ? "article_published_social_check_required" : "article_published", ...result };
    }

    if (slot.kind === "social_followup" || slot.kind === "social_related") {
      const result = await schedulerPublishPlanItem(user, context, slot.kind, enabledPlatforms);
      if (result.blocked && result.reason === "no_enabled_social_channels") {
        throw new Error(`Autopilota: nessun canale social abilitato per lo slot ${slot.kind}`);
      }
      if (result.retry_pending) {
        await automationRunFinish(run, "success", {
          opportunity_id: context.opportunity.id,
          article_id: context.article.id,
          social_plan_item_id: result.item?.id || null,
          details: { ...details, stage: "waiting_social_retry", publication_performed: false, reason: result.retry_reason || "social_retry", social: result.social || {} },
        });
        return { action: `${slot.kind}_waiting_social_retry`, ...result };
      }
      await automationRunFinish(run, "success", {
        opportunity_id: context.opportunity.id,
        article_id: context.article.id,
        social_plan_item_id: result.item?.id || null,
        details: {
          ...details,
          stage: result.blocked ? "blocked" : (result.ambiguous ? "manual_social_check_required" : "completed"),
          publication_performed: Boolean(result.publication_performed),
          reason: result.reason || null,
          social: result.social || {},
        },
      });
      return { action: `${slot.kind}_${result.blocked ? "blocked" : (result.ambiguous ? "check_required" : "published")}`, ...result };
    }

    await automationRunFinish(run, "success", { details: { ...details, stage: "skipped", publication_performed: false, reason: "unsupported_slot_kind" } });
    return { action: `${slot.kind}_skipped`, publication_performed: false, reason: "unsupported_slot_kind" };
  } catch (error) {
    await automationRunFinish(run, "failed", { last_error: String(error?.message || error).slice(0, 2000), details: { ...details, stage: "failed" } });
    throw error;
  }
}

async function editorialAutopilotTick() {
  const settings = await automationSchedulerSettings();
  if (!settings?.enabled) return { ok: true, version: VERSION, active: false, action: "disabled" };
  const user = await automationSchedulerUser(settings);
  let runs = await automationSchedulerRuns(120);

  const research = await schedulerResumeResearch(user, settings, runs);
  if (research) return { ok: true, version: VERSION, active: true, ...research };

  const generation = await schedulerResumeArticleGeneration(user);
  if (generation) return { ok: true, version: VERSION, active: true, ...generation };

  const image = await schedulerPrepareMissingImage(user);
  if (image) return { ok: true, version: VERSION, active: true, ...image };

  const local = schedulerLocalParts(settings.timezone || "Europe/Rome");
  const schedule = await serviceFetch("editorial_automation_schedule?select=*&enabled=eq.true&order=sort_order.asc");
  runs = runs.length ? runs : await automationSchedulerRuns(120);
  const due = (schedule || []).filter((slot) => {
    if (Number(slot.weekday) !== local.weekday) return false;
    const minutes = schedulerSlotMinutes(slot.time_local);
    if (minutes === null || local.minutes < minutes) return false;
    const key = `${local.date}:${slot.id}`;
    const attemptState = schedulerSlotAttemptState(runs, key);
    if (!attemptState.consumed) return true;
    return schedulerArticlePrepareRecoverable(slot, settings, runs, key)
      || schedulerArticlePublishAuthRecoverable(slot, runs, key)
      || schedulerArticlePublishHumanReviewRecoverable(slot, runs, key)
      || schedulerSocialRetryRecoverable(slot, runs, key);
  })[0] || null;

  // Ricerca e preparazione del nuovo articolo non dipendono dagli asset social di cicli precedenti.
  // Eseguire prima questi slot impedisce a una rigenerazione social problematica di bloccare la settimana editoriale.
  if (due && ["research", "article_prepare"].includes(String(due.kind || ""))) {
    const result = await schedulerProcessSlot(due, user, settings, runs, local);
    return { ok: true, version: VERSION, active: true, slot: { id: due.id, kind: due.kind, label: due.label }, ...result };
  }

  let socialAssetError = null;
  const dueKind = String(due?.kind || "");
  const dueAssetType = ({ article_publish: "article_intro", social_followup: "article_followup", social_related: "related" })[dueKind] || "";
  const duePlatforms = dueAssetType ? await editorialEnabledSocialPlatforms() : null;
  try {
    // Quando uno slot e' gia' dovuto, prepariamo soltanto l'asset necessario a QUELLO slot.
    // Un'immagine del venerdi o del lunedi non puo' quindi ritardare la pubblicazione del mercoledi.
    const socialAsset = dueAssetType
      ? await schedulerPrepareMissingSocialAsset(user, { selectedOnly: true, targetPostType: dueAssetType, targetPlatforms: duePlatforms })
      : await schedulerPrepareMissingSocialAsset(user);
    if (socialAsset) return { ok: true, version: VERSION, active: true, ...socialAsset };
  } catch (error) {
    socialAssetError = String(error?.message || error).slice(0, 1200);
    console.error("editorial_social_asset_prepare_failed", socialAssetError);
  }

  let regenerationError = null;
  // La rigenerazione manuale di un vecchio post e' background: non deve precedere uno slot
  // settimanale gia' dovuto. Viene ripresa appena il calendario non ha un'azione prioritaria.
  if (!due) {
    try {
      const regeneratedSocial = await schedulerPublishRequestedSocialRegeneration(user);
      if (regeneratedSocial) return { ok: true, version: VERSION, active: true, ...regeneratedSocial };
    } catch (error) {
      regenerationError = String(error?.message || error).slice(0, 1200);
      console.error("editorial_social_regeneration_failed", regenerationError);
    }
  }

  if (due) {
    // Gli slot che pubblicano contenuti social richiedono la card specifica dello slot. Se la sua
    // preparazione fallisce, non consumiamo un tentativo: il prossimo heartbeat riprovera'.
    if (socialAssetError && dueAssetType) {
      return {
        ok: true,
        version: VERSION,
        active: true,
        action: "waiting_social_assets",
        slot: { id: due.id, kind: due.kind, label: due.label },
        local,
        error: socialAssetError,
      };
    }
    const result = await schedulerProcessSlot(due, user, settings, runs, local);
    return { ok: true, version: VERSION, active: true, slot: { id: due.id, kind: due.kind, label: due.label }, ...result };
  }

  try {
    const radar = await schedulerMaybeResearchRadar(user, settings, local);
    if (radar) return { ok: true, version: VERSION, active: true, ...radar, local };
  } catch (error) {
    console.error("editorial_research_radar_failed", String(error?.message || error).slice(0, 1200));
  }

  if (socialAssetError || regenerationError) {
    return {
      ok: true,
      version: VERSION,
      active: true,
      action: "background_social_error",
      local,
      social_asset_error: socialAssetError,
      regeneration_error: regenerationError,
    };
  }

  return { ok: true, version: VERSION, active: true, action: "idle", local };
}


function normalizedPageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Pagina da aggiornare non indicata");
  let parsed;
  let configured;
  try {
    parsed = new URL(raw);
    configured = new URL(searchConsoleConfig().siteUrl);
  } catch {
    throw new Error("URL pagina non valido");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== configured.origin) {
    throw new Error("La proposta può usare solo pagine HTTPS di OffertaLogica");
  }
  parsed.hash = "";
  return parsed.href;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16) || 32));
}

function plainHtmlText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function firstTagText(html, tagName) {
  const match = String(html || "").match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return plainHtmlText(match?.[1] || "").slice(0, 500);
}

function metaDescription(html) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\bname\s*=\s*["']description["']/i.test(tag)) continue;
    const match = tag.match(/\bcontent\s*=\s*["']([\s\S]*?)["']/i);
    if (match?.[1]) return decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return "";
}

function pageHeadings(html) {
  const headings = [];
  const regex = /<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = regex.exec(String(html || ""))) !== null && headings.length < 80) {
    const id = match[2]?.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    headings.push({ level: match[1].toUpperCase(), id, text: plainHtmlText(match[3]).slice(0, 300) });
  }
  return headings.filter((row) => row.text);
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemItalianWord(word) {
  const clean = String(word || "");
  return clean.length > 4 ? clean.replace(/[aeio]$/, "") : clean;
}

function normalizedWords(value) {
  return normalizedText(value).split(" ").filter((word) => word.length > 2).map(stemItalianWord);
}

function topicWords(value) {
  return [...new Set(normalizedWords(value))].slice(0, 12);
}

function wordCoverage(value, words) {
  if (!words.length) return 0;
  const haystack = new Set(normalizedWords(value));
  const hits = words.filter((word) => haystack.has(word)).length;
  return hits / words.length;
}

function bestTopicHeading(headings, topic) {
  const words = topicWords(topic);
  return (headings || [])
    .map((heading, index) => ({ ...heading, coverage: wordCoverage(heading.text, words), index }))
    .filter((heading) => heading.coverage > 0)
    .sort((a, b) => b.coverage - a.coverage || a.index - b.index)[0] || null;
}

async function opportunityContextPages(opportunity) {
  const saved = Array.isArray(opportunity?.evidence?.page_urls)
    ? opportunity.evidence.page_urls.filter(Boolean)
    : [];
  if (saved.length) return saved.slice(0, 5);
  const topicKey = String(opportunity?.evidence?.topic_key || "");
  if (!topicKey) return [];
  const analysis = await analysisPayload();
  const signal = (analysis.signals || []).find((row) => row.topic_key === topicKey);
  return Array.isArray(signal?.page_urls) ? signal.page_urls.filter(Boolean).slice(0, 5) : [];
}

async function fetchEditorialPage(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EDITORIAL_PAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(targetUrl, {
      headers: { "User-Agent": "OffertaLogica-Editorial-Update-Proposal/1.0" },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Pagina non leggibile: HTTP ${response.status}`);
    const finalUrl = normalizedPageUrl(response.url || targetUrl);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html")) throw new Error("La pagina indicata non restituisce HTML");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > TARGET_PAGE_MAX_BYTES) throw new Error("Pagina troppo grande per l’analisi controllata");
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > TARGET_PAGE_MAX_BYTES) throw new Error("Pagina troppo grande per l’analisi controllata");
    return { html, finalUrl };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Timeout durante la lettura della pagina esistente");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUpdateProposal(opportunity, targetUrl, html, userId) {
  const topic = String(opportunity.topic || "").trim();
  const words = topicWords(topic);
  const headings = pageHeadings(html);
  const bestHeading = bestTopicHeading(headings, topic);
  const title = firstTagText(html, "title");
  const description = metaDescription(html);
  const h1 = firstTagText(html, "h1");
  const metric28 = opportunity?.evidence?.metrics?.["28"] || {};
  const impressions28 = Number(metric28.impressions || 0);
  const clicks28 = Number(metric28.clicks || 0);
  const position28 = Number.isFinite(Number(metric28.avg_position)) ? Number(metric28.avg_position).toFixed(1) : "n/d";
  const queryCount = Number(opportunity?.evidence?.query_count || 0);
  const presence = {
    title: wordCoverage(title, words),
    meta_description: wordCoverage(description, words),
    h1: wordCoverage(h1, words),
    heading: bestHeading?.coverage || 0,
  };

  const plan = [];
  if (bestHeading) {
    plan.push({
      key: "target_section",
      label: "Sezione da revisionare",
      target: `${bestHeading.level}${bestHeading.id ? ` #${bestHeading.id}` : ""} · ${bestHeading.text}`,
      change: `Revisionare e approfondire la sezione già esistente rispetto al tema “${topic}”, senza creare una pagina duplicata.`,
      reason: `Search Console registra ${impressions28} impressioni, ${clicks28} clic e posizione media ${position28} nei 28 giorni disponibili.`,
    });
  } else {
    plan.push({
      key: "target_section",
      label: "Sezione da aggiungere",
      target: "Contenuto principale",
      change: `Valutare una sezione esplicita dedicata al tema “${topic}”, mantenendo invariato il resto della pagina fino alla revisione manuale.`,
      reason: `Il tema genera un segnale Search Console ma non è stato trovato un H2/H3 chiaramente corrispondente nella pagina corrente.`,
    });
  }

  plan.push({
    key: "query_intent",
    label: "Copertura delle query",
    target: bestHeading?.text || h1 || title || "Pagina",
    change: `Confrontare le ${queryCount ? `${queryCount} query` : "query"} collegate con il testo della sezione e integrare soltanto i sotto-temi realmente mancanti, usando fonti verificabili.`,
    reason: "La proposta usa il cluster Search Console salvato; non inventa dati o valori tecnici.",
  });

  if (presence.meta_description >= 0.5) {
    plan.push({
      key: "snippet",
      label: "Snippet SEO",
      target: description || "Meta description",
      change: "Nessuna modifica automatica alla meta description: il tema risulta già rappresentato. Rivalutarla soltanto dopo l’aggiornamento del contenuto.",
      reason: "Si evita di modificare lo snippet senza un beneficio verificato.",
    });
  } else {
    plan.push({
      key: "snippet",
      label: "Snippet SEO da verificare",
      target: description || "Meta description assente",
      change: `Dopo la revisione del contenuto, valutare se rendere più esplicito il tema “${topic}” nella meta description, senza cambiare automaticamente title o H1.`,
      reason: "Il tema è poco rappresentato nello snippet corrente rispetto al segnale Search Console.",
    });
  }

  return {
    schema_version: 1,
    status: "pending_review",
    target_url: targetUrl,
    prepared_at: new Date().toISOString(),
    prepared_by: userId,
    page: {
      fingerprint_sha256: crypto.createHash("sha256").update(html).digest("hex"),
      title,
      meta_description: description,
      h1,
      matched_heading: bestHeading ? {
        level: bestHeading.level,
        id: bestHeading.id || null,
        text: bestHeading.text,
        coverage: roundMetric(bestHeading.coverage, 3),
      } : null,
      topic_presence: Object.fromEntries(Object.entries(presence).map(([key, value]) => [key, roundMetric(value, 3)])),
    },
    signal: {
      topic,
      score: Number(opportunity.score || 0),
      query_count: queryCount,
      metrics_28: {
        impressions: impressions28,
        clicks: clicks28,
        avg_position: Number.isFinite(Number(metric28.avg_position)) ? roundMetric(Number(metric28.avg_position), 2) : null,
      },
    },
    plan,
    safeguards: [
      "La pagina pubblicata non viene modificata da questa proposta.",
      "L’approvazione registra soltanto una decisione editoriale e non applica modifiche.",
      "Qualsiasi nuovo dato tecnico o numerico deve essere verificato con fonti prima dell’eventuale applicazione.",
    ],
  };
}

async function prepareEditorialUpdateProposal(user, idValue, targetUrlValue) {
  const id = String(idValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  if (opportunity.status !== "selected") throw new Error("L’opportunità deve essere selezionata");
  if (opportunity.opportunity_type !== "update_article") {
    throw new Error("La proposta di aggiornamento richiede la destinazione Aggiornamento articolo/pagina");
  }
  if (opportunity.target_article_id) throw new Error("L’opportunità è già collegata a un articolo editoriale");

  const targetUrl = normalizedPageUrl(targetUrlValue);
  const candidates = (await opportunityContextPages(opportunity)).map((url) => {
    try { return normalizedPageUrl(url); } catch { return ""; }
  }).filter(Boolean);
  const savedTarget = opportunity?.evidence?.target_page_url;
  if (savedTarget) {
    try { candidates.push(normalizedPageUrl(savedTarget)); } catch {}
  }
  if (!new Set(candidates).has(targetUrl)) throw new Error("La pagina scelta non appartiene alle pagine associate all’opportunità");

  const pageResult = await fetchEditorialPage(targetUrl);
  const proposal = buildUpdateProposal(opportunity, pageResult.finalUrl, pageResult.html, user.id);
  const previousEvidence = opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const { update_text_draft: _discardedTextDraft, update_apply_preview: _discardedApplyPreview, ...proposalEvidenceBase } = previousEvidence;
  const evidence = {
    ...proposalEvidenceBase,
    page_urls: Array.isArray(previousEvidence.page_urls) && previousEvidence.page_urls.length
      ? previousEvidence.page_urls
      : candidates.slice(0, 5),
    target_page_url: pageResult.finalUrl,
    update_proposal: proposal,
  };
  const now = new Date().toISOString();
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: now, decided_by: user.id },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id) throw new Error("Proposta di aggiornamento non salvata");
  return { opportunity: updated, proposal };
}

async function reviewEditorialUpdateProposal(user, idValue, decisionValue) {
  const id = String(idValue || "").trim();
  const decision = String(decisionValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  if (!UPDATE_PROPOSAL_DECISIONS.has(decision)) throw new Error("Decisione proposta non valida");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  if (opportunity.status !== "selected" || opportunity.opportunity_type !== "update_article") {
    throw new Error("La proposta non è più associata a un aggiornamento selezionato");
  }
  const currentProposal = opportunity?.evidence?.update_proposal;
  if (!currentProposal || typeof currentProposal !== "object") throw new Error("Prepara prima una proposta di aggiornamento");
  const now = new Date().toISOString();
  const proposal = {
    ...currentProposal,
    status: decision,
    reviewed_at: now,
    reviewed_by: user.id,
  };
  const currentEvidence = opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const { update_text_draft: _discardedTextDraft, update_apply_preview: _discardedApplyPreview, ...reviewEvidenceBase } = currentEvidence;
  const evidence = {
    ...reviewEvidenceBase,
    update_proposal: proposal,
  };
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: now, decided_by: user.id },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id) throw new Error("Decisione sulla proposta non salvata");
  return { opportunity: updated, proposal };
}


function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pageHeadingRanges(html) {
  const source = String(html || "");
  const items = [];
  const regex = /<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = regex.exec(source)) !== null && items.length < 120) {
    const id = match[2]?.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    items.push({
      level: Number(match[1].slice(1)),
      tag: match[1].toUpperCase(),
      id,
      text: plainHtmlText(match[3]).slice(0, 300),
      start: match.index,
      heading_end: regex.lastIndex,
    });
  }
  return items;
}

function approvedProposalSection(html, proposal) {
  const matched = proposal?.page?.matched_heading;
  if (!matched || typeof matched !== "object") throw new Error("La proposta approvata non identifica una sezione precisa");
  const headings = pageHeadingRanges(html);
  const targetId = String(matched.id || "").trim();
  const targetText = normalizedText(matched.text || "");
  const index = headings.findIndex((heading) => {
    if (targetId && heading.id === targetId) return true;
    return targetText && normalizedText(heading.text) === targetText;
  });
  if (index < 0) throw new Error("La sezione approvata non è più presente nella pagina: rigenera la proposta");
  const heading = headings[index];
  let end = String(html || "").length;
  for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
    if (headings[cursor].level <= heading.level) {
      end = headings[cursor].start;
      break;
    }
  }
  return { heading, start: heading.start, end, html: String(html || "").slice(heading.start, end) };
}

function firstSectionParagraph(sectionHtml, headingEndOffset = 0) {
  const source = String(sectionHtml || "").slice(Math.max(0, Number(headingEndOffset) || 0));
  const match = source.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (!match) return null;
  const text = plainHtmlText(match[1]).replace(/\s+/g, " ").trim();
  return text ? { text } : null;
}

function conservativeLeadRevision(paragraphText, headingText) {
  const current = String(paragraphText || "").trim();
  const prefix = String(headingText || "").split(/[:–—]/, 1)[0].trim();
  if (!current || !prefix) return null;
  const prefixWords = normalizedWords(prefix);
  if (prefixWords.length < 2) return null;
  const firstKeyword = prefixWords[0];
  const match = current.match(/^(Il|Lo|La|I|Gli|Le|Un|Una|Uno)\s+([^\s,.;:!?]+)/i);
  if (!match) return null;
  const paragraphKeyword = stemItalianWord(normalizedText(match[2]).split(" ")[0] || "");
  if (!paragraphKeyword || paragraphKeyword !== firstKeyword) return null;

  const article = match[1];
  const safePrefix = `${prefix.charAt(0).toLowerCase()}${prefix.slice(1)}`;
  const replacement = `${article} ${safePrefix}`;
  const beforeLead = `${match[1]} ${match[2]}`;
  if (normalizedText(current).startsWith(normalizedText(replacement))) return null;
  const proposed = current.replace(new RegExp(`^${escapeRegExp(beforeLead)}\\b`, "i"), replacement);
  if (!proposed || proposed === current) return null;
  return { before: current, after: proposed };
}

function buildUpdateTextDraft(opportunity, proposal, html, userId) {
  const section = approvedProposalSection(html, proposal);
  const relativeHeadingEnd = Math.max(0, section.heading.heading_end - section.heading.start);
  const paragraph = firstSectionParagraph(section.html, relativeHeadingEnd);
  if (!paragraph) throw new Error("La sezione approvata non contiene un paragrafo modificabile");
  const revision = conservativeLeadRevision(paragraph.text, section.heading.text);
  if (!revision) {
    throw new Error("Non ho trovato una modifica testuale conservativa abbastanza sicura: mantieni la proposta come piano manuale");
  }
  return {
    schema_version: 1,
    status: "pending_review",
    target_url: proposal.target_url,
    prepared_at: new Date().toISOString(),
    prepared_by: userId,
    source_page_fingerprint_sha256: proposal?.page?.fingerprint_sha256 || null,
    basis: "existing_page_only",
    scope: "first_paragraph_copy_edit",
    target: {
      heading_level: section.heading.tag,
      heading_id: section.heading.id || null,
      heading_text: section.heading.text,
    },
    changes: [{
      key: "lead_topic_context",
      label: "Apertura della sezione",
      before: revision.before,
      after: revision.after,
      reason: `Rende esplicito nel primo periodo il contesto già dichiarato dal titolo della sezione, senza aggiungere dati, numeri o fatti nuovi. Segnale Search Console: “${String(opportunity.topic || "").trim()}”.`,
    }],
    safeguards: [
      "La bozza deriva esclusivamente dal testo già pubblicato nella pagina.",
      "Nessun dato tecnico, numero o fonte esterna viene aggiunto automaticamente.",
      "L’approvazione della bozza non modifica e non pubblica la pagina.",
    ],
  };
}

async function prepareEditorialUpdateText(user, idValue) {
  const id = String(idValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  if (opportunity.status !== "selected" || opportunity.opportunity_type !== "update_article") {
    throw new Error("La bozza testo richiede un aggiornamento selezionato");
  }
  const proposal = opportunity?.evidence?.update_proposal;
  if (!proposal || proposal.status !== "approved") throw new Error("Approva prima la proposta di aggiornamento");
  const targetUrl = normalizedPageUrl(proposal.target_url || opportunity?.evidence?.target_page_url);
  const pageResult = await fetchEditorialPage(targetUrl);
  const currentFingerprint = crypto.createHash("sha256").update(pageResult.html).digest("hex");
  if (!proposal?.page?.fingerprint_sha256 || currentFingerprint !== proposal.page.fingerprint_sha256) {
    throw new Error("La pagina è cambiata dopo la proposta: rigenera e riapprova la proposta prima della bozza testo");
  }
  const draft = buildUpdateTextDraft(opportunity, proposal, pageResult.html, user.id);
  const currentEvidence = opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const { update_apply_preview: _discardedApplyPreview, ...textEvidenceBase } = currentEvidence;
  const evidence = {
    ...textEvidenceBase,
    update_text_draft: draft,
  };
  const now = new Date().toISOString();
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: now, decided_by: user.id },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id) throw new Error("Bozza testuale non salvata");
  return { opportunity: updated, draft };
}

async function reviewEditorialUpdateText(user, idValue, decisionValue) {
  const id = String(idValue || "").trim();
  const decision = String(decisionValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  if (!UPDATE_TEXT_DECISIONS.has(decision)) throw new Error("Decisione bozza testo non valida");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  const proposal = opportunity?.evidence?.update_proposal;
  if (opportunity.status !== "selected" || opportunity.opportunity_type !== "update_article" || proposal?.status !== "approved") {
    throw new Error("La proposta approvata non è più valida per questa bozza");
  }
  const currentDraft = opportunity?.evidence?.update_text_draft;
  if (!currentDraft || typeof currentDraft !== "object") throw new Error("Prepara prima la bozza testuale");
  const now = new Date().toISOString();
  const draft = {
    ...currentDraft,
    status: decision,
    reviewed_at: now,
    reviewed_by: user.id,
  };
  const currentEvidence = opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const { update_apply_preview: _discardedApplyPreview, ...reviewTextEvidenceBase } = currentEvidence;
  const evidence = {
    ...reviewTextEvidenceBase,
    update_text_draft: draft,
  };
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: now, decided_by: user.id },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id) throw new Error("Decisione sulla bozza testo non salvata");
  return { opportunity: updated, draft };
}


function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function firstSectionParagraphRange(sectionHtml, headingEndOffset = 0) {
  const full = String(sectionHtml || "");
  const offset = Math.max(0, Number(headingEndOffset) || 0);
  const source = full.slice(offset);
  const match = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(source);
  if (!match) return null;
  const relativeStart = offset + match.index;
  const innerOffset = match[0].indexOf(match[1]);
  if (innerOffset < 0) return null;
  const innerStart = relativeStart + innerOffset;
  const innerEnd = innerStart + match[1].length;
  const text = plainHtmlText(match[1]).replace(/\s+/g, " ").trim();
  return {
    start: relativeStart,
    end: relativeStart + match[0].length,
    inner_start: innerStart,
    inner_end: innerEnd,
    inner_html: match[1],
    text,
  };
}

function applyApprovedTextDraft(html, proposal, draft) {
  const source = String(html || "");
  const changes = Array.isArray(draft?.changes) ? draft.changes : [];
  if (changes.length !== 1) throw new Error("L’anteprima controllata richiede esattamente una modifica testuale");
  const change = changes[0] || {};
  const before = String(change.before || "").trim();
  const after = String(change.after || "").trim();
  if (!before || !after || before === after) throw new Error("Diff testuale non valido per l’anteprima");

  const section = approvedProposalSection(source, proposal);
  const relativeHeadingEnd = Math.max(0, section.heading.heading_end - section.heading.start);
  const paragraph = firstSectionParagraphRange(section.html, relativeHeadingEnd);
  if (!paragraph?.text) throw new Error("Paragrafo approvato non più disponibile nella pagina");
  if (paragraph.text !== before) throw new Error("Il testo sorgente non coincide più con la bozza approvata: rigenera la proposta");
  if (/<[^>]+>/.test(paragraph.inner_html)) {
    throw new Error("Il paragrafo contiene markup interno: applicazione automatica bloccata per sicurezza");
  }

  const globalInnerStart = section.start + paragraph.inner_start;
  const globalInnerEnd = section.start + paragraph.inner_end;
  const modified = `${source.slice(0, globalInnerStart)}${escapeHtmlText(after)}${source.slice(globalInnerEnd)}`;
  if (modified === source) throw new Error("L’anteprima non produce alcuna modifica");

  const sourcePage = {
    title: firstTagText(source, "title"),
    h1: firstTagText(source, "h1"),
    meta_description: metaDescription(source),
  };
  const previewPage = {
    title: firstTagText(modified, "title"),
    h1: firstTagText(modified, "h1"),
    meta_description: metaDescription(modified),
  };
  if (sourcePage.title !== previewPage.title || sourcePage.h1 !== previewPage.h1 || sourcePage.meta_description !== previewPage.meta_description) {
    throw new Error("L’anteprima toccherebbe elementi fuori dalla sezione approvata: operazione bloccata");
  }

  return {
    modified,
    section,
    before,
    after,
    sourcePage,
    previewPage,
  };
}

function buildUpdateApplyPreview(opportunity, proposal, draft, html, userId) {
  const applied = applyApprovedTextDraft(html, proposal, draft);
  const sourceFingerprint = crypto.createHash("sha256").update(html).digest("hex");
  const previewFingerprint = crypto.createHash("sha256").update(applied.modified).digest("hex");
  return {
    schema_version: 1,
    status: "pending_confirmation",
    target_url: proposal.target_url,
    prepared_at: new Date().toISOString(),
    prepared_by: userId,
    source_page_fingerprint_sha256: sourceFingerprint,
    preview_page_fingerprint_sha256: previewFingerprint,
    change_count: 1,
    target: {
      heading_level: applied.section.heading.tag,
      heading_id: applied.section.heading.id || null,
      heading_text: applied.section.heading.text,
    },
    page_preview: {
      title: applied.previewPage.title,
      h1: applied.previewPage.h1,
      meta_description: applied.previewPage.meta_description,
      before_paragraph: applied.before,
      after_paragraph: applied.after,
    },
    validation: {
      source_matches_approved_draft: sourceFingerprint === draft.source_page_fingerprint_sha256,
      title_unchanged: applied.sourcePage.title === applied.previewPage.title,
      h1_unchanged: applied.sourcePage.h1 === applied.previewPage.h1,
      meta_description_unchanged: applied.sourcePage.meta_description === applied.previewPage.meta_description,
      writes_page: false,
    },
    safeguards: [
      "L’anteprima applica il diff soltanto a una copia in memoria della pagina.",
      "Il file HTML pubblicato non viene scritto o modificato.",
      "La conferma dell’anteprima registra solo un’autorizzazione separata; non pubblica nulla.",
    ],
  };
}

async function prepareEditorialUpdatePreview(user, idValue) {
  const id = String(idValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  const proposal = opportunity?.evidence?.update_proposal;
  const draft = opportunity?.evidence?.update_text_draft;
  if (opportunity.status !== "selected" || opportunity.opportunity_type !== "update_article") {
    throw new Error("L’anteprima richiede un aggiornamento selezionato");
  }
  if (proposal?.status !== "approved") throw new Error("Approva prima la proposta di aggiornamento");
  if (draft?.status !== "approved") throw new Error("Approva prima la bozza testuale");

  const targetUrl = normalizedPageUrl(proposal.target_url || opportunity?.evidence?.target_page_url);
  const pageResult = await fetchEditorialPage(targetUrl);
  const sourceFingerprint = crypto.createHash("sha256").update(pageResult.html).digest("hex");
  if (!draft.source_page_fingerprint_sha256 || sourceFingerprint !== draft.source_page_fingerprint_sha256) {
    throw new Error("La pagina è cambiata dopo la bozza approvata: rigenera proposta e testo");
  }

  const preview = buildUpdateApplyPreview(opportunity, proposal, draft, pageResult.html, user.id);
  const evidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
    update_apply_preview: preview,
  };
  const now = new Date().toISOString();
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: now, decided_by: user.id },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id) throw new Error("Anteprima applicata non salvata");
  return { opportunity: updated, preview };
}

async function reviewEditorialUpdatePreview(user, idValue, decisionValue) {
  const id = String(idValue || "").trim();
  const decision = String(decisionValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  if (!UPDATE_PREVIEW_DECISIONS.has(decision)) throw new Error("Decisione anteprima non valida");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  const proposal = opportunity?.evidence?.update_proposal;
  const draft = opportunity?.evidence?.update_text_draft;
  const currentPreview = opportunity?.evidence?.update_apply_preview;
  if (opportunity.status !== "selected" || opportunity.opportunity_type !== "update_article" || proposal?.status !== "approved" || draft?.status !== "approved") {
    throw new Error("Proposta o testo approvato non più validi per questa anteprima");
  }
  if (!currentPreview || typeof currentPreview !== "object") throw new Error("Prepara prima l’anteprima applicata");

  const targetUrl = normalizedPageUrl(currentPreview.target_url || proposal.target_url);
  const pageResult = await fetchEditorialPage(targetUrl);
  const sourceFingerprint = crypto.createHash("sha256").update(pageResult.html).digest("hex");
  if (!currentPreview.source_page_fingerprint_sha256 || sourceFingerprint !== currentPreview.source_page_fingerprint_sha256) {
    throw new Error("La pagina è cambiata dopo l’anteprima: rigenera prima di confermare");
  }
  const recomputed = buildUpdateApplyPreview(opportunity, proposal, draft, pageResult.html, user.id);
  if (recomputed.preview_page_fingerprint_sha256 !== currentPreview.preview_page_fingerprint_sha256) {
    throw new Error("L’anteprima non coincide più con il diff approvato: rigenerala");
  }

  const now = new Date().toISOString();
  const preview = {
    ...currentPreview,
    status: decision,
    reviewed_at: now,
    reviewed_by: user.id,
    ready_for_apply: decision === "confirmed",
  };
  const evidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
    update_apply_preview: preview,
  };
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: now, decided_by: user.id },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id) throw new Error("Decisione anteprima non salvata");
  return { opportunity: updated, preview };
}

async function completeEditorialUpdate(user, idValue, commitRefValue) {
  const id = String(idValue || "").trim();
  const commitRef = String(commitRefValue || "").trim().toLowerCase();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  if (!validCommitRef(commitRef)) throw new Error("Inserisci un riferimento commit Git valido (7–64 caratteri esadecimali)");

  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  if (opportunity.status === "completed" && opportunity?.evidence?.update_application) {
    return { already_completed: true, opportunity, application: opportunity.evidence.update_application };
  }
  const proposal = opportunity?.evidence?.update_proposal;
  const draft = opportunity?.evidence?.update_text_draft;
  const preview = opportunity?.evidence?.update_apply_preview;
  if (opportunity.status !== "selected" || opportunity.opportunity_type !== "update_article") {
    throw new Error("La chiusura richiede un aggiornamento ancora selezionato");
  }
  if (proposal?.status !== "approved" || draft?.status !== "approved" || preview?.status !== "confirmed") {
    throw new Error("Proposta, testo e anteprima devono essere approvati e confermati prima della chiusura");
  }
  if (!preview.preview_page_fingerprint_sha256) throw new Error("Impronta dell’anteprima confermata non disponibile");

  const targetUrl = normalizedPageUrl(preview.target_url || proposal.target_url || opportunity?.evidence?.target_page_url);
  const pageResult = await fetchEditorialPage(targetUrl);
  const publishedFingerprint = crypto.createHash("sha256").update(pageResult.html).digest("hex");
  if (publishedFingerprint !== preview.preview_page_fingerprint_sha256) {
    throw new Error("La pagina pubblicata non coincide con l’anteprima confermata: chiusura bloccata");
  }

  const now = new Date().toISOString();
  const currentEvidence = opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const application = {
    schema_version: 1,
    status: "verified_applied",
    target_url: pageResult.finalUrl,
    applied_at: now,
    applied_by: user.id,
    commit_ref: commitRef,
    commit_ref_verified: false,
    page_fingerprint_sha256: publishedFingerprint,
    expected_preview_fingerprint_sha256: preview.preview_page_fingerprint_sha256,
    change_count: Number(preview.change_count || 1),
    baseline: {
      topic_key: currentEvidence.topic_key || null,
      metrics: currentEvidence.metrics || {},
      snapshots: Array.isArray(currentEvidence.snapshots) ? currentEvidence.snapshots : [],
    },
  };
  const evidence = { ...currentEvidence, update_application: application };
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      status: "completed",
      evidence,
      decided_by: user.id,
      decided_at: now,
      updated_at: now,
    },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id || updated.status !== "completed") throw new Error("Chiusura opportunità non salvata");
  return { already_completed: false, opportunity: updated, application };
}

async function checkEditorialUpdateImpact(user, idValue) {
  const id = String(idValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  const rows = await serviceFetch(
    `editorial_research_opportunities?select=${opportunitySelect()}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const opportunity = rows?.[0];
  if (!opportunity) throw new Error("Opportunità non trovata");
  const application = opportunity?.evidence?.update_application;
  if (opportunity.status !== "completed" || application?.status !== "verified_applied") {
    throw new Error("Il monitoraggio è disponibile solo dopo la chiusura verificata dell’aggiornamento");
  }
  const topicKey = String(application?.baseline?.topic_key || opportunity?.evidence?.topic_key || "").trim();
  if (!topicKey) throw new Error("Topic Search Console non disponibile per il monitoraggio");

  const allSnapshots = await searchConsoleSnapshots();
  const snapshots = latestWindowSnapshots(allSnapshots);
  if (!ANALYSIS_WINDOWS.every((days) => snapshots.some((row) => Number(row.days) === days))) {
    throw new Error("Storico Search Console non sufficiente per il monitoraggio");
  }
  const snapshotsByDays = new Map(snapshots.map((row) => [Number(row.days), row]));
  const baselineMetrics = application?.baseline?.metrics || {};
  const currentMetrics = {};
  for (const days of ANALYSIS_WINDOWS) {
    const snapshot = snapshotsByDays.get(days);
    const result = await snapshotQueryRows(snapshot.id);
    const topic = aggregateSnapshot(result.rows).get(topicKey) || null;
    currentMetrics[String(days)] = topic ? {
      clicks: topic.clicks,
      impressions: topic.impressions,
      ctr: roundMetric(topic.ctr, 4),
      avg_position: roundMetric(topic.avg_position, 2),
    } : null;
  }
  const ready = {};
  const deltas = {};
  for (const days of ANALYSIS_WINDOWS) {
    const key = String(days);
    ready[key] = snapshotFullyAfter(snapshotsByDays.get(days), application.applied_at);
    deltas[key] = ready[key] ? metricDelta(currentMetrics[key], baselineMetrics[key]) : null;
  }
  const now = new Date().toISOString();
  const monitor = {
    schema_version: 1,
    checked_at: now,
    checked_by: user.id,
    topic_key: topicKey,
    applied_at: application.applied_at,
    readiness: ready,
    baseline_metrics: baselineMetrics,
    current_metrics: currentMetrics,
    deltas,
    snapshots: snapshots.map((row) => ({
      id: row.id,
      days: row.days,
      period_start: row.period_start,
      period_end: row.period_end,
      captured_at: row.captured_at,
      row_count: row.row_count,
    })),
    note: ready["28"]
      ? "Finestra 28 giorni interamente successiva all’applicazione disponibile."
      : ready["7"]
        ? "Finestra 7 giorni interamente successiva all’applicazione disponibile; 28 giorni ancora in maturazione."
        : "I dati disponibili includono ancora giorni precedenti all’applicazione; nessun delta post-modifica viene interpretato.",
  };
  const evidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
    update_monitor: monitor,
  };
  const updatedRows = await serviceFetch(`editorial_research_opportunities?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { evidence, updated_at: now, decided_by: user.id },
  });
  const updated = updatedRows?.[0];
  if (!updated?.id) throw new Error("Monitoraggio post-modifica non salvato");
  return { opportunity: updated, monitor };
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

    const signal = {
      topic_key: key,
      topic: basis.display_query,
      score,
      query_count: Math.max(seven?.query_count || 0, twentyEight?.query_count || 0, ninety?.query_count || 0),
      query_examples: [...new Set([
        ...(ninety?.query_examples || []),
        ...(twentyEight?.query_examples || []),
        ...(seven?.query_examples || []),
      ])].slice(0, 5),
      page_count: Math.max(seven?.page_count || 0, twentyEight?.page_count || 0, ninety?.page_count || 0),
      page_urls: [...new Set([
        ...(ninety?.page_urls || []),
        ...(twentyEight?.page_urls || []),
        ...(seven?.page_urls || []),
      ])].slice(0, 5),
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
    };
    signal.editorial_brief = opportunityEditorialBrief({
      topic: signal.topic,
      evidence: {
        source: "search_console",
        topic_key: signal.topic_key,
        query_examples: signal.query_examples,
        page_urls: signal.page_urls,
        metrics: signal.metrics,
      },
    }, signal);
    signals.push(signal);
  }

  signals.sort((a, b) => b.score - a.score || (b.metrics["90"]?.impressions || 0) - (a.metrics["90"]?.impressions || 0));

  const referenceSnapshot = snapshots.find((row) => Number(row.days) === 90)
    || snapshots.find((row) => Number(row.days) === 28)
    || snapshots[0]
    || null;
  let currentCycleByTopic = new Map();
  if (referenceSnapshot?.id) {
    const cycleRows = await serviceFetch(
      `editorial_research_opportunities?select=${opportunitySelect()}&snapshot_id=eq.${encodeURIComponent(referenceSnapshot.id)}&order=updated_at.desc&limit=500`,
    ).catch(() => []);
    currentCycleByTopic = new Map();
    for (const row of cycleRows || []) {
      const topicKey = String(row?.evidence?.topic_key || "").trim();
      if (!topicKey || currentCycleByTopic.has(topicKey)) continue;
      currentCycleByTopic.set(topicKey, row);
    }
  }

  const rankedSignals = signals.slice(0, ANALYSIS_SIGNAL_LIMIT).map((signal, index) => {
    const cycleOpportunity = currentCycleByTopic.get(String(signal.topic_key || "")) || null;
    return {
      ...signal,
      rank: index + 1,
      cycle_opportunity: cycleOpportunity ? {
        id: cycleOpportunity.id,
        status: cycleOpportunity.status,
        target_article_id: cycleOpportunity.target_article_id || null,
        decided_at: cycleOpportunity.decided_at || null,
      } : null,
    };
  });

  return {
    ok: true,
    version: VERSION,
    ready: true,
    snapshots,
    reference_snapshot_id: referenceSnapshot?.id || null,
    truncated,
    signals_total: signals.length,
    signal_limit: ANALYSIS_SIGNAL_LIMIT,
    signals_truncated: signals.length > ANALYSIS_SIGNAL_LIMIT,
    methodology: {
      demand_weight: 40,
      momentum_weight: 25,
      position_weight: 20,
      engagement_weight: 15,
      grouping: "cluster lessicale deterministico delle query Search Console",
      writes_database: false,
    },
    signals: rankedSignals,
  };
}

export default async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method || "")) {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, error: "Metodo non consentito" });
    }

    const action = String(req.query?.action || "");
    if (req.method === "GET" && action === "editorial-autopilot-tick") {
      if (!(await automationCronAuthorized(req))) return json(res, 401, { ok: false, error: "Autopilota scheduler non autorizzato" });
      try {
        const result = await editorialAutopilotTick();
        await automationPersistTickState(result).catch((heartbeatError) => {
          console.warn("editorial_autopilot_heartbeat_persist_failed", heartbeatError);
        });
        return json(res, 200, result);
      } catch (error) {
        await automationPersistTickState(null, error).catch((heartbeatError) => {
          console.warn("editorial_autopilot_heartbeat_persist_failed", heartbeatError);
        });
        throw error;
      }
    }

    const user = await authenticatedAdmin(req);
    if (!user) return json(res, 401, { ok: false, error: "Accesso amministratore richiesto" });

    if (req.method === "POST" && EDITORIAL_PAGE_UPDATE_ACTIONS.has(action)) {
      return json(res, 409, {
        ok: false,
        version: VERSION,
        error: "Gli aggiornamenti delle pagine del sito sono disattivati: l’Editoriale genera solo nuovi articoli e contenuti social.",
      });
    }

    if (req.method === "GET" && action === "editorial-research-status") {
      return json(res, 200, await statusPayload());
    }

    if (req.method === "GET" && action === "editorial-research-analysis") {
      return json(res, 200, await analysisPayload());
    }

    if (req.method === "GET" && action === "editorial-research-radar") {
      return json(res, 200, await researchRadarPayload());
    }

    if (req.method === "GET" && action === "editorial-opportunities") {
      return json(res, 200, await opportunitiesPayload());
    }

    if (req.method === "GET" && action === "editorial-planner-preview") {
      return json(res, 200, await editorialPlannerPreview());
    }

    if (req.method === "POST" && action === "create-manual-editorial-idea") {
      const result = await createManualEditorialIdea(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "update-manual-editorial-idea") {
      const opportunity = await updateManualEditorialIdea(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, opportunity });
    }

    if (req.method === "POST" && action === "collect-search-console") {
      const result = await collectSearchConsole(user, req.body?.days);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "start-editorial-web-radar") {
      const settings = await automationSchedulerSettings();
      const result = await startManualResearchRadar(user, settings || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "save-editorial-opportunity") {
      const result = await saveEditorialOpportunity(user, req.body?.topic_key, req.body?.status);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "update-editorial-opportunity") {
      const opportunity = await updateEditorialOpportunity(user, req.body?.id, req.body?.status);
      return json(res, 200, { ok: true, version: VERSION, opportunity });
    }

    if (req.method === "POST" && action === "classify-editorial-opportunity") {
      const opportunity = await classifyEditorialOpportunity(user, req.body?.id, req.body?.opportunity_type);
      return json(res, 200, { ok: true, version: VERSION, opportunity });
    }

    if (req.method === "POST" && action === "generate-editorial-article-package") {
      const result = await generateEditorialArticlePackage(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "check-editorial-article-package") {
      const result = await checkEditorialArticlePackage(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "generate-editorial-article-image") {
      const result = await generateEditorialArticleImage(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "set-editorial-article-image-candidate") {
      const result = await setEditorialArticleImageCandidate(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "approve-editorial-article-image") {
      const result = await approveEditorialArticleImage(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "discard-editorial-article-image-candidate") {
      const result = await discardEditorialArticleImageCandidate(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "delete-editorial-draft-article") {
      const result = await deleteEditorialDraftArticle(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "GET" && action === "editorial-social-plan") {
      return json(res, 200, await editorialSocialPlanPayload());
    }

    if (req.method === "POST" && action === "update-editorial-social-plan-item") {
      const item = await updateEditorialSocialPlanItem(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, item });
    }

    if (req.method === "POST" && action === "regenerate-editorial-social-plan-item") {
      const result = await requestEditorialSocialRegeneration(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "review-editorial-social-image") {
      const result = await reviewEditorialSocialImage(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "GET" && action === "editorial-automation-runs") {
      return json(res, 200, await automationRunsPayload());
    }

    if (req.method === "POST" && action === "prepare-editorial-draft") {
      const result = await prepareEditorialDraft(user, req.body?.id);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "prepare-editorial-update") {
      const result = await prepareEditorialUpdateProposal(user, req.body?.id, req.body?.target_url);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "review-editorial-update") {
      const result = await reviewEditorialUpdateProposal(user, req.body?.id, req.body?.decision);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "prepare-editorial-update-text") {
      const result = await prepareEditorialUpdateText(user, req.body?.id);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "review-editorial-update-text") {
      const result = await reviewEditorialUpdateText(user, req.body?.id, req.body?.decision);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "prepare-editorial-update-preview") {
      const result = await prepareEditorialUpdatePreview(user, req.body?.id);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "review-editorial-update-preview") {
      const result = await reviewEditorialUpdatePreview(user, req.body?.id, req.body?.decision);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "complete-editorial-update") {
      const result = await completeEditorialUpdate(user, req.body?.id, req.body?.commit_ref);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    if (req.method === "POST" && action === "check-editorial-update-impact") {
      const result = await checkEditorialUpdateImpact(user, req.body?.id);
      return json(res, 200, { ok: true, version: VERSION, result });
    }

    return json(res, 404, { ok: false, error: "Azione non trovata" });
  } catch (error) {
    console.error("editorial_research_api_failed", error);
    return json(res, 500, { ok: false, error: error?.message || "Errore interno" });
  }
}
