-- Zubaan MVP schema.
-- Auth and multi-tenancy are explicitly out of scope. All application writes
-- use the server-only secret key; RLS intentionally exposes no table policies.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  name text not null,
  domain text not null default 'insurance',
  pdf_url text,
  terms_json jsonb not null default '{}'::jsonb,
  required_disclosures jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agents (
  id text primary key,
  name text not null,
  branch text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.calls (
  id text primary key,
  agent_id text not null references public.agents(id),
  product_id text not null references public.products(id),
  customer_name text not null,
  customer_lang text not null,
  detected_lang text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'ended', 'audited', 'error')),
  transcript jsonb not null default '[]'::jsonb,
  satisfied_disclosure_ids jsonb not null default '[]'::jsonb
);

create table if not exists public.violations (
  id text primary key,
  call_id text not null references public.calls(id) on delete cascade,
  kind text not null check (kind in ('contradiction', 'omission')),
  ts_ms integer not null default 0 check (ts_ms >= 0),
  utterance text not null default '',
  claim_made text,
  contradicted_by text,
  severity text not null default 'high' check (severity in ('low', 'high')),
  suggested_correction text,
  disclosure_id text,
  detected_lang text,
  source text not null default 'model' check (source in ('model', 'heuristic', 'both')),
  created_at timestamptz not null default now()
);

create table if not exists public.audits (
  id text primary key,
  call_id text not null unique references public.calls(id) on delete cascade,
  summary_text text not null,
  summary_lang text not null,
  audio_url text,
  promised jsonb not null default '[]'::jsonb,
  actual jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  degraded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id text primary key,
  violation_id text not null references public.violations(id) on delete cascade,
  call_id text not null references public.calls(id) on delete cascade,
  product_id text not null references public.products(id),
  kind text not null check (kind in ('contradiction', 'omission')),
  label text not null check (label in ('confirmed', 'dismissed')),
  utterance text not null default '',
  claim_made text,
  contradicted_by text,
  suggested_correction text,
  detected_lang text,
  note text,
  reviewed_by text,
  created_at timestamptz not null default now()
);

create index if not exists calls_agent_id_idx on public.calls(agent_id);
create index if not exists calls_product_id_idx on public.calls(product_id);
create index if not exists calls_started_at_idx on public.calls(started_at desc);
create index if not exists violations_call_id_idx on public.violations(call_id);
create index if not exists violations_kind_lang_idx on public.violations(kind, detected_lang);
create index if not exists violations_created_at_idx on public.violations(created_at desc);
create index if not exists feedback_product_lang_idx on public.feedback(product_id, detected_lang);

alter table public.products enable row level security;
alter table public.agents enable row level security;
alter table public.calls enable row level security;
alter table public.violations enable row level security;
alter table public.audits enable row level security;
alter table public.feedback enable row level security;

-- A public bucket gives the customer browser page a playable URL. Uploads still
-- happen only through the server-side secret key.
insert into storage.buckets (id, name, public)
values ('audit-audio', 'audit-audio', true)
on conflict (id) do update set public = true;

-- Realtime is used for live flags. The guarded block keeps repeated setup safe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'violations'
  ) then
    alter publication supabase_realtime add table public.violations;
  end if;
end $$;

insert into public.products (
  id, name, domain, pdf_url, terms_json, required_disclosures, created_at
) values (
  'suraksha-growth-plus',
  'Suraksha Growth Plus ULIP',
  'insurance',
  '/demo/suraksha-growth-plus.pdf',
  '{
    "domain":"insurance",
    "guaranteed":false,
    "returnsRange":"6–8% illustrative; market-linked",
    "lockInYears":5,
    "surrenderCharges":"Up to 30% of fund value in policy years 1–3",
    "exclusions":["Suicide within the first 12 months","Claims involving material facts not disclosed at purchase"],
    "liquidityTerms":"No withdrawal is permitted during the five-year lock-in",
    "freeLookDays":15
  }'::jsonb,
  '[
    {"id":"lock_in","text":"State the five-year lock-in period.","why_required":"The customer must understand when their money cannot be withdrawn.","category":"liquidity","critical":true},
    {"id":"surrender_charges","text":"State the surrender charges and loss on early exit.","why_required":"Early-exit charges can materially reduce the customer''s savings.","category":"charges","critical":true},
    {"id":"returns_not_guaranteed","text":"State that returns are market-linked and not guaranteed.","why_required":"Projected returns cannot be presented as certain.","category":"returns","critical":true},
    {"id":"free_look","text":"State the 15-day free-look window.","why_required":"The customer has a cooling-off right after receiving the policy.","category":"rights","critical":true},
    {"id":"exclusions","text":"State the major claim exclusions.","why_required":"The customer must know when the insurer may not pay a claim.","category":"coverage","critical":false}
  ]'::jsonb,
  '2026-07-26T06:00:00Z'
) on conflict (id) do update set
  name = excluded.name,
  terms_json = excluded.terms_json,
  required_disclosures = excluded.required_disclosures;

insert into public.agents (id, name, branch) values
  ('agt-meera', 'Meera Singh', 'Patna Main'),
  ('agt-arjun', 'Arjun Nair', 'Kochi MG Road'),
  ('agt-sana', 'Sana Sheikh', 'Pune Camp'),
  ('agt-vikram', 'Vikram Patel', 'Ahmedabad West'),
  ('agt-kavya', 'Kavya Reddy', 'Hyderabad Central'),
  ('agt-rahul', 'Rahul Das', 'Kolkata North')
on conflict (id) do update set name = excluded.name, branch = excluded.branch;

insert into public.calls (
  id, agent_id, product_id, customer_name, customer_lang, detected_lang,
  started_at, ended_at, status
)
select
  'seed-call-' || lpad(i::text, 2, '0'),
  (array['agt-meera','agt-arjun','agt-sana','agt-vikram','agt-kavya','agt-rahul'])[((i - 1) % 6) + 1],
  'suraksha-growth-plus',
  'Demo customer ' || i,
  (array['hi-IN','bn-IN','ta-IN','te-IN','mr-IN'])[((i - 1) % 5) + 1],
  (array['hi-IN','bn-IN','ta-IN','te-IN','mr-IN'])[((i - 1) % 5) + 1],
  '2026-07-20T09:00:00Z'::timestamptz + ((i - 1) * interval '3 hours'),
  '2026-07-20T09:14:00Z'::timestamptz + ((i - 1) * interval '3 hours'),
  'audited'
from generate_series(1, 50) as i
on conflict (id) do nothing;

insert into public.violations (
  id, call_id, kind, ts_ms, utterance, claim_made, contradicted_by,
  severity, suggested_correction, disclosure_id, detected_lang, source, created_at
)
select
  'seed-v-' || lpad(i::text, 2, '0'),
  'seed-call-' || lpad((((i - 1) / 2) + 1)::text, 2, '0'),
  case when i % 5 = 0 then 'omission' else 'contradiction' end,
  case when i % 5 = 0 then 0 else 4000 + (i * 250) end,
  case
    when i % 5 = 0 then ''
    else (array['Guaranteed 12% return','Withdraw anytime','No surrender charge','Risk-free investment'])[((i - 1) % 4) + 1]
  end,
  case
    when i % 5 = 0 then null
    else (array['Guaranteed 12% return','Withdraw anytime','No surrender charge','Risk-free investment'])[((i - 1) % 4) + 1]
  end,
  case
    when i % 5 = 0 then 'The required disclosure was never stated.'
    else 'The official product document does not support this promise.'
  end,
  case when i % 7 = 0 then 'low' else 'high' end,
  case when i % 5 = 0 then null else
    'Use the exact documented term and explain that projected returns are not guaranteed.'
  end,
  case when i % 5 = 0 then 'free_look' else null end,
  (array['hi-IN','bn-IN','ta-IN','te-IN','mr-IN'])[((i - 1) % 5) + 1],
  'both',
  '2026-07-20T09:00:00Z'::timestamptz + ((i - 1) * interval '4 hours')
from generate_series(1, 40) as i
on conflict (id) do nothing;
