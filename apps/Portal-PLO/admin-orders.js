/* Admin-only UI. All authorizations and state transitions are checked server-side. */
(() => {
  const statusNames={awaiting_payment:'Pendiente de pago',submitted:'Recibido',confirmed:'Pago confirmado',preparing:'En preparación',in_transit:'En ruta',delivered:'Entregado',cancelled:'Cancelado'};
  const paymentNames={cash:'Efectivo · retiro',bank_transfer:'Transferencia',khipu:'Khipu'};
  const actionNames={confirm_payment:'Registrar pago recibido',prepare:'Pasar a preparación',dispatch:'Marcar despachado',deliver:'Marcar entregado',cancel:'Cancelar y devolver stock'};
  const clp=value=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value);
  let page=0,listRequest=0,detailRequest=0,selected=null,busy=false;
  const badge=status=>`<span class="status ${escapeHtml(status)}">${escapeHtml(statusNames[status]||status)}</span>`;

  async function api(body){
    const {data,error}=await client.functions.invoke('manage-portal-orders',{body});
    if(error){let message='No fue posible cargar o actualizar el pedido.';try{message=(await error.context?.json())?.error||message;}catch{}throw new Error(message);}
    if(data?.error)throw new Error(data.error);
    if(!data)throw new Error('El servidor no devolvió una respuesta.');
    return data;
  }
  function switchSection(name){
    $('orders-section').hidden=name!=='orders';$('pharmacies-section').hidden=name!=='pharmacies';
    ['orders','pharmacies'].forEach(section=>{const button=$(section+'-tab');button.classList.toggle('active',section===name);if(section===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  }
  async function load(){
    const request=++listRequest;
    $('orders-content').className='loading';$('orders-content').textContent='Cargando pedidos…';
    $('orders-prev').disabled=true;$('orders-next').disabled=true;
    try{
      const data=await api({action:'list',page,search:$('orders-search').value.trim(),status:$('orders-filter').value});
      if(request!==listRequest)return;
      if(!data.orders.length&&page>0){page=0;return load();}
      $('orders-pending').textContent=data.stats.pending;$('orders-processing').textContent=data.stats.processing;$('orders-delivered').textContent=data.stats.delivered;
      $('orders-page-label').textContent=data.total?`${page*25+1}–${Math.min((page+1)*25,data.total)} de ${data.total} pedidos`:'0 pedidos';
      $('orders-prev').disabled=page===0;$('orders-next').disabled=(page+1)*25>=data.total;
      if(!data.orders.length){$('orders-content').className='empty';$('orders-content').textContent='No hay pedidos para mostrar. Las nuevas compras aparecerán aquí.';return;}
      $('orders-content').className='table-wrap';
      $('orders-content').innerHTML=`<table class="orders-table"><thead><tr><th>Orden / fecha</th><th>Farmacia</th><th>Estado</th><th>Pago</th><th>Total con IVA</th><th></th></tr></thead><tbody>${data.orders.map(o=>`<tr><td><b class="mono">${escapeHtml(o.order_number)}</b><span class="sub">${escapeHtml(formatDate(o.created_at))}</span></td><td><span class="pharmacy">${escapeHtml(o.pharmacy_name)}</span><span class="sub">${escapeHtml(o.pharmacy_rut)}</span></td><td>${badge(o.status)}${o.status==='awaiting_payment'?`<span class="sub">Reserva hasta ${escapeHtml(formatDate(o.expires_at))}</span>`:''}</td><td>${escapeHtml(paymentNames[o.payment_method]||o.payment_method)}<span class="sub">${o.payment_status==='paid'?'✓ Pago registrado':o.status==='cancelled'?'Orden cancelada':'Pendiente'}</span></td><td class="order-total mono">${clp(o.grand_total)}</td><td><button class="btn btn-primary btn-sm" data-order-id="${o.id}">Ver pedido →</button></td></tr>`).join('')}</tbody></table>`;
      document.querySelectorAll('[data-order-id]').forEach(button=>button.addEventListener('click',()=>openDetail(Number(button.dataset.orderId))));
    }catch(error){if(request!==listRequest)return;$('orders-content').className='empty';$('orders-content').textContent=error.message;$('orders-page-label').textContent='Usa Actualizar pedidos para reintentar.';}
  }
  function operations(o){
    if(o.status==='awaiting_payment'&&o.payment_status==='pending')return Date.parse(o.expires_at)>Date.now()?['confirm_payment','cancel']:['cancel'];
    if(o.payment_status!=='paid')return [];
    if(o.status==='confirmed')return o.payment_method==='cash'?['prepare','deliver']:['prepare'];
    if(o.status==='preparing')return [o.payment_method==='cash'?'deliver':'dispatch'];
    if(o.status==='in_transit')return ['deliver'];
    return [];
  }
  async function openDetail(id){
    const request=++detailRequest;selected=null;
    $('order-dialog-title').textContent='Pedido';$('order-detail').textContent='Cargando detalle…';
    if(!$('order-dialog').open)$('order-dialog').showModal();
    try{const data=await api({action:'detail',orderId:id});if(request!==detailRequest)return;selected=data.order;renderDetail(data);}
    catch(error){if(request!==detailRequest)return;$('order-detail').textContent=error.message;}
  }
  function renderDetail({order:o,events}){
    $('order-dialog-title').textContent=o.order_number;
    const options=operations(o),expired=o.status==='awaiting_payment'&&Date.parse(o.expires_at)<=Date.now();
    $('order-detail').innerHTML=`
      <div class="order-summary"><div><b>${escapeHtml(o.pharmacies?.display_name)}</b><p>RUT ${escapeHtml(o.pharmacies?.rut)}</p><p>Recibido: ${escapeHtml(formatDate(o.created_at))}</p></div><div>${badge(o.status)}<p>${escapeHtml(paymentNames[o.payment_method])} · ${o.payment_status==='paid'?'Pago registrado':'Sin pago registrado'}</p>${o.status==='awaiting_payment'?`<p>Reserva: ${escapeHtml(formatDate(o.expires_at))}</p>`:''}${o.payment_reference?`<p>Referencia de pago: ${escapeHtml(o.payment_reference)}</p>`:''}</div></div>
      ${expired?'<p class="order-notice">La reserva venció y está pendiente de liberación automática. Ya no se puede registrar un pago sobre esta orden.</p>':''}
      <div class="table-wrap"><table class="order-lines"><thead><tr><th>Producto / lote</th><th>Cantidad</th><th>Neto unitario</th><th>Subtotal neto</th></tr></thead><tbody>${o.order_items.map(item=>`<tr><td><b>${escapeHtml(item.product_name)}</b><span class="sub">${escapeHtml(item.sku)} · ${escapeHtml(item.laboratory)} · Lote ${escapeHtml(item.lot_code)}</span></td><td class="mono">${item.quantity}</td><td class="mono">${clp(item.unit_net_price)}</td><td class="mono">${clp(item.line_net_total)}</td></tr>`).join('')}</tbody></table></div>
      <div class="order-totals"><p><span>Neto</span><b>${clp(o.net_total)}</b></p><p><span>IVA (19%)</span><b>${clp(o.tax_total)}</b></p><p><span>Total</span><b>${clp(o.grand_total)}</b></p></div>
      ${options.length?`<form id="order-action-form" class="order-action-box"><h3>Gestionar pedido</h3><label for="order-operation">Próximo paso</label><select id="order-operation">${options.map(action=>`<option value="${action}">${escapeHtml(actionNames[action])}</option>`).join('')}</select><p id="order-action-help"></p><label for="order-note" id="order-note-label">Referencia o motivo</label><textarea id="order-note" minlength="3" maxlength="500" required placeholder="Referencia del pago o detalle de la gestión"></textarea><label class="confirm-check"><input type="checkbox" id="order-action-confirm" required><span id="order-confirm-label"></span></label><div id="order-action-message" class="message" role="alert"></div><button class="btn btn-primary" id="order-save" type="submit">Guardar cambio</button></form>`:o.status==='cancelled'?'<p class="order-notice">Pedido cancelado. La reserva fue liberada.</p>':o.status==='delivered'?'<p class="order-notice">Pedido entregado. La gestión está completa.</p>':'<p class="order-notice">No hay acciones disponibles para este estado.</p>'}
      ${o.payment_status==='paid'&&o.status!=='delivered'?'<p class="sub">Las cancelaciones de pedidos pagados requieren gestionar la devolución por separado.</p>':''}
      <section class="order-history"><h3>Historial de gestión</h3><ol><li><b>Pedido recibido · stock reservado</b><small>${escapeHtml(formatDate(o.created_at))}</small></li>${events.map(event=>`<li><b>${escapeHtml(actionNames[event.action]||event.action)}</b><p>${escapeHtml(event.note)}</p><small>${escapeHtml(formatDate(event.created_at))} · ${escapeHtml(statusNames[event.previous_status])} → ${escapeHtml(statusNames[event.new_status])}</small><small>Operador: ${escapeHtml(event.actor_label||'Administrador')}</small></li>`).join('')}${o.status==='cancelled'&&!events.some(e=>e.action==='cancel')?`<li><b>Reserva cancelada automáticamente</b><small>${escapeHtml(formatDate(o.updated_at))}</small></li>`:''}</ol></section>`;
    if(options.length){$('order-operation').addEventListener('change',updateActionHelp);$('order-action-form').addEventListener('submit',save);updateActionHelp();}
  }
  function updateActionHelp(){
    const operation=$('order-operation').value;
    $('order-action-confirm').checked=false;
    const payment=operation==='confirm_payment',cancel=operation==='cancel';
    $('order-action-help').textContent=payment?`Registra el pago solo después de verificar ${selected.payment_method==='cash'?'el efectivo recibido':'el abono en tu cuenta bancaria'} por ${clp(selected.grand_total)}. Esta acción confirma el pedido y mantiene el stock reservado.`:cancel?'La orden quedará cancelada y sus unidades volverán al catálogo.':'El cliente verá el nuevo estado en Mis pedidos.';
    $('order-note-label').textContent=payment?'Referencia del abono o recepción de efectivo':cancel?'Motivo de cancelación':'Observación de la gestión';
    $('order-confirm-label').textContent=payment?'Verifiqué que se recibió el monto completo.':cancel?'Confirmo la cancelación y la devolución del stock.':'Confirmo que este paso ya fue realizado.';
  }
  async function save(event){
    event.preventDefault();if(busy||!selected||!event.currentTarget.reportValidity())return;
    const order=selected,operation=$('order-operation').value;
    busy=true;$('order-close').disabled=true;
    event.currentTarget.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);
    $('order-save').textContent='Guardando…';
    try{
      await api({action:'update',orderId:order.id,operation,expectedUpdatedAt:order.updated_at,note:$('order-note').value.trim()});
      toast('Cambio guardado y registrado en el historial.');
      await Promise.all([load(),openDetail(order.id)]);
    }catch(error){
      showMessage('order-action-message','error',error.message+' Cierra y vuelve a abrir el pedido para consultar su estado antes de reintentar.');
      // A network failure may occur after the transaction commits: require a fresh detail.
      $('order-save').textContent='Reabre el pedido para continuar';
    }finally{busy=false;$('order-close').disabled=false;}
  }
  $('orders-tab').addEventListener('click',()=>switchSection('orders'));
  $('pharmacies-tab').addEventListener('click',()=>switchSection('pharmacies'));
  $('orders-refresh').addEventListener('click',load);
  $('orders-search-form').addEventListener('submit',event=>{event.preventDefault();page=0;load();});
  $('orders-filter').addEventListener('change',()=>{page=0;load();});
  $('orders-prev').addEventListener('click',()=>{if(page>0){page--;load();}});
  $('orders-next').addEventListener('click',()=>{page++;load();});
  $('order-close').addEventListener('click',()=>{if(!busy){detailRequest++;selected=null;$('order-dialog').close();}});
  $('order-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else{detailRequest++;selected=null;}});
  window.portalOrders={load,clear(){listRequest++;detailRequest++;selected=null;page=0;$('order-dialog').close();$('order-detail').textContent='';$('orders-content').textContent='';}};
})();
