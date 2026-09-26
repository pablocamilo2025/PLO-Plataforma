import { adminClient } from "../_shared/khipu-runtime.ts";
import { createHandler } from "./handler.ts";
Deno.serve(async (req: Request) => {
  try {
    const admin = adminClient();
    return await createHandler({
      env: (name) => Deno.env.get(name),
      rpc: async (name, args) => await admin.rpc(name, args),
      user: async (token) => {
        const { data, error } = await admin.auth.getUser(token);
        return error ? null : data.user;
      },
    })(req);
  } catch {
    return Response.json({ error: "PAYMENT_SERVICE_UNAVAILABLE" }, {
      status: 503,
    });
  }
});
