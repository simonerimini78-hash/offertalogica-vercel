import fs from "node:fs";
import path from "node:path";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isEcoEnergiaCorrente(offer) {
  if (!offer || typeof offer !== "object") return false;

  const providerKey = normalize(offer.providerKey);
  const labels = [
    offer.providerLabel,
    offer.fornitore,
    offer.providerName,
  ].map(normalize);

  return (
    providerKey === "eco" ||
    labels.includes("e.co energia corrente") ||
    labels.includes("e.co. energia corrente")
  );
}

export default function handler(req, res) {
  try {
    const catalogPath = path.join(
      process.cwd(),
      "public",
      "data",
      "offerte-arera-menu.json",
    );
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

    for (const key of ["offerte", "offerteBusiness"]) {
      if (Array.isArray(catalog[key])) {
        catalog[key] = catalog[key].filter(
          (offer) => !isEcoEnergiaCorrente(offer),
        );
      }
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(200).json(catalog);
  } catch (error) {
    console.error("Errore filtro offerte E.CO:", error);
    return res.status(500).json({ error: "catalogo_non_disponibile" });
  }
}
