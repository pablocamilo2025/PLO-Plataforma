import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const origins=new Set(["https://portal.plofarma.cl","http://localhost:8000","http://127.0.0.1:8000"]);
function key(name:string,fallback:string){try{return JSON.parse(Deno.env.get(name)||"{}").default||Deno.env.get(fallback)||"";}catch{return Deno.env.get(fallback)||"";}}
const errors:Record<string,string>={
  PLO_ORDER_NOT_FOUND:"El pedido ya no está disponible.",
  PLO_ORDER_CHANGED:"El pedido cambió. Actualiza antes de continuar.",
  PLO_INVALID_TRANSITION:"Ese paso no corresponde al estado actual del pedido.",
  PLO_RESERVATION_EXPIRED:"La reserva del pedido venció.",
  PLO_INVALID_ACTION:"Escribe una observación de entre 3 y 500 caracteres.",
};

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("Origin");
  const headers={"Access-Control-Allow-Origin":origin&&origins.has(origin)?origin:"https://portal.plofarma.cl","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json","Cache-Control":"no-store"};
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(origin&&!origins.has(origin))return json({error:"Origen no permitido."},403);
  if(req.method!=="POST")return json({error:"Método no permitido."},405);
  try{
    const url=Deno.env.get("SUPABASE_URL")||"",pub=key("SUPABASE_PUBLISHABLE_KEYS","SUPABASE_ANON_KEY"),secret=key("SUPABASE_SECRET_KEYS","SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!pub||!secret)throw new Error("Missing runtime configuration");
    const token=req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if(!token)return json({error:"Debes iniciar sesión."},401);
    const auth=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:identity,error:authError}=await auth.auth.getUser(token);
    if(authError||!identity.user)return json({error:"Tu sesión no es válida."},401);
    if(!["warehouse_operator","portal_admin"].includes(identity.user.app_metadata?.role))return json({error:"Acceso exclusivo para Bodega y Despacho."},403);
    let body;try{body=await req.json();}catch{return json({error:"Solicitud inválida."},400);}
    if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Solicitud inválida."},400);
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    if(body.action==="list"){
      const statuses=["all","new","preparing","ready_for_dispatch","in_transit","delivered"];
      if(!statuses.includes(body.status??"all")||(body.search!==undefined&&(typeof body.search!=="string"||body.search.length>120)))return json({error:"Filtro inválido."},400);
      const {data,error}=await admin.rpc("warehouse_list_portal_orders",{p_search:body.search?.trim()||"",p_status:body.status||"all"});
      if(error)throw error;return json(data);
    }
    if(!Number.isSafeInteger(body.orderId)||body.orderId<1)return json({error:"Pedido inválido."},400);
    if(body.action==="detail"){
      const {data:order,error}=await admin.from("orders").select("id,order_number,status,payment_status,payment_method,created_at,updated_at,expires_at,pharmacies(display_name,rut),order_items(id,sku,product_name,laboratory,lot_code,quantity)").eq("id",body.orderId).maybeSingle();
      if(error)throw error;if(!order)return json({error:"Pedido no encontrado."},404);
      const operational=["confirmed","preparing","ready_for_dispatch","in_transit"].includes(order.status)||
        (order.status==="awaiting_payment"&&order.payment_method==="cash")||
        (order.status==="delivered"&&Date.parse(order.updated_at)>=new Date().setHours(0,0,0,0));
      if(!operational)return json({error:"Este pedido no pertenece a la cola operativa."},404);
      return json({order});
    }
    if(body.action==="update"){
      if(!["prepare","ready_for_dispatch","dispatch","deliver"].includes(body.operation)||typeof body.note!=="string"||body.note.trim().length<3||body.note.trim().length>500||typeof body.expectedUpdatedAt!=="string"||!Number.isFinite(Date.parse(body.expectedUpdatedAt)))return json({error:"Completa la observación de la operación."},400);
      const {data,error}=await admin.rpc("warehouse_update_portal_order",{p_order_id:body.orderId,p_actor_id:identity.user.id,p_action:body.operation,p_expected_updated_at:body.expectedUpdatedAt,p_note:body.note.trim()});
      if(error){if(errors[error.message])return json({error:errors[error.message]},409);throw error;}
      return json({result:data});
    }
    return json({error:"Acción no válida."},400);
  }catch(error){console.error("Warehouse orders failed",error instanceof Error?error.message:"Service error");return json({error:"No pudimos completar la operación. Actualiza e intenta nuevamente."},500);}
});
