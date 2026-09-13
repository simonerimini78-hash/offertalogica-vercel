const API_VERSION = "v26.0";
const INSTAGRAM_GRAPH = "https://graph.instagram.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ ok: false, error: "Metodo non consentito" }, 405);

  const token = Deno.env.get("META_INSTAGRAM_ACCESS_TOKEN")?.trim() || "";
  if (!token) {
    return json({
      ok: false,
      error: "Secret META_INSTAGRAM_ACCESS_TOKEN non configurato",
    }, 500);
  }

  const body = await readJson(req);
  const action = String(body?.action || "validate").trim().toLowerCase();

  try {
    if (action === "validate") {
      const account = await identity(token);
      return json({
        ok: true,
        api_version: API_VERSION,
        instagram: account,
        next_step: "Token valido. Nessun contenuto pubblicato.",
      });
    }

    if (action === "prepare_test") {
      const imageUrl = String(body?.image_url || "").trim();
      const caption = String(body?.caption || "Test tecnico OffertaLogica Informa").trim().slice(0, 2200);

      let parsed: URL;
      try {
        parsed = new URL(imageUrl);
      } catch {
        return json({ ok: false, error: "image_url non valido" }, 400);
      }
      if (parsed.protocol !== "https:") {
        return json({ ok: false, error: "image_url deve usare https://" }, 400);
      }

      const account = await identity(token);
      const endpoint = `${INSTAGRAM_GRAPH}/${API_VERSION}/${encodeURIComponent(account.id)}/media`;
      const form = new URLSearchParams();
      form.set("image_url", imageUrl);
      form.set("caption", caption);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.id) {
        return json({
          ok: false,
          error: "Impossibile creare il contenitore Instagram di test",
          meta: metaError(payload),
        }, 502);
      }

      return json({
        ok: true,
        instagram: account,
        container_id: String(payload.id),
        published: false,
        next_step: "Contenitore creato ma NON pubblicato. Verifica lo stato con action=container_status.",
      });
    }

    if (action === "container_status") {
      const creationId = String(body?.creation_id || "").trim();
      if (!/^\d{6,40}$/.test(creationId)) {
        return json({ ok: false, error: "creation_id non valido" }, 400);
      }
      const { response, payload } = await instagramGet(token, encodeURIComponent(creationId), "id,status_code,status");
      if (!response.ok) {
        return json({
          ok: false,
          error: "Impossibile leggere lo stato del contenitore",
          meta: metaError(payload),
        }, 502);
      }
      return json({
        ok: true,
        container: {
          id: String(payload?.id || creationId),
          status_code: String(payload?.status_code || ""),
          status: String(payload?.status || ""),
        },
        published: false,
        next_step: payload?.status_code === "FINISHED"
          ? "Permesso di creazione contenuti confermato. La pubblicazione resta disattivata."
          : "Il contenitore non è ancora pronto: riprova lo stato tra poco.",
      });
    }

    return json({ ok: false, error: "Azione non supportata in v0.12.2" }, 400);
  } catch (error) {
    const err = error as any;
    return json({
      ok: false,
      error: err?.message || "Errore Instagram",
      meta: err?.meta || null,
    }, Number(err?.status || 500));
  }
});
