// Serialize writes per browser so a slow earlier request cannot overwrite a newer cart.
export function createCartPublisher({write,onState=()=>{}}){
 let pending=null,running=false;
 async function drain(){
  if(running)return;running=true;
  try{while(pending){const snapshot=pending;pending=null;try{await write(snapshot);onState('synced',snapshot);}catch{onState('error',snapshot);}}}finally{running=false;}
 }
 return {publish(snapshot){pending=structuredClone(snapshot);onState('pending',snapshot);return drain();}};
}
