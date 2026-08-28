(function(){
  'use strict';
  function initChoices(root){
    var buttons=[].slice.call(root.querySelectorAll('[data-choice]'));
    var results=[].slice.call(root.querySelectorAll('[data-choice-result]'));
    if(!buttons.length||!results.length)return;
    buttons.forEach(function(button){
      button.addEventListener('click',function(){
        var value=button.getAttribute('data-choice');
        buttons.forEach(function(item){item.setAttribute('aria-pressed',item===button?'true':'false');});
        results.forEach(function(result){result.hidden=result.getAttribute('data-choice-result')!==value;});
        var active=results.find(function(result){return !result.hidden;});
        if(active){active.setAttribute('tabindex','-1');active.focus({preventScroll:true});}
      });
    });
  }
  function formatNumber(value,digits){
    return new Intl.NumberFormat('it-IT',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
  }
  function initMarket(root){
    var status=root.querySelector('[data-market-status]');
    fetch('/data/calcolo-parametri.json',{cache:'no-store'})
      .then(function(response){if(!response.ok)throw new Error('Dati non disponibili');return response.json();})
      .then(function(data){
        var indices=data&&data.indiciMercato?data.indiciMercato:{};
        [['pun',6],['psv',6]].forEach(function(entry){
          var key=entry[0],digits=entry[1],item=indices[key];
          var value=root.querySelector('[data-market="'+key+'-value"]');
          var period=root.querySelector('[data-market="'+key+'-period"]');
          if(!item||!Number.isFinite(Number(item.valore)))return;
          if(value)value.textContent=formatNumber(Number(item.valore),digits)+' '+(key==='pun'?'€/kWh':'€/Smc');
          if(period)period.textContent=item.periodoLabel||item.periodo||'ultimo periodo ufficiale';
        });
        if(status)status.textContent='Dati mensili ufficiali già utilizzati dal calcolatore OffertaLogica. Non sono il valore giornaliero “PUN oggi”.';
      })
      .catch(function(){if(status)status.textContent='Il dato mensile non è disponibile in questo momento. Il confronto OffertaLogica resta utilizzabile con i dati della tua offerta.';});
  }
  function initQuota(root){
    var quota=root.querySelector('[data-quota]');
    var consumo=root.querySelector('[data-consumo]');
    var unita=root.querySelector('[data-unita]');
    var output=root.querySelector('[data-quota-result]');
    var error=root.querySelector('[data-quota-error]');
    if(!quota||!consumo||!unita||!output)return;
    function calculate(){
      var q=Number(String(quota.value).replace(',','.'));
      var c=Number(String(consumo.value).replace(',','.'));
      if(!Number.isFinite(q)||q<0||!Number.isFinite(c)||c<=0){
        output.hidden=true;
        if(error){error.hidden=false;error.textContent='Inserisci una quota fissa non negativa e un consumo annuo maggiore di zero.';}
        return;
      }
      if(error){error.hidden=true;error.textContent='';}
      var equivalent=q/c;
      var annual=root.querySelector('[data-output="annual"]');
      var perUnit=root.querySelector('[data-output="per-unit"]');
      var unitLabel=unita.value==='smc'?'Smc':'kWh';
      if(annual)annual.textContent=formatNumber(q,2)+' €/anno';
      if(perUnit)perUnit.textContent=formatNumber(equivalent,5)+' €/'+unitLabel;
      output.hidden=false;
    }
    [quota,consumo,unita].forEach(function(field){field.addEventListener('input',calculate);field.addEventListener('change',calculate);});
    calculate();
  }
  document.querySelectorAll('[data-ol-choice]').forEach(initChoices);
  document.querySelectorAll('[data-ol-market-monthly]').forEach(initMarket);
  document.querySelectorAll('[data-ol-quota-calculator]').forEach(initQuota);
})();
