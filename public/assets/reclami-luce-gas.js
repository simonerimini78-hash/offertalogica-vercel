(() => {
  'use strict';

  const PDF_DIRECT_UPLOAD_THRESHOLD_BYTES = 4_000_000;
  const MAX_PHOTO_BYTES = 12_000_000;
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const problemMap = {
    high_bill: {
      label: 'La bolletta è molto più alta del solito',
      docs: ['La bolletta contestata e, se disponibile, una bolletta precedente comparabile.', 'Eventuali letture o autoletture riferite allo stesso periodo.', 'Comunicazioni su conguagli, ricalcoli o variazioni delle condizioni economiche.']
    },
    consumption: {
      label: 'I consumi non mi sembrano corretti',
      docs: ['La bolletta con il periodo e i consumi contestati.', 'Letture/autoletture disponibili e relative date.', 'Eventuali foto o dati del contatore utili a ricostruire la cronologia.']
    },
    price: {
      label: 'Il prezzo non è quello che mi aspettavo',
      docs: ['La bolletta in cui compare il prezzo o la spesa contestata.', 'Contratto, scheda sintetica o condizioni economiche sottoscritte.', 'Comunicazioni ricevute su rinnovi o modifiche delle condizioni.']
    },
    unknown_charge: {
      label: 'Ci sono costi che non riconosco',
      docs: ['La bolletta con la voce o l’addebito contestato.', 'Contratto e condizioni dell’offerta, se disponibili.', 'Eventuali comunicazioni relative al servizio o costo aggiuntivo.']
    },
    contract: {
      label: 'Non riconosco il contratto o l’offerta',
      docs: ['La prima bolletta o comunicazione che mostra il contratto contestato.', 'Qualsiasi proposta, registrazione o documento ricevuto in fase di attivazione.', 'Cronologia di telefonate, email o messaggi collegati alla sottoscrizione.']
    },
    switch: {
      label: 'Il problema è nato dopo un cambio fornitore',
      docs: ['Ultima bolletta del vecchio venditore e prima bolletta del nuovo.', 'Date del cambio e comunicazioni dei due operatori.', 'Documenti relativi a eventuale doppia fatturazione o periodo sovrapposto.']
    },
    refund: {
      label: 'Aspetto uno storno o un rimborso',
      docs: ['Documento in cui il venditore riconosce storno, accredito o rimborso.', 'Bolletta o pagamento da cui nasce l’importo.', 'Eventuali solleciti già inviati e relative date.']
    },
    complaint: {
      label: 'Ho già fatto reclamo ma non ho risolto',
      docs: ['Copia del reclamo scritto.', 'Prova della data di invio o ricezione.', 'Risposta del venditore, se già ricevuta, e documenti citati nella risposta.']
    },
    other: {
      label: 'Il mio problema è diverso',
      docs: ['Documenti direttamente collegati al problema.', 'Una cronologia essenziale con date e passaggi principali.', 'Copia di eventuali comunicazioni già scambiate con il venditore.']
    }
  };

  const state = {
    step: 'problem',
    problem: '',
    complaintStatus: '',
    complaintDate: '',
    bill: null,
    file: null
  };

  function setStep(step) {
    state.step = step;
    $$('[data-case-panel]').forEach((panel) => {
      const active = panel.dataset.casePanel === step;
      panel.hidden = !active;
      if (active) {
        requestAnimationFrame(() => {
          panel.focus({ preventScroll: true });
          panel.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
        });
      }
    });
    $$('[data-progress]').forEach((item) => {
      const order = ['problem', 'status', 'bill', 'result'];
      const currentIndex = order.indexOf(step);
      const itemIndex = order.indexOf(item.dataset.progress);
      item.classList.toggle('active', itemIndex <= currentIndex);
      if (itemIndex === currentIndex) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    $('.case-tool')?.setAttribute('data-case-step', step);
  }

  function selectedValue(name) {
    return $(`input[name="${name}"]:checked`)?.value || '';
  }

  function showError(key, visible) {
    const node = $(`[data-error="${key}"]`);
    if (node) node.hidden = !visible;
  }

  function updateComplaintDateVisibility() {
    const status = selectedValue('complaint-status');
    const wrap = $('[data-complaint-date-wrap]');
    if (!wrap) return;
    wrap.hidden = !['waiting', 'answered'].includes(status);
    const dateInput = $('#complaint-date');
    if (dateInput) dateInput.max = todayIso();
  }

  function validateAndNext(target) {
    if (state.step === 'problem') {
      state.problem = selectedValue('case-problem');
      const valid = Boolean(state.problem);
      showError('problem', !valid);
      if (!valid) return;
    }
    if (state.step === 'status') {
      state.complaintStatus = selectedValue('complaint-status');
      const valid = Boolean(state.complaintStatus);
      showError('status', !valid);
      if (!valid) return;
      state.complaintDate = $('#complaint-date')?.value || '';
    }
    setStep(target);
  }

  function fileKind(file) {
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (['image/jpeg', 'image/png', 'image/webp'].includes(type) || /\.(jpe?g|png|webp)$/.test(name)) return 'photo';
    return '';
  }

  function setUploadStatus(message, mode = '') {
    const node = $('#bill-upload-status');
    if (!node) return;
    node.textContent = message;
    node.className = `upload-status${mode ? ` is-${mode}` : ''}`;
  }

  async function jsonResponse(response) {
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('Risposta non valida dal lettore bolletta.');
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Lettura bolletta non disponibile.');
    return payload;
  }

  async function analyzePdf(file) {
    if (Number(file.size || 0) >= PDF_DIRECT_UPLOAD_THRESHOLD_BYTES) {
      const created = await jsonResponse(await fetch('/api/analyze-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_upload', filename: file.name || 'bolletta.pdf', mimeType: file.type || 'application/pdf', fileSize: Number(file.size || 0) })
      }));
      const upload = created.upload || {};
      if (!upload.uploadUrl || !upload.uploadTicket) throw new Error('Caricamento protetto non disponibile.');
      const body = new FormData();
      body.append('file', file, file.name || 'bolletta.pdf');
      const uploaded = await fetch(upload.uploadUrl, { method: 'PUT', body });
      if (!uploaded.ok) throw new Error('Caricamento protetto non riuscito.');
      return jsonResponse(await fetch('/api/analyze-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze_uploaded_pdf', uploadTicket: upload.uploadTicket, archiveContext: { customerType: '', inputKind: 'pdf', source: 'reclami-luce-gas' } })
      }));
    }
    const body = new FormData();
    body.append('pdf', file);
    body.append('archiveContext', JSON.stringify({ customerType: '', inputKind: 'pdf', source: 'reclami-luce-gas' }));
    return jsonResponse(await fetch('/api/analyze-pdf', { method: 'POST', body }));
  }

  async function analyzePhoto(file) {
    if (Number(file.size || 0) > MAX_PHOTO_BYTES) throw new Error('La foto supera 12 MB. Usa una foto più leggera o il PDF della bolletta.');
    const body = new FormData();
    body.append('photo', file, file.name || 'foto-bolletta.jpg');
    body.append('inputSource', 'gallery');
    body.append('archiveContext', JSON.stringify({ customerType: '', inputKind: 'photo', source: 'reclami-luce-gas' }));
    return jsonResponse(await fetch('/api/analyze-pdf', { method: 'POST', body }));
  }

  function euro(value) {
    return Number.isFinite(Number(value)) ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value)) : '';
  }

  function number(value, digits = 2) {
    return Number.isFinite(Number(value)) ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: digits }).format(Number(value)) : '';
  }

  function dateIt(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }

  function providerFromBill(bill) {
    return bill?.fornitore_luce || bill?.fornitore_gas || bill?.fornitore || '';
  }

  function commodityLabel(value) {
    return value === 'luce' ? 'Luce' : value === 'gas' ? 'Gas' : value === 'dual' ? 'Luce e gas' : '';
  }

  function billFacts(bill) {
    if (!bill) return [];
    const facts = [];
    const provider = providerFromBill(bill);
    if (provider) facts.push(['Fornitore', provider]);
    const commodity = commodityLabel(bill.commodity);
    if (commodity) facts.push(['Fornitura', commodity]);
    if (Number(bill.total_amount_eur) > 0) facts.push(['Totale documento', euro(bill.total_amount_eur)]);
    const start = dateIt(bill.billing_period_start), end = dateIt(bill.billing_period_end);
    if (start || end) facts.push(['Periodo', [start, end].filter(Boolean).join(' – ')]);
    if (Number(bill.consumo_periodo_luce_kwh) > 0) facts.push(['Consumo luce nel periodo', `${number(bill.consumo_periodo_luce_kwh, 1)} kWh`]);
    if (Number(bill.consumo_periodo_gas_smc) > 0) facts.push(['Consumo gas nel periodo', `${number(bill.consumo_periodo_gas_smc, 2)} Smc`]);
    if (Number(bill.prezzo_luce_eur_kwh) > 0) facts.push(['Prezzo luce riconosciuto', `${number(bill.prezzo_luce_eur_kwh, 5)} €/kWh`]);
    if (Number(bill.prezzo_gas_eur_smc) > 0) facts.push(['Prezzo gas riconosciuto', `${number(bill.prezzo_gas_eur_smc, 5)} €/Smc`]);
    return facts.slice(0, 7);
  }

  function renderBillSummary() {
    const summary = $('#bill-summary');
    const grid = $('#bill-data-grid');
    if (!summary || !grid) return;
    const facts = billFacts(state.bill);
    grid.replaceChildren();
    facts.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'bill-data';
      const small = document.createElement('small');
      small.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value;
      item.append(small, strong);
      grid.append(item);
    });
    if (!facts.length) {
      const item = document.createElement('div');
      item.className = 'bill-data';
      item.innerHTML = '<small>Lettura</small><strong>Documento riconosciuto, ma senza dati sintetici sufficienti da mostrare qui.</strong>';
      grid.append(item);
    }
    summary.hidden = false;
  }

  async function analyzeSelectedBill() {
    const file = state.file;
    if (!file) return;
    const kind = fileKind(file);
    if (!kind) {
      setUploadStatus('Formato non supportato. Usa PDF, JPG, PNG o WebP.', 'error');
      return;
    }
    const button = $('#analyze-bill-button');
    if (button) button.disabled = true;
    setUploadStatus('Lettura in corso…', 'loading');
    try {
      const payload = kind === 'pdf' ? await analyzePdf(file) : await analyzePhoto(file);
      state.bill = payload.normalized || null;
      renderBillSummary();
      setUploadStatus('Bolletta letta. Controlla i dati riconosciuti prima di continuare.', 'ready');
      $('#remove-bill-button')?.removeAttribute('hidden');
    } catch (error) {
      state.bill = null;
      $('#bill-summary')?.setAttribute('hidden', '');
      setUploadStatus(error?.message || 'Non è stato possibile leggere la bolletta.', 'error');
    } finally {
      if (button) button.disabled = !state.file;
    }
  }

  function daysSince(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
    const start = Date.parse(`${iso}T00:00:00`);
    const now = new Date();
    const end = Date.parse(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T00:00:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
    return Math.floor((end - start) / 86400000);
  }

  function resultStage() {
    const days = daysSince(state.complaintDate);
    if (state.complaintStatus === 'answered') return { key: 'conciliation', label: 'Risposta ricevuta · fase successiva da valutare', days };
    if (state.complaintStatus === 'waiting' && Number.isFinite(days) && days >= 40) return { key: 'conciliation', label: '40 giorni trascorsi · conciliazione verificabile', days };
    if (state.complaintStatus === 'waiting') return { key: 'response', label: 'In attesa della risposta del venditore', days };
    return { key: 'complaint', label: 'Verifica prima del reclamo', days };
  }

  function nextStepContent(stage) {
    if (state.complaintStatus === 'answered') {
      return '<p>Hai già ricevuto una risposta. Confronta la risposta con ciò che avevi contestato e individua i punti rimasti aperti. ARERA indica che, dopo un reclamo scritto, una risposta ritenuta insoddisfacente consente di presentare la domanda al Servizio Conciliazione.</p><p><a href="https://www.arera.it/consumatori/conciliazione/servizio-conciliazione-domande-e-risposte" target="_blank" rel="noopener">Verifica i requisiti sul sito ARERA</a>.</p>';
    }
    if (state.complaintStatus === 'waiting') {
      if (Number.isFinite(stage.days) && stage.days >= 40) {
        return `<p>Dal reclamo risultano trascorsi circa <strong>${stage.days} giorni</strong>. ARERA indica che, in assenza di risposta, la conciliazione può essere attivata una volta trascorsi 40 giorni dall'invio del reclamo.</p><p>Prima di procedere, verifica data, prova di invio/ricezione e documenti della controversia.</p>`;
      }
      const dayNote = Number.isFinite(stage.days) ? ` Sono trascorsi circa <strong>${stage.days} giorni</strong>.` : '';
      return `<p>Conserva la prova della data di invio e attendi la risposta scritta.${dayNote} Nel 2026 lo standard specifico TIQV per la risposta motivata al reclamo è di 30 giorni solari; ARERA indica 40 giorni dall'invio come soglia per attivare la conciliazione in assenza di risposta.</p>`;
    }
    return '<p>Prima di inviare un reclamo, definisci con precisione che cosa contesti e allega i documenti che lo dimostrano. Usa un canale che ti consenta di conservare la prova della presentazione e la relativa data.</p><p>Il reclamo deve permettere al venditore di capire il problema concreto e rispondere in modo motivato.</p>';
  }

  function renderJourney(stageKey) {
    const order = ['verify', 'complaint', 'response', 'conciliation'];
    const current = Math.max(0, order.indexOf(stageKey));
    $$('#journey-list [data-journey]').forEach((item, index) => {
      item.classList.remove('done', 'current');
      item.removeAttribute('aria-current');
      if (index < current) item.classList.add('done');
      if (index === current) {
        item.classList.add('current');
        item.setAttribute('aria-current', 'step');
      }
    });
  }

  function renderResult() {
    state.problem = state.problem || selectedValue('case-problem');
    state.complaintStatus = state.complaintStatus || selectedValue('complaint-status');
    state.complaintDate = $('#complaint-date')?.value || state.complaintDate;
    const problem = problemMap[state.problem] || problemMap.other;
    const stage = resultStage();
    $('#result-title').textContent = stage.label;
    $('#result-lead').textContent = 'Il riepilogo mette in ordine ciò che hai indicato e i dati eventualmente letti dalla bolletta. Non è una decisione sulla controversia.';
    $('#result-problem').textContent = problem.label;

    const billNode = $('#result-bill');
    billNode.replaceChildren();
    const facts = billFacts(state.bill);
    if (!state.bill || !facts.length) {
      const p = document.createElement('p');
      p.textContent = state.file && !state.bill ? 'La bolletta non è stata letta con successo. Puoi comunque usare il riepilogo del percorso.' : 'Non hai usato la lettura della bolletta. Il percorso resta valido e puoi preparare i documenti indicati.';
      billNode.append(p);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'result-facts';
      facts.slice(0, 5).forEach(([label, value]) => {
        const p = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = `${label}: `;
        p.append(strong, document.createTextNode(value));
        wrap.append(p);
      });
      billNode.append(wrap);
    }

    const docs = [...problem.docs];
    if (state.complaintStatus === 'waiting') docs.push('Prova della data di invio/ricezione del reclamo scritto.');
    if (state.complaintStatus === 'answered') docs.push('Risposta scritta del venditore, da confrontare punto per punto con il reclamo.');
    const docsNode = $('#result-docs');
    docsNode.replaceChildren();
    [...new Set(docs)].forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      docsNode.append(li);
    });

    $('#result-next').innerHTML = nextStepContent(stage);
    $('#journey-status').textContent = stage.label;
    renderJourney(stage.key);
    $('#case-result-live').textContent = `Riepilogo pronto. Stato del percorso: ${stage.label}.`;
    setStep('result');
  }

  function resetCase() {
    state.step = 'problem';
    state.problem = '';
    state.complaintStatus = '';
    state.complaintDate = '';
    state.bill = null;
    state.file = null;
    $$('input[name="case-problem"],input[name="complaint-status"]').forEach((input) => { input.checked = false; });
    const date = $('#complaint-date');
    if (date) date.value = '';
    const file = $('#case-bill-file');
    if (file) file.value = '';
    $('[data-complaint-date-wrap]')?.setAttribute('hidden', '');
    $('#bill-summary')?.setAttribute('hidden', '');
    $('#remove-bill-button')?.setAttribute('hidden', '');
    const analyze = $('#analyze-bill-button');
    if (analyze) analyze.disabled = true;
    setUploadStatus('Nessun documento selezionato.');
    showError('problem', false);
    showError('status', false);
    setStep('problem');
  }

  $$('[data-next]').forEach((button) => button.addEventListener('click', () => validateAndNext(button.dataset.next)));
  $$('[data-back]').forEach((button) => button.addEventListener('click', () => setStep(button.dataset.back)));
  $$('input[name="complaint-status"]').forEach((input) => input.addEventListener('change', updateComplaintDateVisibility));

  $('#case-bill-file')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null;
    state.file = file;
    state.bill = null;
    $('#bill-summary')?.setAttribute('hidden', '');
    $('#remove-bill-button')?.setAttribute('hidden', '');
    const button = $('#analyze-bill-button');
    if (button) button.disabled = !file;
    if (!file) setUploadStatus('Nessun documento selezionato.');
    else setUploadStatus(`${file.name} selezionato. La lettura parte solo quando premi “Leggi la bolletta”.`);
  });

  $('#analyze-bill-button')?.addEventListener('click', analyzeSelectedBill);
  $('#remove-bill-button')?.addEventListener('click', () => {
    state.file = null;
    state.bill = null;
    const input = $('#case-bill-file');
    if (input) input.value = '';
    $('#bill-summary')?.setAttribute('hidden', '');
    $('#remove-bill-button')?.setAttribute('hidden', '');
    const button = $('#analyze-bill-button');
    if (button) button.disabled = true;
    setUploadStatus('Documento rimosso. Puoi continuare senza bolletta.');
  });

  $('#show-result-button')?.addEventListener('click', renderResult);
  $('#restart-case-button')?.addEventListener('click', resetCase);
  $('#print-case-button')?.addEventListener('click', () => window.print());

  const dateInput = $('#complaint-date');
  if (dateInput) dateInput.max = todayIso();
})();
