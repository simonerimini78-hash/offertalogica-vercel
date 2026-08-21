function cleanText(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function canonicalProvider(value) {
  return cleanText(value, 300)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:societa per azioni|societa a responsabilita limitata|spa|srl)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function premiumProviderNamesEquivalent(left, right) {
  const a = canonicalProvider(left);
  const b = canonicalProvider(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 3 && longer.startsWith(`${shorter} `);
}

export function premiumContractForAutomaticComparison(contract, normalized = {}) {
  if (!contract || contract.verification_status !== "verified") return null;
  const confirmation = cleanText(contract.customer_confirmation_status, 80).toLowerCase();
  const method = cleanText(contract.automatic_match_method, 120).toLowerCase();

  // Una conferma cliente è una dichiarazione, non una verifica tecnica della
  // versione economica. Non può quindi essere la fonte di un codice rosso.
  if (confirmation === "confirmed" || method === "customer_confirmed") return null;

  const billProvider = cleanText(
    normalized?.fornitore_luce || normalized?.fornitore_gas || normalized?.fornitore,
    300,
  );
  const contractProvider = cleanText(contract.provider_name, 300);
  if (billProvider && contractProvider && premiumProviderNamesEquivalent(billProvider, contractProvider)) {
    // Allinea solo il nome usato dal classificatore; i valori economici restano
    // quelli del riferimento verificato.
    return { ...contract, provider_name: billProvider };
  }
  return contract;
}

export function premiumOfferMatchVerifiedForBill(offerMatch) {
  return Boolean(offerMatch?.match?.verified === true);
}

export function premiumOfferContractCanBindBill(offerMatch) {
  if (!offerMatch?.contract?.id) return false;
  return !(offerMatch.status === "existing_verified" && offerMatch?.match?.verified !== true);
}

export function premiumBillScopedOfferSummary(offerMatch) {
  const summary = offerMatch?.publicSummary && typeof offerMatch.publicSummary === "object"
    ? offerMatch.publicSummary
    : null;
  if (!summary) return null;
  const actual = offerMatch?.match;
  if (offerMatch?.status === "existing_verified" && actual?.verified !== true) {
    // Il contratto corrente resta valido per l'utenza, ma una bolletta storica
    // che non trova la propria versione nel catalogo non viene attribuita a quel
    // contratto e non genera falsi mismatch economici.
    return {
      ...summary,
      status: "not_found",
      verified: false,
      confidence: Number(actual?.confidence || 0),
      method: actual?.method || "none",
      contractId: null,
    };
  }
  if (summary.verified !== true && ["matched", "partial", "ambiguous"].includes(summary.status)) {
    // Il matcher attuale non espone al cliente candidati non verificati: la UI
    // deve quindi parlare di offerta non verificata, non chiedere una conferma
    // che non è disponibile.
    return { ...summary, status: "not_found", verified: false };
  }
  return summary;
}
