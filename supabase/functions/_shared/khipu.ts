// API 3.0: API key for requests; merchant secret (a different credential) for HMAC.
export type Env = (name: string) => string | undefined;
export class PaymentError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}
export function config(env: Env) {
  const mode = env("KHIPU_MODE") ?? "disabled";
  const apiKey = env("KHIPU_API_KEY") ?? "";
  const secret = env("KHIPU_WEBHOOK_SECRET") ?? "";
  const receiver = env("KHIPU_RECEIVER_ID") ?? "";
  if (
    !["development", "production"].includes(mode) || !apiKey || !secret ||
    !/^[1-9]\d*$/.test(receiver)
  ) {
    throw new PaymentError(503, "KHIPU_NOT_CONFIGURED");
  }
  const portal = env("KHIPU_PORTAL_ORIGIN") ?? "https://portal.plofarma.cl";
  const url = new URL(portal);
  const localDemo = mode === "development" && url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "8000";
  if ((!localDemo && url.protocol !== "https:") || url.origin !== portal) {
    throw new PaymentError(503, "KHIPU_NOT_CONFIGURED");
  }
  return { mode, apiKey, secret, receiver, portal };
}
export function allowCheckout(env: Env, userId: string) {
  const cfg = config(env);
  if (env("KHIPU_CHECKOUT_ENABLED") !== "true") {
    throw new PaymentError(503, "KHIPU_DISABLED");
  }
  if (
    cfg.mode === "development" &&
    !(env("KHIPU_TEST_USER_IDS") ?? "").split(",").map((s) => s.trim())
      .includes(userId)
  ) {
    throw new PaymentError(403, "KHIPU_TEST_ACCESS_ONLY");
  }
  return cfg;
}
export function paymentId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9]{12}$/.test(value);
}
export function safePaymentUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      ["khipu.com", "www.khipu.com", "app.khipu.com"].includes(u.hostname) &&
      !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}
export async function verifySignature(
  raw: string,
  header: string,
  secret: string,
  now = Date.now(),
) {
  const match = /^t=(\d{13}),\s*s=([A-Za-z0-9+/]{43}=)$/.exec(header);
  if (!match || !secret || Math.abs(now - Number(match[1])) > 300_000) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(`${match[1]}.${raw}`),
  );
}
export async function readBody(req: Request, max = 16384) {
  if (Number(req.headers.get("content-length")) > max) {
    throw new PaymentError(413, "BODY_TOO_LARGE");
  }
  const reader = req.body?.getReader();
  if (!reader) throw new PaymentError(400, "INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new PaymentError(413, "BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function khipuRequest(
  apiKey: string,
  path: string,
  body?: unknown,
  fetcher = fetch,
) {
  const response = await fetcher(`https://payment-api.khipu.com/v3${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new PaymentError(502, "KHIPU_UNAVAILABLE");
  return response.json();
}
export function settlement(
  payment: Record<string, unknown>,
  id: string,
  receiver: string,
) {
  if (
    payment.payment_id !== id || String(payment.receiver_id) !== receiver ||
    typeof payment.transaction_id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(payment.transaction_id) ||
    payment.currency !== "CLP" ||
    !/^[1-9]\d*(\.0{1,4})?$/.test(String(payment.amount)) ||
    !Number.isSafeInteger(Number(payment.amount))
  ) throw new PaymentError(422, "PAYMENT_MISMATCH");
  // A payer's return/cancel URL, manual mark-paid and refunds never authorize fulfilment.
  if (payment.status !== "done" || payment.status_detail !== "normal") {
    throw new PaymentError(409, "PAYMENT_NOT_SETTLED");
  }
  if (
    typeof payment.conciliation_date !== "string" ||
    !Number.isFinite(Date.parse(payment.conciliation_date)) ||
    typeof payment.out_of_date_conciliation !== "boolean"
  ) throw new PaymentError(422, "PAYMENT_MISMATCH");
  return {
    p_transaction_id: payment.transaction_id,
    p_payment_id: id,
    p_receiver_id: receiver,
    p_amount: Number(payment.amount),
    p_currency: "CLP",
    p_conciliation_date: payment.conciliation_date,
    p_late: payment.out_of_date_conciliation,
  };
}
