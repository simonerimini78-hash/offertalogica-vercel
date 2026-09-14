(function(){
  'use strict';
  var ANALYTICS_SESSION_KEY='offertalogicaAnalyticsSession';
  var TRAFFIC_ATTRIBUTION_STORAGE_KEY='offertalogicaTrafficAttributionV1';
  var ANALYTICS_EVENT_SEQUENCE_STORAGE_KEY='offertalogica.analytics.session_event_seq.v1';
  var analyticsSequenceMemory=0;
  function analyticsAvailable(){return window.location.protocol==='https:'||/\.vercel\.app$/i.test(window.location.hostname);}
  function text(value,max){return String(value||'').trim().slice(0,max||160);}
  function analyticsSessionId(){
    try{
      var id=sessionStorage.getItem(ANALYTICS_SESSION_KEY);
      if(!id){id=window.crypto&&window.crypto.randomUUID?window.crypto.randomUUID():'ol-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);sessionStorage.setItem(ANALYTICS_SESSION_KEY,id);}
      return id;
    }catch(_error){return '';}
  }
  function analyticsNextSeq(){
    var stored=0;
    try{var parsed=parseInt(sessionStorage.getItem(ANALYTICS_EVENT_SEQUENCE_STORAGE_KEY)||'0',10);stored=Number.isFinite(parsed)&&parsed>0?parsed:0;}catch(_error){}
    var next=Math.max(analyticsSequenceMemory,stored)+1;
    analyticsSequenceMemory=next;
    try{sessionStorage.setItem(ANALYTICS_EVENT_SEQUENCE_STORAGE_KEY,String(next));}catch(_error){}
    return next;
  }
  function referrerHost(){try{return document.referrer?new URL(document.referrer).hostname.toLowerCase():'';}catch(_error){return '';}}
  function attributionFromEntry(){
    var params=new URLSearchParams(window.location.search||'');
    var utmSource=text(params.get('utm_source')||params.get('source'),80).toLowerCase();
    var utmMedium=text(params.get('utm_medium'),80).toLowerCase();
    var referrer=referrerHost();
    var hasGclid=Boolean(params.get('gclid')),hasGbraid=Boolean(params.get('gbraid')),hasWbraid=Boolean(params.get('wbraid')),hasFbclid=Boolean(params.get('fbclid')),hasTtclid=Boolean(params.get('ttclid'));
    var paidSearch=/(?:cpc|ppc|paid[_ -]?search|sem)/i.test(utmMedium);
    var trafficSource='direct';
    if(hasGclid||hasGbraid||hasWbraid||(/google|adwords|gads/i.test(utmSource)&&paidSearch))trafficSource='google_ads';
    else if(/instagram|(^|[_-])ig($|[_-])|linkinbio|reel/i.test(utmSource)||/(^|\.)instagram\.com$/i.test(referrer))trafficSource='instagram';
    else if(/facebook|(^|[_-])fb($|[_-])/i.test(utmSource)||/(^|\.)(facebook|fb)\.com$/i.test(referrer))trafficSource='facebook';
    else if(/tiktok/i.test(utmSource)||/(^|\.)tiktok\.com$/i.test(referrer)||hasTtclid)trafficSource='tiktok';
    else if(/google/i.test(utmSource)||/(^|\.)google\.[a-z.]+$/i.test(referrer))trafficSource=paidSearch?'google_ads':'google_organic';
    else if(utmSource)trafficSource=/meta/i.test(utmSource)?'meta_other':'referral_other';
    else if(hasFbclid)trafficSource='meta_other';
    else if(referrer)trafficSource='referral_other';
    var trafficMedium=utmMedium;
    if(!trafficMedium){if(trafficSource==='google_ads')trafficMedium='cpc';else if(['facebook','instagram','tiktok','meta_other'].includes(trafficSource))trafficMedium='social';else if(trafficSource==='google_organic')trafficMedium='organic';else if(trafficSource==='direct')trafficMedium='direct';else trafficMedium='referral';}
    var clickIdType=hasGclid?'gclid':hasGbraid?'gbraid':hasWbraid?'wbraid':hasTtclid?'ttclid':hasFbclid?'fbclid':'';
    var clickId=hasGclid?params.get('gclid'):hasGbraid?params.get('gbraid'):hasWbraid?params.get('wbraid'):hasTtclid?params.get('ttclid'):hasFbclid?params.get('fbclid'):'';
    return {trafficSource:trafficSource,trafficMedium:trafficMedium,trafficCampaign:text(params.get('utm_campaign'),120),trafficTerm:text(params.get('utm_term')||params.get('keyword'),120),trafficContent:text(params.get('utm_content'),120),trafficCampaignId:text(params.get('campaign_id')||params.get('campaignid'),40),trafficAdGroupId:text(params.get('adgroup_id')||params.get('adgroupid'),40),trafficCreativeId:text(params.get('creative_id')||params.get('creative'),40),trafficMatchType:text(params.get('matchtype'),20).toLowerCase(),trafficDevice:text(params.get('device'),20).toLowerCase(),trafficNetwork:text(params.get('network'),20).toLowerCase(),trafficReferrer:text(referrer,160),trafficLandingPage:text(window.location.pathname||'/',220),trafficClickIdType:clickIdType,trafficClickId:text(clickId,240)};
  }
  function trafficAttribution(){
    try{var existing=JSON.parse(sessionStorage.getItem(TRAFFIC_ATTRIBUTION_STORAGE_KEY)||'null');if(existing&&typeof existing==='object'&&existing.trafficSource)return existing;}catch(_error){}
    var current=attributionFromEntry();try{sessionStorage.setItem(TRAFFIC_ATTRIBUTION_STORAGE_KEY,JSON.stringify(current));}catch(_error){}return current;
  }
  function trackPublicEvent(eventType,payload){
    if(!analyticsAvailable())return;
    var attribution=trafficAttribution();
    var clientTimestamp=new Date().toISOString();
    var sessionEventSeq=analyticsNextSeq();
    var body=JSON.stringify({eventType:eventType,sessionId:analyticsSessionId(),page:window.location.pathname||'/',customerType:'',dataOrigin:'',source:'content',payload:Object.assign({page:window.location.pathname||'/',dataOrigin:'',source:'content',client_timestamp:clientTimestamp,session_event_seq:sessionEventSeq},payload||{},attribution)});
    try{if(navigator.sendBeacon){var blob=new Blob([body],{type:'application/json'});if(navigator.sendBeacon('/api/track-event',blob))return;}}catch(_error){}
    fetch('/api/track-event',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}).catch(function(){});
  }
  function articleMeta(){
    var path=window.location.pathname||'/';
    var slug=decodeURIComponent((path.split('/').pop()||'').replace(/\.html$/i,''));
    var h1=document.querySelector('h1');
    var canonical=document.querySelector('link[rel="canonical"]');
    var category=document.querySelector('meta[property="article:section"]');
    var eyebrow=document.querySelector('.ol-eyebrow');
    return {articleSlug:text(slug,180),articleTitle:text(h1?h1.textContent:document.title,220),articleCategory:text(category?category.getAttribute('content'):(eyebrow?eyebrow.textContent:''),120),articleType:path.indexOf('/articoli/')===0?'editorial':'seo_guide',articleCanonical:text(canonical?canonical.href:'',260)};
  }
  function trackArticleView(){trackPublicEvent('article_view',articleMeta());}
  function trackIubendaChoice(event){
    var target=event&&event.target&&event.target.closest?event.target.closest('.iubenda-cs-accept-btn, .iubenda-cs-reject-btn, .iubenda-cs-customize-btn, .iubenda-tp-btn.iubenda-cs-preferences-link'):null;
    if(!target)return;
    var action='',source='iubenda_banner';
    if(target.matches('.iubenda-cs-accept-btn'))action='accept';
    else if(target.matches('.iubenda-cs-reject-btn'))action='reject';
    else if(target.matches('.iubenda-cs-customize-btn'))action='preferences_opened';
    else if(target.matches('.iubenda-tp-btn.iubenda-cs-preferences-link')){action='preferences_opened';source='iubenda_preferences_button';}
    if(action)trackPublicEvent('cookie_consent_choice',{consentAction:action,consentSource:source});
  }
  document.addEventListener('click',trackIubendaChoice,true);
  trackArticleView();
})();
