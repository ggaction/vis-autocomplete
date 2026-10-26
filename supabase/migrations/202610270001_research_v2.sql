-- Detailed recommendations research is separate from private workspace data.
-- The updated one-checkbox notice includes field names, chart text and search.
-- Existing explicit opt-ins continue; opt-outs and unknown choices stay off.
alter table public.profiles add column research_scopes jsonb not null default '{}'::jsonb;
alter table public.consent_history add column scopes jsonb not null default '{}'::jsonb;
create table public.research_participants (
  owner_id uuid primary key references auth.users on delete cascade,
  participant_id uuid unique not null default gen_random_uuid()
);
create table public.research_batches (
  id uuid primary key, participant_id uuid not null references public.research_participants(participant_id) on delete cascade,
  session_id uuid not null, consent_revision integer not null, is_guest boolean not null,
  protocol smallint not null check(protocol=2), release text not null check(length(release)<=200),
  client_time timestamptz not null, received_at timestamptz not null default now(),
  events jsonb not null, losses jsonb not null default '{}', first_sequence bigint not null,last_sequence bigint not null,
  unique(participant_id,session_id,first_sequence)
);
create index research_batches_session on public.research_batches(participant_id,session_id,first_sequence);
create index research_batches_participant_time on public.research_batches(participant_id,received_at);
create index research_batches_expiry on public.research_batches(received_at);
alter table public.research_participants enable row level security;
alter table public.research_batches enable row level security;
revoke all on public.research_participants,public.research_batches from anon,authenticated;
-- Analysts see pseudonymous IDs; the identity mapping has no client read grant.
create policy research_admin_read on public.research_batches for select to authenticated using(public.is_app_admin());
grant select on public.research_batches to authenticated;

create function public.set_research_consent_v2(enabled boolean,scopes jsonb default '{}') returns public.profiles
language plpgsql security definer set search_path='' as $$
declare result public.profiles; safe_scopes jsonb;
begin
  if auth.uid() is null or enabled is null then raise exception 'Authentication and a choice are required';end if;
  safe_scopes=jsonb_build_object('text',enabled);
  insert into public.profiles(id,research_enabled,consent_version,consent_revision,consent_at,research_scopes)
    values(auth.uid(),enabled,'recommendation-research-v2',1,now(),safe_scopes)
    on conflict(id) do update set research_enabled=excluded.research_enabled,consent_version=excluded.consent_version,
      consent_revision=public.profiles.consent_revision+1,consent_at=now(),updated_at=now(),research_scopes=excluded.research_scopes returning * into result;
  insert into public.consent_history(owner_id,enabled,version,revision,scopes) values(auth.uid(),enabled,result.consent_version,result.consent_revision,safe_scopes);
  return result;
end $$;

-- Wire trees contain only numbers, booleans, public dictionary indices and
-- random reference IDs. Arbitrary text lives in a separate consented envelope.
create function public.valid_research_tree(value jsonb,depth integer default 0) returns boolean
language plpgsql immutable set search_path='' as $$
declare tag integer; child jsonb; v jsonb;
begin
  if value is null then return false;end if;
  if depth>24 then return false;end if;
  if value='null'::jsonb or jsonb_typeof(value)='boolean' then return true;end if;
  if jsonb_typeof(value)<>'array' or jsonb_typeof(value->0)<>'number' then return false;end if;
  if (value->>0)::numeric<>trunc((value->>0)::numeric) then return false;end if;
  tag=(value->>0)::integer;v=value->1;
  if tag=0 then return jsonb_array_length(value)=2 and jsonb_typeof(v)='number' and abs((v#>>'{}')::numeric)<=1e12;end if;
  if tag=1 then return jsonb_array_length(value)=2 and jsonb_typeof(v)='number' and (v#>>'{}')::numeric=trunc((v#>>'{}')::numeric) and (v#>>'{}')::numeric between 0 and 1101;end if;
  if tag=2 then return jsonb_array_length(value)=2 and jsonb_typeof(v)='string' and v#>>'{}' ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$';end if;
  if tag=5 then return jsonb_array_length(value)=1;end if;
  if tag not in (3,4) or jsonb_typeof(v)<>'array' or jsonb_array_length(v)>512 then return false;end if;
  if tag=3 then
    if jsonb_array_length(value)<>3 or jsonb_typeof(value->2)<>'number' or (value->>2)::numeric<0 or (value->>2)::numeric<>trunc((value->>2)::numeric) then return false;end if;
    for child in select * from jsonb_array_elements(v) loop if not public.valid_research_tree(child,depth+1) then return false;end if;end loop;
  else
    if jsonb_array_length(value)<>2 then return false;end if;
    for child in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(child)<>'array' or jsonb_array_length(child)<>2 or child->0->>0 not in ('1','2') or
        not public.valid_research_tree(child->0,depth+1) or not public.valid_research_tree(child->1,depth+1) then return false;end if;
    end loop;
  end if;
  return true;
exception when others then return false;
end $$;

create function public.record_research_batch(batch jsonb,release text default 'development') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; participant uuid; e jsonb; safe_events jsonb='[]'; previous bigint=0; first_seq bigint; last_seq bigint;
  payload jsonb; text_key text; text_value jsonb; safe_text jsonb; b_id uuid; session uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required';end if;
  select * into p from public.profiles where id=auth.uid() for share;
  if p.research_enabled is distinct from true or coalesce(p.consent_version,'') not in ('history-only-v1','recommendation-research-v2') or (batch->>'consent')::integer is distinct from p.consent_revision then return jsonb_build_object('revoked',true);end if;
  if octet_length(batch::text)>1048576 or batch->>'protocol' is distinct from '2' or jsonb_typeof(batch->'events') is distinct from 'array' or jsonb_array_length(batch->'events') not between 1 and 48 then raise exception 'Invalid research batch';end if;
  b_id=(batch->>'id')::uuid; session=(batch->>'session')::uuid;
  for e in select * from jsonb_array_elements(batch->'events') loop
    if jsonb_typeof(e->'n') is distinct from 'number' or jsonb_typeof(e->'k') is distinct from 'number' or jsonb_typeof(e->'t') is distinct from 'number' or jsonb_typeof(e->'id') is distinct from 'string' or
      (e->>'n')::numeric<>trunc((e->>'n')::numeric) or (e->>'k')::numeric<>trunc((e->>'k')::numeric) or (e->>'n')::bigint<=previous or (e->>'k')::integer not between 0 and 16 or (e->>'t')::numeric<0 or
      not coalesce(public.valid_research_tree(e->'v'),false) then raise exception 'Invalid research event';end if;
    perform (e->>'id')::uuid;
    previous=(e->>'n')::bigint; first_seq=coalesce(first_seq,previous);last_seq=previous;
    -- Statistics events are gated independently of basic interaction consent.
    if e->>'k'='15' then raise exception 'Statistics scope required';end if;
    payload=jsonb_build_object('id',e->'id','n',e->'n','t',e->'t','k',e->'k','v',e->'v');
    if coalesce((e->>'omitted')::integer,0)>0 then payload=payload||jsonb_build_object('omitted',(e->>'omitted')::integer);end if;
    if e ? 'texts' then
      if jsonb_typeof(e->'texts')<>'object' then raise exception 'Invalid text envelope';end if;
      safe_text='{}';
      for text_key,text_value in select * from jsonb_each(e->'texts') loop
        perform text_key::uuid;
        if jsonb_typeof(text_value)<>'string' or length(text_value#>>'{}')>2048 then raise exception 'Invalid text';end if;
        safe_text=safe_text||jsonb_build_object(text_key,text_value);
      end loop;
      payload=payload||jsonb_build_object('texts',safe_text);
    end if;
    safe_events=safe_events||jsonb_build_array(payload);
  end loop;
  insert into public.research_participants(owner_id) values(auth.uid()) on conflict do nothing;
  select participant_id into participant from public.research_participants where owner_id=auth.uid();
  if exists(select 1 from public.research_batches where id=b_id and participant_id<>participant) then raise exception 'Batch unavailable';end if;
  -- Rate/space ceiling is per participant; duplicates remain idempotent.
  if not exists(select 1 from public.research_batches where id=b_id and participant_id=participant) and
    (select count(*) from public.research_batches where participant_id=participant and received_at>now()-interval '1 hour')>=12000 then raise exception 'Research ingest rate exceeded';end if;
  insert into public.research_batches(id,participant_id,session_id,consent_revision,is_guest,protocol,release,client_time,events,losses,first_sequence,last_sequence)
    values(b_id,participant,session,p.consent_revision,not public.has_registered_account(),2,left(release,200),(batch->>'time')::timestamptz,safe_events,
      jsonb_build_object('dropped',greatest(0,coalesce((batch->'losses'->>'dropped')::integer,0)),
      'omitted',greatest(0,coalesce((batch->'losses'->>'omitted')::integer,0)),
      'storageErrors',greatest(0,coalesce((batch->'losses'->>'storageErrors')::integer,0))),first_seq,last_seq)
    on conflict do nothing;
  return jsonb_build_object('ok',true,'id',b_id);
end $$;

-- Retain only the pseudonym needed to purge previously exported datasets.
create table public.research_deletions(participant_id uuid primary key,requested_at timestamptz not null default now());
alter table public.research_deletions enable row level security;
revoke all on public.research_deletions from anon,authenticated;
grant select on public.research_deletions to authenticated;
create policy research_deletions_admin on public.research_deletions for select to authenticated using(public.is_app_admin());

create function public.delete_my_research() returns public.profiles
language plpgsql security definer set search_path='' as $$
declare result public.profiles;
begin
  result=public.set_research_consent_v2(false,'{}');
  insert into public.research_deletions(participant_id) select participant_id from public.research_participants where owner_id=auth.uid() on conflict do nothing;
  delete from public.research_participants where owner_id=auth.uid();
  delete from public.research_events where owner_id=auth.uid();
  return result;
end $$;
-- Operator invokes via the release runbook, never by an unprivileged browser.
create function public.prune_research_history() returns bigint
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin delete from public.research_batches where received_at<now()-interval '90 days';get diagnostics n=row_count;return n;end $$;
revoke all on function public.valid_research_tree(jsonb,integer),public.prune_research_history() from public,anon,authenticated;
revoke all on function public.set_research_consent_v2(boolean,jsonb),public.record_research_batch(jsonb,text),public.delete_my_research() from public,anon;
grant execute on function public.set_research_consent_v2(boolean,jsonb),public.record_research_batch(jsonb,text),public.delete_my_research() to authenticated;

-- Supabase deployments with pg_cron configured install an idempotent daily job.
-- The release runbook verifies this job; local Postgres fixtures lack pg_cron.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('vis-research-retention','17 3 * * *','select public.prune_research_history()');
  end if;
end $$;
