import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeArticle, validateJob, FRAME, VIDEO_STUDIO_VERSION } from './core.mjs';

function demand(ok, explanation) { if (!ok) throw new Error(`VIDEO_STUDIO_STORYBOARD: ${explanation}`); }
function phrase(text, max = 300) {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= max;
}
function candidateSentences(content) {
  // Candidate claims are contiguous, unchanged substrings of the approved article.
  // Preserve punctuation and qualifiers; do not AI-paraphrase numbers or claims.
  const matches = [...content.matchAll(/[^.!?\n]+(?:[.!?]+|(?=\n|$))/gmu)];
  const results = [];
  for (const m of matches) {
    const exact = m[0].trim();
    if (exact.length < 40 || exact.length > 500 || /<\/?[a-z][^>]*>/i.test(exact) || /https?:\/\//i.test(exact)) continue;
    if (/^(?:fonte|riferimenti|link|pubblicato il)\s*:/i.test(exact)) continue;
    const lower = exact.toLowerCase();
    const concrete = /\d|%|€|euro|clienti|contratt|tariff|scadenz|regol|requisit|consum|fattur|bollett|prezz|costi?|aument|riduz|risparmi|compara|verific/i.test(lower);
    const qualifying = /\b(solo|non|se|quando|salvo|esclus|per chi|in caso|dipend|può|possono|alcuni|ma|tuttavia)\b/i.test(lower);
    const score = (concrete ? 3 : 0) + (qualifying ? 2 : 0) + (exact.length >= 70 && exact.length <= 270 ? 2 : 0) - (exact.length > 350 ? 2 : 0);
    if (!results.some(x => x.excerpt === exact)) results.push({ excerpt: exact, score, concrete, qualifying });
  }
  return results.sort((a, b) => b.score - a.score || content.indexOf(a.excerpt) - content.indexOf(b.excerpt));
}
export function proposeStoryboard(article, { platform = 'instagram_reel', mood = 'informativo' } = {}) {
  demand(['instagram_reel', 'facebook_reel'].includes(platform), 'piattaforma non supportata');
  demand(['informativo', 'rassicurante', 'positivo', 'allerta', 'spiegazione_pratica'].includes(mood), 'mood non supportato');
  const { snapshot, fingerprint } = freezeArticle(article);
  const ideas = candidateSentences(snapshot.content).slice(0, 3).map((idea, index) => ({
    id: `idea_${index + 1}`, source_excerpt: idea.excerpt, score: idea.score,
    selection_factors: [idea.concrete && 'contenuto concreto', idea.qualifying && 'qualificazione o condizione presente',
      idea.excerpt.length <= 270 && 'lunghezza potenzialmente gestibile'].filter(Boolean),
    human_review_required: true,
  }));
  demand(ideas.length >= 1, 'nessuna affermazione sufficientemente delimitata nel testo: revisione editoriale richiesta');
  const selected = ideas[0];
  const goals = [
    ['Apertura', 'Presentare il tema senza clickbait o cifre aggiunte', snapshot.title],
    ['Situazione', 'Mostrare una situazione reale coerente con la prova testuale', selected.source_excerpt],
    ['Chiarimento', 'Esplicitare la condizione o la qualificazione del messaggio, da riscrivere e validare', null],
    ['Chiusura', 'Concludere in modo proporzionato e riconoscibile con logo originale', 'Segui OffertaLogica'],
  ];
  const durations = [3000, 4000, 4000, 4000];
  const scenes = goals.map(([role, editorialGoal, textSuggestion], i) => ({
    id: `scene_${i + 1}`, role, duration_ms: durations[i], editorial_goal: editorialGoal,
    visual_brief: i === 3 ? 'Chiusura grafica/fotografica con spazio per il logo originale' :
      'Fotografia editoriale realistica da definire con il revisore; NON generare documenti o prezzi fittizi',
    text_suggestion: textSuggestion,
    suggested_claim_id: i === 1 || i === 2 ? 'claim_main' : null,
    needs_image_selection: true, needs_safe_area_review: true, needs_text_review: true,
  }));
  return {
    draft_schema_version: 1, engine_version: VIDEO_STUDIO_VERSION,
    platform, mood, source_fingerprint: fingerprint, article: snapshot,
    ideas, selected_idea_id: selected.id, selected_excerpt: selected.source_excerpt,
    selection_reason: `Proposta euristica: punteggio ${selected.score}; ${ideas.length} alternative individuate nel testo; la scelta editoriale e l'attribuzione delle fonti restano da verificare`,
    scenes, duration_ms: FRAME.durationMs,
    status: 'needs_human_review',
    blocked_until: ['claim verificato e qualificato', 'fonte/e associate esplicitamente',
      'testi delle scene approvati', 'immagini, crop e regioni protette validate',
      'musica, segmento e licenza approvati', 'QA MP4 e approvazione umana'],
  };
}

// Converts a human-reviewed draft into the unchanged v1 render-job contract.
// No photographs, source attributions or publication authorizations are invented.
export function prepareRenderJob(draft, { article, reviewedBy, approvedMessage, claimSourceIds,
  scenes, music, platform = draft?.platform } = {}) {
  demand(draft?.draft_schema_version === 1 && draft.status === 'needs_human_review', 'bozza non valida');
  demand(phrase(reviewedBy, 200) && phrase(approvedMessage, 320), 'approvazione editoriale esplicita mancante');
  demand(Array.isArray(claimSourceIds) && claimSourceIds.length > 0, 'fonti del claim non dichiarate');
  demand(Array.isArray(scenes) && scenes.length === 4, 'servono le 4 scene riviste');
  const { snapshot, fingerprint } = freezeArticle(article);
  demand(fingerprint === draft.source_fingerprint, 'articolo aggiornato dopo la proposta: ricreare lo storyboard');
  demand(draft.article.id === snapshot.id && draft.article.version === snapshot.version, 'versione articolo non corrispondente');
  demand(scenes.every((s, i) => s.id === draft.scenes[i].id && s.duration_ms === draft.scenes[i].duration_ms), 'ordine e durata scene difformi');
  const claim = { id: 'claim_main', source_excerpt: draft.selected_excerpt, source_ids: claimSourceIds };
  const job = {
    schema_version: 1, platform, article: snapshot,
    editorial: { message: approvedMessage, selection_reason: `${draft.selection_reason}; verificato da ${reviewedBy}`,
      claims: [claim], reviewed_by: reviewedBy },
    scenes: scenes.map(s => ({ ...structuredClone(s), image_reviewed_clean: s.image_reviewed_clean === true })),
    music: structuredClone(music),
  };
  validateJob(job); // blocks missing images/geometry/music, regardless of reviewers' claims
  return job;
}

// Generates a review-only storyboard from a LOCAL, explicitly approved article JSON.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = process.argv.slice(2);
    demand(args.length === 4 && args[0] === '--article' && args[2] === '--out',
      'uso: storyboard.mjs --article /path/article.json --out /path/storyboard.json');
    const article = JSON.parse(await readFile(args[1], 'utf8'));
    const draft = proposeStoryboard(article);
    await writeFile(args[3], JSON.stringify(draft, null, 2), { flag: 'wx', mode: 0o600 });
    return { output: args[3], status: draft.status, fingerprint: draft.source_fingerprint };
  })().then(data => console.log(JSON.stringify(data)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
