(function(){
  'use strict';
  const TOOL_VERSION='security-energy-v0.1.5';
  const TOOL_CODE='sicurezza_energia';
  const SOURCE='seo_sicurezza_energia';
  const TRACK_URL='/api/track-event';
  const root=document.getElementById('security-tool');
  if(!root)return;

  const providerSources={
    enel:{label:'Enel Energia — verifica chi ti ha chiamato',url:'https://www.enel.it/it-it/assistenza/luce-gas/verifica-chi-ti-ha-chiamato',mode:'verifier'},
    plenitude:{label:'Plenitude — verifica numero telefonico',url:'https://eniplenitude.com/verifica-numero-telefonico',mode:'verifier'},
    acea:{label:'Acea Energia — riconosci le truffe',url:'https://www.aceaenergia.it/trova-e-risolvi/riconosci-le-truffe',mode:'verifier'},
    a2a:{label:'A2A Energia — verifica chiamate sospette',url:'https://www.a2a.it/assistenza/chiamate-sospette',mode:'verifier'},
    iren:{label:'Iren — istruzioni per “Verifica agente” in IrenYou',url:'https://www.irenlucegas.it/assistenza/gestisci-il-tuo-contratto/telefonate-sospette-cosa-fare',mode:'verifier_area'},
    sorgenia:{label:'Sorgenia — guida alle telefonate sospette',url:'https://www.sorgenia.it/partnership-consigli-pratici-telefonate-sospette',mode:'guidance'},
    illumia:{label:'Illumia — controllo chiamate',url:'https://www.illumia.it/',mode:'verifier'},
    edison:{label:'Edison Energia — sito ufficiale',url:'https://www.edisonenergia.it/',mode:'official_site'},
    authority:{label:'ARERA — sito ufficiale consumatori',url:'https://www.arera.it/consumatori',mode:'guidance'}
  };
  const identityLabels={enel:'Enel Energia',plenitude:'Plenitude',edison:'Edison Energia',iren:'Iren',a2a:'A2A Energia',acea:'Acea Energia',sorgenia:'Sorgenia',illumia:'Illumia',other_provider:'Altro fornitore',distributor:'Distributore',authority:'ARERA / Autorità',current_supplier:'“Il tuo fornitore”',association:'Associazione consumatori',unknown:'Non ricordo'};
  const claimLabels={contract_expiring:'contratto in scadenza',price_increase:'aumento del prezzo',must_switch:'obbligo di cambiare fornitore',technical_problem:'problema tecnico/amministrativo',suspension:'rischio di sospensione',guaranteed_saving:'risparmio certo'};
  const requestLabels={pod_pdr:'POD/PDR',bill:'bolletta',tax_code:'codice fiscale',document:'documento',iban:'IBAN',payment:'carta/pagamento',password_pin:'password/PIN',otp:'OTP/codice SMS'};
  const highRiskRequests=new Set(['password_pin','otp']);
  let normalizedPhone='';
  let hasTrackedStart=false;
  let currentDiagnosis=null;

  const sessionId=(()=>{try{if(globalThis.crypto&&crypto.randomUUID)return crypto.randomUUID();}catch(e){}return 'sec-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);})();
  function isStaffPreview(){try{return sessionStorage.getItem('offertalogicaStaffMode')==='true';}catch(e){return false;}}
  function track(action,detail){
    if(isStaffPreview())return;
    detail=detail||{};
    const actionMap={page_view:'page_view',started:'started',step_completed:'completed',diagnosis_completed:'diagnosis_completed',source_clicked:'cta_clicked',source_outcome:'completed',offer_cta:'cta_clicked',after_contract_cta:'cta_clicked',restart:'started',error:'error'};
    const payload={toolCode:TOOL_CODE,toolAction:actionMap[action]||'started',toolOutcome:String(detail.outcome||'').slice(0,100),toolContext:[action,String(detail.context||'').trim()].filter(Boolean).join(':').slice(0,80),toolVersion:TOOL_VERSION,source:SOURCE,page:location.pathname,customerType:'consumer',dataOrigin:SOURCE};
    fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventType:'interactive_tool_event',sessionId:sessionId,page:location.pathname,customerType:'consumer',dataOrigin:SOURCE,source:SOURCE,payload:payload}),credentials:'same-origin',keepalive:true}).catch(function(){});
  }
  function normalizePhone(value){
    let raw=String(value||'').trim();
    if(!raw)return {ok:false,error:'Inserisci il numero visualizzato sul telefono.'};
    raw=raw.replace(/[\s().-]/g,'');
    if(raw.startsWith('0039'))raw=raw.slice(4);else if(raw.startsWith('+39'))raw=raw.slice(3);else if(raw.startsWith('+')||raw.startsWith('00'))return {ok:false,error:'Per questa versione inserisci una numerazione italiana.'};
    if(!/^\d+$/.test(raw))return {ok:false,error:'Il numero contiene caratteri non riconosciuti.'};
    if(raw.length<6||raw.length>12)return {ok:false,error:'Controlla il numero: la lunghezza non sembra valida per una numerazione italiana.'};
    return {ok:true,value:raw,display:raw};
  }
  function selectedIdentity(){const el=root.querySelector('input[name="declared-identity"]:checked');return el?el.value:'';}
  function checkedValues(selector){return Array.from(root.querySelectorAll(selector+':checked')).map(function(el){return el.value;});}
  function behavior(name){const el=root.querySelector('[data-behavior="'+name+'"]');return el?el.value:'unknown';}
  function sourceOutcome(name){const el=root.querySelector('[data-source-outcome="'+name+'"]');return el?el.value:'not_checked';}
  function emptyChoice(group){const el=root.querySelector('[data-empty-group="'+group+'"]:checked');return el?el.value:'';}
  function signalGroupAnswered(group){const selector=group==='claims'?'[data-claim]':'[data-request]';return checkedValues(selector).length>0||Boolean(emptyChoice(group));}
  function validateSignals(){
    const groups=['claims','requests'];
    let firstError=null;
    groups.forEach(function(group){
      const ok=signalGroupAnswered(group);
      const error=root.querySelector('[data-signal-error="'+group+'"]');
      const fieldset=root.querySelector('[data-signal-group="'+group+'"]');
      if(error){error.hidden=ok;if(!ok&&!firstError)firstError=error;}
      if(fieldset)fieldset.setAttribute('aria-invalid',ok?'false':'true');
    });
    if(firstError){const reduceMotion=globalThis.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;firstError.focus({preventScroll:true});firstError.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'center'});return false;}
    return true;
  }
  function showStep(name){
    root.dataset.step=name;
    let activeStep=null;
    root.querySelectorAll('[data-security-step]').forEach(function(step){const isActive=step.getAttribute('data-security-step')===name;step.hidden=!isActive;if(isActive)activeStep=step;});
    const order=['phone','identity','signals','result'];
    const current=order.indexOf(name);
    root.querySelectorAll('[data-progress]').forEach(function(item){const idx=order.indexOf(item.getAttribute('data-progress'));item.classList.toggle('active',idx<=current);if(idx===current)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');const line=item.nextElementSibling;if(line&&line.tagName==='I')line.classList.toggle('active',idx<current);});
    if(name!=='phone'){const reduceMotion=globalThis.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;root.scrollIntoView({behavior:reduceMotion?'auto':'smooth',block:'start'});if(activeStep)requestAnimationFrame(function(){activeStep.focus({preventScroll:true});});}
  }
  function joinNatural(items){if(!items.length)return '';if(items.length===1)return items[0];return items.slice(0,-1).join(', ')+' e '+items[items.length-1];}
  function levelRank(level){return level==='high'?2:(level==='review'?1:0);}
  function maxLevel(a,b){return levelRank(a)>=levelRank(b)?a:b;}
  function diagnose(){
    const identity=selectedIdentity()||'unknown';
    const claims=checkedValues('[data-claim]');
    const requests=checkedValues('[data-request]');
    const urgency=behavior('urgency');
    const contract=behavior('contract');
    const unexpected=behavior('unexpected');
    const accepted=behavior('accepted');
    const claimsFallback=emptyChoice('claims');
    const requestsFallback=emptyChoice('requests');
    const highRequests=requests.filter(function(v){return highRiskRequests.has(v);});
    let points=0;
    if(highRequests.length)points+=4;
    if(requests.includes('payment'))points+=3;
    if(requests.includes('iban'))points+=2;
    if(requests.includes('document')||requests.includes('tax_code'))points+=1;
    if(requests.includes('pod_pdr')||requests.includes('bill'))points+=1;
    if(urgency==='yes')points+=2;
    if(unexpected==='yes')points+=1;
    if(claims.includes('suspension')||claims.includes('must_switch'))points+=2;
    if(claims.includes('technical_problem')||claims.includes('contract_expiring')||claims.includes('price_increase')||claims.includes('guaranteed_saving'))points+=1;
    if(identity==='authority'&&(contract==='yes'||requests.length>0))points+=3;
    let level='low';
    if(highRequests.length||points>=6)level='high';else if(points>=2)level='review';
    const requestText=requests.map(function(v){return requestLabels[v];}).filter(Boolean);
    const claimText=claims.map(function(v){return claimLabels[v];}).filter(Boolean);
    const signalParts=[];
    if(claimText.length)signalParts.push('Hai indicato: '+joinNatural(claimText)+'.');
    if(requestText.length)signalParts.push('Ti sono stati chiesti: '+joinNatural(requestText)+'.');
    if(urgency==='yes')signalParts.push('Hai segnalato fretta o pressione.');
    if(unexpected==='yes')signalParts.push('La chiamata era inattesa.');
    if(contract==='yes')signalParts.push('Era presente una proposta di attivazione o cambio.');
    if(accepted==='yes')signalParts.push('Hai indicato di aver già accettato o confermato.');
    if(!claims.length&&claimsFallback==='none')signalParts.push('Non hai riconosciuto nessuna delle frasi proposte.');
    if(!claims.length&&claimsFallback==='unknown')signalParts.push('Non ricordi abbastanza bene le frasi usate durante la chiamata.');
    if(!requests.length&&requestsFallback==='none')signalParts.push('Non hai riconosciuto nessuna delle richieste di dati proposte.');
    if(!requests.length&&requestsFallback==='unknown')signalParts.push('Non ricordi abbastanza bene quali dati ti siano stati chiesti.');
    if(!signalParts.length)signalParts.push('Non emergono altri comportamenti specifici dalle risposte inserite.');
    return {identity:identity,claims:claims,requests:requests,claimsFallback:claimsFallback,requestsFallback:requestsFallback,urgency:urgency,contract:contract,unexpected:unexpected,accepted:accepted,level:level,points:points,signalText:signalParts.join(' ')};
  }
  function configureProviderSource(identity){
    const providerLink=root.querySelector('[data-provider-source]');
    const providerFeedback=root.querySelector('[data-provider-feedback]');
    const providerOutcome=root.querySelector('[data-source-outcome="provider"]');
    const providerNote=root.querySelector('[data-provider-source-note]');
    const source=providerSources[identity];
    if(source){
      providerLink.href=source.url;
      providerLink.textContent=source.label;
      providerLink.hidden=false;
      providerLink.dataset.sourceMode=source.mode;
    }else{
      providerLink.hidden=true;
      providerLink.removeAttribute('href');
      delete providerLink.dataset.sourceMode;
    }
    const canReport=Boolean(source&&(source.mode==='verifier'||source.mode==='verifier_area'));
    providerFeedback.hidden=!canReport;
    if(providerOutcome){providerOutcome.disabled=!canReport;if(!canReport)providerOutcome.value='not_checked';}
    const providerName=root.querySelector('[data-provider-feedback-name]');
    if(providerName)providerName.textContent=identityLabels[identity]||'soggetto dichiarato';
    if(providerNote){
      providerNote.hidden=false;
      if(source&&source.mode==='verifier_area')providerNote.textContent='La pagina ufficiale spiega come usare “Verifica agente” nell’Area Riservata IrenYou. Se completi lì il controllo, puoi riportare qui sotto soltanto l’esito.';
      else if(canReport)providerNote.textContent='Questa fonte consente un controllo del numero: dopo averlo eseguito puoi riportare qui sotto soltanto l’esito.';
      else if(source&&source.mode==='official_site')providerNote.textContent='Questo è il sito ufficiale del soggetto dichiarato, non un checker del numero. Usa soltanto i recapiti e i servizi ufficiali disponibili sul sito, senza riportare un esito come conferma.';
      else if(source)providerNote.textContent='Questa è una pagina ufficiale di orientamento, non un checker del numero utilizzato dal tool. Usala per verificare i canali corretti senza riportare un esito come conferma.';
      else if(identity==='current_supplier')providerNote.textContent='Se hanno detto soltanto “il tuo fornitore”, controlla prima il nome del venditore sulla bolletta e poi usa esclusivamente il suo sito o la sua app ufficiale.';
      else if(identity==='unknown')providerNote.textContent='Se non ricordi chi dichiarava di essere il chiamante, non dedurre l’identità dal solo numero: usa il Registro AGCOM come primo riscontro e interrompi ogni passaggio che richieda dati sensibili.';
      else providerNote.textContent='Per questo soggetto non proponiamo un checker ufficiale del numero. Verifica l’identità partendo dal sito o dai recapiti ufficiali del soggetto che ritieni coinvolto.';
    }
  }
  function assessSources(diagnosis){
    const agcom=sourceOutcome('agcom');
    const provider=sourceOutcome('provider');
    let state='not_checked';
    let sourceLevel='neutral';
    let level=diagnosis.level;
    let text='';

    if(agcom==='found'&&provider==='confirmed'){
      state='double_match';
      sourceLevel='confirmed';
      text='Hai indicato due riscontri: la numerazione compare nel Registro AGCOM e la fonte ufficiale del soggetto dichiarato conferma il numero. Sono elementi coerenti, ma non certificano da soli chi stava materialmente effettuando la chiamata.';
    }else if(agcom==='not_found'&&provider==='confirmed'){
      state='provider_match_roc_missing';
      sourceLevel='mixed';
      text='Hai indicato che la fonte ufficiale del soggetto dichiarato conferma il numero, mentre nel Registro AGCOM non hai trovato una corrispondenza. I due esiti hanno significati diversi: l’assenza nel ROC non annulla automaticamente la conferma del fornitore.';
    }else if(agcom==='found'&&provider==='not_confirmed'){
      state='roc_match_provider_missing';
      sourceLevel='review';
      level=maxLevel(level,'review');
      text='Hai indicato che la numerazione compare nel Registro AGCOM, ma non è confermata dalla fonte ufficiale del soggetto dichiarato. Il ROC può riferirsi a un’impresa di call center diversa dal marchio dichiarato: l’identità della chiamata resta da approfondire.';
    }else if(agcom==='not_found'&&provider==='not_confirmed'){
      state='no_match';
      sourceLevel='review';
      level=maxLevel(level,'review');
      text='Non hai trovato una corrispondenza nel Registro AGCOM e hai indicato che la fonte ufficiale del soggetto dichiarato non conferma il numero. Questo non prova una frode, ma non fornisce una conferma dell’identità dichiarata.';
    }else if(provider==='confirmed'){
      state='provider_match';
      sourceLevel='confirmed';
      text='Hai indicato che la fonte ufficiale del soggetto dichiarato conferma il numero. È un riscontro utile, ma non certifica da solo chi stava materialmente effettuando la chiamata.';
    }else if(provider==='not_confirmed'){
      state='provider_missing';
      sourceLevel='review';
      level=maxLevel(level,'review');
      text='Hai indicato che la fonte ufficiale del soggetto dichiarato non conferma il numero. L’identità dichiarata resta quindi non confermata; verifica attraverso i recapiti ufficiali prima di proseguire.';
    }else if(agcom==='found'){
      state='roc_match';
      text='Hai indicato che la numerazione compare nel Registro AGCOM. Il registro identifica una numerazione dichiarata al ROC, ma non certifica da solo il soggetto che stava parlando né il contenuto della proposta.';
    }else if(agcom==='not_found'){
      state='roc_missing';
      text='Non hai trovato una corrispondenza nel Registro AGCOM. Questo risultato, da solo, non significa che il numero sia fraudolento.';
    }

    const status=root.querySelector('[data-source-status]');
    if(state==='not_checked'){
      status.hidden=true;
      status.textContent='';
      status.dataset.sourceLevel='neutral';
    }else{
      status.hidden=false;
      status.textContent=text;
      status.dataset.sourceLevel=sourceLevel;
    }
    return {level:level,state:state,sourceLevel:sourceLevel,agcom:agcom,provider:provider};
  }
  function resultCopy(diagnosis,sourceAssessment){
    if(diagnosis.level==='high')return {title:'Elementi che richiedono cautela elevata',summary:'Nelle risposte compaiono elementi che meritano una verifica indipendente prima di proseguire, comunicare altri dati o confermare una proposta.',kicker:'Valutazione combinata'};
    if(sourceAssessment.state==='no_match')return {title:'Identità non confermata dalle fonti consultate',summary:'Le verifiche che hai riportato non forniscono una conferma del numero rispetto all’identità dichiarata. Non è una prova di frode, ma è prudente usare solo recapiti ufficiali per ogni passaggio successivo.',kicker:'Verifica delle fonti'};
    if(sourceAssessment.state==='roc_match_provider_missing')return {title:'Le fonti richiedono un approfondimento',summary:'Il numero risulta presente nel ROC secondo la tua verifica, ma non è confermato dalla fonte ufficiale del soggetto dichiarato. Non assumere che i due risultati identifichino la stessa organizzazione.',kicker:'Esiti non univoci'};
    if(sourceAssessment.state==='provider_match_roc_missing')return {title:'Conferma del fornitore, ROC senza corrispondenza',summary:'Hai riportato una conferma dalla fonte ufficiale del soggetto dichiarato e nessuna corrispondenza nel ROC. I due controlli non sono equivalenti e l’assenza dal registro non prova una frode.',kicker:'Esiti da leggere separatamente'};
    if(sourceAssessment.state==='double_match'&&diagnosis.level==='low')return {title:'Riscontri coerenti, senza segnali forti',summary:'Hai riportato una corrispondenza nel ROC e una conferma dalla fonte ufficiale del soggetto dichiarato. È un quadro coerente, ma resta utile valutare il contenuto della chiamata e la convenienza della proposta.',kicker:'Riscontri delle fonti'};
    if(sourceAssessment.state==='provider_missing')return {title:'Identità non confermata dalla fonte ufficiale',summary:'Hai indicato che il numero non è stato confermato dalla fonte ufficiale del soggetto dichiarato. Questo non prova una frode, ma richiede una verifica attraverso canali ufficiali prima di proseguire.',kicker:'Verifica della fonte'};
    if(sourceAssessment.state==='roc_missing'&&diagnosis.level==='low')return {title:'Nessuna corrispondenza nel ROC, senza segnali forti',summary:'L’assenza di corrispondenza nel registro non classifica il numero. Le risposte sulla telefonata non mostrano elementi ad alta cautela: verifica comunque l’identità attraverso canali ufficiali.',kicker:'Registro e telefonata'};
    if(sourceAssessment.level==='review')return {title:'Alcuni elementi richiedono verifica',summary:'La telefonata o gli esiti delle fonti contengono uno o più elementi che è prudente controllare attraverso canali ufficiali prima di proseguire.',kicker:'Valutazione combinata'};
    if(sourceAssessment.state==='provider_match')return {title:'Numero confermato dalla fonte dichiarata, senza segnali forti',summary:'Hai indicato che la fonte ufficiale del soggetto dichiarato conferma il numero. È un elemento utile, ma non certifica da solo l’identità materiale del chiamante.',kicker:'Verifica della fonte'};
    return {title:'Nessun segnale forte emerso dalle risposte',summary:'Le risposte inserite non mostrano elementi ad alta cautela. Verifica comunque il numero e l’identità attraverso i canali ufficiali prima di accettare una proposta.',kicker:'Valutazione della telefonata'};
  }
  function recommendationCopy(diagnosis,sourceAssessment){
    if(diagnosis.accepted==='yes')return 'Non fornire altri dati durante la chiamata. Controlla prima documenti, venditore e stato del contratto usando esclusivamente canali ufficiali; solo dopo valuta il prezzo.';
    if(diagnosis.level==='high')return 'Non comunicare altri dati o codici e non confermare la proposta durante la chiamata. Chiudi e ricontatta il soggetto attraverso un recapito ufficiale.';
    if(['no_match','provider_missing','roc_match_provider_missing'].includes(sourceAssessment.state))return 'L’identità dichiarata non è confermata in modo sufficiente. Non proseguire dalla chiamata: verifica il soggetto attraverso i suoi canali ufficiali.';
    if(sourceAssessment.state==='not_checked')return 'Verifica ora il numero nel Registro AGCOM e, quando disponibile, nel checker ufficiale del soggetto dichiarato; poi riporta qui soltanto gli esiti.';
    if((sourceAssessment.state==='double_match'||sourceAssessment.state==='provider_match')&&diagnosis.contract==='yes')return 'I riscontri che hai riportato sono utili. Prima di accettare, confronta comunque condizioni economiche, durata, quota fissa e costo annuo sui tuoi consumi.';
    if(sourceAssessment.state==='provider_match'||sourceAssessment.state==='double_match')return 'I riscontri sono coerenti, ma per qualsiasi operazione usa comunque i canali ufficiali e non basarti soltanto sul numero visualizzato.';
    return 'Completa le verifiche attraverso canali ufficiali e valuta separatamente il contenuto della proposta prima di comunicare dati o confermare un cambio.';
  }

  function configureNextActions(diagnosis){
    const offerBox=root.querySelector('[data-offer-cta]');
    const afterBox=root.querySelector('[data-after-cta]');
    const offerTitle=root.querySelector('[data-offer-title]');
    const offerText=root.querySelector('[data-offer-text]');
    afterBox.hidden=diagnosis.accepted!=='yes';
    offerBox.hidden=diagnosis.contract!=='yes';
    if(diagnosis.contract==='yes'&&diagnosis.accepted==='yes'){
      offerTitle.textContent='Dopo aver verificato il contratto, controlla anche il prezzo';
      offerText.textContent='La verifica dell’attivazione viene prima. Poi puoi confrontare la proposta economica con le offerte monitorate da OffertaLogica sui tuoi consumi.';
    }else{
      offerTitle.textContent='Ti hanno proposto una tariffa?';
      offerText.textContent='La verifica della telefonata e quella economica sono due cose diverse. Controlla se l’offerta proposta conviene davvero sui tuoi consumi.';
    }
  }
  function renderResult(){
    if(!currentDiagnosis)return;
    const diagnosis=currentDiagnosis;
    const sourceAssessment=assessSources(diagnosis);
    const copy=resultCopy(diagnosis,sourceAssessment);
    const head=root.querySelector('.security-result-head');
    head.dataset.resultLevel=sourceAssessment.level;
    root.querySelector('[data-result-kicker]').textContent=copy.kicker;
    root.querySelector('[data-result-title]').textContent=copy.title;
    root.querySelector('[data-result-summary]').textContent=copy.summary;
    root.querySelector('[data-result-phone]').textContent=normalizedPhone;
    root.querySelector('[data-result-identity]').textContent=identityLabels[diagnosis.identity]||'Non indicata';
    root.querySelector('[data-result-identity-note]').textContent=diagnosis.identity==='unknown'?'Non hai indicato chi dichiarava di essere il chiamante. La verifica del numero resta comunque utile.':'Questa è l’identità che ricordi dalla chiamata; non è stata verificata automaticamente da OffertaLogica.';
    root.querySelector('[data-result-signal-title]').textContent=diagnosis.level==='high'?'Cautela elevata':(diagnosis.level==='review'?'Da verificare':'Nessun segnale forte');
    root.querySelector('[data-result-signals]').textContent=diagnosis.signalText;
    root.querySelector('[data-recommendation-text]').textContent=recommendationCopy(diagnosis,sourceAssessment);
    configureNextActions(diagnosis);
    return sourceAssessment;
  }
  function evaluate(){
    currentDiagnosis=diagnose();
    configureProviderSource(currentDiagnosis.identity);
    renderResult();
    showStep('result');
    const result=root.querySelector('[data-security-step="result"]');
    result.focus({preventScroll:true});
    track('diagnosis_completed',{outcome:currentDiagnosis.level,context:'claims-'+currentDiagnosis.claims.length+'-requests-'+currentDiagnosis.requests.length+'-accepted-'+currentDiagnosis.accepted});
  }
  function resetSourceOutcomes(){
    root.querySelectorAll('[data-source-outcome]').forEach(function(el){el.value='not_checked';});
    const status=root.querySelector('[data-source-status]');
    if(status){status.hidden=true;status.textContent='';status.dataset.sourceLevel='neutral';}
  }
  root.addEventListener('click',function(event){
    const next=event.target.closest('[data-next]');
    if(next){
      const step=next.getAttribute('data-next');
      if(step==='identity'){
        const parsed=normalizePhone(root.querySelector('#security-phone').value);
        const error=root.querySelector('#security-error');
        if(!parsed.ok){error.textContent=parsed.error;error.hidden=false;const phoneInput=root.querySelector('#security-phone');phoneInput.setAttribute('aria-invalid','true');phoneInput.focus();track('error',{outcome:'invalid_phone'});return;}
        error.hidden=true;root.querySelector('#security-phone').setAttribute('aria-invalid','false');
        normalizedPhone=parsed.display;
        if(!hasTrackedStart){track('started',{context:'phone_valid'});hasTrackedStart=true;}
        showStep('identity');
        track('step_completed',{outcome:'phone'});
        return;
      }
      if(step==='signals'){
        const error=root.querySelector('[data-identity-error]');
        if(!selectedIdentity()){error.hidden=false;const group=root.querySelector('[data-identity-group]');if(group)group.setAttribute('aria-invalid','true');requestAnimationFrame(function(){error.focus({preventScroll:true});});return;}
        error.hidden=true;const group=root.querySelector('[data-identity-group]');if(group)group.setAttribute('aria-invalid','false');
        showStep('signals');
        track('step_completed',{outcome:'identity'});
        return;
      }
    }
    const back=event.target.closest('[data-back]');
    if(back){showStep(back.getAttribute('data-back'));return;}
    if(event.target.closest('[data-evaluate]')){if(!validateSignals()){track('error',{outcome:'signals_incomplete'});return;}resetSourceOutcomes();evaluate();return;}
    if(event.target.closest('[data-source-update]')){
      const agcom=sourceOutcome('agcom');
      const provider=sourceOutcome('provider');
      const providerSelect=root.querySelector('[data-source-outcome="provider"]');
      const providerAvailable=Boolean(providerSelect&&!providerSelect.disabled);
      if(agcom==='not_checked'&&(!providerAvailable||provider==='not_checked')){
        const status=root.querySelector('[data-source-status]');
        if(status){status.hidden=false;status.textContent='Seleziona almeno un esito verificato prima di aggiornare la valutazione.';status.dataset.sourceLevel='neutral';}
        return;
      }
      const assessment=renderResult();
      track('source_outcome',{outcome:assessment?assessment.state:'unknown',context:'agcom-'+agcom+'-provider-'+provider});
      return;
    }
    if(event.target.closest('[data-restart]')){
      root.querySelectorAll('input[type="checkbox"],input[type="radio"]').forEach(function(el){el.checked=false;});
      root.querySelectorAll('select').forEach(function(el){el.value=el.hasAttribute('data-source-outcome')?'not_checked':'unknown';});
      root.querySelector('#security-phone').value='';
      normalizedPhone='';
      currentDiagnosis=null;
      resetSourceOutcomes();
      showStep('phone');
      track('restart',{outcome:'new_check'});
      return;
    }
    const sourceLink=event.target.closest('.security-source-link');
    if(sourceLink)track('source_clicked',{outcome:sourceLink.hasAttribute('data-provider-source')?'provider':'agcom',context:sourceLink.dataset.sourceMode||''});
    const offer=event.target.closest('[data-offer-cta] a');
    if(offer)track('offer_cta',{outcome:'comparison'});
    const after=event.target.closest('[data-after-cta] a');
    if(after)track('after_contract_cta',{outcome:'after_contract'});
  });
  root.addEventListener('change',function(event){
    const identityChoice=event.target.closest('input[name="declared-identity"]');
    if(identityChoice&&identityChoice.checked){const error=root.querySelector('[data-identity-error]');const group=root.querySelector('[data-identity-group]');if(error)error.hidden=true;if(group)group.setAttribute('aria-invalid','false');}
    const empty=event.target.closest('[data-empty-group]');
    if(empty&&empty.checked){
      const group=empty.dataset.emptyGroup;
      const selector=group==='claims'?'[data-claim]':'[data-request]';
      root.querySelectorAll(selector).forEach(function(el){el.checked=false;});
      root.querySelectorAll('[data-empty-group="'+group+'"]').forEach(function(el){if(el!==empty)el.checked=false;});
      const error=root.querySelector('[data-signal-error="'+group+'"]');
      const fieldset=root.querySelector('[data-signal-group="'+group+'"]');
      if(error)error.hidden=true;if(fieldset)fieldset.setAttribute('aria-invalid','false');
      return;
    }
    const item=event.target.closest('[data-claim],[data-request]');
    if(item&&item.checked){
      const group=item.hasAttribute('data-claim')?'claims':'requests';
      root.querySelectorAll('[data-empty-group="'+group+'"]').forEach(function(el){el.checked=false;});
      const error=root.querySelector('[data-signal-error="'+group+'"]');
      const fieldset=root.querySelector('[data-signal-group="'+group+'"]');
      if(error)error.hidden=true;if(fieldset)fieldset.setAttribute('aria-invalid','false');
    }
  });
  track('page_view',{outcome:'loaded'});
})();
