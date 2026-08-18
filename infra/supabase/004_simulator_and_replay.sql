-- =============================================================================
-- Aeris — Route Exposure Simulator (§3) + Air Quality Time Machine (§4).
-- Migration 004: apply AFTER 001_aeris_schema.sql and 002_rls.sql.
--
-- Both features read their measurements from InfluxDB. What lives here is only what a user
-- CHOSE — the simulation they set up, the summary it produced, and the moments they marked
-- while replaying. Nothing in these tables is a sensor reading, and re-running a saved
-- simulation reads the series again rather than trusting a stored copy of it.
--
-- Classification (TDD §14): every table below is ENVIRONMENTAL. A route a person travels is
-- not a health record, but it is personal — it says where someone was and when — so it is
-- owner-only under the same RLS rule as devices/exposure_events, with no anon policy.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- exposure_simulations — the inputs of one run (§3.16)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.exposure_simulations (
    id                    uuid primary key default gen_random_uuid(),
    user_id               uuid not null references auth.users (id) on delete cascade,

    label                 text,                       -- e.g. "Building A -> Building B"
    start_lat             double precision not null,
    start_lng             double precision not null,
    destination_lat       double precision not null,
    destination_lng       double precision not null,

    start_time            timestamptz not null,
    travel_mode           varchar(30) not null default 'walking',
    speed_mps             double precision not null,

    -- Sampling settings are stored with the run, not read from today's defaults. A summary
    -- computed at 50 m spacing is a different measurement of the same walk than one at 200 m,
    -- and a saved result whose settings were lost cannot be interpreted or reproduced.
    sampling_distance_m   double precision not null default 50,
    max_sensor_distance_m double precision not null default 300,

    -- Which provider drew the path. A run over a straight line and a run over streets are
    -- not comparable, and the difference must survive in the record.
    route_provider        varchar(30),
    distance_m            double precision,
    duration_s            double precision,
    data_coverage         double precision,           -- 0..1 (§3.11)

    created_at            timestamptz not null default now()
);
create index if not exists exposure_sim_user_idx on public.exposure_simulations (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- exposure_results — one row per parameter of one run (§3.10/§3.16)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.exposure_results (
    id                   uuid primary key default gen_random_uuid(),
    simulation_id        uuid not null references public.exposure_simulations (id) on delete cascade,

    parameter            varchar(30) not null,        -- pm25 | pm10 | co2 | tvoc | temperature | humidity
    unit                 varchar(20),

    average_value        double precision,
    minimum_value        double precision,
    maximum_value        double precision,

    -- Sigma(C x dt) over the route, in <unit>-minutes. Environmental exposure only: this is
    -- concentration integrated over time spent in it, NOT an amount that entered anyone
    -- (TDD §1.2/§14). Null for parameters where integrating is meaningless (temperature).
    exposure_integral    double precision,
    exposure_unit        varchar(30),

    -- Seconds at or above `threshold_value`. The threshold is stored beside the count because
    -- it is a *chosen* engineering reference, not a fixed property of the parameter, and a
    -- duration without the line it was measured against cannot be read.
    threshold_value      double precision,
    time_above_threshold integer,

    sample_count         integer not null default 0,
    covered_s            double precision,
    data_coverage        double precision,

    unique (simulation_id, parameter)
);
create index if not exists exposure_results_sim_idx on public.exposure_results (simulation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- replay_bookmarks — moments marked while replaying (§4.14/§4.15)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.replay_bookmarks (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users (id) on delete cascade,

    -- The instant in the DATA being replayed, not when the bookmark was made. `created_at`
    -- keeps the second, so a note written days later still points at the right minute.
    "timestamp"  timestamptz not null,
    station_id   varchar(50),
    parameter    varchar(30),
    title        varchar(255) not null,
    note         text,

    created_at   timestamptz not null default now()
);
create index if not exists replay_bookmarks_user_idx on public.replay_bookmarks (user_id, "timestamp" desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — owner-only, no anon policy (see 002_rls.sql for the model)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.exposure_simulations enable row level security;
alter table public.exposure_results     enable row level security;
alter table public.replay_bookmarks     enable row level security;

alter table public.exposure_simulations force row level security;
alter table public.exposure_results     force row level security;
alter table public.replay_bookmarks     force row level security;

drop policy if exists exposure_sim_owner_all on public.exposure_simulations;
create policy exposure_sim_owner_all on public.exposure_simulations
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Results have no user_id of their own; ownership is inherited through the run they belong
-- to. Written as an EXISTS against the parent so a result can never be reached by anyone the
-- parent's own policy would refuse.
drop policy if exists exposure_results_owner_all on public.exposure_results;
create policy exposure_results_owner_all on public.exposure_results
    for all to authenticated
    using (exists (select 1 from public.exposure_simulations s
                   where s.id = simulation_id and s.user_id = auth.uid()))
    with check (exists (select 1 from public.exposure_simulations s
                        where s.id = simulation_id and s.user_id = auth.uid()));

drop policy if exists replay_bookmarks_owner_all on public.replay_bookmarks;
create policy replay_bookmarks_owner_all on public.replay_bookmarks
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
