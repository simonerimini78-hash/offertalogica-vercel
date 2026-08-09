/**
 * Gerarchia base dei ruoli Staff v2.
 *
 * Questo modulo serve esclusivamente come strato di compatibilità durante la
 * migrazione dai ruoli legacy (reviewer/admin) ai ruoli v2
 * (technician/admin/owner). I permessi granulari verranno applicati in una
 * fase successiva e non devono essere dedotti soltanto dal livello del ruolo.
 */
export const STAFF_ROLES = Object.freeze({
  OWNER: "owner",
  ADMIN: "admin",
  TECHNICIAN: "technician",
  LEGACY_REVIEWER: "reviewer",
});

const CANONICAL_ROLE = Object.freeze({
  owner: STAFF_ROLES.OWNER,
  admin: STAFF_ROLES.ADMIN,
  technician: STAFF_ROLES.TECHNICIAN,
  reviewer: STAFF_ROLES.TECHNICIAN,
});

const BASELINE_LEVEL = Object.freeze({
  [STAFF_ROLES.TECHNICIAN]: 1,
  [STAFF_ROLES.ADMIN]: 2,
  [STAFF_ROLES.OWNER]: 3,
});

export function canonicalStaffRole(role) {
  return CANONICAL_ROLE[String(role || "").trim().toLowerCase()] || "";
}

/**
 * Verifica la sola gerarchia base, mantenendo compatibili i ruoli legacy.
 *
 * Esempi:
 * - reviewer e technician soddisfano un requisito reviewer/technician;
 * - admin soddisfa anche i requisiti operativi di technician;
 * - owner soddisfa i requisiti admin e technician;
 * - soltanto owner soddisfa un requisito owner.
 */
export function staffRoleSatisfiesBaseline(actualRole, requiredRoles = []) {
  const actual = canonicalStaffRole(actualRole);
  if (!actual) return false;

  const required = (Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles])
    .map(canonicalStaffRole)
    .filter(Boolean);
  if (!required.length) return false;

  const actualLevel = BASELINE_LEVEL[actual] || 0;
  return required.some(requiredRole => actualLevel >= (BASELINE_LEVEL[requiredRole] || Number.POSITIVE_INFINITY));
}

/**
 * Compatibilità per i controlli legacy che erano scritti come role === "admin".
 * Owner eredita il livello amministrativo; technician/reviewer restano esclusi.
 */
export function isStaffAdminRole(role) {
  return staffRoleSatisfiesBaseline(role, [STAFF_ROLES.ADMIN]);
}
