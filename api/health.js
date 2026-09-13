import crypto from "node:crypto";
import { json, method } from "../lib/http.js";
import { checkCustomerDb } from "../lib/customerDb.js";
import { otpProviderStatus } from "../lib/otp.js";
import { notificationChannelsStatus } from "../lib/notify.js";
import { checkStore, persistentStoreConfigured } from "../lib/store.js";

const EDITORIAL_SITE = "https://offertalogica.it";
const EDITORIAL_SUPABASE_URL = String(process.env.EDITORIAL_SUPABASE_URL || "https://kzxdamhfmzaxonpkytcf.supabase.co").replace(/\/+$/, "");
const EDITORIAL_SUPABASE_KEY = String(process.env.EDITORIAL_SUPABASE_ANON_KEY || "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl").trim();
const EDITORIAL_PUBLIC_SELECT = "slug,title,excerpt,content,category,featured_image_url,featured_image_alt,sources,seo_title,seo_description,published_at,updated_at,author_slug,author_display_name,author_bio,author_avatar_url,author_website_url,author_linkedin_url,category_name";

function requestToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function constantTimeTokenMatch(actual, expected) {
  const left = Buffer.from(String(actual || ""), "utf8");
  const right = Buffer.from(String(expected || ""), "utf8");
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isAuthorized(req) {
  const token = requestToken(req);
  const healthToken = String(process.env.HEALTHCHECK_TOKEN || "").trim();
  return Boolean(healthToken && constantTimeTokenMatch(token, healthToken));
}

function requestUrl(req) {
  try {
    return new URL(req.url || "/api/health", `https://${req.headers.host || "offertalogica.it"}`);
  } catch {
    return new URL("https://offertalogica.it/api/health");
  }
}

function editorialSlug(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) && normalized.length <= 120 ? normalized : "";
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function escJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function xmlEsc(value = "") {
  return esc(value).replace(/&#39;/g, "&apos;");
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function humanDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function categoryLabel(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "Articolo OffertaLogica";
  const known = {
    bollette: "Bollette",
    "offerte-luce-gas": "Offerte luce e gas",
    "mercato-energia": "Mercato energia",
    risparmio: "Risparmio",
    "casa-smart": "Casa smart",
    assicurazioni: "Assicurazioni",
    casa: "Casa",
    fotovoltaico: "Fotovoltaico",
    mobilita: "Mobilità",
    tecnologia: "Tecnologia",
  };
  return known[raw] || raw.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function safeEditorialHref(value = "") {
  const href = String(value || "").trim();
  if (!href || /[\u0000-\u001f\u007f\s"'<>]/.test(href)) return "";
  if (/^\/(?!\/)/.test(href)) return href;
  if (/^https:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }
  return "";
}

function renderInlineMarkdown(value = "") {
  const source = String(value || "");
  const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let output = "";
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    output += esc(source.slice(last, match.index));
    const href = safeEditorialHref(match[2]);
    if (href) {
      const rel = /^https:\/\//i.test(href) ? ' rel="noopener noreferrer"' : "";
      output += `<a href="${esc(href)}"${rel}>${esc(match[1])}</a>`;
    } else {
      output += esc(match[0]);
    }
    last = pattern.lastIndex;
  }
  return output + esc(source.slice(last));
}

function renderBody(content = "") {
  const blocks = String(content).split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  return blocks.map((block) => {
    if (/^###\s+/.test(block)) return `<h3>${renderInlineMarkdown(block.replace(/^###\s+/, ""))}</h3>`;
    if (/^##\s+/.test(block)) return `<h2>${renderInlineMarkdown(block.replace(/^##\s+/, ""))}</h2>`;
    const lines = block.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const unordered = lines.length > 1 && lines.every((value) => /^[-*]\s+/.test(value));
    const ordered = lines.length > 1 && lines.every((value) => /^\d+[.)]\s+/.test(value));
    if (unordered || ordered) {
      const tag = ordered ? "ol" : "ul";
      const itemPattern = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      return `<${tag}>${lines.map((value) => `<li>${renderInlineMarkdown(value.replace(itemPattern, ""))}</li>`).join("")}</${tag}>`;
    }
    return `<p>${lines.map(renderInlineMarkdown).join("<br>")}</p>`;
  }).join("\n");
}

function sourceItems(value = "") {
  return String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(.*?)(https?:\/\/\S+)$/i);
    if (!match) return `<li>${esc(line)}</li>`;
    const label = match[1].replace(/[|–—:-]+\s*$/, "").trim();
    return `<li><a href="${esc(match[2])}" rel="noopener noreferrer">${esc(label || match[2])}</a></li>`;
  }).join("");
}

function authorPublicUrl(article) {
  const slug = editorialSlug(article?.author_slug || "");
  return slug ? `${EDITORIAL_SITE}/autori/${encodeURIComponent(slug)}.html` : `${EDITORIAL_SITE}/articoli.html`;
}

function authorSameAs(article) {
  return [article?.author_linkedin_url, article?.author_website_url]
    .map((value) => String(value || "").trim())
    .filter((value) => /^https:\/\//i.test(value));
}

function authorLinks(article) {
  const links = [];
  if (/^https:\/\//i.test(article?.author_linkedin_url || "")) {
    links.push(`<a href="${esc(article.author_linkedin_url)}" rel="me noopener noreferrer" target="_blank" aria-label="LinkedIn, si apre in una nuova scheda">LinkedIn</a>`);
  }
  if (/^https:\/\//i.test(article?.author_website_url || "")) {
    links.push(`<a href="${esc(article.author_website_url)}" rel="me noopener noreferrer" target="_blank" aria-label="Sito personale, si apre in una nuova scheda">Sito personale</a>`);
  }
  return links.join("");
}

function legalFooter() {
  return `<footer class="ol-footer"><div class="ol-shell"><nav class="ol-footer-links" aria-label="Link legali e preferenze privacy"><a href="/articoli.html">Torna a OffertaLogica Informa</a><a href="/termini-condizioni.html">Termini e condizioni</a><a href="https://www.iubenda.com/privacy-policy/36565194" class="iubenda-white iubenda-noiframe iubenda-embed">Privacy Policy</a><a href="https://www.iubenda.com/privacy-policy/36565194/cookie-policy" class="iubenda-white iubenda-noiframe iubenda-embed">Cookie Policy</a><button type="button" class="ol-footer-privacy-action" onclick="apriPreferenzeCookie(event)">Modifica preferenze cookie</button></nav></div></footer><script>function apriPreferenzeCookie(event){if(event)event.preventDefault();const b=document.querySelector('.iubenda-tp-btn.iubenda-cs-preferences-link');if(b){b.click();return;}window.location.href='https://www.iubenda.com/privacy-policy/36565194/cookie-policy';}</script><script>(function(w,d){var loader=function(){var s=d.createElement('script'),tag=d.getElementsByTagName('script')[0];s.src='https://cdn.iubenda.com/iubenda.js';tag.parentNode.insertBefore(s,tag);};if(w.addEventListener){w.addEventListener('load',loader,false);}else if(w.attachEvent){w.attachEvent('onload',loader);}else{w.onload=loader;}})(window,document);</script>`;
}

const categoryLinks = {
  bollette: [["Come leggere la bolletta", "/come-leggere-bolletta-luce-gas.html"], ["Quota fissa e consumi bassi", "/quota-fissa-luce-gas-consumi-bassi.html"], ["Calcolatore OffertaLogica", "/"]],
  "offerte-luce-gas": [["Offerte luce e gas aggiornate", "/offerte-luce-gas-aggiornate.html"], ["Come cambiare fornitore", "/come-cambiare-fornitore-luce-gas.html"], ["Fornitori energia", "/fornitori/"]],
  "mercato-energia": [["PUN luce oggi", "/pun-oggi.html"], ["PSV gas oggi", "/psv-gas-oggi.html"], ["PUN, PSV e spread", "/pun-psv-spread-luce-gas.html"]],
  risparmio: [["Prezzo fisso o variabile", "/prezzo-fisso-o-variabile-luce-gas.html"], ["Come funziona OffertaLogica", "/come-funziona.html"], ["Calcolatore OffertaLogica", "/"]],
  "casa-smart": [["Fotovoltaico", "/fotovoltaico.html"], ["Climatizzazione a pompa di calore", "/climatizzazione-pompa-di-calore.html"], ["OffertaLogica Informa", "/articoli.html"]],
  fotovoltaico: [["Fotovoltaico", "/fotovoltaico.html"], ["Climatizzazione a pompa di calore", "/climatizzazione-pompa-di-calore.html"], ["OffertaLogica Informa", "/articoli.html"]],
};

async function editorialApi(endpoint) {
  const response = await fetch(`${EDITORIAL_SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: { apikey: EDITORIAL_SUPABASE_KEY, Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadEditorialArticle(slug) {
  const encoded = encodeURIComponent(slug);
  try {
    const rows = await editorialApi(`editorial_public_articles?select=${EDITORIAL_PUBLIC_SELECT}&slug=eq.${encoded}&limit=1`);
    return rows?.[0] || null;
  } catch (error) {
    if (error.status !== 400 && error.status !== 404) throw error;
    const rows = await editorialApi(`editorial_articles?select=id,author_id,slug,title,excerpt,content,category,featured_image_url,sources,seo_title,seo_description,published_at,updated_at&status=eq.published&slug=eq.${encoded}&limit=1`);
    const article = rows?.[0];
    if (!article) return null;
    let author = {};
    if (article.author_id) {
      const authors = await editorialApi(`editorial_authors?select=slug,display_name,bio,avatar_url,website_url,linkedin_url&id=eq.${encodeURIComponent(article.author_id)}&limit=1`);
      author = authors?.[0] || {};
    }
    return {
      ...article,
      featured_image_alt: article.title,
      author_slug: author.slug || "",
      author_display_name: author.display_name || "Redazione OffertaLogica",
      author_bio: author.bio || "",
      author_avatar_url: author.avatar_url || "",
      author_website_url: author.website_url || "",
      author_linkedin_url: author.linkedin_url || "",
      category_name: categoryLabel(article.category),
    };
  }
}

async function loadEditorialAuthor(authorSlug) {
  const slug = editorialSlug(authorSlug);
  if (!slug) return null;
  const encoded = encodeURIComponent(slug);
  try {
    const rows = await editorialApi(`editorial_public_articles?select=${EDITORIAL_PUBLIC_SELECT}&author_slug=eq.${encoded}&order=published_at.desc`);
    if (!rows?.length) return null;
    const first = rows[0];
    return {
      author: {
        author_slug: slug,
        author_display_name: first.author_display_name || "Redazione OffertaLogica",
        author_bio: first.author_bio || "",
        author_avatar_url: first.author_avatar_url || "",
        author_website_url: first.author_website_url || "",
        author_linkedin_url: first.author_linkedin_url || "",
      },
      articles: rows,
    };
  } catch (error) {
    if (error.status !== 400 && error.status !== 404) throw error;
    const authors = await editorialApi(`editorial_authors?select=id,slug,display_name,bio,avatar_url,website_url,linkedin_url,active&slug=eq.${encoded}&active=eq.true&limit=1`);
    const author = authors?.[0];
    if (!author) return null;
    const articles = await editorialApi(`editorial_articles?select=id,author_id,slug,title,excerpt,content,category,featured_image_url,sources,seo_title,seo_description,published_at,updated_at&status=eq.published&author_id=eq.${encodeURIComponent(author.id)}&order=published_at.desc`);
    return {
      author: {
        author_slug: author.slug || slug,
        author_display_name: author.display_name || "Redazione OffertaLogica",
        author_bio: author.bio || "",
        author_avatar_url: author.avatar_url || "",
        author_website_url: author.website_url || "",
        author_linkedin_url: author.linkedin_url || "",
      },
      articles: (articles || []).map((article) => ({
        ...article,
        featured_image_alt: article.title,
        author_slug: author.slug || slug,
        author_display_name: author.display_name || "Redazione OffertaLogica",
        author_bio: author.bio || "",
        author_avatar_url: author.avatar_url || "",
        author_website_url: author.website_url || "",
        author_linkedin_url: author.linkedin_url || "",
        category_name: categoryLabel(article.category),
      })),
    };
  }
}

async function loadEditorialSitemapRows() {
  try {
    return await editorialApi("editorial_public_articles?select=slug,published_at,updated_at,author_slug&order=published_at.desc");
  } catch (error) {
    if (error.status !== 400 && error.status !== 404) throw error;
    const articles = await editorialApi("editorial_articles?select=slug,published_at,updated_at,author_id&status=eq.published&order=published_at.desc");
    const ids = [...new Set((articles || []).map((article) => article.author_id).filter(Boolean))];
    let authorMap = new Map();
    if (ids.length) {
      const authors = await editorialApi(`editorial_authors?select=id,slug&id=in.(${ids.join(",")})`);
      authorMap = new Map((authors || []).map((author) => [author.id, editorialSlug(author.slug)]));
    }
    return (articles || []).map((article) => ({ ...article, author_slug: authorMap.get(article.author_id) || "" }));
  }
}

function articleHtml(article) {
  const slug = editorialSlug(article.slug);
  const canonical = `${EDITORIAL_SITE}/articoli/${encodeURIComponent(slug)}.html`;
  const title = article.seo_title || `${article.title} | OffertaLogica`;
  const description = article.seo_description || article.excerpt || "Approfondimento OffertaLogica.";
  const published = isoDate(article.published_at);
  const updated = isoDate(article.updated_at || article.published_at);
  const visiblyUpdated = Boolean(published && updated && published !== updated);
  const authorName = article.author_display_name || "Redazione OffertaLogica";
  const authorUrl = authorPublicUrl(article);
  const sameAs = authorSameAs(article);
  const authorEntity = {
    "@type": "Person",
    name: authorName,
    ...(article.author_bio ? { description: article.author_bio } : {}),
    ...(article.author_avatar_url ? { image: { "@type": "ImageObject", url: article.author_avatar_url } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${canonical}#article`,
    url: canonical,
    headline: article.title,
    description,
    inLanguage: "it-IT",
    datePublished: published,
    dateModified: updated,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    isPartOf: { "@type": "WebSite", "@id": `${EDITORIAL_SITE}/#website`, url: `${EDITORIAL_SITE}/`, name: "OffertaLogica" },
    ...(article.category ? { about: { "@type": "Thing", name: article.category_name || categoryLabel(article.category) } } : {}),
    author: authorEntity,
    publisher: { "@type": "Organization", "@id": `${EDITORIAL_SITE}/#organization`, name: "OffertaLogica", url: `${EDITORIAL_SITE}/`, logo: { "@type": "ImageObject", url: `${EDITORIAL_SITE}/assets/logo-offertalogica-header.png` } },
    ...(article.featured_image_url ? { image: [{ "@type": "ImageObject", url: article.featured_image_url, caption: article.featured_image_alt || article.title }] } : {}),
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "OffertaLogica", item: `${EDITORIAL_SITE}/` },
      { "@type": "ListItem", position: 2, name: "OffertaLogica Informa", item: `${EDITORIAL_SITE}/articoli.html` },
      { "@type": "ListItem", position: 3, name: article.title, item: canonical },
    ],
  };
  const useful = categoryLinks[article.category] || [["Come funziona OffertaLogica", "/come-funziona.html"], ["OffertaLogica Informa", "/articoli.html"], ["Calcolatore OffertaLogica", "/"]];
  const authorCard = authorName ? `<section class="ol-author-card" aria-labelledby="autore-articolo">${article.author_avatar_url ? `<img class="ol-author-avatar" src="${esc(article.author_avatar_url)}" alt="" loading="lazy" decoding="async">` : ""}<div class="ol-author-card-body"><div class="ol-eyebrow">Autore</div><h2 id="autore-articolo"><a href="${esc(authorUrl)}">${esc(authorName)}</a></h2>${article.author_bio ? `<p>${esc(article.author_bio)}</p>` : ""}<div class="ol-author-links">${authorLinks(article)}</div></div></section>` : "";

  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="author" content="${esc(authorName)}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"><link rel="canonical" href="${canonical}"><link rel="sitemap" type="application/xml" href="/sitemap-informa.xml"><meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:site_name" content="OffertaLogica">${article.featured_image_url ? `<meta property="og:image" content="${esc(article.featured_image_url)}">` : ""}<meta property="article:published_time" content="${esc(published)}"><meta property="article:modified_time" content="${esc(updated)}"><meta name="twitter:card" content="${article.featured_image_url ? "summary_large_image" : "summary"}"><link rel="icon" type="image/png" href="/assets/logo-offertalogica-icon.png"><link rel="stylesheet" href="/assets/editorial.css?v=0.11.6"><script type="application/ld+json">${escJson(articleLd)}</script><script type="application/ld+json">${escJson(breadcrumb)}</script></head><body><a class="ol-skip-link" href="#contenuto-principale">Vai al contenuto principale</a><header class="ol-topbar"><div class="ol-shell ol-topbar-inner"><a class="ol-brand" href="/" aria-label="OffertaLogica, torna alla home"><img src="/assets/logo-offertalogica-header.png" alt="OffertaLogica"></a><nav class="ol-nav" aria-label="Navigazione principale"><a href="/">Calcolatore</a><a href="/come-funziona.html">Come funziona</a><a href="/articoli.html">OffertaLogica Informa</a></nav></div></header><main id="contenuto-principale" class="ol-section"><div class="ol-shell"><nav class="ol-breadcrumbs" aria-label="Percorso di navigazione"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/articoli.html">OffertaLogica Informa</a><span aria-hidden="true">/</span><span aria-current="page">${esc(article.title)}</span></nav><article class="ol-panel ol-panel-body ol-prose"><div class="ol-eyebrow">${esc(article.category_name || categoryLabel(article.category))}</div><h1>${esc(article.title)}</h1><p class="ol-lead">${esc(article.excerpt || "")}</p><div class="ol-article-meta ol-article-meta-large"><a href="${esc(authorUrl)}">${esc(authorName)}</a><time datetime="${esc(published)}">Pubblicato il ${esc(humanDate(article.published_at))}</time>${visiblyUpdated ? `<time datetime="${esc(updated)}">Aggiornato il ${esc(humanDate(article.updated_at))}</time>` : ""}</div>${article.featured_image_url ? `<img class="ol-featured-image" src="${esc(article.featured_image_url)}" alt="${esc(article.featured_image_alt || article.title)}" decoding="async">` : ""}<div class="ol-prose-body">${renderBody(article.content)}</div>${authorCard}${article.sources ? `<section class="ol-sources"><h2>Fonti</h2><ul>${sourceItems(article.sources)}</ul></section>` : ""}<section class="ol-related"><h2>Approfondimenti utili</h2><div class="ol-related-list">${useful.map(([label, href]) => `<a href="${href}">${esc(label)}</a>`).join("")}</div></section></article></div></main>${legalFooter()}</body></html>\n`;
}

function authorHtml(author, articles) {
  const authorSlug = editorialSlug(author?.author_slug || "");
  const canonical = `${EDITORIAL_SITE}/autori/${encodeURIComponent(authorSlug)}.html`;
  const name = author?.author_display_name || "Redazione OffertaLogica";
  const title = `${name} - Autore | OffertaLogica`;
  const description = author?.author_bio || `Articoli e profilo di ${name} su OffertaLogica.`;
  const sameAs = [author?.author_linkedin_url, author?.author_website_url]
    .map((value) => String(value || "").trim())
    .filter((value) => /^https:\/\//i.test(value));
  const person = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: title,
        description,
        inLanguage: "it-IT",
        mainEntity: {
          "@type": "Person",
          "@id": `${canonical}#person`,
          url: canonical,
          name,
          ...(author?.author_bio ? { description: author.author_bio } : {}),
          ...(author?.author_avatar_url ? { image: { "@type": "ImageObject", url: author.author_avatar_url } } : {}),
          ...(sameAs.length ? { sameAs } : {}),
        },
        isPartOf: { "@type": "WebSite", "@id": `${EDITORIAL_SITE}/#website`, url: `${EDITORIAL_SITE}/`, name: "OffertaLogica" },
      },
      {
        "@type": "ItemList",
        "@id": `${canonical}#articoli`,
        name: `Articoli pubblicati da ${name}`,
        numberOfItems: articles.length,
        itemListElement: articles.map((article, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${EDITORIAL_SITE}/articoli/${encodeURIComponent(editorialSlug(article.slug))}.html`,
          name: article.title,
        })),
      },
    ],
  };
  const links = authorLinks(author);
  const cards = articles.map((article) => {
    const slug = editorialSlug(article.slug);
    return `<article class="ol-article-item"><div class="ol-article-meta"><span>${esc(article.category_name || categoryLabel(article.category))}</span><time datetime="${esc(isoDate(article.published_at))}">${esc(humanDate(article.published_at))}</time></div><h3><a href="/articoli/${encodeURIComponent(slug)}.html">${esc(article.title)}</a></h3><p>${esc(article.excerpt || "")}</p></article>`;
  }).join("");
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1"><link rel="canonical" href="${canonical}"><link rel="sitemap" type="application/xml" href="/sitemap-informa.xml"><meta property="og:type" content="profile"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}">${author?.author_avatar_url ? `<meta property="og:image" content="${esc(author.author_avatar_url)}">` : ""}<link rel="icon" type="image/png" href="/assets/logo-offertalogica-icon.png"><link rel="stylesheet" href="/assets/editorial.css?v=0.11.6"><script type="application/ld+json">${escJson(person)}</script></head><body><a class="ol-skip-link" href="#contenuto-principale">Vai al contenuto principale</a><header class="ol-topbar"><div class="ol-shell ol-topbar-inner"><a class="ol-brand" href="/" aria-label="OffertaLogica, torna alla home"><img src="/assets/logo-offertalogica-header.png" alt="OffertaLogica"></a><nav class="ol-nav" aria-label="Navigazione principale"><a href="/">Calcolatore</a><a href="/come-funziona.html">Come funziona</a><a href="/articoli.html">OffertaLogica Informa</a></nav></div></header><main id="contenuto-principale" class="ol-section"><div class="ol-shell"><nav class="ol-breadcrumbs" aria-label="Percorso di navigazione"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/articoli.html">OffertaLogica Informa</a><span aria-hidden="true">/</span><span aria-current="page">${esc(name)}</span></nav><section class="ol-panel ol-panel-body"><div class="ol-author-profile">${author?.author_avatar_url ? `<img class="ol-author-avatar" src="${esc(author.author_avatar_url)}" alt="" loading="lazy" decoding="async">` : ""}<div><div class="ol-eyebrow">Autore OffertaLogica Informa</div><h1>${esc(name)}</h1>${author?.author_bio ? `<p class="ol-lead">${esc(author.author_bio)}</p>` : ""}${links ? `<div class="ol-author-links">${links}</div>` : ""}</div></div><section aria-labelledby="articoli-autore"><h2 id="articoli-autore">Articoli pubblicati</h2><div class="ol-author-article-grid">${cards}</div></section></section></div></main>${legalFooter()}</body></html>\n`;
}

function notFoundHtml(label = "Contenuto") {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(label)} non trovato | OffertaLogica</title><meta name="robots" content="noindex,follow"><link rel="stylesheet" href="/assets/editorial.css?v=0.11.6"></head><body><main id="contenuto-principale" class="ol-section"><div class="ol-shell"><section class="ol-panel ol-panel-body"><h1>${esc(label)} non trovato</h1><p>Il contenuto richiesto non è disponibile.</p><p><a href="/articoli.html">Torna a OffertaLogica Informa</a></p></section></div></main></body></html>`;
}

function sendEditorialHtml(req, res, status, html, { indexable = false } = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", indexable ? "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" : "no-store");
  res.setHeader("X-Robots-Tag", indexable ? "index, follow" : "noindex, follow");
  if (req.method === "HEAD") return res.end();
  return res.end(html);
}

async function handleEditorialArticle(req, res, slugValue) {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return json(res, 405, { ok: false, error: "Metodo non consentito" });
  }
  const slug = editorialSlug(slugValue);
  if (!slug) return sendEditorialHtml(req, res, 404, notFoundHtml("Articolo"));
  try {
    const article = await loadEditorialArticle(slug);
    if (!article) return sendEditorialHtml(req, res, 404, notFoundHtml("Articolo"));
    return sendEditorialHtml(req, res, 200, articleHtml(article), { indexable: true });
  } catch (error) {
    console.error("editorial_article_render_failed", { slug, message: String(error?.message || error || "render_failed").slice(0, 180) });
    return sendEditorialHtml(req, res, 503, `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="robots" content="noindex,follow"><title>OffertaLogica Informa</title></head><body><main><h1>Contenuto temporaneamente non disponibile</h1><p>Riprova tra poco.</p></main></body></html>`);
  }
}

async function handleEditorialAuthor(req, res, slugValue) {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return json(res, 405, { ok: false, error: "Metodo non consentito" });
  }
  const slug = editorialSlug(slugValue);
  if (!slug) return sendEditorialHtml(req, res, 404, notFoundHtml("Autore"));
  try {
    const profile = await loadEditorialAuthor(slug);
    if (!profile) return sendEditorialHtml(req, res, 404, notFoundHtml("Autore"));
    return sendEditorialHtml(req, res, 200, authorHtml(profile.author, profile.articles || []), { indexable: true });
  } catch (error) {
    console.error("editorial_author_render_failed", { slug, message: String(error?.message || error || "render_failed").slice(0, 180) });
    return sendEditorialHtml(req, res, 503, `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="robots" content="noindex,follow"><title>OffertaLogica Informa</title></head><body><main><h1>Profilo autore temporaneamente non disponibile</h1><p>Riprova tra poco.</p></main></body></html>`);
  }
}

async function handleEditorialSitemap(req, res) {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return json(res, 405, { ok: false, error: "Metodo non consentito" });
  }
  try {
    const rows = (await loadEditorialSitemapRows()) || [];
    const items = rows.map((row) => ({
      slug: editorialSlug(row.slug),
      authorSlug: editorialSlug(row.author_slug || ""),
      lastmod: isoDate(row.updated_at || row.published_at).slice(0, 10),
    })).filter((row) => row.slug);
    const archiveLastmod = items.map((row) => row.lastmod).filter(Boolean).sort().at(-1) || new Date().toISOString().slice(0, 10);
    const authors = new Map();
    for (const item of items) {
      if (!item.authorSlug) continue;
      const previous = authors.get(item.authorSlug) || "";
      if (!previous || item.lastmod > previous) authors.set(item.authorSlug, item.lastmod || archiveLastmod);
    }
    const entries = [
      { loc: `${EDITORIAL_SITE}/articoli.html`, lastmod: archiveLastmod },
      ...items.map((row) => ({ loc: `${EDITORIAL_SITE}/articoli/${row.slug}.html`, lastmod: row.lastmod || archiveLastmod })),
      ...[...authors.entries()].map(([authorSlug, lastmod]) => ({ loc: `${EDITORIAL_SITE}/autori/${authorSlug}.html`, lastmod: lastmod || archiveLastmod })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((entry) => `  <url><loc>${xmlEsc(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod></url>`).join("\n")}\n</urlset>\n`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
    if (req.method === "HEAD") return res.end();
    return res.end(xml);
  } catch (error) {
    console.error("editorial_sitemap_render_failed", { message: String(error?.message || error || "sitemap_failed").slice(0, 180) });
    return json(res, 503, { ok: false, error: "Sitemap editoriale temporaneamente non disponibile" });
  }
}

export default async function handler(req, res) {
  const url = requestUrl(req);
  const publicArticleSlug = url.searchParams.get("editorial_slug");
  if (publicArticleSlug !== null) return handleEditorialArticle(req, res, publicArticleSlug);
  const publicAuthorSlug = url.searchParams.get("editorial_author_slug");
  if (publicAuthorSlug !== null) return handleEditorialAuthor(req, res, publicAuthorSlug);
  if (url.searchParams.get("editorial_sitemap") === "1") return handleEditorialSitemap(req, res);

  if (!method(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "no-store");
  if (!isAuthorized(req)) return json(res, 404, { ok: false, error: "Not found" });

  const startedAt = Date.now();
  try {
    const storageOk = await checkStore();
    const customerDb = await checkCustomerDb();
    const ok = storageOk && customerDb.ok;
    json(res, ok ? 200 : 500, {
      ok,
      storage: persistentStoreConfigured() ? "redis" : "memory",
      customerDb,
      sms: otpProviderStatus(),
      notifications: notificationChannelsStatus(),
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    json(res, 500, {
      ok: false,
      storage: persistentStoreConfigured() ? "redis" : "memory",
      error: "Health check fallito",
      checkedAt: new Date().toISOString(),
    });
  }
}
