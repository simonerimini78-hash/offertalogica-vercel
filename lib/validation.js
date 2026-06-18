export function normalizePhone(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.length >= 8) return `+39${digits}`;
  return digits;
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

export function sanitizeLead(input) {
  const name = String(input.name || input.nome || "").trim().slice(0, 120);
  const email = String(input.email || "").trim().toLowerCase().slice(0, 160);
  const phone = normalizePhone(input.phone || input.telefono || "");
  const consentService = Boolean(input.consentService ?? input.consensoServizio ?? input.consent);
  const consentMarketing = Boolean(input.consentMarketing ?? input.consensoMarketing);
  const consentPartners = false;
  const consentProfiling = false;

  if (!name) throw new Error("Nome obbligatorio");
  if (!validEmail(email)) throw new Error("Email non valida");
  if (phone.replace(/\D/g, "").length < 8) throw new Error("Telefono non valido");
  if (!consentService) throw new Error("Consenso servizio obbligatorio");

  return { name, email, phone, consentService, consentMarketing, consentPartners, consentProfiling };
}
