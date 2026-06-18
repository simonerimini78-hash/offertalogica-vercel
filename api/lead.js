import { createId } from "@paralleldrive/cuid2";
import { clientIp, json, method, readJson } from "../lib/http.js";
import { setJson } from "../lib/store.js";
import { sanitizeLead } from "../lib/validation.js";

export default async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;

  try {
    const body = await readJson(req);
    const lead = sanitizeLead(body);
    const id = createId();
    const retentionDays = Number(process.env.LEAD_RETENTION_DAYS || 30);
    const createdAt = new Date().toISOString();
    const privacyVersion = String(body.privacyVersion || "privacy-lead-v1").slice(0, 80);
    const clientProof = body.consentProof && typeof body.consentProof === "object" ? body.consentProof : {};
    const record = {
      id,
      ...lead,
      status: "pending_otp",
      calculation: body.calculation || null,

