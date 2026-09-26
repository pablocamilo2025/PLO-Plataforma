-- Service-only payment ledger. No browser may read or write provider data.
create table public.khipu_payments (
  order_id bigint primary key references public.orders(id) on delete restrict,
  transaction_id uuid not null unique default gen_random_uuid(),
  payment_id text unique check (payment_id ~ '^[a-zA-Z0-9]{12}$'),
  payment_url text,
  receiver_id text not null check (receiver_id ~ '^[1-9][0-9]*$'),
  mode text not null check (mode in ('development','production')),
  amount integer not null check (amount > 0),
  currency text not null default 'CLP' check (currency = 'CLP'),
  expires_at timestamptz not null,
  status text not null default 'creating' check (status in ('creating','pending','unknown','paid','review')),
  conciliation_date timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.khipu_payments enable row level security;
revoke all on public.khipu_payments from public, anon, authenticated;
grant select, insert, update on public.khipu_payments to service_role;
create index khipu_payments_review_idx on public.khipu_payments(status, updated_at)
  where status in ('unknown','review','creating');

alter table public.orders drop constraint orders_status_valid;
alter table public.orders add constraint orders_status_valid check (
  status in ('awaiting_payment','submitted','confirmed','preparing','ready_for_dispatch','in_transit','delivered','cancelled','payment_review')
);

create function public.claim_khipu_payment(p_user_id uuid, p_order_number text, p_receiver_id text, p_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype; p public.khipu_payments%rowtype;
begin
  select * into o from public.orders where order_number=p_order_number for update;
  if not found or not exists (
    select 1 from public.pharmacy_memberships m
    join public.pharmacies f on f.id=m.pharmacy_id
    join public.profiles u on u.user_id=m.user_id
    where m.user_id=p_user_id and m.pharmacy_id=o.pharmacy_id
      and m.status='active' and m.role in ('owner','buyer') and f.status='active' and u.status='active'
  ) then raise exception 'PLO_ACCESS_DENIED'; end if;
  if o.payment_method<>'khipu' or o.status<>'awaiting_payment' or o.payment_status<>'pending'
    or o.expires_at<=now() or o.grand_total<=0 then raise exception 'PLO_ORDER_NOT_PAYABLE'; end if;
  select * into p from public.khipu_payments where order_id=o.id;
  if found then
    if p.receiver_id<>p_receiver_id or p.mode<>p_mode then raise exception 'PLO_PAYMENT_ACCOUNT_CHANGED'; end if;
    return jsonb_build_object('create',false,'status',p.status,'payment_url',p.payment_url);
  end if;
  insert into public.khipu_payments(order_id,receiver_id,mode,amount,expires_at)
    values(o.id,p_receiver_id,p_mode,o.grand_total,o.expires_at) returning * into p;
  return jsonb_build_object('create',true,'transaction_id',p.transaction_id,'amount',p.amount,'expires_at',p.expires_at);
end;
$$;

create function public.attach_khipu_payment(p_transaction_id uuid, p_payment_id text, p_payment_url text)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.khipu_payments%rowtype;
begin
  select * into p from public.khipu_payments where transaction_id=p_transaction_id for update;
  if not found then raise exception 'PLO_PAYMENT_NOT_FOUND'; end if;
  if p.payment_id is not null and p.payment_id<>p_payment_id then raise exception 'PLO_PAYMENT_MISMATCH'; end if;
  update public.khipu_payments set payment_id=p_payment_id,payment_url=p_payment_url,
    status=case when status in ('creating','unknown') then 'pending' else status end,
    updated_at=clock_timestamp() where transaction_id=p_transaction_id;
end;
$$;

create function public.mark_khipu_payment_unknown(p_transaction_id uuid)
returns void language sql security invoker set search_path='' as $$
  update public.khipu_payments set status='unknown',updated_at=clock_timestamp()
  where transaction_id=p_transaction_id and status='creating';
$$;

create function public.settle_khipu_payment(
  p_transaction_id uuid,p_payment_id text,p_receiver_id text,p_amount integer,p_currency text,
  p_conciliation_date timestamptz,p_late boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders%rowtype; p public.khipu_payments%rowtype; v_order_id bigint; v_review boolean;
begin
  -- Same lock order as checkout, admin cancellation and reservation expiry.
  select order_id into v_order_id from public.khipu_payments where transaction_id=p_transaction_id;
  if not found then raise exception 'PLO_PAYMENT_NOT_FOUND'; end if;
  select * into o from public.orders where id=v_order_id for update;
  select * into p from public.khipu_payments where transaction_id=p_transaction_id for update;
  if p_payment_id is null or p_payment_id !~ '^[a-zA-Z0-9]{12}$'
    or p.receiver_id is distinct from p_receiver_id or p.amount is distinct from p_amount
    or p.currency is distinct from p_currency or p_conciliation_date is null or p_late is null
    or (p.payment_id is not null and p.payment_id<>p_payment_id)
    or o.payment_method<>'khipu' or o.grand_total<>p_amount then raise exception 'PLO_PAYMENT_MISMATCH'; end if;
  if p.status in ('paid','review') then
    return jsonb_build_object('status',p.status,'duplicate',true);
  end if;
  v_review := p_late or o.status<>'awaiting_payment' or o.payment_status<>'pending'
    or o.expires_at<=now() or p_conciliation_date>o.expires_at;
  update public.khipu_payments set payment_id=p_payment_id,
    status=case when v_review then 'review' else 'paid' end,
    conciliation_date=p_conciliation_date,
    review_reason=case when v_review then 'late_or_inactive_reservation' else null end,
    updated_at=clock_timestamp() where order_id=o.id;
  -- Paid but late is held for review; never re-reserve released inventory or dispatch automatically.
  update public.orders set payment_status='paid',payment_reference=p_payment_id,
    status=case when v_review then 'payment_review' else 'confirmed' end,
    updated_at=clock_timestamp() where id=o.id;
  return jsonb_build_object('status',case when v_review then 'review' else 'paid' end,'duplicate',false);
end;
$$;

revoke all on function public.claim_khipu_payment(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.attach_khipu_payment(uuid,text,text) from public,anon,authenticated;
revoke all on function public.mark_khipu_payment_unknown(uuid) from public,anon,authenticated;
revoke all on function public.settle_khipu_payment(uuid,text,text,integer,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.claim_khipu_payment(uuid,text,text,text) to service_role;
grant execute on function public.attach_khipu_payment(uuid,text,text) to service_role;
grant execute on function public.mark_khipu_payment_unknown(uuid) to service_role;
grant execute on function public.settle_khipu_payment(uuid,text,text,integer,text,timestamptz,boolean) to service_role;

-- Price and reserve Khipu orders through the existing atomic checkout.
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

  if p_payment_method is null or p_payment_method not in ('cash', 'bank_transfer', 'khipu') then
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

