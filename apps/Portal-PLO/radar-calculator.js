/* Shared cached-price view. No scraping, schedule changes or synthetic prices. */
(function(root){
 const names={drsimi:'Dr. Simi',eco:'Farmacias Eco',cruzverde:'Cruz Verde'};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n);
 function usable(q){return q.status==='fresh'&&q.eligible_for_comparison===true&&q.available===true&&Number.isFinite(q.price)&&q.price>0;}
 function render(el,data,cost,onUse){
  const quotes=data.quotes||[];
  el.innerHTML=`${data.test_only?'<p><b>PRUEBA · Asociación comercial pendiente.</b></p>':''}${data.name?`<h3>${esc(data.name)}</h3>`:''}<div class="rivals">${quotes.map(q=>{
   let url;try{const u=new URL(q.url);if(u.protocol==='https:'&&u.hostname===({drsimi:'www.drsimi.cl',eco:'www.ecofarmacias.cl',cruzverde:'www.cruzverde.cl'}[q.source]))url=u.href;}catch{}
   const date=q.updated_at&&Number.isFinite(Date.parse(q.updated_at))?new Date(q.updated_at).toLocaleString('es-CL'):'Sin consulta exitosa';
   return `<article class="rival"><b>${esc(names[q.source]||q.source)}</b><div class="r-price">${Number.isFinite(q.price)&&q.price>0?money(q.price):'Sin precio'}</div><p>${q.status==='stale'?'Precio desactualizado':q.status==='unavailable'?'Sin datos':q.available===true?'Disponible al consultar':'Stock no confirmado o agotado'}</p><small>Consultado: ${esc(date)}</small><p>${esc(q.conditions||'Condiciones pendientes')}</p>${q.location?`<p>${esc(q.location)}</p>`:''}${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Ver ficha original ↗</a>`:''}${usable(q)?`<p><button type="button" data-radar-use="${q.price}">Usar este precio en la calculadora</button></p>${cost>0?`<small>Margen aritmético con tu costo: ${((1-cost/q.price)*100).toFixed(1)}%</small>`:''}`:'<p>No utilizable para comparar.</p>'}</article>`;
  }).join('')}</div>${!quotes.length?'<p>Este producto todavía no tiene precios verificados.</p>':''}<p class="agent-disc">Lectura del último precio guardado. Frecuencia prevista: 48 horas. Esta consulta no ejecuta el scraper. Compara costo y venta sobre la misma base de impuestos.</p>`;
  el.querySelectorAll('[data-radar-use]').forEach(b=>b.onclick=()=>onUse(Number(b.dataset.radarUse)));
 }
 root.RadarCalculator={render,usable};
})(typeof window!=='undefined'?window:globalThis);
