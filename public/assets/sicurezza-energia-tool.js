(function(){
  'use strict';
  const TOOL_VERSION='security-energy-v0.1.0';
  const TOOL_CODE='sicurezza_energia';
  const SOURCE='seo_sicurezza_energia';
  const TRACK_URL='/api/track-event';
  const root=document.getElementById('security-tool');
  if(!root)return;

  const providerSources={
    enel:{label:'Enel Energia — verifica chi ti ha chiamato',url:'https://www.enel.it/it-it/assistenza/luce-gas/verifica-chi-ti-ha-chiamato'},
    plenitude:{label:'Plenitude — verifica numero telefonico',url:'https://eniplenitude.com/verifica-numero-telefonico'},
    acea:{label:'Acea Energia — riconosci le truffe',url:'https://www.aceaenergia.it/trova-e-risolvi/riconosci-le-truffe'},
    a2a:{label:'A2A — chiamate sospette',url:'https://www.a2a.it/assistenza/chiamate-sospette'},
    iren:{label:'Iren — telefonate sospette',url:'https://www.irenlucegas.it/assistenza/gestisci-il-tuo-contratto/telefonate-sospette-cosa-fare'},
    sorgenia:{label:'Sorgenia — telefonate sospette',url:'https://www.sorgenia.it/partnership-consigli-pratici-telefonate-sospette'},
    illumia:{label:'Illumia — controllo chiamate',url:'https://www.illumia.it/'},
    edison:{label:'Edison Energia — sito ufficiale',url:'https://www.edisonenergia.it/'},
    authority:{label:'ARERA — sito ufficiale',url:'https://www.arera.it/consumatori'}
  };
  const identityLabels={enel:'Enel Energia',plenitude:'Plenitude',edison:'Edison Energia',iren:'Iren',a2a:'A2A Energia',acea:'Acea Energia',sorgenia:'Sorgenia',illumia:'Illumia',other_provider:'Altro fornitore',distributor:'Distributore',authority:'ARERA / Autorità',current_supplier:'“Il tuo fornitore”',association:'Associazione consumatori',unknown:'Non ricordo'};
  const claimLabels={contract_expiring:'contratto in scadenza',price_increase:'aumento del prezzo',must_switch:'obbligo di cambiare fornitore',technical_problem:'problema tecnico/amministrativo',suspension:'rischio di sospensione',guaranteed_saving:'risparmio certo'};
  const requestLabels={pod_pdr:'POD/PDR',bill:'bolletta',tax_code:'codice fiscale',document:'documento',iban:'IBAN',payment:'carta/pagamento',password_pin:'password/PIN',otp:'OTP/codice SMS'};
  const highRiskRequests=new Set(['password_pin','otp']);
  let normalizedPhone='';
  let hasTrackedView=false;

  const sessionId=(()=>{try{if(globalThis.crypto&&crypto.randomUUID)return crypto.randomUUID();}catch(e){}return 'sec-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);})();
  function isStaffPreview(){try{return sessionStorage.getItem('offertalogicaStaffMode')==='true';}catch(e){return false;}}
  function track(action,detail){
    if(isStaffPreview())return;
    detail=detail||{};
    const actionMap={page_view:'page_view',started:'started',step_completed:'completed',diagnosis_completed:'diagnosis_completed',source_clicked:'cta_clicked',offer_cta:'cta_clicked',after_contract_cta:'cta_clicked',restart:'started',error:'error'};
    const payload={toolCode:TOOL_CODE,toolAction:actionMap[action]||'started',toolOutcome:String(detail.outcome||'').slice(0,100),toolContext:[action,String(detail.context||'').trim()].filter(Boolean).join(':').slice(0,80),toolVersion:TOOL_VERSION,source:SOURCE,page:location.pathname,customerType:'consumer',dataOrigin:SOURCE};
    fetch(TRACK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventType:'interactive_tool_event',sessionId:sessionId,page:location.pathname,customerType:'consumer',dataOrigin:SOURCE,source:SOURCE,payload:payload}),credentials:'same-origin',keepalive:true}).catch(function(){});
  }
  function normalizePhone(value){
    let raw=String(value||'').trim();
    if(!raw)return {ok:false,error:'Inserisci il numero visualizzato sul telefono.'};
    raw=raw.replace(/[\s().-]/g,'');
    if(raw.startsWith('0039'))raw=raw.slice(4);else if(raw.startsWith('+39'))raw=raw.slice(3);else if(raw.startsWith('+'))return {ok:false,error:'Per questa prima versione inserisci una numerazione italiana.'};
    if(!/^\d+$/.test(raw))return {ok:false,error:'Il numero contiene caratteri non riconosciuti.'};
    if(raw.length<6||raw.length>12)return {ok:false,error:'Controlla il numero: la lunghezza non sembra valida per una numerazione italiana.'};
    return {ok:true,value:raw,display:raw};
  }
  function selectedIdentity(){const el=root.querySelector('input[name="declared-identity"]:checked');return el?el.value:'';}
  function checkedValues(selector){return Array.from(root.querySelectorAll(selector+':checked')).map(function(el){return el.value;});}
  function behavior(name){const el=root.querySelector('[data-behavior="'+name+'"]');return el?el.value:'unknown';}
  function showStep(name){
    root.dataset.step=name;
    root.querySelectorAll('[data-security-step]').forEach(function(step){step.hidden=step.getAttribute('data-security-step')!==name;});
    const order=['phone','identity','signals','result'];
    const current=order.indexOf(name);
    root.querySelectorAll('[data-progress]').forEach(function(item){const idx=order.indexOf(item.getAttribute('data-progress'));item.classList.toggle('active',idx<=current);const line=item.nextElementSibling;if(line&&line.tagName==='I')line.classList.toggle('active',idx<current);});
    if(name!=='phone')root.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function joinNatural(items){if(!items.length)return '';if(items.length===1)return items[0];return items.slice(0,-1).join(', ')+' e '+items[items.length-1];}
  function evaluate(){
    const identity=selectedIdentity()||'unknown';
    const claims=checkedValues('[data-claim]');
    const requests=checkedValues('[data-request]');
    const urgency=behavior('urgency');
    const contract=behavior('contract');
    const unexpected=behavior('unexpected');
    const accepted=behavior('accepted');
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
    let level='low',title='Nessun segnale forte emerso dalle risposte',summary='Le risposte inserite non mostrano elementi ad alta cautela. Verifica comunque il numero e l’identità attraverso i canali ufficiali prima di accettare una proposta.';
    if(highRequests.length||points>=6){level='high';title='Elementi che richiedono cautela elevata';summary='Nelle risposte compaiono elementi che meritano una verifica indipendente prima di proseguire o comunicare altri dati.';}
    else if(points>=2){level='review';title='Alcuni elementi richiedono verifica';summary='La telefonata contiene uno o più elementi che è prudente controllare attraverso fonti e canali ufficiali.';}
    const requestText=requests.map(function(v){return requestLabels[v];}).filter(Boolean);
    const claimText=claims.map(function(v){return claimLabels[v];}).filter(Boolean);
    const signalParts=[];
    if(claimText.length)signalParts.push('Hai indicato: '+joinNatural(claimText)+'.');
    if(requestText.length)signalParts.push('Ti sono stati chiesti: '+joinNatural(requestText)+'.');
    if(urgency==='yes')signalParts.push('Hai segnalato fretta o pressione.');
    if(unexpected==='yes')signalParts.push('La chiamata era inattesa.');
    if(contract==='yes')signalParts.push('Era presente una proposta di attivazione o cambio.');
    if(!signalParts.length)signalParts.push('Non hai selezionato richieste o comportamenti specifici da evidenziare.');
    const head=root.querySelector('.security-result-head');head.dataset.resultLevel=level;
    root.querySelector('[data-result-title]').textContent=title;
    root.querySelector('[data-result-summary]').textContent=summary;
    root.querySelector('[data-result-phone]').textContent=normalizedPhone;
    root.querySelector('[data-result-identity]').textContent=identityLabels[identity]||'Non indicata';
    root.querySelector('[data-result-identity-note]').textContent=identity==='unknown'?'Non hai indicato chi dichiarava di essere il chiamante. La verifica del numero resta comunque utile.':'Questa è l’identità che ricordi dalla chiamata; non è stata verificata automaticamente da OffertaLogica.';
    root.querySelector('[data-result-signal-title]').textContent=level==='high'?'Cautela elevata':(level==='review'?'Da verificare':'Nessun segnale forte');
    root.querySelector('[data-result-signals]').textContent=signalParts.join(' ');
    const providerLink=root.querySelector('[data-provider-source]');
    const source=providerSources[identity];
    if(source){providerLink.href=source.url;providerLink.textContent=source.label;providerLink.hidden=false;}else{providerLink.hidden=true;providerLink.removeAttribute('href');}
    root.querySelector('[data-offer-cta]').hidden=contract!=='yes';
    root.querySelector('[data-after-cta]').hidden=accepted!=='yes';
    showStep('result');
    const result=root.querySelector('[data-security-step="result"]');result.focus({preventScroll:true});
    track('diagnosis_completed',{outcome:level,context:'claims-'+claims.length+'-requests-'+requests.length});
  }
  root.addEventListener('click',function(event){
    const next=event.target.closest('[data-next]');
    if(next){
      const step=next.getAttribute('data-next');
      if(step==='identity'){
        const parsed=normalizePhone(root.querySelector('#security-phone').value);
        const error=root.querySelector('#security-error');
        if(!parsed.ok){error.textContent=parsed.error;error.hidden=false;track('error',{outcome:'invalid_phone'});return;}
        error.hidden=true;normalizedPhone=parsed.display;if(!hasTrackedView){track('started',{context:'phone_valid'});hasTrackedView=true;}showStep('identity');track('step_completed',{outcome:'phone'});return;
      }
      if(step==='signals'){
        const error=root.querySelector('[data-identity-error]');
        if(!selectedIdentity()){error.hidden=false;return;}
        error.hidden=true;showStep('signals');track('step_completed',{outcome:'identity'});return;
      }
    }
    const back=event.target.closest('[data-back]');if(back){showStep(back.getAttribute('data-back'));return;}
    if(event.target.closest('[data-evaluate]')){evaluate();return;}
    if(event.target.closest('[data-restart]')){
      root.querySelectorAll('input[type="checkbox"],input[type="radio"]').forEach(function(el){el.checked=false;});
      root.querySelectorAll('select').forEach(function(el){el.value='unknown';});
      root.querySelector('#security-phone').value='';normalizedPhone='';showStep('phone');track('restart',{outcome:'new_check'});return;
    }
    const sourceLink=event.target.closest('.security-source-link');if(sourceLink)track('source_clicked',{outcome:sourceLink.hasAttribute('data-provider-source')?'provider':'agcom'});
    const offer=event.target.closest('[data-offer-cta] a');if(offer)track('offer_cta',{outcome:'comparison'});
    const after=event.target.closest('[data-after-cta] a');if(after)track('after_contract_cta',{outcome:'after_contract'});
  });
  track('page_view',{outcome:'loaded'});
})();
