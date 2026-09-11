(() => {
  "use strict";

  const EDITORIAL_VERSION = "0.1.0";
  const STATUSES = new Set(["draft", "in_review", "changes_requested", "approved", "published", "archived"]);

  function normalizeSlug(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function text(value, max = 5000) {
    return String(value || "").trim().slice(0, max);
  }

  function setStatusBadge(element, status) {
    if (!element) return;
    const safeStatus = STATUSES.has(status) ? status : "draft";
    const labels = {
      draft: "Bozza",
      in_review: "In revisione",
      changes_requested: "Modifiche richieste",
      approved: "Approvato",
      published: "Pubblicato",
      archived: "Archiviato",
    };
    element.dataset.status = safeStatus;
    element.textContent = labels[safeStatus];
  }

  function initCounters(root = document) {
    root.querySelectorAll("[data-count-for]").forEach((counter) => {
      const id = counter.getAttribute("data-count-for");
      const field = id ? root.getElementById(id) : null;
      if (!field) return;
      const max = Number(field.getAttribute("maxlength") || 0);
      const update = () => {
        counter.textContent = max > 0 ? `${field.value.length}/${max}` : String(field.value.length);
      };
      field.addEventListener("input", update);
      update();
    });
  }

  function initWorkspace() {
    const form = document.querySelector("[data-editorial-form]");
    if (!form) return;

    const title = form.querySelector("#article-title");
    const slug = form.querySelector("#article-slug");
    const statusInput = form.querySelector("#article-status");
    const statusBadge = document.querySelector("[data-current-status]");
    const saveButton = form.querySelector("[data-save-draft]");
    const reviewButton = form.querySelector("[data-send-review]");
    const backendNotice = document.querySelector("[data-backend-notice]");
    let slugTouched = false;
    let dirty = false;

    if (title && slug) {
      slug.addEventListener("input", () => {
        slugTouched = true;
        slug.value = normalizeSlug(slug.value);
        dirty = true;
      });
      title.addEventListener("input", () => {
        if (!slugTouched) slug.value = normalizeSlug(title.value);
        dirty = true;
      });
    }

    form.querySelectorAll("input, textarea, select").forEach((field) => {
      field.addEventListener("change", () => { dirty = true; });
      field.addEventListener("input", () => { dirty = true; });
    });

    const status = STATUSES.has(statusInput?.value) ? statusInput.value : "draft";
    setStatusBadge(statusBadge, status);

    function validateForReview() {
      const required = [
        ["article-title", "Titolo"],
        ["article-excerpt", "Sommario"],
        ["article-content", "Contenuto"],
      ];
      const missing = required
        .filter(([id]) => !text(document.getElementById(id)?.value))
        .map(([, label]) => label);
      return missing;
    }

    if (saveButton) {
      saveButton.addEventListener("click", () => {
        if (backendNotice) backendNotice.hidden = false;
      });
    }

    if (reviewButton) {
      reviewButton.addEventListener("click", () => {
        const missing = validateForReview();
        const validation = document.querySelector("[data-validation-message]");
        if (missing.length) {
          if (validation) {
            validation.hidden = false;
            validation.textContent = `Completa prima: ${missing.join(", ")}.`;
          }
          return;
        }
        if (validation) validation.hidden = true;
        if (backendNotice) backendNotice.hidden = false;
      });
    }

    form.addEventListener("submit", (event) => event.preventDefault());
    window.addEventListener("beforeunload", (event) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function initPublicArchive() {
    const container = document.querySelector("[data-article-list]");
    if (!container) return;
    // Il collegamento ai dati viene attivato solo dopo configurazione Supabase + RLS.
    container.dataset.editorialReady = "false";
  }

  function initArticlePage() {
    const slugNode = document.querySelector("[data-requested-slug]");
    if (!slugNode) return;
    const params = new URLSearchParams(window.location.search);
    const slug = normalizeSlug(params.get("slug") || "");
    slugNode.textContent = slug || "non specificato";
  }

  document.documentElement.dataset.editorialVersion = EDITORIAL_VERSION;
  initCounters();

  const view = document.body?.dataset?.editorialView || "";
  if (view === "workspace") initWorkspace();
  if (view === "archive") initPublicArchive();
  if (view === "article") initArticlePage();
})();
