-- Production multi-channel core.
-- Non-destructive: legacy calls/violations/audits remain available while the
-- application transitions to conversations/messages/findings.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('agent', 'compliance', 'admin')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.conversations (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null check (
    channel in (
      'live_voice', 'email', 'whatsapp', 'sms', 'web_chat',
      'ticket', 'in_person', 'transcript', 'unknown'
    )
  ),
  ingestion_mode text not null check (
    ingestion_mode in ('live', 'paste', 'upload', 'export', 'api')
  ),
  purpose text not null check (purpose in ('sales', 'support', 'mixed')),
  lifecycle text not null default 'open'
    check (lifecycle in ('open', 'closed', 'reopened')),
  processing_state text not null default 'idle'
    check (
      processing_state in (
        'idle', 'queued', 'processing', 'ready', 'needs_review', 'error'
      )
    ),
  product_id text references public.products(id),
  policy_pack_ids jsonb not null default '[]'::jsonb,
  external_thread_key text,
  customer_language text,
  title text,
  started_at timestamptz,
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz,
  revision integer not null default 0 check (revision >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, external_thread_key)
);

create table if not exists public.conversation_participants (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  role text not null check (
    role in (
      'agent', 'customer', 'supervisor', 'system', 'bot',
      'third_party', 'unknown'
    )
  ),
  display_name text,
  external_id text,
  role_confidence numeric(4,3) not null default 0
    check (role_confidence >= 0 and role_confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (conversation_id, external_id)
);

create table if not exists public.messages (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  participant_id text references public.conversation_participants(id),
  external_message_id text,
  revision integer not null default 0 check (revision >= 0),
  direction text not null check (direction in ('outbound', 'inbound', 'internal', 'unknown')),
  visibility text not null default 'customer_visible'
    check (visibility in ('customer_visible', 'internal')),
  state text not null check (state in ('draft', 'sent', 'received', 'edited', 'deleted')),
  modality text not null check (
    modality in ('text', 'speech', 'document', 'image', 'audio', 'system')
  ),
  original_text text not null default '',
  normalized_text text not null default '',
  language text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  ordinal integer not null check (ordinal >= 0),
  reply_to_message_id text references public.messages(id),
  confidence numeric(4,3) check (confidence >= 0 and confidence <= 1),
  source_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, ordinal, revision),
  unique nulls not distinct (conversation_id, external_message_id, revision)
);

create table if not exists public.message_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id text not null references public.messages(id) on delete cascade,
  revision integer not null check (revision >= 0),
  state text not null check (state in ('draft', 'sent', 'received', 'edited', 'deleted')),
  original_text text not null default '',
  normalized_text text not null default '',
  source_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (message_id, revision)
);

create table if not exists public.ingestion_runs (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  adapter_id text not null,
  adapter_version text not null,
  channel text not null,
  ingestion_mode text not null,
  purpose text not null,
  status text not null check (
    status in ('received', 'validating', 'processing', 'completed', 'partial', 'failed')
  ),
  raw_artifact_path text,
  raw_content_hash text not null,
  event_count integer not null default 0,
  issue_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ingestion_events (
  event_id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ingestion_run_id text references public.ingestion_runs(id) on delete cascade,
  schema_version integer not null default 1,
  adapter_id text not null,
  adapter_version text not null,
  idempotency_key text not null,
  external_conversation_key text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  sequence integer,
  event_type text not null,
  payload jsonb not null,
  raw_artifact_ref text,
  processed_at timestamptz,
  processing_error text,
  unique (organization_id, idempotency_key)
);

create table if not exists public.attachments (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  message_id text references public.messages(id) on delete cascade,
  file_name text not null,
  media_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  content_hash text not null,
  storage_path text not null,
  extraction_state text not null default 'pending'
    check (extraction_state in ('pending', 'processing', 'ready', 'failed')),
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, content_hash, storage_path)
);

create table if not exists public.reference_documents (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id text references public.products(id),
  title text not null,
  document_type text not null check (
    document_type in (
      'product_terms', 'regulation', 'support_playbook',
      'process', 'faq', 'other'
    )
  ),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_versions (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id text not null references public.reference_documents(id) on delete cascade,
  version integer not null check (version > 0),
  content_hash text not null,
  storage_path text not null,
  media_type text not null,
  effective_from timestamptz,
  effective_to timestamptz,
  extraction_state text not null
    check (extraction_state in ('pending', 'processing', 'ready', 'failed')),
  extraction_error text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (document_id, version),
  unique (document_id, content_hash)
);

create table if not exists public.document_chunks (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_version_id text not null references public.document_versions(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  page_number integer check (page_number > 0),
  section_path jsonb not null default '[]'::jsonb,
  text text not null,
  start_offset integer,
  end_offset integer,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (document_version_id, ordinal)
);

create table if not exists public.compliance_facts (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_version_id text not null references public.document_versions(id) on delete cascade,
  fact_key text not null,
  value jsonb not null,
  evidence_chunk_ids jsonb not null,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_version_id, fact_key)
);

create table if not exists public.policy_packs (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  domain text not null,
  purpose text not null check (purpose in ('sales', 'support', 'mixed')),
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'active', 'retired')),
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id, version)
);

create table if not exists public.check_definitions (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_pack_id text not null references public.policy_packs(id) on delete cascade,
  kind text not null,
  title text not null,
  description text not null,
  scope text not null check (scope in ('message', 'conversation')),
  severity text not null check (
    severity in ('info', 'low', 'medium', 'high', 'critical')
  ),
  evaluator text not null check (evaluator in ('rule', 'model', 'hybrid')),
  config jsonb not null default '{}'::jsonb,
  required_evidence_fact_keys jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_runs (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  conversation_revision integer not null check (conversation_revision >= 0),
  policy_pack_id text,
  policy_pack_version integer,
  knowledge_snapshot jsonb not null default '{}'::jsonb,
  trigger text not null,
  status text not null check (
    status in ('queued', 'running', 'completed', 'degraded', 'failed')
  ),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  degraded_reasons jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique nulls not distinct (
    conversation_id, conversation_revision, policy_pack_id, policy_pack_version, trigger
  )
);

create table if not exists public.findings (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  audit_run_id text not null references public.audit_runs(id) on delete cascade,
  check_definition_id text,
  fingerprint text not null,
  kind text not null,
  outcome text not null check (
    outcome in ('fail', 'pass', 'needs_evidence', 'needs_review', 'not_applicable')
  ),
  lifecycle text not null default 'open'
    check (lifecycle in ('open', 'corrected', 'confirmed', 'dismissed', 'superseded')),
  severity text not null check (
    severity in ('info', 'low', 'medium', 'high', 'critical')
  ),
  title text not null,
  explanation text not null,
  coach_suggestion text,
  implicated_message_ids jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  source text not null check (source in ('rule', 'model', 'hybrid', 'human')),
  provider text,
  model text,
  prompt_version text,
  latency_ms integer check (latency_ms >= 0),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_run_id, fingerprint)
);

create table if not exists public.finding_evidence (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id text not null references public.findings(id) on delete cascade,
  evidence_type text not null,
  message_id text references public.messages(id),
  document_chunk_id text references public.document_chunks(id),
  compliance_fact_id text references public.compliance_facts(id),
  start_offset integer,
  end_offset integer,
  quote text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.obligation_states (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  conversation_revision integer not null check (conversation_revision >= 0),
  check_definition_id text not null,
  status text not null check (
    status in ('pending', 'satisfied', 'missing', 'not_applicable', 'needs_review')
  ),
  satisfaction_message_ids jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  derived_at timestamptz not null default now(),
  unique (conversation_id, conversation_revision, check_definition_id)
);

create table if not exists public.audit_artifacts (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id text not null references public.conversations(id) on delete cascade,
  audit_run_id text not null references public.audit_runs(id) on delete cascade,
  audience text not null check (audience in ('agent', 'compliance', 'customer')),
  language text not null,
  summary text not null default '',
  promised jsonb not null default '[]'::jsonb,
  actual jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  audio_storage_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_access_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  audit_artifact_id text not null references public.audit_artifacts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.connector_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_type text not null check (
    connector_type in ('whatsapp_cloud', 'inbound_email', 'generic_webhook')
  ),
  status text not null check (status in ('pending', 'connected', 'degraded', 'disabled')),
  external_account_id text,
  secret_ref text,
  config jsonb not null default '{}'::jsonb,
  last_event_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, connector_type, external_account_id)
);

create index if not exists conversations_org_activity_idx
  on public.conversations(organization_id, last_activity_at desc);
create index if not exists conversations_filters_idx
  on public.conversations(organization_id, purpose, channel, processing_state);
create index if not exists messages_conversation_order_idx
  on public.messages(conversation_id, ordinal, revision desc);
create index if not exists messages_source_hash_idx
  on public.messages(organization_id, source_hash);
create index if not exists ingestion_events_pending_idx
  on public.ingestion_events(organization_id, received_at)
  where processed_at is null;
create index if not exists document_chunks_version_idx
  on public.document_chunks(document_version_id, ordinal);
create index if not exists findings_conversation_idx
  on public.findings(conversation_id, lifecycle, severity, created_at desc);
create index if not exists findings_org_review_idx
  on public.findings(organization_id, outcome, lifecycle, created_at desc);
create index if not exists outbox_pending_idx
  on public.outbox_events(available_at, attempts)
  where processed_at is null;

-- Legacy data belongs to an isolated migration organization. Existing IDs are
-- preserved, but speaker roles remain unknown because the old schema cannot
-- prove who spoke.
insert into public.organizations (id, name, slug)
values (
  '00000000-0000-0000-0000-000000000001',
  'Legacy demo workspace',
  'legacy-demo'
)
on conflict (id) do nothing;

insert into public.conversations (
  id, organization_id, channel, ingestion_mode, purpose, lifecycle,
  processing_state, product_id, customer_language, title, started_at,
  last_activity_at, closed_at, revision, metadata, created_at, updated_at
)
select
  c.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'live_voice',
  'live',
  'sales',
  case when c.ended_at is null then 'open' else 'closed' end,
  case when c.status = 'error' then 'error' else 'ready' end,
  c.product_id,
  c.customer_lang,
  'Legacy call with ' || c.customer_name,
  c.started_at,
  coalesce(c.ended_at, c.started_at),
  c.ended_at,
  0,
  jsonb_build_object(
    'legacyCallId', c.id,
    'legacyAgentId', c.agent_id,
    'legacyDetectedLanguage', c.detected_lang
  ),
  c.started_at,
  coalesce(c.ended_at, c.started_at)
from public.calls c
on conflict (id) do nothing;

insert into public.conversation_participants (
  id, organization_id, conversation_id, role, display_name, external_id,
  role_confidence, metadata, created_at, updated_at
)
select
  'legacy-participant:' || c.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  c.id,
  'unknown',
  null,
  null,
  0,
  '{"reason":"Legacy mono transcript has no reliable speaker attribution"}'::jsonb,
  c.started_at,
  coalesce(c.ended_at, c.started_at)
from public.calls c
on conflict (id) do nothing;

insert into public.messages (
  id, organization_id, conversation_id, participant_id, revision, direction,
  visibility, state, modality, original_text, normalized_text, language,
  occurred_at, received_at, ordinal, confidence, source_hash, metadata,
  created_at, updated_at
)
select
  'legacy-message:' || c.id || ':' || (item.ordinality - 1),
  '00000000-0000-0000-0000-000000000001'::uuid,
  c.id,
  'legacy-participant:' || c.id,
  0,
  'unknown',
  'customer_visible',
  'received',
  'speech',
  coalesce(item.value->>'text', ''),
  coalesce(item.value->>'text', ''),
  coalesce(item.value->>'language', c.detected_lang),
  c.started_at + (
    coalesce((item.value->>'tsMs')::numeric, 0) * interval '1 millisecond'
  ),
  c.started_at + (
    coalesce((item.value->>'tsMs')::numeric, 0) * interval '1 millisecond'
  ),
  item.ordinality - 1,
  null,
  encode(
    digest(
      c.id || ':' || item.ordinality || ':' || coalesce(item.value->>'text', ''),
      'sha256'
    ),
    'hex'
  ),
  jsonb_build_object('legacyFinal', item.value->'final'),
  c.started_at,
  coalesce(c.ended_at, c.started_at)
from public.calls c
cross join lateral jsonb_array_elements(c.transcript) with ordinality as item(value, ordinality)
on conflict (id) do nothing;

insert into public.audit_runs (
  id, organization_id, conversation_id, conversation_revision,
  knowledge_snapshot, trigger, status, started_at, completed_at,
  degraded_reasons, metrics, created_at
)
select
  'legacy-audit-run:' || c.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  c.id,
  0,
  '{}'::jsonb,
  'migration',
  case when c.status = 'error' then 'failed' else 'completed' end,
  c.started_at,
  c.ended_at,
  '["Legacy result: source and prompt versions were not recorded"]'::jsonb,
  '{}'::jsonb,
  c.started_at
from public.calls c
on conflict (id) do nothing;

insert into public.findings (
  id, organization_id, conversation_id, audit_run_id, fingerprint, kind,
  outcome, lifecycle, severity, title, explanation, coach_suggestion,
  implicated_message_ids, confidence, source, created_at, updated_at
)
select
  'legacy-finding:' || v.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  v.call_id,
  'legacy-audit-run:' || v.call_id,
  encode(digest(v.id || ':' || v.call_id || ':' || v.kind, 'sha256'), 'hex'),
  v.kind,
  'fail',
  'open',
  case when v.severity = 'high' then 'high' else 'low' end,
  case when v.kind = 'omission' then 'Required disclosure omitted' else 'Unsupported claim' end,
  coalesce(v.contradicted_by, 'Legacy finding'),
  v.suggested_correction,
  '[]'::jsonb,
  case when v.source = 'both' then 0.9 else 0.6 end,
  case
    when v.source = 'model' then 'model'
    when v.source = 'heuristic' then 'rule'
    else 'hybrid'
  end,
  v.created_at,
  v.created_at
from public.violations v
join public.conversations c on c.id = v.call_id
on conflict (id) do nothing;

insert into public.finding_evidence (
  id, organization_id, finding_id, evidence_type, quote, metadata, created_at
)
select
  'legacy-evidence:' || v.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'legacy-finding:' || v.id,
  'legacy_quote',
  case
    when nullif(v.utterance, '') is not null then v.utterance
    else coalesce(v.contradicted_by, 'No trigger text was preserved')
  end,
  jsonb_build_object('legacyViolationId', v.id),
  v.created_at
from public.violations v
join public.findings f on f.id = 'legacy-finding:' || v.id
on conflict (id) do nothing;

insert into public.audit_artifacts (
  id, organization_id, conversation_id, audit_run_id, audience, language,
  summary, promised, actual, gaps, audio_storage_path, created_at
)
select
  'legacy-artifact:' || a.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  a.call_id,
  'legacy-audit-run:' || a.call_id,
  'customer',
  a.summary_lang,
  a.summary_text,
  a.promised,
  a.actual,
  a.gaps,
  a.audio_url,
  a.created_at
from public.audits a
join public.conversations c on c.id = a.call_id
on conflict (id) do nothing;

insert into public.obligation_states (
  id, organization_id, conversation_id, conversation_revision,
  check_definition_id, status, satisfaction_message_ids, confidence, derived_at
)
select
  'legacy-obligation:' || c.id || ':' || disclosure.value,
  '00000000-0000-0000-0000-000000000001'::uuid,
  c.id,
  0,
  'legacy-disclosure:' || disclosure.value,
  'needs_review',
  '[]'::jsonb,
  0,
  coalesce(c.ended_at, c.started_at)
from public.calls c
cross join lateral jsonb_array_elements_text(c.satisfied_disclosure_ids)
  as disclosure(value)
join public.conversations conversation on conversation.id = c.id
on conflict (id) do nothing;

insert into public.reference_documents (
  id, organization_id, product_id, title, document_type, status,
  created_at, updated_at
)
select
  'legacy-document:' || p.id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  p.id,
  p.name || ' source document',
  'product_terms',
  'draft',
  p.created_at,
  p.created_at
from public.products p
on conflict (id) do nothing;

insert into public.document_versions (
  id, organization_id, document_id, version, content_hash, storage_path,
  media_type, extraction_state, extraction_error, created_at
)
select
  'legacy-document-version:' || p.id || ':1',
  '00000000-0000-0000-0000-000000000001'::uuid,
  'legacy-document:' || p.id,
  1,
  encode(digest(coalesce(p.pdf_url, '') || ':' || p.terms_json::text, 'sha256'), 'hex'),
  coalesce(p.pdf_url, 'legacy/unavailable/' || p.id),
  'application/pdf',
  'pending',
  'Legacy source has no page-level provenance and requires re-extraction',
  p.created_at
from public.products p
join public.reference_documents d on d.id = 'legacy-document:' || p.id
on conflict (id) do nothing;

-- RLS helpers. Service-role operations continue to bypass RLS.
create or replace function public.has_org_access(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(target_org uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.role = any(allowed_roles)
  );
$$;

revoke all on function public.has_org_access(uuid) from public;
revoke all on function public.has_org_role(uuid, text[]) from public;
grant execute on function public.has_org_access(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_revisions enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.ingestion_events enable row level security;
alter table public.attachments enable row level security;
alter table public.reference_documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.compliance_facts enable row level security;
alter table public.policy_packs enable row level security;
alter table public.check_definitions enable row level security;
alter table public.audit_runs enable row level security;
alter table public.findings enable row level security;
alter table public.finding_evidence enable row level security;
alter table public.obligation_states enable row level security;
alter table public.audit_artifacts enable row level security;
alter table public.audit_access_tokens enable row level security;
alter table public.outbox_events enable row level security;
alter table public.connector_accounts enable row level security;

create policy "members read organizations"
  on public.organizations for select to authenticated
  using (public.has_org_access(id));

create policy "members read memberships"
  on public.organization_memberships for select to authenticated
  using (public.has_org_access(organization_id));

create policy "admins manage memberships"
  on public.organization_memberships for all to authenticated
  using (public.has_org_role(organization_id, array['admin']))
  with check (public.has_org_role(organization_id, array['admin']));

-- Agent/compliance/admin may read workspace data. Mutations are narrowed below.
create policy "members read conversations"
  on public.conversations for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read participants"
  on public.conversation_participants for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read messages"
  on public.messages for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read findings"
  on public.findings for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read finding evidence"
  on public.finding_evidence for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read obligations"
  on public.obligation_states for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read audit artifacts"
  on public.audit_artifacts for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read audit runs"
  on public.audit_runs for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read message revisions"
  on public.message_revisions for select to authenticated
  using (public.has_org_access(organization_id));
create policy "members read attachments"
  on public.attachments for select to authenticated
  using (public.has_org_access(organization_id));

create policy "compliance manages findings"
  on public.findings for update to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']))
  with check (public.has_org_role(organization_id, array['compliance', 'admin']));

create policy "compliance reads ingestion runs"
  on public.ingestion_runs for select to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']));
create policy "compliance reads sources"
  on public.reference_documents for select to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']));
create policy "compliance reads document versions"
  on public.document_versions for select to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']));
create policy "compliance reads document chunks"
  on public.document_chunks for select to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']));
create policy "compliance reads facts"
  on public.compliance_facts for select to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']));
create policy "compliance reads policy packs"
  on public.policy_packs for select to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']));
create policy "compliance reads check definitions"
  on public.check_definitions for select to authenticated
  using (public.has_org_role(organization_id, array['compliance', 'admin']));
create policy "admins read connectors"
  on public.connector_accounts for select to authenticated
  using (public.has_org_role(organization_id, array['admin']));

-- Bootstrap a private workspace for a new user. Team invitation and workspace
-- merging remain explicit admin actions; signup never grants access elsewhere.
create or replace function public.handle_new_user_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid := gen_random_uuid();
  workspace_name text;
begin
  workspace_name := coalesce(
    nullif(new.raw_user_meta_data->>'organization_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    'My workspace'
  );

  insert into public.organizations (id, name, slug)
  values (
    new_org_id,
    workspace_name,
    'workspace-' || replace(substr(new.id::text, 1, 18), '-', '')
  );

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_org_id, new.id, 'admin');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_zubaan on auth.users;
create trigger on_auth_user_created_zubaan
  after insert on auth.users
  for each row execute procedure public.handle_new_user_workspace();

-- Previously public demo audio becomes private. Signed URLs are issued by the
-- server only after organization or customer-token authorization.
update storage.buckets set public = false where id = 'audit-audio';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'findings'
  ) then
    alter publication supabase_realtime add table public.findings;
  end if;
end $$;
