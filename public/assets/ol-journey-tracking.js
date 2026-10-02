/* OffertaLogica journey tracking - release 0.10.43 */
(function () {
  'use strict';
  if (window.__OL_JOURNEY_TRACKING_READY__) return;
  window.__OL_JOURNEY_TRACKING_READY__ = true;

  var SESSION_KEY = 'offertalogicaAnalyticsSession';
  var SEQUENCE_KEY = 'offertalogica.analytics.session_event_seq.v1';
  var ATTRIBUTION_KEY = 'offertalogicaTrafficAttributionV1';
  var STAFF_KEY = 'offertalogicaStaffMode';

  function text(value, max) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 160);
  }

  function staffTrackingExcluded() {
    try {
      if (sessionStorage.getItem(STAFF_KEY) === 'true') return true;
    } catch (error) {}
    try {
      var query = new URLSearchParams(window.location.search || '');
      var hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
      var staffValue = hash.get('staff') || query.get('staff') || '';
      if (staffValue === 'off') return false;
      return Boolean(
        hash.get('staffPreview') || query.get('staffPreview') ||
        hash.get('staffToken') || query.get('staffToken') ||
        hash.get('previewToken') || query.get('previewToken') ||
        (staffValue && staffValue !== 'off')
      );
    } catch (error) {
      return false;
    }
  }

  function trackingAvailable() {
    return window.location.protocol === 'https:' || /\.vercel\.app$/i.test(window.location.hostname);
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : 'ol-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (error) {
      return '';
    }
  }

  function nextSequence() {
    try {
      var stored = Number.parseInt(sessionStorage.getItem(SEQUENCE_KEY) || '0', 10);
      var next = (Number.isFinite(stored) && stored > 0 ? stored : 0) + 1;
      sessionStorage.setItem(SEQUENCE_KEY, String(next));
      return next;
    } catch (error) {
      return null;
    }
  }

  function attribution() {
    try {
      var value = JSON.parse(sessionStorage.getItem(ATTRIBUTION_KEY) || 'null');
      return value && typeof value === 'object' ? value : {};
    } catch (error) {
      return {};
    }
  }

  function serviceFromPath(path) {
    var normalized = String(path || '').toLowerCase();
    if (/\/internet-casa\.html(?:$|[?#])/.test(normalized)) return 'internet_casa';
    if (/\/casa-smart\.html(?:$|[?#])/.test(normalized)) return 'casa_smart';
    if (/\/simulatore-bolletta\.html(?:$|[?#])/.test(normalized)) return 'simulatore_bolletta';
    if (/\/fotovoltaico\.html(?:$|[?#])/.test(normalized)) return 'fotovoltaico';
    if (/\/speed-test\.html(?:$|[?#])/.test(normalized)) return 'speed_test';
    if (/\/fornitori\//.test(normalized)) return 'fornitori';
    return text(normalized.replace(/^\/+|\.html$/g, '').replace(/[^a-z0-9]+/g, '_'), 100) || 'sito';
  }

  function placementFor(element) {
    if (!element || !element.closest) return 'pagina';
    if (element.closest('header')) return 'header';
    if (element.closest('footer')) return 'footer';
    if (element.closest('nav')) return 'navigazione';
    if (element.closest('[role="dialog"], dialog')) return 'dialog';
    var section = element.closest('section, article, main, aside');
    if (section) return text(section.id || section.getAttribute('aria-label') || section.className, 100) || 'contenuto';
    return 'pagina';
  }

  function itemFor(element) {
    if (!element) return '';
    return text(
      element.getAttribute('data-discovery-link') ||
      element.getAttribute('data-ol-nav') ||
      element.getAttribute('aria-label') ||
      element.id ||
      element.textContent ||
      '',
      160
    );
  }

  function actionKind(element) {
    if (!element) return 'azione';
    if (element.matches && element.matches('a[href]')) return 'link';
    if (element.tagName === 'SUMMARY') return 'summary';
    if (element.tagName === 'BUTTON') return 'button';
    return text(element.getAttribute && element.getAttribute('role'), 40) || 'azione';
  }

  function send(eventType, payload) {
    if (!trackingAvailable() || staffTrackingExcluded()) return;
    var page = window.location.pathname || '/';
    var traffic = attribution();
    var body = JSON.stringify({
      eventType: eventType,
      sessionId: sessionId(),
      page: page,
      source: 'site_journey',
      payload: Object.assign({
        page: page,
        source: 'site_journey',
        service: serviceFromPath(page),
        client_timestamp: new Date().toISOString(),
        session_event_seq: nextSequence()
      }, traffic, payload || {})
    });
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/track-event', blob)) return;
      }
    } catch (error) {}
    try {
      fetch('/api/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (error) {}
  }

  function trackPageView() {
    send('site_page_view', {
      referrer: text(document.referrer, 260)
    });
  }

  function trackAction(event) {
    var target = event && event.target && event.target.closest
      ? event.target.closest('a[href],button,summary,[role="button"]')
      : null;
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
    var href = target.matches('a[href]') ? target.getAttribute('href') || '' : '';
    send('site_action_clicked', {
      item: itemFor(target),
      destination: text(href, 260),
      placement: placementFor(target),
      actionKind: actionKind(target)
    });
  }

  document.addEventListener('click', trackAction, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView, { once: true });
  } else {
    trackPageView();
  }
})();
