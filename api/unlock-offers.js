import { json, method, readJson, requireAllowedOrigin } from "../lib/http.js";
import { getJson } from "../lib/store.js";
import { enforceRateLimit, rateLimitConfig } from "../lib/rateLimit.js";

const PVGIS_BASE = "https://re.jrc.ec.europa.eu/api/v5_3";
const PVGIS_TIMEOUT_MS = 11_000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function pvgisJson(tool, params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PVGIS_TIMEOUT_MS);
  try {
    const response = await fetch(`${PVGIS_BASE}/${tool}?${search.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "OffertaLogica-PV/1.3" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`pvgis_http_${response.status}`);
    const payload = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("pvgis_invalid_json");
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function normalizedDailyProfiles(payload) {
  const rows = Array.isArray(payload?.outputs?.daily_profile) ? payload.outputs.daily_profile : [];
  const grouped = new Map();
  rows.forEach((row) => {
    const month = Number(row?.month);
    const time = String(row?.time || "");
    const hour = Number.parseInt(time.slice(0, 2), 10);
    const irradiation = finite(row?.["G(i)"]);
    if (!(month >= 1 && month <= 12) || !(hour >= 0 && hour <= 23) || irradiation === null || irradiation < 0) return;
    if (!grouped.has(month)) grouped.set(month, Array(24).fill(0));
    grouped.get(month)[hour] = irradiation;
  });
  const result = {};
  for (let month = 1; month <= 12; month++) {
    const values = grouped.get(month);
    if (!values) continue;
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total <= 0) continue;
    result[String(month)] = values.map((value) => value / total);
  }
  return result;
}

async function handlePvEstimate(req, res, body) {
  if (!(await enforceRateLimit(req, res, { label: "pv-estimate", ...rateLimitConfig("PV_ESTIMATE", 40, 3600) }))) return;

  const lat = finite(body.lat);
  const lon = finite(body.lon);
  const powerKw = finite(body.powerKw);
  const customerType = body.customerType === "business" ? "business" : "consumer";
  const maxPower = customerType === "business" ? 1000 : 50;
  if (lat === null || lon === null || lat < 35 || lat > 48 || lon < 5 || lon > 20) {
    return json(res, 400, { ok: false, error: "Localita non valida per la simulazione italiana" });
  }
  if (powerKw === null || powerKw < 1 || powerKw > maxPower) {
    return json(res, 400, { ok: false, error: "Potenza fotovoltaica non valida" });
  }

  const requestedAngle = finite(body.angle);
  const requestedAspect = finite(body.aspect);
  const fixedAngles = requestedAngle !== null && requestedAspect !== null
    && requestedAngle >= 0 && requestedAngle <= 90
    && requestedAspect >= -180 && requestedAspect <= 180;

  try {
    const pvParams = {
      lat,
      lon,
      peakpower: powerKw,
      loss: 14,
      pvtechchoice: "crystSi2025",
      mountingplace: "free",
      usehorizon: 1,
      outputformat: "json",
      ...(fixedAngles ? { angle: requestedAngle, aspect: requestedAspect } : { optimalangles: 1 }),
    };
    const pv = await pvgisJson("PVcalc", pvParams);
    const monthlyRaw = Array.isArray(pv?.outputs?.monthly?.fixed) ? pv.outputs.monthly.fixed : [];
    const annualKwh = finite(pv?.outputs?.totals?.fixed?.E_y);
    const slope = finite(pv?.inputs?.mounting_system?.fixed?.slope?.value);
    const azimuth = finite(pv?.inputs?.mounting_system?.fixed?.azimuth?.value);
    if (annualKwh === null || monthlyRaw.length !== 12 || slope === null || azimuth === null) throw new Error("pvgis_missing_pv_output");

    const monthly = monthlyRaw.map((row) => ({ month: Number(row.month), kwh: finite(row.E_m) || 0, variabilityKwh: finite(row.SD_m) }));
    let dailyProfiles = {};
    try {
      const daily = await pvgisJson("DRcalc", {
        lat,
        lon,
        month: 0,
        global: 1,
        localtime: 1,
        angle: slope,
        aspect: azimuth,
        outputformat: "json",
      });
      dailyProfiles = normalizedDailyProfiles(daily);
    } catch (profileError) {
      console.warn("pvgis_daily_profile_failed", String(profileError?.message || profileError).slice(0, 180));
    }

    const profileAvailable = Object.keys(dailyProfiles).length === 12;
    const meteo = pv?.inputs?.meteo_data || {};
    return json(res, 200, {
      ok: true,
      source: "PVGIS 5.3 - Joint Research Centre, European Commission",
      annualKwh,
      monthly,
      dailyProfiles,
      profileAvailable,
      slope,
      azimuth,
      optimizedAngles: !fixedAngles,
      systemLossPct: 14,
      pvTechnology: "crystSi2025",
      radiationDb: String(meteo.radiation_db || ""),
      yearMin: finite(meteo.year_min),
      yearMax: finite(meteo.year_max),
    });
  } catch (error) {
    console.error("pv_estimate_failed", { message: String(error?.message || error).slice(0, 220) });
    return json(res, 502, { ok: false, error: "Dati PVGIS temporaneamente non disponibili. Riprova piu tardi." });
  }
}

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  if (!requireAllowedOrigin(req, res)) return;

  try {
    const body = await readJson(req);
    if (body?.action === "pv_estimate") return handlePvEstimate(req, res, body);

    const leadId = body?.leadId;
    const lead = await getJson(`lead:${leadId}`);
    if (!lead) return json(res, 404, { ok: false, error: "Lead non trovato" });
    if (lead.status !== "verified") return json(res, 403, { ok: false, error: "Lead non verificato" });

    json(res, 200, {
      ok: true,
      unlocked: true,
      message: "Lead verificato: il frontend puo mostrare le offerte complete.",
    });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message || "Errore sblocco offerte" });
  }
}
