-- Repository invariants: partial idempotency indexes, transactional message
-- writes, atomic event claims, and private object buckets.

-- NULL external ids mean "not supplied", not "all the same record".
alter table public.conversations
  drop constraint if exists conversations_organization_id_channel_external_thread_key_key;
create unique index if not exists conversations_external_thread_key_unique
  on public.conversations(organization_id, channel, external_thread_key)
  where external_thread_key is not null;

alter table public.conversation_participants
  drop constraint if exists conversation_participants_conversation_id_external_id_key;
create unique index if not exists conversation_participants_external_id_unique
  on public.conversation_participants(conversation_id, external_id)
  where external_id is not null;

alter table public.messages
  drop constraint if exists messages_conversation_id_ordinal_revision_key;
alter table public.messages
  drop constraint if exists messages_conversation_id_external_message_id_revision_key;
create unique index if not exists messages_conversation_ordinal_unique
  on public.messages(conversation_id, ordinal);
create unique index if not exists messages_external_message_id_unique
  on public.messages(conversation_id, external_message_id)
  where external_message_id is not null;

create or replace function public.put_conversation_message(
  p_organization_id uuid,
  p_conversation_id text,
  p_expected_conversation_revision integer,
  p_message jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_conversation_revision integer;
  v_next_revision integer;
  v_message_revision integer;
  v_existing public.messages%rowtype;
  v_external_existing public.messages%rowtype;
  v_saved public.messages%rowtype;
  v_disposition text;
  v_occurred_at timestamptz;
  v_received_at timestamptz;
  v_participant_id text;
  v_external_message_id text;
  v_reply_to_message_id text;
begin
  if p_expected_conversation_revision < 0 then
    return jsonb_build_object('status', 'invalid', 'reason', 'negative_expected_revision');
  end if;

  if nullif(p_message->>'id', '') is null
    or nullif(p_message->>'source_hash', '') is null
    or nullif(p_message->>'received_at', '') is null
    or nullif(p_message->>'ordinal', '') is null
    or nullif(p_message->>'revision', '') is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'missing_required_field');
  end if;

  v_message_revision := (p_message->>'revision')::integer;
  v_received_at := (p_message->>'received_at')::timestamptz;
  v_occurred_at := nullif(p_message->>'occurred_at', '')::timestamptz;
  v_participant_id := nullif(p_message->>'participant_id', '');
  v_external_message_id := nullif(p_message->>'external_message_id', '');
  v_reply_to_message_id := nullif(p_message->>'reply_to_message_id', '');

  select revision
  into v_conversation_revision
  from public.conversations
  where id = p_conversation_id
    and organization_id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select *
  into v_existing
  from public.messages
  where id = p_message->>'id'
  for update;

  if found then
    if v_existing.organization_id <> p_organization_id
      or v_existing.conversation_id <> p_conversation_id then
      return jsonb_build_object('status', 'conflict', 'reason', 'message_id_in_use');
    end if;

    -- source_hash is the adapter's canonical content hash. It makes an exact
    -- retry safe even after another worker has advanced the conversation.
    if v_existing.revision = v_message_revision
      and v_existing.source_hash = p_message->>'source_hash' then
      return jsonb_build_object(
        'status', 'duplicate',
        'conversation_revision', v_conversation_revision,
        'message', to_jsonb(v_existing)
      );
    end if;
  end if;

  if v_external_message_id is not null then
    select *
    into v_external_existing
    from public.messages
    where conversation_id = p_conversation_id
      and external_message_id = v_external_message_id
    for update;

    if found and v_external_existing.id <> p_message->>'id' then
      if v_external_existing.revision = v_message_revision
        and v_external_existing.source_hash = p_message->>'source_hash' then
        return jsonb_build_object(
          'status', 'duplicate',
          'conversation_revision', v_conversation_revision,
          'message', to_jsonb(v_external_existing)
        );
      end if;
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'external_message_id_in_use'
      );
    end if;
  end if;

  if v_conversation_revision <> p_expected_conversation_revision then
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'conversation_revision_changed',
      'actual_revision', v_conversation_revision
    );
  end if;

  if v_participant_id is not null and not exists (
    select 1
    from public.conversation_participants
    where id = v_participant_id
      and organization_id = p_organization_id
      and conversation_id = p_conversation_id
  ) then
    return jsonb_build_object('status', 'invalid', 'reason', 'participant_mismatch');
  end if;

  if v_reply_to_message_id is not null and not exists (
    select 1
    from public.messages
    where id = v_reply_to_message_id
      and organization_id = p_organization_id
      and conversation_id = p_conversation_id
  ) then
    return jsonb_build_object('status', 'invalid', 'reason', 'reply_target_mismatch');
  end if;

  if v_existing.id is not null then
    if v_message_revision <> v_existing.revision + 1 then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'message_revision_not_monotonic'
      );
    end if;
    if (p_message->>'ordinal')::integer <> v_existing.ordinal
      or v_participant_id is distinct from v_existing.participant_id
      or v_external_message_id is distinct from v_existing.external_message_id then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'immutable_message_identity_changed'
      );
    end if;

    insert into public.message_revisions (
      organization_id, message_id, revision, state, original_text,
      normalized_text, source_hash, metadata, created_at
    ) values (
      v_existing.organization_id, v_existing.id, v_existing.revision,
      v_existing.state, v_existing.original_text, v_existing.normalized_text,
      v_existing.source_hash, v_existing.metadata, now()
    )
    on conflict (message_id, revision) do nothing;

    update public.messages
    set
      revision = v_message_revision,
      direction = p_message->>'direction',
      visibility = p_message->>'visibility',
      state = p_message->>'state',
      modality = p_message->>'modality',
      original_text = coalesce(p_message->>'original_text', ''),
      normalized_text = coalesce(p_message->>'normalized_text', ''),
      language = nullif(p_message->>'language', ''),
      occurred_at = v_occurred_at,
      received_at = v_received_at,
      reply_to_message_id = v_reply_to_message_id,
      confidence = nullif(p_message->>'confidence', '')::numeric,
      source_hash = p_message->>'source_hash',
      metadata = coalesce(p_message->'metadata', '{}'::jsonb),
      updated_at = coalesce(
        nullif(p_message->>'updated_at', '')::timestamptz,
        now()
      )
    where id = v_existing.id
    returning * into v_saved;
    v_disposition := 'updated';
  else
    if v_message_revision <> 0 then
      return jsonb_build_object(
        'status', 'conflict',
        'reason', 'new_message_revision_must_be_zero'
      );
    end if;

    insert into public.messages (
      id, organization_id, conversation_id, participant_id,
      external_message_id, revision, direction, visibility, state, modality,
      original_text, normalized_text, language, occurred_at, received_at,
      ordinal, reply_to_message_id, confidence, source_hash, metadata,
      created_at, updated_at
    ) values (
      p_message->>'id', p_organization_id, p_conversation_id, v_participant_id,
      v_external_message_id, v_message_revision, p_message->>'direction',
      p_message->>'visibility', p_message->>'state', p_message->>'modality',
      coalesce(p_message->>'original_text', ''),
      coalesce(p_message->>'normalized_text', ''),
      nullif(p_message->>'language', ''), v_occurred_at, v_received_at,
      (p_message->>'ordinal')::integer, v_reply_to_message_id,
      nullif(p_message->>'confidence', '')::numeric,
      p_message->>'source_hash', coalesce(p_message->'metadata', '{}'::jsonb),
      coalesce(nullif(p_message->>'created_at', '')::timestamptz, now()),
      coalesce(nullif(p_message->>'updated_at', '')::timestamptz, now())
    )
    returning * into v_saved;
    v_disposition := 'created';
  end if;

  v_next_revision := v_conversation_revision + 1;
  update public.conversations
  set
    revision = v_next_revision,
    last_activity_at = greatest(
      last_activity_at,
      coalesce(v_occurred_at, v_received_at)
    ),
    updated_at = greatest(updated_at, v_received_at)
  where id = p_conversation_id
    and organization_id = p_organization_id;

  insert into public.outbox_events (
    organization_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    p_organization_id,
    'conversation',
    p_conversation_id,
    case
      when v_disposition = 'created' then 'message.created'
      else 'message.updated'
    end,
    jsonb_build_object(
      'messageId', v_saved.id,
      'messageRevision', v_saved.revision,
      'conversationRevision', v_next_revision
    )
  );

  return jsonb_build_object(
    'status', v_disposition,
    'conversation_revision', v_next_revision,
    'message', to_jsonb(v_saved)
  );
end;
$$;

create or replace function public.claim_ingestion_event(
  p_organization_id uuid,
  p_ingestion_run_id text,
  p_event jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing public.ingestion_events%rowtype;
  v_saved public.ingestion_events%rowtype;
begin
  perform 1
  from public.ingestion_runs
  where id = p_ingestion_run_id
    and organization_id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select *
  into v_existing
  from public.ingestion_events
  where organization_id = p_organization_id
    and idempotency_key = p_event->>'idempotency_key'
  for update;

  if found then
    if v_existing.event_id = p_event->>'event_id'
      and v_existing.event_type = p_event->>'event_type'
      and v_existing.adapter_id = p_event->>'adapter_id'
      and v_existing.adapter_version = p_event->>'adapter_version'
      and v_existing.payload = coalesce(p_event->'payload', '{}'::jsonb) then
      return jsonb_build_object(
        'status', 'duplicate',
        'ingestion_run_id', v_existing.ingestion_run_id,
        'event', to_jsonb(v_existing)
      );
    end if;
    return jsonb_build_object(
      'status', 'conflict',
      'reason', 'idempotency_key_payload_drift'
    );
  end if;

  if exists (
    select 1
    from public.ingestion_events
    where event_id = p_event->>'event_id'
  ) then
    return jsonb_build_object('status', 'conflict', 'reason', 'event_id_in_use');
  end if;

  insert into public.ingestion_events (
    event_id, organization_id, ingestion_run_id, schema_version, adapter_id,
    adapter_version, idempotency_key, external_conversation_key, occurred_at,
    received_at, sequence, event_type, payload, raw_artifact_ref
  ) values (
    p_event->>'event_id', p_organization_id, p_ingestion_run_id,
    (p_event->>'schema_version')::integer, p_event->>'adapter_id',
    p_event->>'adapter_version', p_event->>'idempotency_key',
    nullif(p_event->>'external_conversation_key', ''),
    nullif(p_event->>'occurred_at', '')::timestamptz,
    (p_event->>'received_at')::timestamptz,
    nullif(p_event->>'sequence', '')::integer,
    p_event->>'event_type', coalesce(p_event->'payload', '{}'::jsonb),
    nullif(p_event->>'raw_artifact_ref', '')
  )
  returning * into v_saved;

  update public.ingestion_runs
  set event_count = event_count + 1
  where id = p_ingestion_run_id
    and organization_id = p_organization_id;

  return jsonb_build_object(
    'status', 'created',
    'ingestion_run_id', p_ingestion_run_id,
    'event', to_jsonb(v_saved)
  );
end;
$$;

revoke all on function public.put_conversation_message(uuid, text, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_ingestion_event(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.put_conversation_message(uuid, text, integer, jsonb)
  to service_role;
grant execute on function public.claim_ingestion_event(uuid, text, jsonb)
  to service_role;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values
  (
    'raw-ingestion',
    'raw-ingestion',
    false,
    52428800,
    array[
      'application/json', 'text/plain', 'text/csv', 'text/html',
      'application/zip', 'application/pdf'
    ]
  ),
  (
    'conversation-attachments',
    'conversation-attachments',
    false,
    26214400,
    array[
      'application/pdf', 'text/plain', 'image/jpeg', 'image/png',
      'audio/wav', 'audio/mpeg', 'audio/ogg'
    ]
  ),
  (
    'reference-documents',
    'reference-documents',
    false,
    26214400,
    array['application/pdf', 'text/plain', 'text/html']
  ),
  (
    'audit-audio',
    'audit-audio',
    false,
    20971520,
    array['audio/wav', 'audio/mpeg', 'audio/ogg']
  )
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
