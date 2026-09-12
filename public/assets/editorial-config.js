(() => {
  "use strict";

  const VERSION = "0.10.9";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const SUPABASE_URL = "https://kzxdamhfmzaxonpkytcf.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_poz1xBKiXceLCFV3u_tPIg_5_-ycHcl";

  window.OFFERTALOGICA_EDITORIAL_CONFIG = Object.freeze({
    version: VERSION,
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY
  });

  if (typeof window.fetch !== "function" || typeof window.sessionStorage === "undefined") return;

  const nativeFetch = window.fetch.bind(window);
  const nativeGetItem = Storage.prototype.getItem;
  const nativeSetItem = Storage.prototype.setItem;
  let lastAuthSession = null;
  let refreshPromise = null;

  function readSession() {
    try {
      const raw = nativeGetItem.call(window.sessionStorage, SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function computeExpiresAt(payload, fallback = null) {
    const direct = Number(payload?.expires_at || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const expiresIn = Number(payload?.expires_in || 0);
    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      return Math.floor(Date.now() / 1000) + expiresIn;
    }
    const previous = Number(fallback || 0);
    return Number.isFinite(previous) && previous > 0 ? previous : null;
  }

  function normalizeAuthSession(payload, previous = {}) {
    return {
      ...previous,
      access_token: payload?.access_token || previous?.access_token || "",
      refresh_token: payload?.refresh_token || previous?.refresh_token || "",
      expires_at: computeExpiresAt(payload, previous?.expires_at),
      user: payload?.user || previous?.user || null
    };
  }

  function persistAuthSession(payload) {
    if (!payload?.access_token) return readSession();
    const previous = readSession() || lastAuthSession || {};
    const merged = normalizeAuthSession(payload, previous);
    lastAuthSession = merged;
    try {
      nativeSetItem.call(window.sessionStorage, SESSION_KEY, JSON.stringify(merged));
    } catch {
      // Se sessionStorage non è disponibile, il pannello continuerà con la sessione in memoria.
    }
    return merged;
  }

  // editorial.js salva una sessione ridotta. Manteniamo il refresh_token ottenuto
  // dall'autenticazione senza modificare il resto del codice editoriale.
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    if (this === window.sessionStorage && key === SESSION_KEY) {
      try {
        const incoming = JSON.parse(String(value));
        if (incoming && typeof incoming === "object") {
          const current = readSession() || {};
          const source = lastAuthSession || current;
          if (!incoming.refresh_token && source?.refresh_token) incoming.refresh_token = source.refresh_token;
          if (!incoming.expires_at && source?.expires_at) incoming.expires_at = source.expires_at;
          value = JSON.stringify(incoming);
        }
      } catch {
        // Manteniamo il comportamento nativo se il valore non è JSON valido.
      }
    }
    return nativeSetItem.call(this, key, value);
  };

  // I callback email Supabase possono riportare i token nell'hash URL.
  // Li conserviamo in memoria così il primo sessionWrite non perde il refresh_token.
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token") || "";
    const refreshToken = hash.get("refresh_token") || "";
    if (accessToken || refreshToken) {
      lastAuthSession = normalizeAuthSession({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Number(hash.get("expires_at") || 0) || null,
        expires_in: Number(hash.get("expires_in") || 0) || null
      }, readSession() || {});
    }
  } catch {
    // Nessun token da recuperare dall'URL.
  }

  function requestUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.href;
      if (input && typeof input.url === "string") return input.url;
    } catch {
      return "";
    }
    return "";
  }

  function isEditorialSupabaseRequest(url) {
    if (!url.startsWith(SUPABASE_URL)) return false;
    return url.includes("/rest/v1/") || url.includes("/storage/v1/") || url.includes("/auth/v1/user");
  }

  function isAuthSessionResponse(url) {
    if (!url.startsWith(SUPABASE_URL)) return false;
    return url.includes("/auth/v1/token?grant_type=password") || url.includes("/auth/v1/signup");
  }

  function expiresSoon(session) {
    const expiresAt = Number(session?.expires_at || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
    return expiresAt <= Math.floor(Date.now() / 1000) + 60;
  }

  function withBearer(init = {}, token = "") {
    const headers = new Headers(init.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const current = readSession() || lastAuthSession || {};
    const refreshToken = current?.refresh_token || lastAuthSession?.refresh_token || "";
    if (!refreshToken) throw new Error("Sessione scaduta. Accedi di nuovo.");

    refreshPromise = (async () => {
      const response = await nativeFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.access_token) {
        const message = payload?.message || payload?.msg || payload?.error_description || payload?.error || "Sessione scaduta. Accedi di nuovo.";
        throw new Error(message);
      }
      return persistAuthSession(payload);
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  window.fetch = async function editorialFetch(input, init = {}) {
    const url = requestUrl(input);

    if (isAuthSessionResponse(url)) {
      const response = await nativeFetch(input, init);
      if (response.ok) {
        try {
          const payload = await response.clone().json();
          if (payload?.access_token) persistAuthSession(payload);
        } catch {
          // La risposta resta comunque disponibile al chiamante originale.
        }
      }
      return response;
    }

    if (!isEditorialSupabaseRequest(url)) return nativeFetch(input, init);

    let current = readSession() || lastAuthSession || null;
    if (current?.refresh_token && (!current?.access_token || expiresSoon(current))) {
      try {
        current = await refreshSession();
      } catch {
        // Se il refresh non riesce, lasciamo che Supabase restituisca l'errore reale.
      }
    }

    let response = await nativeFetch(input, withBearer(init, current?.access_token || ""));

    if (response.status === 401) {
      const retrySession = readSession() || lastAuthSession || null;
      if (retrySession?.refresh_token) {
        try {
          current = await refreshSession();
          response = await nativeFetch(input, withBearer(init, current?.access_token || ""));
        } catch {
          // Restituiamo la prima risposta 401: editorial.js mostrerà il messaggio all'utente.
        }
      }
    }

    return response;
  };
})();
