-- =============================================================================
-- Aeris — Migration 003: action plan, emergency contacts, SOS events, inhaler use.
-- Apply AFTER 001_aeris_schema.sql and 002_rls.sql.
--
-- Covers the app functions the software design specifies but 001 had no home for:
-- Asthma Action Plan Interface, SOS Flow, and the inhaler-use part of the symptom diary.
--
-- Safety model (TDD §1.2, §9, §14) baked into the schema itself:
--   * The action plan is USER/CLINICIAN AUTHORED TEXT. Aeris stores and displays it and never
--     generates, edits, or reorders medical instructions — hence free-text steps plus an
--     `author` column recording who wrote it, and no severity/medication logic anywhere here.
--   * SOS is consent-gated at the data layer: `location_sharing` in privacy_consents already
--     decides whether coordinates may be stored at all, so lat/lon are nullable and an SOS
--     with no location is a complete, valid row rather than an error.
--   * Everything here is HEALTH-LINKED and gets the same owner-only RLS as symptom_events,
--     with no anon policy at all.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- symptom_events — inhaler use is recorded as a diary entry like any other event.
-- Kept in the same table (not a new one) so Exposure Timeline and Correlation Analysis see
-- one ordered history. `inhaler_used` is a plain flag: the app records that the user says
-- they used it, and never advises for or against using it.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.symptom_events
    add column if not exists inhaler_used boolean not null default false;

-- ─────────────────────────────────────────────────────────────────────────────
-- action_plans — the plan the user's healthcare professional gave them (HEALTH-LINKED).
-- One current plan per user. Steps are stored verbatim, in the order the author wrote them.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.action_plans (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null unique references auth.users (id) on delete cascade,
    -- who authored the content; Aeris is never a valid author
    author        text not null default 'user'
                      check (author in ('user', 'clinician')),
    clinician_name text,
    reviewed_at   timestamptz,                            -- when a professional last reviewed it
    -- Steps for each band, verbatim. Band names match the app's watch vocabulary; the design
    -- doc's Green/Yellow/Red map onto Normal/Caution/High.
    normal_steps  text[] not null default '{}',
    caution_steps text[] not null default '{}',
    high_steps    text[] not null default '{}',
    emergency_steps text[] not null default '{}',
    notes         text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists action_plan_user_idx on public.action_plans (user_id);

drop trigger if exists trg_action_plan_updated_at on public.action_plans;
create trigger trg_action_plan_updated_at
    before update on public.action_plans
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- emergency_contacts — who the user chose to be notified on SOS (HEALTH-LINKED).
-- `notify_on_sos` is per-contact consent; a stored contact is not implicit permission.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.emergency_contacts (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users (id) on delete cascade,
    name          text not null,
    phone         text,
    relationship  text,
    notify_on_sos boolean not null default true,
    sort_order    smallint not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists emergency_contact_user_idx
    on public.emergency_contacts (user_id, sort_order);

drop trigger if exists trg_emergency_contact_updated_at on public.emergency_contacts;
create trigger trg_emergency_contact_updated_at
    before update on public.emergency_contacts
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- sos_events — an emergency event the USER raised (HEALTH-LINKED).
-- Raised from the app or forwarded from the portable's SOS button over BLE. Aeris records it
-- and shows the user's own action plan; it never assesses whether the situation is a medical
-- emergency and never contacts emergency services on the user's behalf.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.sos_events (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references auth.users (id) on delete cascade,
    device_id      text,                                   -- external id of the portable, if any
    source         text not null default 'app'
                       check (source in ('app', 'portable')),
    occurred_at    timestamptz not null default now(),
    -- Null whenever privacy_consents.location_sharing = 'none', or the fix was unavailable.
    lat            double precision,
    lon            double precision,
    location_accuracy_m double precision,
    -- Which environmental snapshot was current when it happened, for later review. Never used
    -- to judge the event.
    pm25           double precision,
    notified_contacts integer not null default 0,
    acknowledged_at timestamptz,
    note           text,
    created_at     timestamptz not null default now()
);
create index if not exists sos_user_time_idx
    on public.sos_events (user_id, occurred_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — owner-only, no anon policy (same posture as symptom_events).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.action_plans       enable row level security;
alter table public.emergency_contacts enable row level security;
alter table public.sos_events         enable row level security;

alter table public.action_plans       force row level security;
alter table public.emergency_contacts force row level security;
alter table public.sos_events         force row level security;

drop policy if exists action_plans_owner_all on public.action_plans;
create policy action_plans_owner_all on public.action_plans
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists emergency_contacts_owner_all on public.emergency_contacts;
create policy emergency_contacts_owner_all on public.emergency_contacts
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists sos_events_owner_all on public.sos_events;
create policy sos_events_owner_all on public.sos_events
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
