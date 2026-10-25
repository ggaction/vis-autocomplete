-- Run as postgres in the hosted SQL editor after the migration.
-- All synthetic users and edits are transaction-local and rolled back.
begin;
select set_config('va_smoke.owner_a', gen_random_uuid()::text, true),
       set_config('va_smoke.owner_b', gen_random_uuid()::text, true),
       set_config('va_smoke.project', gen_random_uuid()::text, true),
       set_config('va_smoke.operation', gen_random_uuid()::text, true);
insert into auth.users(id) values
  (current_setting('va_smoke.owner_a')::uuid),
  (current_setting('va_smoke.owner_b')::uuid);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('va_smoke.owner_a'), true);
do $$
declare result integer; consent public.profiles;
begin
  if auth.uid()::text <> current_setting('va_smoke.owner_a') then
    raise exception 'Auth role simulation failed';
  end if;
  result := public.save_project(current_setting('va_smoke.project')::uuid,
    'Hosted smoke test', '{"format":"visualization-autocomplete","datasets":[]}',
    0, current_setting('va_smoke.operation')::uuid, '[]');
  if result <> 1 then raise exception 'Initial save failed'; end if;
  result := public.save_project(current_setting('va_smoke.project')::uuid,
    'Hosted smoke test', '{"format":"visualization-autocomplete","datasets":[]}',
    0, current_setting('va_smoke.operation')::uuid, '[]');
  if result <> 1 then raise exception 'Idempotence failed'; end if;
  begin
    perform public.save_project(current_setting('va_smoke.project')::uuid,
      'Stale edit', '{"format":"visualization-autocomplete","datasets":[]}', 0, gen_random_uuid(), '[]');
    raise exception 'Stale revision was accepted';
  exception when serialization_failure then null;
  end;
  select * into consent from public.set_research_consent(true);
  result := public.record_interactions(jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'session', gen_random_uuid(), 'sequence', 1, 'time', now(),
    'payload', jsonb_build_object('type','apply','method','encodeColor',
      'datasetRows','private value','field','private field','args','private arguments')
  )), consent.consent_revision, 'hosted-smoke');
  if result <> 1 then raise exception 'Consented event was not recorded'; end if;
  if exists(select 1 from public.research_events where owner_id=auth.uid()
    and (payload ?| array['datasetRows','field','args'])) then
    raise exception 'Research sanitizer leaked source data';
  end if;
  perform public.set_research_consent(false);
  if public.record_interactions('[]',consent.consent_revision,'hosted-smoke') <> 0 then
    raise exception 'Consent withdrawal was ignored';
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('va_smoke.owner_b'), true);
do $$
begin
  if exists(select 1 from public.projects where id=current_setting('va_smoke.project')::uuid)
    or exists(select 1 from public.project_revisions where project_id=current_setting('va_smoke.project')::uuid)
    or exists(select 1 from public.research_events where owner_id=current_setting('va_smoke.owner_a')::uuid) then
    raise exception 'Cross-account read was permitted';
  end if;
  begin
    perform public.save_project(current_setting('va_smoke.project')::uuid,
      'Foreign edit', '{"format":"visualization-autocomplete","datasets":[]}',1,gen_random_uuid(),'[]');
    raise exception 'Foreign overwrite was permitted';
  exception when raise_exception then
    if sqlerrm <> 'Project unavailable' then raise; end if;
  end;
end $$;
reset role;
rollback;
select 'PASS: private saves, idempotence, revision conflicts, consent, sanitization, account isolation; test data rolled back' as hosted_smoke;
