/* Optional integration adapter. Load after the authenticated Supabase client.
   Reading cached prices never starts a scraper or enables scheduling. */
(function(root){
 async function call(client,body){
  const {data,error}=await client.functions.invoke('radar-prices',{body});
  if(error){let detail;try{detail=await error.context?.json();}catch{}throw Error(detail?.error||'RADAR_UNAVAILABLE');}
  if(data?.error)throw Error(data.error);return data;
 }
 root.RadarAPI={
  prices:(client,sku)=>call(client,{action:'prices',sku}),
  pilotPrice:(client,source='drsimi')=>call(client,{action:'pilot_price',source}),
  status:client=>call(client,{action:'status'}),
  publish:(client,workspaceId,revision,mappings)=>call(client,{action:'publish',workspace_id:workspaceId,revision,mappings}),
  setEnabled:(client,enabled)=>call(client,{action:'set_enabled',enabled})
 };
})(typeof window!=='undefined'?window:globalThis);
