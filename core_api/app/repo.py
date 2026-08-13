"""Data-access providers composing Supabase (metadata) + InfluxDB (time-series).

Kept thin and separate from the pure logic (destination.py, decision_service.py) so those stay
unit-testable and these can be monkeypatched in endpoint tests.
"""
from __future__ import annotations

from datetime import datetime

from ingestion.app import supa
from intelligence.models import Reading
from intelligence.parsing import parse_timestamp

from . import influx_query
from .destination import NodeContext


def _row_to_reading(device_id: str, row: dict) -> Reading:
    return Reading(
        device_id=device_id,
        timestamp=parse_timestamp(row["time"]),
        pm25=row.get("pm2_5"),
        temperature=row.get("temperature"),
        humidity=row.get("humidity"),
        battery=int(row["battery"]) if row.get("battery") is not None else None,
        sensor_status=row.get("sensor_status", "OK"),
        quality_score=row.get("quality_score"),
    )


def get_recent_readings(device_id: str, hours: int = 6) -> list[Reading]:
    return [_row_to_reading(device_id, r) for r in influx_query.history(device_id, hours)]


def get_baseline_values(device_id: str, days: int = 14) -> list[float]:
    rows = influx_query.history(device_id, hours=days * 24)
    return [r["pm2_5"] for r in rows if r.get("pm2_5") is not None]


def get_node_contexts(now: datetime) -> list[NodeContext]:
    """AirSentinel nodes (Supabase) enriched with their latest InfluxDB reading."""
    nodes = supa.sb_get("nodes", {"select": "node_code,name,lat,lon,status,last_seen_at"})
    out: list[NodeContext] = []
    for n in nodes:
        latest = influx_query.latest_point(n["node_code"])
        last_seen = None
        pm25 = None
        if latest:
            pm25 = latest.get("pm2_5")
            if latest.get("time"):
                last_seen = parse_timestamp(latest["time"])
        elif n.get("last_seen_at"):
            last_seen = parse_timestamp(n["last_seen_at"])
        out.append(
            NodeContext(
                node_code=n["node_code"],
                name=n.get("name", ""),
                lat=float(n["lat"]),
                lon=float(n["lon"]),
                last_seen=last_seen,
                pm25=pm25,
                sensor_healthy=str(n.get("status", "")).lower() in ("active", "online", ""),
            )
        )
    return out


def store_symptom(user_sub: str, payload: dict) -> list:
    """Private health event — RLS keeps it owner-only; never exposed publicly (TDD §9)."""
    return supa.sb_post("symptom_events", {"user_id": user_sub, **payload})


def get_alerts(status: str | None = None, limit: int = 50) -> list:
    params = {"order": "triggered_at.desc", "limit": str(max(1, min(limit, 200)))}
    if status:
        params["status"] = f"eq.{status}"
    return supa.sb_get("alert_events", params)


def get_ranking(now: datetime, top_n: int = 5, max_age_sec: float = 900) -> list[dict]:
    """Worst current PM2.5 across nodes — only VALID, fresh nodes are ranked (never stale)."""
    ranked = []
    for n in get_node_contexts(now):
        if n.pm25 is None or n.last_seen is None:
            continue
        age = (now - n.last_seen).total_seconds()
        if age > max_age_sec:
            continue
        ranked.append({"node_code": n.node_code, "name": n.name, "pm2_5": n.pm25, "freshness_sec": age})
    ranked.sort(key=lambda x: x["pm2_5"], reverse=True)
    return ranked[:top_n]


def set_threshold(node_code: str, payload: dict) -> list:
    return supa.sb_post("threshold_config", {"node_code": node_code, **payload})
