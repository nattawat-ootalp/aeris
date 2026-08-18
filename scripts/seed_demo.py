"""Seed a DEMO device with history, so the history-shaped screens have something to show.

Why this is fenced the way it is
--------------------------------
This repository's central rule is that a value which was never measured is never presented as
if it were — ``ble.cpp`` omits a field rather than sending 0, ``client.ts`` refuses to invent a
current reading, and commit 3d93b03 is titled "Never publish a sensor value that was never
measured". Generated data is the exact thing all of that exists to keep out.

So the generated series is quarantined rather than trusted to be used carefully:

* it can only be written to a device id beginning with ``DEMO-``, checked here and refusing
  anything else, so it can never land in a real device's series;
* it is tagged ``source="demo"`` in InfluxDB, alongside the real ``portable`` and ``station``
  sources, so a query can always tell it apart after the fact;
* it goes through the same §5.1 quality gate as real telemetry, so it cannot enter in a shape
  real data could not have.

What it fills, and what it cannot
---------------------------------
Filled: personal baseline, weekly summary, exposure timeline, daily summary, data quality, and
— with ``--owner`` — the personal pattern screen.

NOT filled: the current reading, current risk and forecast cards. ``intelligence/predict.py``
refuses any series whose newest point is older than ``freshness_max_age_sec`` (120 s), and
``quality.py`` gates usability the same way. Backfilled history is by definition not fresh. Run
``scripts/feed_demo.py`` alongside the demo for those, or connect a real device.

Getting the app to actually show it
-----------------------------------
Writing the history is not enough on its own. ``useActiveDeviceId()`` in
``mobile/src/lib/device.ts`` prefers, in order: the portable connected over BLE, then the first
device registered to the signed-in account, then ``EXPO_PUBLIC_DEFAULT_DEVICE_ID``. The baseline
and pattern endpoints also require auth. So a demo build that is merely pointed at the demo id
by environment variable still shows a real device's (empty) history whenever the demo account
has any device of its own registered.

Pass ``--owner <supabase-user-uuid>`` to register the demo device to the account you will
present with. It then resolves through the normal path, ahead of the environment variable and
without depending on it. The same id files the seeded symptom entries, which are per-user
rather than per-device.

Usage
-----
    python scripts/seed_demo.py --device-id DEMO-ROOM-001 --days 14 --dry-run
    python scripts/seed_demo.py --device-id DEMO-ROOM-001 --days 14 --owner 0c8f...e21

Reads the same INFLUXDB_* / SUPABASE_* settings as the services.
"""
from __future__ import annotations

import argparse
import math
import random
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Run as `python scripts/seed_demo.py` from anywhere in the repo: the script's own directory is
# on sys.path, the repo root is not, so the packages it needs would otherwise be unimportable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core_api.app import analytics, repo  # noqa: E402
from ingestion.app import writers  # noqa: E402 — must follow the sys.path bootstrap above
from ingestion.app.validate import validate  # noqa: E402
from intelligence.config import CONFIG  # noqa: E402
from intelligence.models import Reading  # noqa: E402

#: The only device-id prefix this script will write to. Everything about the seeded series is
#: synthetic, so it must be impossible to aim at a device whose data is real.
DEMO_PREFIX = "DEMO-"

#: Written as the InfluxDB `source` tag, beside the real "portable" and "station". A query can
#: always separate generated points from measured ones after the fact.
DEMO_SOURCE = "demo"

#: One point every two minutes. Deliberately NOT 300 s: ``analytics.segment_timeline`` ends a run
#: at any gap ``> exposure_max_gap_sec``, which is also 300, so a 300 s spacing sits exactly on
#: the boundary and any jitter or config change would shatter the timeline into single-point
#: segments. 120 s leaves clear room and keeps a fortnight near 10k points.
INTERVAL_SEC = 120

#: Elevated-exposure episodes across the seeded span. Without these nothing crosses
#: ``pm25_env_caution`` (37.5): the two diurnal humps peak twelve hours apart and never sum, so
#: the quiet baseline alone tops out near 25. The exposure timeline, the daily and weekly Caution
#: totals, and the pattern screen would then all be empty — or worse, show a confident zero.
EPISODES_PER_WEEK = 5
EPISODE_MIN_HOURS = 2.0
EPISODE_MAX_HOURS = 4.0

#: Symptom entries filed when --owner is given. ``pattern_min_samples`` is 20, so this clears it
#: with a little margin; below it the pattern screen reports "not enough data".
SYMPTOM_COUNT = 26
#: Share of those placed shortly after an elevated-exposure episode. Deliberately not all of
#: them: an association of exactly 1.0 would read as invented, because it would be.
SYMPTOM_AFTER_EPISODE_RATIO = 0.65

SYMPTOM_TYPES = ("cough", "wheeze", "shortness of breath", "chest tightness")


def _episode_windows(
    start: datetime, end: datetime, rng: random.Random
) -> list[tuple[datetime, datetime, float]]:
    """(from, to, peak) for each elevated-exposure period across the span.

    Peaks straddle both decision thresholds on purpose — some episodes reach Caution (37.5) and
    some the High band (75) — so the timeline has more than one level in it and the daily
    summary has both to report.
    """
    span_weeks = max(1.0, (end - start).total_seconds() / (7 * 24 * 3600))
    count = max(1, int(round(EPISODES_PER_WEEK * span_weeks)))
    windows: list[tuple[datetime, datetime, float]] = []
    for _ in range(count):
        offset = rng.uniform(0, (end - start).total_seconds())
        begins = start + timedelta(seconds=offset)
        length = timedelta(hours=rng.uniform(EPISODE_MIN_HOURS, EPISODE_MAX_HOURS))
        peak = rng.choice([48.0, 55.0, 62.0, 88.0, 96.0])
        windows.append((begins, begins + length, peak))
    return sorted(windows)


def _episode_boost(at: datetime, windows: list[tuple[datetime, datetime, float]]) -> float:
    """How much an episode adds at this instant, ramping in and out rather than stepping.

    A square edge would drop a single sample between two levels and split the run in three; a
    smooth rise gives one contiguous elevated segment, which is also what a real excursion
    looks like.
    """
    for begins, ends, peak in windows:
        if not (begins <= at <= ends):
            continue
        span = (ends - begins).total_seconds()
        if span <= 0:
            continue
        phase = (at - begins).total_seconds() / span  # 0 at the edges, 1 in the middle
        return peak * math.sin(math.pi * phase)
    return 0.0


def plausible_pm25(
    at: datetime, rng: random.Random, windows: list[tuple[datetime, datetime, float]]
) -> float:
    """A PM2.5 value with a daily rhythm plus occasional excursions.

    The quiet baseline is deliberately unremarkable: morning and evening bumps around a modest
    level, with enough spread that the median and MAD the personal baseline is built from are
    not degenerate. It is not a model of anything and makes no claim to be — it exists so the
    history screens have a shape to draw.
    """
    hour = at.hour + at.minute / 60.0
    morning = 6.0 * math.exp(-(((hour - 8.0) / 2.0) ** 2))
    evening = 8.0 * math.exp(-(((hour - 19.0) / 2.5) ** 2))
    value = 12.0 + morning + evening + _episode_boost(at, windows) + rng.gauss(0.0, 2.0)
    return round(max(1.0, value), 1)


def build_readings(device_id: str, days: int, now: datetime, seed: int) -> list[Reading]:
    rng = random.Random(seed)
    steps = int(days * 24 * 3600 / INTERVAL_SEC)
    start = now - timedelta(seconds=steps * INTERVAL_SEC)
    windows = _episode_windows(start, now, rng)

    readings: list[Reading] = []
    for i in range(steps, 0, -1):
        at = now - timedelta(seconds=i * INTERVAL_SEC)
        readings.append(
            Reading(
                device_id=device_id,
                timestamp=at,
                pm25=plausible_pm25(at, rng, windows),
                temperature=round(rng.uniform(27.0, 33.0), 1),
                humidity=round(rng.uniform(55.0, 78.0), 1),
                battery=100,
                sensor_status="OK",
                # What a healthy device reports for itself. Explicit rather than None so the gate
                # does not derive 0.0 from the reading merely being old.
                quality_score=1.0,
            )
        )
    return readings


def build_symptoms(
    episode_starts: list[datetime], span_start: datetime, now: datetime, seed: int
) -> list[dict]:
    """Symptom entries for the pattern screen, most of them following an episode.

    ``detect_pattern`` reports the fraction of symptoms preceded by elevated exposure within
    ``pattern_window_sec`` (6 h). Placing every entry after an episode gives an association of
    exactly 1.0, which reads as fabricated; placing none gives 0.0 and a pattern screen
    confidently reporting no relationship. Two-thirds, with the uncertainty band the screen
    already draws, is the honest shape for generated data.
    """
    rng = random.Random(seed + 977)
    window = CONFIG.pattern_window_sec
    after_count = int(round(SYMPTOM_COUNT * SYMPTOM_AFTER_EPISODE_RATIO)) if episode_starts else 0

    times: list[datetime] = []
    for i in range(SYMPTOM_COUNT):
        if i < after_count:
            episode = rng.choice(episode_starts)
            # inside the association window, but not instantaneous
            times.append(episode + timedelta(seconds=rng.uniform(1800, window * 0.9)))
        else:
            span = (now - span_start).total_seconds()
            times.append(span_start + timedelta(seconds=rng.uniform(0, span)))

    return [
        {
            "occurred_at": at.isoformat(),
            "symptom_type": rng.choice(SYMPTOM_TYPES),
            "severity": rng.randint(2, 7),
            "note": "seeded demo entry",
        }
        for at in sorted(t for t in times if span_start <= t <= now)
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device-id", required=True, help=f"must start with {DEMO_PREFIX!r}")
    parser.add_argument("--days", type=int, default=14, help="days of history to generate (default 14)")
    parser.add_argument("--seed", type=int, default=1, help="RNG seed, so a re-run reproduces the same series")
    parser.add_argument(
        "--owner",
        help=(
            "Supabase user id (the JWT 'sub') to register the demo device to, and to file the "
            "seeded symptom entries under. Without it the device is in nobody's device list, the "
            "app keeps resolving whatever device the signed-in account already has, and the "
            "personal pattern screen stays empty."
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="report what would be written and exit")
    args = parser.parse_args(argv)

    if not args.device_id.startswith(DEMO_PREFIX):
        parser.error(
            f"refusing to seed {args.device_id!r}: generated readings may only be written to a "
            f"device id starting with {DEMO_PREFIX!r}, so they can never be mistaken for, or "
            f"mixed into, data a real sensor measured"
        )
    if args.days < 1:
        parser.error("--days must be at least 1")

    now = datetime.now(UTC)
    readings = build_readings(args.device_id, args.days, now, args.seed)
    episodes = analytics.exposure_episode_starts(readings)
    symptoms = build_symptoms(episodes, readings[0].timestamp, now, args.seed) if args.owner else []

    print(f"device      {args.device_id}")
    print(f"source tag  {DEMO_SOURCE}")
    print(f"span        {args.days} days, one point every {INTERVAL_SEC}s")
    print(f"points      {len(readings)}")
    print(f"range       {readings[0].timestamp.isoformat()} .. {readings[-1].timestamp.isoformat()}")
    print(f"peak PM2.5  {max(r.pm25 for r in readings):.1f} ug/m3")
    print(f"episodes    {len(episodes)} elevated (caution >= {CONFIG.pm25_env_caution} ug/m3)")
    print(f"symptoms    {len(symptoms)}" + ("" if args.owner else "  (none — needs --owner)"))

    if args.dry_run:
        print("\ndry run — nothing written")
        return 0

    # The same gate real telemetry passes through. Seeded points are old, so they are stored and
    # flagged not-fresh exactly as a genuine backfill would be; nothing here can enter in a shape
    # real data could not have.
    writers.write_readings([(r, validate(r, now=now)) for r in readings], DEMO_SOURCE)
    print(f"\nwrote {len(readings)} points")

    # Deliberately NOT ingestion's writers.upsert_device(): that keeps its own registry row and
    # is not what /me/devices reads. The app's device list is user-scoped, so registering the
    # demo device means putting it in the presenting account's own list.
    if args.owner:
        repo.upsert_device(
            args.owner,
            {"external_id": args.device_id, "kind": "portable", "label": "Demo device"},
        )
        print(f"registered {args.device_id} to user {args.owner}")
        repo.store_symptom(args.owner, symptoms)
        print(f"filed {len(symptoms)} symptom entries for user {args.owner}")
    else:
        print(
            "\nNo --owner given, so the app will NOT pick this device up on its own: "
            "useActiveDeviceId() prefers a device registered to the signed-in account over "
            "EXPO_PUBLIC_DEFAULT_DEVICE_ID. The personal pattern screen also stays empty, since "
            "symptom entries are per-user. Re-run with --owner <supabase-user-uuid>."
        )

    print(
        "\nHistory, baseline, exposure timeline and pattern now have data. The current reading, "
        "current risk and forecast cards still will NOT — they need a reading under two minutes "
        "old. Run scripts/feed_demo.py alongside the demo for those. See docs/demo-runbook.md."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
