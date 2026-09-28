/* Administrative review workspace. Draft decisions never enable production queries. */
(() => {
  'use strict';
  const names={drsimi:'Dr. Simi',eco:'EcoFarmacias',cruzverde:'Cruz Verde'};
  const sourceLabels={not_searched:'Sin buscar',found:'Consulta guardada',no_results:'Sin resultados',query_error:'Error de consulta',access_challenge:'Acceso pendiente'};
  const labels={identity_candidate:'Posible coincidencia',laboratory_review:'Revisar laboratorio / marca',different_presentation:'Presentación distinta',incomplete_plo:'Ficha PLO incompleta',insufficient_evidence:'Datos insuficientes'};
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=v=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const date=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString('es-CL'):'Fecha no disponible';
  const money=v=>typeof v==='number'&&Number.isFinite(v)&&v>0?new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(v):'Sin precio';
  function safeURL(value,source){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname===({drsimi:'www.drsimi.cl',eco:'www.ecofarmacias.cl',cruzverde:'www.cruzverde.cl'}[source])&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  function validate(report){
    if(!report||!Array.isArray(report.products)||!report.products.length||report.products.length>500)throw Error('El informe debe contener entre 1 y 500 productos.');
    const skus=new Set();
    for(const p of report.products){
      if(typeof p.sku!=='string'||typeof p.name!=='string'||typeof p.laboratory!=='string'||skus.has(p.sku)||!Array.isArray(p.sources))throw Error('El informe tiene productos inválidos o repetidos.');
      skus.add(p.sku);const sources=new Set();
      for(const s of p.sources){if(!Object.hasOwn(names,s.source)||sources.has(s.source)||!Array.isArray(s.candidates)||s.candidates.length>1000)throw Error('Fuente o candidatos inválidos.');sources.add(s.source);
        const ids=new Set();for(const c of s.candidates){if(typeof c.name!=='string'||typeof c.url!=='string'||!safeURL(c.url,s.source)||!c.product_id||ids.has(String(c.product_id)))throw Error('Ficha sin identidad o enlace válido, o repetida.');ids.add(String(c.product_id));}
      }
    }return report;
  }
  class RadarUI{
    constructor(root,operator,initial,client){this.root=root;this.operator=operator;this.key='plo-radar-draft-v1:'+operator;this.state={report:null,decisions:{},history:[]};this.sku=null;this.source='drsimi';this.search='';this.filter='all';
      try{const saved=JSON.parse(localStorage.getItem(this.key));if(saved?.report){validate(saved.report);this.state=saved;}}catch{}
      if(!this.state.report&&initial)this.state.report=validate(initial);
      this.shell();this.render();window.RadarWorkspaceControls?.attach(this,client);window.RadarOperations?.attach(this,client);
    }
    shell(){this.root.className='radar';this.root.innerHTML=`<header class="radar-header"><div><span class="radar-eyebrow">Inteligencia comercial · PLO Farma</span><h1>Radar de precios</h1><span class="radar-muted">Cada precio empieza por un producto bien identificado.</span></div><div class="radar-actions"><button class="radar-btn" data-action="import">Cargar informe</button><button class="radar-btn primary" data-action="export">Exportar revisión</button><input type="file" accept=".json,application/json" hidden id="radar-file"></div></header><div class="radar-note"><b>Espacio de revisión · borrador local.</b> Tus decisiones quedan como borrador hasta guardar en el servidor. Buscar fichas consulta las fuentes para revisión; ninguna propuesta cambia los precios del Portal.</div><div class="radar-message" role="status" aria-live="polite"></div><div class="radar-stats"></div><div class="radar-layout"><aside class="radar-list"><div class="radar-tools"><input type="search" placeholder="Buscar producto o SKU" aria-label="Buscar producto o SKU"><select aria-label="Filtrar productos"><option value="all">Todos los productos</option><option value="pending">Pendientes de revisión</option><option value="proposed">Con asociación propuesta</option><option value="incomplete">Datos PLO incompletos</option></select></div><div class="radar-products"></div></aside><div class="radar-detail"></div></div><p class="radar-footer">Precios observados, sujetos a condiciones y disponibilidad. Una propuesta de asociación y el stock son estados independientes.</p>`;
      this.root.querySelector('[data-action=import]').onclick=()=>this.root.querySelector('#radar-file').click();
      this.root.querySelector('#radar-file').onchange=event=>this.importFile(event.target.files[0]);
      this.root.querySelector('[data-action=export]').onclick=()=>this.export();
      this.root.querySelector('input[type=search]').oninput=event=>{this.search=event.target.value;this.renderList();};
      this.root.querySelector('select').onchange=event=>{this.filter=event.target.value;this.renderList();};
    }
    message(text){this.root.querySelector('.radar-message').textContent=text;}
    products(){return this.state.report?.products||[];}
    proposed(sku){return Object.values(this.state.decisions).some(d=>d.sku===sku&&d.decision==='proposed');}
    render(){const ps=this.products();if(!ps.some(p=>p.sku===this.sku))this.sku=ps[0]?.sku;const proposed=ps.filter(p=>this.proposed(p.sku)).length;
      this.root.querySelector('.radar-stats').innerHTML=[['Productos en revisión',ps.length],['Con propuesta de asociación',proposed],['Sin propuesta todavía',ps.length-proposed],['Datos PLO incompletos',ps.filter(p=>p.identity_status==='incomplete').length]].map(([label,n])=>`<div class="radar-stat"><span>${label}</span><b>${n}</b></div>`).join('');
      this.root.querySelector('[data-action=export]').disabled=!ps.length;this.renderList();this.renderDetail();
    }
    renderList(){const ps=this.products().filter(p=>normalize(p.sku+' '+p.name+' '+p.laboratory).includes(normalize(this.search))&&(this.filter==='all'||this.filter==='proposed'&&this.proposed(p.sku)||this.filter==='pending'&&!this.proposed(p.sku)||this.filter==='incomplete'&&p.identity_status==='incomplete'));
      this.root.querySelector('.radar-products').innerHTML=ps.map(p=>`<button class="radar-product ${p.sku===this.sku?'selected':''}" data-sku="${e(p.sku)}" aria-pressed="${p.sku===this.sku}"><small>${e(p.sku)}</small><b>${e(p.name)}</b><small>${e(p.laboratory)} · ${this.proposed(p.sku)?'Propuesta guardada':'Pendiente'}</small></button>`).join('')||'<div class="radar-empty">No hay productos para mostrar. Carga el informe del piloto o cambia los filtros.</div>';
      this.root.querySelectorAll('[data-sku]').forEach(b=>b.onclick=()=>{this.sku=b.dataset.sku;this.renderList();this.renderDetail();});
    }
    id(p,s,c){return JSON.stringify([p.sku,s.source,String(c.product_id)]);}
    renderDetail(){const p=this.products().find(p=>p.sku===this.sku),el=this.root.querySelector('.radar-detail');if(!p){el.innerHTML='<div class="radar-empty"><h2>Tu mesa de revisión</h2><p>Carga el archivo review.json del piloto para empezar a vincular productos y fichas.</p></div>';return;}
      const s=p.sources.find(s=>s.source===this.source)||p.sources[0];if(!s){el.innerHTML='<div class="radar-empty">El producto no tiene fuentes.</div>';return;}this.source=s.source;
      const primary=s.candidates.filter(c=>['identity_candidate','laboratory_review'].includes(c.triage)).sort((a,b)=>(a.triage==='identity_candidate'?0:1)-(b.triage==='identity_candidate'?0:1));const other=s.candidates.filter(c=>!primary.includes(c));
      const history=this.state.history.filter(h=>h.sku===p.sku).slice(-8).reverse();
      el.innerHTML=`<header class="radar-detail-head"><span class="radar-eyebrow">${e(p.sku)} · Producto PLO</span><h2>${e(p.name)}</h2><p class="radar-muted">${e(p.strength||'')} ${e(p.presentation||'')}</p><p class="radar-muted">${e(p.laboratory)} · EAN: ${e(p.ean||'pendiente')}</p><div class="radar-note">${e(p.notes)}</div><div class="radar-source-tabs" role="group" aria-label="Farmacia a revisar">${p.sources.map(x=>`<button data-source="${e(x.source)}" class="${x.source===s.source?'active':''}" aria-pressed="${x.source===s.source}">${names[x.source]} · ${x.candidates.length}</button>`).join('')}</div></header><div class="radar-candidates"><h3>${names[s.source]} <span class="radar-badge gray">${e(sourceLabels[s.status]||'Observación guardada')}</span></h3><p class="radar-muted">${primary.length} fichas preseleccionadas. Verifica laboratorio, composición, dosis, forma y contenido.</p>${s.status==='query_error'?`<div class="radar-note">${s.error==='HTTP_403'?'La fuente rechazó el acceso desde el servidor (403). Esta conexión requiere revisión.':'La última consulta falló.'} ${s.candidates.length?'Las fichas anteriores conservan su fecha y no se consideran actualizadas.':'No hay fichas recuperadas para mostrar.'}</div>`:''}${s.truncated?'<div class="radar-note">La búsqueda alcanzó el límite de resultados. Puede haber más fichas en la fuente.</div>':''}${s.status==='access_challenge'?'<div class="radar-note">Acceso a la fuente pendiente. No se recuperó un precio verificable de Cruz Verde.</div>':''}${primary.map(c=>this.card(p,s,c)).join('')||'<div class="radar-empty">Sin fichas preseleccionadas para este producto y farmacia.</div>'}${other.length?`<details class="radar-more"><summary>Otros resultados encontrados (${other.length})</summary>${other.map(c=>this.card(p,s,c)).join('')}</details>`:''}</div><div class="radar-history"><h3>Historial de este borrador</h3>${history.length?`<ol>${history.map(h=>`<li>${e(h.label)} · ${names[h.source]}<small class="radar-muted"> · ${date(h.at)}</small></li>`).join('')}</ol>`:'<p class="radar-muted">Todavía no registraste decisiones.</p>'}</div>`;
      el.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{this.source=b.dataset.source;this.renderDetail();});
      el.querySelectorAll('form[data-candidate]').forEach(form=>form.onsubmit=event=>{event.preventDefault();this.save(p,s,s.candidates[Number(form.dataset.candidate)],form);});
    }
    card(p,s,c){const d=this.state.decisions[this.id(p,s,c)]||{},index=s.candidates.indexOf(c),url=safeURL(c.url,s.source);const canPropose=p.identity_status!=='incomplete'&&['identity_candidate','laboratory_review'].includes(c.triage);
      return `<article class="radar-card"><div class="radar-card-top"><div><span class="radar-badge">${e(labels[c.triage]||'Pendiente de revisión')}</span><h4>${e(c.name)}</h4><small>Marca / laboratorio en fuente: ${e(c.brand||'no confirmado')}</small></div><div class="radar-price">${money(c.price)}</div></div><div class="radar-status-line"><span class="radar-badge ${c.available?'green':'gray'}">${c.available===true?'Disponible al consultar':c.available===false?'Sin stock al consultar':'Stock sin confirmar'}</span>${d.decision?`<span class="radar-badge gray">${{proposed:'Asociación propuesta',rejected:'Descartada en borrador',pending:'Pendiente'}[d.decision]||'Pendiente'}</span>`:''}</div><p>${e((c.reasons||[]).join(' '))}</p><small>Consultado: ${date(c.checked_at)} · ID: ${e(c.product_id)}</small><small>${e(c.price_conditions||'Condiciones comerciales pendientes de revisar.')}</small><p>${url?`<a href="${e(url)}" target="_blank" rel="noopener noreferrer">Abrir ficha original ↗</a>`:''}</p><details><summary>Revisar esta ficha</summary><form class="radar-review" data-candidate="${index}"><label>Decisión<select name="decision"><option value="pending" ${d.decision==='pending'?'selected':''}>Dejar pendiente</option><option value="proposed" ${!canPropose?'disabled':''} ${d.decision==='proposed'?'selected':''}>Proponer como producto exacto</option><option value="rejected" ${d.decision==='rejected'?'selected':''}>Descartar esta ficha</option></select></label>${!canPropose?'<small>Completa o corrige los datos del producto antes de proponer esta ficha.</small>':''}<label>Evidencia o motivo<textarea name="evidence" rows="3" maxlength="2000" placeholder="Indica qué verificaste y dónde. Para descartar, explica la diferencia.">${e(d.evidence||'')}</textarea></label><label class="radar-check"><input type="checkbox" name="verified" ${d.verified?'checked':''}>Verifiqué identidad completa: laboratorio, marca, composición, dosis, forma, liberación y cantidad.</label><button class="radar-btn primary" type="submit">Guardar en borrador</button></form></details></article>`;
    }
    save(p,s,c,form){const values=new FormData(form),decision=values.get('decision'),evidence=String(values.get('evidence')||'').trim(),verified=values.has('verified');
      if(decision!=='pending'&&evidence.length<12){this.message('Agrega evidencia o un motivo de al menos 12 caracteres.');return;}
      if(decision==='proposed'&&(!verified||p.identity_status==='incomplete'||!['identity_candidate','laboratory_review'].includes(c.triage))){this.message('La propuesta requiere verificar la identidad completa del producto.');return;}
      const next=structuredClone(this.state),id=this.id(p,s,c),at=new Date().toISOString();next.dirty=true;
      if(decision==='proposed')for(const [key,d] of Object.entries(next.decisions)){if(d.sku===p.sku&&d.source===s.source&&d.decision==='proposed'&&key!==id){d.decision='pending';next.history.push({sku:p.sku,source:s.source,at,label:'Propuesta anterior reemplazada: '+d.name});}}
      next.decisions[id]={sku:p.sku,source:s.source,product_id:String(c.product_id),url:c.url,name:c.name,decision,evidence,verified,at,operator:this.operator};
      next.history.push({sku:p.sku,source:s.source,at,label:({proposed:'Asociación propuesta',rejected:'Ficha descartada',pending:'Ficha pendiente'}[decision])+': '+c.name});
      try{localStorage.setItem(this.key,JSON.stringify(next));this.state=next;this.render();this.message('Borrador guardado en este navegador. No se activaron consultas.');}catch{this.message('No se pudo guardar. El navegador puede tener el almacenamiento lleno o deshabilitado.');}
    }
    async importFile(file){if(!file)return;try{if(file.size>8000000)throw Error('El archivo excede 8 MB.');const raw=JSON.parse(await file.text()),backup=raw.format==='plo-radar-review-draft-v1',report=validate(backup?raw.report:raw);
      const next={report,decisions:{},history:[]};
      if(backup){
        if(!Array.isArray(raw.decisions)||!Array.isArray(raw.history))throw Error('Copia de revisión inválida.');
        for(const d of raw.decisions){const product=report.products.find(p=>p.sku===d.sku),source=product?.sources.find(s=>s.source===d.source),candidate=source?.candidates.find(c=>String(c.product_id)===String(d.product_id));
          if(!candidate||d.url!==candidate.url||d.name!==candidate.name||!['proposed','pending','rejected'].includes(d.decision)||typeof d.evidence!=='string'||typeof d.at!=='string')throw Error('Decisión incompatible con el informe.');
          if(d.decision==='proposed'&&(d.verified!==true||d.evidence.trim().length<12||product.identity_status==='incomplete'||!['identity_candidate','laboratory_review'].includes(candidate.triage)))throw Error('La propuesta no tiene evidencia válida.');
          const key=this.id(product,source,candidate);if(next.decisions[key])throw Error('Decisión repetida.');
          if(d.decision==='proposed'&&Object.values(next.decisions).some(x=>x.sku===d.sku&&x.source===d.source&&x.decision==='proposed'))throw Error('Más de una propuesta para la misma fuente.');
          next.decisions[key]=d;
        }
        next.history=raw.history.filter(h=>typeof h.label==='string'&&typeof h.at==='string'&&Object.hasOwn(names,h.source)&&report.products.some(p=>p.sku===h.sku));
      }
      if(Object.keys(this.state.decisions).length&&!window.confirm('Esto reemplazará el borrador de este navegador. Exporta una copia antes si deseas conservarlo. ¿Cargar el archivo?'))return;localStorage.setItem(this.key,JSON.stringify(next));this.state=next;this.render();this.message('Informe cargado. Sus precios corresponden a la fecha de consulta indicada.');
    }catch(error){this.message('No se cargó el informe: '+error.message);}finally{this.root.querySelector('#radar-file').value='';}}
    export(){const result={format:'plo-radar-review-draft-v1',production_enabled:false,exported_at:new Date().toISOString(),operator:this.operator,report:this.state.report,decisions:Object.values(this.state.decisions),history:this.state.history};const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='plo-radar-revision-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.message('Revisión exportada como borrador. No es un registro de consultas habilitadas.');}
  }
  let ui;
  window.portalRadar={mount(operator,initial,client){const root=document.getElementById('radar-workspace');if(root&&(!ui||ui.operator!==operator)){ui?.dispose?.();ui=new RadarUI(root,operator,initial,client);}},clear(){if(ui){ui.dispose?.();ui.root.inert=false;ui.root.replaceChildren();}ui=null;}};
  if(window.PLO_RADAR_PREVIEW)window.portalRadar.mount('vista-previa-local',window.PLO_RADAR_PREVIEW);
})();
