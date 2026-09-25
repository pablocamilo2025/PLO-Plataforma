-- Internal functions: the Edge Function authenticates the operator and checks
-- portal_admin using getUser(). Clients have no EXECUTE privileges here.
create table public.order_admin_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('confirm_payment','prepare','dispatch','deliver','cancel')),
  previous_status text not null,
  new_status text not null,
  note text not null check (char_length(note) between 3 and 500),
  created_at timestamptz not null default now()
);
create index order_admin_events_order_idx on public.order_admin_events(order_id, id);
create index order_admin_events_actor_idx on public.order_admin_events(actor_id);
alter table public.order_admin_events enable row level security;
revoke all on public.order_admin_events from public, anon, authenticated;
grant select, insert on public.order_admin_events to service_role;
grant usage on sequence public.order_admin_events_id_seq to service_role;

create function public.admin_list_portal_orders(p_search text default '', p_status text default 'all', p_page integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select o.id, o.order_number, o.status, o.payment_status, o.payment_method,
      o.grand_total, o.created_at, o.expires_at, o.updated_at,
      p.display_name as pharmacy_name, p.rut as pharmacy_rut
    from public.orders o join public.pharmacies p on p.id = o.pharmacy_id
    where (p_status = 'all' or o.status = p_status)
      and (coalesce(p_search,'') = '' or position(lower(p_search) in lower(o.order_number || ' ' || p.display_name || ' ' || p.rut)) > 0)
  ), page_rows as (
    select * from filtered order by created_at desc, id desc
    limit 25 offset greatest(0,least(coalesce(p_page,0),100000))*25
  )
  select jsonb_build_object(
    'orders', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total', (select count(*) from filtered),
    'stats', (select jsonb_build_object(
      'pending',count(*) filter(where status='awaiting_payment'),
      'processing',count(*) filter(where status in ('submitted','confirmed','preparing','in_transit')),
      'delivered',count(*) filter(where status='delivered')
    ) from public.orders)
  );
$$;
revoke all on function public.admin_list_portal_orders(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_list_portal_orders(text,text,integer) to service_role;

create function public.admin_update_portal_order(
  p_order_id bigint, p_actor_id uuid, p_action text, p_expected_updated_at timestamptz, p_note text
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.orders%rowtype;
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
      v_next := 'confirmed';
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
revoke all on function public.admin_update_portal_order(bigint,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.admin_update_portal_order(bigint,uuid,text,timestamptz,text) to service_role;
