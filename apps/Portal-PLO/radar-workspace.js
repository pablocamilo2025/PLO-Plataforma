/* Catalog import and authenticated shared persistence. No service keys or approvals here. */
(() => {
  const adminURL=new URL('admin.html',document.currentScript.src).href;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const errors={RADAR_REVISION_CONFLICT:'Otro administrador guardó cambios. Exporta tu borrador y abre de nuevo el catálogo del servidor antes de continuar.',RADAR_ADMIN_REQUIRED:'Se necesita una sesión administrativa.',RADAR_EVIDENCE_REQUIRED:'Revisa la evidencia de las decisiones.',RADAR_INVALID_DOCUMENT:'El documento no tiene el formato esperado.'};
  function errorMessage(error){return Object.entries(errors).find(([code])=>String(error?.message).includes(code))?.[1]||error?.message||'No se pudo completar la operación.';}
  function attach(ui,client){
    const panel=document.createElement('section');panel.className='radar-workspace-controls';
    panel.innerHTML=`<div class="radar-cloud-line"><b data-context>Catálogo de prueba</b><span data-cloud-status></span></div><div class="radar-actions"><button class="radar-btn primary" data-new>Importar catálogo Excel / CSV</button><button class="radar-btn" data-template>Descargar plantilla CSV</button><button class="radar-btn" data-save ${client?'':'disabled'}>Guardar en servidor</button><button class="radar-btn primary" data-discover ${client?'':'disabled'}>Buscar fichas del producto seleccionado</button><button class="radar-btn" data-list ${client?'':'disabled'}>Abrir catálogo del servidor</button></div><p class="radar-muted" data-cloud-help>${client?'Guardado compartido para administradores. Los borradores locales no se envían hasta pulsar Guardar en servidor.':'Vista previa local. Para buscar fichas, guardar y abrir catálogos compartidos, ingresa al administrador.'}</p><div data-central-events></div>`;
    ui.root.querySelector('.radar-header').after(panel);if(!client){const link=document.createElement('a');link.href=adminURL;link.textContent='Ingresar al administrador';link.className='radar-btn';panel.querySelector('.radar-actions').append(link);}
    let busy=false,active=true;const dialogs=new Set();
    const live=()=>active&&ui.root.contains(panel);
    const priorClear=ui.dispose;ui.dispose=()=>{active=false;for(const modal of dialogs)modal.close();priorClear?.();};
    const status=()=>{if(!live())return;panel.querySelector('[data-context]').textContent=(ui.state.report?.catalog_kind==='official'?'OFICIAL':'PRUEBA')+' · '+(ui.state.report?.catalog_title||'Piloto de 16 SKU de ejemplo');panel.querySelector('[data-cloud-status]').textContent=ui.state.cloud?(ui.state.dirty?'Cambios locales sin guardar · ':'')+'Servidor · revisión '+ui.state.cloud.revision+' · '+new Date(ui.state.cloud.updated_at).toLocaleString('es-CL'):'Sin guardar en servidor';};
    const render=ui.render.bind(ui);ui.render=()=>{render();status();};status();
    function persist(next){localStorage.setItem(ui.key,JSON.stringify(next));ui.state=next;ui.sku=null;ui.render();}
    function dialog(title,body){const modal=document.createElement('dialog');modal.className='radar-modal';modal.innerHTML=`<div class="radar"><div class="radar-card-top"><h2>${escape(title)}</h2><button class="radar-btn" data-close aria-label="Cerrar">✕</button></div>${body}<p data-message role="status" style="white-space:pre-line"></p></div>`;document.body.append(modal);dialogs.add(modal);modal.querySelector('[data-close]').onclick=()=>modal.close();modal.addEventListener('close',()=>{dialogs.delete(modal);modal.remove();});modal.showModal();return modal;}
    panel.querySelector('[data-template]').onclick=()=>{const blob=new Blob(['\ufeffsku;nombre;laboratorio;concentracion;presentacion;ean;marca;principio_activo\r\n'],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='plantilla-catalogo-plo-200-sku.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    panel.querySelector('[data-new]').onclick=()=>{
      const modal=dialog('Importar catálogo',`<p>Se creará un catálogo nuevo. El catálogo guardado en el servidor permanecerá separado.</p><form data-import><label>Nombre del catálogo<input name="title" required minlength="3" maxlength="100" placeholder="Ej.: Catálogo oficial octubre 2026"></label><label>Tipo<select name="kind"><option value="test">Prueba · productos de ejemplo</option><option value="official">Oficial · catálogo real de PLO</option></select></label><label>Archivo<input name="file" type="file" accept=".csv,.xlsx" required></label><p class="radar-muted">Columnas: sku, nombre, laboratorio, concentracion, presentacion. EAN, marca y principio_activo son opcionales. Para los 200 SKU: una fila por producto. Incluye cantidad, forma farmacéutica y tipo de liberación en presentación. Conserva SKU y EAN como texto. Máximo 500 productos; Excel con una hoja y valores sin fórmulas.</p><button class="radar-btn" type="submit">Revisar archivo</button></form><div data-preview></div><button class="radar-btn primary" data-confirm hidden>Crear catálogo en este navegador</button>`);
      let report;
      modal.querySelector('form').oninput=()=>{report=null;modal.querySelector('[data-confirm]').hidden=true;modal.querySelector('[data-preview]').textContent='';};
      modal.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,submit=form.querySelector('button');submit.disabled=true;report=null;modal.querySelector('[data-confirm]').hidden=true;try{
        const title=form.elements.title.value,kind=form.elements.kind.value,file=form.elements.file.files[0];
        const rows=await window.RadarCatalog.read(file);if(!live()||!modal.isConnected)return;
        report=window.RadarCatalog.build(rows,kind,title);
        modal.querySelector('[data-preview]').innerHTML=`<div class="radar-note"><b>${report.products.length} productos válidos · ${kind==='test'?'PRUEBA':'OFICIAL'}</b><p>${escape(title)}</p><p>${report.products.filter(p=>!p.ean).length} sin EAN. Sus fichas deberán validarse antes de comparar.</p><ul>${report.products.slice(0,5).map(p=>`<li>${escape(p.sku)} · ${escape(p.name)} · ${escape(p.strength)} · ${escape(p.presentation)}</li>`).join('')}</ul></div>`;modal.querySelector('[data-confirm]').hidden=false;modal.querySelector('[data-message]').textContent='Archivo revisado. Aún no se guardó ni envió al servidor.';
      }catch(error){modal.querySelector('[data-message]').textContent=errorMessage(error);}finally{submit.disabled=false;}};
      modal.querySelector('[data-confirm]').onclick=()=>{if(!report)return;if(ui.state.report&&Object.keys(ui.state.decisions).length&&!window.confirm('Se abrirá un catálogo nuevo. Exporta tu borrador actual si aún no lo guardaste en el servidor. ¿Continuar?'))return;try{persist({report,decisions:{},history:[],cloud:null});modal.close();ui.message(client?'Catálogo importado. Usa Guardar en servidor para compartirlo con los administradores.':'Catálogo importado en la vista previa. Exporta la revisión o entra al administrador para guardarlo en el servidor.');}catch(error){modal.querySelector('[data-message]').textContent=errorMessage(error);}};
    };
    async function run(action){if(busy||!client)return;busy=true;ui.root.inert=true;panel.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();}catch(error){if(live())ui.message(errorMessage(error));}finally{busy=false;ui.root.inert=false;if(live())panel.querySelectorAll('button').forEach(b=>b.disabled=false);}}
    panel.querySelector('[data-save]').onclick=()=>run(async()=>{
      if(!ui.state.report)throw Error('Primero importa un catálogo o un informe.');
      const snapshot=structuredClone(ui.state);
      snapshot.report.catalog_kind ||= 'test';snapshot.report.catalog_title ||= 'Piloto de 16 SKU de ejemplo';
      const id=snapshot.cloud?.id||snapshot.pendingCloudId||crypto.randomUUID();
      // Keep a stable ID so an uncertain initial response can be retried without duplicates.
      ui.state.pendingCloudId=id;localStorage.setItem(ui.key,JSON.stringify(ui.state));
      const document={report:snapshot.report,decisions:snapshot.decisions,history:snapshot.history};
      const {data,error}=await client.rpc('save_radar_workspace',{p_id:id,p_expected_revision:snapshot.cloud?.revision||0,p_title:snapshot.report.catalog_title,p_catalog_kind:snapshot.report.catalog_kind,p_document:document});
      if(error)throw error;if(!live())return;
      // Do not discard a local edit made while the network request was in flight.
      ui.state.report.catalog_kind=snapshot.report.catalog_kind;ui.state.report.catalog_title=snapshot.report.catalog_title;
      ui.state.cloud=data;ui.state.dirty=false;delete ui.state.pendingCloudId;localStorage.setItem(ui.key,JSON.stringify(ui.state));status();
      ui.message('Versión '+data.revision+' guardada en el servidor. Si editaste mientras se guardaba, vuelve a guardar esos cambios.');
      await showEvents(id);
    });
    panel.querySelector('[data-discover]').onclick=()=>run(async()=>{
      if(!ui.state.cloud?.id)throw Error('Primero guarda el catálogo en el servidor.');
      if(ui.state.dirty)throw Error('Guarda tus cambios en el servidor antes de buscar fichas.');
      const sku=ui.sku;if(!sku)throw Error('Selecciona un producto.');
      ui.message('Buscando fichas de '+sku+' en Dr. Simi y Eco. Puede tardar unos segundos…');
      const {data,error}=await client.functions.invoke('radar-discover',{body:{workspace_id:ui.state.cloud.id,revision:ui.state.cloud.revision,sku}});
      if(error){let detail;try{detail=await error.context?.json();}catch{}throw Error(detail?.error||'No se recibió el resultado. Abre de nuevo el catálogo del servidor antes de reintentar.');}
      if(data?.error)throw Error(data.error);if(!live())return;
      const next={...data.document,cloud:data.cloud,dirty:false};
      // The server already saved this result, even if browser storage is full.
      ui.state=next;ui.sku=sku;ui.render();
      try{localStorage.setItem(ui.key,JSON.stringify(next));}catch{ui.message('Resultado guardado en el servidor. El navegador no pudo conservar una copia.');return;}
      const names={drsimi:'Dr. Simi',eco:'Eco'},labels={found:'fichas encontradas',no_results:'sin resultados',query_error:'error de consulta; sin actualización'};
      ui.message(data.summary.map(s=>names[s.source]+': '+(s.status==='found'?s.count+' ':'')+(labels[s.status]||s.status)+(s.truncated?' (búsqueda limitada; revisa el término del catálogo)':'')).join('. ')+(data.skipped.length?'. Se conservaron las fuentes que ya tienen decisiones.':'')+'. Resultados guardados, pendientes de revisión.');
      await showEvents(next.cloud.id);
    });
    async function showEvents(id){const {data,error}=await client.from('radar_workspace_events').select('revision,actor_id,happened_at,action').eq('workspace_id',id).order('revision',{ascending:false}).limit(5);if(error||!live())return;panel.querySelector('[data-central-events]').innerHTML='<details><summary>Historial del servidor</summary><ul>'+data.map(x=>`<li>Versión ${x.revision} · ${escape(new Date(x.happened_at).toLocaleString('es-CL'))} · Administrador ${escape(x.actor_id)}</li>`).join('')+'</ul></details>';}
    panel.querySelector('[data-list]').onclick=()=>run(async()=>{
      const {data,error}=await client.from('radar_workspaces').select('id,title,catalog_kind,revision,updated_at').order('updated_at',{ascending:false}).limit(100);if(error)throw error;if(!live())return;
      const modal=dialog('Catálogos guardados',data.length?`<p>Prueba y Oficial permanecen separados. Abrir un catálogo reemplaza solo el borrador de este navegador.</p><div>${data.map((x,i)=>`<button class="radar-product" data-open="${i}"><small>${x.catalog_kind==='test'?'PRUEBA':'OFICIAL'} · Revisión ${x.revision}</small><b>${escape(x.title)}</b><small>${escape(new Date(x.updated_at).toLocaleString('es-CL'))}</small></button>`).join('')}</div>`:'<p>Todavía no hay catálogos guardados.</p>');
      modal.querySelectorAll('[data-open]').forEach(button=>button.onclick=async()=>{if(ui.state.report&&!window.confirm('¿Abrir este catálogo? Los cambios locales sin guardar no se combinarán. Exporta una copia antes si necesitas conservarlos.'))return;button.disabled=true;try{const {data:row,error}=await client.from('radar_workspaces').select('*').eq('id',data[Number(button.dataset.open)].id).single();if(error)throw error;if(!live())return;persist({...row.document,dirty:false,cloud:{id:row.id,revision:row.revision,updated_at:row.updated_at}});modal.close();await showEvents(row.id);ui.message('Catálogo cargado desde el servidor.');}catch(error){modal.querySelector('[data-message]').textContent=errorMessage(error);}finally{button.disabled=false;}});
    });
  }
  window.RadarWorkspaceControls={attach};
})();
