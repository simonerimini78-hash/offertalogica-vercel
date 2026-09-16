// Sintesi editoriale canonica per tutti i social OffertaLogica.
// Le funzioni di pubblicazione devono riusare questo modulo invece di creare
// algoritmi di sintesi specifici per singola piattaforma.
// La struttura preserva titoli, entità, numeri, elenchi e link descrittivi per
// leggibilità, indicizzazione semantica/AI e tecnologie assistive.

export const SOCIAL_SUMMARY_VERSION = "2";
export const SOCIAL_SUMMARY_MAX_CHARS = 4200;
const SOCIAL_SITE = "https://offertalogica.it";

// Mantiene i riferimenti utili anche fuori dal sito: i link interni diventano
// URL assoluti, mentre link non sicuri/non web non vengono esposti.
export function absoluteSocialLink(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }
  if (/^\/(?!\/)/.test(raw)) return `${SOCIAL_SITE}${raw}`;
  return "";
}

const SUMMARY_PROFILES = [
  { name: "detailed", sentencesPerSection: 2, listItemsPerSection: 3, bodyChars: 620, listChars: 190 },
  { name: "balanced", sentencesPerSection: 2, listItemsPerSection: 2, bodyChars: 520, listChars: 170 },
  { name: "compact", sentencesPerSection: 1, listItemsPerSection: 2, bodyChars: 430, listChars: 155 },
  { name: "minimal", sentencesPerSection: 1, listItemsPerSection: 1, bodyChars: 340, listChars: 140 },
] as const;

export function cleanSocialInlineText(value = "") {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_match, alt) => String(alt || ""))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
      const safe = absoluteSocialLink(href);
      return safe ? `${label} (${safe})` : String(label || "");
    })
    .replace(/[*_`~]+/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function shortenSocialText(value = "", maxChars = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, Math.max(1, maxChars - 1));
  const boundary = slice.lastIndexOf(" ");
  return `${(boundary > maxChars * 0.65 ? slice.slice(0, boundary) : slice).trimEnd()}…`;
}

function articleContentBlocks(article: any = {}) {
  const blocks: Array<{ kind: string; text: string }> = [];
  const content = String(article?.content || "").replace(/\r\n?/g, "\n").trim();
  const paragraphs = content.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);

  paragraphs.forEach((paragraph) => {
    if (/^###\s+/.test(paragraph)) {
      blocks.push({ kind: "subheading", text: cleanSocialInlineText(paragraph.replace(/^###\s+/, "")) });
      return;
    }
    if (/^##\s+/.test(paragraph)) {
      blocks.push({ kind: "heading", text: cleanSocialInlineText(paragraph.replace(/^##\s+/, "")) });
      return;
    }

    const lines = paragraph.split("\n").map((value) => value.trim()).filter(Boolean);
    const unordered = lines.length > 0 && lines.every((value) => /^[-*]\s+/.test(value));
    const ordered = lines.length > 0 && lines.every((value) => /^\d+[.)]\s+/.test(value));
    if (unordered || ordered) {
      lines.forEach((line) => {
        const marker = ordered ? line.match(/^\d+[.)]/)?.[0] || "•" : "•";
        const clean = line.replace(ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/, "");
        blocks.push({ kind: "list", text: `${marker} ${cleanSocialInlineText(clean)}` });
      });
      return;
    }

    blocks.push({ kind: "body", text: cleanSocialInlineText(lines.join(" ")) });
  });

  return blocks.filter((block) => block.text);
}

function sentenceParts(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  try {
    if (typeof Intl !== "undefined" && typeof (Intl as any).Segmenter === "function") {
      const segmenter = new (Intl as any).Segmenter("it", { granularity: "sentence" });
      return [...segmenter.segment(text)].map((part: any) => String(part.segment || "").trim()).filter(Boolean);
    }
  } catch {
    // Fallback deterministico sotto.
  }
  return (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text]).map((part) => part.trim()).filter(Boolean);
}

function keywordSet(value = "") {
  const stop = new Set([
    "della", "delle", "degli", "dello", "dalla", "dalle", "dagli", "dallo",
    "nella", "nelle", "negli", "nello", "alla", "alle", "agli", "allo", "anche",
    "come", "cosa", "sono", "essere", "questo", "questa", "quello", "quella",
    "dopo", "prima", "quando", "dove", "perché", "perche", "quindi", "oppure",
    "senza", "sulla", "sulle", "sugli", "sullo", "offertalogica",
  ]);
  return new Set(
    String(value || "")
      .toLocaleLowerCase("it-IT")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9]{4,}/g)
      ?.filter((word) => !stop.has(word)) || [],
  );
}

function sentenceScore(sentence: string, index: number, keywords: Set<string>) {
  const normalized = String(sentence || "")
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let score = index === 0 ? 4 : Math.max(0, 2 - index * 0.15);
  if (/[0-9€%]/.test(sentence)) score += 2;
  if (/\b(non|deve|devono|puo|possono|attenzione|importante|obbligo|diritto|prezzo|costo|durata|scadenza|recesso|garanzia|verifica|controll|condizion)\w*/i.test(normalized)) score += 1.5;
  keywords.forEach((keyword) => {
    if (normalized.includes(keyword)) score += 0.7;
  });
  return score;
}

function contentSections(article: any = {}) {
  const blocks = articleContentBlocks(article);
  const sections: Array<{ heading: string; headingKind: string; blocks: Array<{ kind: string; text: string }> }> = [];
  let current = { heading: "", headingKind: "heading", blocks: [] as Array<{ kind: string; text: string }> };
  const flush = () => {
    if (current.heading || current.blocks.length) sections.push(current);
    current = { heading: "", headingKind: "heading", blocks: [] };
  };

  blocks.forEach((block) => {
    if (block.kind === "heading" || block.kind === "subheading") {
      flush();
      current.heading = block.text;
      current.headingKind = block.kind;
    } else {
      current.blocks.push(block);
    }
  });
  flush();
  return sections;
}

function digestBlocks(article: any = {}, detail: any = {}) {
  const sections = contentSections(article);
  const titleKeywords = keywordSet(article?.title || "");
  const out: Array<{ kind: string; text: string }> = [];

  sections.forEach((section, sectionIndex) => {
    const heading = section.heading || (sectionIndex === 0 ? "In breve" : "");
    if (heading) out.push({ kind: section.headingKind || "heading", text: shortenSocialText(heading, 120) });

    const bodySentences: string[] = [];
    section.blocks.filter((block) => block.kind === "body").forEach((block) => {
      sentenceParts(block.text).forEach((sentence) => bodySentences.push(sentence));
    });

    if (bodySentences.length) {
      const keywords = new Set([...titleKeywords, ...keywordSet(heading)]);
      const ranked = bodySentences.map((sentence, index) => ({
        sentence,
        index,
        score: sentenceScore(sentence, index, keywords),
      }));
      ranked.sort((a, b) => b.score - a.score || a.index - b.index);
      const selected = ranked
        .slice(0, Math.max(1, detail.sentencesPerSection || 1))
        .sort((a, b) => a.index - b.index);
      const summary = shortenSocialText(selected.map((item) => item.sentence).join(" "), detail.bodyChars || 480);
      if (summary) out.push({ kind: "body", text: summary });
    }

    const lists = section.blocks.filter((block) => block.kind === "list");
    lists.slice(0, Math.max(0, detail.listItemsPerSection || 0)).forEach((block) => {
      out.push({ kind: "list", text: shortenSocialText(block.text, detail.listChars || 170) });
    });
  });

  return out.filter((block) => block.text);
}

export function formatSocialSummaryBlocks(blocks: Array<{ kind: string; text: string }> = []) {
  const parts: string[] = [];
  let listBuffer: string[] = [];
  const flushList = () => {
    if (listBuffer.length) parts.push(listBuffer.join("\n"));
    listBuffer = [];
  };

  blocks.forEach((block) => {
    const text = String(block?.text || "").trim();
    if (!text) return;
    if (block.kind === "list") {
      listBuffer.push(text);
      return;
    }
    flushList();
    parts.push(text);
  });
  flushList();
  return parts.join("\n\n").trim();
}

function trimBlocksToLimit(blocks: Array<{ kind: string; text: string }>, maxChars: number) {
  const kept: Array<{ kind: string; text: string }> = [];
  for (const block of blocks) {
    const candidate = [...kept, block];
    if (formatSocialSummaryBlocks(candidate).length <= maxChars) {
      kept.push(block);
      continue;
    }
    const used = formatSocialSummaryBlocks(kept).length;
    const room = maxChars - used - (kept.length ? 2 : 0);
    if (room > 90 && block.kind === "body") {
      kept.push({ ...block, text: shortenSocialText(block.text, room) });
    }
    break;
  }
  return kept;
}

export function buildSocialSummary(article: any = {}, options: { maxChars?: number } = {}) {
  const maxChars = Math.max(800, Number(options.maxChars || SOCIAL_SUMMARY_MAX_CHARS));

  for (const profile of SUMMARY_PROFILES) {
    const blocks = digestBlocks(article, profile);
    const text = formatSocialSummaryBlocks(blocks);
    if (text && text.length <= maxChars) {
      return { version: SOCIAL_SUMMARY_VERSION, profile: profile.name, blocks, text };
    }
  }

  const fallbackProfile = SUMMARY_PROFILES[SUMMARY_PROFILES.length - 1];
  const blocks = trimBlocksToLimit(digestBlocks(article, fallbackProfile), maxChars);
  return {
    version: SOCIAL_SUMMARY_VERSION,
    profile: `${fallbackProfile.name}-trimmed`,
    blocks,
    text: formatSocialSummaryBlocks(blocks),
  };
}
