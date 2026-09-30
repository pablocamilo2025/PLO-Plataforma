-- Initial inbound inbox. Only server functions may read/write this data.
create table public.whatsapp_conversations (
 id uuid primary key default gen_random_uuid(),
 phone_number_id text not null,
 wa_id text not null check (wa_id ~ '^[0-9]{5,20}$'),
 display_name text not null default '',
 pharmacy_id uuid references public.pharmacies(id) on delete set null,
 status text not null default 'pending' check (status in ('pending','resolved')),
 last_message_at timestamptz not null,
 last_message_id text not null,
 last_preview text not null,
 resolved_at timestamptz,
 resolved_by uuid references auth.users(id) on delete set null,
 unique(phone_number_id,wa_id)
);
create index whatsapp_conversations_recent on public.whatsapp_conversations(last_message_at desc);
create index whatsapp_conversations_pharmacy on public.whatsapp_conversations(pharmacy_id);
create index whatsapp_conversations_resolver on public.whatsapp_conversations(resolved_by);
create table public.whatsapp_messages (
 id text primary key,
 conversation_id uuid not null references public.whatsapp_conversations(id),
 kind text not null,
 body text not null,
 sent_at timestamptz not null,
 received_at timestamptz not null default now()
);
create index whatsapp_messages_conversation on public.whatsapp_messages(conversation_id,sent_at desc,id);
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_conversations,public.whatsapp_messages from public,anon,authenticated;
grant select,insert,update on public.whatsapp_conversations,public.whatsapp_messages to service_role;

create function public.receive_whatsapp_message(p_phone text,p_sender text,p_name text,p_id text,p_kind text,p_body text,p_sent_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare cid uuid;
begin
 -- Serialize a contact's deliveries, including duplicate notifications.
 perform pg_advisory_xact_lock(hashtextextended(p_phone || ':' || p_sender,0));
 if exists(select 1 from public.whatsapp_messages where id=p_id) then return; end if;
 insert into public.whatsapp_conversations(phone_number_id,wa_id,display_name,last_message_at,last_message_id,last_preview)
 values(p_phone,p_sender,p_name,p_sent_at,p_id,left(p_body,180))
 on conflict(phone_number_id,wa_id) do update set
 display_name=case when excluded.display_name<>'' then excluded.display_name else whatsapp_conversations.display_name end,
 status=case when whatsapp_conversations.resolved_at is null or excluded.last_message_at>whatsapp_conversations.resolved_at then 'pending' else whatsapp_conversations.status end,
 last_message_id=case when excluded.last_message_at>=whatsapp_conversations.last_message_at then excluded.last_message_id else whatsapp_conversations.last_message_id end,
 last_preview=case when excluded.last_message_at>=whatsapp_conversations.last_message_at then excluded.last_preview else whatsapp_conversations.last_preview end,
 last_message_at=greatest(excluded.last_message_at,whatsapp_conversations.last_message_at)
 returning id into cid;
 insert into public.whatsapp_messages(id,conversation_id,kind,body,sent_at) values(p_id,cid,p_kind,p_body,p_sent_at);
end $$;
revoke all on function public.receive_whatsapp_message(text,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.receive_whatsapp_message(text,text,text,text,text,text,timestamptz) to service_role;
