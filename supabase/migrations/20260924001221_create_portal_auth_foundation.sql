create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  rut text not null unique,
  legal_name text not null,
  display_name text not null,
  tier text not null default 'acceso'
    check (tier in ('acceso', 'socio')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended')),
  source_preinscripcion_id uuid references public.preinscripciones(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (rut ~ '^[0-9]{7,8}[0-9K]$'),
  check (char_length(trim(legal_name)) between 2 and 180),
  check (char_length(trim(display_name)) between 2 and 160)
);

comment on table public.pharmacies is
  'Farmacias clientes autorizadas para operar en el Portal PLO.';

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(full_name)) between 2 and 120),
  check (phone is null or char_length(trim(phone)) between 8 and 30)
);

comment on table public.profiles is
  'Perfil visible del usuario autenticado; no almacena credenciales.';

create table public.pharmacy_memberships (
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'buyer'
    check (role in ('owner', 'buyer', 'viewer')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  primary key (pharmacy_id, user_id)
);

comment on table public.pharmacy_memberships is
  'Relación y rol de cada usuario dentro de una farmacia.';

create index pharmacy_memberships_user_id_idx
  on public.pharmacy_memberships(user_id);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  name text not null,
  address text not null,
  commune text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 2 and 120),
  check (char_length(trim(address)) between 5 and 240),
  check (char_length(trim(commune)) between 2 and 100)
);

comment on table public.branches is
  'Sucursales y direcciones operativas de cada farmacia.';

create index branches_pharmacy_id_idx
  on public.branches(pharmacy_id);

alter table public.pharmacies enable row level security;
alter table public.profiles enable row level security;
alter table public.pharmacy_memberships enable row level security;
alter table public.branches enable row level security;

revoke all on public.pharmacies from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
revoke all on public.pharmacy_memberships from anon, authenticated;
revoke all on public.branches from anon, authenticated;

grant select on public.pharmacies to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, updated_at) on public.profiles to authenticated;
grant select on public.pharmacy_memberships to authenticated;
grant select on public.branches to authenticated;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy memberships_select_own
  on public.pharmacy_memberships
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy pharmacies_select_active_membership
  on public.pharmacies
  for select
  to authenticated
  using (
    status = 'active'
    and exists (
      select 1
      from public.pharmacy_memberships membership
      where membership.pharmacy_id = pharmacies.id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

create policy branches_select_active_membership
  on public.branches
  for select
  to authenticated
  using (
    active is true
    and exists (
      select 1
      from public.pharmacy_memberships membership
      join public.pharmacies pharmacy
        on pharmacy.id = membership.pharmacy_id
      where membership.pharmacy_id = branches.pharmacy_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and pharmacy.status = 'active'
    )
  );
