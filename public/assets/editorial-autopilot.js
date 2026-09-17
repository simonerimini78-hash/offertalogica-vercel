(() => {
  "use strict";

  const VERSION = "0.12.41";
  const SESSION_KEY = "offertalogica.editorial.session.v1";
  const SOURCE_OPTIONS = [
    ["search_console", "Search Console"],
    ["public_web", "Fonti pubbliche"],
    ["offertalogica_archive", "Archivio OffertaLogica"],
    ["google_trends", "Trend di ricerca"]
  ];
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
  let state = { settings:null, schedule:[], targets:[], snapshots:[], opportunities:[], plans:[], runs:[] };

  function sessionRead(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||"null");}catch{return null;}}
  function esc(value=""){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function dateIt(value){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);}
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

  function buildShell(){
    const details=document.createElement("details");details.className="ol-panel ol-collapsible-panel ol-autopilot-panel";details.dataset.editorialAutopilot="1";
    details.innerHTML=`
      <summary class="ol-collapsible-summary"><span><strong>Autopilota editoriale</strong><small>Calendario, ricerca storica e piano social</small></span><span class="ol-collapsible-action" aria-hidden="true">Apri</span></summary>
      <div class="ol-collapsible-content ol-panel-body">
        <div class="ol-autopilot-status" data-autopilot-status><div><strong data-autopilot-status-title>Autopilota editoriale</strong><p data-autopilot-status-copy>Caricamento stato motore…</p></div><span class="ol-autopilot-badge" data-autopilot-status-badge>—</span></div>
        <div class="ol-alert ol-alert-danger" data-autopilot-error hidden></div>
        <div class="ol-alert ol-alert-success" data-autopilot-success hidden></div>
        <div data-autopilot-content><p class="ol-muted">Caricamento configurazione…</p></div>
      </div>`;
    return details;
  }

  function render(){
    const root=document.querySelector('[data-editorial-autopilot="1"]');const box=root?.querySelector("[data-autopilot-content]");if(!box)return;
    const s=state.settings||{};
    const mode=String(s.execution_mode||"approval");
    const enabled=Boolean(s.enabled);
    const statusTitle=root.querySelector("[data-autopilot-status-title]");const statusCopy=root.querySelector("[data-autopilot-status-copy]");const statusBadge=root.querySelector("[data-autopilot-status-badge]");
    if(statusTitle&&statusCopy&&statusBadge){
      if(enabled&&mode!=="automatic"){statusTitle.textContent="Motore schedulato attivo";statusCopy.textContent=mode==="draft"?"Ricerca, scelta opportunità e preparazione automatica. Le bozze restano sempre da controllare in Redazione.":"Ricerca, scelta opportunità, articolo con fonti, 2 post e immagine candidata vengono preparati automaticamente. Pubblicazione e approvazione restano manuali.";statusBadge.textContent="Attivo";}
      else if(enabled&&mode==="automatic"){statusTitle.textContent="Automatico completo bloccato";statusCopy.textContent="La pubblicazione totalmente automatica non è ancora abilitata in questa release. Seleziona Genera e chiedi approvazione per usare lo scheduler.";statusBadge.textContent="Bloccato";}
      else{statusTitle.textContent="Motore schedulato disattivato";statusCopy.textContent="La configurazione è pronta, ma nessun ciclo parte finché non abiliti il motore.";statusBadge.textContent="Disattivato";}
    }
    const sourceSet=new Set(Array.isArray(s.research_sources)?s.research_sources:[]);
    const sources=SOURCE_OPTIONS.map(([key,label])=>`<label class="ol-autopilot-source"><input type="checkbox" data-research-source value="${key}"${sourceSet.has(key)?" checked":""}>${esc(label)}</label>`).join("");
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
    const snapshots=state.snapshots.length?state.snapshots.map(x=>`<div class="ol-autopilot-archive-item"><strong>${esc(x.source)} · ${esc(x.period_start||"?")} → ${esc(x.period_end||"?")}</strong><small>${Number(x.row_count||0)} righe aggregate · acquisito ${esc(dateIt(x.captured_at))}${x.notes?` · ${esc(x.notes)}`:""}</small></div>`).join(""):'<p class="ol-muted">Nessun dato di ricerca archiviato ancora.</p>';
    const opps=state.opportunities.length?state.opportunities.map(x=>`<div class="ol-autopilot-archive-item"><strong>${esc(x.topic)} · punteggio ${Number(x.score||0).toFixed(0)}/100</strong><small>${esc(x.opportunity_type)} · ${esc(x.status)}${x.category?` · ${esc(x.category)}`:""}${x.rationale?` · ${esc(x.rationale)}`:""}</small></div>`).join(""):'<p class="ol-muted">Nessuna opportunità editoriale registrata.</p>';
    const plans=state.plans.length?state.plans.map(x=>`<div class="ol-autopilot-archive-item"><strong>${esc(x.post_type)} · ${esc(x.theme||"post social")}</strong><small>${esc(x.status)} · ${esc(dateIt(x.scheduled_for))}</small></div>`).join(""):'<p class="ol-muted">Nessun post aggiuntivo pianificato.</p>';
    const runs=state.runs.length?state.runs.map(x=>`<div class="ol-autopilot-archive-item"><strong>${esc(x.run_type||"run")} · ${esc(x.status||"?")}</strong><small>${esc(dateIt(x.started_at||x.created_at))}${x.last_error?` · ${esc(x.last_error)}`:(x.details?.stage?` · ${esc(x.details.stage)}`:"")}</small></div>`).join(""):'<p class="ol-muted">Nessun ciclo schedulato registrato.</p>';

    box.innerHTML=`<form data-autopilot-form novalidate>
      <div class="ol-autopilot-grid">
        <section class="ol-card ol-autopilot-card"><h3>Regole editoriali</h3><p>Valori modificabili. Il limite iniziale resta un articolo alla settimana.</p>
          <div class="ol-autopilot-fields">
            ${field("Modalità",`<select name="execution_mode"><option value="draft"${s.execution_mode==="draft"?" selected":""}>Solo bozza</option><option value="approval"${s.execution_mode==="approval"?" selected":""}>Genera e chiedi approvazione</option><option value="automatic"${s.execution_mode==="automatic"?" selected":""}>Automatico completo (non ancora abilitato)</option></select>`,`Per il collaudo usa “Genera e chiedi approvazione”. La pubblicazione automatica completa resta bloccata lato server.`)}
            ${field("Frequenza articolo",`<select name="article_frequency_weeks">${[1,2,3,4].map(n=>`<option value="${n}"${Number(s.article_frequency_weeks||1)===n?" selected":""}>Ogni ${n===1?"settimana":`${n} settimane`}</option>`).join("")}</select>`)}
            ${field("Massimo articoli per ciclo",`<input name="max_articles_per_cycle" type="number" min="0" max="3" value="${Number(s.max_articles_per_cycle??1)}">`)}
            ${field("Post social extra / settimana",`<input name="extra_social_posts_per_week" type="number" min="0" max="7" value="${Number(s.extra_social_posts_per_week??2)}">`)}
            ${field("Soglia opportunità",`<input name="minimum_opportunity_score" type="number" min="0" max="100" step="1" value="${Number(s.minimum_opportunity_score??60)}">`,`Sotto questa soglia il sistema potrà decidere di non pubblicare.`)}
            ${field("Fuso orario",`<input name="timezone" type="text" maxlength="80" value="${esc(s.timezone||"Europe/Rome")}">`)}
          </div>
          <div class="ol-autopilot-checks">
            ${checkbox("enabled","Attiva motore schedulato","Quando attivo, Supabase Cron richiama il motore ogni 15 minuti e il calendario decide cosa eseguire.",Boolean(s.enabled))}
            ${checkbox("weekend_observation","Osserva il weekend","Sabato e domenica alimentano i segnali del lunedì.",Boolean(s.weekend_observation))}
            ${checkbox("allow_article_updates","Consenti aggiornamenti","Può proporre di aggiornare un articolo invece di crearne uno nuovo.",Boolean(s.allow_article_updates))}
            ${checkbox("allow_no_publish","Consenti nessuna pubblicazione","Se non c'è un tema valido, il ciclo può chiudersi senza articolo.",Boolean(s.allow_no_publish))}
            ${checkbox("require_sources","Fonti obbligatorie","Un articolo automatico deve avere fonti verificabili.",Boolean(s.require_sources))}
            ${checkbox("require_primary_source","Fonte primaria quando disponibile","Preferisce documenti e dati originari rispetto a sole fonti secondarie.",Boolean(s.require_primary_source))}
          </div>
          <div class="ol-field" style="margin-top:12px"><label>Fonti di ricerca previste</label><div class="ol-autopilot-sources">${sources}</div></div>
        </section>
        <section class="ol-card ol-autopilot-card"><h3>Calendario settimanale</h3><p>Schema concordato: lunedì ricerca + secondo post, martedì preparazione, mercoledì articolo, venerdì post collegato.</p><div class="ol-autopilot-schedule">${schedule}</div></section>
        <section class="ol-card ol-autopilot-card"><h3>Destinazioni promozionali consentite</h3><p>I post generici potranno usare solo destinazioni esplicite di OffertaLogica. Gli URL restano modificabili da te.</p><div class="ol-autopilot-targets">${targets||'<p class="ol-muted">Nessuna destinazione configurata.</p>'}</div></section>
        <section class="ol-card ol-autopilot-card"><h3>Archivio ricerca</h3><p>I dati verranno conservati separando osservazioni grezze aggregate e valutazioni editoriali.</p><div class="ol-autopilot-archive"><h4>Ultime acquisizioni</h4><div class="ol-autopilot-archive-list">${snapshots}</div><h4>Ultime opportunità</h4><div class="ol-autopilot-archive-list">${opps}</div></div></section>
        <section class="ol-card ol-autopilot-card"><h3>Piano social aggiuntivo</h3><p>Qui appariranno i post collegati, evergreen, servizio o dati, separati dai post automatici dell'articolo.</p><div class="ol-autopilot-archive-list">${plans}</div></section>
        <section class="ol-card ol-autopilot-card"><h3>Ultimi cicli automatici</h3><p>Registro tecnico dello scheduler: ricerca, preparazione articolo e controlli intermedi.</p><div class="ol-autopilot-archive-list">${runs}</div></section>
      </div>
      <div class="ol-autopilot-toolbar"><p class="ol-autopilot-save-state" data-autopilot-save-state>${enabled?"Configurazione caricata. Motore schedulato attivo.":"Configurazione caricata. Motore schedulato disattivato."}</p><button class="ol-button ol-button-primary" type="submit">Salva configurazione Autopilota</button></div>
    </form>`;
    box.querySelector("[data-autopilot-form]")?.addEventListener("submit",saveAll);
  }

  async function loadAll(){
    const [settings,schedule,targets,snapshots,opportunities,plans,runs]=await Promise.all([
      api("editorial_automation_settings?select=*&id=eq.1&limit=1"),
      api("editorial_automation_schedule?select=*&order=sort_order.asc"),
      api("editorial_promotion_targets?select=*&order=sort_order.asc,label.asc"),
      api("editorial_research_snapshots?select=id,source,period_start,period_end,captured_at,row_count,notes&order=captured_at.desc&limit=8"),
      api("editorial_research_opportunities?select=id,topic,category,opportunity_type,score,status,rationale,created_at,target_article_id&order=created_at.desc&limit=8"),
      api("editorial_social_plan_items?select=id,post_type,theme,status,scheduled_for,created_at&order=scheduled_for.asc.nullslast,created_at.desc&limit=8"),
      api("editorial_automation_runs?select=id,run_type,status,started_at,finished_at,created_at,last_error,details&order=created_at.desc&limit=8")
    ]);
    state={settings:settings?.[0]||{},schedule:schedule||[],targets:targets||[],snapshots:snapshots||[],opportunities:opportunities||[],plans:plans||[],runs:runs||[]};render();
  }

  async function saveAll(event){
    event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button[type="submit"]');const stateText=form.querySelector("[data-autopilot-save-state]");const session=sessionRead();
    if(!session?.user?.id)return;
    button.disabled=true;if(stateText)stateText.textContent="Salvataggio…";showMessage("","");
    try{
      const selectedSources=[...form.querySelectorAll("[data-research-source]:checked")].map(x=>x.value);
      const requestedMode=form.elements.execution_mode.value;
      const requestedEnabled=Boolean(form.elements.enabled.checked);
      if(requestedEnabled&&requestedMode==="automatic")throw new Error("Automatico completo non è ancora abilitato. Seleziona Genera e chiedi approvazione.");
      const body={
        enabled:requestedEnabled,
        execution_mode:requestedMode,
        timezone:String(form.elements.timezone.value||"Europe/Rome").trim().slice(0,80),
        article_frequency_weeks:Number(form.elements.article_frequency_weeks.value||1),
        max_articles_per_cycle:Number(form.elements.max_articles_per_cycle.value||1),
        extra_social_posts_per_week:Number(form.elements.extra_social_posts_per_week.value||2),
        minimum_opportunity_score:Number(form.elements.minimum_opportunity_score.value||60),
        weekend_observation:Boolean(form.elements.weekend_observation.checked),
        allow_article_updates:Boolean(form.elements.allow_article_updates.checked),
        allow_no_publish:Boolean(form.elements.allow_no_publish.checked),
        require_sources:Boolean(form.elements.require_sources.checked),
        require_primary_source:Boolean(form.elements.require_primary_source.checked),
        research_sources:selectedSources,
        updated_at:new Date().toISOString(),updated_by:session.user.id
      };
      await api("editorial_automation_settings?id=eq.1",{method:"PATCH",prefer:"return=minimal",body});
      await Promise.all([...form.querySelectorAll("[data-slot-id]")].map(row=>api(`editorial_automation_schedule?id=eq.${encodeURIComponent(row.dataset.slotId)}`,{method:"PATCH",prefer:"return=minimal",body:{weekday:Number(row.querySelector("[data-slot-weekday]").value),time_local:row.querySelector("[data-slot-time]").value,enabled:Boolean(row.querySelector("[data-slot-enabled]").checked),updated_at:new Date().toISOString(),updated_by:session.user.id}})));
      await Promise.all([...form.querySelectorAll("[data-target-id]")].map(row=>{
        const url=String(row.querySelector("[data-target-url]").value||"").trim();if(!/^\/(?!\/)/.test(url))throw new Error(`Destinazione non valida: ${url||"vuota"}. Usa un percorso interno che inizi con /.`);
        return api(`editorial_promotion_targets?id=eq.${encodeURIComponent(row.dataset.targetId)}`,{method:"PATCH",prefer:"return=minimal",body:{label:String(row.querySelector("[data-target-label]").value||"").trim().slice(0,120),url_path:url.slice(0,500),category:String(row.querySelector("[data-target-category]").value||"").trim().slice(0,80)||null,enabled:Boolean(row.querySelector("[data-target-enabled]").checked),updated_at:new Date().toISOString(),updated_by:session.user.id}});
      }));
      if(stateText)stateText.textContent=body.enabled?"Configurazione salvata. Il motore schedulato è attivo.":"Configurazione salvata. Il motore schedulato è disattivato.";showMessage("",body.enabled?"Autopilota schedulato attivato.":"Configurazione Autopilota salvata.");await loadAll();
    }catch(error){if(stateText)stateText.textContent="Salvataggio non completato.";showMessage(`Configurazione non salvata: ${error.message}`,"");}
    finally{button.disabled=false;}
  }

  function showMessage(error,success){const root=document.querySelector('[data-editorial-autopilot="1"]');const e=root?.querySelector("[data-autopilot-error]");const s=root?.querySelector("[data-autopilot-success]");if(e){e.textContent=error;e.hidden=!error;}if(s){s.textContent=success;s.hidden=!success;}}

  async function mount(){
    if(mounted||!baseUrl||!anonKey)return;
    const workspace=document.querySelector("[data-review-workspace]");if(!workspace||workspace.hidden)return;
    try{const member=await currentMember();if(member?.role!=="admin"||!member.active)return;const host=document.querySelector(".ol-management-shortcuts");if(!host||document.querySelector('[data-editorial-autopilot="1"]'))return;host.append(buildShell());mounted=true;try{await loadAll();}catch(error){showMessage(`Autopilota non disponibile: ${error.message}`,"");const content=document.querySelector('[data-editorial-autopilot="1"] [data-autopilot-content]');if(content)content.innerHTML='<p class="ol-muted">Esegui prima la migrazione SQL v0.12.41, poi ricarica la Redazione.</p>';}}
    catch(error){console.warn("editorial_autopilot_init_failed",error);}
  }

  function boot(){const workspace=document.querySelector("[data-review-workspace]");if(workspace){new MutationObserver(()=>mount()).observe(workspace,{attributes:true,attributeFilter:["hidden"]});}mount();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
