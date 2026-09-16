import crypto from "node:crypto";
import { json } from "../lib/http.js";

const VERSION = "0.12.28";
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
  const articleRows = await serviceFetch("editorial_articles?select=*", {
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
  const timeout = setTimeout(() => controller.abort(), 8000);
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
  if (!new Set(candidates).has(targetUrl)) throw new Error("La pagina scelta non appartiene alle pagine associate al segnale Search Console");

  const pageResult = await fetchEditorialPage(targetUrl);
  const proposal = buildUpdateProposal(opportunity, pageResult.finalUrl, pageResult.html, user.id);
  const previousEvidence = opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {};
  const { update_text_draft: _discardedTextDraft, ...proposalEvidenceBase } = previousEvidence;
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
  const { update_text_draft: _discardedTextDraft, ...reviewEvidenceBase } = currentEvidence;
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
  return { heading, html: String(html || "").slice(heading.start, end) };
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
  const evidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
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
  const evidence = {
    ...(opportunity.evidence && typeof opportunity.evidence === "object" ? opportunity.evidence : {}),
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

    return json(res, 404, { ok: false, error: "Azione non trovata" });
  } catch (error) {
    console.error("editorial_research_api_failed", error);
    return json(res, 500, { ok: false, error: error?.message || "Errore interno" });
  }
}
