-- Verified telephone registry is managed only by the administrator API.
create table public.pharmacy_whatsapp_contacts (
 id uuid primary key default gen_random_uuid(),
 pharmacy_id uuid not null references public.pharmacies(id),
 phone text not null check(phone ~ '^[1-9][0-9]{6,14}$'),
 contact_name text not null check(char_length(trim(contact_name)) between 2 and 120),
 verified_by uuid not null references auth.users(id),
 verified_at timestamptz not null default now(),
 active boolean not null default true,
 unique(pharmacy_id,phone)
);
create index pharmacy_whatsapp_contacts_phone on public.pharmacy_whatsapp_contacts(phone) where active;
create index pharmacy_whatsapp_contacts_verifier on public.pharmacy_whatsapp_contacts(verified_by);
alter table public.pharmacy_whatsapp_contacts enable row level security;
revoke all on public.pharmacy_whatsapp_contacts from public,anon,authenticated;
grant select,insert,update on public.pharmacy_whatsapp_contacts to service_role;
alter table public.whatsapp_conversations add column link_mode text not null default 'none' check(link_mode in ('none','automatic','manual'));
update public.whatsapp_conversations set link_mode='manual' where pharmacy_id is not null;

create function public.match_whatsapp_contact(p_conversation uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.whatsapp_conversations; matches integer; target uuid;
begin
 select * into c from public.whatsapp_conversations where id=p_conversation for update;
 if not found then raise exception 'CASE_NOT_FOUND'; end if;
 select count(*), (array_agg(p.id))[1] into matches,target
 from public.pharmacy_whatsapp_contacts pc join public.pharmacies p on p.id=pc.pharmacy_id
 where pc.phone=c.wa_id and pc.active and p.status='active';
 if c.link_mode<>'manual' then
  update public.whatsapp_conversations set pharmacy_id=case when matches=1 then target else null end,
    link_mode=case when matches=1 then 'automatic' else 'none' end where id=c.id;
 end if;
 return jsonb_build_object('matches',matches,'manual',c.link_mode='manual');
end $$;
-- Run matching on receipt as well as when the operator opens the case.
alter function public.receive_whatsapp_message(text,text,text,text,text,text,timestamptz) rename to receive_whatsapp_message_unmatched;
create function public.receive_whatsapp_message(p_phone text,p_sender text,p_name text,p_id text,p_kind text,p_body text,p_sent_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare cid uuid;
begin
 perform public.receive_whatsapp_message_unmatched(p_phone,p_sender,p_name,p_id,p_kind,p_body,p_sent_at);
 select id into cid from public.whatsapp_conversations where phone_number_id=p_phone and wa_id=p_sender;
 perform public.match_whatsapp_contact(cid);
end $$;
create or replace function public.link_whatsapp_pharmacy(p_conversation uuid,p_actor uuid,p_pharmacy uuid,p_expected uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare previous uuid;
begin
 select pharmacy_id into previous from public.whatsapp_conversations where id=p_conversation for update;
 if not found then raise exception 'CASE_NOT_FOUND';end if;
 if previous is distinct from p_expected then raise exception 'LINK_CHANGED';end if;
 if p_pharmacy is not null and not exists(select 1 from public.pharmacies where id=p_pharmacy and status='active') then raise exception 'PHARMACY_NOT_ACTIVE';end if;
 update public.whatsapp_conversations set pharmacy_id=p_pharmacy,link_mode='manual' where id=p_conversation;
 insert into public.whatsapp_links_audit(conversation_id,actor_id,previous_pharmacy_id,pharmacy_id) values(p_conversation,p_actor,previous,p_pharmacy);
end $$;
revoke all on function public.match_whatsapp_contact(uuid),public.receive_whatsapp_message(text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.match_whatsapp_contact(uuid),public.receive_whatsapp_message(text,text,text,text,text,text,timestamptz) to service_role;

create table public.portal_cart_snapshots (
 pharmacy_id uuid not null references public.pharmacies(id),
 user_id uuid not null references auth.users(id),
 session_id uuid not null,
 items jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(pharmacy_id,user_id,session_id),
 check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=200)
);
create index portal_cart_snapshots_user on public.portal_cart_snapshots(user_id);
alter table public.portal_cart_snapshots enable row level security;
revoke all on public.portal_cart_snapshots from public,anon,authenticated;
grant select,insert,update on public.portal_cart_snapshots to authenticated;
grant select on public.portal_cart_snapshots to service_role;
create policy cart_owner on public.portal_cart_snapshots for all to authenticated
using(user_id=(select auth.uid()) and exists(select 1 from public.pharmacy_memberships m join public.pharmacies p on p.id=m.pharmacy_id join public.profiles pr on pr.user_id=m.user_id where m.pharmacy_id=portal_cart_snapshots.pharmacy_id and m.user_id=(select auth.uid()) and m.status='active' and p.status='active' and pr.status='active'))
with check(user_id=(select auth.uid()) and exists(select 1 from public.pharmacy_memberships m join public.pharmacies p on p.id=m.pharmacy_id join public.profiles pr on pr.user_id=m.user_id where m.pharmacy_id=portal_cart_snapshots.pharmacy_id and m.user_id=(select auth.uid()) and m.status='active' and p.status='active' and pr.status='active'));
create function public.validate_portal_cart_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
declare item jsonb;
begin
 if jsonb_typeof(new.items)<>'array' or jsonb_array_length(new.items)>200 then raise exception 'INVALID_CART';end if;
 for item in select value from jsonb_array_elements(new.items) loop
  if jsonb_typeof(item)<>'object' or not(item ? 'sku' and item ? 'quantity') or jsonb_typeof(item->'sku')<>'string' or item->>'sku' !~ '^PLO-[0-9]{4}$' or jsonb_typeof(item->'quantity')<>'number' or (item->>'quantity') !~ '^[1-9][0-9]{0,5}$' or item - 'sku' - 'quantity' <> '{}'::jsonb then raise exception 'INVALID_CART';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(new.items) i group by i->>'sku' having count(*)>1) then raise exception 'DUPLICATE_SKU';end if;
 new.updated_at=clock_timestamp();return new;
end $$;
revoke all on function public.validate_portal_cart_snapshot() from public,anon,authenticated;
create trigger validate_cart before insert or update on public.portal_cart_snapshots for each row execute function public.validate_portal_cart_snapshot();
