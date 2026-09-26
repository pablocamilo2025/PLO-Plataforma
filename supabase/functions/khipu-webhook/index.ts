import { adminClient } from "../_shared/khipu-runtime.ts";
import { webhookHandler } from "./handler.ts";
Deno.serve(async (req: Request) => {
  try {
    const admin = adminClient();
    return await webhookHandler({
      env: (name) => Deno.env.get(name),
      rpc: async (name, args) => await admin.rpc(name, args),
    })(req);
  } catch {
    return Response.json({ error: "WEBHOOK_UNAVAILABLE" }, { status: 503 });
  }
});
