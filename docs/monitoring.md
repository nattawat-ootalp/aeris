# Monitoring and logging (Grafana Cloud)

Every failure this system has had was silent.

The station stopped publishing and nothing said so. The bridge went to sleep on Render's free
plan and nothing said so. The API cold-started and eleven readings were dropped without a trace
anywhere anyone could see. In each case every request still returned 200, no log line was an
error, and the fault was found only because someone happened to look.

That is what this is for. Not dashboards for their own sake — a way for absence to be visible.

## Why it is pushed, not scraped

Grafana Cloud normally expects an agent (Alloy) running beside the process to scrape it. There
is nowhere to run one: Render's free plan gives one container per service and no sidecar.

So both signals are plain HTTPS pushes the process makes itself:

| Signal | Endpoint | Why this one |
|---|---|---|
| Logs | Loki `/loki/api/v1/push` | Takes JSON; no agent needed |
| Metrics | Graphite `/graphite/metrics` | Takes `path value timestamp` lines — no protobuf or snappy, unlike Prometheus remote-write |

Both are batched on a background thread. Nothing in `observability/` may block the request that
produced it and nothing may raise into it: a monitoring system that takes down the thing it
monitors is worse than no monitoring. Failures are counted and printed to stderr, never
re-raised.

## Setup

Create one **Cloud Access Policy token** in Grafana Cloud with `logs:write` and `metrics:write`,
then read the two numeric user ids off the Loki and Graphite datasource pages
(**Home → Connections → Data sources → …→ Details**).

Set these on both Render services (`aeris-core-api` and `aeris-station-bridge`):

```
GRAFANA_LOKI_URL=https://logs-prod-XXX.grafana.net/loki/api/v1/push
GRAFANA_LOKI_USER=<numeric user id>
GRAFANA_GRAPHITE_URL=https://graphite-prod-XX.grafana.net/graphite/metrics
GRAFANA_GRAPHITE_USER=<numeric user id>
GRAFANA_API_TOKEN=<the access policy token>
GRAFANA_ENVIRONMENT=core-api        # or station-bridge
```

With any of them unset the process logs to stdout and ships nothing. That is deliberate: a
deploy that forgets its credentials should degrade, not fail.

Confirm it took by reading the service's own health:

```
curl https://aeris-core-api.onrender.com/health
```

```json
{"status":"ok","service":"aeris-core-api",
 "observability":{"logs":true,"metrics":true,"dropped":0,"push_failures":0}}
```

`push_failures` climbing means the credentials are wrong or the endpoint is refusing — the
service keeps serving traffic either way, which is why the number has to be checked rather
than waited for.

## What is measured

All metrics are prefixed `aeris.<service>.`, with Graphite tags for grouping.

**Station liveness** — the one that matters most, from `GET /monitor/stations`:

| Metric | Meaning |
|---|---|
| `station.reading_age_sec` | Seconds since a station's newest reading. Climbs when a station goes quiet. |
| `station.silent` | 0/1 per station, past `silent_after_s` (default 900) |
| `station.silent_total` | Active, non-demo stations currently silent — **wire the alert to this** |
| `station.pm25` | Latest PM2.5 per station |

**Ingestion** (`ingestion/app/router.py`):

`ingest.accepted`, `ingest.rejected` (tagged with the reason — `clock_unsynced`,
`store_failed`), `ingest.reading_age_sec`, `ingest.pm25_valid`, `reading.pm25`.

**Bridge** (`ingestion/mqtt_bridge.py`):

`bridge.received`, `bridge.forwarded`, `bridge.forward_failed` (tagged `transport` / `http` /
`rejected`), `bridge.mqtt_connected`, `bridge.mqtt_disconnected`.

`bridge.received` and `bridge.forwarded` are separate on purpose. "The broker delivered
nothing" and "the forward failed" are different faults with different fixes, and one counter
cannot tell them apart — which is exactly the confusion that cost an hour on 2026-08-18.

**HTTP** (`core_api/app/telemetry_middleware.py`):

`http.requests`, `http.duration_ms`, `http.server_errors`, tagged by route template, method
and status. The route *template* is recorded, not the URL: `/nodes/{device_id}/telemetry` is
one series, not one per device.

## The station-silence check needs a scheduler

`/monitor/stations` computes the freshness metrics as a side effect of answering. It is an
endpoint rather than a background job because Render's free plan has no scheduler — and
because the same external pinger that already keeps the free services awake can call it, so
one cron entry does both jobs.

Add it beside the pingers already in Supabase (`pg_cron` + `pg_net`):

```sql
select cron.schedule(
  'monitor-aeris-stations',
  '*/5 * * * *',
  $$ select net.http_get(url := 'https://aeris-core-api.onrender.com/monitor/stations') $$
);
```

Five minutes, not ten: this both keeps the API awake and sets how quickly a silent station can
be noticed, and a 15-minute silence threshold checked every 10 minutes can take 25 minutes to
fire.

## Demo nodes are excluded from the alert

Stations seeded by `scripts/seed_demo_nodes.py` hold backfilled history and by design never
report again, so they are permanently "silent". They are listed and measured like any other,
but kept out of `station.silent_total` — an alert that fires forever is the fastest way to
teach everyone to ignore alerts.

Inactive registry rows (`nodes.status` not active) are excluded for the same reason. The alert
is for hardware that *was* reporting and stopped.

## Suggested alerts

| Alert | Condition | Why |
|---|---|---|
| Station silent | `station.silent_total > 0` for 10 min | The failure this system actually has |
| Bridge asleep | no `bridge.received` for 10 min | Render free sleeps after ~15 min idle |
| Forwards failing | `bridge.forward_failed` > 0 for 5 min | Wrong `WEBHOOK_SECRET`, or the API cold-starting |
| API erroring | `http.server_errors` > 0 | Ordinary 5xx |
| Shipper blind | `push_failures` climbing on `/health` | Monitoring that stopped monitoring |

## What is deliberately not shipped

Nothing user-scoped. Metrics are tagged by device and route, never by user id, and the log
lines carry no symptom entries, no baselines and no patterns — those are the health-linked
tables under TDD §14, and shipping them to a third-party observability vendor would move
private health data out of the system that promises to keep it.
