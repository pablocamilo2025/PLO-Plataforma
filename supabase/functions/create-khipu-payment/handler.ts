import {
  allowCheckout,
  Env,
  khipuRequest,
  PaymentError,
  paymentId,
  readBody,
  safePaymentUrl,
} from "../_shared/khipu.ts";
export type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: any; error: any }>;
export type Dependencies = {
  env: Env;
  rpc: Rpc;
  user: (
    token: string,
  ) => Promise<{ id: string; app_metadata?: Record<string, unknown> } | null>;
  fetcher?: typeof fetch;
};
export function createHandler(deps: Dependencies) {
  return async (req: Request) => {
    const portal = deps.env("KHIPU_PORTAL_ORIGIN") ??
      "https://portal.plofarma.cl";
    const headers = {
      "Access-Control-Allow-Origin": portal,
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
      "Cache-Control": "no-store",
    };
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers });
    try {
      if (req.headers.get("Origin") && req.headers.get("Origin") !== portal) {
        return reply({ error: "ORIGIN_DENIED" }, 403);
      }
      if (req.method === "OPTIONS") return new Response("ok", { headers });
      if (req.method !== "POST") {
        return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      const token = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "")
        ?.[1];
      if (!token) return reply({ error: "UNAUTHORIZED" }, 401);
      const user = await deps.user(token);
      if (!user) return reply({ error: "UNAUTHORIZED" }, 401);
      if (user.app_metadata?.role !== "pharmacy_user") {
        return reply({ error: "ACCESS_DENIED" }, 403);
      }
      const cfg = allowCheckout(deps.env, user.id);
      const body = JSON.parse(await readBody(req));
      if (
        !body || typeof body.orderNumber !== "string" ||
        !/^OC-\d{4}-\d{6}$/.test(body.orderNumber)
      ) return reply({ error: "INVALID_ORDER" }, 400);
      const { data: claim, error } = await deps.rpc("claim_khipu_payment", {
        p_user_id: user.id,
        p_order_number: body.orderNumber,
        p_receiver_id: cfg.receiver,
        p_mode: cfg.mode,
      });
      if (error) return reply({ error: "ORDER_NOT_PAYABLE" }, 409);
      if (!claim.create) {
        if (claim.status === "pending" && safePaymentUrl(claim.payment_url)) {
          return reply({ paymentUrl: claim.payment_url, duplicate: true });
        }
        return reply(
          { error: "PAYMENT_REQUIRES_REVIEW", status: claim.status },
          409,
        );
      }
      // Never automatically retry POST: transaction_id is correlation, not a documented idempotency key.
      // The persisted claim stays blocked after a timeout/crash, preventing a second charge.
      try {
        const base = `${cfg.portal}/khipu-return.html`;
        const payment = await khipuRequest(cfg.apiKey, "/payments", {
          subject: `Pedido PLO ${body.orderNumber}`,
          amount: claim.amount,
          currency: "CLP",
          transaction_id: claim.transaction_id,
          expires_date: claim.expires_at,
          return_url: `${base}?result=pending`,
          cancel_url: `${base}?result=cancelled`,
          notify_url: `${deps.env("SUPABASE_URL")}/functions/v1/khipu-webhook`,
          notify_api_version: "3.0",
          send_email: false,
          send_reminders: false,
        }, deps.fetcher);
        if (
          !paymentId(payment.payment_id) || !safePaymentUrl(payment.payment_url)
        ) throw new Error("Invalid provider response");
        const { error: saveError } = await deps.rpc("attach_khipu_payment", {
          p_transaction_id: claim.transaction_id,
          p_payment_id: payment.payment_id,
          p_payment_url: payment.payment_url,
        });
        if (saveError) throw new Error("Persistence failed");
        return reply(
          { paymentUrl: payment.payment_url, duplicate: false },
          201,
        );
      } catch {
        await deps.rpc("mark_khipu_payment_unknown", {
          p_transaction_id: claim.transaction_id,
        });
        return reply({ error: "PAYMENT_CREATION_UNCERTAIN" }, 503);
      }
    } catch (error) {
      if (error instanceof PaymentError) {
        return reply({ error: error.code }, error.status);
      }
      if (error instanceof SyntaxError || error instanceof TypeError) {
        return reply({ error: "INVALID_BODY" }, 400);
      }
      return reply({ error: "PAYMENT_SERVICE_UNAVAILABLE" }, 503);
    }
  };
}
