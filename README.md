# Aeris — Personal Environmental Exposure & Decision Support

Aeris extends **AirSentinel** from area-level air-quality monitoring to **individual exposure tracking
and explainable, non-diagnostic decision support** for people with asthma.

> **Not a medical device.** Aeris reports *environmental* status and *device* health. It never diagnoses,
> never confirms a symptom's cause, never prescribes, and never guarantees that no asthma attack will occur.
> It never uses the word **"SAFE"** as a medical assurance. See [docs/DECISIONS.md](docs/DECISIONS.md).

Authoritative design: **[docs/aeris-tdd.md](docs/aeris-tdd.md)** (the Aeris Technical Design Document).
Where we run the AWS design on a **free stack**, the trade-offs are recorded in
**[docs/DECISIONS.md](docs/DECISIONS.md)** — never left silent.

## Architecture (free stack)

```
Portable (ESP32-S3 + PMS7003 + SCD40) ──BLE──▶ Phone ──HTTPS POST─┐
                                                                   ├─▶ FastAPI (Render Free)
Station (AirSentinel node) ──MQTT/TLS──▶ HiveMQ Cloud ──webhook────┘        │
                                                                            ▼
                    shared validation → InfluxDB Cloud + Supabase → Intelligence
                    (quality → exposure → baseline → pattern → decision → explainability)
                                                                            ▼
                                                        Mobile / Watch  ·  WS /ws/realtime
```

| Layer | Tech (free) | Replaces (TDD §13) |
|-------|-------------|--------------------|
| IoT messaging | HiveMQ Cloud Free (MQTT 5.0/TLS) | AWS IoT Core |
| Ingestion + API | FastAPI (Python 3.12) on Render Free (Docker) | Lambda + Kinesis |
| Time-series | InfluxDB Cloud Free | InfluxDB (self) |
| Relational | Supabase Free (PostgreSQL 16 + RLS) | PostgreSQL (self) |
| Images / CI | GHCR + GitHub Actions | ECR/ECS Fargate |
| Monitoring | Grafana Cloud Free | CloudWatch |

## Repository layout

| Path | What |
|------|------|
| `firmware/portable/` | ESP32-S3 firmware. Reuses AirSentinel sensor-read; **I2C bus-fix copied verbatim** (`DO NOT MODIFY`). |
| `ingestion/` | One validation layer for both transports (station webhook + portable POST) → InfluxDB + Supabase. |
| `intelligence/` | Pure-Python, testable: quality · exposure · baseline · pattern · decision · persistence/hysteresis/cooldown · explainability (TDD §5). |
| `core-api/` | FastAPI: telemetry/history/alerts/ranking/threshold, decision/exposure/symptom, Destination Assessment (§6), `WS /ws/realtime`. |
| `mobile/` | React Native (Expo). MVP screens + Watch (Normal/Caution/High/No Data). |
| `infra/` | Dockerfile, `render.yaml`, Supabase SQL+RLS migrations, Influx tasks. |
| `docs/` | `aeris-tdd.md` (spec), `DECISIONS.md` (trade-offs). |
| `.github/workflows/` | CI: ruff + pytest → build → GHCR → Render deploy. |

## Local development

```bash
cp .env.example .env      # fill in (reuses AirSentinel free-tier accounts)

# Intelligence + backend (Python)
python -m venv .venv && . .venv/Scripts/activate    # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest                     # intelligence + ingestion unit tests
uvicorn core_api.app.main:app --reload   # http://localhost:8000/docs
```

> Docker is **not** required locally — images build in CI. Local Python is 3.14; the deployed runtime is pinned to 3.12.

## Build phases (TDD §11)

- **MVP-1** Portable + local caution (firmware + intelligence) — *in progress*
- **MVP-2** AirSentinel integration → Destination Assessment
- **MVP-3** Event/exposure → data pipeline (ingestion)
- **MVP-4** Personal pattern → association + confidence
- **Research** Predictive modeling — only with enough data + validation

## Security & privacy (TDD §9)

MQTT over TLS · least-privilege RLS · location minimization · encryption in transit/at rest ·
retention + sync withdrawal · per-device identity (X.509). `symptom_events` are private and never
appear on any public dashboard (enforced by RLS). Secrets live only in gitignored `.env` / Render env — never committed.
