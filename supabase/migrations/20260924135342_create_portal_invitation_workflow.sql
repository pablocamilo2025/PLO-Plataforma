alter table public.preinscripciones
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column invited_at timestamptz,
  add column auth_user_id uuid references auth.users(id) on delete set null,
  add column approved_tier text
    check (approved_tier in ('acceso', 'socio'));

comment on column public.preinscripciones.reviewed_at is
  'Fecha en que un administrador aprobó o revisó la preinscripción.';
comment on column public.preinscripciones.reviewed_by is
  'Usuario administrativo que aprobó la preinscripción.';
comment on column public.preinscripciones.invited_at is
  'Fecha en que Supabase Auth emitió la invitación al portal.';
comment on column public.preinscripciones.auth_user_id is
  'Usuario de Auth creado para la preinscripción aprobada.';
comment on column public.preinscripciones.approved_tier is
  'Nivel comercial asignado al aprobar la farmacia.';

create unique index preinscripciones_auth_user_id_unique_idx
  on public.preinscripciones(auth_user_id)
  where auth_user_id is not null;

create unique index pharmacies_source_preinscripcion_id_unique_idx
  on public.pharmacies(source_preinscripcion_id)
  where source_preinscripcion_id is not null;

create or replace function public.complete_portal_invitation(
  p_preinscripcion_id uuid,
  p_user_id uuid,
  p_tier text,
  p_approved_by uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  registration public.preinscripciones%rowtype;
  pharmacy_id uuid;
  normalized_rut text;
begin
  if p_tier not in ('acceso', 'socio') then
    raise exception 'invalid tier';
  end if;

  select *
  into registration
  from public.preinscripciones
  where id = p_preinscripcion_id
  for update;

  if not found then
    raise exception 'pre-registration not found';
  end if;

  if registration.estado = 'descartado' then
    raise exception 'discarded pre-registration cannot be approved';
  end if;

  if registration.auth_user_id is not null
     and registration.auth_user_id <> p_user_id then
    raise exception 'pre-registration already belongs to another user';
  end if;

  normalized_rut := upper(regexp_replace(registration.rut, '[^0-9kK]', '', 'g'));
  if normalized_rut !~ '^[0-9]{7,8}[0-9K]$' then
    raise exception 'invalid normalized rut';
  end if;

  insert into public.pharmacies (
    rut,
    legal_name,
    display_name,
    tier,
    status,
    source_preinscripcion_id
  )
  values (
    normalized_rut,
    trim(registration.farmacia),
    trim(registration.farmacia),
    p_tier,
    'active',
    registration.id
  )
  on conflict (rut) do update
  set legal_name = excluded.legal_name,
      display_name = excluded.display_name,
      tier = excluded.tier,
      status = 'active',
      source_preinscripcion_id = coalesce(
        public.pharmacies.source_preinscripcion_id,
        excluded.source_preinscripcion_id
      ),
      updated_at = now()
  returning id into pharmacy_id;

  insert into public.profiles (
    user_id,
    full_name,
    phone,
    status
  )
  values (
    p_user_id,
    trim(registration.nombre),
    nullif(trim(registration.telefono), ''),
    'active'
  )
  on conflict (user_id) do update
  set full_name = excluded.full_name,
      phone = excluded.phone,
      status = 'active',
      updated_at = now();

  insert into public.pharmacy_memberships (
    pharmacy_id,
    user_id,
    role,
    status
  )
  values (
    pharmacy_id,
    p_user_id,
    'owner',
    'active'
  )
  on conflict (pharmacy_id, user_id) do update
  set role = 'owner',
      status = 'active';

  update public.preinscripciones
  set estado = 'validado',
      reviewed_at = now(),
      reviewed_by = p_approved_by,
      invited_at = now(),
      auth_user_id = p_user_id,
      approved_tier = p_tier
  where id = registration.id;

  return jsonb_build_object(
    'preinscripcion_id', registration.id,
    'pharmacy_id', pharmacy_id,
    'user_id', p_user_id,
    'tier', p_tier,
    'status', 'invited'
  );
end;
$$;

revoke all on function public.complete_portal_invitation(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_portal_invitation(uuid, uuid, text, uuid)
  to service_role;
