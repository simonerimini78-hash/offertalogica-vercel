const DEFAULT_WINDOW = Object.freeze({ before: 700, after: 3200 });

const SECTION_DEFINITIONS = Object.freeze({
  customer: {
    before: 0,
    after: 2200,
    patterns: [
      /dati\s+(?:identificativi\s+del\s+)?cliente/gi,
      /fornitura\s+e\s+riepilogo\s+degli\s+importi/gi,
      /contratto\s+intestato\s+a/gi,
      /intestatario\s+fornitura/gi,
      /gentile\s+cliente/gi,
    ],
  },
  supplier: {
    before: 300,
    after: 1800,
    patterns: [
      /sede\s+legale/gi,
      /registro\s+imprese/gi,
      /capitale\s+sociale/gi,
      /societ[aà]\s+soggetta\s+all['’]attivit[aà]\s+di\s+direzione/gi,
      /r\.?e\.?a\.?/gi,
    ],
  },
  excluded: {
    before: 120,
    after: 2600,
    patterns: [
      /servizio\s+idrico/gi,
      /acquedotto/gi,
      /fognatura/gi,
      /teleriscaldamento/gi,
      /comunicazioni\s+commerciali/gi,
      /informazioni\s+societarie/gi,
    ],
  },
});

const COMMODITY_ANCHORS = Object.freeze({
  luce: [
    { kind: "heading", before: 0, after: 6500, pattern: /(?:^|\n)\s*(?:energia\s+elettrica|fornitura\s+elettrica|servizio\s+elettrico)(?:\s+mercato\s+libero)?\b/gim },
    { kind: "code", before: 1000, after: 4600, pattern: /(?:codice\s+)?POD\s*[:：]?/gi },
    { kind: "code", before: 1000, after: 4600, pattern: /punto\s+di\s+prelievo(?:\s*\(POD\))?/gi },
    { kind: "economics", before: 900, after: 2600, pattern: /(?:€|euro)\s*\/?\s*kWh\b/gi },
    { kind: "economics", before: 1200, after: 3400, pattern: /spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?energia\s+elettrica/gi },
  ],
  gas: [
    { kind: "heading", before: 0, after: 6500, pattern: /(?:^|\n)\s*(?:gas\s+naturale|fornitura\s+gas|servizio\s+gas)(?:\s+mercato\s+libero)?\b/gim },
    { kind: "code", before: 1000, after: 4600, pattern: /(?:codice\s+)?PDR\s*[:：]?/gi },
    { kind: "code", before: 1000, after: 4600, pattern: /punto\s+di\s+riconsegna(?:\s*\(PDR\))?/gi },
    { kind: "economics", before: 900, after: 2600, pattern: /(?:€|euro)\s*\/?\s*Smc\b/gi },
    { kind: "economics", before: 1200, after: 3400, pattern: /spesa\s+per\s+(?:la\s+)?vendita\s+(?:di\s+)?gas\s+naturale/gi },
  ],
});

const ROLE_DEFINITIONS = Object.freeze({
  offer: {
    before: 900,
    after: 4600,
    patterns: [
      /box\s+dell['’]offerta/gi,
      /caratteristiche\s+della\s+mia\s+offerta/gi,
      /nome\s+dell['’]offerta\s+commerciale/gi,
      /nome\s+offerta/gi,
      /denominazione\s+commerciale\s+offerta/gi,
      /denominazione\s+contratto/gi,
    ],
  },
  consumption: {
    before: 650,
    after: 2000,
    patterns: [
      /consumo\s+(?:annuo|annuale)/gi,
      /in\s+un\s+anno\s+hai\s+consumato/gi,
      /riepilogo\s+dei\s+consumi/gi,
      /storico\s+dei\s+consumi/gi,
    ],
  },
  economics: {
    before: 800,
    after: 3300,
    patterns: [
      /scontrino\s+dell['’]energia/gi,
      /quota\s+per\s+consumi/gi,
      /quota\s+fissa/gi,
      /dettaglio\s+dei\s+costi/gi,
      /formula\s+prevista/gi,
    ],
  },
});

function normalizeSource(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function collectMatches(source, patterns) {
  const matches = [];
  for (const pattern of patterns || []) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (!Number.isInteger(match.index)) continue;
      matches.push({ index: match.index, length: Math.max(1, match[0].length), marker: match[0] });
    }
  }
  return matches.sort((a, b) => a.index - b.index || b.length - a.length);
}

function collectCommodityAnchors(source) {
  const anchors = [];
  for (const commodity of ["luce", "gas"]) {
    for (const definition of COMMODITY_ANCHORS[commodity]) {
      definition.pattern.lastIndex = 0;
      for (const match of source.matchAll(definition.pattern)) {
        if (!Number.isInteger(match.index)) continue;
        anchors.push({
          commodity,
          kind: definition.kind,
          before: definition.before,
          after: definition.after,
          index: match.index,
          end: match.index + Math.max(1, match[0].length),
          marker: match[0],
        });
      }
    }
  }
  return anchors.sort((a, b) => a.index - b.index || a.end - b.end);
}

function mergeRanges(ranges, maxGap = 180) {
  const ordered = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end + maxGap) {
      merged.push({ ...range, markers: [...(range.markers || [])] });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
    previous.markers.push(...(range.markers || []));
  }
  return merged;
}

function segmentFromRanges(source, ranges, markerCount = 0, markers = []) {
  const merged = mergeRanges(ranges, 100);
  return {
    text: merged.map((range) => source.slice(range.start, range.end).trim()).filter(Boolean).join("\n\n…\n\n"),
    ranges: merged.map(({ start, end }) => ({ start, end })),
    marker_count: markerCount,
    markers: [...new Set(markers.map((marker) => String(marker).replace(/\s+/g, " ").trim()).filter(Boolean))],
  };
}

function buildSegment(source, definition = DEFAULT_WINDOW) {
  const matches = collectMatches(source, definition.patterns || []);
  const before = Number.isFinite(definition.before) ? definition.before : DEFAULT_WINDOW.before;
  const after = Number.isFinite(definition.after) ? definition.after : DEFAULT_WINDOW.after;
  return segmentFromRanges(source, matches.map((match) => ({
    start: Math.max(0, match.index - before),
    end: Math.min(source.length, match.index + match.length + after),
    markers: [match.marker],
  })), matches.length, matches.map((match) => match.marker));
}

function nearestBefore(items, index, predicate) {
  for (let cursor = items.length - 1; cursor >= 0; cursor -= 1) {
    const item = items[cursor];
    if (item.index >= index) continue;
    if (predicate(item)) return item;
  }
  return null;
}

function nearestAfter(items, index, predicate) {
  for (const item of items) {
    if (item.index <= index) continue;
    if (predicate(item)) return item;
  }
  return null;
}

function buildCommoditySegment(source, commodity, anchors) {
  const own = anchors.filter((anchor) => anchor.commodity === commodity);
  if (!own.length) return segmentFromRanges(source, [], 0, []);

  const ranges = own.map((anchor) => {
    const previousOpposite = nearestBefore(anchors, anchor.index, (candidate) => candidate.commodity !== commodity);
    const nextOpposite = nearestAfter(anchors, anchor.index, (candidate) => candidate.commodity !== commodity);
    const previousOwnHeading = nearestBefore(anchors, anchor.index + 1, (candidate) => candidate.commodity === commodity && candidate.kind === "heading");

    let start = Math.max(0, anchor.index - anchor.before);
    let end = Math.min(source.length, anchor.end + anchor.after);

    if (previousOpposite) start = Math.max(start, previousOpposite.end);
    if (nextOpposite) end = Math.min(end, nextOpposite.index);
    if (previousOwnHeading && anchor.index - previousOwnHeading.index <= 9000) {
      start = Math.max(start, previousOwnHeading.index);
    }

    return { start, end, markers: [anchor.marker] };
  });

  return segmentFromRanges(source, ranges, own.length, own.map((anchor) => anchor.marker));
}

function intersectSegments(source, left, right) {
  const ranges = [];
  for (const a of left.ranges || []) {
    for (const b of right.ranges || []) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (end > start) ranges.push({ start, end, markers: [] });
    }
  }
  return segmentFromRanges(source, ranges, ranges.length, []);
}

export function segmentPdfText(value = "") {
  const source = normalizeSource(value);
  const anchors = collectCommodityAnchors(source);
  const commodity = {
    luce: buildCommoditySegment(source, "luce", anchors),
    gas: buildCommoditySegment(source, "gas", anchors),
  };
  const offer = buildSegment(source, ROLE_DEFINITIONS.offer);
  const consumption = buildSegment(source, ROLE_DEFINITIONS.consumption);
  const economics = buildSegment(source, ROLE_DEFINITIONS.economics);

  return {
    all: { text: source, ranges: source ? [{ start: 0, end: source.length }] : [], marker_count: 0, markers: [] },
    customer: buildSegment(source, SECTION_DEFINITIONS.customer),
    supplier: buildSegment(source, SECTION_DEFINITIONS.supplier),
    excluded: buildSegment(source, SECTION_DEFINITIONS.excluded),
    commodity,
    offer: {
      all: offer,
      luce: intersectSegments(source, offer, commodity.luce),
      gas: intersectSegments(source, offer, commodity.gas),
    },
    consumption: {
      all: consumption,
      luce: intersectSegments(source, consumption, commodity.luce),
      gas: intersectSegments(source, consumption, commodity.gas),
    },
    economics: {
      all: economics,
      luce: intersectSegments(source, economics, commodity.luce),
      gas: intersectSegments(source, economics, commodity.gas),
    },
  };
}

export function scopedCommodityText(segments, commodity, fallback = "") {
  const scoped = segments?.commodity?.[commodity]?.text;
  return scoped && scoped.trim().length >= 40 ? scoped : String(fallback ?? "");
}
