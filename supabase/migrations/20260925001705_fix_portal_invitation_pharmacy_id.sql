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
  v_registration public.preinscripciones%rowtype;
  v_pharmacy_id uuid;
  v_normalized_rut text;
begin
  if p_tier not in ('acceso', 'socio') then
    raise exception 'invalid tier';
  end if;

  select registration.*
  into v_registration
  from public.preinscripciones as registration
  where registration.id = p_preinscripcion_id
  for update;

  if not found then
    raise exception 'pre-registration not found';
  end if;

  if v_registration.estado = 'descartado' then
    raise exception 'discarded pre-registration cannot be approved';
  end if;

  if v_registration.auth_user_id is not null
     and v_registration.auth_user_id <> p_user_id then
    raise exception 'pre-registration already belongs to another user';
  end if;

  v_normalized_rut := upper(
    regexp_replace(v_registration.rut, '[^0-9kK]', '', 'g')
  );
  if v_normalized_rut !~ '^[0-9]{7,8}[0-9K]$' then
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
    v_normalized_rut,
    trim(v_registration.farmacia),
    trim(v_registration.farmacia),
    p_tier,
    'active',
    v_registration.id
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
  returning id into v_pharmacy_id;

  insert into public.profiles (
    user_id,
    full_name,
    phone,
    status
  )
  values (
    p_user_id,
    trim(v_registration.nombre),
    nullif(trim(v_registration.telefono), ''),
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
    v_pharmacy_id,
    p_user_id,
    'owner',
    'active'
  )
  on conflict on constraint pharmacy_memberships_pkey do update
  set role = 'owner',
      status = 'active';

  update public.preinscripciones as registration
  set estado = 'validado',
      reviewed_at = now(),
      reviewed_by = p_approved_by,
      invited_at = now(),
      auth_user_id = p_user_id,
      approved_tier = p_tier
  where registration.id = v_registration.id;

  return jsonb_build_object(
    'preinscripcion_id', v_registration.id,
    'pharmacy_id', v_pharmacy_id,
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
