"""Station liveness, as a metric and as an answer.

The failure this whole system keeps having is a station going quiet. Nothing about that is an
error anywhere: the broker is fine, the bridge is fine, the API is fine, and every request
still returns 200. The only signal is the absence of new readings, and absence has to be
looked for on a schedule — nothing arrives to trigger it.

Render's free plan has no scheduler, so this is an endpoint rather than a background job, and
the same external pinger that already keeps the free services awake calls it. One cron entry
does both jobs: the ping keeps the service up, and the response is the check.

The endpoint is public and read-only. It reports how old each station's newest reading is,
which is operational information about hardware, not about anyone.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Query

import observability

from . import repo
from .influx_query import now_utc

router = APIRouter(tags=["monitoring"])

# A station publishes every 30 s. Fifteen minutes is thirty missed frames — long past a
# retry or a brief reconnection, and the same window the destination assessment already
# treats as stale, so one station is not "late" on one screen and "gone" on another.
DEFAULT_SILENT_AFTER_S = 900.0

# Seeded stations (scripts/seed_demo_nodes.py) hold backfilled history and by design never
# report again, so they are always "silent". Counting them would leave the alert permanently
# firing, which is the fastest way to teach everyone to ignore it. They are still listed and
# still measured — just kept out of the number an alert is wired to.
DEMO_PREFIX = "DEMO-"


@router.get("/monitor/stations")
def monitor_stations(
    silent_after_s: float = Query(DEFAULT_SILENT_AFTER_S, gt=0, le=7 * 24 * 3600),
) -> dict:
    """Per-station age of the newest reading, emitted as metrics and returned as JSON."""
    now: datetime = now_utc()
    rows = []
    silent = 0
    for node in repo.get_node_contexts(now):
        age = None if node.last_seen is None else (now - node.last_seen).total_seconds()
        # A station that has never reported is reported as such rather than as age 0, which
        # would read on a dashboard as a station that just checked in.
        is_silent = age is None or age > silent_after_s
        is_demo = node.node_code.startswith(DEMO_PREFIX)
        if node.sensor_healthy and is_silent and not is_demo:
            silent += 1

        tags = {"device": node.node_code, "kind": "demo" if is_demo else "station"}
        if age is not None:
            observability.metric("station.reading_age_sec", age, tags)
        observability.metric("station.silent", 1 if is_silent else 0, tags)
        if node.pm25 is not None:
            observability.metric("station.pm25", node.pm25, tags)

        rows.append({
            "node_code": node.node_code,
            "name": node.name,
            "active": node.sensor_healthy,
            "last_seen": node.last_seen.isoformat() if node.last_seen else None,
            "reading_age_sec": None if age is None else round(age, 1),
            "silent": is_silent,
            "demo": is_demo,
            "pm25": node.pm25,
        })

    # The alertable number: active, real hardware that has gone quiet.
    observability.metric("station.silent_total", silent)
    observability.metric("station.registered_total", len(rows))
    # Flushed here rather than left to the timer: on a free web service the container can be
    # put to sleep moments after answering, and a queued batch would be lost with it.
    observability.flush()

    return {
        "checked_at": now.isoformat(),
        "silent_after_s": silent_after_s,
        "registered": len(rows),
        # Excludes seeded demo nodes and stations marked inactive in the registry — an alert
        # should fire for hardware that was reporting and stopped, not for either of those.
        "silent": silent,
        "stations": sorted(rows, key=lambda r: (not r["active"], r["node_code"])),
        "observability": observability.health(),
    }
