export const hosts={eco:'www.ecofarmacias.cl',drsimi:'www.drsimi.cl',cruzverde:'www.cruzverde.cl'};
export const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
export function canonicalURL(source,value){
 let u;try{u=new URL(value);}catch{throw Error('INVALID_URL');}
 const paths={eco:/^\/producto\/[^/?#]+\/$/,drsimi:/^\/[^/?#]+\/p$/,cruzverde:/^\/[^/?#]+\/\d+\.html$/};
 if(u.protocol!=='https:'||u.host!==hosts[source]||u.username||u.password||u.search||u.hash||!paths[source]?.test(u.pathname))throw Error('INVALID_URL');
 return u.href;
}
function packCounts(text){return [...normalize(text).matchAll(/\b(\d+)\s*(?:comprimidos|capsulas|tabletas)\b/g)].map(m=>m[1]);}
export function extractOffer(target,snapshot){
 const url=canonicalURL(target.source,target.url);
 if(canonicalURL(target.source,snapshot.url)!==url)throw Error('REDIRECTED_PRODUCT');
 const expected=normalize(target.expected_title);
 if(!snapshot.headings?.some(h=>normalize(h)===expected))throw Error('IDENTITY_CHANGED');
 const body=String(snapshot.body||'');
 if(target.source==='cruzverde'&&!body.includes('Inventario de Las Condes'))throw Error('LOCATION_NOT_CONFIRMED');
 const lines=body.split('\n').map(s=>s.trim()).filter(Boolean);
 const start=lines.findIndex(s=>normalize(s)===expected);
 if(start<0)throw Error('PRODUCT_SECTION_MISSING');
 const endWords={eco:['Destacados'],drsimi:['Otros clientes también compraron'],cruzverde:['Beneficios y Usos']};
 let section=lines.slice(start);
 const end=section.findIndex(s=>endWords[target.source].some(w=>normalize(s)===normalize(w)));
 if(end>=0)section=section.slice(0,end);
 if(new Set(packCounts(section.join('\n'))).size>1)throw Error('PRESENTATION_CONFLICT');
 // Only standalone currency amounts in the primary section. Excludes unit prices,
 // basket totals, and recommendations. Unknown layouts fail closed.
 const amounts=section.filter(s=>/^\$\s*(?:\d{1,3}(?:\.\d{3})+|\d+)$/.test(s))
   .map(s=>Number(s.replace(/[^0-9]/g,'')));
 if(amounts.length<1||amounts.length>2||amounts.some(v=>!Number.isSafeInteger(v)||v<1||v>99999999))throw Error('PRICE_AMBIGUOUS');
 if(amounts.length===2&&amounts[0]<amounts[1])throw Error('PRICE_ORDER_CHANGED');
 const text=normalize(section.join('\n'));
 const unavailable=/sin stock|agotado|no disponible/.test(text);
 const available=unavailable?false:/en stock|\b\d+ disponibles\b|stock disponible|despacho a domicilio disponible/.test(text)?true:'unknown';
 return {name:target.expected_title,url,currency:'CLP',price:amounts.at(-1),list_price:amounts.length===2?amounts[0]:null,
  available,conditions:target.conditions,location:target.source==='cruzverde'?'Las Condes':null,extractor_version:'visible-v1'};
}
