import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractOffer,canonicalURL} from '../extract.mjs';
import {runOne,rpcClient} from '../worker.mjs';
test('deployment extractor ignores recommendations and rejects pack conflicts',()=>{
 const t={source:'eco',url:'https://www.ecofarmacias.cl/producto/test/',expected_title:'Metformina 850 mg 60 Comprimidos'};
 const snapshot=body=>({url:t.url,headings:[t.expected_title],body:t.expected_title+'\n'+body});
 assert.equal(extractOffer(t,snapshot('$3.480\n3 disponibles\nDestacados\n$990')).price,3480);
 assert.throws(()=>extractOffer(t,snapshot('$3.480\nMetformina 850 mg 30 comprimidos')),/PRESENTATION_CONFLICT/);
 assert.throws(()=>canonicalURL('eco','https://example.org/producto/test/'),/INVALID_URL/);
});
test('worker skips empty queue, redacts errors and fences superseded results',async()=>{
 assert.equal(await runOne(async()=>[],()=>assert.fail('must not scrape')),false);
 const rpc=async name=>name==='radar_claim'?[{id:'test',lease_token:'test'}]:false;
 assert.equal((await runOne(rpc,async()=>({price:100}))).status,'superseded');
 assert.equal((await runOne(rpc,async()=>{throw Error('sensitive connection error');})).error,'BROWSER_FAILED');
});
test('RPC handles successful no-content updates',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response(null,{status:204});assert.equal(await rpcClient({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test'})('radar_set_enabled',{}),null);}finally{globalThis.fetch=original;}
});
