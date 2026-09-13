const API_VERSION = "v26.0";
const INSTAGRAM_GRAPH = "https://graph.instagram.com";
const VERSION = "0.12.7";
const PLATFORM = "instagram";
const MAX_ATTEMPTS = 3;

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

function composeCaption(article: any) {
  const title = String(article?.title || "").replace(/\s+/g, " ").trim();
  const excerpt = String(article?.excerpt || "").replace(/\s+/g, " ").trim();
  const slug = String(article?.slug || "").trim();
  const parts = [title];
  if (excerpt) parts.push(excerpt);
  if (slug) parts.push(`Leggi l'approfondimento su OffertaLogica Informa: ${articleUrl(slug)}`);
  parts.push("#OffertaLogica #OffertaLogicaInforma");
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
  endpoint.searchParams.set("select", "id,status,slug,title,excerpt,featured_image_url");
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
  const imageUrl = String(article.featured_image_url || "").trim();
  if (!validHttps(imageUrl)) {
    throw Object.assign(new Error("L'articolo deve avere un'immagine principale HTTPS"), { status: 422 });
  }
  return article;
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

async function createContainer(instagramToken: string, accountId: string, imageUrl: string, caption: string) {
  const endpoint = `${INSTAGRAM_GRAPH}/${API_VERSION}/${encodeURIComponent(accountId)}/media`;
  const form = new URLSearchParams();
  form.set("image_url", imageUrl);
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
    throw Object.assign(new Error("Impossibile creare il contenitore Instagram"), {
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

async function processArticleQueue(
  req: Request,
  ctx: EditorialContext,
  instagramToken: string,
  account: { id: string; username: string },
  articleId: string,
) {
  const channel = await loadChannel(ctx);
  if (!channel?.enabled) {
    return json(req, { ok: true, version: VERSION, result: "channel_disabled", published: false });
  }

  const publication = await loadPublication(ctx, articleId);
  if (!publication) {
    return json(req, { ok: true, version: VERSION, result: "not_queued", published: false });
  }
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
  if (publication.status === "skipped") {
    return json(req, { ok: true, version: VERSION, result: "skipped", published: false });
  }

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

  const attempts = Number(publication.attempts || 0);
  if (attempts >= MAX_ATTEMPTS) {
    return json(req, { ok: true, version: VERSION, result: "retry_exhausted", published: false });
  }

  const article = await loadPublishedArticle(ctx, articleId);
  const online = await publicArticleOnline(article);
  if (!online) {
    if (["waiting_connection", "ready", "failed"].includes(String(publication.status || ""))) {
      await updatePublication(ctx, String(publication.id), {
        status: "waiting_web",
        last_error: null,
        updated_at: new Date().toISOString(),
      });
    }
    return json(req, { ok: true, version: VERSION, result: "waiting_web", published: false });
  }

  const claimed = await claimPublication(ctx, publication);
  if (!claimed) {
    return json(req, { ok: true, version: VERSION, result: "in_progress", published: false });
  }

  const publicationId = String(claimed.id);
  let creationId = "";
  try {
    creationId = await createContainer(
      instagramToken,
      account.id,
      String(article.featured_image_url),
      composeCaption(article),
    );

    await updatePublication(ctx, publicationId, {
      external_post_id: `container:${creationId}`,
      updated_at: new Date().toISOString(),
    });

    let container: any = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (attempt > 0) await sleep(1600);
      container = await containerStatus(instagramToken, creationId);
      if (container?.status_code === "FINISHED") break;
      if (["ERROR", "EXPIRED"].includes(container?.status_code)) {
        throw Object.assign(new Error(container?.status || "Instagram non ha elaborato il contenitore"), {
          phase: "prepare",
        });
      }
    }
    if (container?.status_code !== "FINISHED") {
      throw Object.assign(new Error("Instagram sta ancora elaborando l'immagine"), { phase: "prepare" });
    }

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
        const message = `ESITO INCERTO: media_publish è stato inviato ma la risposta non è verificabile. Non ritentare automaticamente. Contenitore ${creationId}.`;
        await updatePublication(ctx, publicationId, {
          status: "publishing",
          last_error: message,
          updated_at: new Date().toISOString(),
        }).catch(() => null);
        return json(req, {
          ok: true,
          version: VERSION,
          result: "ambiguous_publish",
          published: false,
        });
      }
      throw error;
    }

    // Registriamo subito l'ID pubblico. Da questo punto non deve più esistere alcun retry.
    try {
      await updatePublication(ctx, publicationId, {
        status: "published",
        external_post_id: mediaId,
        published_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Meta ha già restituito un media ID: teniamo il job bloccato su publishing se il DB non risponde,
      // così nessun retry automatico può creare un doppione.
      await updatePublication(ctx, publicationId, {
        status: "publishing",
        external_post_id: mediaId,
        last_error: `ESITO INCERTO: Instagram ha restituito il media ID ${mediaId}, ma il database non ha confermato lo stato published. Non ritentare automaticamente.`,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
      return json(req, {
        ok: true,
        version: VERSION,
        result: "ambiguous_publish",
        published: false,
      });
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
      instagram: account,
      article: {
        id: String(article.id),
        slug: String(article.slug || ""),
        title: String(article.title || ""),
      },
      media: media || { id: mediaId, permalink: "", media_type: "", timestamp: "" },
    });
  } catch (error) {
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

    if (action === "process_article_queue") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 400);
      return await processArticleQueue(req, ctx, instagramToken, account, articleId);
    }

    // Il test manuale viene disattivato quando entra in funzione la coda automatica:
    // evita che una vecchia pagina in cache possa pubblicare un doppione.
    if (["prepare_article_test", "publish_container_test"].includes(action)) {
      return json(req, {
        ok: false,
        error: "Test manuale Instagram disattivato in v0.12.7: usa la coda automatica.",
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
