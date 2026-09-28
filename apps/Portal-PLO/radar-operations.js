/* Administrative publication and queue controls. Client contains no service credentials. */
(function(root){
 'use strict';
 const names={drsimi:'Dr. Simi',eco:'Farmacias Eco',cruzverde:'Cruz Verde'};
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function publication(state){
  if(!state.cloud?.id||state.dirty)throw Error('Guarda el catálogo y sus decisiones en el servidor antes de publicar.');
  const products=state.report?.products||[],mappings=[],seen=new Set();
  for(const d of Object.values(state.decisions||{})){
   if(d.decision!=='proposed')continue;
   const p=products.find(p=>p.sku===d.sku),source=p?.sources.find(s=>s.source===d.source);
   const c=source?.candidates.find(c=>String(c.product_id)===String(d.product_id));
   if(!p||!c||!d.verified||typeof d.evidence!=='string'||d.evidence.trim().length<12||p.identity_status==='incomplete'||!p.strength||!p.presentation||c.url!==d.url||c.name!==d.name)throw Error('Hay propuestas sin verificación completa. Revisa '+d.sku+'.');
   const key=d.sku+':'+d.source;if(seen.has(key))throw Error('Más de una propuesta para '+key);seen.add(key);
   mappings.push({sku:d.sku,source:d.source,product_id:String(d.product_id),name:d.name,url:d.url});
  }
  if(!mappings.length)throw Error('Todavía no hay asociaciones propuestas y verificadas para publicar.');
  return {mappings,products:products.length,covered:new Set(mappings.map(m=>m.sku)).size,missing:products.length*3-mappings.length};
 }
 function attach(ui,client){
  if(!client)return;
  const section=document.createElement('section');section.className='radar-workspace-controls';
  section.innerHTML=`<h2>Operación del Radar</h2><p>1. Importar → 2. Guardar → 3. Buscar y revisar fichas → 4. Publicar asociaciones → 5. Activar consultas.</p><div class="radar-actions" style="margin-top:14px"><button class="radar-btn" data-status>Actualizar estado</button><button class="radar-btn primary" data-publish>Revisar publicación</button><button class="radar-btn" data-pause>Pausar consultas</button><button class="radar-btn" data-enable>Preparar activación</button></div><p data-message role="status">Consulta el estado para ver pendientes y errores.</p><div data-results></div><details><summary>Cómo cargar los 200 SKU</summary><ol><li>Descarga la plantilla CSV desde los controles del catálogo. También puedes importar Excel con una sola hoja.</li><li>Una fila por SKU. Completa nombre, laboratorio, concentración y presentación incluyendo cantidad, forma y liberación. Conserva SKU y EAN como texto. No uses fórmulas.</li><li>Importa como Oficial cuando tengas la lista real. El costo se administra en el catálogo comercial del Portal; este archivo identifica productos para buscar precios.</li><li>Guarda el catálogo y busca fichas de cada producto. Revisa laboratorio, marca, dosis, cantidad y condiciones antes de proponer.</li><li>Publica únicamente las asociaciones verificadas. Los productos sin equivalencia quedan sin referencia.</li><li>Antes de activar, confirma el modo del worker en Render y que no haya otros catálogos activos involuntariamente. Las consultas son cada 48 horas.</li></ol><p>La búsqueda actual es por producto; las fichas de Cruz Verde requieren completar su revisión. Importar 200 SKU no aprueba automáticamente 600 asociaciones.</p></details>`;
  ui.root.querySelector('.radar-workspace-controls').after(section);
  let live=true,busy=false;const modals=new Set();
  const dispose=ui.dispose;ui.dispose=()=>{live=false;for(const d of modals)d.close();dispose?.();};
  const message=s=>{if(live)section.querySelector('[data-message]').textContent=s;};
  async function run(fn){if(busy)return;busy=true;section.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(err){message(err.message||'Operación no disponible.');}finally{busy=false;if(live)section.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  const date=s=>s?new Date(s).toLocaleString('es-CL'):'Sin consulta';
  async function refresh(){
   const data=await root.RadarAPI.status(client);if(!live)return data;
   const active=data.targets.filter(t=>t.active),errors=active.filter(t=>t.last_error),pending=active.filter(t=>!t.last_success_at),old=active.filter(t=>t.last_success_at&&Date.now()-Date.parse(t.last_success_at)>=48*3600000);
   message(`Cola ${data.settings.enabled?'HABILITADA':'PAUSADA'} · Frecuencia: ${data.settings.interval_hours} horas. Pausar no detiene una consulta ya en curso ni suspende el cobro del servidor.`);
   section.querySelector('[data-results]').innerHTML=`<div class="radar-stats"><div class="radar-stat"><b>${active.length}</b><span>Asociaciones activas</span></div><div class="radar-stat"><b>${pending.length}</b><span>Sin primer precio</span></div><div class="radar-stat"><b>${errors.length}</b><span>Con error</span></div><div class="radar-stat"><b>${old.length}</b><span>Precios de más de 48 h</span></div></div><p>Oficiales: ${active.filter(t=>t.catalog_kind==='official').length} · Prueba: ${active.filter(t=>t.catalog_kind==='test').length}. Estado observado: ${e(new Date().toLocaleString('es-CL'))}.</p><details><summary>Asociaciones activas y pendientes</summary>${active.length?`<div style="overflow:auto;max-height:400px"><table><thead><tr><th>SKU</th><th>Fuente</th><th>Tipo</th><th>Último éxito</th><th>Próxima consulta</th><th>Estado</th></tr></thead><tbody>${active.map(t=>`<tr><td>${e(t.sku)}</td><td>${e(names[t.source])}</td><td>${e(t.catalog_kind)}</td><td>${e(date(t.last_success_at))}</td><td>${e(date(t.next_due_at))}</td><td>${e(t.last_error||(!t.last_success_at?'Pendiente de primera consulta':'Sin error registrado'))}</td></tr>`).join('')}</tbody></table></div>`:'<p>No hay asociaciones activas.</p>'}</details>`;
   return data;
  }
  function modal(title,body){const d=document.createElement('dialog');d.className='radar-modal';d.innerHTML=`<div class="radar"><h2>${e(title)}</h2>${body}<p data-error role="alert"></p><button class="radar-btn" data-close>Cerrar</button></div>`;document.body.append(d);modals.add(d);d.querySelector('[data-close]').onclick=()=>d.close();d.onclose=()=>{modals.delete(d);d.remove();};d.showModal();return d;}
  section.querySelector('[data-status]').onclick=()=>run(refresh);
  section.querySelector('[data-pause]').onclick=()=>run(async()=>{await root.RadarAPI.setEnabled(client,false);await refresh();});
  section.querySelector('[data-publish]').onclick=()=>run(async()=>{
   const plan=publication(ui.state),snapshot=structuredClone(ui.state),current=await refresh();if(!live)return;
   if(current.settings.enabled)throw Error('Pausa las consultas antes de publicar asociaciones.');
   const existing=current.targets.filter(t=>t.workspace_id===snapshot.cloud.id&&t.active).length;
   const d=modal('Revisar publicación',`<p><b>${e(snapshot.report.catalog_kind==='official'?'OFICIAL':'PRUEBA')} · ${e(snapshot.report.catalog_title)}</b> · revisión ${snapshot.cloud.revision}</p><p>${plan.covered} de ${plan.products} SKU con referencia · ${plan.mappings.length} asociaciones · ${plan.missing} referencias sin asociación.</p><p>Esta publicación reemplaza las ${existing} asociaciones activas de este catálogo y reinicia sus precios guardados. No activa consultas por sí sola.</p><form><div>${plan.mappings.map((m,i)=>`<details><summary>${e(m.sku)} · ${e(names[m.source])}</summary><p>${e(m.name)}</p><label>Condiciones verificadas de este precio<textarea data-condition="${i}" minlength="12" maxlength="1000" placeholder="Precio web, membresía, convenio, comuna o restricciones verificadas"></textarea></label></details>`).join('')}</div><label><input type="checkbox" required> Revisé las asociaciones y las condiciones; autorizo reemplazar la publicación de este catálogo.</label><button class="radar-btn primary" type="submit">Publicar ${plan.mappings.length} asociaciones</button></form>`);
   d.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{
    if(ui.state.dirty||ui.state.cloud?.id!==snapshot.cloud.id||ui.state.cloud?.revision!==snapshot.cloud.revision)throw Error('El catálogo cambió. Cierra y revisa de nuevo la publicación.');
    const mappings=plan.mappings.map((m,i)=>({sku:m.sku,source:m.source,product_id:m.product_id,conditions:d.querySelector(`[data-condition="${i}"]`).value.trim()}));
    const invalid=mappings.findIndex(m=>m.conditions.length<12);if(invalid>=0){const field=d.querySelector(`[data-condition="${invalid}"]`);field.closest('details').open=true;field.focus();throw Error('Completa condiciones verificadas para cada asociación.');}
    if((await root.RadarAPI.status(client)).settings.enabled)throw Error('La cola se activó. Pausa antes de publicar.');
    await root.RadarAPI.publish(client,snapshot.cloud.id,snapshot.cloud.revision,mappings);d.close();await refresh();message('Asociaciones publicadas. La cola permanece pausada; revisa la preparación antes de activar.');
   }catch(err){if(d.isConnected)d.querySelector('[data-error]').textContent=err.message;}finally{button.disabled=false;}};
  });
  section.querySelector('[data-enable]').onclick=()=>run(async()=>{
   const data=await refresh();if(!live)return;const active=data.targets.filter(t=>t.active);
   if(!active.length)throw Error('Primero publica asociaciones verificadas. No hay tareas activas.');
   const kinds=[...new Set(active.map(t=>t.catalog_kind))];
   if(kinds.length!==1)throw Error('Hay asociaciones de prueba y oficiales activas. Revisa su separación antes de activar la cola global.');
   const kind=kinds[0];
   const d=modal('Activar consultas cada 48 horas',`<p>Se habilitará la cola global con ${active.length} asociaciones de tipo <b>${e(kind)}</b>. Consumirá sesiones de Browserbase.</p><p>El Portal no puede comprobar todavía el modo del worker. En Render confirma RADAR_CATALOG_KIND=${e(kind)} y un despliegue saludable. El worker instalado inicialmente está en modo test.</p><form><label><input type="checkbox" required> Confirmé el modo ${e(kind)} en Render y revisé todas las asociaciones activas.</label><button class="radar-btn primary">Activar consultas</button></form>`);
   const ids=active.map(t=>t.id).sort().join(',');
   d.querySelector('form').onsubmit=async event=>{event.preventDefault();const b=event.currentTarget.querySelector('button');b.disabled=true;try{
    const latest=await root.RadarAPI.status(client),targets=latest.targets.filter(t=>t.active);
    if(targets.map(t=>t.id).sort().join(',')!==ids||targets.some(t=>t.catalog_kind!==kind))throw Error('Cambió la cola. Revisa nuevamente antes de activar.');
    await root.RadarAPI.setEnabled(client,true);d.close();await refresh();
   }catch(err){if(d.isConnected)d.querySelector('[data-error]').textContent=err.message;}finally{b.disabled=false;}};
  });
 }
 root.RadarOperations={attach,publication};
})(typeof window!=='undefined'?window:globalThis);
