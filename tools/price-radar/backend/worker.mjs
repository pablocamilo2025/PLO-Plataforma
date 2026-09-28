import {pathToFileURL} from 'node:url';
import {scrape} from './browserbase.mjs';
const codes=new Set(['INVALID_URL','REDIRECTED_PRODUCT','IDENTITY_CHANGED','LOCATION_NOT_CONFIRMED','PRODUCT_SECTION_MISSING','PRESENTATION_CONFLICT','PRICE_AMBIGUOUS','PRICE_ORDER_CHANGED','PROVIDER_NOT_CONFIGURED','PROVIDER_CREATE_FAILED']);
export async function runOne(rpc,collect=scrape,kind='official',clock=Date.now){
 const rows=await rpc('radar_claim',{p_kind:kind});const target=rows?.[0];if(!target)return false;
 const start=clock();let offer=null,error=null;
 try{offer=await collect(target);}catch(e){error=codes.has(e.message)?e.message:'BROWSER_FAILED';}
 const saved=await rpc('radar_finish',{p_id:target.id,p_token:target.lease_token,p_offer:offer,p_error:error,p_duration:Math.min(300000,Math.max(0,clock()-start))});
 // A superseded lease is never allowed to overwrite a newer mapping/result.
 return {target_id:target.id,source:target.source,status:saved?(error?'error':'ok'):'superseded',error};
}
export function rpcClient(env=process.env){
 const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:')throw Error('HTTPS_REQUIRED');
 const key=env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw Error('DATABASE_NOT_CONFIGURED');
 return async(name,args)=>{
  const response=await fetch(new URL('/rest/v1/rpc/'+name,base),{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('DATABASE_RPC_FAILED');
  if(response.status===204)return null;
  const text=await response.text();return text?JSON.parse(text):null;
 };
}
async function main(){
 if(!process.env.BROWSERBASE_API_KEY||!process.env.BROWSERBASE_PROJECT_ID)throw Error('PROVIDER_NOT_CONFIGURED');
 const kind=process.env.RADAR_CATALOG_KIND||'official';if(!['official','test'].includes(kind))throw Error('INVALID_KIND');
 const rpc=rpcClient();let lastIdleLog=0;console.log(JSON.stringify({event:'RADAR_WORKER_STARTED',catalog_kind:kind}));let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
 do{
  try{const result=await runOne(rpc,scrape,kind);if(result)console.log(JSON.stringify(result));else {if(Date.now()-lastIdleLog>3600000){console.log(JSON.stringify({event:'RADAR_QUEUE_IDLE',catalog_kind:kind}));lastIdleLog=Date.now();}if(!process.argv.includes('--once'))await new Promise(r=>setTimeout(r,15000));}}
  catch{console.error('RADAR_WORKER_RPC_FAILED');if(process.argv.includes('--once')){process.exitCode=1;break;}await new Promise(r=>setTimeout(r,15000));}
 }while(!stopping&&!process.argv.includes('--once'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('RADAR_WORKER_NOT_CONFIGURED');process.exitCode=1;});
