-- Private saved work and opt-in research telemetry have separate data paths.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  research_enabled boolean, consent_version text, consent_revision integer not null default 0,
  consent_at timestamptz, updated_at timestamptz not null default now()
);
create table public.consent_history (
  id bigint generated always as identity primary key, owner_id uuid not null references auth.users on delete cascade,
  enabled boolean not null, version text not null, revision integer not null, created_at timestamptz not null default now()
);
create table public.projects (
  id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
  title text not null check (length(title) between 1 and 160), snapshot jsonb not null,
  revision integer not null default 1, thumbnail text, updated_at timestamptz not null default now()
);
create index projects_owner_recent on public.projects(owner_id, updated_at desc);
create table public.project_revisions (
  project_id uuid not null references public.projects on delete cascade,
  revision integer not null, operation_id uuid not null, changes jsonb not null, checkpoint jsonb,
  created_at timestamptz not null default now(), primary key(project_id, revision), unique(project_id, operation_id)
);
create table public.datasets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade,
  name text not null check(length(name) between 1 and 200), hash text not null check(hash ~ '^[0-9a-f]{64}$'),
  path text not null, created_at timestamptz not null default now(), unique(owner_id, hash),
  check(path = owner_id::text || '/datasets/' || hash || '.json')
);
create table public.research_events (
  id uuid primary key, owner_id uuid not null references auth.users on delete cascade,
  session_id uuid not null, sequence bigint not null, consent_revision integer not null,
  client_time timestamptz not null, received_at timestamptz not null default now(),
  release text not null, payload jsonb not null, unique(owner_id, session_id, sequence)
);
create index research_events_session on public.research_events(owner_id, session_id, sequence);
create table public.bug_reports (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users on delete cascade,
  kind text not null check(kind in ('general','project','feature')), title text not null check(length(title) between 1 and 160),
  description text not null check(length(description) between 1 and 10000), context jsonb,
  share_data boolean not null default false, status text not null default 'received' check(status in ('received','investigating','fixed','closed')),
  release text not null check(length(release)<=200), created_at timestamptz not null default now(),
  check(context is null or octet_length(context::text)<=8388608), check(not share_data or kind='project')
);
-- Administrator membership is set only by the database owner, never user metadata.
create table public.app_admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.app_admins enable row level security;
create function public.is_app_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.consent_history enable row level security;
alter table public.projects enable row level security;
alter table public.project_revisions enable row level security;
alter table public.datasets enable row level security;
alter table public.research_events enable row level security;
alter table public.bug_reports enable row level security;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy own_consent on public.consent_history for select to authenticated using(owner_id=auth.uid());
create policy own_projects on public.projects for select to authenticated using(owner_id=auth.uid());
create policy delete_projects on public.projects for delete to authenticated using(owner_id=auth.uid());
create policy own_revisions on public.project_revisions for select to authenticated using(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=auth.uid()));
create policy own_datasets on public.datasets for select to authenticated using(owner_id=auth.uid());
create policy add_datasets on public.datasets for insert to authenticated with check(owner_id=auth.uid());
create policy read_events on public.research_events for select to authenticated using(owner_id=auth.uid() or public.is_app_admin());
create policy read_reports on public.bug_reports for select to authenticated using(owner_id=auth.uid() or public.is_app_admin());
create policy add_reports on public.bug_reports for insert to authenticated with check(owner_id=auth.uid() and status='received');
create policy edit_reports on public.bug_reports for update to authenticated using(public.is_app_admin()) with check(public.is_app_admin());
revoke all on public.profiles, public.consent_history, public.projects, public.project_revisions,
  public.datasets, public.research_events, public.bug_reports from anon, authenticated;
grant select on public.profiles, public.consent_history, public.project_revisions, public.research_events to authenticated;
grant select, delete on public.projects to authenticated;
grant select, insert on public.datasets to authenticated;
grant select, insert on public.bug_reports to authenticated;
grant update(status) on public.bug_reports to authenticated;
revoke all on public.app_admins from anon, authenticated;

create function public.set_research_consent(enabled boolean) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  if auth.uid() is null or enabled is null then raise exception 'Authentication and a choice are required'; end if;
  insert into public.profiles(id,research_enabled,consent_version,consent_revision,consent_at)
    values(auth.uid(), enabled, 'history-only-v1', 1, now())
    on conflict(id) do update set research_enabled=excluded.research_enabled, consent_version=excluded.consent_version,
      consent_revision=public.profiles.consent_revision+1, consent_at=now(),updated_at=now() returning * into result;
  insert into public.consent_history(owner_id, enabled, version, revision)
    values(auth.uid(),enabled,result.consent_version,result.consent_revision);
  return result;
end $$;

create function public.save_project(project uuid, name text, document jsonb, expected integer, operation uuid, changes jsonb, thumbnail text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare current public.projects; previous integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if octet_length(document::text)>8388608 or octet_length(changes::text)>8388608 or length(thumbnail)>200000 then raise exception 'Project too large'; end if;
  if document is null or jsonb_typeof(document->'datasets') is distinct from 'array' or document->>'format' is distinct from 'visualization-autocomplete' or jsonb_typeof(changes) is distinct from 'array' or expected is null or expected<0 or operation is null then raise exception 'Invalid project'; end if;
  if exists(select 1 from jsonb_array_elements(document->'datasets') d where not exists
    (select 1 from public.datasets t where t.owner_id=auth.uid() and t.path=d->'importRef'->>'path')) then raise exception 'Unknown private dataset'; end if;
  perform pg_advisory_xact_lock(hashtextextended(project::text, 0));
  select * into current from public.projects where id=project for update;
  if found and current.owner_id<>auth.uid() then raise exception 'Project unavailable'; end if;
  select revision into previous from public.project_revisions where project_id=project and operation_id=operation;
  if found then return previous; end if;
  if coalesce(current.revision,0)<>expected then raise exception 'revision_conflict' using errcode='40001'; end if;
  previous := expected+1;
  insert into public.projects(id,owner_id,title,snapshot,revision,thumbnail) values(project,auth.uid(),name,document,previous,thumbnail)
  on conflict(id) do update set title=excluded.title,snapshot=excluded.snapshot,revision=excluded.revision,thumbnail=excluded.thumbnail,updated_at=now();
  insert into public.project_revisions(project_id,revision,operation_id,changes,checkpoint)
    values(project,previous,operation,changes,case when previous=1 or previous%20=0 then document end);
  return previous;
end $$;

create function public.record_interactions(events jsonb, consent integer, release text) returns integer
language plpgsql security definer set search_path = '' as $$
declare event jsonb; payload jsonb; result jsonb; key text; added integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Lock against concurrent withdrawal; an old outbox cannot become valid again after re-consent.
  perform 1 from public.profiles where id=auth.uid() and research_enabled=true and consent_revision=consent for share;
  if not found then return 0; end if;
  if jsonb_typeof(events) is distinct from 'array' or jsonb_array_length(events)>200 or length(release)>200 then raise exception 'Invalid event batch'; end if;
  for event in select * from jsonb_array_elements(events) loop
    payload:=event->'payload';
    if payload->>'type' is null or not (payload->>'type'=any(array['options_shown','preview_start','preview_end','parameter','apply','history','selection','group','page','search','resize','error','export'])) then continue; end if;
    result:=jsonb_build_object('type',payload->>'type');
    if payload->>'method' ~ '^(create|edit|encode|remove|filter|layout|add|apply|facet|repeat|sort|jitter)[A-Za-z]*$' and length(payload->>'method')<=80 then result:=result||jsonb_build_object('method',payload->>'method'); end if;
    if payload->>'group'=any(array['encoding','transform','style','initial']) then result:=result||jsonb_build_object('group',payload->>'group'); end if;
    foreach key in array array['duration','index','count','revision','value','rank','score'] loop
      if jsonb_typeof(payload->key)='number' or key='value' and jsonb_typeof(payload->key)='boolean' then result:=result||jsonb_build_object(key,payload->key); end if;
    end loop;
    insert into public.research_events(id,owner_id,session_id,sequence,consent_revision,client_time,release,payload)
      values((event->>'id')::uuid,auth.uid(),(event->>'session')::uuid,(event->>'sequence')::bigint,consent,(event->>'time')::timestamptz,release,result)
      on conflict do nothing;
    added:=added+1;
  end loop;
  return added;
end $$;
revoke all on function public.set_research_consent(boolean), public.save_project(uuid,text,jsonb,integer,uuid,jsonb,text), public.record_interactions(jsonb,integer,text) from public;
grant execute on function public.set_research_consent(boolean), public.save_project(uuid,text,jsonb,integer,uuid,jsonb,text), public.record_interactions(jsonb,integer,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('workspace','workspace',false,20971520,array['application/json','image/png']) on conflict(id) do nothing;
create policy workspace_read on storage.objects for select to authenticated using(bucket_id='workspace' and (storage.foldername(name))[1]=auth.uid()::text);
create policy workspace_insert on storage.objects for insert to authenticated with check(bucket_id='workspace' and (storage.foldername(name))[1]=auth.uid()::text);
-- Immutable objects: no overwrite policy. A new content hash is a new revision.

-- Report attachments are accessible to maintainers only when the author opted
-- into dataset sharing for that particular report. Private saved work is not.
create policy report_attachment_read on storage.objects for select to authenticated using (
  bucket_id='workspace' and public.is_app_admin() and exists (
    select 1 from public.bug_reports b, jsonb_array_elements(b.context->'datasets') d
    where b.share_data=true and b.kind='project' and d->'importRef'->>'path'=storage.objects.name
      and storage.objects.name like b.owner_id::text || '/datasets/%'
  )
);
