import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const PORTAL_URL = "https://portal.plofarma.cl/";
const ALLOWED_ORIGINS = new Set([
  "https://portal.plofarma.cl",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);

type RequestBody = {
  action?: "list" | "approve";
  preinscripcionId?: string;
  tier?: "acceso" | "socio";
};

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : PORTAL_URL.slice(0, -1);

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

function normalizeRut(value: string) {
  return value.toUpperCase().replace(/[^0-9K]/g, "");
}

function publicInviteError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("not authorized") || normalized.includes("smtp")) {
    return "El correo de invitación no pudo salir. Configura el SMTP propio de PLO en Supabase.";
  }
  if (normalized.includes("already") || normalized.includes("registered")) {
    return "Ese correo ya tiene una cuenta en Supabase. Revisa el usuario antes de volver a invitarlo.";
  }
  if (normalized.includes("rate")) {
    return "Se alcanzó el límite temporal de correos. Intenta nuevamente más tarde.";
  }
  return "No fue posible enviar la invitación.";
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
  const operator = userData.user;

  if (userError || !operator) {
    return json(origin, { error: "La sesión no es válida." }, 401);
  }

  if (operator.app_metadata?.role !== "portal_admin") {
    return json(origin, { error: "Tu cuenta no tiene permiso de administración." }, 403);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return json(origin, { error: "Solicitud inválida." }, 400);
  }

  if (body.action === "list") {
    const { data, error } = await admin
      .from("preinscripciones")
      .select("id,created_at,nombre,email,telefono,farmacia,rut,comuna,interes,estado,reviewed_at,invited_at,auth_user_id,approved_tier")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Unable to list pre-registrations", error);
      return json(origin, { error: "No fue posible cargar las preinscripciones." }, 500);
    }

    return json(origin, { preinscripciones: data ?? [] });
  }

  if (body.action !== "approve") {
    return json(origin, { error: "Acción no reconocida." }, 400);
  }

  if (!body.preinscripcionId || !/^[0-9a-f-]{36}$/i.test(body.preinscripcionId)) {
    return json(origin, { error: "La preinscripción no es válida." }, 400);
  }

  const tier = body.tier === "socio" ? "socio" : "acceso";
  const { data: preregistration, error: preregistrationError } = await admin
    .from("preinscripciones")
    .select("id,nombre,email,telefono,farmacia,rut,comuna,estado,auth_user_id")
    .eq("id", body.preinscripcionId)
    .maybeSingle();

  if (preregistrationError) {
    console.error("Unable to load pre-registration", preregistrationError);
    return json(origin, { error: "No fue posible revisar la preinscripción." }, 500);
  }

  if (!preregistration) {
    return json(origin, { error: "La preinscripción no existe." }, 404);
  }

  if (preregistration.auth_user_id) {
    return json(origin, {
      status: "already_invited",
      message: "La farmacia ya fue aprobada e invitada.",
      userId: preregistration.auth_user_id,
    });
  }

  if (preregistration.estado === "descartado") {
    return json(origin, { error: "Una preinscripción descartada no puede ser aprobada." }, 409);
  }

  const rut = normalizeRut(preregistration.rut);
  if (!/^[0-9]{7,8}[0-9K]$/.test(rut)) {
    return json(origin, { error: "El RUT debe corregirse antes de aprobar la farmacia." }, 422);
  }

  const { data: invitation, error: invitationError } = await admin.auth.admin
    .inviteUserByEmail(preregistration.email.toLowerCase(), {
      redirectTo: PORTAL_URL,
      data: {
        full_name: preregistration.nombre,
        pharmacy_name: preregistration.farmacia,
      },
    });

  if (invitationError || !invitation.user) {
    console.error("Unable to invite portal user", invitationError);
    return json(origin, {
      error: publicInviteError(invitationError?.message ?? "Unknown invite error"),
    }, 502);
  }

  const invitedUser = invitation.user;
  const { error: metadataError } = await admin.auth.admin.updateUserById(invitedUser.id, {
    app_metadata: { role: "pharmacy_user" },
  });

  if (metadataError) {
    console.error("Unable to set invited user role", metadataError);
    await admin.auth.admin.deleteUser(invitedUser.id);
    return json(origin, { error: "La invitación se revirtió porque no se pudo asignar el rol." }, 500);
  }

  const { data: completed, error: completionError } = await admin.rpc(
    "complete_portal_invitation",
    {
      p_preinscripcion_id: preregistration.id,
      p_user_id: invitedUser.id,
      p_tier: tier,
      p_approved_by: operator.id,
    },
  );

  if (completionError) {
    console.error("Unable to complete portal invitation", completionError);
    await admin.auth.admin.deleteUser(invitedUser.id);
    return json(origin, { error: "La invitación se revirtió porque no se pudo crear la farmacia." }, 500);
  }

  return json(origin, {
    status: "invited",
    message: "Farmacia aprobada. La invitación fue enviada por correo.",
    invitation: completed,
  });
});
