# Aeris — Infrastructure (`infra/`)

Infrastructure-as-code for the Aeris free stack (TDD §13). Nothing here contains a secret —
every credential is referenced by name and lives only in a gitignored `.env` (local) or in the
Render / GitHub secret stores.

| File | Purpose |
|------|---------|
| `Dockerfile` | `python:3.12-slim` image, non-root, runs `uvicorn core_api.app.main:app`. Build context = repo root. |
| `render.yaml` | Render Blueprint: one free Docker web service `aeris-core-api`, health check `/health`. |
| `supabase/001_aeris_schema.sql` | Tables (TDD §8): `devices`, `exposure_events`, `symptom_events`, `personal_baseline`, `patterns`, `decision_events`, `privacy_consents`. |
| `supabase/002_rls.sql` | Enables Row Level Security + owner-only policies. `symptom_events` is never anon-readable. |
| `influx/tasks.flux` | 5-minute mean downsampling of the `air_quality` measurement into an archive bucket. |

## Free-tier trade-offs (see `docs/DECISIONS.md`)

- Render free web service **sleeps on idle** (~50 s cold start). So there is **no persistent MQTT
  subscriber** in the service — station data arrives via **HiveMQ webhook → FastAPI HTTP**
  (`POST /webhook/telemetry`, HMAC-signed with `WEBHOOK_SECRET`).
- InfluxDB Cloud Free has ~30-day retention + a write-rate cap → downsample early (`influx/tasks.flux`).
- Images build in **GitHub Actions** (local Docker not required) and publish to **GHCR**.

## 1. Apply the Supabase SQL

In the Supabase dashboard → **SQL Editor**, run the two files **in order**:

1. `supabase/001_aeris_schema.sql`  (tables, indexes, `updated_at` triggers)
2. `supabase/002_rls.sql`           (enable RLS + policies)

Both are idempotent (`create ... if not exists`, `drop policy if exists`), so re-running is safe.
After applying, confirm RLS is on: Supabase → **Authentication → Policies** should list an
owner-only policy on every table, and `symptom_events` must show **no anon policy**.

> The backend connects with the **service_role** key (bypasses RLS) over PostgREST. RLS is
> defense-in-depth for any future direct-from-mobile access, where the user's JWT populates
> `auth.uid()`.

## 2. Create the Influx task

1. InfluxDB Cloud UI → **Buckets** → create `sensor_data_archive` (longer retention than the raw
   `sensor_data` bucket).
2. **Data → Tasks → Create Task** → paste `influx/tasks.flux` (or `influx task create -f infra/influx/tasks.flux`).
3. If your live bucket is not `sensor_data`, edit `srcBucket` to match `INFLUXDB_BUCKET`.

## 3. Deploy to Render (Blueprint)

1. Render dashboard → **New → Blueprint** → point at `nattawat-ootalp/aeris` (Render reads
   `infra/render.yaml`). Or run `render blueprint launch`.
2. Render will prompt for every `sync: false` env var — fill them from your `.env`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `INFLUXDB_URL`,
   `INFLUXDB_TOKEN`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`, `HIVEMQ_HOST`, `HIVEMQ_PORT`,
   `HIVEMQ_USERNAME`, `HIVEMQ_PASSWORD`, `JWT_SECRET`, `WEBHOOK_SECRET`, `CORS_ORIGINS`.
3. First deploy builds `infra/Dockerfile` and starts the service. Health check is `/health`.

## 4. CI/CD (`.github/workflows/ci.yml`)

- **test** — runs on every push/PR: `ruff check .` + `pytest` on Python 3.12.
- **build-push** — only on push to `main`: builds `infra/Dockerfile` and pushes
  `ghcr.io/nattawat-ootalp/aeris:latest` and `:<sha>` using the built-in `GITHUB_TOKEN`.
- **deploy** — only on push to `main`, and only if the **`RENDER_DEPLOY_HOOK`** secret is set;
  otherwise it self-skips (CI stays green before the Render service exists).

### Secrets — where each one goes

| Secret | Where to set it |
|--------|-----------------|
| All 14 app env vars (Supabase / Influx / HiveMQ / JWT / WEBHOOK / CORS) | **Render** service env (`sync: false` in `render.yaml`) |
| `GITHUB_TOKEN` | Provided automatically by GitHub Actions (no action needed) |
| `RENDER_DEPLOY_HOOK` | **GitHub → repo Settings → Secrets → Actions** (optional; enables the deploy job) |

## Human action required

- Enter the 14 Render env vars in the Render dashboard (they are intentionally not in git).
- Apply both Supabase SQL files manually (Supabase has no auto-migration runner on free tier).
- Create the `sensor_data_archive` bucket + Influx task manually.
- (Optional) Add `RENDER_DEPLOY_HOOK` in GitHub to enable auto-deploy after a `main` build.
