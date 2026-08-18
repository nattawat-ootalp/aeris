"""§6 Destination Assessment — pure, testable core.

Given a destination and the set of AirSentinel nodes (area context), pick the nearest VALID
node, check distance + freshness + sensor health, and return a caution with reasons. Hard rule
(TDD §6): an offline/stale node must be reported as ``unavailable``/``stale`` — its old value is
never presented as the current condition.

The node's other sensors (PM10, CO2, TVOC, temperature, humidity) travel with an ``ok`` answer
so the destination screen can show the same frame the rest of the app shows. They are context
only. The verdict stays PM2.5-only, because that is what §5.2's thresholds are calibrated
against; a reading shown next to a colour must not be mistaken for a reading that produced it.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from math import asin, cos, radians, sin, sqrt

from intelligence.environmental import classify_env
from intelligence.models import Decision, EnvState, Reason

_MAX_DISTANCE_KM = float(os.getenv("DEST_MAX_DISTANCE_KM", "5.0"))
_MAX_AGE_SEC = float(os.getenv("DEST_MAX_AGE_SEC", "900"))  # 15 min

_ENV_TO_DECISION = {
    EnvState.NORMAL: Decision.NORMAL,
    EnvState.CAUTION: Decision.CAUTION,
    EnvState.HIGH: Decision.HIGH,
}
_WATCH = {Decision.NORMAL: "Normal", Decision.CAUTION: "Caution", Decision.HIGH: "High", Decision.NO_DATA: "No Data"}


@dataclass
class NodeContext:
    node_code: str
    lat: float
    lon: float
    last_seen: datetime | None
    pm25: float | None
    sensor_healthy: bool = True
    trend: str | None = None       # "rising" | "falling" | "steady" | None
    name: str = ""
    # Everything else the node reported in the same frame. Context for the reader, never an
    # input to the verdict: `classify_env` reads PM2.5 alone, and widening what colours the
    # card would change the meaning of every threshold in §5.2.
    pm10: float | None = None
    co2: float | None = None
    tvoc: float | None = None
    temperature: float | None = None
    humidity: float | None = None


@dataclass
class DestinationAssessment:
    status: str                    # "ok" | "stale" | "unavailable"
    decision: Decision
    watch_label: str
    reason_codes: list[str] = field(default_factory=list)
    node_code: str | None = None
    distance_km: float | None = None
    freshness_sec: float | None = None
    pm25: float | None = None
    trend: str | None = None
    # Reported only alongside an "ok" verdict. A stale or unavailable answer carries no
    # readings at all — publishing the rest of a frame the freshness rule just rejected would
    # reintroduce, field by field, the stale-as-current display that rule exists to prevent.
    pm10: float | None = None
    co2: float | None = None
    tvoc: float | None = None
    temperature: float | None = None
    humidity: float | None = None


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(a))


def _unavailable(reason: str) -> DestinationAssessment:
    return DestinationAssessment(
        status="unavailable", decision=Decision.NO_DATA,
        watch_label=_WATCH[Decision.NO_DATA], reason_codes=[reason],
    )


def assess_destination(
    dest_lat: float,
    dest_lon: float,
    nodes: list[NodeContext],
    now: datetime,
    max_distance_km: float = _MAX_DISTANCE_KM,
    max_age_sec: float = _MAX_AGE_SEC,
) -> DestinationAssessment:
    # candidates: healthy sensor + a real PM value, within range
    candidates: list[tuple[float, NodeContext]] = []
    for n in nodes:
        if not n.sensor_healthy or n.pm25 is None:
            continue
        d = haversine_km(dest_lat, dest_lon, n.lat, n.lon)
        if d <= max_distance_km:
            candidates.append((d, n))

    if not candidates:
        return _unavailable(Reason.DESTINATION_UNAVAILABLE)

    distance, node = min(candidates, key=lambda t: t[0])

    # freshness: a stale node is NEVER treated as current
    freshness = (now - node.last_seen).total_seconds() if node.last_seen else None
    if freshness is None or freshness > max_age_sec:
        return DestinationAssessment(
            status="stale", decision=Decision.NO_DATA, watch_label=_WATCH[Decision.NO_DATA],
            reason_codes=[Reason.DATA_STALE], node_code=node.node_code,
            distance_km=distance, freshness_sec=freshness,
        )

    env, reasons = classify_env(node.pm25)
    decision = _ENV_TO_DECISION[env]
    return DestinationAssessment(
        status="ok", decision=decision, watch_label=_WATCH[decision],
        reason_codes=reasons, node_code=node.node_code, distance_km=distance,
        freshness_sec=freshness, pm25=node.pm25, trend=node.trend,
        pm10=node.pm10, co2=node.co2, tvoc=node.tvoc,
        temperature=node.temperature, humidity=node.humidity,
    )
