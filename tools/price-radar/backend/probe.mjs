// Bounded provider-only smoke test. Never claims jobs or writes to Supabase.
import {pathToFileURL} from 'node:url';
import {scrape} from './browserbase.mjs';
export const samples={
 drsimi:{source:'drsimi',url:'https://www.drsimi.cl/losartan-potasico-50-mg-30-comprimidos-recubiertos/p',expected_title:'Losartán potásico 50 mg 30 comprimidos recubiertos',conditions:'Prueba técnica: condiciones comerciales pendientes de aprobación.'},
 eco:{source:'eco',url:'https://www.ecofarmacias.cl/producto/metformina-clorhidrato-850-mg-x-60-comprimidos/',expected_title:'Metformina Clorhidrato 850 mg x 60 Comprimidos',conditions:'Prueba técnica: ficha con conflicto conocido de 60/30 comprimidos.'},
 cruzverde:{source:'cruzverde',url:'https://www.cruzverde.cl/losartan-potasico-50-mg-30-comprimidos/268539.html',expected_title:'Losartan Potasico 50 mg 30 Comprimidos',conditions:'Prueba técnica: identidad comercial pendiente de aprobación.'}
};
const safeErrors=new Set(['INVALID_URL','REDIRECTED_PRODUCT','IDENTITY_CHANGED','LOCATION_NOT_CONFIRMED','PRODUCT_SECTION_MISSING','PRESENTATION_CONFLICT','PRICE_AMBIGUOUS','PRICE_ORDER_CHANGED','PROVIDER_NOT_CONFIGURED','PROVIDER_CREATE_FAILED']);
export async function probe(source,collect=scrape,clock=Date.now){
 if(!Object.hasOwn(samples,source))throw Error('INVALID_SOURCE');
 const start=clock();
 try{const offer=await collect(samples[source]);return {test_only:true,source,status:'ok',elapsed_ms:clock()-start,offer};}
 catch(e){return {test_only:true,source,status:'error',elapsed_ms:clock()-start,error:safeErrors.has(e.message)?e.message:'BROWSER_FAILED'};}
}
async function main(){
 const source=process.argv[2]||'drsimi';
 if(!process.env.BROWSERBASE_API_KEY||!process.env.BROWSERBASE_PROJECT_ID){console.error('Configura BROWSERBASE_API_KEY y BROWSERBASE_PROJECT_ID en el archivo privado browserbase.env. No se abrió ningún navegador.');process.exitCode=1;return;}
 const result=await probe(source);console.log(JSON.stringify(result,null,2));if(result.status!=='ok')process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Fuente inválida. Usa drsimi, eco o cruzverde.');process.exitCode=1;});
