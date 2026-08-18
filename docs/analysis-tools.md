# Route Exposure Simulator (§3) and Air Quality Time Machine (§4)

Two analysis tools over the recorded series, on a **web-only dashboard** at `/analyse/simulator`
and `/analyse/time-machine`. Both are wide-form — a multi-column setup panel, a timeline
scrubber with a tick per frame, side-by-side result cards — so the tab that opens them is
mounted only on web (`MainTabs`). The phone app is unchanged.

## What the simulator computes, and what it does not

Given a route, a departure time and a travel speed, it works out what the stations along the
way were measuring when a traveller would have been standing on each point, and summarises the
walk as time-weighted statistics.

That is **environmental exposure**: concentration integrated over the time spent in it. It is
not a dose. Nothing models breathing rate or deposition, and the API says so in the payload
itself (`disclaimer`), not only here — any client rendering this is rendering a claim about
air, never about a person (TDD §1.2/§14).

The verdict logic is untouched: `classify_env()` still reads PM2.5 alone. The simulator adds
measurement, not judgement.

## The pipeline

```
start + destination
   └─ routing.get_route()        OSRM, or a straight line, recorded either way
        └─ resample_route()      a point every `sampling_distance_m` (§3.3)
             └─ assign_times()   distance / speed -> each point's own timestamp (§3.4)
                  └─ nearest_sensor()   within `max_sensor_distance_m`, else NO DATA (§3.5)
                       └─ value_at()    linear / nearest / none, bounded by `max_gap_s` (§3.8)
                            └─ summarize_parameter()   avg, min, max, integral, time above (§3.9/§3.10)
```

Everything from `resample_route` down is in `intelligence/simulate.py` and is pure — no
network, no database — so the arithmetic is testable on its own
(`intelligence/tests/test_simulate.py`).

One query per run, not one per point: the API fetches every candidate sensor's series across
the whole travel window once, and the pure module interpolates locally.

### Where a value is refused

- **No station within range** → the point carries no sensor and no values, and counts against
  coverage. The next station along is measuring a different street; reporting it here would
  invent a reading for a place nothing observed.
- **The bracketing samples are further apart than `max_gap_s`** (default 900 s) → `None`. Two
  readings 40 minutes apart say nothing about the twenty minutes between them.
- **A segment with one measured end** → not integrated. One measured point beside an
  unmeasured one describes an instant, not a span. The same rule governs
  `intelligence/exposure.py`.

### Integration rule

Trapezoidal, matching `intelligence/exposure.py`, so one walk is not measured two different
ways depending on which screen is asking.

**This differs from the specification's worked example.** For §3.9's four readings
(20, 30, 50, 40 at five-minute spacing) the spec's rectangle rule gives 700 µg·min/m³; the
trapezoid gives 550 over the 15 minutes those four points actually span. The spec's figure
treats each reading as holding flat for a whole five-minute block, which is a fifth block of
time the samples do not cover. The trapezoid is used because the readings are samples of a
continuously varying quantity, and because the exposure timeline already integrates that way.

### Thresholds

`time_above_threshold` needs a line to measure against. PM2.5 reuses `pm25_env_caution` (37.5)
so one walk is not measured against two different lines. CO2 (1000 ppm) and TVOC (660 ppb) have
no equivalent in the decision engine because neither has ever been an input to it; those are
the common indoor-air-quality reference points and any caller can override them per request.

All of these are **engineering references for reading a chart**, in the same sense as
`intelligence/config.py`'s environmental thresholds. None is a medical limit.

## Routing

The Longdo Map key does **not** include Route Service — the endpoint answers
`throw 'Route Service API Key Error'`. So routing is a provider behind one interface
(`core_api/app/routing.py`):

- **`osrm`** (default) — the public demo server. No key needed. No SLA, and heavy use should be
  self-hosted; set `OSRM_BASE_URL` to your own instance.
- **`straight-line`** — a great-circle line, no network.

Every result carries the provider that produced it, and a straight-line fallback says so in
`route.note`. A simulation over a straight line is a different claim from one over streets.

The public demo server is built with the car profile and answers every profile from it, so a
"walking" route follows the road network. That is stated in `route.note` too. The *timing*
always uses the requested speed, so the walk being modelled is the one asked for.

## The Time Machine

`GET /replay/data` returns frames — one timestamp, every selected station's values at it — at
a resolution the browser can hold. Playback is entirely client-side: the cursor, the speed
multiplier and pause/resume never touch the network, because a timeline that re-queried on
every step would be unusable.

- **Downsampling** (§4.17): `10s / 1m / 5m / 15m / 1h`, via InfluxDB `aggregateWindow`. A span
  needing more than `MAX_FRAMES` (3000) is **coarsened, not truncated** — and the response says
  `interval_coarsened: true`. Silently coarsening would draw a smooth line over a spike;
  silently truncating would hide the end of what was asked for.
- **Gaps**: `createEmpty: false`. A window a station wrote nothing in is absent from that
  station's frame, never carried forward. A marker still reading 25 µg/m³ through an outage is
  indistinguishable from a station that is genuinely steady.
- **Compare** (§4.12): each side is the mean over a window centred on its instant, not a single
  sample. At 30 s cadence one point is noise, and a difference between two noisy points reads
  as a change that never happened. Percent change is `null` against a zero baseline rather than
  infinite.
- **Export** (§4.19): CSV and JSON. An empty cell means the station recorded nothing in that
  window — deliberately empty rather than `0`, so a spreadsheet cannot average an outage into
  the data. PNG/PDF are not implemented.

## Saved runs and bookmarks

`infra/supabase/004_simulator_and_replay.sql` adds `exposure_simulations`, `exposure_results`
and `replay_bookmarks`. All three are owner-only under RLS with no anon policy: a route someone
travelled is not a health record, but it says where they were and when.

Saved runs store their **sampling settings** alongside the summary. A result computed at 50 m
spacing is a different measurement of the same walk than one at 200 m, and a saved figure whose
settings were lost cannot be interpreted or reproduced.

Re-opening a saved run re-reads the series rather than trusting the stored summary, so a
correction to the underlying data is never contradicted by a stale number in Postgres.

## Demo data

Both tools are about air varying from place to place, and one station cannot show that: every
route point in range resolves to the same sensor, so the exposure graph is a flat line and the
heat route is one colour. A live run against the single real node measured 36.8% coverage and a
0.9 µg/m³ spread across an 879 m walk — correct, and unreadable as a demonstration.

`scripts/seed_demo_nodes.py` places five stations along a corridor through Trat and gives each
a character (a roadside node peaks at rush hour, a park runs cleanest, an indoor node carries
the CO2):

```
python scripts/seed_demo_nodes.py --days 3 --dry-run   # preview
python scripts/seed_demo_nodes.py --days 3             # register + write
python scripts/seed_demo_nodes.py --remove             # delete the registry rows
```

Same fence as `scripts/seed_demo.py`: node codes must start with `DEMO-`, every point is tagged
`source="demo"`, and every reading passes the same §5.1 quality gate as real telemetry.

A run across the seeded corridor: 2.24 km, 29.9 min, 91.3% coverage, five sensors, PM2.5 rising
from 19 at the park through 79 at the market and back to 8 indoors.

## Not available

- **PM1** — the spec lists it; `Reading` has no such field and `ingestion/app/writers.py` never
  writes one. It would need a firmware change and a reflash.
- **eCO2 for stations** — deliberately `None` (`adapters.py`): a station's CO2 is a real SCD40
  measurement, and eCO2 is reserved for the SGP30's VOC-derived estimate on the portable.
- **PM10 through the Aeris pipeline** — the values the app shows arrive from the parallel
  AirSentinel ingestion path, which writes under the `node_id` tag. Turn that path off and pm10
  stops appearing.
