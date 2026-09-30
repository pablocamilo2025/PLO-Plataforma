import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normalizePhone} from '../functions/whatsapp-inbox/phone.mjs';
import {createCartPublisher} from '../../apps/Portal-PLO/cart-context.mjs';
const actor='11111111-1111-4111-8111-111111111111',other='33333333-3333-4333-8333-333333333333',pharmacy='22222222-2222-4222-8222-222222222222',second='44444444-4444-4444-8444-444444444444',session='55555555-5555-4555-8555-555555555555';
test('phones require explicit country code and normalize punctuation',()=>{assert.equal(normalizePhone('+56 9 1234-5678'),'56912345678');for(const value of ['912345678','56912345678','+56abc','+56;drop',null])assert.throws(()=>normalizePhone(value));});
test('cart publisher serializes and keeps latest pending selection; failed writes recover',async()=>{const writes=[];let release;const gate=new Promise(r=>release=r);const publisher=createCartPublisher({write:async x=>{writes.push(x);if(x.n===1)await gate;}});const done=publisher.publish({n:1});publisher.publish({n:2});publisher.publish({n:3});assert.deepEqual(writes,[{n:1}]);release();await done;assert.deepEqual(writes,[{n:1},{n:3}]);const states=[];let fail=true;const retry=createCartPublisher({write:async()=>{if(fail)throw Error();},onState:s=>states.push(s)});await retry.publish({});fail=false;await retry.publish({});assert.deepEqual(states,['pending','error','pending','synced']);});
test('automatic identity matches only unique active contacts; carts isolate users and validate payload',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table auth.users(id uuid primary key);create table public.pharmacies(id uuid primary key,status text);create table public.profiles(user_id uuid,status text);create table public.pharmacy_memberships(pharmacy_id uuid,user_id uuid,status text);grant select on public.pharmacies,public.profiles,public.pharmacy_memberships to authenticated,service_role;insert into auth.users values('${actor}'),('${other}');insert into public.pharmacies values('${pharmacy}','active'),('${second}','active');insert into public.profiles values('${actor}','active'),('${other}','active');insert into public.pharmacy_memberships values('${pharmacy}','${actor}','active'),('${second}','${other}','active');`);
 for(const f of ['20260930153526_whatsapp_inbox.sql','20260930154439_whatsapp_case_tools.sql','20260930160011_whatsapp_customer_context.sql'])await db.exec(await readFile(new URL('../migrations/'+f,import.meta.url),'utf8'));
 await db.exec('set role service_role');
 const receive=()=>db.query("select public.receive_whatsapp_message('123','56912345678','Cliente','first','text','Hola',now())");
 const contact=p=>db.query("insert into public.pharmacy_whatsapp_contacts(pharmacy_id,phone,contact_name,verified_by) values($1,'56912345678','Cliente',$2)",[p,actor]);
 await receive();let c=(await db.query('select * from public.whatsapp_conversations')).rows[0];assert.equal(c.pharmacy_id,null);
 await contact(pharmacy);await receive();c=(await db.query('select * from public.whatsapp_conversations')).rows[0];assert.equal(c.pharmacy_id,pharmacy);assert.equal(c.link_mode,'automatic');
 await contact(second);await receive();c=(await db.query('select * from public.whatsapp_conversations')).rows[0];assert.equal(c.pharmacy_id,null);
 await db.query('select public.link_whatsapp_pharmacy($1,$2,$3,null)',[c.id,actor,second]);await receive();c=(await db.query('select * from public.whatsapp_conversations')).rows[0];assert.equal(c.pharmacy_id,second);assert.equal(c.link_mode,'manual');
 await db.query('select public.link_whatsapp_pharmacy($1,$2,null,$3)',[c.id,actor,second]);await receive();assert.equal((await db.query('select pharmacy_id from public.whatsapp_conversations')).rows[0].pharmacy_id,null);
 await db.exec('reset role');await db.exec("update public.whatsapp_conversations set link_mode='none';update public.pharmacy_whatsapp_contacts set active=false;");await db.exec('set role service_role');await receive();assert.equal((await db.query('select pharmacy_id from public.whatsapp_conversations')).rows[0].pharmacy_id,null);
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${actor}',false);set role authenticated;`);
 const insert=(p,u,items)=>db.query('insert into public.portal_cart_snapshots(pharmacy_id,user_id,session_id,items) values($1,$2,$3,$4) on conflict(pharmacy_id,user_id,session_id) do update set items=excluded.items',[p,u,session,JSON.stringify(items)]);
 await insert(pharmacy,actor,[{sku:'PLO-0001',quantity:3}]);
 await assert.rejects(()=>insert(second,actor,[]),/row-level security/);
 await assert.rejects(()=>insert(pharmacy,other,[]),/row-level security/);
 for(const items of [[{sku:null,quantity:1}],[{sku:'PLO-0001',quantity:0}],[{sku:'PLO-0001',quantity:1,price:1}],[{sku:'PLO-0001',quantity:1},{sku:'PLO-0001',quantity:2}]])await assert.rejects(()=>insert(pharmacy,actor,items),/INVALID_CART|DUPLICATE_SKU/);
 await db.query('insert into public.portal_cart_snapshots(pharmacy_id,user_id,session_id,items) values($1,$2,$3,$4)',[pharmacy,actor,crypto.randomUUID(),JSON.stringify([{sku:'PLO-0002',quantity:2}])]);
 assert.equal((await db.query('select * from public.portal_cart_snapshots')).rows.length,2);
 await insert(pharmacy,actor,[]);assert.deepEqual((await db.query('select items from public.portal_cart_snapshots where session_id=$1',[session])).rows[0].items,[]);
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${other}',false);set role authenticated;`);assert.equal((await db.query('select * from public.portal_cart_snapshots')).rows.length,0);
 await assert.rejects(()=>db.query('select * from public.pharmacy_whatsapp_contacts'),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select * from public.portal_cart_snapshots'),/permission denied/);
 }finally{await db.close();}
});
