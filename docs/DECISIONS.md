# Aeris — Build Decisions & Free-Tier Trade-offs

Authoritative spec: [`aeris-tdd.md`](./aeris-tdd.md) (extracted from `Aeris_Technical_Design_Document.docx`).
This file records where we **deviate** from the TDD's AWS design and **why**, per the master-prompt rule
"if free-tier conflicts with the design, pick free-tier and state the trade-off — never silently."

## Confirmed decisions (2026-08-12)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Spec source | `Aeris_Technical_Design_Document.docx` (mirrors master prompt) |
| 2 | Accounts | **Reuse** AirSentinel free-tier: Supabase / InfluxDB Cloud / HiveMQ. Add Aeris tables/measurements/topics into the same projects. |
| 3 | Deploy | **Real** — GitHub + Render (workspace `tea-d54kt…`, service via Render API key). |
| 4 | Hardware | No portable device; AirSentinel station not physically present. Firmware = reviewed source; station/destination built against existing InfluxDB/Supabase data. |

## Free-tier substitutions (TDD §13 AWS → free stack)

| TDD design | Aeris uses | Trade-off to know |
|------------|-----------|-------------------|
| AWS IoT Core | HiveMQ Cloud Free | 100 conns / 10 GB-mo; X.509 per device supported |
| Lambda + Kinesis | FastAPI on Render Free + **HiveMQ webhook** | No serverless fan-out; webhook-driven HTTP ingestion |
| InfluxDB (self) | InfluxDB Cloud Free | 30-day retention, write-rate limits → downsample early |
| PostgreSQL (self) | Supabase Free | 500 MB, **reached over PostgREST REST** (direct PG port blocked on general networks) |
| ECR/ECS Fargate | GHCR + Render Free | Web service **sleeps on idle** (~50 s cold start) |
| CloudWatch | Grafana Cloud Free | 10K series |

## Architecture trade-offs (consequences of the above)

- **No persistent MQTT subscriber on Render Free.** A Render free *web* service sleeps and can't hold a long-lived MQTT connection. So Station data uses **HiveMQ webhook → FastAPI HTTP** (`POST /webhook/telemetry`, HMAC-signed). If a native HiveMQ→HTTP bridge is unavailable on the free plan, the `mqtt_bridge` runs on an always-on host (the station gateway or a local PC), never inside the Render web service.
- **Local Docker not installed** on the build machine → images build in **GitHub Actions**; local dev runs the backend via `uvicorn`/`python`, not `docker compose`.
- **Runtime pin:** local Python is 3.14, but Docker/CI pin **Python 3.12** (TDD §13) for the deployed runtime.
- **Firmware not on-device tested** (no hardware). Verified by inspection; optional `arduino-cli` compile-check if enabled. The AirSentinel **I2C bus-fix block is copied verbatim** and marked `DO NOT MODIFY`.

## Engineering tunables are NOT medical thresholds

Values like `PM25_ENV_CAUTION` (default 37.5) are **engineering/environmental** thresholds — testable and config-driven
(`.env`), never called "medical thresholds" (TDD §5.2, §14). Defaults reference public air-quality guidance
(WHO 2021 / PCD Thailand) for the *environmental state* label only; they do **not** assert medical safety.
See [medical-safety rules](#medical-safety-non-negotiable).

## Medical safety (non-negotiable) — TDD §1.2, §9, §14

- Non-diagnostic: never diagnose, confirm symptom cause, prescribe, or guarantee no attack.
- No association → medical probability without validation. Patterns always carry **sample size + uncertainty**.
- **"SAFE" is banned** as medical assurance. Watch shows only **Normal / Caution / High / No Data**.
- Keep separate: environmental status ≠ device health ≠ medical boundary.
- Invalid PM sensor → **no PM-based caution**. Stale data → **stale/unavailable**, never reused as current.
- `symptom_events` never reach any public dashboard — enforced at DB with RLS.
