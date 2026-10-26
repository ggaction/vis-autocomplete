-- Run as postgres in the hosted SQL editor after the migration.
-- All synthetic users and edits are transaction-local and rolled back.
begin;
select set_config('va_smoke.owner_a', gen_random_uuid()::text, true),
       set_config('va_smoke.owner_b', gen_random_uuid()::text, true),
       set_config('va_smoke.guest', gen_random_uuid()::text, true),
       set_config('va_smoke.project', gen_random_uuid()::text, true),
       set_config('va_smoke.operation', gen_random_uuid()::text, true);
insert into auth.users(id) values
  (current_setting('va_smoke.owner_a')::uuid),
  (current_setting('va_smoke.owner_b')::uuid);
insert into auth.users(id,is_anonymous) values(current_setting('va_smoke.guest')::uuid,true);

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
select set_config('request.jwt.claim.sub', current_setting('va_smoke.guest'), true);
do $$
declare consent public.profiles; recorded integer; event jsonb;
begin
  if public.has_registered_account() then raise exception 'Guest classified as member'; end if;
  if exists(select 1 from public.projects) or exists(select 1 from public.project_revisions)
    or exists(select 1 from public.datasets) or exists(select 1 from storage.objects where bucket_id='workspace') then
    raise exception 'Guest can read private workspace data';
  end if;
  begin
    perform public.save_project(gen_random_uuid(),'Guest forbidden save',
      '{"format":"visualization-autocomplete","datasets":[]}',0,gen_random_uuid(),'[]');
    raise exception 'Guest project save was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects(bucket_id,name) values('workspace',auth.uid()::text || '/datasets/guest-smoke.json');
    raise exception 'Guest upload was accepted';
  exception when insufficient_privilege then null;
  end;
  select * into consent from public.set_research_consent(true);
  event := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'session',gen_random_uuid(),
    'sequence',1,'time',now(),'payload',jsonb_build_object('type','apply','method','encodeColor',
    'field','private field','args','private arguments')));
  recorded := public.record_interactions(event,consent.consent_revision,'hosted-guest-smoke');
  if recorded <> 1 or not exists(select 1 from public.research_events where owner_id=auth.uid() and is_guest) then
    raise exception 'Guest event attribution failed';
  end if;
  if exists(select 1 from public.research_events where owner_id=auth.uid() and payload ?| array['field','args']) then
    raise exception 'Guest event leaked private data';
  end if;
  perform public.set_research_consent(false);
  event := jsonb_set(event,'{0,id}',to_jsonb(gen_random_uuid()));
  if public.record_interactions(event,consent.consent_revision,'hosted-guest-smoke') <> 0 then
    raise exception 'Guest withdrawal was ignored';
  end if;
end $$;
reset role;
rollback;
select 'PASS: member saves, isolation, guest storage denial, consent, event attribution, sanitization, withdrawal; test data rolled back' as hosted_smoke;
