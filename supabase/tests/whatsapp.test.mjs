import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createHandler,messagesFrom} from '../functions/whatsapp-webhook/handler.mjs';
const payload={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},contacts:[{wa_id:'56912345678',profile:{name:'Test'}}],messages:[{id:'wamid.test',from:'56912345678',timestamp:'1780000000',type:'text',text:{body:'Consulta'}}]}}]}]};
const config={secret:'test-secret',verifyToken:'test-token',phoneId:'123'};
function post(data=payload,signed=true){const body=JSON.stringify(data);return new Request('https://example.test/webhook',{method:'POST',body,headers:signed?{'x-hub-signature-256':'sha256='+createHmac('sha256',config.secret).update(body).digest('hex')}:{}});}
test('challenge and signature reject unauthorized requests',async()=>{let calls=0;const handler=createHandler({...config,persist:async()=>calls++});assert.equal((await handler(new Request('https://example.test?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42'))).status,403);assert.equal(await(await handler(new Request('https://example.test?hub.mode=subscribe&hub.verify_token=test-token&hub.challenge=42'))).text(),'42');assert.equal((await handler(post(payload,false))).status,403);assert.equal(calls,0);assert.equal((await handler(post())).status,200);assert.equal(calls,1);});
test('ignore other phone IDs, statuses; retain unsupported type indicator',()=>{assert.equal(messagesFrom(payload,'other').length,0);const media=structuredClone(payload);media.entry[0].changes[0].value.messages[0].type='image';assert.match(messagesFrom(media,'123')[0].p_body,/multimedia/);const status=structuredClone(payload);delete status.entry[0].changes[0].value.messages;assert.equal(messagesFrom(status,'123').length,0);});
test('failure is retryable, absent configuration fails closed, oversized body rejected',async()=>{const handler=createHandler({...config,persist:async()=>{throw Error('db');}});assert.equal((await handler(post())).status,503);assert.equal((await createHandler({...config,phoneId:''})(post())).status,503);assert.equal((await handler(new Request('https://example.test',{method:'POST',body:'a'.repeat(1048577)}))).status,413);});
test('SQL persistence, duplicate delivery, old delivery, isolation and reopening',async()=>{
 const db=new PGlite();
 try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.pharmacies(id uuid primary key);');
 await db.exec(await readFile(new URL('../migrations/20260930153526_whatsapp_inbox.sql',import.meta.url),'utf8'));
 const receive=(id,time)=>db.query(`select public.receive_whatsapp_message('123','56912345678','Test',$1,'text','Consulta',$2)`,[id,time]);
 await db.exec('set role service_role');
 await receive('first','2026-09-30T10:00:00Z');await receive('first','2026-09-30T10:00:00Z');
 assert.equal((await db.query('select count(*)::int n from public.whatsapp_messages')).rows[0].n,1);
 await db.exec("update public.whatsapp_conversations set status='resolved',resolved_at='2026-09-30T11:00:00Z'");
 await receive('old','2026-09-30T09:00:00Z');
 let row=(await db.query('select * from public.whatsapp_conversations')).rows[0];assert.equal(row.status,'resolved');assert.equal(row.last_message_id,'first');
 await receive('new','2026-09-30T12:00:00Z');row=(await db.query('select * from public.whatsapp_conversations')).rows[0];assert.equal(row.status,'pending');assert.equal(row.last_message_id,'new');
 for(const role of ['anon','authenticated']){await db.exec('reset role;set role '+role);await assert.rejects(()=>db.query('select * from public.whatsapp_messages'),/permission denied/);await assert.rejects(()=>receive('blocked','2026-09-30T13:00:00Z'),/permission denied/);}
 await db.exec('reset role');const rls=await db.query("select relrowsecurity from pg_class where relname in ('whatsapp_conversations','whatsapp_messages')");assert.ok(rls.rows.every(r=>r.relrowsecurity));
 }finally{await db.close();}
});
