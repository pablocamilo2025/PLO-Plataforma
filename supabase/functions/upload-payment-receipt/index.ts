import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const PORTAL_ORIGIN = "https://portal.plofarma.cl";
const ALLOWED_ORIGINS = new Set([
  PORTAL_ORIGIN,
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);
const MAX_FILE_SIZE = 6 * 1024 * 1024;

type FileKind = { mime: string; extension: "pdf" | "jpg" | "png" | "webp" };

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : PORTAL_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string | null, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function readNamedKey(name: "SUPABASE_PUBLISHABLE_KEYS" | "SUPABASE_SECRET_KEYS") {
  const raw = Deno.env.get(name);
  if (!raw) return "";
  try { return (JSON.parse(raw) as Record<string, string>).default ?? ""; }
  catch { return ""; }
}

function detectFile(bytes: Uint8Array): FileKind | null {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
    return { mime: "application/pdf", extension: "pdf" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) {
    return { mime: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }
  return null;
}

function safeOriginalName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "comprobante";
}

function publicError(message: string) {
  const errors: Record<string, { error: string; status: number }> = {
    PLO_ACCESS_DENIED: { error: "No tienes permiso para adjuntar archivos a este pedido.", status: 403 },
    PLO_INVALID_RECEIPT: { error: "El comprobante no cumple los requisitos permitidos.", status: 422 },
    PLO_RECEIPT_NOT_ALLOWED: { error: "Este pedido no requiere comprobante de transferencia.", status: 409 },
    PLO_ORDER_CHANGED: { error: "El pedido ya cambió de estado. Actualiza Mis pedidos.", status: 409 },
    PLO_RESERVATION_EXPIRED: { error: "La reserva venció y ya no permite adjuntar un comprobante.", status: 409 },
  };
  return errors[message] ?? { error: "No pudimos guardar el comprobante. Intenta nuevamente.", status: 500 };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: "Origen no permitido." }, 403);
  if (req.method !== "POST") return json(origin, { error: "Método no permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = readNamedKey("SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secretKey = readNamedKey("SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1] ?? "";
  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Missing Supabase runtime configuration");
    return json(origin, { error: "Configuración incompleta del servicio." }, 500);
  }
  if (!token) return json(origin, { error: "Debes iniciar sesión." }, 401);

  const auth = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: authError } = await auth.auth.getUser(token);
  if (authError || !identity.user) return json(origin, { error: "Tu sesión no es válida." }, 401);
  if (identity.user.app_metadata?.role !== "pharmacy_user") {
    return json(origin, { error: "Tu cuenta no tiene acceso de cliente." }, 403);
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return json(origin, { error: "Solicitud inválida." }, 400); }
  const orderId = Number(form.get("orderId"));
  const file = form.get("file");
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !(file instanceof File)) {
    return json(origin, { error: "Selecciona un comprobante válido." }, 400);
  }
  if (file.size < 1 || file.size > MAX_FILE_SIZE) {
    return json(origin, { error: "El archivo debe pesar como máximo 6 MB." }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectFile(bytes);
  if (!kind) {
    return json(origin, { error: "Usa un archivo PDF, JPG, PNG o WebP válido." }, 415);
  }

  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: membership, error: membershipError } = await admin.from("pharmacy_memberships")
    .select("pharmacy_id")
    .eq("user_id", identity.user.id).eq("status", "active")
    .limit(1).maybeSingle();
  if (membershipError || !membership) return json(origin, { error: "No encontramos una farmacia activa para tu cuenta." }, 403);

  const path = `${membership.pharmacy_id}/${orderId}/${crypto.randomUUID()}.${kind.extension}`;
  const { error: uploadError } = await admin.storage.from("payment-receipts").upload(path, bytes, {
    contentType: kind.mime,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    console.error("Receipt upload failed", uploadError.message);
    return json(origin, { error: "No pudimos subir el archivo. Intenta nuevamente." }, 500);
  }

  const { data: receipt, error: receiptError } = await admin.rpc("upsert_payment_receipt_internal", {
    p_user_id: identity.user.id,
    p_order_id: orderId,
    p_storage_path: path,
    p_original_name: safeOriginalName(file.name),
    p_mime_type: kind.mime,
    p_size_bytes: file.size,
  });
  if (receiptError) {
    await admin.storage.from("payment-receipts").remove([path]);
    const error = publicError(receiptError.message);
    if (error.status >= 500) console.error("Receipt registration failed", receiptError.message);
    return json(origin, { error: error.error }, error.status);
  }

  if (receipt?.previousPath && receipt.previousPath !== path) {
    const { error: removeError } = await admin.storage.from("payment-receipts").remove([receipt.previousPath]);
    if (removeError) console.error("Previous receipt cleanup failed", removeError.message);
  }
  return json(origin, { receipt: { status: receipt.status, originalName: receipt.originalName, updatedAt: receipt.updatedAt } }, 201);
});
