// Pure read-side analytics. Input must be ordered by the session event sequence.
export const JOURNEY_ROUTES = Object.freeze(['average','manual','pdf','photo','guided','business','document_unknown']);
export const JOURNEY_LABELS = Object.freeze({average:'vedi subito le offerte',manual:'manuale',pdf:'pdf',photo:'foto bolletta',guided:'3 domande (stima consumi)',business:'business',document_unknown:'documento (origine non attribuibile)'});
export const JOURNEY_STAGES = Object.freeze(['selected','started','completed','generated','legacy','reached','viewed','card','redirect','request']);
const value = (e,k) => e?.payload?.[k] ?? e?.[k];
const str = (e,k) => String(value(e,k) ?? '').trim().toLowerCase();
const typeOf = e => String(e?.eventType || e?.event_type || '');
const preview = e => str(e,'dataOrigin') === 'landing_average_profile';
const version = e => String(value(e,'offersMeasurementVersion') ?? '');
const isMarked = e => version(e) === '141';
const positive = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
export function journeyIsExcluded(e) {
  return value(e,'staffMode') === true || value(e,'demoMode') === true || ['known_bot','automation'].includes(str(e,'trafficAgent'));
}
export function journeyPathChoice(e) {
  const p = str(e,'pathChoice'), t = str(e,'trigger');
  if (['average','media','profilo_medio','arera_average_profile'].includes(p)) return 'average';
  if (['manual','manuale','manual_input'].includes(p)) return 'manual';
  if (['photo','foto','bill_photo'].includes(p) || (['pdf','pdf_upload'].includes(p) && ['photo_camera_choice','photo_deep_link'].includes(t))) return 'photo';
  if (['pdf','pdf_upload'].includes(p)) return 'pdf';
  if (p === 'guided_three_questions') return 'guided';
  return '';
}
const SWITCHO = new Set(['offer_switcho_redirect','switcho_landing_opened','switcho_direct_opened','assistance_switcho_redirect']);
const PARTNER = new Set(['offer_redirect','partner_funnel_opened','provider_site_redirect']);
const REQUEST = new Set(['offer_request_recorded','assistance_callback_verified']);
export const journeyIsSwitchoRedirect = e => SWITCHO.has(typeOf(e)) && !(typeOf(e)==='offer_switcho_redirect' && str(e,'destinationType') === 'affiliazione');
export const journeyIsPartnerRedirect = e => (PARTNER.has(typeOf(e)) || (typeOf(e)==='offer_switcho_redirect' && str(e,'destinationType') === 'affiliazione')) && !journeyIsSwitchoRedirect(e);
export const journeyIsRequest = e => REQUEST.has(typeOf(e));
export function journeyCardClass(e) {
  const origin = str(e,'dataOrigin'), mode = str(e,'mode'), source = str(e,'source');
  if (origin === 'guided_three_questions') return 'estimated';
  if (['manual_input','pdf_upload'].includes(origin) || ['manuale','manual','precise'].includes(mode) || source === 'offer_card_precise') return 'precise';
  if (origin === 'arera_average_profile' || mode === 'media' || source === 'offer_card_media') return 'standard';
  return 'unknown';
}
export function analyzeJourneyEvidence(ordered = []) {
  const routes = Object.fromEntries(JOURNEY_ROUTES.map(k=>[k,Object.fromEntries(JOURNEY_STAGES.map(s=>[s,false]))]));
  const sequence = [], routeByEvent = new Map(), paths = new Set();
  let active = '', documentMode = '', photoAuto = false, photoSeen = false, guidedPending = false;
  let lastCard = null, rank = '', rankReachedAfterClick = false, rankViewed = false, pendingClick = false;
  let generated = false, legacy = false, reached = false, viewed = false, newClick = false, reachedAfterClick = false, viewedAfterClick = false, cardAfterView = false;
  let newTracking = false, legacyJourney = false, explicitCount=0, inferredCount=0;
  let popupAccepted=false, popupDismissed=false, cardPersonalization=false, popupShown=false;
  let popupAcceptedMeasured=false, popupClosedMeasured=false, popupActionUnpaired=false;
  let popupMethod=false, popupCompleted=false, popupViewed=false, popupCard=false, popupAttempt='', popupRank='';
  const personalRoutes = new Set(['manual','pdf','photo','guided']);
  let guidedStarted=false, guidedCompleted=false, businessCalculated=false, businessRequested=false, switcho=false, partner=false, request=false, verified=false, otpAfterSent=false, sent=false;
  const mark = (r,s) => { if(routes[r]) routes[r][s]=true; };
  function select(r,basis) {
    if (!routes[r]) return;
    paths.add(r); mark(r,'selected');
    if(popupAcceptedMeasured && personalRoutes.has(r)) popupMethod=true;
    const prev=sequence.at(-1);
    if (prev?.path===r) { if(basis==='registrato') prev.basis=basis; }
    else { sequence.push({path:r,basis}); if(basis==='registrato')explicitCount++;else inferredCount++; }
    if(popupAcceptedMeasured && r!==active){ popupAttempt=''; popupRank=''; }
    if(active!==r){ rank=''; lastCard=null; rankViewed=false; rankReachedAfterClick=false; if(r!=='average')pendingClick=false; if(active==='photo'&&r!=='photo')photoAuto=false; }
    active=r;
  }
  function originRoute(e) {
    if (str(e,'customerType')==='business' || str(e,'dataOrigin')==='business_profile' || typeOf(e).startsWith('business_')) return 'business';
    const o=str(e,'dataOrigin');
    if(o==='arera_average_profile') return 'average';
    if(o==='guided_three_questions') return 'guided';
    if(o==='manual_input') return 'manual';
    if(o==='pdf_upload') {
      if(documentMode==='photo') return photoAuto ? 'photo' : 'document_unknown';
      if(documentMode==='pdf') return 'pdf';
      // Historical document results can be inferred as PDF only if no photo evidence competes.
      return photoSeen ? 'document_unknown' : 'pdf';
    }
    return '';
  }
  for(const e of ordered){
    if(journeyIsExcluded(e)) continue;
    const t=typeOf(e);
    if(isMarked(e)) newTracking=true;
    if(!preview(e)&&!isMarked(e)&&['landing_self_service_click','offers_rendered','offers_viewed'].includes(t))legacyJourney=true;
    if(t==='landing_self_service_click' && isMarked(e)){newClick=true;pendingClick=true;rank='';rankViewed=false;rankReachedAfterClick=false;}
    if(t==='comparison_path_selected'){
      const p=journeyPathChoice(e), trigger=str(e,'trigger');
      // The three-question wizard internally activates the average calculator.
      if(p==='average'&&(guidedPending||(active==='guided'&&trigger==='comparison_submit')))continue;
      if(p&&p!=='average')pendingClick=false;
      if(p==='photo'){photoSeen=true;photoAuto=false;documentMode='photo';}
      if(p==='pdf' && !(documentMode==='photo' && trigger==='comparison_submit')){documentMode='pdf';photoAuto=false;}
      if(p&&!(p==='pdf'&&documentMode==='photo')){select(p,'registrato');routeByEvent.set(e,p);}
      if(p&&p!=='guided')guidedPending=false;
      continue;
    }
    if(t==='guided_three_questions_started'||t==='guided_three_questions_completed'){
      guidedPending=t==='guided_three_questions_started'; guidedStarted ||= t==='guided_three_questions_started'; guidedCompleted ||= t==='guided_three_questions_completed';
      select('guided','registrato');routeByEvent.set(e,'guided');continue;
    }
    if(t==='manual_known_consumption_selected'){guidedPending=false;select('manual','registrato');routeByEvent.set(e,'manual');continue;}
    if(t.startsWith('bill_photo_')){
      if(t==='bill_photo_server_diagnostic')continue;
      photoSeen=true;
      if(['bill_photo_camera_opened','bill_photo_gallery_opened','bill_photo_selected','bill_photo_analysis_started'].includes(t)){documentMode='photo';photoAuto=false;select('photo','inferito');}
      if(t==='bill_photo_comparison_auto_started' || (t==='bill_photo_analysis_completed'&&value(e,'comparisonAutoStarted')===true)){
        // A late result must not overwrite an intervening explicit choice.
        if(!active){documentMode='photo';select('photo','inferito');}
        if(documentMode==='photo'&&active==='photo') photoAuto=true;
      }
      if(t==='bill_photo_analysis_failed')photoAuto=false;
      routeByEvent.set(e,'photo');continue;
    }
    if(t.startsWith('pdf_')){
      // Photo uses the PDF engine; only explicit picker/file/analysis evidence establishes the PDF branch.
      if(['pdf_picker_opened','pdf_file_selected','pdf_analysis_started'].includes(t)){
        documentMode='pdf';photoAuto=false;select('pdf','inferito');
      }else if(!documentMode){documentMode='pdf';select('pdf','inferito');}
      routeByEvent.set(e,documentMode==='photo'?'photo':'pdf');continue;
    }
    if(t==='offers_bill_prompt_clicked'){
      const source=str(e,'pdfUploadSource');
      if(source==='offers_personalization')popupAccepted=true;
      else if(['offer_card','offer_path','offer_card_media','optional_offer_card'].includes(source))cardPersonalization=true;
    }
    if(t==='offers_bill_prompt_dismissed')popupDismissed=true;
    if(['offers_bill_prompt_shown','offers_bill_prompt_accepted','offers_bill_prompt_closed'].includes(t) && str(e,'trigger')==='landing_average_recovery' && str(e,'dataOrigin')==='arera_average_profile' && str(e,'pdfUploadSource')==='offers_personalization'){
      if(t==='offers_bill_prompt_shown') popupShown=true;
      else if(t==='offers_bill_prompt_accepted'){
        if(popupShown && !popupClosedMeasured) popupAcceptedMeasured=true;
        else if(!popupAcceptedMeasured) popupActionUnpaired=true;
      }else if(t==='offers_bill_prompt_closed'){
        if(popupShown && !popupAcceptedMeasured) popupClosedMeasured=true;
        else if(!popupClosedMeasured) popupActionUnpaired=true;
      }
      continue;
    }
    if(t==='otp_sent')sent=true;
    if(t==='otp_verified'){verified=true;if(sent)otpAfterSent=true;}
    if(t==='business_switcho_requested')businessRequested=true;
    if(journeyIsSwitchoRedirect(e))switcho=true;
    if(journeyIsPartnerRedirect(e))partner=true;
    if(journeyIsRequest(e))request=true;
    if(preview(e))continue;
    const relevant=['comparison_started','comparison_completed','comparison_incomplete_data','comparison_missing_current_price','offers_rendered','offers_reached','offers_viewed','offer_card_clicked','business_calculation_completed','business_calculation_incomplete'].includes(t);
    if(!relevant && !journeyIsSwitchoRedirect(e)&&!journeyIsPartnerRedirect(e)&&!journeyIsRequest(e))continue;
    let r=originRoute(e);
    if(t==='business_calculation_completed'||t==='business_calculation_incomplete')r='business';
    if(!relevant){
      const offerId=String(value(e,'offerId')||'');
      r=lastCard&&offerId&&offerId===lastCard.id?lastCard.route:'';
    }
    if(r){select(r,'inferito');routeByEvent.set(e,r);}
    if(t==='comparison_started'){mark(r,'started');lastCard=null;rank='';rankViewed=false;rankReachedAfterClick=false;if(popupAcceptedMeasured){popupAttempt=personalRoutes.has(r)?r:'';popupRank='';if(popupAttempt)popupMethod=true;}}
    if(t==='comparison_completed'){mark(r,'completed');}
    if(t==='business_calculation_completed'){businessCalculated=true;mark(r,'completed');if(positive(value(e,'rankingOffersCount')))mark(r,'generated');}
    if(t==='offers_rendered'){
      const count=value(e,'visibleOffersCount');
      const valid=positive(count)||(!isMarked(e)&&(count===null||count===undefined||count===''));
      rank=r;lastCard=null;rankViewed=false;rankReachedAfterClick=false;
      if(valid){generated=true;mark(r,'generated');if(!isMarked(e)){legacy=true;mark(r,'legacy');}if(popupAcceptedMeasured&&popupAttempt&&popupAttempt===r){popupCompleted=true;popupRank=r;}else popupRank='';}
    }
    if(t==='offers_reached'&&isMarked(e)){
      reached=true;mark(r,'reached');
      if(rank!==r){rank=r;rankViewed=false;rankReachedAfterClick=false;}
      if(pendingClick&&r==='average'){reachedAfterClick=true;rankReachedAfterClick=true;}
    }
    if(t==='offers_viewed'){
      viewed=true;mark(r,'viewed');
      if(rank!==r){rank=r;rankReachedAfterClick=false;}
      rankViewed=true;
      if(popupRank&&popupRank===r)popupViewed=true;
      if(rankReachedAfterClick&&pendingClick&&r==='average'&&isMarked(e))viewedAfterClick=true;
    }
    if(t==='offer_card_clicked'){lastCard={id:String(value(e,'offerId')||''),route:r};mark(r,'card');if(rank&&r===rank&&rankViewed)cardAfterView=true;if(popupRank&&popupRank===r&&rankViewed)popupCard=true;}
    if(r&&(journeyIsSwitchoRedirect(e)||journeyIsPartnerRedirect(e)))mark(r,'redirect');
    if(r&&journeyIsRequest(e))mark(r,'request');
  }
  return {routes,routeByEvent,sequence,paths,latest:sequence.at(-1)?.path||'',hasExplicit:explicitCount>0,hasInferred:inferredCount>0,
    generated,legacy,reached,viewed,newTracking,mode:newTracking?(legacyJourney?'misto':'nuovo'):(viewed?'transizione':'storico'),newClick,reachedAfterClick,viewedAfterClick,cardAfterView,
    popupAccepted,popupDismissed,popupShown,popupAcceptedMeasured,popupClosedMeasured,popupActionUnpaired,popupMethod,popupCompleted,popupViewed,popupCard,cardPersonalization,guidedStarted,guidedCompleted,businessCalculated,businessRequested,switcho,partner,request,verified,otpAfterSent};
}
export function aggregateJourneyRoutes(items=[]) {
  const result=Object.fromEntries(JOURNEY_ROUTES.map(k=>[k,Object.fromEntries(JOURNEY_STAGES.map(s=>[s,0]))]));
  for(const item of items)for(const k of JOURNEY_ROUTES)for(const s of JOURNEY_STAGES)if(item?.[k]?.[s])result[k][s]++;
  return result;
}
