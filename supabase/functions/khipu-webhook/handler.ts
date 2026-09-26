import {
  config,
  Env,
  khipuRequest,
  PaymentError,
  paymentId,
  readBody,
  settlement,
  verifySignature,
} from "../_shared/khipu.ts";
import type { Rpc } from "../create-khipu-payment/handler.ts";
export function webhookHandler(
  deps: { env: Env; rpc: Rpc; fetcher?: typeof fetch; now?: () => number },
) {
  return async (req: Request) => {
    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    try {
      if (req.method !== "POST") {
        return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      const cfg = config(deps.env); // Checkout kill switch must not prevent incoming settlements.
      const raw = await readBody(req);
      if (
        !await verifySignature(
          raw,
          req.headers.get("x-khipu-signature") ?? "",
          cfg.secret,
          deps.now?.(),
        )
      ) return reply({ error: "INVALID_SIGNATURE" }, 401);
      const event = JSON.parse(raw);
      if (
        !event || !paymentId(event.payment_id) ||
        String(event.receiver_id) !== cfg.receiver
      ) return reply({ error: "INVALID_EVENT" }, 422);
      const payment = await khipuRequest(
        cfg.apiKey,
        `/payments/${event.payment_id}`,
        undefined,
        deps.fetcher,
      );
      const args = settlement(payment, event.payment_id, cfg.receiver);
      const { data, error } = await deps.rpc("settle_khipu_payment", args);
      if (error) return reply({ error: "SETTLEMENT_NOT_SAVED" }, 503);
      // ACK only after the transaction is durable; duplicate callbacks return 200 too.
      return reply({ received: true, status: data.status });
    } catch (error) {
      if (error instanceof PaymentError) {
        return reply({ error: error.code }, error.status);
      }
      if (error instanceof SyntaxError) {
        return reply({ error: "INVALID_EVENT" }, 400);
      }
      return reply({ error: "WEBHOOK_UNAVAILABLE" }, 503);
    }
  };
}
