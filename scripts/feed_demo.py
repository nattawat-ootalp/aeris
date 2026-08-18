"""Keep a DEMO device reporting, so the live cards work without a real sensor.

``seed_demo.py`` fills everything that reads history. It cannot fill the current reading,
current risk or forecast: ``intelligence/predict.py`` refuses a series whose newest point is
older than ``freshness_max_age_sec`` (120 s), and ``quality.py`` gates usability the same way.
Backfilled history is, by definition, never fresh.

This script closes that gap the only way it can be closed — by continuing to produce readings.
It writes one point every few seconds for as long as it runs, so the freshness window keeps
being satisfied and the live cards behave exactly as they would with a device on the desk.

Same fence as the seeder: a ``DEMO-`` device id only, tagged ``source="demo"``, through the same
§5.1 gate. It deliberately does NOT post to ``/ingest/portable``, which would tag the points
``source="portable"`` and quietly file generated readings among measured ones.

Roughly how long to leave it running before each card comes alive, at the default 5 s interval:

* current reading   one point
* forecast          ``forecast_min_samples`` (6)  ≈ 30 s
* current risk      ``risk_min_samples`` (10)     ≈ 1 minute

Usage
-----
    python scripts/feed_demo.py --device-id DEMO-ROOM-001
    python scripts/feed_demo.py --device-id DEMO-ROOM-001 --interval 5 --minutes 30

Ctrl-C to stop. Reads the same INFLUXDB_* settings as the ingestion service.
"""
from __future__ import annotations

import argparse
import math
import random
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.app import writers  # noqa: E402
from ingestion.app.validate import validate  # noqa: E402
from intelligence.models import Reading  # noqa: E402
from scripts.seed_demo import DEMO_PREFIX, DEMO_SOURCE  # noqa: E402

#: A slow drift rather than independent samples. The forecast fits a straight line to the recent
#: window, so a series of unrelated draws would give it a slope of nothing and a projection that
#: jitters between refreshes. A wandering level produces a trend it can actually report.
DRIFT_PER_STEP = 0.8
DRIFT_MIN = 8.0
DRIFT_MAX = 42.0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device-id", required=True, help=f"must start with {DEMO_PREFIX!r}")
    parser.add_argument(
        "--interval", type=float, default=5.0,
        help="seconds between readings (default 5, matching the portable firmware)",
    )
    parser.add_argument(
        "--minutes", type=float, default=0.0,
        help="stop after this many minutes; 0 (the default) runs until interrupted",
    )
    parser.add_argument("--seed", type=int, default=1, help="RNG seed")
    parser.add_argument("--start-pm25", type=float, default=18.0, help="initial PM2.5 level")
    args = parser.parse_args(argv)

    if not args.device_id.startswith(DEMO_PREFIX):
        parser.error(
            f"refusing to feed {args.device_id!r}: generated readings may only be written to a "
            f"device id starting with {DEMO_PREFIX!r}, so they can never be mistaken for, or "
            f"mixed into, data a real sensor measured"
        )
    if args.interval <= 0:
        parser.error("--interval must be positive")

    rng = random.Random(args.seed)
    level = args.start_pm25
    deadline = time.monotonic() + args.minutes * 60 if args.minutes > 0 else None
    written = 0

    print(f"feeding {args.device_id} (source={DEMO_SOURCE}) every {args.interval:g}s — Ctrl-C to stop")
    try:
        while deadline is None or time.monotonic() < deadline:
            level += rng.gauss(0.0, DRIFT_PER_STEP)
            level = min(DRIFT_MAX, max(DRIFT_MIN, level))
            now = datetime.now(UTC)
            reading = Reading(
                device_id=args.device_id,
                timestamp=now,
                pm25=round(level, 1),
                temperature=round(30.0 + math.sin(time.monotonic() / 120.0), 1),
                humidity=round(rng.uniform(60.0, 72.0), 1),
                battery=100,
                sensor_status="OK",
                quality_score=1.0,
            )
            writers.write_reading(reading, validate(reading, now=now), DEMO_SOURCE)
            written += 1
            print(f"  {now.strftime('%H:%M:%S')}  pm2.5 {reading.pm25:>5.1f}  ({written} sent)", flush=True)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped")

    print(f"wrote {written} readings")
    if written:
        print(
            "The live cards stay populated for about two minutes after the last reading "
            "(freshness_max_age_sec), then return to No Data."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
