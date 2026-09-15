// @ts-nocheck
const API_VERSION = "v26.0";
const FACEBOOK_GRAPH = "https://graph.facebook.com";
const VERSION = "0.12.16";
const PLATFORM = "facebook";
const MAX_ATTEMPTS = 3;
const MAX_MESSAGE_CHARS = 7000;

const ALLOWED_ORIGINS = new Set([
  "https://offertalogica.it",
  "https://www.offertalogica.it",
]);

const CORS_BASE_HEADERS = {
  "access-control-allow-headers": "authorization, apikey, content-type",
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
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function metaError(payload) {
  const error = payload?.error || {};
  return {
    type: error?.type || null,
    code: error?.code ?? null,
    subcode: error?.error_subcode ?? null,
    message: error?.message || null,
    trace_id: error?.fbtrace_id || null,
  };
}

function bearerToken(req) {
  const raw = req.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validPageId(value) {
  return /^\d{5,40}$/.test(String(value || "").trim());
}

function validHttps(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function articleUrl(slug) {
  return `https://offertalogica.it/articoli/${encodeURIComponent(slug)}.html`;
}

function cleanInlineMarkdown(value = "") {
  return String(value || "")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+[.)]\s+/gm, "• ")
    .replace(/[*_`~]+/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function composeFacebookMessage(article, author = {}) {
  const title = cleanInlineMarkdown(article?.title || "").replace(/\s+/g, " ").trim();
  const excerpt = cleanInlineMarkdown(article?.excerpt || "").replace(/\s+/g, " ").trim();
  const content = cleanInlineMarkdown(article?.content || "");
  const slug = String(article?.slug || "").trim();
  const url = slug ? articleUrl(slug) : "";
  const authorName = String(author?.display_name || "Redazione OffertaLogica").replace(/\s+/g, " ").trim();

  const bodyParts = [];
  if (content) {
    const paragraphs = content.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
    let used = 0;
    for (const paragraph of paragraphs) {
      if (excerpt && paragraph.toLowerCase() === excerpt.toLowerCase()) continue;
      const room = 4300 - used;
      if (room <= 0) break;
      if (paragraph.length > room) {
        bodyParts.push(`${paragraph.slice(0, Math.max(0, room - 1)).trimEnd()}…`);
        used = 4300;
        break;
      }
      bodyParts.push(paragraph);
      used += paragraph.length + 2;
      if (used >= 4300) break;
    }
  }

  const parts = [];
  if (title) parts.push(title);
  if (excerpt) parts.push(excerpt);
  if (bodyParts.length) parts.push(bodyParts.join("\n\n"));
  if (url) parts.push(`Leggi l'articolo completo: ${url}`);
  if (authorName) parts.push(`Autore: ${authorName}`);

  const message = parts.filter(Boolean).join("\n\n");
  return message.length <= MAX_MESSAGE_CHARS
    ? message
    : `${message.slice(0, MAX_MESSAGE_CHARS - 1).trimEnd()}…`;
}

async function facebookGet(token, path, fields = "") {
  const endpoint = new URL(`${FACEBOOK_GRAPH}/${API_VERSION}/${path}`);
  if (fields) endpoint.searchParams.set("fields", fields);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function pageIdentity(token) {
  const { response, payload } = await facebookGet(token, "me", "id,name");
  if (!response.ok || !payload?.id) {
    throw Object.assign(new Error("Token Facebook Page non validato"), {
      status: 502,
      meta: metaError(payload),
    });
  }
  return {
    id: String(payload.id || ""),
    name: String(payload.name || ""),
  };
}

async function editorialContext(req) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  const jwt = bearerToken(req);

  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw Object.assign(new Error("Configurazione Supabase non disponibile"), { status: 500 });
  }
  if (!jwt) {
    throw Object.assign(new Error("Sessione Redazione richiesta"), { status: 401 });
  }

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const user = await authResponse.json().catch(() => null);
  if (!authResponse.ok || !user?.id) {
    throw Object.assign(new Error("Sessione Redazione non valida o scaduta"), { status: 401 });
  }

  const permissionResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/editorial_has_permission`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ p_permission: "publish_articles" }),
    cache: "no-store",
  });
  const permission = await permissionResponse.json().catch(() => false);
  if (!permissionResponse.ok) {
    throw Object.assign(new Error("Impossibile verificare il permesso di pubblicazione"), { status: 502 });
  }
  if (permission !== true) {
    throw Object.assign(new Error("Permesso publish_articles richiesto"), { status: 403 });
  }

  return { supabaseUrl, anonKey, serviceKey, jwt, userId: String(user.id) };
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
  if (!response.ok) {
    throw Object.assign(new Error("Impossibile leggere la coda social"), { status: 502, db: payload });
  }
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
  if (!response.ok) {
    throw Object.assign(new Error("Impossibile aggiornare la coda social"), { status: 502, db: payload });
  }
  return Array.isArray(payload) ? payload : [];
}

async function loadPublishedArticle(ctx, articleId) {
  const endpoint = new URL(`${ctx.supabaseUrl}/rest/v1/editorial_articles`);
  endpoint.searchParams.set("id", `eq.${articleId}`);
  endpoint.searchParams.set("select", "id,status,author_id,slug,title,excerpt,content,sources,featured_image_url,featured_image_alt");
  endpoint.searchParams.set("limit", "1");

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: ctx.anonKey,
      Authorization: `Bearer ${ctx.jwt}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("Impossibile leggere l'articolo dalla Redazione"), { status: 502 });
  }
  const article = Array.isArray(rows) ? rows[0] : null;
  if (!article) throw Object.assign(new Error("Articolo non trovato"), { status: 404 });
  if (article.status !== "published") {
    throw Object.assign(new Error("L'articolo deve essere pubblicato prima della diffusione social"), { status: 409 });
  }
  return article;
}

async function loadArticleAuthor(ctx, article) {
  const authorId = String(article?.author_id || "").trim();
  if (!validUuid(authorId)) return { display_name: "Redazione OffertaLogica" };
  const rows = await serviceRows(
    ctx,
    `editorial_authors?id=eq.${encodeURIComponent(authorId)}&select=display_name&limit=1`,
  );
  return { display_name: String(rows[0]?.display_name || "Redazione OffertaLogica") };
}

async function loadChannel(ctx) {
  const rows = await serviceRows(
    ctx,
    `editorial_social_channels?platform=eq.${PLATFORM}&select=platform,enabled,updated_at&limit=1`,
  );
  return rows[0] || null;
}

async function loadPublication(ctx, articleId) {
  const rows = await serviceRows(
    ctx,
    `editorial_social_publications?article_id=eq.${encodeURIComponent(articleId)}&platform=eq.${PLATFORM}&select=id,article_id,platform,status,attempts,external_post_id,external_post_url,last_error,queued_at,ready_at,last_attempt_at,published_at,updated_at&limit=1`,
  );
  return rows[0] || null;
}

async function updatePublication(ctx, publicationId, body) {
  const rows = await updateRows(
    ctx,
    `editorial_social_publications?id=eq.${encodeURIComponent(publicationId)}`,
    body,
  );
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

async function publicArticleOnline(article) {
  const slug = String(article?.slug || "").trim();
  if (!slug) return false;
  const endpoint = new URL(articleUrl(slug));
  endpoint.searchParams.set("social_check", String(Date.now()));
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
        "User-Agent": `OffertaLogica-Social/${VERSION}`,
      },
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

function terminalResult(req, publication, channel) {
  if (!channel?.enabled) {
    return json(req, { ok: true, version: VERSION, result: "channel_disabled", status: "channel_disabled", published: false });
  }
  if (!publication) {
    return json(req, { ok: true, version: VERSION, result: "not_queued", status: "not_queued", published: false });
  }
  if (publication.status === "published") {
    return json(req, {
      ok: true,
      version: VERSION,
      result: "already_published",
      status: "published",
      published: true,
      external_post_id: publication.external_post_id || null,
      external_post_url: publication.external_post_url || null,
    });
  }
  if (publication.status === "skipped") {
    return json(req, { ok: true, version: VERSION, result: "skipped", status: "skipped", published: false });
  }

  const queuedAt = Date.parse(String(publication.queued_at || ""));
  const enabledAt = Date.parse(String(channel.updated_at || ""));
  if (Number.isFinite(queuedAt) && Number.isFinite(enabledAt) && queuedAt < enabledAt) {
    return json(req, { ok: true, version: VERSION, result: "legacy_queue", status: "legacy_queue", published: false });
  }

  if (publication.status === "publishing") {
    const ambiguous = Boolean(String(publication.last_error || "").startsWith("ESITO INCERTO:"));
    return json(req, {
      ok: true,
      version: VERSION,
      result: ambiguous ? "ambiguous_publish" : "in_progress",
      status: ambiguous ? "ambiguous_publish" : "in_progress",
      published: false,
      external_post_id: publication.external_post_id || null,
    });
  }

  if (Number(publication.attempts || 0) >= MAX_ATTEMPTS) {
    return json(req, {
      ok: true,
      version: VERSION,
      result: "retry_exhausted",
      status: "retry_exhausted",
      published: false,
      last_error: publication.last_error || null,
    });
  }
  return null;
}

async function createPagePost(pageToken, pageId, message, link) {
  const endpoint = `${FACEBOOK_GRAPH}/${API_VERSION}/${encodeURIComponent(pageId)}/feed`;
  const form = new URLSearchParams();
  form.set("message", message);
  if (link) form.set("link", link);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
    });
  } catch (cause) {
    throw Object.assign(new Error("Connessione interrotta durante la pubblicazione Facebook: esito non verificabile"), {
      status: 502,
      phase: "publish_ambiguous",
      cause,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const phase = response.status >= 500 ? "publish_ambiguous" : "publish_rejected";
    throw Object.assign(new Error("Facebook non ha accettato la pubblicazione"), {
      status: 502,
      meta: metaError(payload),
      phase,
    });
  }
  if (!payload?.id) {
    throw Object.assign(new Error("Facebook ha risposto senza identificativo del post: esito non verificabile"), {
      status: 502,
      meta: metaError(payload),
      phase: "publish_ambiguous",
    });
  }
  return String(payload.id);
}

async function publishedPost(pageToken, postId) {
  const { response, payload } = await facebookGet(
    pageToken,
    encodeURIComponent(postId),
    "id,permalink_url,created_time",
  );
  if (!response.ok) return null;
  return {
    id: String(payload?.id || postId),
    permalink_url: validHttps(String(payload?.permalink_url || "")) ? String(payload.permalink_url) : "",
    created_time: String(payload?.created_time || ""),
  };
}

async function markFailed(ctx, publicationId, message) {
  return updatePublication(ctx, publicationId, {
    status: "failed",
    last_error: String(message || "Errore Facebook").slice(0, 1000),
    updated_at: new Date().toISOString(),
  });
}

async function markAmbiguous(ctx, publicationId, message, externalPostId = null) {
  const body = {
    status: "publishing",
    last_error: `ESITO INCERTO: ${String(message || "pubblicazione non verificabile").slice(0, 900)} Non ritentare automaticamente.`,
    updated_at: new Date().toISOString(),
  };
  if (externalPostId) body.external_post_id = externalPostId;
  return updatePublication(ctx, publicationId, body);
}

async function processArticleQueue(req, ctx, pageToken, pageId, articleId) {
  const channel = await loadChannel(ctx);
  const publication = await loadPublication(ctx, articleId);
  const terminal = terminalResult(req, publication, channel);
  if (terminal) return terminal;

  const article = await loadPublishedArticle(ctx, articleId);
  if (!(await publicArticleOnline(article))) {
    if (["waiting_connection", "ready", "failed"].includes(String(publication.status || ""))) {
      await updatePublication(ctx, String(publication.id), {
        status: "waiting_web",
        last_error: null,
        updated_at: new Date().toISOString(),
      });
    }
    return json(req, { ok: true, version: VERSION, result: "waiting_web", status: "waiting_web", published: false });
  }

  const identity = await pageIdentity(pageToken);
  if (identity.id !== pageId) {
    throw Object.assign(new Error("Il Page Access Token non appartiene alla Pagina Facebook configurata"), { status: 409 });
  }

  const author = await loadArticleAuthor(ctx, article);
  const message = composeFacebookMessage(article, author);
  const link = articleUrl(String(article.slug || ""));
  if (!message || !validHttps(link)) {
    throw Object.assign(new Error("Contenuto Facebook non valido"), { status: 422 });
  }

  const claimed = await claimPublication(ctx, publication);
  if (!claimed) {
    return json(req, { ok: true, version: VERSION, result: "in_progress", status: "in_progress", published: false });
  }

  const publicationId = String(claimed.id);
  let postId = "";
  try {
    if (!(await publicArticleOnline(article))) {
      await updatePublication(ctx, publicationId, {
        status: "waiting_web",
        last_error: null,
        updated_at: new Date().toISOString(),
      });
      return json(req, { ok: true, version: VERSION, result: "waiting_web", status: "waiting_web", published: false });
    }

    postId = await createPagePost(pageToken, pageId, message, link);
    const post = await publishedPost(pageToken, postId).catch(() => null);
    const now = new Date().toISOString();
    const updated = await updatePublication(ctx, publicationId, {
      status: "published",
      external_post_id: postId,
      external_post_url: post?.permalink_url || null,
      last_error: null,
      published_at: now,
      updated_at: now,
    });

    if (!updated) {
      await markAmbiguous(ctx, publicationId, "Post creato su Facebook ma conferma database non riuscita.", postId).catch(() => null);
      return json(req, {
        ok: true,
        version: VERSION,
        result: "ambiguous_publish",
        status: "ambiguous_publish",
        published: false,
        external_post_id: postId,
      });
    }

    return json(req, {
      ok: true,
      version: VERSION,
      result: "published",
      status: "published",
      published: true,
      external_post_id: postId,
      external_post_url: post?.permalink_url || null,
      page_id: pageId,
      page_name: identity.name || null,
    });
  } catch (error) {
    const phase = String(error?.phase || "");
    if (phase === "publish_ambiguous") {
      await markAmbiguous(ctx, publicationId, error?.message || "Pubblicazione Facebook non verificabile", postId || null).catch(() => null);
      return json(req, {
        ok: true,
        version: VERSION,
        result: "ambiguous_publish",
        status: "ambiguous_publish",
        published: false,
        external_post_id: postId || null,
        meta: error?.meta || null,
      });
    }

    const message = error?.meta?.message
      ? `${error.message}: ${error.meta.message}`
      : String(error?.message || "Errore Facebook");
    await markFailed(ctx, publicationId, message).catch(() => null);
    return json(req, {
      ok: true,
      version: VERSION,
      result: "failed",
      status: "failed",
      published: false,
      error: message,
      meta: error?.meta || null,
    });
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
    const pageToken = Deno.env.get("META_FACEBOOK_PAGE_ACCESS_TOKEN")?.trim() || "";
    const pageId = Deno.env.get("META_FACEBOOK_PAGE_ID")?.trim() || "";
    if (!pageToken || !validPageId(pageId)) {
      return json(req, { ok: false, error: "Configurazione Facebook Page incompleta" }, 500);
    }

    const ctx = await editorialContext(req);
    const body = await readJson(req);
    const action = String(body?.action || "").trim();

    if (action === "validate") {
      const identity = await pageIdentity(pageToken);
      if (identity.id !== pageId) {
        return json(req, { ok: false, error: "Il token Facebook non corrisponde alla Pagina configurata" }, 409);
      }
      return json(req, {
        ok: true,
        version: VERSION,
        platform: PLATFORM,
        page_id: identity.id,
        page_name: identity.name,
      });
    }

    if (action === "process_article_queue") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 422);
      return await processArticleQueue(req, ctx, pageToken, pageId, articleId);
    }

    return json(req, { ok: false, error: "Azione non supportata" }, 400);
  } catch (error) {
    const status = Number(error?.status || 500);
    return json(req, {
      ok: false,
      version: VERSION,
      error: String(error?.message || "Errore interno"),
      meta: error?.meta || null,
    }, status >= 400 && status < 600 ? status : 500);
  }
});
