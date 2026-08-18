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

What it can and cannot make ready
---------------------------------
Seeding fills the views that read history: personal baseline, the weekly summary, the exposure
timeline. It CANNOT make the forecast card show a number. ``intelligence/predict.py`` refuses
any series whose newest point is older than ``freshness_max_age_sec`` (120 s by default), and
the same freshness rule governs the current risk. Those need a device connected and reporting
right now — no amount of seeded history substitutes for it.

Rough shape of what a live device needs, at the 5 s sample cadence:

* current risk: ``risk_min_samples`` (10) ≈ 1 minute
* forecast:     ``forecast_min_samples`` (6) within the last hour, newest under 2 minutes old
* baseline:     ``baseline_min_samples`` (50) ≈ 4-5 minutes

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
without depending on it.

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

from core_api.app import repo  # noqa: E402
from ingestion.app import writers  # noqa: E402 — must follow the sys.path bootstrap above
from ingestion.app.validate import validate  # noqa: E402
from intelligence.models import Reading  # noqa: E402

#: The only device-id prefix this script will write to. Everything about the seeded series is
#: synthetic, so it must be impossible to aim at a device whose data is real.
DEMO_PREFIX = "DEMO-"

#: Written as the InfluxDB `source` tag, beside the real "portable" and "station". A query can
#: always separate generated points from measured ones after the fact.
DEMO_SOURCE = "demo"

#: One point every five minutes. Dense enough to clear baseline_min_samples several times over
#: across a fortnight, sparse enough that a seed is not mistaken for a continuously-worn device.
INTERVAL_SEC = 300


def plausible_pm25(at: datetime, rng: random.Random) -> float:
    """A PM2.5 value with a daily rhythm, for a series that reads like a room rather than noise.

    Deliberately unremarkable: morning and evening bumps around a modest baseline, with enough
    spread that the median and MAD the baseline is built from are not degenerate. It is not a
    model of anything and makes no claim to be — it exists so the history screens have a shape
    to draw.
    """
    hour = at.hour + at.minute / 60.0
    # two broad humps, roughly at the times a room gets used
    morning = 6.0 * math.exp(-(((hour - 8.0) / 2.0) ** 2))
    evening = 8.0 * math.exp(-(((hour - 19.0) / 2.5) ** 2))
    value = 12.0 + morning + evening + rng.gauss(0.0, 2.0)
    return round(max(1.0, value), 1)


def build_readings(device_id: str, days: int, now: datetime, seed: int) -> list[Reading]:
    rng = random.Random(seed)
    steps = int(days * 24 * 3600 / INTERVAL_SEC)
    readings: list[Reading] = []
    for i in range(steps, 0, -1):
        at = now - timedelta(seconds=i * INTERVAL_SEC)
        pm25 = plausible_pm25(at, rng)
        readings.append(
            Reading(
                device_id=device_id,
                timestamp=at,
                pm25=pm25,
                temperature=round(rng.uniform(27.0, 33.0), 1),
                humidity=round(rng.uniform(55.0, 78.0), 1),
                battery=100,
                sensor_status="OK",
                # What a healthy device reports for itself. Left explicit rather than None so the
                # gate does not derive 0.0 from the reading merely being old.
                quality_score=1.0,
            )
        )
    return readings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device-id", required=True, help=f"must start with {DEMO_PREFIX!r}")
    parser.add_argument("--days", type=int, default=14, help="days of history to generate (default 14)")
    parser.add_argument("--seed", type=int, default=1, help="RNG seed, so a re-run reproduces the same series")
    parser.add_argument(
        "--owner",
        help=(
            "Supabase user id (the JWT 'sub') to register the demo device to. Without it the "
            "device is not in anyone's device list, and the app will keep resolving whatever "
            "device the signed-in account already has."
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

    print(f"device      {args.device_id}")
    print(f"source tag  {DEMO_SOURCE}")
    print(f"span        {args.days} days, one point every {INTERVAL_SEC}s")
    print(f"points      {len(readings)}")
    print(f"range       {readings[0].timestamp.isoformat()} .. {readings[-1].timestamp.isoformat()}")

    if args.dry_run:
        print("\ndry run — nothing written")
        return 0

    written = 0
    for reading in readings:
        # The same gate real telemetry passes through. Seeded points are old, so they are stored
        # and flagged not-fresh exactly as a genuine backfill would be; nothing here can enter in
        # a shape real data could not have.
        writers.write_reading(reading, validate(reading, now=now), DEMO_SOURCE)
        written += 1

    print(f"\nwrote {written} points")

    # Deliberately NOT ingestion's writers.upsert_device(): that keeps its own registry row and
    # is not what /me/devices reads. The app's device list is user-scoped, so registering the
    # demo device means putting it in the presenting account's own list.
    if args.owner:
        repo.upsert_device(
            args.owner,
            {"external_id": args.device_id, "kind": "portable", "label": "Demo device"},
        )
        print(f"registered {args.device_id} to user {args.owner}")
    else:
        print(
            "\nNo --owner given, so the app will NOT pick this device up on its own: "
            "useActiveDeviceId() prefers a device registered to the signed-in account over "
            "EXPO_PUBLIC_DEFAULT_DEVICE_ID. Re-run with --owner <supabase-user-uuid>."
        )

    print(
        "\nBaseline and the history screens will now have data. The forecast and current-risk "
        "cards still will NOT — they require a reading under two minutes old, which only a "
        "connected device produces. See docs/demo-runbook.md."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
