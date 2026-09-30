import {normalizePhone} from './phone.mjs';
const origins=new Set(['https://soporte.plofarma.cl','https://portal.plofarma.cl','http://localhost:8000','http://127.0.0.1:8000']);
export function createInboxHandler(db) { return async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Access-Control-Allow-Origin':origins.has(origin)?origin:'https://portal.plofarma.cl','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return json({error:'Origen no permitido'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 try{

  const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return json({error:'Inicia sesión'},401);
  const {data,error}=await db.auth.getUser(token);
  if(error||!data.user)return json({error:'Sesión vencida'},401);
  if(data.user.app_metadata?.role!=='portal_admin')return json({error:'Acceso exclusivo para administradores'},403);
  let body;try{body=await req.json();}catch{return json({error:'Solicitud inválida'},400);}
  if(!body || typeof body!=='object'||Array.isArray(body))return json({error:'Solicitud inválida'},400);
  if(body.action==='list'){
   const page=body.page??0;
   if(!Number.isSafeInteger(page)||page<0||page>10000)return json({error:'Página inválida'},400);
   const {data:rows,error}=await db.from('whatsapp_conversations').select('id,pharmacy_id,link_mode,wa_id,display_name,status,last_message_at,last_message_id,last_preview,pharmacies(id,display_name,tier)').order('last_message_at',{ascending:false}).order('id').range(page*50,page*50+50);
   if(error)throw error;
   return json({conversations:rows.slice(0,50),hasMore:rows.length>50});
  }
  if(body.action==='pharmacies'){
   if(typeof body.search!=='string'||body.search.trim().length<2||body.search.length>100)return json({error:'Escribe al menos dos caracteres'},400);
   const search=body.search.trim().replace(/[\\%_]/g,'');
   if(search.length<2)return json({error:'Búsqueda inválida'},400);
   const {data:rows,error}=await db.from('pharmacies').select('id,display_name,tier,rut').eq('status','active').ilike('display_name','%'+search+'%').order('display_name').limit(20);
   if(error)throw error;return json({pharmacies:rows});
  }
  if(typeof body.id!=='string'|| !/^[0-9a-f-]{36}$/i.test(body.id))return json({error:'Conversación inválida'},400);
  if(body.action==='context'){
   const {data:match,error:me}=await db.rpc('match_whatsapp_contact',{p_conversation:body.id});if(me)throw me;
   const {data:conversation,error:ce}=await db.from('whatsapp_conversations').select('wa_id,link_mode,pharmacy_id,pharmacies(id,display_name,tier,rut)').eq('id',body.id).maybeSingle();
   if(ce)throw ce;if(!conversation)return json({error:'Caso no encontrado'},404);
   const [{data:notes,error:ne},{data:draft,error:de}]=await Promise.all([
    db.from('whatsapp_notes').select('id,body,created_at').eq('conversation_id',body.id).order('created_at',{ascending:false}).limit(50),
    db.from('whatsapp_drafts').select('body,revision').eq('conversation_id',body.id).eq('actor_id',data.user.id).maybeSingle()
   ]);
   if(ne||de)throw ne||de;
   let orders=[];
   if(conversation.pharmacy_id){const {data:items,error}=await db.from('orders').select('order_number,status,payment_status,grand_total,created_at').eq('pharmacy_id',conversation.pharmacy_id).order('created_at',{ascending:false}).limit(5);if(error)throw error;orders=items;}
   let carts=[],contacts=[];
   if(conversation.pharmacy_id){
    const [{data:snapshots,error:se},{data:registered,error:re}]=await Promise.all([
     db.from('portal_cart_snapshots').select('user_id,session_id,items,updated_at').eq('pharmacy_id',conversation.pharmacy_id).gte('updated_at',new Date(Date.now()-86400000).toISOString()).order('updated_at',{ascending:false}).limit(10),
     db.from('pharmacy_whatsapp_contacts').select('id,phone,contact_name,active').eq('pharmacy_id',conversation.pharmacy_id).order('contact_name')
    ]);if(se||re)throw se||re;
    contacts=registered;
    const skus=[...new Set(snapshots.flatMap(c=>c.items.map(i=>i.sku)))];let catalog=[];
    if(skus.length){const {data:products,error:pe}=await db.from('catalog_items').select('sku,name,stock,is_active').in('sku',skus);if(pe)throw pe;catalog=products;}
    carts=snapshots.map(c=>({...c,items:c.items.map(i=>({...i,name:catalog.find(p=>p.sku===i.sku)?.name||i.sku}))}));
   }
   return json({pharmacy:conversation.pharmacies,linkMode:conversation.link_mode,match,contacts,carts,notes,draft:draft||{body:'',revision:0},orders});
  }
  if(body.action==='contact'){
   if(body.confirmed!==true||typeof body.name!=='string'||body.name.trim().length<2||body.name.length>120||typeof body.pharmacyId!=='string')return json({error:'Confirma la autorización del contacto y su nombre'},400);
   let phone;try{phone=normalizePhone(body.phone);}catch{return json({error:'Ingresa el teléfono con código de país, por ejemplo +56912345678'},400);}
   const {data:c,error:ce}=await db.from('whatsapp_conversations').select('pharmacy_id').eq('id',body.id).single();if(ce||c.pharmacy_id!==body.pharmacyId)return json({error:'La vinculación del caso cambió. Actualiza.'},409);
   const {data:p,error:pe}=await db.from('pharmacies').select('id').eq('id',body.pharmacyId).eq('status','active').maybeSingle();if(pe||!p)return json({error:'Farmacia no activa'},409);
   const {error}=await db.from('pharmacy_whatsapp_contacts').upsert({pharmacy_id:body.pharmacyId,phone,contact_name:body.name.trim(),verified_by:data.user.id,verified_at:new Date().toISOString(),active:true},{onConflict:'pharmacy_id,phone'});if(error)throw error;return json({ok:true});
  }
  if(body.action==='deactivate-contact'){
   if(typeof body.contactId!=='string')return json({error:'Contacto inválido'},400);
   const {data:c,error:ce}=await db.from('whatsapp_conversations').select('pharmacy_id').eq('id',body.id).single();if(ce||!c.pharmacy_id)return json({error:'Vincula una farmacia'},409);
   const {data:changed,error}=await db.from('pharmacy_whatsapp_contacts').update({active:false}).eq('id',body.contactId).eq('pharmacy_id',c.pharmacy_id).select('id').maybeSingle();if(error)throw error;if(!changed)return json({error:'Contacto no encontrado'},404);return json({ok:true});
  }
  if(body.action==='note'){
   if(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000||typeof body.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.requestId))return json({error:'Nota inválida (máximo 2000 caracteres)'},400);
   const {error}=await db.from('whatsapp_notes').upsert({id:body.requestId,conversation_id:body.id,actor_id:data.user.id,body:body.text.trim()},{onConflict:'id',ignoreDuplicates:true});
   if(error)throw error;return json({ok:true});
  }
  if(body.action==='draft'){
   if(typeof body.text!=='string'||body.text.length>4096||!Number.isSafeInteger(body.revision)||body.revision<0)return json({error:'Borrador inválido'},400);
   const {data:revision,error}=await db.rpc('save_whatsapp_draft',{p_conversation:body.id,p_actor:data.user.id,p_body:body.text,p_revision:body.revision});
   if(error?.message==='DRAFT_CHANGED')return json({error:'El borrador cambió en otra ventana. Copia tu texto y vuelve a abrir el caso.'},409);
   if(error)throw error;return json({revision});
  }
  if(body.action==='link'){
   const uuidOrNull=v=>v===null||(typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v));
   if(!uuidOrNull(body.pharmacyId)||!uuidOrNull(body.expectedPharmacyId))return json({error:'Farmacia inválida'},400);
   const {error}=await db.rpc('link_whatsapp_pharmacy',{p_conversation:body.id,p_actor:data.user.id,p_pharmacy:body.pharmacyId,p_expected:body.expectedPharmacyId});
   if(error)return json({error:'No se pudo vincular. La farmacia debe estar activa y el caso no debe haber cambiado.'},409);
   return json({ok:true});
  }
  if(body.action==='messages'){
   const {data:rows,error}=await db.from('whatsapp_messages').select('id,kind,body,sent_at').eq('conversation_id',body.id).order('sent_at',{ascending:false}).order('id').limit(100);
   if(error)throw error;return json({messages:rows.reverse(),limited:rows.length===100});
  }
  if(body.action==='status'&&['pending','resolved'].includes(body.status)&&typeof body.expectedMessage==='string'){
   const {data:row,error}=await db.from('whatsapp_conversations').update({status:body.status,resolved_at:body.status==='resolved'?new Date().toISOString():null,resolved_by:body.status==='resolved'?data.user.id:null}).eq('id',body.id).eq('last_message_id',body.expectedMessage).select('id').maybeSingle();
   if(error)throw error;if(!row)return json({error:'La conversación cambió. Actualiza antes de resolver.'},409);return json({ok:true});
  }
  return json({error:'Acción no disponible'},400);
 }catch{return json({error:'No se pudo consultar la bandeja. Verifica la configuración del servicio.'},503);}
}; }
