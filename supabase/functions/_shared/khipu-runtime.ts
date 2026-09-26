import { createClient } from "npm:@supabase/supabase-js@2.117.1";
export function adminClient() {
  let secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  try {
    secret = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ||
      secret;
  } catch { /* legacy fallback */ }
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !secret) throw new Error("Missing runtime configuration");
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
