-- Private transfer receipts. Customers can read the metadata for their own
-- pharmacy, while file uploads and administrative review run through Edge
-- Functions using the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts',
  'payment-receipts',
  false,
  6291456,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null unique references public.orders(id) on delete restrict,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'pending_review',
  rejection_reason text,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_receipts_storage_path_format check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9]+/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
  ),
  constraint payment_receipts_original_name_length check (
    char_length(trim(original_name)) between 1 and 180
  ),
  constraint payment_receipts_mime_type_check check (
    mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ),
  constraint payment_receipts_size_check check (size_bytes between 1 and 6291456),
  constraint payment_receipts_status_check check (
    status in ('pending_review', 'approved', 'rejected')
  ),
  constraint payment_receipts_review_state_check check (
    (status = 'pending_review' and reviewed_by is null and reviewed_at is null and rejection_reason is null)
    or (status = 'approved' and reviewed_by is not null and reviewed_at is not null and rejection_reason is null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null
      and char_length(trim(rejection_reason)) between 3 and 500)
  )
);

create index payment_receipts_uploaded_by_idx on public.payment_receipts(uploaded_by);
create index payment_receipts_reviewed_by_idx on public.payment_receipts(reviewed_by)
  where reviewed_by is not null;

alter table public.payment_receipts enable row level security;
revoke all on public.payment_receipts from public, anon, authenticated;
grant select on public.payment_receipts to authenticated;
grant select, insert, update, delete on public.payment_receipts to service_role;

create policy payment_receipts_pharmacy_select
on public.payment_receipts
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.pharmacy_memberships m on m.pharmacy_id = o.pharmacy_id
    join public.pharmacies p on p.id = o.pharmacy_id
    join public.profiles pr on pr.user_id = m.user_id
    where o.id = payment_receipts.order_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and p.status = 'active'
      and pr.status = 'active'
  )
);

create function public.upsert_payment_receipt_internal(
  p_user_id uuid,
  p_order_id bigint,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_order public.orders%rowtype;
  v_previous_path text;
  v_receipt public.payment_receipts%rowtype;
begin
  if p_user_id is null or p_order_id is null
    or p_storage_path !~ '^[0-9a-f-]{36}/[0-9]+/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
    or char_length(trim(coalesce(p_original_name, ''))) not between 1 and 180
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes not between 1 and 6291456 then
    raise exception 'PLO_INVALID_RECEIPT';
  end if;

  select o.* into v_order
  from public.orders o
  join public.pharmacy_memberships m on m.pharmacy_id = o.pharmacy_id
  join public.pharmacies p on p.id = o.pharmacy_id
  join public.profiles pr on pr.user_id = m.user_id
  where o.id = p_order_id
    and m.user_id = p_user_id
    and m.status = 'active'
    and p.status = 'active'
    and pr.status = 'active'
  for update of o;

  if not found then raise exception 'PLO_ACCESS_DENIED'; end if;
  if split_part(p_storage_path, '/', 1) <> v_order.pharmacy_id::text then
    raise exception 'PLO_ACCESS_DENIED';
  end if;
  if v_order.payment_method <> 'bank_transfer' then
    raise exception 'PLO_RECEIPT_NOT_ALLOWED';
  end if;
  if v_order.status <> 'awaiting_payment' or v_order.payment_status <> 'pending' then
    raise exception 'PLO_ORDER_CHANGED';
  end if;
  if v_order.expires_at <= now() then raise exception 'PLO_RESERVATION_EXPIRED'; end if;

  select storage_path into v_previous_path
  from public.payment_receipts
  where order_id = p_order_id
  for update;

  insert into public.payment_receipts (
    order_id, uploaded_by, storage_path, original_name, mime_type, size_bytes
  ) values (
    p_order_id, p_user_id, p_storage_path, trim(p_original_name), p_mime_type, p_size_bytes
  )
  on conflict (order_id) do update set
    uploaded_by = excluded.uploaded_by,
    storage_path = excluded.storage_path,
    original_name = excluded.original_name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    status = 'pending_review',
    rejection_reason = null,
    reviewed_by = null,
    reviewed_at = null,
    updated_at = clock_timestamp()
  returning * into v_receipt;

  return jsonb_build_object(
    'id', v_receipt.id,
    'status', v_receipt.status,
    'originalName', v_receipt.original_name,
    'updatedAt', v_receipt.updated_at,
    'previousPath', v_previous_path
  );
end;
$$;

revoke all on function public.upsert_payment_receipt_internal(uuid,bigint,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.upsert_payment_receipt_internal(uuid,bigint,text,text,text,bigint)
  to service_role;

alter table public.order_admin_events
  drop constraint order_admin_events_action_check;
alter table public.order_admin_events
  add constraint order_admin_events_action_check check (
    action in ('confirm_payment','reject_receipt','prepare','dispatch','deliver','cancel')
  );

create or replace function public.admin_update_portal_order(
  p_order_id bigint, p_actor_id uuid, p_action text, p_expected_updated_at timestamptz, p_note text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_next text;
  v_item record;
begin
  if p_actor_id is null or p_note is null or char_length(trim(p_note)) not between 3 and 500 then
    raise exception 'PLO_INVALID_ACTION';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'PLO_ORDER_NOT_FOUND'; end if;
  if p_expected_updated_at is null or v_order.updated_at <> p_expected_updated_at then
    raise exception 'PLO_ORDER_CHANGED';
  end if;
  case p_action
    when 'confirm_payment' then
      if v_order.status <> 'awaiting_payment' or v_order.payment_status <> 'pending'
        or v_order.payment_method not in ('cash','bank_transfer') then raise exception 'PLO_INVALID_TRANSITION'; end if;
      if v_order.expires_at <= now() then raise exception 'PLO_RESERVATION_EXPIRED'; end if;
      if v_order.payment_method = 'bank_transfer' then
        select * into v_receipt from public.payment_receipts where order_id=v_order.id for update;
        if not found or v_receipt.status <> 'pending_review' then raise exception 'PLO_RECEIPT_REQUIRED'; end if;
      end if;
      v_next := 'confirmed';
    when 'reject_receipt' then
      if v_order.status <> 'awaiting_payment' or v_order.payment_status <> 'pending'
        or v_order.payment_method <> 'bank_transfer' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      if v_order.expires_at <= now() then raise exception 'PLO_RESERVATION_EXPIRED'; end if;
      select * into v_receipt from public.payment_receipts where order_id=v_order.id for update;
      if not found or v_receipt.status <> 'pending_review' then raise exception 'PLO_RECEIPT_REQUIRED'; end if;
      v_next := v_order.status;
    when 'prepare' then
      if v_order.status <> 'confirmed' or v_order.payment_status <> 'paid' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next := 'preparing';
    when 'dispatch' then
      if v_order.status <> 'preparing' or v_order.payment_status <> 'paid' or v_order.payment_method='cash' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next := 'in_transit';
    when 'deliver' then
      if v_order.payment_status <> 'paid' or not (v_order.status='in_transit' or
        (v_order.status in ('confirmed','preparing') and v_order.payment_method='cash')) then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next := 'delivered';
    when 'cancel' then
      if v_order.status <> 'awaiting_payment' or v_order.payment_status <> 'pending' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next := 'cancelled';
      for v_item in select catalog_item_id, quantity from public.order_items where order_id=v_order.id order by catalog_item_id loop
        update public.catalog_items set stock=stock+v_item.quantity,updated_at=clock_timestamp() where id=v_item.catalog_item_id;
        insert into public.inventory_movements(catalog_item_id,order_id,movement_type,quantity_change)
        values(v_item.catalog_item_id,v_order.id,'release',v_item.quantity);
      end loop;
    else raise exception 'PLO_INVALID_ACTION';
  end case;

  if p_action = 'confirm_payment' and v_order.payment_method = 'bank_transfer' then
    update public.payment_receipts set
      status='approved', rejection_reason=null, reviewed_by=p_actor_id,
      reviewed_at=clock_timestamp(), updated_at=clock_timestamp()
    where order_id=v_order.id;
  elsif p_action = 'reject_receipt' then
    update public.payment_receipts set
      status='rejected', rejection_reason=trim(p_note), reviewed_by=p_actor_id,
      reviewed_at=clock_timestamp(), updated_at=clock_timestamp()
    where order_id=v_order.id;
  end if;

  update public.orders set status=v_next,
    payment_status=case when p_action='confirm_payment' then 'paid' else payment_status end,
    payment_reference=case when p_action='confirm_payment' then trim(p_note) else payment_reference end,
    updated_at=clock_timestamp()
  where id=v_order.id;
  insert into public.order_admin_events(order_id,actor_id,action,previous_status,new_status,note)
  values(v_order.id,p_actor_id,p_action,v_order.status,v_next,trim(p_note));
  return jsonb_build_object('status',v_next,'orderNumber',v_order.order_number);
end;
$$;

revoke all on function public.admin_update_portal_order(bigint,uuid,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.admin_update_portal_order(bigint,uuid,text,timestamptz,text)
  to service_role;
