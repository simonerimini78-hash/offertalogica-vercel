const API_VERSION = "v26.0";
const INSTAGRAM_GRAPH = "https://graph.instagram.com";
const VERSION = "0.12.3";
const PUBLISH_CONFIRMATION = "PUBLISH_INSTAGRAM_TEST";

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

async function editorialContext(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim() || "";
  const jwt = bearerToken(req);

  if (!supabaseUrl || !anonKey) {
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

  return { supabaseUrl, anonKey, jwt, userId: String(user.id) };
}

async function loadPublishedArticle(ctx: Awaited<ReturnType<typeof editorialContext>>, articleId: string) {
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
    throw Object.assign(new Error("Il test Instagram è consentito solo per un articolo già pubblicato"), { status: 409 });
  }
  const imageUrl = String(article.featured_image_url || "").trim();
  if (!validHttps(imageUrl)) {
    throw Object.assign(new Error("L'articolo deve avere un'immagine principale HTTPS"), { status: 422 });
  }
  return article;
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
    throw Object.assign(new Error("Instagram non ha pubblicato il contenitore"), {
      status: 502,
      meta: metaError(payload),
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

    if (action === "prepare_article_test") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 400);
      const article = await loadPublishedArticle(ctx, articleId);
      const caption = composeCaption(article);
      const creationId = await createContainer(
        instagramToken,
        account.id,
        String(article.featured_image_url),
        caption,
      );
      return json(req, {
        ok: true,
        version: VERSION,
        instagram: account,
        article: {
          id: String(article.id),
          slug: String(article.slug || ""),
          title: String(article.title || ""),
        },
        creation_id: creationId,
        published: false,
      });
    }

    if (action === "container_status") {
      const creationId = String(body?.creation_id || "").trim();
      if (!/^\d{6,40}$/.test(creationId)) return json(req, { ok: false, error: "creation_id non valido" }, 400);
      const container = await containerStatus(instagramToken, creationId);
      return json(req, { ok: true, version: VERSION, container, published: false });
    }

    if (action === "publish_container_test") {
      const creationId = String(body?.creation_id || "").trim();
      const articleId = String(body?.article_id || "").trim();
      const confirmation = String(body?.confirm || "").trim();

      if (!/^\d{6,40}$/.test(creationId)) return json(req, { ok: false, error: "creation_id non valido" }, 400);
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 400);
      if (confirmation !== PUBLISH_CONFIRMATION) {
        return json(req, { ok: false, error: "Conferma esplicita di pubblicazione mancante" }, 400);
      }

      // Ricontrollo immediatamente prima di media_publish: l'articolo deve essere
      // ancora pubblicato e l'utente deve conservare publish_articles.
      const article = await loadPublishedArticle(ctx, articleId);
      const container = await containerStatus(instagramToken, creationId);
      if (container.status_code !== "FINISHED") {
        return json(req, {
          ok: false,
          error: "Il contenitore Instagram non è ancora pronto",
          container,
        }, 409);
      }

      const mediaId = await publishContainer(instagramToken, account.id, creationId);
      const media = await publishedMedia(instagramToken, mediaId);
      return json(req, {
        ok: true,
        version: VERSION,
        instagram: account,
        article: {
          id: String(article.id),
          slug: String(article.slug || ""),
          title: String(article.title || ""),
        },
        creation_id: creationId,
        media: media || { id: mediaId, permalink: "", media_type: "", timestamp: "" },
        published: true,
      });
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
