import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const origins = new Set(["https://portal.plofarma.cl", "http://localhost:8000", "http://127.0.0.1:8000"]);
function key(name: string, fallback: string) {
  try { return JSON.parse(Deno.env.get(name) || "{}").default || Deno.env.get(fallback) || ""; }
  catch { return Deno.env.get(fallback) || ""; }
}
const errors: Record<string, string> = {
  PLO_ORDER_NOT_FOUND: "El pedido ya no está disponible.",
  PLO_ORDER_CHANGED: "El pedido cambió desde que lo abriste. Actualiza el detalle antes de continuar.",
  PLO_INVALID_TRANSITION: "Ese cambio no corresponde al estado actual del pedido.",
  PLO_RESERVATION_EXPIRED: "La reserva venció. No registres el pago sobre esta orden; revisa el caso y crea un nuevo pedido.",
  PLO_RECEIPT_REQUIRED: "El pedido necesita un comprobante pendiente de revisión para completar esta acción.",
  PLO_INVALID_ACTION: "Ingresa un motivo o referencia de entre 3 y 500 caracteres.",
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Origin": origin && origins.has(origin) ? origin : "https://portal.plofarma.cl",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin", "Content-Type": "application/json", "Cache-Control": "no-store",
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (origin && !origins.has(origin)) return json({ error: "Origen no permitido." }, 403);
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const pub = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secret = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !pub || !secret) throw new Error("Missing runtime configuration");
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return json({ error: "Debes iniciar sesión." }, 401);
    const auth = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: authError } = await auth.auth.getUser(token);
    if (authError || !identity.user) return json({ error: "Tu sesión no es válida." }, 401);
    if (identity.user.app_metadata?.role !== "portal_admin") return json({ error: "Acceso exclusivo para administradores." }, 403);
    let body;
    try { body = await req.json(); } catch { return json({ error: "Solicitud inválida." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Solicitud inválida." }, 400);
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action === "list") {
      const statuses = ["all", "awaiting_payment", "submitted", "confirmed", "preparing", "in_transit", "delivered", "cancelled"];
      if (!statuses.includes(body.status ?? "all") || (body.search !== undefined && (typeof body.search !== "string" || body.search.length > 120)) ||
        (body.page !== undefined && (!Number.isSafeInteger(body.page) || body.page < 0 || body.page > 100000))) return json({ error: "Filtro inválido." }, 400);
      const { data, error } = await admin.rpc("admin_list_portal_orders", {
        p_search: body.search?.trim() || "", p_status: body.status || "all", p_page: body.page || 0,
      });
      if (error) throw error;
      return json(data);
    }
    if (!Number.isSafeInteger(body.orderId) || body.orderId < 1) return json({ error: "Pedido inválido." }, 400);
    if (body.action === "detail") {
      const { data: order, error } = await admin.from("orders")
        .select("id,order_number,status,payment_status,payment_method,payment_reference,net_total,tax_total,grand_total,created_at,updated_at,expires_at,pharmacies(display_name,rut),order_items(sku,product_name,laboratory,lot_code,unit_net_price,quantity,line_net_total)")
        .eq("id", body.orderId).maybeSingle();
      if (error) throw error;
      if (!order) return json({ error: "Pedido no encontrado." }, 404);
      const { data: events, error: eventError } = await admin.from("order_admin_events")
        .select("id,actor_id,action,previous_status,new_status,note,created_at").eq("order_id", body.orderId).order("id");
      if (eventError) throw eventError;
      const { data: receipt, error: receiptError } = await admin.from("payment_receipts")
        .select("id,original_name,mime_type,size_bytes,status,rejection_reason,created_at,updated_at,reviewed_at")
        .eq("order_id", body.orderId).maybeSingle();
      if (receiptError) throw receiptError;
      let receiptWithUrl = receipt;
      if (receipt) {
        const { data: pathRow, error: pathError } = await admin.from("payment_receipts")
          .select("storage_path").eq("id", receipt.id).single();
        if (pathError) throw pathError;
        const { data: signed, error: signedError } = await admin.storage.from("payment-receipts")
          .createSignedUrl(pathRow.storage_path, 600);
        if (signedError) throw signedError;
        receiptWithUrl = { ...receipt, signed_url: signed.signedUrl };
      }
      const operators = new Map<string, string>();
      await Promise.all([...new Set((events || []).map(event => event.actor_id))].map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        operators.set(id, data.user?.email || "Administrador");
      }));
      return json({ order, receipt: receiptWithUrl, events: (events || []).map(event => ({ ...event, actor_label: operators.get(event.actor_id) })) });
    }
    if (body.action === "update") {
      if (!["confirm_payment", "reject_receipt", "prepare", "dispatch", "deliver", "cancel"].includes(body.operation) ||
        typeof body.note !== "string" || body.note.trim().length < 3 || body.note.trim().length > 500 ||
        typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) return json({ error: "Completa el motivo o referencia de la operación." }, 400);
      const { data, error } = await admin.rpc("admin_update_portal_order", {
        p_order_id: body.orderId, p_actor_id: identity.user.id, p_action: body.operation,
        p_expected_updated_at: body.expectedUpdatedAt, p_note: body.note.trim(),
      });
      if (error) {
        if (errors[error.message]) return json({ error: errors[error.message] }, 409);
        throw error;
      }
      return json({ result: data });
    }
    return json({ error: "Acción no válida." }, 400);
  } catch (error) {
    console.error("Admin orders failed", error instanceof Error ? error.message : "Database or service error");
    return json({ error: "No pudimos completar la operación. Actualiza e intenta nuevamente." }, 500);
  }
});
