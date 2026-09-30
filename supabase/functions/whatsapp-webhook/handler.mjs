const encoder = new TextEncoder();
export async function verifySignature(raw, signature, secret) {
 if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
 const key = await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes = Uint8Array.from(signature.slice(7).match(/../g), x=>parseInt(x,16));
 return crypto.subtle.verify('HMAC',key,bytes,raw);
}
export function messagesFrom(payload, phoneId) {
 const result=[];
 if(payload?.object!=='whatsapp_business_account') return result;
 for(const entry of payload.entry || []) for(const change of entry.changes || []) {
  const v=change.value;
  if(change.field!=='messages' || v?.metadata?.phone_number_id!==phoneId) continue;
  for(const m of v.messages || []) {
   if(typeof m.id!=='string' || m.id.length>512 || !m.id || !/^[0-9]{5,20}$/.test(m.from || '')) throw new Error('Invalid message');
   const seconds=Number(m.timestamp);
   if(!Number.isSafeInteger(seconds) || seconds<=0 || seconds>Math.floor(Date.now()/1000)+300) throw new Error('Invalid time');
   const kind=typeof m.type==='string' ? m.type.slice(0,50) : 'unknown';
   const body=kind==='text' ? m.text?.body : `[Mensaje ${kind}: contenido multimedia pendiente de integración]`;
   if(typeof body!=='string' || body.length>20000) throw new Error('Invalid body');
   const name=v.contacts?.find(c=>c.wa_id===m.from)?.profile?.name;
   result.push({p_phone:phoneId,p_sender:m.from,p_name:typeof name==='string'?name.slice(0,200):'',p_id:m.id,p_kind:kind,p_body:body,p_sent_at:new Date(seconds*1000).toISOString()});
  }
 }
 return result;
}
export function createHandler({secret,verifyToken,phoneId,persist}) {
 return async req=>{
  if(!secret || !verifyToken || !phoneId) return new Response('Not configured',{status:503});
  if(req.method==='GET') {
   const q=new URL(req.url).searchParams;
   if(q.get('hub.mode')!=='subscribe' || q.get('hub.verify_token')!==verifyToken || !q.get('hub.challenge')) return new Response('Forbidden',{status:403});
   return new Response(q.get('hub.challenge'),{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
  }
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  // Stream with a hard bound even when Content-Length is absent.
  const reader=req.body?.getReader(); if(!reader) return new Response('Missing body',{status:400});
  const chunks=[]; let size=0;
  while(true) {const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>1048576) {await reader.cancel();return new Response('Too large',{status:413});} chunks.push(value);}
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  if(!await verifySignature(raw,req.headers.get('x-hub-signature-256'),secret)) return new Response('Forbidden',{status:403});
  let messages;try{messages=messagesFrom(JSON.parse(new TextDecoder().decode(raw)),phoneId);}catch{return new Response('Invalid payload',{status:400});}
  try{for(const m of messages) await persist(m);}catch{return new Response('Retry later',{status:503});}
  return new Response('EVENT_RECEIVED');
 };
}
