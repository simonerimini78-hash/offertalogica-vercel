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
  if (action !== "validate") {
    return json({ ok: false, error: "Azione non supportata in v0.12.1" }, 400);
  }

  const endpoint = new URL(`${INSTAGRAM_GRAPH}/${API_VERSION}/me`);
  endpoint.searchParams.set("fields", "id,username");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    return json({
      ok: false,
      error: "Impossibile contattare Instagram Graph API",
    }, 502);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const metaError = payload?.error || {};
    return json({
      ok: false,
      error: "Token Instagram non validato",
      meta: {
        type: metaError?.type || null,
        code: metaError?.code ?? null,
        subcode: metaError?.error_subcode ?? null,
        message: metaError?.message || null,
      },
    }, 502);
  }

  return json({
    ok: true,
    api_version: API_VERSION,
    instagram: {
      id: String(payload?.id || ""),
      username: String(payload?.username || ""),
    },
    next_step: "Token valido. La pubblicazione resta disattivata in questa versione.",
  });
});
