import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createInboxHandler} from '../functions/whatsapp-inbox/handler.mjs';
const actor='11111111-1111-4111-8111-111111111111',other='33333333-3333-4333-8333-333333333333',pharmacy='22222222-2222-4222-8222-222222222222',cid='44444444-4444-4444-8444-444444444444';
const request=(body,token='test')=>new Request('http://localhost:8000/api',{method:'POST',headers:token?{authorization:'Bearer '+token}:{},body:JSON.stringify(body)});
test('API rejects anonymous, invalid sessions and customer roles before database access',async()=>{
 const db={auth:{getUser:async()=>({data:{user:{id:actor,app_metadata:{role:'pharmacy_user'},user_metadata:{role:'portal_admin'}}}})},from:()=>{throw Error('must not query')}};
 assert.equal((await createInboxHandler(db)(request({action:'list'},''))).status,401);
 assert.equal((await createInboxHandler(db)(request({action:'list'}))).status,403);
 db.auth.getUser=async()=>({data:{user:null},error:Error('expired')});
 assert.equal((await createInboxHandler(db)(request({action:'list'}))).status,401);
});
test('API binds drafts to verified identity, rejects invalid drafts and has no send action',async()=>{
 let args;const db={auth:{getUser:async()=>({data:{user:{id:actor,app_metadata:{role:'portal_admin'}}}})},rpc:async(name,params)=>{args={name,params};return {data:2};}};
 const handler=createInboxHandler(db);
 assert.equal((await handler(request({action:'draft',id:cid,text:'Respuesta',revision:1,actorId:other}))).status,200);
 assert.equal(args.params.p_actor,actor);
 assert.equal((await handler(request({action:'draft',id:cid,text:'a'.repeat(4097),revision:1}))).status,400);
 assert.equal((await handler(request({action:'send',id:cid,text:'No enviar'}))).status,400);
 db.rpc=async()=>({error:{message:'DRAFT_CHANGED'}});
 assert.equal((await handler(request({action:'draft',id:cid,text:'Respuesta',revision:1}))).status,409);
});
test('draft isolation, concurrent edits, linking audit and row access',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.pharmacies(id uuid primary key,status text);grant select on public.pharmacies to service_role;insert into auth.users values('${actor}'),('${other}');insert into public.pharmacies values('${pharmacy}','active');`);
 for(const file of ['20260930153526_whatsapp_inbox.sql','20260930154439_whatsapp_case_tools.sql'])await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into public.whatsapp_conversations(id,phone_number_id,wa_id,last_message_at,last_message_id,last_preview) values('${cid}','123','56912345678',now(),'first','Consulta');set role service_role;`);
 const save=(who,text,revision)=>db.query('select public.save_whatsapp_draft($1,$2,$3,$4) revision',[cid,who,text,revision]);
 assert.equal((await save(actor,'Privado A',0)).rows[0].revision,1);
 assert.equal((await save(other,'Privado B',0)).rows[0].revision,1);
 assert.equal((await save(actor,'Actualizado A',1)).rows[0].revision,2);
 await assert.rejects(()=>save(actor,'Edición obsoleta',1),/DRAFT_CHANGED/);
 await assert.rejects(()=>save(actor,'a'.repeat(4097),2),/check constraint/);
 assert.equal((await db.query('select body from public.whatsapp_drafts where actor_id=$1',[other])).rows[0].body,'Privado B');
 const link=(next,expected)=>db.query('select public.link_whatsapp_pharmacy($1,$2,$3,$4)',[cid,actor,next,expected]);
 await link(pharmacy,null);await assert.rejects(()=>link(null,null),/LINK_CHANGED/);await link(null,pharmacy);
 assert.equal((await db.query('select count(*)::int n from public.whatsapp_links_audit')).rows[0].n,2);
 await db.exec('reset role');await db.query("update public.pharmacies set status='suspended' where id=$1",[pharmacy]);await db.exec('set role service_role');await assert.rejects(()=>link(pharmacy,null),/PHARMACY_NOT_ACTIVE/);
 for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);for(const table of ['whatsapp_notes','whatsapp_drafts','whatsapp_links_audit'])await assert.rejects(()=>db.query('select * from public.'+table),/permission denied/);await assert.rejects(()=>save(actor,'blocked',2),/permission denied/);await assert.rejects(()=>link(pharmacy,null),/permission denied/);}
 }finally{await db.close();}
});
