-- =============================================================================
-- Aeris — Supabase / PostgreSQL 16 schema (TDD §8)
-- Migration 001: tables.  RLS + policies are in 002_rls.sql (apply BOTH, in order).
--
-- Design notes:
--   * UUID primary keys (gen_random_uuid(), from pgcrypto — enabled by default on Supabase).
--   * Ownership: every row carries user_id -> auth.users(id). This is what RLS keys on so a
--     user only ever sees their own rows (TDD §9 least-privilege). `org` is kept as a scoping
--     label for station data isolation.
--   * SEPARATION (TDD §14): environmental data (devices, exposure_events) is kept distinct from
--     private health data (symptom_events, personal_baseline, patterns). symptom_events is the
--     most sensitive table and is locked down hardest in 002_rls.sql.
--   * The backend reaches Supabase over PostgREST using the service_role key (BYPASSRLS), so RLS
--     here is defense-in-depth for any anon / authenticated (mobile) direct access.
-- =============================================================================

create extension if not exists pgcrypto;

-- Auto-maintain updated_at on rows that have it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- devices — portable + station registry (ENVIRONMENTAL / device identity, TDD §9)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.devices (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users (id) on delete cascade,
    org          text,                                   -- station org label (isolation scope)
    external_id  text not null,                          -- e.g. portable "P001" or station node_id
    kind         text not null default 'portable'
                     check (kind in ('portable', 'station')),
    label        text,
    fw_version   text,
    last_seen    timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (user_id, external_id)
);
create index if not exists devices_user_idx on public.devices (user_id);
create index if not exists devices_org_idx  on public.devices (org);

drop trigger if exists trg_devices_updated_at on public.devices;
create trigger trg_devices_updated_at
    before update on public.devices
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- exposure_events — aggregated exposure windows (§5.3, ENVIRONMENTAL)
-- Time-series raw samples live in InfluxDB; this stores the derived windows.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.exposure_events (
    id                          uuid primary key default gen_random_uuid(),
    user_id                     uuid not null references auth.users (id) on delete cascade,
    device_id                   uuid references public.devices (id) on delete set null,
    window_start                timestamptz not null,
    window_end                  timestamptz not null,
    mean_pm25                   double precision,        -- null when no covered time (§5.3)
    duration_above_concern_sec  double precision not null default 0,
    covered_sec                 double precision not null default 0,
    sample_count                integer not null default 0,
    event_count                 integer not null default 0,
    created_at                  timestamptz not null default now()
);
create index if not exists exposure_user_time_idx
    on public.exposure_events (user_id, window_start desc);
create index if not exists exposure_device_idx
    on public.exposure_events (device_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- symptom_events — PRIVATE HEALTH DATA (§7, §9).
-- MUST NEVER reach a public dashboard or the anon role. Locked down in 002_rls.sql.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.symptom_events (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users (id) on delete cascade,
    occurred_at   timestamptz not null default now(),
    symptom_type  text,                                  -- free/coded label, e.g. "wheeze"
    severity      smallint check (severity between 0 and 10),
    note          text,
    created_at    timestamptz not null default now()
);
create index if not exists symptom_user_time_idx
    on public.symptom_events (user_id, occurred_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- personal_baseline — personal reference range (§5.4, HEALTH-LINKED)
-- median + MAD-based dispersion; only meaningful when ready = true.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.personal_baseline (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users (id) on delete cascade,
    device_id     uuid references public.devices (id) on delete set null,
    metric        text not null default 'pm25',
    ready         boolean not null default false,        -- false => insufficient sample, do NOT personalize
    sample_count  integer not null default 0,
    median        double precision,
    dispersion    double precision,                      -- MAD scaled to std-equivalent
    upper         double precision,                      -- median + k * dispersion
    computed_at   timestamptz not null default now(),
    created_at    timestamptz not null default now()
);
create index if not exists baseline_user_metric_idx
    on public.personal_baseline (user_id, metric);

-- ─────────────────────────────────────────────────────────────────────────────
-- patterns — observational association (§5.5, HEALTH-LINKED).
-- ALWAYS carries sample_size + uncertainty; never a proven cause (TDD §5.5, §14).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.patterns (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users (id) on delete cascade,
    sample_size   integer not null default 0,
    association   double precision,                      -- e.g. proportion; null if insufficient
    uncertainty   double precision,                      -- half-width of a 95% band
    sufficient    boolean not null default false,
    window_sec    double precision,
    note          text not null default 'observational association, not a proven cause',
    computed_at   timestamptz not null default now(),
    created_at    timestamptz not null default now()
);
create index if not exists patterns_user_idx
    on public.patterns (user_id, computed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- decision_events — explainable decision output (§4.1, §5.8).
-- Every row carries reason_codes, freshness and sample_size. NO "SAFE" label (§14):
-- watch_label is constrained to Normal/Caution/High/No Data.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.decision_events (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users (id) on delete cascade,
    device_id     uuid references public.devices (id) on delete set null,
    decision      text not null
                      check (decision in ('NORMAL', 'CAUTION', 'HIGH', 'NO_DATA')),
    confidence    text not null
                      check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
    reason_codes  text[] not null default '{}',
    freshness_sec double precision,
    sample_size   integer not null default 0,
    watch_label   text not null
                      check (watch_label in ('Normal', 'Caution', 'High', 'No Data')),
    created_at    timestamptz not null default now()
);
create index if not exists decision_user_time_idx
    on public.decision_events (user_id, created_at desc);
create index if not exists decision_device_idx
    on public.decision_events (device_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- privacy_consents — per-user privacy / consent controls (§7 Privacy Control, §9).
-- Location minimization + retention + the right to withdraw sync.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.privacy_consents (
    id                   uuid primary key default gen_random_uuid(),
    user_id              uuid not null unique references auth.users (id) on delete cascade,
    sync_enabled         boolean not null default true,   -- withdraw sync => false
    share_environmental  boolean not null default false,  -- opt-in to share env data
    share_symptoms       boolean not null default false,  -- symptoms are never public regardless
    location_sharing     text not null default 'none'
                             check (location_sharing in ('none', 'coarse', 'precise')),
    retention_days       integer not null default 30       -- InfluxDB free retention is ~30d
                             check (retention_days between 1 and 3650),
    consented_at         timestamptz,
    withdrawn_at         timestamptz,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);
create index if not exists privacy_user_idx on public.privacy_consents (user_id);

drop trigger if exists trg_privacy_updated_at on public.privacy_consents;
create trigger trg_privacy_updated_at
    before update on public.privacy_consents
    for each row execute function public.set_updated_at();
