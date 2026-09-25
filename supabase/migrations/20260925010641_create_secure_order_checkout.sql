create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.catalog_items
  add column discount_percent smallint not null default 0,
  add constraint catalog_items_discount_percent_valid
    check (discount_percent between 0 and 100);

update public.catalog_items
set discount_percent = 15
where is_flash is true;

create sequence public.portal_order_number_seq start with 1000;
revoke all on sequence public.portal_order_number_seq from public, anon, authenticated;

alter table public.orders
  add column client_request_id uuid not null,
  add column expires_at timestamptz not null default (now() + interval '48 hours'),
  alter column order_number set default (
    'OC-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.portal_order_number_seq')::text, 6, '0')
  );

alter table public.orders drop constraint orders_status_valid;
alter table public.orders
  add constraint orders_status_valid check (
    status in (
      'awaiting_payment', 'submitted', 'confirmed', 'preparing',
      'in_transit', 'delivered', 'cancelled'
    )
  );

create unique index orders_pharmacy_client_request_idx
  on public.orders (pharmacy_id, client_request_id);
create index orders_expiring_reservations_idx
  on public.orders (expires_at, id)
  where status = 'awaiting_payment' and payment_status = 'pending';

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  catalog_item_id bigint not null
    references public.catalog_items(id) on delete restrict,
  order_id bigint not null
    references public.orders(id) on delete restrict,
  movement_type text not null,
  quantity_change integer not null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_type_valid check (
    movement_type in ('reservation', 'release', 'manual_adjustment')
  ),
  constraint inventory_movements_quantity_nonzero check (quantity_change <> 0)
);

comment on table public.inventory_movements is
  'Auditoría de cada reserva, liberación o ajuste del stock del Portal PLO.';

create index inventory_movements_catalog_item_idx
  on public.inventory_movements (catalog_item_id, created_at desc);
create index inventory_movements_order_id_idx
  on public.inventory_movements (order_id);

alter table public.inventory_movements enable row level security;
revoke all on table public.inventory_movements from public, anon, authenticated;

create or replace function public.place_portal_order_internal(
  p_user_id uuid,
  p_pharmacy_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_existing public.orders%rowtype;
  v_product public.catalog_items%rowtype;
  v_item record;
  v_membership_role text;
  v_unit_price integer;
  v_net_total bigint := 0;
  v_tax_total integer;
  v_grand_total integer;
begin
  perform set_config('statement_timeout', '5000', true);

  if p_user_id is null or p_pharmacy_id is null or p_client_request_id is null then
    raise exception using errcode = 'P0001', message = 'PLO_INVALID_REQUEST';
  end if;

  if p_payment_method not in ('cash', 'bank_transfer') then
    raise exception using errcode = 'P0001', message = 'PLO_PAYMENT_METHOD_UNAVAILABLE';
  end if;

  select membership.role
  into v_membership_role
  from public.pharmacy_memberships membership
  join public.pharmacies pharmacy on pharmacy.id = membership.pharmacy_id
  join public.profiles profile on profile.user_id = membership.user_id
  where membership.user_id = p_user_id
    and membership.pharmacy_id = p_pharmacy_id
    and membership.status = 'active'
    and membership.role in ('owner', 'buyer')
    and pharmacy.status = 'active'
    and profile.status = 'active';

  if v_membership_role is null then
    raise exception using errcode = 'P0001', message = 'PLO_ACCESS_DENIED';
  end if;

  select *
  into v_existing
  from public.orders portal_order
  where portal_order.pharmacy_id = p_pharmacy_id
    and portal_order.client_request_id = p_client_request_id;

  if found then
    return jsonb_build_object(
      'orderNumber', v_existing.order_number,
      'netTotal', v_existing.net_total,
      'taxTotal', v_existing.tax_total,
      'grandTotal', v_existing.grand_total,
      'status', v_existing.status,
      'paymentStatus', v_existing.payment_status,
      'paymentMethod', v_existing.payment_method,
      'expiresAt', v_existing.expires_at,
      'duplicate', true
    );
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 50 then
    raise exception using errcode = 'P0001', message = 'PLO_INVALID_ITEMS';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item->>'catalog_item_id', '') !~ '^[0-9]+$'
      or coalesce(item->>'quantity', '') !~ '^[0-9]+$'
      or (item->>'quantity')::bigint < 1
      or (item->>'quantity')::bigint > 100000
  ) then
    raise exception using errcode = 'P0001', message = 'PLO_INVALID_ITEMS';
  end if;

  insert into public.orders (
    pharmacy_id,
    placed_by,
    status,
    payment_status,
    payment_method,
    client_request_id,
    net_total,
    tax_total,
    grand_total
  ) values (
    p_pharmacy_id,
    p_user_id,
    'awaiting_payment',
    'pending',
    p_payment_method,
    p_client_request_id,
    0,
    0,
    0
  )
  returning * into v_order;

  for v_item in
    select
      input.catalog_item_id,
      sum(input.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as input(
      catalog_item_id bigint,
      quantity integer
    )
    group by input.catalog_item_id
    order by input.catalog_item_id
  loop
    select *
    into v_product
    from public.catalog_items product
    where product.id = v_item.catalog_item_id
      and product.is_active is true
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'PLO_PRODUCT_UNAVAILABLE';
    end if;

    if v_item.quantity > v_product.max_order_quantity then
      raise exception using errcode = 'P0001', message = 'PLO_MAX_QUANTITY';
    end if;

    if v_item.quantity > v_product.stock then
      raise exception using errcode = 'P0001', message = 'PLO_STOCK_INSUFFICIENT';
    end if;

    v_unit_price := round(
      v_product.net_price * (100 - v_product.discount_percent) / 100.0
    )::integer;
    v_net_total := v_net_total + (v_unit_price::bigint * v_item.quantity);

    if v_net_total > 1800000000 then
      raise exception using errcode = 'P0001', message = 'PLO_ORDER_TOTAL_TOO_LARGE';
    end if;

    insert into public.order_items (
      order_id,
      catalog_item_id,
      sku,
      product_name,
      laboratory,
      lot_code,
      unit_net_price,
      quantity
    ) values (
      v_order.id,
      v_product.id,
      v_product.sku,
      v_product.name,
      v_product.laboratory,
      v_product.lot_code,
      v_unit_price,
      v_item.quantity
    );

    update public.catalog_items
    set stock = stock - v_item.quantity,
        updated_at = now()
    where id = v_product.id;

    insert into public.inventory_movements (
      catalog_item_id,
      order_id,
      movement_type,
      quantity_change
    ) values (
      v_product.id,
      v_order.id,
      'reservation',
      -v_item.quantity
    );
  end loop;

  v_tax_total := round(v_net_total * 0.19)::integer;
  v_grand_total := v_net_total::integer + v_tax_total;

  update public.orders
  set net_total = v_net_total::integer,
      tax_total = v_tax_total,
      grand_total = v_grand_total,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  return jsonb_build_object(
    'orderNumber', v_order.order_number,
    'netTotal', v_order.net_total,
    'taxTotal', v_order.tax_total,
    'grandTotal', v_order.grand_total,
    'status', v_order.status,
    'paymentStatus', v_order.payment_status,
    'paymentMethod', v_order.payment_method,
    'expiresAt', v_order.expires_at,
    'duplicate', false
  );
exception
  when unique_violation then
    select *
    into v_existing
    from public.orders portal_order
    where portal_order.pharmacy_id = p_pharmacy_id
      and portal_order.client_request_id = p_client_request_id;

    if found then
      return jsonb_build_object(
        'orderNumber', v_existing.order_number,
        'netTotal', v_existing.net_total,
        'taxTotal', v_existing.tax_total,
        'grandTotal', v_existing.grand_total,
        'status', v_existing.status,
        'paymentStatus', v_existing.payment_status,
        'paymentMethod', v_existing.payment_method,
        'expiresAt', v_existing.expires_at,
        'duplicate', true
      );
    end if;
    raise;
end;
$$;

revoke all on function public.place_portal_order_internal(
  uuid, uuid, jsonb, text, uuid
) from public, anon, authenticated;
grant execute on function public.place_portal_order_internal(
  uuid, uuid, jsonb, text, uuid
) to service_role;

grant usage on sequence public.portal_order_number_seq to service_role;
grant usage on sequence public.orders_id_seq to service_role;
grant usage on sequence public.order_items_id_seq to service_role;
grant usage on sequence public.inventory_movements_id_seq to service_role;
grant select, update on table public.catalog_items to service_role;
grant select, insert, update on table public.orders to service_role;
grant select, insert on table public.order_items to service_role;
grant insert on table public.inventory_movements to service_role;

create or replace function private.release_expired_portal_orders(
  p_limit integer default 100
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order record;
  v_item record;
  v_released integer := 0;
begin
  perform set_config('statement_timeout', '10000', true);

  for v_order in
    select portal_order.id
    from public.orders portal_order
    where portal_order.status = 'awaiting_payment'
      and portal_order.payment_status = 'pending'
      and portal_order.expires_at <= now()
    order by portal_order.expires_at, portal_order.id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    for v_item in
      select item.catalog_item_id, item.quantity
      from public.order_items item
      where item.order_id = v_order.id
      order by item.catalog_item_id
    loop
      update public.catalog_items
      set stock = stock + v_item.quantity,
          updated_at = now()
      where id = v_item.catalog_item_id;

      insert into public.inventory_movements (
        catalog_item_id,
        order_id,
        movement_type,
        quantity_change
      ) values (
        v_item.catalog_item_id,
        v_order.id,
        'release',
        v_item.quantity
      );
    end loop;

    update public.orders
    set status = 'cancelled',
        updated_at = now()
    where id = v_order.id;

    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

revoke all on function private.release_expired_portal_orders(integer)
  from public, anon, authenticated, service_role;

create extension if not exists pg_cron;

select cron.schedule(
  'release-expired-portal-orders',
  '*/5 * * * *',
  $$select private.release_expired_portal_orders(100);$$
);
