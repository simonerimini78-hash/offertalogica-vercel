(() => {
  "use strict";

  const RELEASE = "0.36.67";
  const TIME_ZONE = "Europe/Rome";
  const PRODUCT_CATALOG = Object.freeze({
    site_free_consumer: Object.freeze({ channel: "site", customerSegment: "consumer", productFamily: "site_free", enabled: true }),
    site_free_business: Object.freeze({ channel: "site", customerSegment: "business", productFamily: "site_free", enabled: true }),
    premium_casa: Object.freeze({ channel: "premium", customerSegment: "consumer", productFamily: "premium", enabled: true }),
    premium_business: Object.freeze({ channel: "premium", customerSegment: "business", productFamily: "premium", enabled: false }),
  });

  const monthFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  });

  function currentMonthKey(value = new Date()) {
    const parts = monthFormatter.formatToParts(value);
    const year = parts.find(part => part.type === "year")?.value || "";
    const month = parts.find(part => part.type === "month")?.value || "";
    return /^\d{4}$/.test(year) && /^\d{2}$/.test(month) ? `${year}-${month}` : "";
  }

  function normalizeMonthKey(value) {
    const key = String(value || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return "";
    return key;
  }

  function monthPeriod(monthKey = currentMonthKey()) {
    const month = normalizeMonthKey(monthKey) || currentMonthKey();
    return Object.freeze({ mode: "month", month, timeZone: TIME_ZONE });
  }

  function normalizeDimensions(input = {}) {
    const explicitProduct = String(input.productCode || input.product_code || "").trim().toLowerCase();
    if (explicitProduct && PRODUCT_CATALOG[explicitProduct]) {
      return Object.freeze({ productCode: explicitProduct, ...PRODUCT_CATALOG[explicitProduct] });
    }

    const channel = String(input.channel || "").trim().toLowerCase();
    const customerSegment = String(input.customerSegment || input.customer_segment || "").trim().toLowerCase();
    if (channel === "site" && customerSegment === "business") return Object.freeze({ productCode: "site_free_business", ...PRODUCT_CATALOG.site_free_business });
    if (channel === "site") return Object.freeze({ productCode: "site_free_consumer", ...PRODUCT_CATALOG.site_free_consumer });
    if (channel === "premium" && customerSegment === "business") return Object.freeze({ productCode: "premium_business", ...PRODUCT_CATALOG.premium_business });
    if (channel === "premium") return Object.freeze({ productCode: "premium_casa", ...PRODUCT_CATALOG.premium_casa });
    return Object.freeze({ productCode: "", channel: channel || "unknown", customerSegment: customerSegment || "unknown", productFamily: "unknown", enabled: false });
  }

  function syncVisibleRelease() {
    document.querySelectorAll(".brand p,.version").forEach(element => {
      const current = String(element.textContent || "");
      if (/v\d+\.\d+\.\d+/.test(current)) element.textContent = current.replace(/v\d+\.\d+\.\d+/g, `v${RELEASE}`);
    });
  }

  async function remoteRelease() {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return "";
    const payload = await response.json().catch(() => ({}));
    return String(payload?.version || "").trim();
  }

  function guardLegacyReleaseNotice() {
    const notice = document.getElementById("staffUpdateNotice");
    const button = document.getElementById("staffApplyUpdate");
    if (!notice) return;

    let checking = false;
    const reconcile = async () => {
      if (checking || !notice.classList.contains("show")) return;
      checking = true;
      try {
        const latest = await remoteRelease();
        // staff.html v0.36.64 contiene il primo updater. Finché non viene sostituito,
        // questa guardia elimina solo il falso positivo dovuto a quel numero statico.
        // Se version.json è realmente più nuovo di questo modulo, il pulsante resta visibile.
        if (latest && latest === RELEASE) {
          notice.classList.remove("show");
          if (button) {
            button.hidden = true;
            button.disabled = false;
          }
        }
      } catch {
        // Nessuna alterazione: in caso di dubbio conserviamo l'avviso di aggiornamento.
      } finally {
        checking = false;
      }
    };

    const observer = new MutationObserver(() => { void reconcile(); });
    observer.observe(notice, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    void reconcile();
  }

  const api = Object.freeze({
    release: RELEASE,
    timeZone: TIME_ZONE,
    productCatalog: PRODUCT_CATALOG,
    currentMonthKey,
    normalizeMonthKey,
    monthPeriod,
    normalizeDimensions,
  });

  window.OffertaLogicaStaffManagement = api;
  syncVisibleRelease();
  guardLegacyReleaseNotice();
  window.dispatchEvent(new CustomEvent("offertalogica:staff-management-ready", { detail: { release: RELEASE, timeZone: TIME_ZONE } }));
})();
