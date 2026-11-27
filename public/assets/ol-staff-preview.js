/* OffertaLogica Staff preview 0.10.145. Runs synchronously before page scripts. */
(function () {
  'use strict';
  if (window.OLStaffPreview) return;
  const key = 'offertalogicaStaffMode';
  const proofKey = 'offertalogicaStaffPreviewProof';
  const mobileKey = 'offertalogicaStaffMobilePreview';
  let active = false, mobile = false;
  try {
    const params = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.slice(1));
    active = sessionStorage.getItem(key) === 'true' || ['staffPreview','staffToken','previewToken'].some(k => params.has(k) || hash.has(k)) || ['staff'].some(k => [params.get(k),hash.get(k)].some(v=>v && v!=='off'));
    mobile = active && sessionStorage.getItem(mobileKey) === 'true';
    // A framed preview must fail closed if the browser denies storage.
    if (!active && window !== window.top && window.parent.document.getElementById('ol-staff-phone')) active = mobile = true;
  } catch (_) { if (window !== window.top) active = mobile = true; }
  function message(text) {
    if (mobile && window !== window.top) {
      try { window.parent.OLStaffPhoneNotice(text); return; } catch (_) {}
    }
    const draw = () => {
      let box = document.getElementById('ol-staff-notice');
      if (!box) { box = document.createElement('div'); box.id = 'ol-staff-notice'; box.setAttribute('role','status'); box.style.cssText='position:fixed;top:8px;left:8px;right:8px;z-index:2147483647;background:#17342c;color:white;padding:12px;border-radius:8px;font:14px system-ui;cursor:pointer'; box.onclick=()=>box.remove(); document.body.append(box); }
      box.textContent = text;
    };
    if (document.body) draw(); else document.addEventListener('DOMContentLoaded',draw,{once:true});
  }
  function external(value) {
    let host=''; try { host=new URL(value,location.href).hostname; } catch (_) {}
    message('Verifica Staff: apertura esterna non eseguita' + (host ? ' ('+host+')' : '') + '. Nessun invio commerciale.');
  }
  function loadGoogleTag(ids) {
    if (active) { window.gtag = function () {}; return; }
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js',new Date()); ids.forEach(id=>window.gtag('config',id));
    const script=document.createElement('script'); script.async=true; script.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(ids[0]); document.head.appendChild(script);
  }
  window.OLStaffPreview = Object.freeze({active, mobile, external, loadGoogleTag});
  if (!active) return;
  window.gtag = function () {};
  const nativeFetch = window.fetch.bind(window);
  const blocked = new Set(['/api/lead','/api/send-otp','/api/verify-otp','/api/offer-consent','/api/unlock-offers']);
  function response(status,body) { return Promise.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})); }
  function urlOf(input) { return new URL(input instanceof Request ? input.url : String(input), location.href); }
  window.fetch = function (input, init) {
    let url; try { url=urlOf(input); } catch (_) { return nativeFetch(input,init); }
    if (url.origin === location.origin) {
      if (url.pathname === '/api/track-event') return response(200,{ok:true,skipped:true,reason:'staff_preview'});
      if (blocked.has(url.pathname)) {
        message('Verifica Staff: invio reale disattivato.');
        return response(403,{ok:false,code:'staff_preview_no_write',error:'Invio reale disattivato durante la verifica Staff.'});
      }
      if (url.pathname === '/api/analyze-pdf') {
        let proof=''; try { proof=sessionStorage.getItem(proofKey)||''; } catch (_) {}
        if (!proof) return response(403,{ok:false,code:'staff_preview_proof_missing',error:'Riapri Verifica sito dal gestionale per analizzare documenti senza archiviarli.'});
        const headers=new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)); headers.set('X-OL-Staff-Preview',proof);
        return nativeFetch(input,{...init,headers});
      }
    }
    return nativeFetch(input,init);
  };
  if (navigator.sendBeacon) navigator.sendBeacon = function () { return true; };
  const nativeOpen=window.open.bind(window);
  window.open=function (url,target,features) {
    if ((!url || url==='about:blank') && !mobile) return nativeOpen(url,target,features);
    try { const dest=new URL(url,location.href); if (dest.origin===location.origin && mobile) { location.assign(dest.href); return null; } } catch (_) {}
    external(url); return null;
  };
  document.addEventListener('click',event=>{
    const a=event.target?.closest?.('a[href]'); if (!a) return;
    let dest; try { dest=new URL(a.href,location.href); } catch (_) { return; }
    const internal=dest.origin===location.origin || (dest.protocol==='https:' && ['offertalogica.it','www.offertalogica.it'].includes(dest.hostname));
    if (!internal) { event.preventDefault(); event.stopImmediatePropagation(); external(dest.href); return; }
    if (mobile && /^\/(?:staff(?:[-/]|\.html|$)|redazione(?:\.html|$)|collaboratori(?:\.html|$)|registrazione-editoriale(?:\.html|$)|recupera-password(?:\.html|$)|video-studio(?:\.html|$)|api\/)/.test(dest.pathname)) { event.preventDefault(); event.stopImmediatePropagation(); message('Area riservata: esci dall’anteprima mobile per accedervi.'); return; }
    if (dest.searchParams.get('staff')==='off') { event.preventDefault(); event.stopImmediatePropagation(); message('Chiudi la finestra per terminare la verifica Staff.'); return; }
    // Never open a fresh tab without the isolated session context.
    if (dest.origin!==location.origin || (a.target && a.target!=='_self') || event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation(); location.assign(dest.pathname+dest.search+dest.hash);
    }
  },true);
  document.addEventListener('auxclick',event=>{ if (event.target?.closest?.('a[href]')) { event.preventDefault(); event.stopImmediatePropagation(); } },true);
  document.addEventListener('submit',event=>{ const form=event.target; if (String(form.method).toLowerCase()==='post' || (form.target && form.target!=='_self')) { event.preventDefault(); event.stopImmediatePropagation(); message('Verifica Staff: invio reale disattivato.'); } },true);
})();
