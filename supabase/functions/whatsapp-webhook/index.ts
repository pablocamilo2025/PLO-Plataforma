import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { createHandler } from './handler.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createHandler({secret:Deno.env.get('WHATSAPP_APP_SECRET'),verifyToken:Deno.env.get('WHATSAPP_VERIFY_TOKEN'),phoneId:Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'),persist:async (message:Record<string,unknown>)=>{const {error}=await db.rpc('receive_whatsapp_message',message);if(error)throw error;}}));
