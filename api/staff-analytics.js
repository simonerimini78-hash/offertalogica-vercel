import crypto from "node:crypto";
import { json } from "../lib/http.js";

const VERSION = "0.12.39";
const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SEARCH_CONSOLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const MAX_ROWS = 100000;
const PAGE_SIZE = 25000;
const DB_BATCH_SIZE = 500;
const ANALYSIS_PAGE_SIZE = 1000;
const ANALYSIS_MAX_ROWS_PER_SNAPSHOT = 20000;
const ANALYSIS_WINDOWS = [7, 28, 90];
const OPPORTUNITY_STATUSES = new Set(["pending", "selected", "deferred", "rejected"]);
const OPPORTUNITY_TYPES = new Set(["new_article", "update_article", "social_only", "monitor"]);
const OPPORTUNITY_LIST_LIMIT = 50;
const TARGET_PAGE_MAX_BYTES = 2 * 1024 * 1024;
const UPDATE_PROPOSAL_DECISIONS = new Set(["approved", "rejected"]);
const UPDATE_TEXT_DECISIONS = new Set(["approved", "rejected"]);
const UPDATE_PREVIEW_DECISIONS = new Set(["confirmed", "cancelled"]);
const MANUAL_IDEA_PRIORITIES = new Set(["normal", "high", "urgent"]);
const MANUAL_IDEA_TYPES = new Set(["new_article", "update_article"]);
const MANUAL_IDEA_PRIORITY_RANK = { normal: 100, high: 300, urgent: 400 };
const EDITORIAL_AI_DEFAULT_MODEL = "gpt-5.6-terra";
const EDITORIAL_AI_HTTP_TIMEOUT_MS = 45000;
const EDITORIAL_IMAGE_GENERATION_TIMEOUT_MS = 240000;
const EDITORIAL_PAGE_FETCH_TIMEOUT_MS = 20000;
const EDITORIAL_PLAN_POST_TYPES = new Set(["article_followup", "related", "evergreen", "service", "data"]);
const EDITORIAL_PLAN_EDITABLE_STATUSES = new Set(["draft", "approved", "cancelled"]);
const EDITORIAL_SOCIAL_PLATFORMS = new Set(["facebook", "instagram"]);
const EDITORIAL_IMAGE_DEFAULT_MODEL = "gpt-image-2";
const EDITORIAL_IMAGE_BUCKET = "editorial-images";
const EDITORIAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const EDITORIAL_IMAGE_ARTICLE_STATUSES = new Set(["draft", "in_review", "changes_requested", "approved", "published"]);

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
    topic.queries.add(String(row.query || ""));
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
  return `Idea editoriale inserita manualmente dalla Redazione. Priorità ${priorityLabel}${deadline ? `; scadenza ${deadline}` : ""}. La priorità è distinta dal punteggio tecnico Search Console.`;
}

function manualIdeaDeadlineTime(value) {
  const parsed = value ? Date.parse(`${value}T12:00:00Z`) : NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function plannerCandidateComparator(a, b) {
  if (a.rank !== b.rank) return b.rank - a.rank;
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
      const savedPages = Array.isArray(row?.evidence?.page_urls) ? row.evidence.page_urls : [];
      const livePages = signalsByTopic.get(row?.evidence?.topic_key)?.page_urls || [];
      return { ...row, context_pages: (savedPages.length ? savedPages : livePages).slice(0, 5) };
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
  const opportunityType = String(payload.opportunity_type || "new_article").trim();
  const deadline = validManualIdeaDeadline(payload.deadline);
  const targetUrl = opportunityType === "update_article" && String(payload.target_url || "").trim()
    ? normalizedPageUrl(payload.target_url)
    : null;

  if (topic.length < 3) throw new Error("Inserisci un’idea editoriale di almeno 3 caratteri");
  if (!MANUAL_IDEA_PRIORITIES.has(priority)) throw new Error("Priorità idea non valida");
  if (!MANUAL_IDEA_TYPES.has(opportunityType)) throw new Error("Le idee manuali di questo pannello devono essere un nuovo articolo o un aggiornamento");

  const duplicate = await existingActiveManualIdea(topic);
  if (duplicate) return { created: false, opportunity: duplicate };

  const now = new Date().toISOString();
  const evidence = {
    source: "manual_idea",
    ...(targetUrl ? { target_page_url: targetUrl, page_urls: [targetUrl] } : {}),
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
  const opportunityType = String(payload.opportunity_type || current.opportunity_type || "new_article").trim();
  const deadline = validManualIdeaDeadline(payload.deadline);
  if (topic.length < 3) throw new Error("Inserisci un’idea editoriale di almeno 3 caratteri");
  if (!MANUAL_IDEA_PRIORITIES.has(priority)) throw new Error("Priorità idea non valida");
  if (!MANUAL_IDEA_TYPES.has(opportunityType)) throw new Error("Le idee manuali di questo pannello devono essere un nuovo articolo o un aggiornamento");
  const duplicate = await existingActiveManualIdea(topic);
  if (duplicate && duplicate.id !== id) throw new Error("Esiste già un’idea manuale attiva con lo stesso argomento");
  const targetUrl = opportunityType === "update_article" && String(payload.target_url || "").trim()
    ? normalizedPageUrl(payload.target_url)
    : null;

  const now = new Date().toISOString();
  const currentEvidence = current.evidence && typeof current.evidence === "object" ? current.evidence : {};
  const { target_page_url: _oldTarget, page_urls: _oldPages, ...evidenceBase } = currentEvidence;
  const evidence = {
    ...evidenceBase,
    source: "manual_idea",
    ...(targetUrl ? { target_page_url: targetUrl, page_urls: [targetUrl] } : {}),
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
    if (!MANUAL_IDEA_TYPES.has(String(row.opportunity_type || ""))) continue;
    const manual = manualIdeaMeta(row);
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
        rank: 500,
        reason: "Opportunità già selezionata manualmente dalla Redazione: precede ogni scelta automatica.",
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
        ? "Idea manuale urgente: precede i segnali Search Console."
        : priority === "high"
          ? "Idea manuale ad alta priorità: precede i segnali Search Console."
          : "Idea manuale a priorità normale: viene considerata dopo i segnali Search Console sopra soglia.",
    });
  }

  const analysis = await analysisPayload().catch(() => null);
  const topSearchSignal = analysis?.ready
    ? (analysis.signals || []).find((signal) => Number(signal.score || 0) >= minimumScore)
    : null;
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
      reason: `Miglior segnale Search Console sopra la soglia ${minimumScore}/100.`,
      topic_key: topSearchSignal.topic_key,
      metrics: topSearchSignal.metrics,
    });
  }

  candidates.sort(plannerCandidateComparator);
  const maxArticlesPerCycle = Number.isFinite(Number(settings.max_articles_per_cycle))
    ? Math.max(0, Number(settings.max_articles_per_cycle))
    : 1;
  const articleCycleDisabled = maxArticlesPerCycle === 0;
  const decision = articleCycleDisabled ? null : (candidates[0] || null);
  const noPublish = articleCycleDisabled || (!decision && Boolean(settings.allow_no_publish));
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
    decision,
    no_publish: noPublish,
    ordering: [
      "opportunità già selezionata manualmente",
      "idea manuale urgente",
      "idea manuale ad alta priorità",
      "segnale Search Console sopra soglia",
      "idea manuale a priorità normale",
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

async function saveEditorialOpportunity(user, topicKeyValue) {
  const topicKey = String(topicKeyValue || "").trim();
  if (!topicKey || topicKey.length > 1000) throw new Error("Segnale editoriale non valido");

  const analysis = await analysisPayload();
  if (!analysis.ready) throw new Error("Storico Search Console non ancora sufficiente");
  const signal = (analysis.signals || []).find((row) => row.topic_key === topicKey);
  if (!signal) throw new Error("Segnale non più disponibile nell'analisi corrente");

  const snapshot = analysis.snapshots.find((row) => Number(row.days) === 90)
    || analysis.snapshots.find((row) => Number(row.days) === 28)
    || analysis.snapshots[0];
  if (!snapshot?.id) throw new Error("Snapshot di riferimento non disponibile");

  const duplicate = await existingOpportunity(topicKey, snapshot.id);
  if (duplicate) return { created: false, opportunity: duplicate };

  await upsertResearchTopic(user, signal);
  const evidence = {
    source: "search_console",
    analysis_version: VERSION,
    topic_key: signal.topic_key,
    query_count: signal.query_count,
    page_count: signal.page_count,
    page_urls: Array.isArray(signal.page_urls) ? signal.page_urls.slice(0, 5) : [],
    momentum_ratio: signal.momentum_ratio,
    metrics: signal.metrics,
    snapshots: analysis.snapshots.map((row) => ({
      id: row.id,
      days: row.days,
      period_start: row.period_start,
      period_end: row.period_end,
      row_count: row.row_count,
      captured_at: row.captured_at,
    })),
    saved_at: new Date().toISOString(),
  };

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
  const opportunity = rows?.[0];
  if (!opportunity?.id) throw new Error("Opportunità editoriale non salvata");
  return { created: true, opportunity };
}

async function updateEditorialOpportunity(user, idValue, statusValue) {
  const id = String(idValue || "").trim();
  const status = String(statusValue || "").trim();
  if (!validUuid(id)) throw new Error("Identificativo opportunità non valido");
  if (!OPPORTUNITY_STATUSES.has(status)) throw new Error("Stato opportunità non valido");

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
  const opportunityType = String(typeValue || "").trim();
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
  const articleRows = await editorialUserFetch(user, "editorial_articles?select=*", {
    method: "POST",
    prefer: "return=representation",
    body: {
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
    },
  });
  const article = articleRows?.[0];
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

function articleImagePrompt(article, opportunity, guidance = "") {
  const content = cleanEditorialText(article?.content, 2800).replace(/[#*_`>-]+/g, " ").replace(/\s+/g, " ");
  const notes = cleanEditorialText(manualIdeaMeta(opportunity)?.notes, 800);
  const extra = cleanEditorialText(guidance, 600);
  return [
    "Create one high-resolution landscape editorial photograph for an Italian consumer-information article published by OffertaLogica.",
    `Article title: ${cleanEditorialText(article?.title, 140)}.`,
    `Article summary: ${cleanEditorialText(article?.excerpt, 320)}.`,
    article?.category ? `Editorial category: ${cleanEditorialText(article.category, 80)}.` : "",
    content ? `Article context: ${content}.` : "",
    notes ? `Editorial notes: ${notes}.` : "",
    extra ? `Requested revision or visual direction from the editor: ${extra}.` : "",
    "Visual direction: photorealistic, premium editorial-journalism photography, natural believable lighting, contemporary Italian/European context when relevant, visually clear but not advertising-like.",
    "Composition: horizontal 3:2 hero image, strong central subject with generous safe margins so the same master can later be cropped for a static social post.",
    "Do not add text, captions, letters, numbers, logos, brand marks, watermarks, fake interfaces, readable documents, price tags, charts or infographic elements.",
    "Do not invent a specific real person, company, event or document that the article does not establish. Prefer a truthful visual metaphor when the topic is abstract.",
    "The image must look like a real professional photograph, not an illustration, 3D render, collage or stock-ad composition.",
  ].filter(Boolean).join(" ");
}

async function generateOpenAiArticleImage(article, opportunity, guidance = "") {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY non configurata lato server");
  const model = editorialImageModel();
  const prompt = articleImagePrompt(article, opportunity, guidance);
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
  return { model, prompt, buffer };
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
    status: "pending_review",
    url: imageUrl,
    object_path: objectPath,
    mime_type: "image/jpeg",
    size: "1536x1024",
    quality: "high",
    model: generated.model,
    prompt: generated.prompt,
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

async function openAiResponseRequest(path, { method = "GET", body } = {}) {
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
    "Non proporre Reel, video, TikTok o LinkedIn come strategia.",
  ].join(" ");
  const input = `ARGOMENTO: ${opportunity.topic}\nTIPO: nuovo articolo\nNOTE REDAZIONE: ${notes || "nessuna"}\nSEGNALI SEARCH CONSOLE: ${signal}\nURL ARTICOLO DOPO PUBBLICAZIONE: ${articleUrl}\n\nCATEGORIE AMMESSE (restituisci esattamente uno slug):\n${categoryList}\n\nDESTINAZIONI PROMOZIONALI AMMESSE PER IL POST related (restituisci esattamente l'id scelto):\n${targetList || "nessuna"}\n\nVincoli editoriali: titolo <= 140 caratteri; excerpt <= 320; SEO title <= 70; SEO description <= 180; contenuto sostanziale, leggibile e realmente utile; almeno 2 fonti, includendo una fonte primaria se disponibile. Il post article_followup deve includere il link ${articleUrl}. Il post related deve includere l'URL della destinazione consentita scelta.`;
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
      platforms,
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

async function automationRunStart(opportunityId) {
  const rows = await serviceFetch("editorial_automation_runs", {
    method: "POST",
    prefer: "return=representation",
    body: {
      run_type: "article_prepare",
      status: "running",
      started_at: new Date().toISOString(),
      opportunity_id: opportunityId,
      details: { version: VERSION, source: "manual_controlled_run" },
    },
  });
  return rows?.[0] || null;
}

async function automationRunFinish(run, status, patch = {}) {
  if (!run?.id) return;
  await serviceFetch(`editorial_automation_runs?id=eq.${encodeURIComponent(run.id)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      status,
      finished_at: new Date().toISOString(),
      article_id: patch.article_id || null,
      social_plan_item_id: patch.social_plan_item_id || null,
      details: patch.details || run.details || {},
      last_error: patch.last_error || null,
    },
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

  const run = await automationRunStart(id);
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
      details: { version: VERSION, source: "manual_controlled_run", opportunity_id: id, publication_performed: false },
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

  const runRef = job.automation_run_id ? { id: job.automation_run_id, details: { version: VERSION, source: "manual_controlled_run" } } : null;
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
      details: { version: VERSION, source: "manual_controlled_run", opportunity_id: id, publication_performed: false },
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
      details: { version: VERSION, source: "manual_controlled_run", opportunity_id: id, publication_performed: false },
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
      details: { version: VERSION, source: "manual_controlled_run", opportunity_id: id, publication_performed: false, background: true },
    });
    throw error;
  }

  const originalArticle = { ...article };
  let articleUpdated = false;
  try {
    const sourcesText = validated.sources.map((source) => `${source.title} — ${source.url}`).join("\n").slice(0, 4000);
    const updatedRows = await editorialUserFetch(user, `editorial_articles?id=eq.${encodeURIComponent(article.id)}&select=*`, {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        title: validated.article.title,
        category: validated.article.category,
        excerpt: validated.article.excerpt,
        content: validated.article.content,
        sources: sourcesText || null,
        seo_title: validated.article.seo_title,
        seo_description: validated.article.seo_description,
        updated_by: user.id,
      },
    });
    article = updatedRows?.[0];
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
        source: "manual_controlled_run",
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
      await editorialUserFetch(user, `editorial_articles?id=eq.${encodeURIComponent(originalArticle.id)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          title: originalArticle.title,
          category: originalArticle.category,
          excerpt: originalArticle.excerpt,
          content: originalArticle.content,
          sources: originalArticle.sources,
          seo_title: originalArticle.seo_title,
          seo_description: originalArticle.seo_description,
          updated_by: user.id,
        },
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
      details: { version: VERSION, source: "manual_controlled_run", opportunity_id: id, publication_performed: false, background: true },
    });
    throw error;
  }
}

async function editorialSocialPlanPayload() {
  const [items, channels] = await Promise.all([
    serviceFetch("editorial_social_plan_items?select=*&order=updated_at.desc&limit=50"),
    editorialSocialChannels(),
  ]);
  const targetIds = [...new Set((items || []).map((row) => row.destination_target_id).filter(Boolean))];
  const articleIds = [...new Set((items || []).map((row) => row.source_article_id).filter(Boolean))];
  let targets = [];
  let articles = [];
  if (targetIds.length) {
    targets = await serviceFetch(`editorial_promotion_targets?select=id,label,url_path,category&id=in.(${targetIds.map((id) => encodeURIComponent(id)).join(",")})`);
  }
  if (articleIds.length) {
    articles = await serviceFetch(`editorial_articles?select=id,featured_image_url,featured_image_alt&id=in.(${articleIds.map((id) => encodeURIComponent(id)).join(",")})`);
  }
  const targetMap = new Map((targets || []).map((row) => [row.id, row]));
  const articleMap = new Map((articles || []).map((row) => [row.id, row]));
  return {
    ok: true,
    version: VERSION,
    channels,
    items: (items || []).map((row) => ({
      ...row,
      destination_target: targetMap.get(row.destination_target_id) || null,
      source_article_image: articleMap.get(row.source_article_id) || null,
    })),
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
  const platforms = validateRequestedPlatforms(payload.platforms, channels);
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

async function automationRunsPayload() {
  const rows = await serviceFetch("editorial_automation_runs?select=id,run_type,status,scheduled_for,started_at,finished_at,opportunity_id,article_id,social_plan_item_id,details,last_error,created_at&order=created_at.desc&limit=20");
  return { ok: true, version: VERSION, runs: rows || [] };
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

    signals.push({
      topic_key: key,
      topic: basis.display_query,
      score,
      query_count: Math.max(seven?.query_count || 0, twentyEight?.query_count || 0, ninety?.query_count || 0),
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

    if (req.method === "POST" && action === "save-editorial-opportunity") {
      const result = await saveEditorialOpportunity(user, req.body?.topic_key);
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

    if (req.method === "GET" && action === "editorial-social-plan") {
      return json(res, 200, await editorialSocialPlanPayload());
    }

    if (req.method === "POST" && action === "update-editorial-social-plan-item") {
      const item = await updateEditorialSocialPlanItem(user, req.body || {});
      return json(res, 200, { ok: true, version: VERSION, item });
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
