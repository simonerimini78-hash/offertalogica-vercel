/* OFFERTALOGICA_PUBLIC_V139 — recupero facoltativo del confronto medio, solo nella sessione corrente. */
(() => {
  'use strict';
  // La personalizzazione appartiene solo alla landing e al suo calcolatore.
  // Anche se un vecchio loader condiviso invoca il modulo altrove, non fare nulla.
  const home = location.pathname === '/' || location.pathname === '/index.html';
  if (!home || window.OLLandingAverageRecovery) return;
  const KEY = 'olLandingAverageRecoveryV139';
  // Lo stato V137 e' ambiguo (shown/cancelled anche dopo un occultamento).
  // Rimuoviamo solo quel record, per impedire ai vecchi loader di riattivarlo.
  try { sessionStorage.removeItem('olLandingAverageRecoveryV137'); } catch {}
  let memory = null, timer = null, config = null, prompt = null;
  let ownVisible = false, pageSuspended = false;
  // V139 non interpreta gli indicatori V134–V137: non distinguono un rifiuto da un occultamento.
  // Una nuova classifica media inizializza autonomamente il recupero della versione corrente.
  function state() {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const value = JSON.parse(raw);
        if (['pending', 'cancelled'].includes(value.status) && Number.isFinite(value.due)) return value;
      }
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
  function visibleBox(element) {
    if (!element || !element.isConnected) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    const rect = element.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < vw && rect.bottom > 0 && rect.top < vh;
  }
  function blocked() {
    // La barra Iubenda ha padding forzato via CSS anche quando e' vuota. Verificare
    // contenuto o comandi effettivamente presenti, non il rettangolo del wrapper.
    const cookieContent = document.querySelector('#iubenda-cs-banner .iubenda-cs-content');
    if (visibleBox(cookieContent) && [...cookieContent.querySelectorAll('button, a, .iubenda-banner-content, .iubenda-cs-rationale')].some(node =>
      visibleBox(node) && (node.matches('button, a') || node.textContent.trim()))) return true;
    return [...document.querySelectorAll('[aria-modal="true"], #tariffa-modal, #ol-menu-backdrop.is-open, .ol-mobile-menu-backdrop:not([hidden]), #guided-assistant-panel.is-open, #mobile-fast-help-backdrop:not([hidden])')]
      .some(element => !element.closest('#iubenda-cs-banner') && visibleBox(element));
  }
  function panelReachable(panel) {
    if (!visibleBox(panel)) return false;
    const rect = panel.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const left = Math.max(0, rect.left), right = Math.min(vw, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(vh, rect.bottom);
    if (right <= left || bottom <= top) return false;
    // Controllare il vero hit-test delle azioni, non soltanto il display CSS.
    return [...panel.querySelectorAll('button')].every(button => {
      const r = button.getBoundingClientRect();
      const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      return x >= left && x < right && y >= top && y < bottom && button.contains(document.elementFromPoint(x, y));
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
  function observe(action) { try { config?.observe?.(action); } catch {} }
  function getPrompt() {
    if (prompt) return prompt;
    prompt = config?.element?.() || document.getElementById('offers-personalize-prompt');
    if (!prompt) return null; // Solo il markup gia' esistente del calcolatore.
    prompt.classList.add('offers-personalize-prompt', 'ol-recovery-prompt');
    prompt.setAttribute('role', 'region');
    prompt.setAttribute('aria-label', prompt.querySelector('strong').textContent);
    prompt.hidden = true;
    // Fuori dai contenitori del calcolatore: resta visibile anche se la classifica viene nascosta.
    document.body.appendChild(prompt);
    const css = document.createElement('style');
    css.textContent = `
      html body #offers-personalize-prompt.ol-recovery-prompt[hidden]{display:none!important}
      html body #offers-personalize-prompt.ol-recovery-prompt:not([hidden]){display:block!important;position:fixed!important;z-index:12000;bottom:max(12px,env(safe-area-inset-bottom));left:12px;width:min(420px,calc(100% - 24px));max-height:48vh;overflow:auto;box-sizing:border-box;margin:0;padding:10px 12px;box-shadow:0 6px 24px rgba(15,23,42,.18);border:1px solid #bfdbfe;border-radius:12px;background:linear-gradient(135deg,#f8fbff 0%,#f0fdf4 100%);color:#0f172a;text-align:left}
      html body #offers-personalize-prompt.ol-recovery-prompt strong{display:block;margin:0 0 4px;font-size:15px;line-height:1.25}
      html body #offers-personalize-prompt.ol-recovery-prompt p{margin:0 0 8px;color:#475569;font-size:13px;line-height:1.3}
      html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      html body #offers-personalize-prompt.ol-recovery-prompt button{min-height:44px;padding:7px 8px;font-family:inherit;font-size:14px;font-weight:900;line-height:1.2;cursor:pointer;text-align:center;border-radius:12px;margin:0;white-space:normal}
      html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-upload{border:0;background:var(--logo-green-gradient,linear-gradient(135deg,#048a3d 0%,#16a34a 46%,#7ed321 100%));color:#fff}
      html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-continue{border:1px solid #cbd5e1;background:#fff;color:#334155}
      @media(max-width:420px){html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-actions{grid-template-columns:1fr}}
      @media(max-height:460px){html body #offers-personalize-prompt.ol-recovery-prompt:not([hidden]){max-height:calc(100vh - 24px)}html body #offers-personalize-prompt.ol-recovery-prompt .offers-personalize-actions{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(css);
    prompt.querySelector('#offers-upload-bill').addEventListener('click', event => {
      if (event.isTrusted && ownVisible && document.visibilityState === 'visible' && panelReachable(prompt)) observe("accepted");
      cancel();
      config?.accept?.();
    });
    prompt.querySelector('#offers-keep-average').addEventListener('click', event => {
      if (event.isTrusted && ownVisible && document.visibilityState === 'visible' && panelReachable(prompt)) observe("closed");
      cancel(); config?.dismiss?.();
    });
    return prompt;
  }
  function tick(exitIntent = false) {
    if (!document.body || pageSuspended || !config) return;
    const current = state();
    if (!current || current.status !== 'pending') { hide(); stop(); return; }
    if (config?.ineligible?.()) { cancel(); return; }
    if (exitIntent === true && Date.now() < current.due) {
      current.due = Date.now();
      save('pending', current.due);
    }
    if (document.visibilityState !== 'visible' || blocked() || Date.now() < current.due) { hide(); return; }
    const panel = getPrompt();
    if (!panel) return;
    if (!panel.isConnected || panel.parentNode !== document.body) document.body.appendChild(panel);
    panel.hidden = false;
    panel.style.setProperty('display', 'block', 'important');
    panel.setAttribute('aria-hidden', 'false');
    if (!panelReachable(panel)) { hide(); return; }
    ownVisible = true;
    observe("shown");
    // Non salvare uno stato "shown": pagehide, menu e overlay sono reversibili.
    // Solo una scelta esplicita passa la sessione a cancelled.
  }
  function resume() {
    if (!pending() || pageSuspended) return;
    if (timer === null) timer = setInterval(tick, 250);
    tick();
  }
  function arm() {
    if (!state()) save('pending', Date.now() + 15000);
    resume();
  }
  function configure(options) { config = options; resume(); }
  window.OLLandingAverageRecovery = { arm, cancel, configure, resume, pending, active: pending, returnToPersonalization };
  if (home) {
    const params = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    if (['photo','pdf','manual'].includes(params.get('compare_start') || hashParams.get('compare_start')) || params.has('bill_input') || params.get('ol_personalize') === '1') cancel();
  }
  // Non utilizzare beforeunload, history trap o navigazioni annullate.
  document.addEventListener('mouseout', event => {
    // An iPhone viewport has no desktop mouse-exit intent.
    if (window.OLStaffPreview?.mobile) return;
    if (event.relatedTarget === null && event.clientY <= 0 && matchMedia('(hover: hover) and (pointer: fine)').matches) tick(true);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resume(); });
  window.addEventListener('pageshow', () => { pageSuspended = false; if (pending()) resume(); else hide(); });
  window.addEventListener('pagehide', () => { pageSuspended = true; hide(); stop(); });
  window.addEventListener('popstate', resume);
  window.addEventListener('focus', resume);
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
  // Anche il ritorno alla landing ripristina una sessione gia' armata, senza attendere una nuova classifica.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', resume, { once:true }); else resume();
})();
