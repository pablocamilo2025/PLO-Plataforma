-- Operational warehouse workflow. All RPCs are service-role only and are
-- called after the Edge Function validates the operator's app_metadata role.
alter table public.orders drop constraint orders_status_valid;
alter table public.orders add constraint orders_status_valid check (
  status in ('awaiting_payment','submitted','confirmed','preparing','ready_for_dispatch','in_transit','delivered','cancelled')
);

alter table public.order_admin_events drop constraint order_admin_events_action_check;
alter table public.order_admin_events add constraint order_admin_events_action_check check (
  action in ('confirm_payment','reject_receipt','prepare','ready_for_dispatch','dispatch','deliver','cancel')
);

create or replace function public.warehouse_list_portal_orders(
  p_search text default '', p_status text default 'all'
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with operational as (
    select o.id,o.order_number,o.status,o.payment_status,o.payment_method,o.created_at,o.updated_at,o.expires_at,
      p.display_name as pharmacy_name,p.rut as pharmacy_rut,
      (select count(*) from public.order_items oi where oi.order_id=o.id) as product_lines,
      (select coalesce(sum(oi.quantity),0) from public.order_items oi where oi.order_id=o.id) as total_units
    from public.orders o join public.pharmacies p on p.id=o.pharmacy_id
    where o.status in ('confirmed','preparing','ready_for_dispatch','in_transit')
      or (o.status='awaiting_payment' and o.payment_method='cash' and o.payment_status='pending')
      or (o.status='delivered' and o.updated_at >= current_date)
  ), filtered as (
    select * from operational
    where (p_status='all'
      or (p_status='new' and (status='confirmed' or (status='awaiting_payment' and payment_method='cash')))
      or status=p_status)
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(order_number||' '||pharmacy_name||' '||pharmacy_rut))>0)
  )
  select jsonb_build_object(
    'orders',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from filtered f),'[]'::jsonb),
    'stats',jsonb_build_object(
      'new',(select count(*) from operational where status='confirmed' or (status='awaiting_payment' and payment_method='cash')),
      'preparing',(select count(*) from operational where status='preparing'),
      'ready',(select count(*) from operational where status='ready_for_dispatch'),
      'inTransit',(select count(*) from operational where status='in_transit'),
      'deliveredToday',(select count(*) from operational where status='delivered')
    )
  );
$$;
revoke all on function public.warehouse_list_portal_orders(text,text) from public,anon,authenticated;
grant execute on function public.warehouse_list_portal_orders(text,text) to service_role;

create or replace function public.admin_list_portal_orders(p_search text default '',p_status text default 'all',p_page integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
  with filtered as (
    select o.id,o.order_number,o.status,o.payment_status,o.payment_method,o.grand_total,o.created_at,o.expires_at,o.updated_at,
      p.display_name as pharmacy_name,p.rut as pharmacy_rut
    from public.orders o join public.pharmacies p on p.id=o.pharmacy_id
    where (p_status='all' or o.status=p_status)
      and (coalesce(p_search,'')='' or position(lower(p_search) in lower(o.order_number||' '||p.display_name||' '||p.rut))>0)
  ), page_rows as (
    select * from filtered order by created_at desc,id desc limit 25 offset greatest(0,least(coalesce(p_page,0),100000))*25
  )
  select jsonb_build_object(
    'orders',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'stats',(select jsonb_build_object(
      'pending',count(*) filter(where payment_status='pending' and status not in ('cancelled','delivered')),
      'processing',count(*) filter(where status in ('submitted','confirmed','preparing','ready_for_dispatch','in_transit')),
      'delivered',count(*) filter(where status='delivered')
    ) from public.orders)
  );
$$;
revoke all on function public.admin_list_portal_orders(text,text,integer) from public,anon,authenticated;
grant execute on function public.admin_list_portal_orders(text,text,integer) to service_role;

create function public.warehouse_update_portal_order(
  p_order_id bigint,p_actor_id uuid,p_action text,p_expected_updated_at timestamptz,p_note text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_next text;
begin
  if p_actor_id is null or char_length(trim(coalesce(p_note,''))) not between 3 and 500 then
    raise exception 'PLO_INVALID_ACTION';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'PLO_ORDER_NOT_FOUND'; end if;
  if p_expected_updated_at is null or v_order.updated_at<>p_expected_updated_at then raise exception 'PLO_ORDER_CHANGED'; end if;

  case p_action
    when 'prepare' then
      if v_order.status='confirmed' and v_order.payment_status='paid' then
        v_next:='preparing';
      elsif v_order.status='awaiting_payment' and v_order.payment_method='cash' and v_order.payment_status='pending' then
        if v_order.expires_at<=now() then raise exception 'PLO_RESERVATION_EXPIRED'; end if;
        v_next:='preparing';
      else raise exception 'PLO_INVALID_TRANSITION'; end if;
    when 'ready_for_dispatch' then
      if v_order.status<>'preparing' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next:='ready_for_dispatch';
    when 'dispatch' then
      if v_order.status<>'ready_for_dispatch' or v_order.payment_status<>'paid' or v_order.payment_method='cash' then
        raise exception 'PLO_INVALID_TRANSITION';
      end if;
      v_next:='in_transit';
    when 'deliver' then
      if v_order.payment_status<>'paid' or not (
        v_order.status='in_transit' or (v_order.status='ready_for_dispatch' and v_order.payment_method='cash')
      ) then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next:='delivered';
    else raise exception 'PLO_INVALID_ACTION';
  end case;

  update public.orders set status=v_next,updated_at=clock_timestamp() where id=v_order.id;
  insert into public.order_admin_events(order_id,actor_id,action,previous_status,new_status,note)
  values(v_order.id,p_actor_id,p_action,v_order.status,v_next,trim(p_note));
  return jsonb_build_object('status',v_next,'orderNumber',v_order.order_number);
end;
$$;
revoke all on function public.warehouse_update_portal_order(bigint,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.warehouse_update_portal_order(bigint,uuid,text,timestamptz,text) to service_role;

create or replace function public.admin_update_portal_order(
  p_order_id bigint,p_actor_id uuid,p_action text,p_expected_updated_at timestamptz,p_note text
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_receipt public.payment_receipts%rowtype;
  v_next text;
  v_item record;
begin
  if p_actor_id is null or p_note is null or char_length(trim(p_note)) not between 3 and 500 then raise exception 'PLO_INVALID_ACTION'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'PLO_ORDER_NOT_FOUND'; end if;
  if p_expected_updated_at is null or v_order.updated_at<>p_expected_updated_at then raise exception 'PLO_ORDER_CHANGED'; end if;
  case p_action
    when 'confirm_payment' then
      if v_order.payment_status<>'pending' or v_order.payment_method not in ('cash','bank_transfer') then raise exception 'PLO_INVALID_TRANSITION'; end if;
      if v_order.payment_method='bank_transfer' then
        if v_order.status<>'awaiting_payment' then raise exception 'PLO_INVALID_TRANSITION'; end if;
        select * into v_receipt from public.payment_receipts where order_id=v_order.id for update;
        if not found or v_receipt.status<>'pending_review' then raise exception 'PLO_RECEIPT_REQUIRED'; end if;
        v_next:='confirmed';
      else
        if v_order.status not in ('awaiting_payment','preparing','ready_for_dispatch') then raise exception 'PLO_INVALID_TRANSITION'; end if;
        v_next:=case when v_order.status='awaiting_payment' then 'confirmed' else v_order.status end;
      end if;
      if v_order.expires_at<=now() then raise exception 'PLO_RESERVATION_EXPIRED'; end if;
    when 'reject_receipt' then
      if v_order.status<>'awaiting_payment' or v_order.payment_status<>'pending' or v_order.payment_method<>'bank_transfer' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      if v_order.expires_at<=now() then raise exception 'PLO_RESERVATION_EXPIRED'; end if;
      select * into v_receipt from public.payment_receipts where order_id=v_order.id for update;
      if not found or v_receipt.status<>'pending_review' then raise exception 'PLO_RECEIPT_REQUIRED'; end if;
      v_next:=v_order.status;
    when 'prepare' then
      if v_order.status<>'confirmed' or v_order.payment_status<>'paid' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next:='preparing';
    when 'dispatch' then
      if v_order.status not in ('preparing','ready_for_dispatch') or v_order.payment_status<>'paid' or v_order.payment_method='cash' then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next:='in_transit';
    when 'deliver' then
      if v_order.payment_status<>'paid' or not (v_order.status='in_transit' or (v_order.status in ('confirmed','preparing','ready_for_dispatch') and v_order.payment_method='cash')) then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next:='delivered';
    when 'cancel' then
      if v_order.payment_status<>'pending' or not (
        v_order.status='awaiting_payment' or (v_order.payment_method='cash' and v_order.status in ('preparing','ready_for_dispatch'))
      ) then raise exception 'PLO_INVALID_TRANSITION'; end if;
      v_next:='cancelled';
      for v_item in select catalog_item_id,quantity from public.order_items where order_id=v_order.id order by catalog_item_id loop
        update public.catalog_items set stock=stock+v_item.quantity,updated_at=clock_timestamp() where id=v_item.catalog_item_id;
        insert into public.inventory_movements(catalog_item_id,order_id,movement_type,quantity_change)
        values(v_item.catalog_item_id,v_order.id,'release',v_item.quantity);
      end loop;
    else raise exception 'PLO_INVALID_ACTION';
  end case;

  if p_action='confirm_payment' and v_order.payment_method='bank_transfer' then
    update public.payment_receipts set status='approved',rejection_reason=null,reviewed_by=p_actor_id,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where order_id=v_order.id;
  elsif p_action='reject_receipt' then
    update public.payment_receipts set status='rejected',rejection_reason=trim(p_note),reviewed_by=p_actor_id,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where order_id=v_order.id;
  end if;
  update public.orders set status=v_next,
    payment_status=case when p_action='confirm_payment' then 'paid' else payment_status end,
    payment_reference=case when p_action='confirm_payment' then trim(p_note) else payment_reference end,
    updated_at=clock_timestamp() where id=v_order.id;
  insert into public.order_admin_events(order_id,actor_id,action,previous_status,new_status,note)
  values(v_order.id,p_actor_id,p_action,v_order.status,v_next,trim(p_note));
  return jsonb_build_object('status',v_next,'orderNumber',v_order.order_number);
end;
$$;
revoke all on function public.admin_update_portal_order(bigint,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.admin_update_portal_order(bigint,uuid,text,timestamptz,text) to service_role;
