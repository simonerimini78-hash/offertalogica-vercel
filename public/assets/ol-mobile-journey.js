/* OffertaLogica mobile journey v1.3.1 */
(function () {
  'use strict';

  var BREAKPOINT = 700;
  var MENU_ID = 'ol-mobile-site-menu';
  var GENERIC_CTA_TEXTS = new Set([
    'apri il calcolatore',
    'calcola sui tuoi consumi',
    'confronta sui tuoi consumi',
    'torna al calcolatore',
    'vai al calcolatore',
    'usa il calcolatore'
  ]);

  var MENU_ITEMS = [
    { href: '/offerte-luce-gas-aggiornate.html', label: 'Offerte aggiornate' },
    { href: '/come-funziona.html', label: 'Come funziona' },
    { href: '/come-leggere-bolletta-luce-gas.html', label: 'Guida bolletta' },
    { href: '/fornitori/', label: 'Fornitori energia' },
    { href: '/truffe-telefoniche-luce-gas.html', label: 'Sicurezza chiamate' },
    { href: '/casa-smart.html', label: 'Casa smart' },
    { href: '/internet-casa.html', label: 'Internet casa' },
    { href: '/speed-test.html', label: 'Speed Test' },
    { href: '/fotovoltaico.html', label: 'Fotovoltaico' },
    { href: '/climatizzazione-pompa-di-calore.html', label: 'Climatizzazione' },
    { href: '/articoli.html', label: 'OffertaLogica Informa' },
    { href: '/partner.html', label: 'Partner' }
  ];

  function currentPath() {
    var path = window.location.pathname || '/';
    return path.endsWith('/index.html') ? path.slice(0, -10) || '/' : path;
  }

  function samePath(href) {
    try {
      var path = new URL(href, window.location.origin).pathname;
      if (path.endsWith('/index.html')) path = path.slice(0, -10) || '/';
      return path === currentPath();
    } catch (error) {
      return false;
    }
  }

  function buildMenu() {
    var logo = document.querySelector('img[src*="logo-offertalogica-header"]');
    if (!logo) return;

    var header = logo.closest('header');
    if (!header || header.querySelector('.ol-mobile-menu-toggle')) return;

    document.body.classList.add('ol-mobile-journey-ready');
    header.classList.add('ol-mobile-menu-host');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ol-mobile-menu-toggle';
    toggle.setAttribute('aria-label', 'Apri menu OffertaLogica');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', MENU_ID);
    toggle.innerHTML = '<span class="ol-mobile-menu-icon" aria-hidden="true"><i></i><i></i><i></i></span><span class="ol-mobile-menu-label">Menu</span>';
    header.appendChild(toggle);

    var backdrop = document.createElement('div');
    backdrop.className = 'ol-mobile-menu-backdrop';
    backdrop.hidden = true;

    var panel = document.createElement('aside');
    panel.id = MENU_ID;
    panel.className = 'ol-mobile-menu-panel';
    panel.setAttribute('aria-label', 'Menu OffertaLogica');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.hidden = true;

    var head = document.createElement('div');
    head.className = 'ol-mobile-menu-head';
    head.innerHTML = '<strong>Esplora OffertaLogica</strong>';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ol-mobile-menu-close';
    close.setAttribute('aria-label', 'Chiudi menu');
    close.textContent = '×';
    head.appendChild(close);
    panel.appendChild(head);

    var primary = document.createElement('a');
    primary.className = 'ol-mobile-menu-primary';
    primary.href = '/?landing=0&from=mobile-menu';
    primary.textContent = 'Scopri quanto puoi risparmiare';
    panel.appendChild(primary);

    var nav = document.createElement('nav');
    nav.className = 'ol-mobile-menu-links';
    nav.setAttribute('aria-label', 'Sezioni OffertaLogica');
    MENU_ITEMS.forEach(function (item) {
      var link = document.createElement('a');
      link.href = item.href;
      link.textContent = item.label;
      if (samePath(item.href)) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    panel.appendChild(nav);

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    var lastFocus = null;

    function openMenu() {
      if (window.innerWidth > BREAKPOINT) return;
      lastFocus = document.activeElement;
      backdrop.hidden = false;
      panel.hidden = false;
      requestAnimationFrame(function () {
        document.body.classList.add('ol-mobile-menu-open');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Chiudi menu OffertaLogica');
        close.focus();
      });
    }

    function closeMenu(restoreFocus) {
      document.body.classList.remove('ol-mobile-menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Apri menu OffertaLogica');
      window.setTimeout(function () {
        if (!document.body.classList.contains('ol-mobile-menu-open')) {
          panel.hidden = true;
          backdrop.hidden = true;
        }
      }, 180);
      if (restoreFocus !== false && lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    toggle.addEventListener('click', function () {
      if (document.body.classList.contains('ol-mobile-menu-open')) closeMenu();
      else openMenu();
    });
    close.addEventListener('click', function () { closeMenu(); });
    backdrop.addEventListener('click', function () { closeMenu(); });
    document.addEventListener('keydown', function (event) {
      if (!document.body.classList.contains('ol-mobile-menu-open')) return;
      if (event.key === 'Escape') {
        closeMenu();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = Array.prototype.slice.call(panel.querySelectorAll('a[href], button:not([disabled])')).filter(function (item) {
        return !item.hasAttribute('hidden');
      });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > BREAKPOINT && document.body.classList.contains('ol-mobile-menu-open')) closeMenu(false);
    }, { passive: true });
  }

  function normalizeCalculatorCtas() {
    var selector = [
      'a.button',
      'a.primary-link',
      'a.btn-action',
      'a.lead-primary',
      'a.business-secondary-action',
      'a.ol-public-primary-cta'
    ].join(',');

    document.querySelectorAll(selector).forEach(function (link) {
      var text = (link.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!GENERIC_CTA_TEXTS.has(text)) return;
      var href = link.getAttribute('href') || '';
      if (!(href === '/' || href.indexOf('/?') === 0 || href.indexOf('/#') === 0)) return;
      link.textContent = 'Scopri quanto puoi risparmiare';
      link.classList.add('ol-journey-calculator-cta');
    });
  }

  function enhanceFastEntries() {
    document.querySelectorAll('[data-ol-fast-entry]').forEach(function (section) {
      var help = section.querySelector('[data-ol-fast-entry-help]');
      var buttons = Array.prototype.slice.call(section.querySelectorAll('[data-ol-fast-info]'));
      if (!help || !buttons.length) return;

      function closeHelp() {
        help.hidden = true;
        help.textContent = '';
        buttons.forEach(function (button) { button.setAttribute('aria-expanded', 'false'); });
      }

      buttons.forEach(function (button) {
        button.addEventListener('click', function () {
          var wasOpen = button.getAttribute('aria-expanded') === 'true' && !help.hidden;
          closeHelp();
          if (wasOpen) return;
          help.textContent = button.getAttribute('data-ol-fast-info') || '';
          help.hidden = false;
          button.setAttribute('aria-expanded', 'true');
        });
      });

      section.querySelectorAll('.ol-fast-entry-option').forEach(function (link) {
        link.addEventListener('click', closeHelp);
      });
    });
  }

  function enhanceTocs() {
    document.querySelectorAll('.toc').forEach(function (toc) {
      if (!toc.querySelector('a[href^="#"]')) return;
      toc.classList.add('ol-mobile-toc');
      var title = toc.querySelector('strong');
      if (title && !toc.querySelector('.ol-mobile-toc-hint')) {
        var hint = document.createElement('span');
        hint.className = 'ol-mobile-toc-hint';
        hint.textContent = 'Tocca una voce per andare alla sezione';
        title.insertAdjacentElement('afterend', hint);
      }
    });
  }

  function labelTableRows(table, labels) {
    table.querySelectorAll('tbody tr').forEach(function (row) {
      var cells = Array.prototype.slice.call(row.children).filter(function (cell) { return cell.tagName === 'TD'; });
      if (!cells.length) return;
      if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || '1') > 1) {
        cells[0].classList.add('ol-mobile-table-status');
        return;
      }
      cells.forEach(function (cell, index) {
        if (labels[index]) cell.setAttribute('data-ol-label', labels[index]);
      });
    });
  }

  function enhanceTables() {
    document.querySelectorAll('table').forEach(function (table) {
      var labels = Array.prototype.slice.call(table.querySelectorAll('thead th')).map(function (th) {
        return (th.textContent || '').trim().replace(/\s+/g, ' ');
      });
      if (labels.length < 2) return;
      table.classList.add('ol-mobile-card-table');
      var wrap = table.closest('.table-wrap');
      if (wrap) wrap.classList.add('ol-mobile-card-table-wrap');
      labelTableRows(table, labels);
      var tbody = table.querySelector('tbody');
      if (tbody && 'MutationObserver' in window) {
        var observer = new MutationObserver(function () { labelTableRows(table, labels); });
        observer.observe(tbody, { childList: true, subtree: false });
      }
    });
  }

  function markOffersPage() {
    if (document.getElementById('online-offers') && document.getElementById('consultant-offers')) {
      document.body.classList.add('ol-offers-page');
    }
  }

  function init() {
    buildMenu();
    normalizeCalculatorCtas();
    enhanceFastEntries();
    enhanceTocs();
    enhanceTables();
    markOffersPage();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
