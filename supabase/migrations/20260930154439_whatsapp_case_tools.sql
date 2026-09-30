create table public.whatsapp_notes (
 id uuid primary key,
 conversation_id uuid not null references public.whatsapp_conversations(id),
 actor_id uuid not null references auth.users(id),
 body text not null check(char_length(trim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index whatsapp_notes_conversation on public.whatsapp_notes(conversation_id,created_at desc);
create index whatsapp_notes_actor on public.whatsapp_notes(actor_id);
create table public.whatsapp_drafts (
 conversation_id uuid not null references public.whatsapp_conversations(id),
 actor_id uuid not null references auth.users(id),
 body text not null check(char_length(body)<=4096),
 revision integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(conversation_id,actor_id)
);
create index whatsapp_drafts_actor on public.whatsapp_drafts(actor_id);
create table public.whatsapp_links_audit (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.whatsapp_conversations(id),
 actor_id uuid not null references auth.users(id),
 previous_pharmacy_id uuid,
 pharmacy_id uuid,
 created_at timestamptz not null default now()
);
create index whatsapp_links_audit_conversation on public.whatsapp_links_audit(conversation_id,created_at desc);
create index whatsapp_links_audit_actor on public.whatsapp_links_audit(actor_id);
alter table public.whatsapp_notes enable row level security;
alter table public.whatsapp_drafts enable row level security;
alter table public.whatsapp_links_audit enable row level security;
revoke all on public.whatsapp_notes,public.whatsapp_drafts,public.whatsapp_links_audit from public,anon,authenticated;
grant select,insert on public.whatsapp_notes,public.whatsapp_links_audit to service_role;
grant select,insert,update on public.whatsapp_drafts to service_role;

create function public.save_whatsapp_draft(p_conversation uuid,p_actor uuid,p_body text,p_revision integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare next_revision integer;
begin
 if p_revision<0 or p_revision is null then raise exception 'INVALID_REVISION'; end if;
 if p_revision=0 then
  insert into public.whatsapp_drafts(conversation_id,actor_id,body) values(p_conversation,p_actor,p_body)
  on conflict do nothing returning revision into next_revision;
 else
  update public.whatsapp_drafts set body=p_body,revision=revision+1,updated_at=now()
  where conversation_id=p_conversation and actor_id=p_actor and revision=p_revision returning revision into next_revision;
 end if;
 if next_revision is null then raise exception 'DRAFT_CHANGED'; end if;
 return next_revision;
end $$;

create function public.link_whatsapp_pharmacy(p_conversation uuid,p_actor uuid,p_pharmacy uuid,p_expected uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare previous uuid;
begin
 select pharmacy_id into previous from public.whatsapp_conversations where id=p_conversation for update;
 if not found then raise exception 'CASE_NOT_FOUND';end if;
 if previous is distinct from p_expected then raise exception 'LINK_CHANGED';end if;
 if p_pharmacy is not null and not exists(select 1 from public.pharmacies where id=p_pharmacy and status='active') then raise exception 'PHARMACY_NOT_ACTIVE';end if;
 update public.whatsapp_conversations set pharmacy_id=p_pharmacy where id=p_conversation;
 insert into public.whatsapp_links_audit(conversation_id,actor_id,previous_pharmacy_id,pharmacy_id) values(p_conversation,p_actor,previous,p_pharmacy);
end $$;
revoke all on function public.save_whatsapp_draft(uuid,uuid,text,integer),public.link_whatsapp_pharmacy(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_whatsapp_draft(uuid,uuid,text,integer),public.link_whatsapp_pharmacy(uuid,uuid,uuid,uuid) to service_role;
