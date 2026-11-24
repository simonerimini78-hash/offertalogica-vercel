(() => {
  'use strict';
  if (!document.querySelector('script[data-ol-journey-tracking]')) {
    const journeyScript = document.createElement('script');
    journeyScript.src = '/assets/ol-journey-tracking.js?v=0.10.43';
    journeyScript.defer = true;
    journeyScript.setAttribute('data-ol-journey-tracking', '1');
    document.head.appendChild(journeyScript);
  }
  const toggle = document.getElementById('ol-menu-toggle');
  const backdrop = document.getElementById('ol-menu-backdrop');
  const close = document.getElementById('ol-menu-close');
  const drawer = document.getElementById('ol-menu-drawer');
  if (!toggle || !backdrop || !drawer) return;
  let lastFocus = null;
  const setMenu = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Chiudi menu' : 'Apri menu');
    if (open) {
      lastFocus = document.activeElement;
      backdrop.hidden = false;
      requestAnimationFrame(() => backdrop.classList.add('is-open'));
      document.body.style.overflow = 'hidden';
      setTimeout(() => close?.focus(), 30);
      return;
    }
    backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => {
      backdrop.hidden = true;
      lastFocus?.focus?.();
    }, 200);
  };
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  close?.addEventListener('click', () => setMenu(false));
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) setMenu(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setMenu(false); });
  drawer.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
})();
