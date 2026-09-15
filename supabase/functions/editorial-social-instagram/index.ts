const API_VERSION = "v26.0";
const INSTAGRAM_GRAPH = "https://graph.instagram.com";
const VERSION = "0.12.12";
const PLATFORM = "instagram";
const MAX_ATTEMPTS = 3;
const MAX_CAROUSEL_SLIDES = 10;
const MAX_SLIDE_BYTES = 900_000;
const MAX_SLIDES_TOTAL_BYTES = 6_000_000;
const SOCIAL_BUCKET = "editorial-social-instagram";

const ALLOWED_ORIGINS = new Set([
  "https://offertalogica.it",
  "https://www.offertalogica.it",
]);

const CORS_BASE_HEADERS = {
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function requestOrigin(req: Request) {
  return (req.headers.get("origin") || "").replace(/\/$/, "");
}

function originAllowed(req: Request) {
  const origin = requestOrigin(req);
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function corsHeaders(req: Request) {
  const origin = requestOrigin(req);
  const headers: Record<string, string> = { ...CORS_BASE_HEADERS };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function metaError(payload: any) {
  const error = payload?.error || {};
  return {
    type: error?.type || null,
    code: error?.code ?? null,
    subcode: error?.error_subcode ?? null,
    message: error?.message || null,
  };
}

function bearerToken(req: Request) {
  const raw = req.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validHttps(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function articleUrl(slug: string) {
  return `https://offertalogica.it/articoli/${encodeURIComponent(slug)}.html`;
}

function normalizePresentationMode(value: unknown) {
  return String(value || "").trim().toLowerCase() === "summary" ? "summary" : "full";
}

function composeCaption(article: any, author: any = {}, presentationMode = "full") {
  const title = String(article?.title || "").replace(/\s+/g, " ").trim();
  const excerpt = String(article?.excerpt || "").replace(/\s+/g, " ").trim();
  const slug = String(article?.slug || "").trim();
  const authorName = String(author?.display_name || "Redazione OffertaLogica").replace(/\s+/g, " ").trim();
  const mode = normalizePresentationMode(presentationMode);
  const parts = [title];
  if (excerpt) parts.push(excerpt);
  parts.push(mode === "summary"
    ? "Nel carosello trovi una sintesi autosufficiente dei punti chiave dell'articolo."
    : "Articolo completo nel carosello.");
  if (slug) parts.push(`Articolo originale: ${articleUrl(slug)}`);
  if (authorName) parts.push(`Autore: ${authorName}`);
  const website = String(author?.website_url || "").trim();
  const linkedin = String(author?.linkedin_url || "").trim();
  if (validHttps(website)) parts.push(`Sito autore: ${website}`);
  if (validHttps(linkedin)) parts.push(`LinkedIn: ${linkedin}`);
  const caption = parts.filter(Boolean).join("\n\n");
  return caption.length <= 2200 ? caption : `${caption.slice(0, 2197).trimEnd()}…`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function instagramGet(token: string, path: string, fields = "") {
  const endpoint = new URL(`${INSTAGRAM_GRAPH}/${API_VERSION}/${path}`);
  if (fields) endpoint.searchParams.set("fields", fields);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function identity(token: string) {
  const { response, payload } = await instagramGet(token, "me", "id,username");
  if (!response.ok) {
    throw Object.assign(new Error("Token Instagram non validato"), {
      status: 502,
      meta: metaError(payload),
    });
  }
  return {
    id: String(payload?.id || ""),
    username: String(payload?.username || ""),
  };
}

type EditorialContext = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  jwt: string;
  userId: string;
};

async function editorialContext(req: Request): Promise<EditorialContext> {
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

async function loadPublishedArticle(ctx: EditorialContext, articleId: string) {
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
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error("Impossibile leggere l'articolo dalla Redazione"), { status: 502 });
  }
  const article = Array.isArray(rows) ? rows[0] : null;
  if (!article) {
    throw Object.assign(new Error("Articolo non trovato"), { status: 404 });
  }
  if (article.status !== "published") {
    throw Object.assign(new Error("L'articolo deve essere pubblicato prima della diffusione social"), { status: 409 });
  }
  return article;
}

async function loadArticleAuthor(ctx: EditorialContext, article: any) {
  const authorId = String(article?.author_id || "").trim();
  if (!validUuid(authorId)) {
    return { display_name: "Redazione OffertaLogica", website_url: "", linkedin_url: "" };
  }
  const rows = await serviceRows(
    ctx,
    `editorial_authors?id=eq.${encodeURIComponent(authorId)}&select=display_name,website_url,linkedin_url&limit=1`,
  );
  const author = rows[0] || {};
  return {
    display_name: String(author?.display_name || "Redazione OffertaLogica"),
    website_url: validHttps(String(author?.website_url || "")) ? String(author.website_url) : "",
    linkedin_url: validHttps(String(author?.linkedin_url || "")) ? String(author.linkedin_url) : "",
  };
}

function serviceHeaders(ctx: EditorialContext, prefer = "") {
  const headers: Record<string, string> = {
    apikey: ctx.serviceKey,
    Authorization: `Bearer ${ctx.serviceKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function serviceRows(ctx: EditorialContext, path: string) {
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

async function updateRows(ctx: EditorialContext, path: string, body: Record<string, unknown>) {
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

function storageHeaders(ctx: EditorialContext, contentType = "application/json") {
  return {
    apikey: ctx.serviceKey,
    Authorization: `Bearer ${ctx.serviceKey}`,
    Accept: "application/json",
    "Content-Type": contentType,
  };
}

async function ensureSocialBucket(ctx: EditorialContext) {
  const base = `${ctx.supabaseUrl}/storage/v1`;
  const check = await fetch(`${base}/bucket/${encodeURIComponent(SOCIAL_BUCKET)}`, {
    method: "GET",
    headers: storageHeaders(ctx),
    cache: "no-store",
  });
  if (check.ok) {
    const bucket = await check.json().catch(() => null);
    if (bucket?.public !== true) {
      throw Object.assign(new Error("Lo spazio temporaneo social esiste ma non è pubblico"), { status: 502 });
    }
    return;
  }
  if (check.status !== 404) {
    throw Object.assign(new Error("Impossibile verificare lo spazio temporaneo social"), { status: 502 });
  }
  const created = await fetch(`${base}/bucket`, {
    method: "POST",
    headers: storageHeaders(ctx),
    body: JSON.stringify({
      id: SOCIAL_BUCKET,
      name: SOCIAL_BUCKET,
      public: true,
      file_size_limit: MAX_SLIDE_BYTES,
      allowed_mime_types: ["image/jpeg"],
    }),
    cache: "no-store",
  });
  if (!created.ok && created.status !== 409) {
    const payload = await created.json().catch(() => null);
    throw Object.assign(new Error("Impossibile creare lo spazio temporaneo social"), { status: 502, db: payload });
  }
}

function decodeCarouselSlides(value: unknown) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_CAROUSEL_SLIDES) {
    throw Object.assign(new Error(`Il carosello deve contenere da 2 a ${MAX_CAROUSEL_SLIDES} slide.`), { status: 422 });
  }
  let totalBytes = 0;
  return value.map((raw: any, index: number) => {
    const dataUrl = String(raw?.data_url || "");
    const match = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      throw Object.assign(new Error(`Slide ${index + 1}: formato JPEG non valido.`), { status: 422 });
    }
    let binary = "";
    try {
      binary = atob(match[1]);
    } catch {
      throw Object.assign(new Error(`Slide ${index + 1}: contenuto base64 non valido.`), { status: 422 });
    }
    if (!binary.length || binary.length > MAX_SLIDE_BYTES) {
      throw Object.assign(new Error(`Slide ${index + 1}: dimensione non valida.`), { status: 422 });
    }
    totalBytes += binary.length;
    if (totalBytes > MAX_SLIDES_TOTAL_BYTES) {
      throw Object.assign(new Error("Il carosello è troppo pesante per la pubblicazione automatica."), { status: 413 });
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return {
      bytes,
      altText: String(raw?.alt_text || "Slide articolo OffertaLogica Informa").replace(/\s+/g, " ").trim().slice(0, 950),
    };
  });
}

async function uploadCarouselSlides(ctx: EditorialContext, publicationId: string, attempt: number, slides: Array<{ bytes: Uint8Array; altText: string }>) {
  await ensureSocialBucket(ctx);
  const root = `instagram/${publicationId}/attempt-${attempt}`;
  const uploaded: Array<{ path: string; url: string; altText: string }> = [];
  try {
    for (let index = 0; index < slides.length; index += 1) {
      const path = `${root}/slide-${String(index + 1).padStart(2, "0")}.jpg`;
      const response = await fetch(`${ctx.supabaseUrl}/storage/v1/object/${SOCIAL_BUCKET}/${path}`, {
        method: "POST",
        headers: {
          ...storageHeaders(ctx, "image/jpeg"),
          "cache-control": "max-age=3600",
        },
        body: slides[index].bytes,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw Object.assign(new Error(`Impossibile caricare la slide ${index + 1}`), { status: 502, db: payload });
      }
      uploaded.push({
        path,
        url: `${ctx.supabaseUrl}/storage/v1/object/public/${SOCIAL_BUCKET}/${path}`,
        altText: slides[index].altText,
      });
    }
    return uploaded;
  } catch (error) {
    await removeCarouselSlides(ctx, uploaded.map((item) => item.path)).catch(() => null);
    throw error;
  }
}

async function removeCarouselSlides(ctx: EditorialContext, paths: string[]) {
  if (!paths.length) return;
  await fetch(`${ctx.supabaseUrl}/storage/v1/object/${SOCIAL_BUCKET}`, {
    method: "DELETE",
    headers: storageHeaders(ctx),
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => null);
}

async function publicImageReady(url: string) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok && String(response.headers.get("content-type") || "").toLowerCase().includes("image/jpeg");
  } catch {
    return false;
  }
}

async function loadChannel(ctx: EditorialContext) {
  const rows = await serviceRows(
    ctx,
    `editorial_social_channels?platform=eq.${PLATFORM}&select=platform,enabled,updated_at&limit=1`,
  );
  return rows[0] || null;
}

async function loadPublication(ctx: EditorialContext, articleId: string) {
  const rows = await serviceRows(
    ctx,
    `editorial_social_publications?article_id=eq.${encodeURIComponent(articleId)}&platform=eq.${PLATFORM}&select=id,article_id,platform,status,attempts,external_post_id,external_post_url,last_error,queued_at,ready_at,last_attempt_at,published_at,updated_at&limit=1`,
  );
  return rows[0] || null;
}

async function updatePublication(ctx: EditorialContext, publicationId: string, body: Record<string, unknown>) {
  const rows = await updateRows(
    ctx,
    `editorial_social_publications?id=eq.${encodeURIComponent(publicationId)}`,
    body,
  );
  return rows[0] || null;
}

async function claimPublication(ctx: EditorialContext, publication: any) {
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

async function publicArticleOnline(article: any) {
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

async function createCarouselItem(instagramToken: string, accountId: string, imageUrl: string, altText: string) {
  const endpoint = `${INSTAGRAM_GRAPH}/${API_VERSION}/${encodeURIComponent(accountId)}/media`;
  const form = new URLSearchParams();
  form.set("image_url", imageUrl);
  form.set("is_carousel_item", "true");
  if (altText) form.set("alt_text", altText);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${instagramToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.id) {
    throw Object.assign(new Error("Impossibile creare una slide del carosello Instagram"), {
      status: 502,
      meta: metaError(payload),
      phase: "prepare",
    });
  }
  return String(payload.id);
}

async function createCarouselContainer(instagramToken: string, accountId: string, childIds: string[], caption: string) {
  const endpoint = `${INSTAGRAM_GRAPH}/${API_VERSION}/${encodeURIComponent(accountId)}/media`;
  const form = new URLSearchParams();
  form.set("media_type", "CAROUSEL");
  form.set("children", childIds.join(","));
  form.set("caption", caption);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${instagramToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.id) {
    throw Object.assign(new Error("Impossibile creare il carosello Instagram"), {
      status: 502,
      meta: metaError(payload),
      phase: "prepare",
    });
  }
  return String(payload.id);
}

async function containerStatus(instagramToken: string, creationId: string) {
  const { response, payload } = await instagramGet(
    instagramToken,
    encodeURIComponent(creationId),
    "id,status_code,status",
  );
  if (!response.ok) {
    throw Object.assign(new Error("Impossibile leggere lo stato del contenitore"), {
      status: 502,
      meta: metaError(payload),
      phase: "prepare",
    });
  }
  return {
    id: String(payload?.id || creationId),
    status_code: String(payload?.status_code || ""),
    status: String(payload?.status || ""),
  };
}

async function waitContainerReady(instagramToken: string, creationId: string, label = "contenitore") {
  let container: any = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) await sleep(1400);
    container = await containerStatus(instagramToken, creationId);
    if (container?.status_code === "FINISHED") return container;
    if (["ERROR", "EXPIRED"].includes(container?.status_code)) {
      throw Object.assign(new Error(container?.status || `Instagram non ha elaborato il ${label}`), { phase: "prepare" });
    }
  }
  throw Object.assign(new Error(`Instagram sta ancora elaborando il ${label}`), { phase: "prepare" });
}

async function publishContainer(instagramToken: string, accountId: string, creationId: string) {
  const endpoint = `${INSTAGRAM_GRAPH}/${API_VERSION}/${encodeURIComponent(accountId)}/media_publish`;
  const form = new URLSearchParams();
  form.set("creation_id", creationId);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${instagramToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
    });
  } catch (cause) {
    throw Object.assign(new Error("Connessione interrotta durante media_publish: esito non verificabile"), {
      status: 502,
      phase: "publish_ambiguous",
      cause,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.id) {
    throw Object.assign(new Error("Instagram non ha pubblicato il contenitore"), {
      status: 502,
      meta: metaError(payload),
      phase: "publish_rejected",
    });
  }
  return String(payload.id);
}

async function publishedMedia(instagramToken: string, mediaId: string) {
  const { response, payload } = await instagramGet(
    instagramToken,
    encodeURIComponent(mediaId),
    "id,permalink,media_type,timestamp",
  );
  if (!response.ok) return null;
  return {
    id: String(payload?.id || mediaId),
    permalink: String(payload?.permalink || ""),
    media_type: String(payload?.media_type || ""),
    timestamp: String(payload?.timestamp || ""),
  };
}

async function markFailed(ctx: EditorialContext, publicationId: string, message: string) {
  return await updatePublication(ctx, publicationId, {
    status: "failed",
    last_error: message.slice(0, 1000),
    updated_at: new Date().toISOString(),
  });
}

function queueResult(req: Request, publication: any, channel: any) {
  if (!channel?.enabled) return json(req, { ok: true, version: VERSION, result: "channel_disabled", published: false });
  if (!publication) return json(req, { ok: true, version: VERSION, result: "not_queued", published: false });
  if (publication.status === "published") {
    return json(req, {
      ok: true,
      version: VERSION,
      result: "already_published",
      published: true,
      external_post_id: publication.external_post_id || null,
      external_post_url: publication.external_post_url || null,
    });
  }
  if (publication.status === "skipped") return json(req, { ok: true, version: VERSION, result: "skipped", published: false });

  const queuedAt = Date.parse(String(publication.queued_at || ""));
  const enabledAt = Date.parse(String(channel.updated_at || ""));
  if (Number.isFinite(queuedAt) && Number.isFinite(enabledAt) && queuedAt < enabledAt) {
    return json(req, { ok: true, version: VERSION, result: "legacy_queue", published: false });
  }
  if (publication.status === "publishing") {
    const ambiguous = Boolean(String(publication.last_error || "").startsWith("ESITO INCERTO:"));
    return json(req, {
      ok: true,
      version: VERSION,
      result: ambiguous ? "ambiguous_publish" : "in_progress",
      published: false,
    });
  }
  if (Number(publication.attempts || 0) >= MAX_ATTEMPTS) {
    return json(req, { ok: true, version: VERSION, result: "retry_exhausted", published: false });
  }
  return null;
}

async function prepareArticleQueue(req: Request, ctx: EditorialContext, articleId: string) {
  const channel = await loadChannel(ctx);
  const publication = await loadPublication(ctx, articleId);
  const terminal = queueResult(req, publication, channel);
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
    return json(req, { ok: true, version: VERSION, result: "waiting_web", published: false });
  }

  const author = await loadArticleAuthor(ctx, article);
  return json(req, {
    ok: true,
    version: VERSION,
    result: "needs_carousel",
    published: false,
    max_slides: MAX_CAROUSEL_SLIDES,
    article_url: articleUrl(String(article.slug || "")),
    article: {
      id: String(article.id),
      slug: String(article.slug || ""),
      title: String(article.title || ""),
      excerpt: String(article.excerpt || ""),
      content: String(article.content || ""),
      sources: String(article.sources || ""),
      featured_image_url: String(article.featured_image_url || ""),
      featured_image_alt: String(article.featured_image_alt || article.title || ""),
    },
    author,
  });
}

async function processArticleQueue(
  req: Request,
  ctx: EditorialContext,
  instagramToken: string,
  account: { id: string; username: string },
  articleId: string,
  rawSlides: unknown,
  rawPresentationMode: unknown,
) {
  const channel = await loadChannel(ctx);
  const publication = await loadPublication(ctx, articleId);
  const terminal = queueResult(req, publication, channel);
  if (terminal) return terminal;
  if (!Array.isArray(rawSlides)) {
    return json(req, { ok: true, version: VERSION, result: "carousel_required", published: false });
  }

  const slides = decodeCarouselSlides(rawSlides);
  const presentationMode = normalizePresentationMode(rawPresentationMode);
  const article = await loadPublishedArticle(ctx, articleId);
  if (!(await publicArticleOnline(article))) {
    if (["waiting_connection", "ready", "failed"].includes(String(publication.status || ""))) {
      await updatePublication(ctx, String(publication.id), {
        status: "waiting_web",
        last_error: null,
        updated_at: new Date().toISOString(),
      });
    }
    return json(req, { ok: true, version: VERSION, result: "waiting_web", published: false });
  }
  const author = await loadArticleAuthor(ctx, article);

  const claimed = await claimPublication(ctx, publication);
  if (!claimed) return json(req, { ok: true, version: VERSION, result: "in_progress", published: false });

  const publicationId = String(claimed.id);
  const attempt = Number(claimed.attempts || Number(publication.attempts || 0) + 1);
  let uploaded: Array<{ path: string; url: string; altText: string }> = [];
  let creationId = "";

  try {
    uploaded = await uploadCarouselSlides(ctx, publicationId, attempt, slides);
    for (let index = 0; index < uploaded.length; index += 1) {
      if (!(await publicImageReady(uploaded[index].url))) {
        throw Object.assign(new Error(`La slide ${index + 1} non è ancora disponibile per Meta`), { phase: "prepare" });
      }
    }

    const children: string[] = [];
    for (let index = 0; index < uploaded.length; index += 1) {
      const childId = await createCarouselItem(
        instagramToken,
        account.id,
        uploaded[index].url,
        uploaded[index].altText,
      );
      await waitContainerReady(instagramToken, childId, `contenitore della slide ${index + 1}`);
      children.push(childId);
    }

    creationId = await createCarouselContainer(
      instagramToken,
      account.id,
      children,
      composeCaption(article, author, presentationMode),
    );

    await updatePublication(ctx, publicationId, {
      external_post_id: `carousel:${creationId}`,
      updated_at: new Date().toISOString(),
    });

    await waitContainerReady(instagramToken, creationId, "carosello");

    // Le immagini sono state ormai acquisite da Meta: liberiamo lo storage temporaneo.
    await removeCarouselSlides(ctx, uploaded.map((item) => item.path)).catch(() => null);
    uploaded = [];

    // Ultimo controllo immediatamente prima di media_publish.
    const finalArticle = await loadPublishedArticle(ctx, articleId);
    if (!(await publicArticleOnline(finalArticle))) {
      await updatePublication(ctx, publicationId, {
        status: "waiting_web",
        last_error: null,
        updated_at: new Date().toISOString(),
      });
      return json(req, { ok: true, version: VERSION, result: "waiting_web", published: false });
    }

    let mediaId = "";
    try {
      mediaId = await publishContainer(instagramToken, account.id, creationId);
    } catch (error) {
      const err = error as any;
      if (err?.phase === "publish_ambiguous") {
        const message = `ESITO INCERTO: media_publish del carosello è stato inviato ma la risposta non è verificabile. Non ritentare automaticamente. Contenitore ${creationId}.`;
        await updatePublication(ctx, publicationId, {
          status: "publishing",
          last_error: message,
          updated_at: new Date().toISOString(),
        }).catch(() => null);
        return json(req, { ok: true, version: VERSION, result: "ambiguous_publish", published: false });
      }
      throw error;
    }

    try {
      await updatePublication(ctx, publicationId, {
        status: "published",
        external_post_id: mediaId,
        published_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      });
    } catch {
      await updatePublication(ctx, publicationId, {
        status: "publishing",
        external_post_id: mediaId,
        last_error: `ESITO INCERTO: Instagram ha restituito il media ID ${mediaId}, ma il database non ha confermato lo stato published. Non ritentare automaticamente.`,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
      return json(req, { ok: true, version: VERSION, result: "ambiguous_publish", published: false });
    }

    const media = await publishedMedia(instagramToken, mediaId);
    if (media?.permalink) {
      await updatePublication(ctx, publicationId, {
        external_post_url: media.permalink,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
    }

    return json(req, {
      ok: true,
      version: VERSION,
      result: "published",
      published: true,
      format: presentationMode === "summary" ? "carousel_article_summary" : "carousel_full_article",
      presentation_mode: presentationMode,
      slides: slides.length,
      instagram: account,
      article: {
        id: String(article.id),
        slug: String(article.slug || ""),
        title: String(article.title || ""),
        url: articleUrl(String(article.slug || "")),
      },
      media: media || { id: mediaId, permalink: "", media_type: "", timestamp: "" },
    });
  } catch (error) {
    if (uploaded.length) await removeCarouselSlides(ctx, uploaded.map((item) => item.path)).catch(() => null);
    const err = error as any;
    const message = err?.message || "Errore Instagram";
    await markFailed(ctx, publicationId, message).catch(() => null);
    return json(req, {
      ok: true,
      version: VERSION,
      result: "failed",
      published: false,
      error: message,
      meta: err?.meta || null,
    });
  }
}

Deno.serve(async (req) => {
  if (!originAllowed(req)) {
    return json(req, { ok: false, error: "Origine non consentita" }, 403);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "Metodo non consentito" }, 405);

  const instagramToken = Deno.env.get("META_INSTAGRAM_ACCESS_TOKEN")?.trim() || "";
  if (!instagramToken) {
    return json(req, { ok: false, error: "Secret META_INSTAGRAM_ACCESS_TOKEN non configurato" }, 500);
  }

  const body = await readJson(req);
  const action = String(body?.action || "").trim().toLowerCase();

  try {
    const ctx = await editorialContext(req);
    const account = await identity(instagramToken);

    if (action === "validate") {
      return json(req, {
        ok: true,
        version: VERSION,
        api_version: API_VERSION,
        instagram: account,
        authorized_user_id: ctx.userId,
        can_publish: true,
      });
    }

    if (action === "prepare_article_queue") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 400);
      return await prepareArticleQueue(req, ctx, articleId);
    }

    if (action === "process_article_queue") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 400);
      return await processArticleQueue(req, ctx, instagramToken, account, articleId, body?.slides, body?.presentation_mode);
    }

    // Il test manuale viene disattivato quando entra in funzione la coda automatica:
    // evita che una vecchia pagina in cache possa pubblicare un doppione.
    if (["prepare_article_test", "publish_container_test"].includes(action)) {
      return json(req, {
        ok: false,
        error: "Test manuale Instagram disattivato in v0.12.12: usa la coda automatica.",
      }, 410);
    }

    if (action === "container_status") {
      const creationId = String(body?.creation_id || "").trim();
      if (!/^\d{6,40}$/.test(creationId)) return json(req, { ok: false, error: "creation_id non valido" }, 400);
      const container = await containerStatus(instagramToken, creationId);
      return json(req, { ok: true, version: VERSION, container, published: false });
    }

    return json(req, { ok: false, error: `Azione non supportata in v${VERSION}` }, 400);
  } catch (error) {
    const err = error as any;
    return json(req, {
      ok: false,
      error: err?.message || "Errore Instagram",
      meta: err?.meta || null,
    }, Number(err?.status || 500));
  }
});
