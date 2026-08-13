-- =============================================================================
-- Aeris — Row Level Security (TDD §9 least-privilege / RLS, §14 separation).
-- Migration 002: apply AFTER 001_aeris_schema.sql.
--
-- Model:
--   * Supabase exposes three DB roles to the API:
--       - anon           : unauthenticated (public dashboard). Gets ONLY what a policy allows.
--       - authenticated  : a logged-in user; auth.uid() = their JWT `sub`.
--       - service_role   : the backend key. Has BYPASSRLS, so the FastAPI service is unaffected
--                          by these policies. RLS below is defense-in-depth for direct
--                          anon / authenticated (mobile) access.
--   * Ownership rule: a user may touch a row only when auth.uid() = row.user_id.
--
-- CRITICAL (TDD §9/§14): symptom_events (and all HEALTH-LINKED tables) grant NO anon access.
-- There is deliberately no `anon` policy on them, so RLS denies the anon role by default —
-- private symptom data can never reach a public dashboard.
--
-- ENVIRONMENTAL vs HEALTH separation:
--   ENVIRONMENTAL : devices, exposure_events      (could later be opt-in shareable)
--   HEALTH-LINKED : symptom_events, personal_baseline, patterns, decision_events, privacy_consents
--   Neither group is exposed to anon here; sharing, if ever added, must be an explicit opt-in
--   policy gated on privacy_consents.share_environmental — never a blanket anon read.
-- =============================================================================

-- 1) Enable (and force) RLS on every table. FORCE also applies RLS to the table owner.
alter table public.devices           enable row level security;
alter table public.exposure_events   enable row level security;
alter table public.symptom_events    enable row level security;
alter table public.personal_baseline enable row level security;
alter table public.patterns          enable row level security;
alter table public.decision_events   enable row level security;
alter table public.privacy_consents  enable row level security;

alter table public.devices           force row level security;
alter table public.exposure_events   force row level security;
alter table public.symptom_events    force row level security;
alter table public.personal_baseline force row level security;
alter table public.patterns          force row level security;
alter table public.decision_events   force row level security;
alter table public.privacy_consents  force row level security;

-- 2) Owner-only policies (authenticated role). auth.uid() = user_id for read AND write.
--    Using `for all` with a matching WITH CHECK prevents inserting/updating rows for another user.

-- devices (ENVIRONMENTAL) --------------------------------------------------------
drop policy if exists devices_owner_all on public.devices;
create policy devices_owner_all on public.devices
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- exposure_events (ENVIRONMENTAL) -----------------------------------------------
drop policy if exists exposure_owner_all on public.exposure_events;
create policy exposure_owner_all on public.exposure_events
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- symptom_events (PRIVATE HEALTH — owner only, NEVER anon) -----------------------
-- No anon policy exists, so the anon role is denied by default. This is the hard
-- guarantee in TDD §9: symptom data never reaches a public/anon reader.
drop policy if exists symptom_owner_all on public.symptom_events;
create policy symptom_owner_all on public.symptom_events
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- personal_baseline (HEALTH-LINKED — owner only) --------------------------------
drop policy if exists baseline_owner_all on public.personal_baseline;
create policy baseline_owner_all on public.personal_baseline
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- patterns (HEALTH-LINKED — owner only) -----------------------------------------
drop policy if exists patterns_owner_all on public.patterns;
create policy patterns_owner_all on public.patterns
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- decision_events (HEALTH-LINKED — owner only) ----------------------------------
drop policy if exists decision_owner_all on public.decision_events;
create policy decision_owner_all on public.decision_events
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- privacy_consents (owner only) -------------------------------------------------
drop policy if exists privacy_owner_all on public.privacy_consents;
create policy privacy_owner_all on public.privacy_consents
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- 3) Belt-and-suspenders: make sure the anon role has NO table privileges on the
--    private health tables, so even a future RLS misconfiguration cannot leak them.
revoke all on public.symptom_events    from anon;
revoke all on public.personal_baseline from anon;
revoke all on public.patterns          from anon;
revoke all on public.decision_events   from anon;
revoke all on public.privacy_consents  from anon;

-- NOTE: the FastAPI backend uses the service_role key (BYPASSRLS) and is unaffected by the
-- above. Any future direct-from-mobile Supabase access must authenticate as the user so that
-- auth.uid() is populated; otherwise every policy above evaluates false and access is denied.
