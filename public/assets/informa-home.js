(() => {
  "use strict";

  const VERSION = "0.11.2";
  const config = window.OFFERTALOGICA_EDITORIAL_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const supabaseKey = String(config.supabaseAnonKey || "").trim();
  const select = [
    "slug",
    "title",
    "featured_image_url",
    "featured_image_alt",
    "author_slug",
    "author_display_name",
    "author_avatar_url",
    "author_website_url",
    "author_linkedin_url"
  ].join(",");

  function isHttps(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function isOffertaLogicaAuthor(article) {
    const name = String(article?.author_display_name || "")
      .trim()
      .toLocaleLowerCase("it-IT")
      .replace(/\s+/g, " ");
    const compact = name.replace(/[^a-z0-9]+/g, "");
    return compact === "offertalogica" || compact === "offertalogicait" || compact === "redazioneoffertalogica" || compact === "redazioneoffertalogicait" || compact === "redazioneoffertalogicainforma";
  }

  function authorHref(article) {
    if (isOffertaLogicaAuthor(article)) return "https://offertalogica.it/";
    const slug = String(article?.author_slug || "").trim();
    if (slug) return `/autori/${encodeURIComponent(slug)}.html`;
    return isHttps(article?.author_linkedin_url) || isHttps(article?.author_website_url) || "";
  }

  function applyExternalLinkAttributes(link, href) {
    if (!link) return;
    const external = /^https:\/\//i.test(href) && !/^https:\/\/offertalogica\.it(?:\/|$)/i.test(href);
    if (external) {
      link.target = "_blank";
      link.rel = "me noopener noreferrer";
    } else {
      link.removeAttribute("target");
      link.removeAttribute("rel");
    }
  }

  function makeAuthor(article) {
    const href = authorHref(article);
    const name = String(article?.author_display_name || "Redazione OffertaLogica").trim() || "Redazione OffertaLogica";
    const root = document.createElement(href ? "a" : "span");
    root.className = "ol-card-author";
    if (href) {
      root.href = href;
      applyExternalLinkAttributes(root, href);
      root.setAttribute("aria-label", `Autore: ${name}`);
    }

    const avatar = document.createElement("span");
    avatar.className = "ol-card-author-avatar";
    const avatarUrl = isHttps(article?.author_avatar_url);
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      avatar.append(image);
    } else {
      avatar.textContent = (name.match(/[A-Za-zÀ-ÖØ-öø-ÿ0-9]/)?.[0] || "O").toUpperCase();
    }

    const label = document.createElement("span");
    label.textContent = name;
    root.append(avatar, label);
    return root;
  }

  function removeLegacyAuthor(card, article) {
    card.querySelector(".ol-featured-author")?.remove();
    const name = String(article?.author_display_name || "").trim();
    card.querySelectorAll(".ol-article-meta a").forEach((link) => {
      if (!name || link.textContent.trim() === name) link.remove();
    });
  }

  function addImage(card, article, articleHref, featured) {
    card.querySelector(".ol-archive-image-link")?.remove();
    const imageUrl = isHttps(article?.featured_image_url);
    card.classList.toggle("ol-article-item-has-image", Boolean(imageUrl));
    if (!imageUrl) return;

    const link = document.createElement("a");
    link.className = "ol-archive-image-link";
    link.href = articleHref;
    link.tabIndex = -1;
    link.setAttribute("aria-hidden", "true");

    const image = document.createElement("img");
    image.className = "ol-archive-image";
    image.src = imageUrl;
    image.alt = "";
    image.decoding = "async";
    image.loading = featured ? "eager" : "lazy";
    if (featured) image.fetchPriority = "high";
    link.append(image);
    card.prepend(link);
  }

  function decorateCard(card, article, featured = false) {
    if (!card || !article) return;
    const titleLink = card.querySelector("h3 a");
    const articleHref = titleLink?.getAttribute("href") || (article.slug ? `/articolo.html?slug=${encodeURIComponent(article.slug)}` : "/articoli.html");

    addImage(card, article, articleHref, featured);
    removeLegacyAuthor(card, article);

    card.querySelector(".ol-card-author-row")?.remove();
    const authorRow = document.createElement("div");
    authorRow.className = "ol-card-author-row";
    authorRow.append(makeAuthor(article));
    card.append(authorRow);

    card.dataset.informaEnhanced = VERSION;
  }

  async function fetchArticles() {
    if (!/^https:\/\//i.test(supabaseUrl) || supabaseKey.length < 20) return [];
    const endpoint = `${supabaseUrl}/rest/v1/editorial_public_articles?select=${encodeURIComponent(select)}&order=published_at.desc&limit=100`;
    const response = await fetch(endpoint, {
      headers: { apikey: supabaseKey, Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload : [];
  }

  function enhanceWhenReady(articles) {
    if (!articles.length) return;
    const featuredContainer = document.querySelector("[data-article-featured]");
    const archiveContainer = document.querySelector("[data-article-list]");
    if (!featuredContainer || !archiveContainer) return;

    const apply = () => {
      const featuredCard = featuredContainer.querySelector(".ol-article-item-featured");
      const archiveCards = [...archiveContainer.querySelectorAll(".ol-article-item")];
      if (!featuredCard) return false;
      decorateCard(featuredCard, articles[0], true);
      archiveCards.forEach((card, index) => decorateCard(card, articles[index + 1], false));
      return true;
    };

    if (apply()) return;
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect();
    });
    observer.observe(featuredContainer, { childList: true, subtree: true });
    observer.observe(archiveContainer, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 12000);
  }

  async function init() {
    try {
      const articles = await fetchArticles();
      enhanceWhenReady(articles);
    } catch {
      // La pagina resta pienamente utilizzabile anche se l'arricchimento visuale non riesce.
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
