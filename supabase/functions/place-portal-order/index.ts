import { createClient } from "npm:@supabase/supabase-js@2.117.1";

import { allowCheckout } from "../_shared/khipu.ts";

const PORTAL_ORIGIN = "https://portal.plofarma.cl";
const ALLOWED_ORIGINS = new Set([
  PORTAL_ORIGIN,
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

type OrderItem = {
  catalogItemId?: number;
  quantity?: number;
};

type RequestBody = {
  pharmacyId?: string;
  clientRequestId?: string;
  paymentMethod?: "cash" | "bank_transfer" | "khipu";
  items?: OrderItem[];
};

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : PORTAL_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function readNamedKey(name: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS") {
  const raw = Deno.env.get(name);
  if (!raw) return "";

  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? "";
  } catch {
    return "";
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function publicOrderError(message: string) {
  const errors: Record<string, { error: string; status: number }> = {
    PLO_ACCESS_DENIED: {
      error: "Tu cuenta no tiene permiso para comprar por esta farmacia.",
      status: 403,
    },
    PLO_INVALID_REQUEST: {
      error: "No pudimos identificar correctamente la solicitud.",
      status: 400,
    },
    PLO_INVALID_ITEMS: {
      error: "El pedido contiene cantidades o productos inválidos.",
      status: 422,
    },
    PLO_PRODUCT_UNAVAILABLE: {
      error: "Uno de los productos ya no está disponible. Actualiza el catálogo.",
      status: 409,
    },
    PLO_MAX_QUANTITY: {
      error: "Una cantidad supera el máximo permitido para ese producto.",
      status: 409,
    },
    PLO_STOCK_INSUFFICIENT: {
      error: "El stock cambió mientras armabas el pedido. Actualiza las cantidades.",
      status: 409,
    },
    PLO_PAYMENT_METHOD_UNAVAILABLE: {
      error: "Ese método de pago todavía no está disponible.",
      status: 422,
    },
    PLO_ORDER_TOTAL_TOO_LARGE: {
      error: "El monto del pedido supera el máximo permitido.",
      status: 422,
    },
  };

  return errors[message] ?? {
    error: "No pudimos registrar el pedido. Intenta nuevamente.",
    status: 500,
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(origin, { error: "Origen no permitido." }, 403);
  }

  if (req.method !== "POST") {
    return json(origin, { error: "Método no permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = readNamedKey("SUPABASE_PUBLISHABLE_KEYS") ||
    Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = readNamedKey("SUPABASE_SECRET_KEYS") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Missing Supabase runtime configuration");
    return json(origin, { error: "Configuración incompleta del servicio." }, 500);
  }

  if (!token) {
    return json(origin, { error: "Debes iniciar sesión." }, 401);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const customer = userData.user;

  if (userError || !customer) {
    return json(origin, { error: "La sesión no es válida." }, 401);
  }

  if (customer.app_metadata?.role !== "pharmacy_user") {
    return json(origin, { error: "Tu cuenta no tiene acceso de compra." }, 403);
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return json(origin, { error: "Solicitud inválida." }, 400);
  }

  if (!isUuid(body.pharmacyId) || !isUuid(body.clientRequestId)) {
    return json(origin, { error: "No pudimos identificar la farmacia o la solicitud." }, 400);
  }

  if (body.paymentMethod === "khipu") {
    try { allowCheckout(name => Deno.env.get(name), customer.id); }
    catch { return json(origin, { error: "Khipu todavía no está disponible." }, 503); }
  }

  if (body.paymentMethod !== "cash" && body.paymentMethod !== "bank_transfer" && body.paymentMethod !== "khipu") {
    return json(origin, { error: "Ese método de pago todavía no está disponible." }, 422);
  }

  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) {
    return json(origin, { error: "El pedido debe contener entre 1 y 50 productos." }, 422);
  }

  const validItems = body.items.every((item) =>
    Number.isSafeInteger(item.catalogItemId) &&
    Number(item.catalogItemId) > 0 &&
    Number.isSafeInteger(item.quantity) &&
    Number(item.quantity) > 0 &&
    Number(item.quantity) <= 100000
  );

  if (!validItems) {
    return json(origin, { error: "El pedido contiene cantidades o productos inválidos." }, 422);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order, error: orderError } = await admin.rpc(
    "place_portal_order_internal",
    {
      p_user_id: customer.id,
      p_pharmacy_id: body.pharmacyId,
      p_items: body.items.map((item) => ({
        catalog_item_id: item.catalogItemId,
        quantity: item.quantity,
      })),
      p_payment_method: body.paymentMethod,
      p_client_request_id: body.clientRequestId,
    },
  );

  if (orderError) {
    const publicError = publicOrderError(orderError.message);
    if (publicError.status >= 500) {
      console.error("Unable to place portal order", {
        code: orderError.code,
        message: orderError.message,
      });
    }
    return json(origin, { error: publicError.error }, publicError.status);
  }

  return json(origin, { order }, 201);
});
