"""Seed a corridor of DEMO stations, so the route simulator and the replay have a map to work on.

PM10 is deliberately absent. ``intelligence.models.Reading`` has no pm10 field and
``ingestion/app/writers.py`` never writes one, so the pm10 values the app shows for
BKK-TRT-003 arrive from the parallel AirSentinel ingestion path rather than from Aeris.
Generating a pm10 series only these demo nodes had would make the demo depend on a field the
real pipeline does not produce.

Why this exists
---------------
Both §3 (route exposure simulation) and §4 (time machine) are about air varying from place to
place. One station cannot show that: every route point within range resolves to the same
sensor, so the exposure graph is a flat line, the heat route is one colour, and multi-station
replay has nothing to compare. A live run against the single real node measured 36.8% coverage
and a 0.9 ug/m3 spread across an 879 m walk — correct, and unreadable as a demonstration.

So this places several stations along a corridor through Trat and gives each one a character:
a roadside node runs dirtier and peaks at rush hour, a park node runs cleanest, an indoor node
carries the CO2. The result is a field with real spatial and temporal structure to route
through, rather than noise around one number.

The same fence as scripts/seed_demo.py
--------------------------------------
* node codes must start with ``DEMO-``, checked here and refused otherwise, so generated
  readings can never land in a real node's series;
* every point is tagged ``source="demo"`` in InfluxDB beside the real ``station`` and
  ``portable`` sources, so the two can always be separated afterwards;
* readings pass the same §5.1 quality gate as real telemetry, so nothing enters in a shape
  real data could not have.

The registry rows are written to the same ``nodes`` table the real stations use — that is what
``repo.get_node_contexts()`` reads, and a demo station the map cannot see is no use. The
``DEMO-`` prefix in ``node_code`` is what tells them apart; ``--remove`` deletes them again.

Usage
-----
    python scripts/seed_demo_nodes.py --days 3 --dry-run     # preview
    python scripts/seed_demo_nodes.py --days 3               # register + write
    python scripts/seed_demo_nodes.py --remove               # delete rows and stop
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ingestion.app import supa, writers  # noqa: E402
from ingestion.app.validate import validate  # noqa: E402
from intelligence.models import Reading  # noqa: E402

DEMO_PREFIX = "DEMO-"
DEMO_SOURCE = "demo"
INTERVAL_SEC = 300          # one point every 5 minutes — enough to interpolate between,
                            # small enough that 7 days of 5 nodes stays a manageable write


class Profile:
    """A station's character: where it is and how its air behaves.

    ``pm_base`` etc. are the quiet-hours level; ``rush`` scales how hard the morning and
    evening peaks hit it. A roadside sensor swings; a park barely moves.
    """

    def __init__(self, code, name, lat, lon, zone, pm_base, pm_rush, co2_base, tvoc_base):
        self.code, self.name, self.lat, self.lon, self.zone = code, name, lat, lon, zone
        self.pm_base, self.pm_rush = pm_base, pm_rush
        self.co2_base, self.tvoc_base = co2_base, tvoc_base


# A corridor through Trat, roughly 2.5 km end to end and passing within a few hundred metres
# of the real node, so a simulated route can cross several of them in one walk.
PROFILES = [
    Profile("DEMO-TRT-PARK", "Demo — Suan Rukkhachat (park)",
            12.2395, 102.5098, "Zone A", pm_base=11.0, pm_rush=1.15, co2_base=430, tvoc_base=45),
    Profile("DEMO-TRT-SCHOOL", "Demo — School gate",
            12.2418, 102.5126, "Zone A", pm_base=19.0, pm_rush=1.9, co2_base=520, tvoc_base=90),
    Profile("DEMO-TRT-MARKET", "Demo — Market crossing",
            12.2441, 102.5158, "Zone B", pm_base=27.0, pm_rush=2.3, co2_base=610, tvoc_base=160),
    Profile("DEMO-TRT-ROAD", "Demo — Sukhumvit roadside",
            12.2467, 102.5192, "Zone B", pm_base=34.0, pm_rush=2.8, co2_base=580, tvoc_base=210),
    Profile("DEMO-TRT-INDOOR", "Demo — Office indoor",
            12.2489, 102.5221, "Zone C", pm_base=9.0, pm_rush=1.1, co2_base=980, tvoc_base=320),
]


def _diurnal(hour_local: float, rush: float) -> float:
    """Multiplier for the hour of day: two commuting peaks over a quiet overnight floor.

    Built from two Gaussians rather than a sine so the peaks are narrow and the night is flat,
    which is what a roadside series actually looks like.
    """
    morning = math.exp(-((hour_local - 7.5) ** 2) / 2.0)
    evening = math.exp(-((hour_local - 18.0) ** 2) / 3.0)
    return 1.0 + (rush - 1.0) * max(morning, evening)


def build_series(p: Profile, days: int, now: datetime, seed: int) -> list[Reading]:
    """One reading every INTERVAL_SEC for `days`, ending at `now`."""
    rng = random.Random(f"{seed}:{p.code}")
    start = now - timedelta(days=days)
    count = int(days * 24 * 3600 / INTERVAL_SEC)
    out: list[Reading] = []
    drift = 0.0
    for i in range(count):
        t = start + timedelta(seconds=i * INTERVAL_SEC)
        hour = (t + timedelta(hours=7)).hour + (t.minute / 60.0)      # Trat is UTC+7

        # A slow random walk under the daily shape, so consecutive readings are related the
        # way real ones are; independent draws would make every interpolation meaningless.
        drift = max(-0.45, min(0.45, drift + rng.uniform(-0.05, 0.05)))
        shape = _diurnal(hour, p.pm_rush) * (1.0 + drift)

        pm25 = max(1.0, p.pm_base * shape + rng.uniform(-1.5, 1.5))
        out.append(Reading(
            device_id=p.code,
            timestamp=t,
            pm25=round(pm25, 1),
            temperature=round(27.0 + 4.0 * math.sin((hour - 9) / 24 * 2 * math.pi)
                              + rng.uniform(-0.6, 0.6), 2),
            humidity=round(62.0 - 8.0 * math.sin((hour - 9) / 24 * 2 * math.pi)
                           + rng.uniform(-2, 2), 2),
            co2=round(p.co2_base * (1.0 + 0.18 * (shape - 1.0)) + rng.uniform(-12, 12), 1),
            tvoc=round(max(0.0, p.tvoc_base * shape + rng.uniform(-15, 15)), 1),
            battery=100,
            sensor_status="OK",
            quality_score=1.0,
            schema_version="1.2",
        ))
    return out


def _org_id() -> str:
    """The org every existing node belongs to.

    `nodes.org_id` is NOT NULL and there is no orgs table exposed through PostgREST to look one
    up, so the value is read off the rows already there rather than hardcoded: a demo node in a
    different org would be invisible to exactly the queries it exists to appear in.
    """
    rows = supa.sb_get("nodes", {"select": "org_id", "limit": "1", "org_id": "not.is.null"})
    if not rows or not rows[0].get("org_id"):
        raise SystemExit(
            "no existing node has an org_id to copy — create one real node first, or set "
            "AERIS_DEMO_ORG_ID in the environment"
        )
    return rows[0]["org_id"]


def register(p: Profile, org_id: str) -> None:
    """Upsert the registry row the map and the sensor matcher read."""
    existing = supa.sb_get("nodes", {"node_code": f"eq.{p.code}", "select": "id"})
    row = {
        "node_code": p.code, "name": p.name, "lat": p.lat, "lon": p.lon,
        "zone": p.zone, "status": "active", "org_id": org_id,
        # NOT NULL on the AirSentinel-era table. These nodes never connect to the broker, so
        # the value is a label saying so rather than a credential anything could authenticate
        # with — a demo row must not look like a provisioned device.
        "mqtt_user": "demo-no-broker",
        # hw_version/fw_version are NOT NULL too. "demo" in both is what makes a row on the
        # sensor-health screen legible as generated rather than as a board someone forgot.
        "hw_version": "demo",
        "fw_version": "demo",
    }
    if existing:
        supa.sb_patch("nodes", {"node_code": f"eq.{p.code}"}, row)
    else:
        supa.sb_post("nodes", row)


def remove() -> int:
    """Delete the demo registry rows.

    The InfluxDB points are deliberately left alone: they are tagged ``source="demo"`` and
    retention will age them out, whereas a delete-by-tag against a shared bucket is the kind
    of command that removes more than it was pointed at.
    """
    removed = 0
    for p in PROFILES:
        supa.sb_delete("nodes", {"node_code": f"eq.{p.code}"})
        removed += 1
    return removed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=3, help="days of history per node (default 3)")
    ap.add_argument("--seed", type=int, default=1,
                    help="RNG seed, so a re-run reproduces the series")
    ap.add_argument("--dry-run", action="store_true", help="report what would be written and exit")
    ap.add_argument("--remove", action="store_true", help="delete the demo nodes and exit")
    args = ap.parse_args(argv)

    for p in PROFILES:
        if not p.code.startswith(DEMO_PREFIX):
            ap.error(
                f"refusing to seed {p.code!r}: generated readings may only be written to a node "
                f"code starting with {DEMO_PREFIX!r}, so they can never be mistaken for, or "
                f"mixed into, what a real station measured"
            )

    if args.remove:
        n = remove()
        print(f"removed {n} demo node registry rows "
              f"(InfluxDB points left in place, tagged source=demo)")
        return 0

    if args.days < 1:
        ap.error("--days must be at least 1")

    now = datetime.now(UTC).replace(second=0, microsecond=0)
    total = 0
    print(f"span       {args.days} days, one point every {INTERVAL_SEC}s")
    print(f"source tag {DEMO_SOURCE}")
    print()
    plans: list[tuple[Profile, list[Reading]]] = []
    for p in PROFILES:
        readings = build_series(p, args.days, now, args.seed)
        plans.append((p, readings))
        total += len(readings)
        pm = [r.pm25 for r in readings]
        print(f"  {p.code:18s} {p.lat:.4f},{p.lon:.4f}  {len(readings):5d} pts  "
              f"PM2.5 {min(pm):5.1f}..{max(pm):5.1f}  mean {sum(pm)/len(pm):5.1f} ug/m3")

    print(f"\ntotal      {total} points across {len(PROFILES)} nodes")
    if args.dry_run:
        print("\ndry run — nothing written")
        return 0

    org_id = os.getenv("AERIS_DEMO_ORG_ID") or _org_id()
    for p, readings in plans:
        register(p, org_id)
        # The same gate real telemetry passes. Seeded points are backdated, so they are stored
        # and flagged not-fresh exactly as a genuine backfill would be.
        writers.write_readings([(r, validate(r, now=now)) for r in readings], DEMO_SOURCE)
        print(f"wrote {len(readings):5d} points for {p.code}")

    print(
        "\nRegistered as active stations, so they appear on the map, in the replay picker and "
        "as candidates for route sensor matching. They are DEMO- prefixed and tagged "
        "source=demo everywhere. Remove with --remove."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
