// All names, telephone numbers, messages and transactions are fictional.
const ago=m=>new Date(Date.now()-m*60000).toISOString();
const cases=[
 ['Camila Torres','Farmacia Los Aromos','socio','pending','Seguimiento de despacho',[
 ['Hola, soy Camila de Los Aromos. ¿Me ayudan con el pedido DEMO-1042?'],
 ['Hola Camila. En esta simulación, tu número nos permite identificar la farmacia y consultar el pedido.','outbound'],
 ['El pedido figura en despacho y el pago está confirmado. Estamos consultando la entrega con logística.','outbound'],
 ['Perfecto, ¿pueden confirmar si llega mañana por la mañana?']], 'in_transit','paid',248900,'Confirmar horario con logística antes de comprometer una entrega.'],
 ['Diego Muñoz','Farmacia Alameda Sur','acceso','pending','Ayuda con carrito',[
 ['Hola, dejé algunos productos en el carrito y necesito ayuda para terminar la compra.'],
 ['Hola Diego. En la ficha podemos revisar la última selección sincronizada. Todavía no corresponde a un pedido confirmado.','outbound'],
 ['Quisiera aumentar las cajas de guantes y confirmar el total antes de comprar.']], 'delivered','paid',86400,'Revisar cantidades con el cliente; el carrito no reserva stock.'],
 ['Valentina Rojas','Farmacia Vista Cordillera','socio','pending','Revisión de pago',[
 ['Buenos días. Realizamos el pago del pedido DEMO-1044.'],
 ['Gracias, Valentina. El pedido aparece con el pago en revisión. El equipo administrativo debe confirmar la recepción.','outbound'],
 ['Quedo atenta a la confirmación para coordinar la recepción.']], 'payment_review','pending',312500,'Consultar conciliación con administración. No marcar el pago como confirmado aún.'],
 ['Martín Silva','Farmacia Plaza del Sol','acceso','resolved','Pedido recibido',[
 ['Hola, recibimos el pedido completo esta mañana.'],
 ['Gracias por confirmar, Martín. Registramos la recepción y cerramos esta consulta.','outbound'],
 ['Todo bien, muchas gracias por la ayuda.']], 'delivered','paid',175800,'Recepción confirmada por el cliente. Caso resuelto.'],
 ['Francisca Soto',null,null,'pending','Contacto nuevo',[
 ['Hola, estamos interesados en comprar para nuestra farmacia.'],
 ['Bienvenida. Para vincular este número necesitamos verificar la farmacia y que seas un contacto autorizado.','outbound'],
 ['Perfecto. ¿Qué información necesitan para comenzar?']],null,null,0,'Contacto sin identificar. Verificar autorización antes de vincular y acceder a compras.'],
 ['Andrés Pérez','Farmacia Bosque Claro','socio','pending','Consulta de disponibilidad',[
 ['Hola, estamos preparando la reposición de insumos.'],
 ['Hola Andrés. Podemos revisar la selección del carrito y consultar disponibilidad con bodega.','outbound'],
 ['Necesitamos gasas y alcohol gel. ¿Pueden confirmar antes de que enviemos el pedido?']], 'preparing','paid',198600,'Consultar existencias con bodega; no prometer disponibilidad sin confirmación.']
];
export const demoPharmacies=cases.flatMap((c,i)=>c[1]?[{id:`demo-pharmacy-${i}`,display_name:c[1],tier:c[2],rut:'FICTICIO'}]:[]);
export const demoContacts=cases.flatMap((c,i)=>c[1]?[{id:`demo-contact-${i}`,pharmacy_id:`demo-pharmacy-${i}`,phone:`5690000000${i+1}`,contact_name:c[0],active:true}]:[]);
export const samples=cases.map((c,i)=>({id:`sample-${i+1}`,wa_id:`5690000000${i+1}`,display_name:c[0],status:c[3],last_message_at:ago(i*8),last_message_id:`demo-message-${i}`,last_preview:c[4]+' · '+c[5].at(-1)[0],pharmacies:demoPharmacies.find(p=>p.id===`demo-pharmacy-${i}`)||null,pharmacy_id:c[1]?`demo-pharmacy-${i}`:null}));
export const demoMessages=Object.fromEntries(cases.map((c,i)=>[`sample-${i+1}`,c[5].map((m,j)=>({body:m[0],direction:m[1]||'inbound',sent_at:ago(i*8+(c[5].length-j)*3)}))]));
export const demoOrders=Object.fromEntries(cases.flatMap((c,i)=>c[1]?[[`demo-pharmacy-${i}`,[{order_number:`DEMO-${1042+i}`,status:c[6],payment_status:c[7],grand_total:c[8],created_at:ago(1440)},{order_number:`DEMO-${980+i}`,status:'delivered',payment_status:'paid',grand_total:72900+i*10000,created_at:ago(10080)}]]]:[]));
export const demoCarts=Object.fromEntries([1,5].map(i=>[`demo-pharmacy-${i}`,[{user_id:`demo-user-${i}`,session_id:`demo-session-${i}`,updated_at:ago(1),items:i===1?[{sku:'DEMO-G01',name:'Guantes de examen · caja',quantity:8},{sku:'DEMO-M01',name:'Mascarillas · caja',quantity:4}]:[{sku:'DEMO-A01',name:'Alcohol gel · unidad',quantity:12},{sku:'DEMO-G02',name:'Gasas · paquete',quantity:20}]}]]));
export const initialNotes=Object.fromEntries(cases.map((c,i)=>[`sample-${i+1}`,[{id:`demo-note-${i}`,body:c[9],created_at:ago(5+i*8)}]]));
