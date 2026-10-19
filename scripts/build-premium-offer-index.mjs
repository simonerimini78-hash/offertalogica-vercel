// Archivio di consultazione read-only: non richiama né modifica il sincronizzatore ARERA.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'data/offerte-arera-history.json');
const dest = path.join(root, 'public/data/archivio-offerte-premium.json');
const original = JSON.parse(fs.readFileSync(source, 'utf8'));
if (!Array.isArray(original.offers)) throw new Error('Storico ARERA non disponibile');
const offers = original.offers.map((offer) => ({
  code: String(offer.offerCode || ''), commodity: offer.commodity,
  provider: offer.providerName, providerVat: offer.providerVat || null,
  name: offer.offerName, customerType: offer.customerType,
  versions: (offer.versions || []).map((version) => ({
    catalogDate: version.catalogDate, validFrom: version.validFrom, validTo: version.validTo,
    priceType: version.priceType, price: version.price,
    annualFixedFee: version.annualFixedFee, indexName: version.indexName || null,
    spreadEstimate: version.spreadEstimate != null && version.spreadEstimate !== "" && Number.isFinite(Number(version.spreadEstimate)) ? Number(version.spreadEstimate) : null,
    priceQuality: version.priceQuality || null, source: version.source || null,
  })),
})).filter((offer) => offer.code && offer.versions.length);
const payload = {
  schemaVersion: 1, purpose: 'ricerca offerte per codice e versione; non prova la sottoscrizione del cliente',
  origin: 'data/offerte-arera-history.json', originVersion: original.version || null,
  updatedAt: original.updatedAt || null, offers,
};
fs.writeFileSync(dest, JSON.stringify(payload) + '\n');
console.log(`Archivio Premium: ${offers.length} offerte; origine ${original.version || 'non dichiarata'}`);
