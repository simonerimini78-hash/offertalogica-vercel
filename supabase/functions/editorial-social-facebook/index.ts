// @ts-nocheck
// v0.12.50: autenticazione Autopilota con segreto dedicato; mantiene la sintesi social canonica v3.
// È incorporato anche qui per consentire il deploy diretto dall'editor web
// Supabase senza dipendenze da file _shared esterni.

const SOCIAL_SUMMARY_VERSION = "3";
const SOCIAL_SUMMARY_MAX_CHARS = 4200;
const SOCIAL_SITE = "https://offertalogica.it";
const SOCIAL_PDF_UPLOAD_URL = `${SOCIAL_SITE}/carica-pdf.html`;

// Mantiene i riferimenti utili anche fuori dal sito: i link interni diventano
// URL assoluti. Le azioni che sul sito usano un frammento vengono convertite
// in una URL pubblica stabile, così i social non perdono la destinazione.
function absoluteSocialLink(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let url;
  try {
    if (/^https:\/\//i.test(raw)) url = new URL(raw);
    else if (/^\/(?!\/)/.test(raw)) url = new URL(raw, SOCIAL_SITE);
    else return "";
  } catch {
    return "";
  }

  if (url.protocol !== "https:") return "";

  const host = url.hostname.toLowerCase();
  const internal = host === "offertalogica.it" || host === "www.offertalogica.it";
  if (internal && url.hash.toLowerCase() === "#pdf-upload-panel") {
    return SOCIAL_PDF_UPLOAD_URL;
  }

  return url.href;
}

const SUMMARY_PROFILES = [
  { name: "detailed", sentencesPerSection: 2, listItemsPerSection: 3, bodyChars: 620, listChars: 190 },
  { name: "balanced", sentencesPerSection: 2, listItemsPerSection: 2, bodyChars: 520, listChars: 170 },
  { name: "compact", sentencesPerSection: 1, listItemsPerSection: 2, bodyChars: 430, listChars: 155 },
  { name: "minimal", sentencesPerSection: 1, listItemsPerSection: 1, bodyChars: 340, listChars: 140 },
] as const;

function cleanSocialInlineText(value = "") {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt) => String(alt || ""))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
      const safe = absoluteSocialLink(href);
      return safe ? `${label} (${safe})` : String(label || "");
    })
    .replace(/[*_`~]+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function shortenSocialText(value = "", maxChars = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, Math.max(1, maxChars - 1));
  const boundary = slice.lastIndexOf(" ");
  return `${(boundary > maxChars * 0.65 ? slice.slice(0, boundary) : slice).trimEnd()}…`;
}

function articleContentBlocks(article: any = {}) {
  const blocks: Array<{ kind: string; text: string }> = [];
  const content = String(article?.content || "").replace(/\r\n?/g, "\n").trim();
  const paragraphs = content.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);

  paragraphs.forEach((paragraph) => {
    if (/^###\s+/.test(paragraph)) {
      blocks.push({ kind: "subheading", text: cleanSocialInlineText(paragraph.replace(/^###\s+/, "")) });
      return;
    }
    if (/^##\s+/.test(paragraph)) {
      blocks.push({ kind: "heading", text: cleanSocialInlineText(paragraph.replace(/^##\s+/, "")) });
      return;
    }

    const lines = paragraph.split("\n").map((value) => value.trim()).filter(Boolean);
    const unordered = lines.length > 0 && lines.every((value) => /^[-*]\s+/.test(value));
    const ordered = lines.length > 0 && lines.every((value) => /^\d+[.)]\s+/.test(value));
    if (unordered || ordered) {
      lines.forEach((line) => {
        const marker = ordered ? line.match(/^\d+[.)]/)?.[0] || "•" : "•";
        const clean = line.replace(ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/, "");
        blocks.push({ kind: "list", text: `${marker} ${cleanSocialInlineText(clean)}` });
      });
      return;
    }

    blocks.push({ kind: "body", text: cleanSocialInlineText(lines.join(" ")) });
  });

  return blocks.filter((block) => block.text);
}

function sentenceParts(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  try {
    if (typeof Intl !== "undefined" && typeof (Intl as any).Segmenter === "function") {
      const segmenter = new (Intl as any).Segmenter("it", { granularity: "sentence" });
      return [...segmenter.segment(text)].map((part: any) => String(part.segment || "").trim()).filter(Boolean);
    }
  } catch {
    // Fallback deterministico sotto.
  }
  return (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text]).map((part) => part.trim()).filter(Boolean);
}

function keywordSet(value = "") {
  const stop = new Set([
    "della", "delle", "degli", "dello", "dalla", "dalle", "dagli", "dallo",
    "nella", "nelle", "negli", "nello", "alla", "alle", "agli", "allo", "anche",
    "come", "cosa", "sono", "essere", "questo", "questa", "quello", "quella",
    "dopo", "prima", "quando", "dove", "perché", "perche", "quindi", "oppure",
    "senza", "sulla", "sulle", "sugli", "sullo", "offertalogica",
  ]);
  return new Set(
    String(value || "")
      .toLocaleLowerCase("it-IT")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9]{4,}/g)
      ?.filter((word) => !stop.has(word)) || [],
  );
}

function sentenceScore(sentence: string, index: number, keywords: Set<string>) {
  const normalized = String(sentence || "")
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let score = index === 0 ? 4 : Math.max(0, 2 - index * 0.15);
  if (/[0-9€%]/.test(sentence)) score += 2;
  if (/\b(non|deve|devono|puo|possono|attenzione|importante|obbligo|diritto|prezzo|costo|durata|scadenza|recesso|garanzia|verifica|controll|condizion)\w*/i.test(normalized)) score += 1.5;
  keywords.forEach((keyword) => {
    if (normalized.includes(keyword)) score += 0.7;
  });
  return score;
}

function contentSections(article: any = {}) {
  const blocks = articleContentBlocks(article);
  const sections: Array<{ heading: string; headingKind: string; blocks: Array<{ kind: string; text: string }> }> = [];
  let current = { heading: "", headingKind: "heading", blocks: [] as Array<{ kind: string; text: string }> };
  const flush = () => {
    if (current.heading || current.blocks.length) sections.push(current);
    current = { heading: "", headingKind: "heading", blocks: [] };
  };

  blocks.forEach((block) => {
    if (block.kind === "heading" || block.kind === "subheading") {
      flush();
      current.heading = block.text;
      current.headingKind = block.kind;
    } else {
      current.blocks.push(block);
    }
  });
  flush();
  return sections;
}

function digestBlocks(article: any = {}, detail: any = {}) {
  const sections = contentSections(article);
  const titleKeywords = keywordSet(article?.title || "");
  const out: Array<{ kind: string; text: string }> = [];

  sections.forEach((section, sectionIndex) => {
    const heading = section.heading || (sectionIndex === 0 ? "In breve" : "");
    if (heading) out.push({ kind: section.headingKind || "heading", text: shortenSocialText(heading, 120) });

    const bodySentences: string[] = [];
    section.blocks.filter((block) => block.kind === "body").forEach((block) => {
      sentenceParts(block.text).forEach((sentence) => bodySentences.push(sentence));
    });

    if (bodySentences.length) {
      const keywords = new Set([...titleKeywords, ...keywordSet(heading)]);
      const ranked = bodySentences.map((sentence, index) => ({
        sentence,
        index,
        score: sentenceScore(sentence, index, keywords),
      }));
      ranked.sort((a, b) => b.score - a.score || a.index - b.index);
      const selected = ranked
        .slice(0, Math.max(1, detail.sentencesPerSection || 1))
        .sort((a, b) => a.index - b.index);
      const summary = shortenSocialText(selected.map((item) => item.sentence).join(" "), detail.bodyChars || 480);
      if (summary) out.push({ kind: "body", text: summary });
    }

    const lists = section.blocks.filter((block) => block.kind === "list");
    lists.slice(0, Math.max(0, detail.listItemsPerSection || 0)).forEach((block) => {
      out.push({ kind: "list", text: shortenSocialText(block.text, detail.listChars || 170) });
    });
  });

  return out.filter((block) => block.text);
}

function formatSocialSummaryBlocks(blocks: Array<{ kind: string; text: string }> = []) {
  const parts: string[] = [];
  let listBuffer: string[] = [];
  const flushList = () => {
    if (listBuffer.length) parts.push(listBuffer.join("\n"));
    listBuffer = [];
  };

  blocks.forEach((block) => {
    const text = String(block?.text || "").trim();
    if (!text) return;
    if (block.kind === "list") {
      listBuffer.push(text);
      return;
    }
    flushList();
    parts.push(text);
  });
  flushList();
  return parts.join("\n\n").trim();
}

function trimBlocksToLimit(blocks: Array<{ kind: string; text: string }>, maxChars: number) {
  const kept: Array<{ kind: string; text: string }> = [];
  for (const block of blocks) {
    const candidate = [...kept, block];
    if (formatSocialSummaryBlocks(candidate).length <= maxChars) {
      kept.push(block);
      continue;
    }
    const used = formatSocialSummaryBlocks(kept).length;
    const room = maxChars - used - (kept.length ? 2 : 0);
    if (room > 90 && block.kind === "body") {
      kept.push({ ...block, text: shortenSocialText(block.text, room) });
    }
    break;
  }
  return kept;
}

function buildSocialSummary(article: any = {}, options: { maxChars?: number } = {}) {
  const maxChars = Math.max(800, Number(options.maxChars || SOCIAL_SUMMARY_MAX_CHARS));

  for (const profile of SUMMARY_PROFILES) {
    const blocks = digestBlocks(article, profile);
    const text = formatSocialSummaryBlocks(blocks);
    if (text && text.length <= maxChars) {
      return { version: SOCIAL_SUMMARY_VERSION, profile: profile.name, blocks, text };
    }
  }

  const fallbackProfile = SUMMARY_PROFILES[SUMMARY_PROFILES.length - 1];
  const blocks = trimBlocksToLimit(digestBlocks(article, fallbackProfile), maxChars);
  return {
    version: SOCIAL_SUMMARY_VERSION,
    profile: `${fallbackProfile.name}-trimmed`,
    blocks,
    text: formatSocialSummaryBlocks(blocks),
  };
}

const API_VERSION = "v26.0";
const FACEBOOK_GRAPH = "https://graph.facebook.com";
const VERSION = "0.12.50";
const PLATFORM = "facebook";
const MAX_ATTEMPTS = 3;
const MAX_MESSAGE_CHARS = 7000;

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

function secureSecretEqual(leftValue, rightValue) {
  const left = new TextEncoder().encode(String(leftValue || ""));
  const right = new TextEncoder().encode(String(rightValue || ""));
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
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

function trackedArticleDestination(article, platform = PLATFORM, content = "article_intro") {
  const slug = String(article?.slug || "").trim();
  if (!slug) return "";
  try {
    const url = new URL(articleUrl(slug));
    url.searchParams.set("utm_source", platform);
    url.searchParams.set("utm_medium", "social");
    url.searchParams.set("utm_campaign", `editorial_${String(article?.id || "").slice(0, 8)}`);
    url.searchParams.set("utm_content", content);
    return url.href;
  } catch {
    return articleUrl(slug);
  }
}

function composeAutopilotIntroMessage(article, author = {}, link = "") {
  const title = cleanSocialInlineText(article?.title || "").replace(/\s+/g, " ").trim();
  const excerpt = cleanSocialInlineText(article?.excerpt || "").replace(/\s+/g, " ").trim();
  const authorName = String(author?.display_name || "Redazione OffertaLogica").replace(/\s+/g, " ").trim();
  const parts = [title, excerpt];
  if (link) parts.push(`Approfondisci su OffertaLogica Informa:
${link}`);
  if (authorName) parts.push(`Autore: ${authorName}`);
  const message = parts.filter(Boolean).join("\n\n");
  return message.length <= MAX_MESSAGE_CHARS ? message : `${message.slice(0, MAX_MESSAGE_CHARS - 1).trimEnd()}…`;
}

function composeFacebookMessage(article, author = {}) {
  const title = cleanSocialInlineText(article?.title || "").replace(/\s+/g, " ").trim();
  const excerpt = cleanSocialInlineText(article?.excerpt || "").replace(/\s+/g, " ").trim();
  const slug = String(article?.slug || "").trim();
  const url = slug ? articleUrl(slug) : "";
  const authorName = String(author?.display_name || "Redazione OffertaLogica").replace(/\s+/g, " ").trim();
  const summary = buildSocialSummary(article);

  const parts = [];
  if (title) parts.push(title);
  if (excerpt) parts.push(excerpt);
  if (summary.text) parts.push(summary.text);
  if (url) parts.push(`Leggi l'articolo completo su OffertaLogica Informa:\n${url}`);
  if (authorName) parts.push(`Autore: ${authorName}`);

  const message = parts.filter(Boolean).join("\n\n");
  if (message.length <= MAX_MESSAGE_CHARS) {
    return { message, summaryProfile: summary.profile };
  }

  const footer = [
    url ? `Leggi l'articolo completo su OffertaLogica Informa:\n${url}` : "",
    authorName ? `Autore: ${authorName}` : "",
  ].filter(Boolean).join("\n\n");
  const header = [title, excerpt].filter(Boolean).join("\n\n");
  const reserved = header.length + footer.length + 8;
  const fitted = buildSocialSummary(article, { maxChars: Math.max(800, MAX_MESSAGE_CHARS - reserved) });
  const safeMessage = [header, fitted.text, footer].filter(Boolean).join("\n\n");
  return {
    message: safeMessage.length <= MAX_MESSAGE_CHARS
      ? safeMessage
      : `${safeMessage.slice(0, MAX_MESSAGE_CHARS - 1).trimEnd()}…`,
    summaryProfile: fitted.profile,
  };
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
  const schedulerSecret = Deno.env.get("EDITORIAL_AUTOPILOT_FACEBOOK_SECRET")?.trim() || "";
  const suppliedSchedulerSecret = String(req.headers.get("x-offertalogica-autopilot-secret") || "").trim();
  const jwt = bearerToken(req);

  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw Object.assign(new Error("Configurazione Supabase non disponibile"), { status: 500 });
  }
  if (!jwt) {
    throw Object.assign(new Error("Sessione Redazione richiesta"), { status: 401 });
  }

  const schedulerRequest = Boolean(schedulerSecret && secureSecretEqual(suppliedSchedulerSecret, schedulerSecret));
  if (suppliedSchedulerSecret && !schedulerRequest) {
    throw Object.assign(new Error("Segreto Autopilota non valido"), { status: 401 });
  }

  if (schedulerRequest) {
    const actorId = String(req.headers.get("x-editorial-actor-id") || "").trim();
    if (!validUuid(actorId)) {
      throw Object.assign(new Error("Attore Autopilota non valido"), { status: 401 });
    }
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    };
    const [memberResponse, authorResponse] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(actorId)}&limit=1`, {
        headers, cache: "no-store",
      }),
      fetch(`${supabaseUrl}/rest/v1/editorial_authors?select=id,user_id,active&user_id=eq.${encodeURIComponent(actorId)}&active=eq.true&limit=1`, {
        headers, cache: "no-store",
      }),
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
      apikey: ctx.scheduler ? ctx.serviceKey : ctx.anonKey,
      Authorization: `Bearer ${ctx.scheduler ? ctx.serviceKey : ctx.jwt}`,
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


async function loadPlanPublication(ctx, itemId) {
  const rows = await serviceRows(
    ctx,
    `editorial_social_plan_publications?social_plan_item_id=eq.${encodeURIComponent(itemId)}&platform=eq.${PLATFORM}&select=social_plan_item_id,platform,status,attempts,external_post_id,external_post_url,last_error,queued_at,last_attempt_at,published_at,updated_at&limit=1`,
  );
  return rows[0] || null;
}

async function updatePlanPublication(ctx, itemId, body) {
  const rows = await updateRows(
    ctx,
    `editorial_social_plan_publications?social_plan_item_id=eq.${encodeURIComponent(itemId)}&platform=eq.${PLATFORM}`,
    body,
  );
  return rows[0] || null;
}

async function claimPlanPublication(ctx, publication) {
  const attempts = Number(publication?.attempts || 0);
  const rows = await updateRows(
    ctx,
    `editorial_social_plan_publications?social_plan_item_id=eq.${encodeURIComponent(String(publication.social_plan_item_id))}&platform=eq.${PLATFORM}&status=in.(ready,failed)&attempts=eq.${attempts}`,
    {
      status: "publishing",
      attempts: attempts + 1,
      last_attempt_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
  );
  return rows[0] || null;
}

function planTerminalResult(req, publication, channel) {
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

function trackedPlanDestination(rawUrl, item, platform) {
  if (!validHttps(rawUrl)) return "";
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("utm_source", platform);
    url.searchParams.set("utm_medium", "social");
    url.searchParams.set("utm_campaign", `editorial_${String(item?.source_article_id || "").slice(0, 8)}`);
    url.searchParams.set("utm_content", String(item?.post_type || "post"));
    return url.href;
  } catch {
    return rawUrl;
  }
}

async function loadPlanItemContext(ctx, itemId) {
  const itemRows = await serviceRows(
    ctx,
    `editorial_social_plan_items?id=eq.${encodeURIComponent(itemId)}&select=id,source_article_id,opportunity_id,post_type,destination_target_id,theme,brief,canonical_text,platforms,status&limit=1`,
  );
  const item = itemRows[0] || null;
  if (!item) throw Object.assign(new Error("Post del piano non trovato"), { status: 404 });

  const articleRows = await serviceRows(
    ctx,
    `editorial_articles?id=eq.${encodeURIComponent(String(item.source_article_id || ""))}&select=id,status,slug,title,featured_image_url,featured_image_alt&limit=1`,
  );
  const article = articleRows[0] || null;
  if (!article || article.status !== "published") {
    throw Object.assign(new Error("L'articolo collegato deve essere pubblicato"), { status: 409 });
  }

  let destination = articleUrl(String(article.slug || ""));
  if (item.post_type === "related" && validUuid(String(item.destination_target_id || ""))) {
    const targetRows = await serviceRows(
      ctx,
      `editorial_promotion_targets?id=eq.${encodeURIComponent(String(item.destination_target_id))}&select=id,url_path,enabled&limit=1`,
    );
    const target = targetRows[0] || null;
    if (!target?.enabled) throw Object.assign(new Error("Destinazione OffertaLogica non disponibile"), { status: 409 });
    const raw = String(target.url_path || "").trim();
    try {
      const url = new URL(raw, "https://offertalogica.it");
      if (!["offertalogica.it", "www.offertalogica.it"].includes(url.hostname.toLowerCase()) || url.protocol !== "https:") {
        throw new Error("host");
      }
      destination = `https://offertalogica.it${url.pathname}${url.search}`;
    } catch {
      throw Object.assign(new Error("Destinazione OffertaLogica non valida"), { status: 422 });
    }
  }

  return { item, article, destination: trackedPlanDestination(destination, item, PLATFORM) };
}

async function processPlanItem(req, ctx, pageToken, pageId, itemId) {
  const channel = await loadChannel(ctx);
  const publication = await loadPlanPublication(ctx, itemId);
  const terminal = planTerminalResult(req, publication, channel);
  if (terminal) return terminal;

  const identity = await pageIdentity(pageToken);
  if (identity.id !== pageId) {
    throw Object.assign(new Error("Il Page Access Token non appartiene alla Pagina Facebook configurata"), { status: 409 });
  }
  const { item, destination } = await loadPlanItemContext(ctx, itemId);
  const message = String(item.canonical_text || "").trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) throw Object.assign(new Error("Testo del post vuoto"), { status: 422 });

  const claimed = await claimPlanPublication(ctx, publication);
  if (!claimed) {
    return json(req, { ok: true, version: VERSION, result: "in_progress", status: "in_progress", published: false });
  }

  let postId = "";
  try {
    postId = await createPagePost(pageToken, pageId, message, destination);
    const post = await publishedPost(pageToken, postId).catch(() => null);
    const now = new Date().toISOString();
    const updated = await updatePlanPublication(ctx, itemId, {
      status: "published",
      external_post_id: postId,
      external_post_url: post?.permalink_url || null,
      last_error: null,
      published_at: now,
      updated_at: now,
    });
    if (!updated) {
      await updatePlanPublication(ctx, itemId, {
        status: "publishing",
        external_post_id: postId,
        last_error: "ESITO INCERTO: post creato su Facebook ma conferma database non riuscita. Non ritentare automaticamente.",
        updated_at: new Date().toISOString(),
      }).catch(() => null);
      return json(req, { ok: true, version: VERSION, result: "ambiguous_publish", status: "ambiguous_publish", published: false, external_post_id: postId });
    }
    return json(req, {
      ok: true,
      version: VERSION,
      result: "published",
      status: "published",
      published: true,
      external_post_id: postId,
      external_post_url: post?.permalink_url || null,
      destination,
    });
  } catch (error) {
    const phase = String(error?.phase || "");
    if (phase === "publish_ambiguous") {
      await updatePlanPublication(ctx, itemId, {
        status: "publishing",
        external_post_id: postId || null,
        last_error: `ESITO INCERTO: ${String(error?.message || "pubblicazione Facebook non verificabile").slice(0, 800)} Non ritentare automaticamente.`,
        updated_at: new Date().toISOString(),
      }).catch(() => null);
      return json(req, { ok: true, version: VERSION, result: "ambiguous_publish", status: "ambiguous_publish", published: false, external_post_id: postId || null });
    }
    const message = error?.meta?.message ? `${error.message}: ${error.meta.message}` : String(error?.message || "Errore Facebook");
    await updatePlanPublication(ctx, itemId, {
      status: "failed",
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }).catch(() => null);
    return json(req, { ok: true, version: VERSION, result: "failed", status: "failed", published: false, error: message });
  }
}

async function processArticleQueue(req, ctx, pageToken, pageId, articleId, options = {}) {
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
  const autopilotIntro = options?.autopilotIntro === true;
  const link = autopilotIntro
    ? trackedArticleDestination(article, PLATFORM, "article_intro")
    : articleUrl(String(article.slug || ""));
  const composed = autopilotIntro
    ? { message: composeAutopilotIntroMessage(article, author, link), summaryProfile: "autopilot_intro" }
    : composeFacebookMessage(article, author);
  const message = composed.message;
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
      summary_version: SOCIAL_SUMMARY_VERSION,
      summary_profile: composed.summaryProfile,
      format: autopilotIntro ? "article_intro" : "article_standard",
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
        summary_version: SOCIAL_SUMMARY_VERSION,
      });
    }

    if (action === "process_article_queue") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 422);
      return await processArticleQueue(req, ctx, pageToken, pageId, articleId);
    }

    if (action === "process_autopilot_article_intro") {
      const articleId = String(body?.article_id || "").trim();
      if (!validUuid(articleId)) return json(req, { ok: false, error: "article_id non valido" }, 422);
      return await processArticleQueue(req, ctx, pageToken, pageId, articleId, { autopilotIntro: true });
    }

    if (action === "process_plan_item") {
      const itemId = String(body?.social_plan_item_id || "").trim();
      if (!validUuid(itemId)) return json(req, { ok: false, error: "social_plan_item_id non valido" }, 422);
      return await processPlanItem(req, ctx, pageToken, pageId, itemId);
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
