// Store international digits, the same format as Meta wa_id. Never infer a country.
export function normalizePhone(value){
 if(typeof value!=='string'||value.length>40)throw new Error('PHONE_INVALID');
 const clean=value.trim().replace(/[ ()-]/g,'');
 if(!/^\+[1-9][0-9]{6,14}$/.test(clean))throw new Error('PHONE_INVALID');
 return clean.replace(/^\+/,'');
}
