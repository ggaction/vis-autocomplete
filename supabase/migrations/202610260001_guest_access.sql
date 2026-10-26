-- Guests have real Auth sessions for consent and event ownership, but private
-- workspace storage requires a registered account. Do not trust user metadata.
create function public.has_registered_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id=auth.uid() and is_anonymous=false);
$$;
revoke all on function public.has_registered_account() from public;
grant execute on function public.has_registered_account() to authenticated;

create policy registered_projects on public.projects as restrictive for all to authenticated
  using(public.has_registered_account()) with check(public.has_registered_account());
create policy registered_revisions on public.project_revisions as restrictive for all to authenticated
  using(public.has_registered_account()) with check(public.has_registered_account());
create policy registered_datasets on public.datasets as restrictive for all to authenticated
  using(public.has_registered_account()) with check(public.has_registered_account());
create policy registered_storage on storage.objects as restrictive for all to authenticated
  using(bucket_id <> 'workspace' or public.has_registered_account())
  with check(bucket_id <> 'workspace' or public.has_registered_account());
create policy guest_report_without_upload on public.bug_reports as restrictive for insert to authenticated
  with check(not share_data or public.has_registered_account());

-- save_project is SECURITY DEFINER, so RLS alone cannot guard its writes.
-- The trigger also protects future write RPCs. Maintenance without an Auth
-- identity remains available to the database owner, as before.
create function public.require_registered_project_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.has_registered_account() then
    raise exception 'Sign in to save and manage projects' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.require_registered_project_owner() from public;
create trigger registered_project_write before insert or update on public.projects
  for each row execute function public.require_registered_project_owner();

-- Capture the session kind at ingestion, independent of any later account
-- conversion. The server determines it; callers cannot label themselves.
alter table public.research_events add column is_guest boolean not null default false;
create function public.stamp_research_session_kind() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select is_anonymous into new.is_guest from auth.users where id=new.owner_id;
  return new;
end $$;
revoke all on function public.stamp_research_session_kind() from public;
create trigger research_session_kind before insert on public.research_events
  for each row execute function public.stamp_research_session_kind();
