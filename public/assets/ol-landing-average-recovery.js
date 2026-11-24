/* OFFERTALOGICA_PUBLIC_V137 — recupero facoltativo del confronto medio, solo nella sessione corrente. */
(() => {
  'use strict';
  if (window.OLLandingAverageRecovery) return;
  const KEY = 'olLandingAverageRecoveryV137';
  const LEGACY_KEY = 'olLandingAveragePromptV134Shown';
  const ALLOWED = new Set(["/","/index.html","/sigle-bolletta-luce-gas.html","/articolo.html","/truffe-telefoniche-luce-gas.html","/casa-smart.html","/offerte-luce-gas-aggiornate.html","/prezzo-fisso-o-variabile-luce-gas.html","/switcho.html","/quota-fissa-luce-gas-consumi-bassi.html","/climatizzazione-pompa-di-calore.html","/psv-gas-oggi.html","/come-funziona.html","/speed-test.html","/pun-psv-spread-luce-gas.html","/partner.html","/fotovoltaico.html","/tutela-energia.html","/pun-oggi.html","/come-cambiare-fornitore-luce-gas.html","/articoli.html","/reclami-luce-gas.html","/come-leggere-bolletta-luce-gas.html","/internet-casa.html","/simulatore-bolletta.html","/fornitori/","/fornitori/index.html","/fornitori/eon.html","/fornitori/a2a.html","/fornitori/plenitude.html","/fornitori/octopus.html","/fornitori/alperia.html","/fornitori/enel.html"]);
  const path = location.pathname;
  const home = path === '/' || path === '/index.html';
  // Anche gli URL pubblici senza estensione possono essere serviti dai rewrite esistenti.
  const cleanPath = path.replace(/\/$/, '') || '/';
  const publicPage = ALLOWED.has(path) || ALLOWED.has(cleanPath + '.html') || ALLOWED.has(cleanPath + '/');
  let memory = null, timer = null, config = null, prompt = null;
  let ownVisible = false;
  function state() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const value = JSON.parse(raw);
        if (['pending', 'shown', 'cancelled'].includes(value.status) && Number.isFinite(value.due)) return value;
      }
      if (sessionStorage.getItem(LEGACY_KEY) === '1') return { status: 'shown', due: 0 };
    } catch {}
    return memory;
  }
  function save(status, due) {
    memory = { status, due };
    try { sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch {}
  }
  function pending() { return state()?.status === 'pending'; }
  function hide() {
    if (prompt) { prompt.hidden = true; prompt.style.setProperty('display', 'none', 'important'); prompt.setAttribute('aria-hidden', 'true'); }
    ownVisible = false;
  }
  function stop() { if (timer !== null) clearInterval(timer); timer = null; }
  function cancel() {
    const current = state();
    if (current) save('cancelled', current.due);
    hide(); stop();
  }
  function blocked() {
    return [...document.querySelectorAll('[aria-modal="true"], #tariffa-modal, #ol-menu-backdrop.is-open, .ol-mobile-menu-backdrop:not([hidden]), #guided-assistant-panel.is-open, #iubenda-cs-banner .iubenda-cs-content')].some(element => {
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    });
  }
  function returnToPersonalization() {
    const url = new URL('/index.html', location.origin);
    url.searchParams.set('landing', '0');
    url.searchParams.set('from', 'landing');
    url.searchParams.set('compare_start', 'average');
    url.searchParams.set('ol_personalize', '1');
    location.assign(url.toString());
  }
  function getPrompt() {
    if (prompt) return prompt;
    prompt = config?.element?.() || document.getElementById('offers-personalize-prompt');
    if (!prompt) {
      prompt = document.createElement('div');
      prompt.id = 'offers-personalize-prompt';
      // Testi identici al popup esistente della V135.
      prompt.innerHTML = `<strong>Vuoi sapere quanto risparmieresti con i tuoi consumi reali?</strong><p>Carica la bolletta: confronteremo le offerte usando i tuoi consumi, senza perdere la stima che stai visualizzando.</p><div class="offers-personalize-actions"><button type="button" class="offers-personalize-upload" id="offers-upload-bill">Carica la bolletta</button><button type="button" class="offers-personalize-continue" id="offers-keep-average">Continua con la stima media</button></div>`;
    }
    prompt.classList.add('offers-personalize-prompt', 'ol-recovery-prompt');
    prompt.setAttribute('role', 'region');
    prompt.setAttribute('aria-label', prompt.querySelector('strong').textContent);
    prompt.hidden = true;
    // Fuori dai contenitori del calcolatore: resta visibile anche se la classifica viene nascosta.
    document.body.appendChild(prompt);
    const css = document.createElement('style');
    css.textContent = `
      html body #offers-personalize-prompt.ol-recovery-prompt[hidden]{display:none!important}
      html body #offers-personalize-prompt.ol-recovery-prompt:not([hidden]){display:block!important;position:fixed!important;z-index:990;bottom:max(12px,env(safe-area-inset-bottom));left:12px;width:min(420px,calc(100% - 24px));max-height:38vh;overflow:auto;box-sizing:border-box;margin:0;padding:10px 12px;box-shadow:0 6px 24px rgba(15,23,42,.18);border:1px solid #bfdbfe;border-radius:12px;background:linear-gradient(135deg,#f8fbff 0%,#f0fdf4 100%);color:#0f172a;text-align:left}
      html body #offers-personalize-prompt.ol-recovery-prompt strong{display:block;margin:0 0 4px;font-size:15px;line-height:1.25}
      html body #offers-personalize-prompt.ol-recovery-prompt p{margin:0 0 8px;color:#475569;font-size:13px;line-height:1.3}
      html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      html body #offers-personalize-prompt.ol-recovery-prompt button{min-height:44px;padding:7px 8px;font-family:inherit;font-size:14px;font-weight:900;line-height:1.2;cursor:pointer;text-align:center;border-radius:12px;margin:0;white-space:normal}
      html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-upload{border:0;background:var(--logo-green-gradient,linear-gradient(135deg,#048a3d 0%,#16a34a 46%,#7ed321 100%));color:#fff}
      html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-continue{border:1px solid #cbd5e1;background:#fff;color:#334155}
      @media(max-width:420px){html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-actions{grid-template-columns:1fr}}
    `;
    document.head.appendChild(css);
    prompt.querySelector('#offers-upload-bill').addEventListener('click', () => {
      cancel();
      if (config?.accept) config.accept(); else returnToPersonalization();
    });
    prompt.querySelector('#offers-keep-average').addEventListener('click', () => {
      cancel(); config?.dismiss?.();
    });
    return prompt;
  }
  function tick(exitIntent = false) {
    if (home && !config) return;
    if (ownVisible) {
      if (state()?.status === 'cancelled' || blocked() || config?.ineligible?.()) { cancel(); }
      return;
    }
    const current = state();
    if (!current || current.status !== 'pending') { stop(); return; }
    if (config?.ineligible?.()) { cancel(); return; }
    // Il termine non dipende dalla posizione di scroll né dalla pagina; la visualizzazione sì.
    if (!publicPage || document.visibilityState !== 'visible' || blocked() || config?.notReady?.()) return;
    if (!exitIntent && Date.now() < current.due) return;
    const panel = getPrompt();
    panel.hidden = false;
    panel.style.setProperty('display', 'block', 'important');
    panel.setAttribute('aria-hidden', 'false');
    // Non consumare la possibilità prima della comparsa effettiva.
    const rect = panel.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(panel).visibility === 'hidden') { hide(); return; }
    save('shown', current.due);
    ownVisible = true;
  }
  function resume() {
    if (!publicPage || !pending()) return;
    if (timer === null) timer = setInterval(tick, 250);
    tick();
  }
  function arm() {
    if (!state()) save('pending', Date.now() + 15000);
    resume();
  }
  function configure(options) { config = options; resume(); }
  window.OLLandingAverageRecovery = { arm, cancel, configure, resume, pending, active: () => pending() || ownVisible, returnToPersonalization };
  // Non utilizzare beforeunload, history trap o navigazioni annullate.
  document.addEventListener('mouseout', event => {
    if (event.relatedTarget === null && event.clientY <= 0 && matchMedia('(hover: hover) and (pointer: fine)').matches) tick(true);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });
  window.addEventListener('pageshow', () => { if (pending()) resume(); else if (!ownVisible) hide(); });
  window.addEventListener('pagehide', () => { hide(); stop(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && ownVisible && !blocked()) { cancel(); config?.dismiss?.(); }
  });
  document.addEventListener('click', event => {
    if (!pending() && !ownVisible) return;
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    try {
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && (/^\/(carica-pdf|protezione-accesso)(\.html)?\/?$/.test(url.pathname) || ['photo','pdf','manual'].includes(url.searchParams.get('compare_start')) || url.searchParams.has('bill_input') || url.hash === '#business-panel')) cancel();
      if (url.origin !== location.origin && (/(^|\.)(switcho\.it|awin1\.com|tradedoubler\.com)$/i.test(url.hostname))) cancel();
    } catch {}
  }, true);
  // La homepage configura il callback dei tre metodi nel suo bootstrap esistente.
  if (!home) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resume, { once:true }); else resume();
  }
})();
