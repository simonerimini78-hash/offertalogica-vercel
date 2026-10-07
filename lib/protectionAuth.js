import crypto from "node:crypto";

const SESSION_VERSION = 1;
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_REDIRECT_URL = "https://offertalogica.it/protezione-accesso.html";

function protectionConfig() {
  const url = String(process.env.PROTECTION_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const publishableKey = String(process.env.PROTECTION_SUPABASE_PUBLISHABLE_KEY || "").trim();
  const secretKey = String(process.env.PROTECTION_SUPABASE_SECRET_KEY || "").trim();
  if (!url || !publishableKey || !secretKey) throw new Error("protection_supabase_not_configured");
  return { url, publishableKey, secretKey };
}

function protectionSessionSecret() {
  const secret = String(process.env.PROTECTION_SESSION_SECRET || "").trim();
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("protection_session_secret_not_configured");
  return secret;
}

function protectionSessionTtlSeconds() {
  const parsed = Number(process.env.PROTECTION_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_TTL_SECONDS;
  return Math.max(3600, Math.min(90 * 24 * 60 * 60, Math.floor(parsed)));
}

function protectionCookieName() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production"
    ? "__Host-ol_protection_session"
    : "ol_protection_session";
}

function parseCookies(req) {
  const raw = String(req?.headers?.cookie || "");
  const cookies = new Map();
  raw.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies.set(key, value);
  });
  return cookies;
}

function sessionKey() {
  return crypto.createHash("sha256").update(protectionSessionSecret(), "utf8").digest();
}

function encryptSession(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey(), iv);
  cipher.setAAD(Buffer.from("offertalogica-protection-session:v1", "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ v: SESSION_VERSION, ...payload }), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSession(token) {
  const [version, ivPart, tagPart, encryptedPart, extra] = String(token || "").split(".");
  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart || extra) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey(), Buffer.from(ivPart, "base64url"));
    decipher.setAAD(Buffer.from("offertalogica-protection-session:v1", "utf8"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(decrypted);
    if (payload?.v !== SESSION_VERSION) return null;
    if (!payload.accessToken || !payload.refreshToken) return null;
    return payload;
  } catch {
    return null;
  }
}

function isLegacyJwtKey(key) {
  return String(key || "").split(".").length === 3;
}

function authHeaders(apiKey, bearer = "") {
  const headers = {
    apikey: apiKey,
    "Content-Type": "application/json",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}

function secretHeaders(prefer = "return=representation") {
  const { secretKey } = protectionConfig();
  const headers = {
    apikey: secretKey,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
  if (isLegacyJwtKey(secretKey)) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function authError(payload, fallback) {
  return String(payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback || "auth_error").slice(0, 240);
}

export function protectionRedirectUrl() {
  return String(process.env.PROTECTION_EMAIL_REDIRECT_URL || DEFAULT_REDIRECT_URL).trim() || DEFAULT_REDIRECT_URL;
}

export async function protectionLookupUserId(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase().slice(0, 160);
  if (!normalizedEmail) throw new Error("protection_lookup_email_required");
  const { url } = protectionConfig();
  const response = await fetch(`${url}/rest/v1/rpc/protection_lookup_user_id`, {
    method: "POST",
    headers: secretHeaders("return=representation"),
    body: JSON.stringify({ p_email: normalizedEmail }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(authError(payload, `protection_lookup_user_${response.status}`));
  }
  const value = Array.isArray(payload) ? payload[0] : payload;
  const userId = typeof value === "string" ? value.trim() : String(value?.protection_lookup_user_id || value?.id || "").trim();
  return /^[0-9a-f-]{36}$/i.test(userId) ? userId : null;
}

export async function protectionSignUp({ email, password }) {
  const { url, publishableKey } = protectionConfig();
  const redirectTo = protectionRedirectUrl();
  const endpoint = `${url}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(publishableKey),
    body: JSON.stringify({
      email,
      password,
      data: { ol_account: "protection" },
    }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const error = new Error(authError(payload, `signup_error_${response.status}`));
    error.status = response.status;
    error.code = String(payload?.code || payload?.error_code || "").trim().toLowerCase();
    throw error;
  }
  const identities = Array.isArray(payload?.user?.identities) ? payload.user.identities : null;
  return {
    ...payload,
    existingAccount: Boolean(payload?.user?.id && identities && identities.length === 0),
  };
}

export async function protectionSignIn({ email, password }) {
  const { url, publishableKey } = protectionConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(publishableKey),
    body: JSON.stringify({ email, password }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const error = new Error(authError(payload, `signin_error_${response.status}`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function protectionUserFromAccessToken(accessToken) {
  const { url, publishableKey } = protectionConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "GET",
    headers: authHeaders(publishableKey, accessToken),
  });
  const payload = await responsePayload(response);
  if (!response.ok || !payload?.id) {
    const error = new Error(authError(payload, `user_error_${response.status}`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function protectionRefresh(refreshToken) {
  const { url, publishableKey } = protectionConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: authHeaders(publishableKey),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const payload = await responsePayload(response);
  if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
    const error = new Error(authError(payload, `refresh_error_${response.status}`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function setProtectionSessionCookie(res, session = {}) {
  const accessToken = String(session.access_token || session.accessToken || "").trim();
  const refreshToken = String(session.refresh_token || session.refreshToken || "").trim();
  if (!accessToken || !refreshToken) throw new Error("protection_session_tokens_missing");
  const expiresIn = Math.max(60, Number(session.expires_in || session.expiresIn || 3600) || 3600);
  const suppliedExpiresAt = Number(session.expires_at || session.expiresAt || 0);
  const expiresAt = suppliedExpiresAt > 10_000_000_000
    ? suppliedExpiresAt
    : suppliedExpiresAt > 1_000_000_000
      ? suppliedExpiresAt * 1000
      : Date.now() + expiresIn * 1000;
  const token = encryptSession({ accessToken, refreshToken, expiresAt });
  const secure = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const ttlSeconds = protectionSessionTtlSeconds();
  const attributes = [
    `${protectionCookieName()}=${token}`,
    "Path=/",
    `Max-Age=${ttlSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ];
  res.setHeader("Set-Cookie", attributes.join("; "));
  return ttlSeconds;
}

export function clearProtectionSessionCookie(res) {
  const secure = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
  const attributes = [
    `${protectionCookieName()}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ];
  res.setHeader("Set-Cookie", attributes.join("; "));
}

export async function protectionUserFromRequest(req, res) {
  const raw = parseCookies(req).get(protectionCookieName()) || "";
  if (!raw) return null;
  let session;
  try {
    session = decryptSession(raw);
  } catch {
    session = null;
  }
  if (!session) {
    clearProtectionSessionCookie(res);
    return null;
  }

  let current = session;
  const shouldRefresh = !Number.isFinite(Number(current.expiresAt)) || Number(current.expiresAt) <= Date.now() + 90_000;
  try {
    if (shouldRefresh) {
      const refreshed = await protectionRefresh(current.refreshToken);
      setProtectionSessionCookie(res, refreshed);
      current = {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        expiresAt: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000,
      };
    }
    const user = await protectionUserFromAccessToken(current.accessToken);
    return { user, accessToken: current.accessToken, refreshToken: current.refreshToken };
  } catch {
    try {
      const refreshed = await protectionRefresh(current.refreshToken);
      setProtectionSessionCookie(res, refreshed);
      const user = await protectionUserFromAccessToken(refreshed.access_token);
      return { user, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token };
    } catch {
      clearProtectionSessionCookie(res);
      return null;
    }
  }
}

function queryUrl(table, params) {
  const { url } = protectionConfig();
  return `${url}/rest/v1/${table}?${params.toString()}`;
}

async function readOneWithSecret(table, params) {
  const response = await fetch(queryUrl(table, params), {
    method: "GET",
    headers: secretHeaders("return=representation"),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(`protection_db_read_${table}_${response.status}`);
  return Array.isArray(payload) ? payload[0] || null : null;
}

async function readManyWithSecret(table, params) {
  const response = await fetch(queryUrl(table, params), {
    method: "GET",
    headers: secretHeaders("return=representation"),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(`protection_db_read_${table}_${response.status}`);
  return Array.isArray(payload) ? payload : [];
}

async function insertWithSecret(table, row) {
  const { url } = protectionConfig();
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: secretHeaders("return=minimal"),
    body: JSON.stringify(row),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(authError(payload, `protection_db_insert_${table}_${response.status}`));
  return true;
}

async function latestNewsletterConsent(userId) {
  const params = new URLSearchParams({
    select: "action,policy_version,created_at",
    user_id: `eq.${userId}`,
    consent_type: "eq.newsletter",
    order: "created_at.desc",
    limit: "1",
  });
  return readOneWithSecret("protection_consents", params);
}

export async function protectionContactRequests(userId, limit = 20) {
  const normalizedUserId = String(userId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalizedUserId)) throw new Error("protection_user_id_invalid");
  const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const params = new URLSearchParams({
    select: "id,request_type,service_key,service_name,partner_key,partner_name,source,source_reference,contact_actor,status,requested_at,closed_at,revoked_at,updated_at",
    user_id: `eq.${normalizedUserId}`,
    order: "requested_at.desc",
    limit: String(boundedLimit),
  });
  return readManyWithSecret("protection_contact_requests", params);
}


export async function protectionIsActive(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalizedUserId)) throw new Error("protection_user_id_invalid");
  const params = new URLSearchParams({
    select: "protection_active",
    user_id: `eq.${normalizedUserId}`,
    limit: "1",
  });
  const profile = await readOneWithSecret("protection_profiles", params);
  return Boolean(profile?.protection_active);
}

export async function protectionState(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalizedUserId)) throw new Error("protection_user_id_invalid");

  const profileParams = new URLSearchParams({
    select: "user_id,protection_active,protection_activated_at,created_at,updated_at",
    user_id: `eq.${normalizedUserId}`,
    limit: "1",
  });
  const phoneParams = new URLSearchParams({
    select: "phone_e164,verified_at,is_primary",
    user_id: `eq.${normalizedUserId}`,
    order: "is_primary.desc,verified_at.desc",
    limit: "1",
  });
  const [profile, phone, newsletter, contactRequests] = await Promise.all([
    readOneWithSecret("protection_profiles", profileParams),
    readOneWithSecret("protection_phone_verifications", phoneParams),
    latestNewsletterConsent(normalizedUserId),
    protectionContactRequests(normalizedUserId, 20),
  ]);
  return {
    active: Boolean(profile?.protection_active),
    activatedAt: profile?.protection_activated_at || null,
    phoneVerified: Boolean(phone?.verified_at),
    phone: phone?.phone_e164 || "",
    phoneVerifiedAt: phone?.verified_at || null,
    newsletterEnabled: newsletter?.action === "granted",
    newsletterUpdatedAt: newsletter?.created_at || null,
    activeContactRequests: contactRequests.filter((item) => item?.status === "active").length,
    contactRequests,
  };
}

export function maskPhone(phone) {
  const value = String(phone || "").trim();
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "••••";
  return `${value.startsWith("+") ? "+" : ""}${digits.slice(0, 3)}••••${digits.slice(-3)}`;
}

export async function protectionRecordVerifiedPhone({ userId, phone, method = "otp" }) {
  const { url } = protectionConfig();
  const response = await fetch(`${url}/rest/v1/rpc/protection_record_verified_phone`, {
    method: "POST",
    headers: secretHeaders("return=minimal"),
    body: JSON.stringify({
      p_user_id: userId,
      p_phone_e164: phone,
      p_method: method,
    }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(authError(payload, `protection_phone_rpc_${response.status}`));
  return true;
}

export async function protectionSetNewsletter({ userId, enabled }) {
  const normalizedUserId = String(userId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalizedUserId)) throw new Error("protection_user_id_invalid");
  const desiredAction = enabled ? "granted" : "revoked";
  const current = await latestNewsletterConsent(normalizedUserId);
  if (current?.action === desiredAction) {
    return { enabled: desiredAction === "granted", changed: false, updatedAt: current.created_at || null };
  }
  const policyVersion = String(process.env.PROTECTION_NEWSLETTER_POLICY_VERSION || "newsletter-energy-v1")
    .trim()
    .slice(0, 80) || "newsletter-energy-v1";
  const createdAt = new Date().toISOString();
  await insertWithSecret("protection_consents", {
    user_id: normalizedUserId,
    consent_type: "newsletter",
    action: desiredAction,
    policy_version: policyVersion,
    source: "protection_account",
    created_at: createdAt,
  });
  return { enabled: desiredAction === "granted", changed: true, updatedAt: createdAt };
}

export async function protectionRecordContactRequest({
  userId,
  requestType,
  serviceKey,
  serviceName,
  source,
  sourceReference = null,
  contactActor = "offertalogica",
  partnerKey = null,
  partnerName = null,
}) {
  const normalizedUserId = String(userId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalizedUserId)) throw new Error("protection_user_id_invalid");
  const { url } = protectionConfig();
  const response = await fetch(`${url}/rest/v1/rpc/protection_record_contact_request`, {
    method: "POST",
    headers: secretHeaders("return=representation"),
    body: JSON.stringify({
      p_user_id: normalizedUserId,
      p_request_type: String(requestType || "").trim(),
      p_service_key: String(serviceKey || "").trim(),
      p_service_name: String(serviceName || "").trim(),
      p_source: String(source || "").trim(),
      p_source_reference: sourceReference ? String(sourceReference).trim() : null,
      p_contact_actor: String(contactActor || "offertalogica").trim(),
      p_partner_key: partnerKey ? String(partnerKey).trim() : null,
      p_partner_name: partnerName ? String(partnerName).trim() : null,
    }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(authError(payload, `protection_contact_request_rpc_${response.status}`));
  const value = Array.isArray(payload) ? payload[0] : payload;
  return typeof value === "string" ? value : String(value?.protection_record_contact_request || value?.id || "");
}

export async function protectionRevokeContactRequest(accessToken, requestId) {
  const normalizedId = String(requestId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalizedId)) throw new Error("protection_contact_request_invalid");
  const { url, publishableKey } = protectionConfig();
  const response = await fetch(`${url}/rest/v1/rpc/protection_revoke_contact_request`, {
    method: "POST",
    headers: {
      ...authHeaders(publishableKey, accessToken),
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ p_request_id: normalizedId }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(authError(payload, `protection_contact_revoke_rpc_${response.status}`));
  return true;
}

export async function protectionFindPartnerByProvider(provider) {
  const raw = String(provider || "").trim();
  if (!raw) return null;
  const compact = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const slug = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const candidates = [...new Set([raw.toLowerCase(), compact, slug].filter(Boolean))];
  for (const candidate of candidates) {
    const params = new URLSearchParams({
      select: "partner_key,partner_name,relationship_type,ol_lead_contact_allowed",
      partner_key: `eq.${candidate}`,
      active: "eq.true",
      ol_lead_contact_allowed: "eq.true",
      limit: "1",
    });
    const found = await readOneWithSecret("protection_partners", params);
    if (found) return found;
  }
  const byName = new URLSearchParams({
    select: "partner_key,partner_name,relationship_type,ol_lead_contact_allowed",
    partner_name: `ilike.${raw}`,
    active: "eq.true",
    ol_lead_contact_allowed: "eq.true",
    limit: "1",
  });
  return readOneWithSecret("protection_partners", byName);
}


function protectionRowCurrentlyValid(row) {
  const now = Date.now();
  const from = row?.valid_from ? Date.parse(row.valid_from) : NaN;
  const until = row?.valid_until ? Date.parse(row.valid_until) : NaN;
  if (Number.isFinite(from) && from > now) return false;
  if (Number.isFinite(until) && until < now) return false;
  return true;
}

function protectionCompactKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 160);
}

export async function protectionLookupCallerContext({ phone, userId = null }) {
  const normalizedPhone = String(phone || "").trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalizedPhone)) throw new Error("protection_lookup_phone_invalid");

  const supplierParams = new URLSearchParams({
    select: "id,supplier_key,supplier_name,phone_e164,phone_label,number_type,source_type,last_verified_at,valid_from,valid_until",
    phone_e164: `eq.${normalizedPhone}`,
    active: "eq.true",
    verification_status: "eq.verified",
    limit: "10",
  });
  const supplierRows = (await readManyWithSecret("protection_supplier_numbers", supplierParams))
    .filter(protectionRowCurrentlyValid);

  const normalizedUserId = String(userId || "").trim();
  const contactRequests = /^[0-9a-f-]{36}$/i.test(normalizedUserId)
    ? (await protectionContactRequests(normalizedUserId, 50)).filter((item) => item?.status === "active")
    : [];

  const matches = [];
  for (const supplier of supplierRows) {
    const relationParams = new URLSearchParams({
      select: "partner_id,contact_scope,contact_role,ol_status,valid_from,valid_until,verified_at",
      supplier_number_id: `eq.${supplier.id}`,
      active: "eq.true",
      ol_status: "eq.verified",
      limit: "10",
    });
    const relations = (await readManyWithSecret("protection_partner_numbers", relationParams))
      .filter(protectionRowCurrentlyValid);

    const olChannels = [];
    for (const relation of relations) {
      const partnerParams = new URLSearchParams({
        select: "id,partner_key,partner_name,relationship_type,ol_lead_contact_allowed,valid_from,valid_until",
        id: `eq.${relation.partner_id}`,
        active: "eq.true",
        ol_lead_contact_allowed: "eq.true",
        limit: "1",
      });
      const partner = await readOneWithSecret("protection_partners", partnerParams);
      if (!partner || !protectionRowCurrentlyValid(partner)) continue;
      olChannels.push({
        partnerKey: partner.partner_key,
        partnerName: partner.partner_name,
        relationshipType: partner.relationship_type,
        contactScope: relation.contact_scope,
        contactRole: relation.contact_role,
        verifiedAt: relation.verified_at || null,
      });
    }

    const supplierKey = String(supplier.supplier_key || "").trim().toLowerCase();
    const supplierNameKey = protectionCompactKey(supplier.supplier_name);
    const channelKeys = new Set(olChannels.map((item) => String(item.partnerKey || "").trim().toLowerCase()).filter(Boolean));
    const requestMatch = contactRequests.find((request) => {
      const requestPartnerKey = String(request?.partner_key || "").trim().toLowerCase();
      const requestPartnerNameKey = protectionCompactKey(request?.partner_name);
      if (requestPartnerKey && (requestPartnerKey === supplierKey || channelKeys.has(requestPartnerKey))) return true;
      return Boolean(requestPartnerNameKey && supplierNameKey && requestPartnerNameKey === supplierNameKey);
    }) || null;

    matches.push({
      supplierKey: supplier.supplier_key,
      supplierName: supplier.supplier_name,
      phoneLabel: supplier.phone_label || null,
      numberType: supplier.number_type,
      sourceType: supplier.source_type,
      lastVerifiedAt: supplier.last_verified_at || null,
      olChannels,
      requestMatch: requestMatch ? {
        id: requestMatch.id,
        serviceName: requestMatch.service_name,
        partnerName: requestMatch.partner_name || null,
        contactActor: requestMatch.contact_actor,
        requestedAt: requestMatch.requested_at,
      } : null,
    });
  }

  const requestMatch = matches.map((item) => item.requestMatch).find(Boolean) || null;
  return {
    recognized: matches.length > 0,
    matches,
    requestMatch,
  };
}

export async function protectionActivate(accessToken) {
  const { url, publishableKey } = protectionConfig();
  const policyVersion = String(process.env.PROTECTION_POLICY_VERSION || "protection-service-v1").trim().slice(0, 80) || "protection-service-v1";
  const response = await fetch(`${url}/rest/v1/rpc/protection_activate`, {
    method: "POST",
    headers: {
      ...authHeaders(publishableKey, accessToken),
      Prefer: "return=representation",
    },
    body: JSON.stringify({ p_policy_version: policyVersion }),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(authError(payload, `protection_activate_rpc_${response.status}`));
  return payload;
}
