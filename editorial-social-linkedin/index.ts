const LINKEDIN_API = "https://api.linkedin.com/rest";
const VERSION = "0.12.87";
const PLATFORM = "linkedin";
const MAX_ATTEMPTS = 3;
const PUBLISHING_STALE_MS = 12 * 60 * 1000;

const ALLOWED_ORIGINS = new Set([
  "https://offertalogica.it",
  "https://www.offertalogica.it",
]);

const CORS_BASE_HEADERS = {
  "access-control-allow-headers": "authorization, apikey, content-type, x-editorial-actor-id, x-offertalogica-autopilot-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

function requestOrigin(req) {
  return (req.headers.get("origin") || "").replace(/\/$/, "");
}

function originAllowed(req) {
  const origin = requestOrigin(req);
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function corsHeaders(req) {
  const origin = requestOrigin(req);
  const headers = { ...CORS_BASE_HEADERS };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function json(req, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(req) {
  try { return await req.json(); }
  catch { return {}; }
}

function bearerToken(req) {
  const raw = req.headers.get("authorization") || "";
  return raw.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function secureSecretEqual(leftValue, rightValue) {
  const left = new TextEncoder().encode(String(leftValue || ""));
  const right = new TextEncoder().encode(String(rightValue || ""));
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function validOrganizationId(value) {
  return /^\d{3,30}$/.test(String(value || "").trim());
}

function validApiVersion(value) {
  return /^20\d{4}$/.test(String(value || "").trim());
}

function articleUrl(slug) {
  return `https://offertalogica.it/articoli/${encodeURIComponent(String(slug || "").trim())}.html`;
}

function trackedArticleUrl(slug) {
  const url = new URL(articleUrl(slug));
  url.searchParams.set("utm_source", "linkedin");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "article_intro");
  return url.href;
}

function cleanText(value, maxLength = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function editorialContext(req) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  const schedulerSecret = Deno.env.get("EDITORIAL_AUTOPILOT_LINKEDIN_SECRET")?.trim() || "";
  const suppliedSchedulerSecret = String(req.headers.get("x-offertalogica-autopilot-secret") || "").trim();
  const jwt = bearerToken(req);

  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw Object.assign(new Error("Configurazione Supabase non disponibile"), { status: 500 });
  }
  if (!jwt) throw Object.assign(new Error("Sessione Redazione richiesta"), { status: 401 });

  const schedulerRequest = Boolean(schedulerSecret && secureSecretEqual(suppliedSchedulerSecret, schedulerSecret));
  if (suppliedSchedulerSecret && !schedulerRequest) {
    throw Object.assign(new Error("Segreto Autopilota non valido"), { status: 401 });
  }

  if (schedulerRequest) {
    const actorId = String(req.headers.get("x-editorial-actor-id") || "").trim();
    if (!validUuid(actorId)) throw Object.assign(new Error("Attore Autopilota non valido"), { status: 401 });
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" };
    const [memberResponse, authorResponse] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(actorId)}&limit=1`, { headers, cache: "no-store" }),
      fetch(`${supabaseUrl}/rest/v1/editorial_authors?select=id,user_id,active&user_id=eq.${encodeURIComponent(actorId)}&active=eq.true&limit=1`, { headers, cache: "no-store" }),
    ]);
    const members = await memberResponse.json().catch(() => []);
    const authors = await authorResponse.json().catch(() => []);
    if (!memberResponse.ok || !authorResponse.ok || !members?.[0]?.active || members[0].role !== "admin" || !authors?.[0]?.id) {
      throw Object.assign(new Error("Attore Autopilota non autorizzato alla pubblicazione social"), { status: 403 });
    }
    return { supabaseUrl, anonKey, serviceKey, jwt, userId: actorId, scheduler: true };
  }

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, Accept: "application/json" },
    cache: "no-store",
  });
  const user = await authResponse.json().catch(() => null);
  if (!authResponse.ok || !user?.id) throw Object.assign(new Error("Sessione Redazione non valida o scaduta"), { status: 401 });

  const permissionResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/editorial_has_permission`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ p_permission: "publish_articles" }),
  });
  const permission = await permissionResponse.json().catch(() => false);
  if (!permissionResponse.ok) throw Object.assign(new Error("Impossibile verificare il permesso di pubblicazione"), { status: 502 });
  if (permission !== true) throw Object.assign(new Error("Permesso publish_articles richiesto"), { status: 403 });
  return { supabaseUrl, anonKey, serviceKey, jwt, userId: String(user.id), scheduler: false };
}

function serviceHeaders(ctx, prefer = "") {
  const headers = {
    apikey: ctx.serviceKey,
    Authorization: `Bearer ${ctx.serviceKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function serviceRows(ctx, path) {
  const response = await fetch(`${ctx.supabaseUrl}/rest/v1/${path}`, {
    method: "GET",
    headers: serviceHeaders(ctx),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error("Impossibile leggere la coda LinkedIn"), { status: 502, db: payload });
  return Array.isArray(payload) ? payload : [];
}

async function updateRows(ctx, path, body) {
  const response = await fetch(`${ctx.supabaseUrl}/rest/v1/${path}`, {
    method: "PATCH",
    headers: serviceHeaders(ctx, "return=representation"),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error("Impossibile aggiornare la coda LinkedIn"), { status: 502, db: payload });
  return Array.isArray(payload) ? payload : [];
}

async function loadChannel(ctx) {
  const rows = await serviceRows(ctx, `editorial_social_channels?platform=eq.${PLATFORM}&select=platform,enabled,updated_at&limit=1`);
  return rows[0] || null;
}

async function loadPublication(ctx, articleId) {
  const rows = await serviceRows(ctx, `editorial_social_publications?article_id=eq.${encodeURIComponent(articleId)}&platform=eq.${PLATFORM}&select=id,article_id,platform,status,attempts,external_post_id,external_post_url,last_error,queued_at,ready_at,last_attempt_at,published_at,updated_at&limit=1`);
  return rows[0] || null;
}

async function updatePublication(ctx, publicationId, body) {
  const rows = await updateRows(ctx, `editorial_social_publications?id=eq.${encodeURIComponent(publicationId)}`, body);
  return rows[0] || null;
}

async function claimPublication(ctx, publication) {
  const attempts = Number(publication?.attempts || 0);
  const rows = await updateRows(
    ctx,
    `editorial_social_publications?id=eq.${encodeURIComponent(String(publication.id))}&status=in.(waiting_connection,waiting_web,ready,failed)&attempts=eq.${attempts}`,
    {
      status: "publishing",
      attempts: attempts + 1,
      ready_at: publication?.ready_at || new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
  );
  return rows[0] || null;
}

async function loadPublishedArticle(ctx, articleId) {
  const rows = await serviceRows(ctx, `editorial_articles?id=eq.${encodeURIComponent(articleId)}&select=id,status,slug,title,excerpt,featured_image_url,featured_image_alt&limit=1`);
  const article = rows[0] || null;
  if (!article) throw Object.assign(new Error("Articolo non trovato"), { status: 404 });
  if (String(article.status || "") !== "published") throw Object.assign(new Error("L'articolo deve essere pubblicato prima della diffusione LinkedIn"), { status: 409 });
  return article;
}

async function publicArticleOnline(article) {
  const slug = String(article?.slug || "").trim();
  if (!slug) return false;
  const endpoint = new URL(articleUrl(slug));
  endpoint.searchParams.set("social_check", String(Date.now()));
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml", "Cache-Control": "no-cache", "User-Agent": `OffertaLogica-Social/${VERSION}` },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("text/html")) return false;
    const text = await response.text();
    return text.length > 500;
  } catch {
    return false;
  }
}

async function loadArticleIntroLinkedInText(ctx, article) {
  const rows = await serviceRows(ctx, `editorial_research_opportunities?target_article_id=eq.${encodeURIComponent(article.id)}&select=id,evidence&order=updated_at.desc&limit=5`);
  for (const row of rows || []) {
    const intro = row?.evidence?.social_assets?.article_intro || null;
    if (!intro || String(intro.status || "") !== "ready") continue;
    const source = intro?.source_article && typeof intro.source_article === "object" ? intro.source_article : null;
    const linkedinText = cleanText(intro?.copy?.linkedin_text, 1200);
    if (!source || linkedinText.length < 180) continue;
    if (String(source.title || "") !== String(article.title || "")) continue;
    if (String(source.excerpt || "") !== String(article.excerpt || "")) continue;
    return linkedinText;
  }
  return "";
}

function terminalResult(req, publication, channel) {
  if (!channel?.enabled) return json(req, { ok: true, version: VERSION, result: "channel_disabled", status: "channel_disabled", published: false });
  if (!publication) return json(req, { ok: true, version: VERSION, result: "not_queued", status: "not_queued", published: false });
  if (publication.status === "published") {
    return json(req, { ok: true, version: VERSION, result: "already_published", status: "published", published: true, external_post_id: publication.external_post_id || null, external_post_url: publication.external_post_url || null });
  }
  if (publication.status === "skipped") return json(req, { ok: true, version: VERSION, result: "skipped", status: "skipped", published: false });
  if (publication.status === "publishing") {
    const ambiguous = Boolean(String(publication.last_error || "").startsWith("ESITO INCERTO:"));
    const lastAttemptAt = Date.parse(String(publication.last_attempt_at || publication.updated_at || ""));
    const stale = !ambiguous && Number.isFinite(lastAttemptAt) && Date.now() - lastAttemptAt > PUBLISHING_STALE_MS;
    return json(req, { ok: true, version: VERSION, result: ambiguous || stale ? "ambiguous_publish" : "in_progress", status: ambiguous || stale ? "ambiguous_publish" : "in_progress", published: false, external_post_id: publication.external_post_id || null, error: stale ? "ESITO INCERTO: stato publishing LinkedIn rimasto aperto oltre 12 minuti; verifica il post prima di ritentare." : null });
  }
  if (Number(publication.attempts || 0) >= MAX_ATTEMPTS) {
    return json(req, { ok: true, version: VERSION, result: "retry_exhausted", status: "retry_exhausted", published: false, error: publication.last_error || "Tentativi LinkedIn esauriti" });
  }
  return null;
}

async function createLinkedInArticlePost({ token, organizationId, apiVersion, article, commentary }) {
  const endpoint = `${LINKEDIN_API}/posts`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": apiVersion,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      author: `urn:li:organization:${organizationId}`,
      commentary: cleanText(commentary, 1200),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {
        article: {
          source: trackedArticleUrl(article.slug),
          title: cleanText(article.title, 390),
          description: cleanText(article.excerpt, 1800),
        },
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  const payload = await response.json().catch(() => null);
  const postId = String(response.headers.get("x-restli-id") || payload?.id || "").trim();
  if (!response.ok) {
    const message = cleanText(payload?.message || payload?.error?.message || payload?.error || `LinkedIn HTTP ${response.status}`, 900);
    throw Object.assign(new Error(message || "LinkedIn non ha accettato la pubblicazione"), { status: response.status || 502, payload });
  }
  if (!postId) throw Object.assign(new Error("LinkedIn ha confermato la richiesta senza restituire l'identificativo del post"), { ambiguous: true });
  return { postId };
}

async function processArticleQueue(req, ctx, token, organizationId, apiVersion, articleId, autopilotIntro) {
  const channel = await loadChannel(ctx);
  const publication = await loadPublication(ctx, articleId);
  const terminal = terminalResult(req, publication, channel);
  if (terminal) return terminal;

  const article = await loadPublishedArticle(ctx, articleId);
  if (!(await publicArticleOnline(article))) {
    if (["waiting_connection", "ready", "failed"].includes(String(publication.status || ""))) {
      await updatePublication(ctx, String(publication.id), { status: "waiting_web", last_error: null, updated_at: new Date().toISOString() });
    }
    return json(req, { ok: true, version: VERSION, result: "waiting_web", status: "waiting_web", published: false });
  }

  let commentary = "";
  if (autopilotIntro) {
    commentary = await loadArticleIntroLinkedInText(ctx, article);
    if (!commentary) return json(req, { ok: true, version: VERSION, result: "waiting_assets", status: "waiting_assets", published: false, error: "Testo LinkedIn dell'articolo non ancora pronto" });
  } else {
    commentary = [cleanText(article.title, 390), cleanText(article.excerpt, 1000)].filter(Boolean).join("\n\n");
  }
  if (!commentary) throw Object.assign(new Error("Testo LinkedIn vuoto"), { status: 422 });

  const claimed = await claimPublication(ctx, publication);
  if (!claimed) return json(req, { ok: true, version: VERSION, result: "in_progress", status: "in_progress", published: false });

  const publicationId = String(claimed.id);
  try {
    const created = await createLinkedInArticlePost({ token, organizationId, apiVersion, article, commentary });
    const now = new Date().toISOString();
    const updated = await updatePublication(ctx, publicationId, {
      status: "published",
      external_post_id: created.postId,
      external_post_url: null,
      last_error: null,
      published_at: now,
      updated_at: now,
    });
    if (!updated) {
      await updatePublication(ctx, publicationId, { status: "publishing", external_post_id: created.postId, last_error: "ESITO INCERTO: LinkedIn ha restituito un post ID ma il database non ha confermato published.", updated_at: new Date().toISOString() }).catch(() => null);
      return json(req, { ok: true, version: VERSION, result: "ambiguous_publish", status: "ambiguous_publish", published: false, external_post_id: created.postId });
    }
    return json(req, { ok: true, version: VERSION, result: "published", status: "published", published: true, external_post_id: created.postId, format: "article_link" });
  } catch (error) {
    if (error?.ambiguous) {
      await updatePublication(ctx, publicationId, { status: "publishing", last_error: `ESITO INCERTO: ${cleanText(error?.message, 850)}`, updated_at: new Date().toISOString() }).catch(() => null);
      return json(req, { ok: true, version: VERSION, result: "ambiguous_publish", status: "ambiguous_publish", published: false, error: cleanText(error?.message, 900) });
    }
    const message = cleanText(error?.message || "Errore LinkedIn", 900);
    await updatePublication(ctx, publicationId, { status: "failed", last_error: message, updated_at: new Date().toISOString() }).catch(() => null);
    return json(req, { ok: true, version: VERSION, result: "failed", status: "failed", published: false, error: message });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    if (!originAllowed(req)) return json(req, { ok: false, error: "Origin non consentita" }, 403);
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return json(req, { ok: false, error: "Metodo non consentito" }, 405);
  if (!originAllowed(req)) return json(req, { ok: false, error: "Origin non consentita" }, 403);

  try {
    const token = Deno.env.get("LINKEDIN_ACCESS_TOKEN")?.trim() || "";
    const organizationId = Deno.env.get("LINKEDIN_ORGANIZATION_ID")?.trim() || "";
    const apiVersion = Deno.env.get("LINKEDIN_API_VERSION")?.trim() || "";
    if (!token || !validOrganizationId(organizationId) || !validApiVersion(apiVersion)) {
      return json(req, { ok: false, error: "Configurazione LinkedIn incompleta: servono access token, organization ID e API version YYYYMM" }, 500);
    }

    const ctx = await editorialContext(req);
    const body = await readJson(req);
    const action = String(body?.action || "").trim();

    if (action === "validate") {
      return json(req, { ok: true, version: VERSION, platform: PLATFORM, organization_id: organizationId, api_version: apiVersion, mode: "article_only" });
    }

    if (action === "process_plan_item") {
      return json(req, { ok: true, version: VERSION, result: "skipped", status: "skipped", published: false, reason: "linkedin_article_only" });
    }

    if (action === "process_article_queue" || action === "process_autopilot_article_intro") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 422);
      return await processArticleQueue(req, ctx, token, organizationId, apiVersion, articleId, action === "process_autopilot_article_intro");
    }

    return json(req, { ok: false, error: "Azione LinkedIn non supportata" }, 422);
  } catch (error) {
    const status = Number(error?.status || 500);
    return json(req, { ok: false, error: cleanText(error?.message || "Errore LinkedIn", 1000) }, status >= 400 && status <= 599 ? status : 500);
  }
});
