(() => {
  "use strict";

  const VERSION = "0.12.45";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const WEEKDAYS = [[1,"Lunedì"],[2,"Martedì"],[3,"Mercoledì"],[4,"Giovedì"],[5,"Venerdì"],[6,"Sabato"],[7,"Domenica"]];
  const SLOT_HELP = {
    research: "Analisi segnali e scelta dell'argomento.",
    social_followup: "Secondo post del ciclo precedente.",
    article_prepare: "Raccolta fonti e preparazione bozza.",
    article_publish: "Pubblicazione articolo e diffusione social dell'articolo.",
    social_related: "Post collegato verso una pagina strategica OffertaLogica."
  };

  const cfg = window.OFFERTALOGICA_EDITORIAL_CONFIG || {};
  const baseUrl = String(cfg.supabaseUrl || "").replace(/\/+$/, "");
  const anonKey = String(cfg.supabaseAnonKey || "").trim();
  let mounted = false;
  let state = { settings:null, schedule:[], targets:[] };

  function sessionRead(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");}catch{return null;}}
  function esc(value=""){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function headers(token,prefer=""){const h={apikey:anonKey,Authorization:`Bearer ${token}`,"Content-Type":"application/json"};if(prefer)h.Prefer=prefer;return h;}
  async function api(path,{method="GET",body=null,prefer=""}={}){
    const session=sessionRead();if(!session?.access_token)throw new Error("Sessione Redazione non disponibile.");
    const r=await fetch(`${baseUrl}/rest/v1/${path}`,{method,headers:headers(session.access_token,prefer),body:body===null?undefined:JSON.stringify(body),cache:"no-store"});
    const payload=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(payload?.message||payload?.error||`Errore ${r.status}`);
    return payload;
  }
  async function currentMember(){const s=sessionRead();if(!s?.user?.id)return null;const rows=await api(`editorial_members?select=user_id,role,active&user_id=eq.${encodeURIComponent(s.user.id)}&limit=1`);return rows?.[0]||null;}

  function field(label,html,help=""){return `<div class="ol-field"><label>${esc(label)}</label>${html}${help?`<small>${esc(help)}</small>`:""}</div>`;}
  function selectDays(value){return WEEKDAYS.map(([n,label])=>`<option value="${n}"${Number(value)===n?" selected":""}>${label}</option>`).join("");}
  function checkbox(name,label,help,checked){return `<label class="ol-autopilot-check"><input type="checkbox" name="${esc(name)}"${checked?" checked":""}><span><strong>${esc(label)}</strong><small>${esc(help)}</small></span></label>`;}
  function validTimezone(value){try{new Intl.DateTimeFormat("it-IT",{timeZone:value}).format(new Date());return true;}catch{return false;}}

  function buildShell(){
    const shell=document.createElement("div");shell.className="ol-autopilot-panel";shell.dataset.editorialAutopilot="1";
    shell.innerHTML=`
      <div class="ol-autopilot-status" data-autopilot-status><div><strong data-autopilot-status-title>Autopilota editoriale</strong><p data-autopilot-status-copy>Caricamento stato motore…</p></div><span class="ol-autopilot-badge" data-autopilot-status-badge>—</span></div>
      <div class="ol-alert ol-alert-danger" data-autopilot-error hidden></div>
      <div class="ol-alert ol-alert-success" data-autopilot-success hidden></div>
      <div data-autopilot-content><p class="ol-muted">Caricamento configurazione…</p></div>`;
    return shell;
  }

  function render(){
    const root=document.querySelector('[data-editorial-autopilot="1"]');const box=root?.querySelector("[data-autopilot-content]");if(!box)return;
    const s=state.settings||{};
    const mode=String(s.execution_mode||"approval");
    const enabled=Boolean(s.enabled);
    const statusTitle=root.querySelector("[data-autopilot-status-title]");const statusCopy=root.querySelector("[data-autopilot-status-copy]");const statusBadge=root.querySelector("[data-autopilot-status-badge]");
    if(statusTitle&&statusCopy&&statusBadge){
      if(enabled&&mode==="automatic"){statusTitle.textContent="Automatico completo attivo";statusCopy.textContent="Per i nuovi articoli il ciclo segue il calendario: prepara, pubblica articolo e social iniziale, quindi i due post successivi. Modifiche manuali alla bozza bloccano la pubblicazione automatica; gli aggiornamenti di pagine esistenti restano sotto controllo umano.";statusBadge.textContent="Automatico";}
      else if(enabled&&mode==="approval"){statusTitle.textContent="Motore schedulato attivo · controllo umano";statusCopy.textContent="Ricerca, articolo con fonti, 2 post e immagine candidata vengono preparati automaticamente; pubblicazione e social attendono il controllo umano.";statusBadge.textContent="Approval";}
      else if(enabled){statusTitle.textContent="Motore schedulato attivo · solo bozza";statusCopy.textContent="Il ciclo prepara i contenuti ma non esegue le fasi di pubblicazione previste dal calendario.";statusBadge.textContent="Bozza";}
      else{statusTitle.textContent="Motore schedulato disattivato";statusCopy.textContent="La configurazione è disponibile, ma nessun ciclo parte finché il motore non viene attivato.";statusBadge.textContent="Disattivato";}
    }

    const schedule=state.schedule.map(slot=>`<div class="ol-autopilot-slot" data-slot-id="${esc(slot.id)}">
      <div class="ol-field"><label>${esc(slot.label)}</label><small>${esc(SLOT_HELP[slot.kind]||"")}</small></div>
      <div class="ol-field"><label>Giorno</label><select data-slot-weekday>${selectDays(slot.weekday)}</select></div>
      <div class="ol-field"><label>Ora</label><input data-slot-time type="time" value="${esc(String(slot.time_local||"").slice(0,5))}"></div>
      <label class="ol-autopilot-source"><input data-slot-enabled type="checkbox"${slot.enabled?" checked":""}>Attivo</label>
    </div>`).join("");
    const targets=state.targets.map(t=>`<div class="ol-autopilot-target" data-target-id="${esc(t.id)}">
      <input data-target-enabled type="checkbox" aria-label="Destinazione attiva"${t.enabled?" checked":""}>
      <input data-target-label type="text" maxlength="120" value="${esc(t.label||"")}" aria-label="Etichetta destinazione">
      <input data-target-url type="text" maxlength="500" value="${esc(t.url_path||"")}" aria-label="URL destinazione">
      <input data-target-category type="text" maxlength="80" value="${esc(t.category||"")}" placeholder="categoria" aria-label="Categoria destinazione">
    </div>`).join("");

    box.innerHTML=`<form data-autopilot-form novalidate>
      <div class="ol-autopilot-grid">
        <section class="ol-card ol-autopilot-card ol-autopilot-card-settings">
          <div class="ol-autopilot-card-heading"><div><h3>1. Impostazioni operative</h3><p>Mostra solo i controlli che incidono realmente sul ciclo attuale.</p></div><div class="ol-autopilot-limit"><strong>Limite attuale</strong><span>1 articolo · social iniziale · 2 post · 1 immagine · ciclo settimanale</span></div></div>
          <div class="ol-autopilot-fields">
            ${field("Modalità",`<select name="execution_mode"><option value="approval"${mode==="approval"?" selected":""}>Preparazione automatica + controllo umano</option><option value="draft"${mode==="draft"?" selected":""}>Solo preparazione in bozza</option><option value="automatic"${mode==="automatic"?" selected":""}>Automatico completo</option></select>`,`Bozza prepara soltanto i contenuti. Controllo umano prepara tutto e attende prima di pubblicare. Automatico completo segue l'intero calendario settimanale per i nuovi articoli; gli aggiornamenti di pagine esistenti restano proposte da verificare.`)}
            ${field("Frequenza articolo",`<select name="article_frequency_weeks">${[1,2,3,4].map(n=>`<option value="${n}"${Number(s.article_frequency_weeks||1)===n?" selected":""}>Ogni ${n===1?"settimana":`${n} settimane`}</option>`).join("")}</select>`)}
            ${field("Soglia opportunità",`<input name="minimum_opportunity_score" type="number" min="0" max="100" step="1" value="${Number(s.minimum_opportunity_score??60)}">`,`Sotto questa soglia il planner può decidere di non creare un nuovo articolo.`)}
            ${field("Fuso orario",`<input name="timezone" type="text" maxlength="80" value="${esc(s.timezone||"Europe/Rome")}">`,`Viene validato prima del salvataggio.`)}
          </div>
          <div class="ol-autopilot-checks">
            ${checkbox("enabled","Attiva motore schedulato","Quando è attivo, lo scheduler interroga il calendario e avvia le fasi dovute.",Boolean(s.enabled))}
            ${checkbox("allow_article_updates","Consenti aggiornamenti","Il planner può proporre l'aggiornamento di un contenuto esistente.",Boolean(s.allow_article_updates))}
            ${checkbox("allow_no_publish","Consenti nessuna pubblicazione","Se non emerge un tema valido, il ciclo può chiudersi senza articolo.",Boolean(s.allow_no_publish))}
            ${checkbox("require_sources","Fonti obbligatorie","La generazione automatica deve produrre fonti verificabili.",Boolean(s.require_sources))}
            ${checkbox("require_primary_source","Fonte primaria quando disponibile","Preferisce dati e documenti originari quando disponibili.",Boolean(s.require_primary_source))}
          </div>
        </section>

        <section class="ol-card ol-autopilot-card"><h3>2. Calendario settimanale</h3><p>Qui si decide quando ogni fase viene presa in carico dallo scheduler. In Automatico completo gli slot di pubblicazione e social vengono eseguiti; nelle altre modalità si fermano prima della pubblicazione.</p><div class="ol-autopilot-schedule">${schedule||'<p class="ol-muted">Nessuno slot configurato.</p>'}</div></section>

        <section class="ol-card ol-autopilot-card"><h3>3. Destinazioni OffertaLogica</h3><p>Il post orientato all'azione può usare soltanto queste destinazioni interne abilitate.</p><div class="ol-autopilot-targets">${targets||'<p class="ol-muted">Nessuna destinazione configurata.</p>'}</div></section>
      </div>
      <div class="ol-autopilot-toolbar ol-autopilot-savebar"><p class="ol-autopilot-save-state" data-autopilot-save-state>${enabled?"Configurazione caricata. Motore schedulato attivo.":"Configurazione caricata. Motore schedulato disattivato."}</p><button class="ol-button ol-button-primary" type="submit">Salva configurazione Autopilota</button></div>
    </form>`;
    box.querySelector("[data-autopilot-form]")?.addEventListener("submit",saveAll);
  }

  async function loadAll(){
    const [settings,schedule,targets]=await Promise.all([
      api("editorial_automation_settings?select=*&id=eq.1&limit=1"),
      api("editorial_automation_schedule?select=*&order=sort_order.asc"),
      api("editorial_promotion_targets?select=*&order=sort_order.asc,label.asc")
    ]);
    state={settings:settings?.[0]||{},schedule:schedule||[],targets:targets||[]};render();
  }

  async function saveAll(event){
    event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type="submit"]');const stateText=form.querySelector("[data-autopilot-save-state]");const session=sessionRead();
    if(!session?.user?.id)return;
    button.disabled=true;if(stateText)stateText.textContent="Verifica configurazione…";showMessage("","");
    try{
      const requestedMode=String(form.elements.execution_mode.value||"approval");
      const requestedEnabled=Boolean(form.elements.enabled.checked);
      const timezone=String(form.elements.timezone.value||"Europe/Rome").trim().slice(0,80);
      if(!validTimezone(timezone))throw new Error(`Fuso orario non valido: ${timezone||"vuoto"}.`);

      const scheduleRows=[...form.querySelectorAll("[data-slot-id]")].map(row=>{
        const weekday=Number(row.querySelector("[data-slot-weekday]").value);
        const timeLocal=String(row.querySelector("[data-slot-time]").value||"");
        if(!Number.isInteger(weekday)||weekday<1||weekday>7)throw new Error("Giorno calendario non valido.");
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeLocal))throw new Error("Orario calendario non valido.");
        return {id:row.dataset.slotId,body:{weekday,time_local:timeLocal,enabled:Boolean(row.querySelector("[data-slot-enabled]").checked),updated_at:new Date().toISOString(),updated_by:session.user.id}};
      });
      const targetRows=[...form.querySelectorAll("[data-target-id]")].map(row=>{
        const url=String(row.querySelector("[data-target-url]").value||"").trim();
        if(!/^\/(?!\/)/.test(url))throw new Error(`Destinazione non valida: ${url||"vuota"}. Usa un percorso interno che inizi con /.`);
        return {id:row.dataset.targetId,body:{label:String(row.querySelector("[data-target-label]").value||"").trim().slice(0,120),url_path:url.slice(0,500),category:String(row.querySelector("[data-target-category]").value||"").trim().slice(0,80)||null,enabled:Boolean(row.querySelector("[data-target-enabled]").checked),updated_at:new Date().toISOString(),updated_by:session.user.id}};
      });

      const body={
        enabled:requestedEnabled,
        execution_mode:requestedMode,
        timezone,
        article_frequency_weeks:Number(form.elements.article_frequency_weeks.value||1),
        minimum_opportunity_score:Number(form.elements.minimum_opportunity_score.value||60),
        allow_article_updates:Boolean(form.elements.allow_article_updates.checked),
        allow_no_publish:Boolean(form.elements.allow_no_publish.checked),
        require_sources:Boolean(form.elements.require_sources.checked),
        require_primary_source:Boolean(form.elements.require_primary_source.checked),
        updated_at:new Date().toISOString(),updated_by:session.user.id
      };

      if(stateText)stateText.textContent="Salvataggio…";
      const operations=[
        api("editorial_automation_settings?id=eq.1",{method:"PATCH",prefer:"return=minimal",body}),
        ...scheduleRows.map(row=>api(`editorial_automation_schedule?id=eq.${encodeURIComponent(row.id)}`,{method:"PATCH",prefer:"return=minimal",body:row.body})),
        ...targetRows.map(row=>api(`editorial_promotion_targets?id=eq.${encodeURIComponent(row.id)}`,{method:"PATCH",prefer:"return=minimal",body:row.body}))
      ];
      const results=await Promise.allSettled(operations);
      const failed=results.filter(result=>result.status==="rejected");
      if(failed.length)throw new Error(`${failed.length} operazion${failed.length===1?"e":"i"} di salvataggio non completat${failed.length===1?"a":"e"}.`);

      if(stateText)stateText.textContent=body.enabled?"Configurazione salvata. Il motore schedulato è attivo.":"Configurazione salvata. Il motore schedulato è disattivato.";
      showMessage("",body.enabled?"Autopilota schedulato attivato.":"Configurazione Autopilota salvata.");
      await loadAll();
    }catch(error){
      if(stateText)stateText.textContent="Salvataggio da verificare.";
      showMessage(`Salvataggio non completato: ${error.message} Lo stato viene ricaricato per mostrare i valori effettivi.`,"");
      await loadAll().catch(()=>{});
    }finally{button.disabled=false;}
  }

  function showMessage(error,success){const root=document.querySelector('[data-editorial-autopilot="1"]');const e=root?.querySelector("[data-autopilot-error]");const s=root?.querySelector("[data-autopilot-success]");if(e){e.textContent=error;e.hidden=!error;}if(s){s.textContent=success;s.hidden=!success;}}

  async function mount(){
    if(mounted||!baseUrl||!anonKey)return;
    const workspace=document.querySelector("[data-review-workspace]");if(!workspace||workspace.hidden)return;
    try{const member=await currentMember();if(member?.role!=="admin"||!member.active)return;const host=document.querySelector("[data-editorial-autopilot-host]");if(!host||document.querySelector('[data-editorial-autopilot="1"]'))return;host.innerHTML="";host.append(buildShell());mounted=true;try{await loadAll();}catch(error){showMessage(`Autopilota non disponibile: ${error.message}`,"");const content=document.querySelector('[data-editorial-autopilot="1"] [data-autopilot-content]');if(content)content.innerHTML='<p class="ol-muted">La struttura dati dell’Autopilota non è disponibile. Prima va installato lo SQL scheduler compatibile con questa release, poi va ricaricata la Redazione.</p>';}}
    catch(error){console.warn("editorial_autopilot_init_failed",error);}
  }


  function initSectionNavigation(){
    const links=[...document.querySelectorAll(".ol-editorial-section-link")];
    const collapsibles=[...document.querySelectorAll("details.ol-editorial-block-collapsible")];
    if(!links.length)return;
    const setActive=(id,{open=false}={})=>{
      links.forEach(link=>link.classList.toggle("ol-editorial-section-link-current",link.getAttribute("href")===`#${id}`));
      const block=document.getElementById(id);
      if(open&&block?.tagName==="DETAILS"){
        collapsibles.forEach(item=>{if(item!==block)item.open=false;});
        block.open=true;
      }
    };
    links.forEach(link=>link.addEventListener("click",()=>{
      const id=String(link.getAttribute("href")||"").replace(/^#/,"");
      if(id)setActive(id,{open:true});
    }));
    collapsibles.forEach(block=>block.addEventListener("toggle",()=>{
      if(!block.open)return;
      collapsibles.forEach(item=>{if(item!==block)item.open=false;});
      setActive(block.id);
    }));
    const initial=String(location.hash||"").replace(/^#/,"");
    if(initial&&document.getElementById(initial))setActive(initial,{open:true});
    else setActive("editorial-articles");
  }

  function boot(){initSectionNavigation();const workspace=document.querySelector("[data-review-workspace]");if(workspace){new MutationObserver(()=>mount()).observe(workspace,{attributes:true,attributeFilter:["hidden"]});}mount();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
