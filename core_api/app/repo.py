"""Data-access providers composing Supabase (metadata) + InfluxDB (time-series).

Kept thin and separate from the pure logic (destination.py, decision_service.py) so those stay
unit-testable and these can be monkeypatched in endpoint tests.
"""
from __future__ import annotations

from datetime import datetime

from ingestion.app import supa
from intelligence.models import Reading
from intelligence.parsing import parse_timestamp

from . import analytics, influx_query
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
        tvoc=row.get("tvoc"),
        co2=row.get("co2"),
        eco2=row.get("eco2"),
    )


def get_recent_readings(device_id: str, hours: int = 6) -> list[Reading]:
    return [_row_to_reading(device_id, r) for r in influx_query.history(device_id, hours)]


def get_baseline_values(device_id: str, days: int = 14) -> list[float]:
    rows = influx_query.history(device_id, hours=days * 24)
    return [r["pm2_5"] for r in rows if r.get("pm2_5") is not None]


def get_node_contexts(now: datetime) -> list[NodeContext]:
    """AirSentinel nodes (Supabase) enriched with their latest InfluxDB reading.

    lat/lon come from Supabase, not from the telemetry payload: the node's position is
    registry metadata, and a node that is physically moved is corrected there once rather
    than in every reading it has ever sent.
    """
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
                # The same frame `pm25` came from. Read with .get so a node missing a sensor
                # stays None rather than absent — the screen renders "No Data" for one field
                # instead of the caller having to tell the two apart.
                pm10=latest.get("pm10") if latest else None,
                co2=latest.get("co2") if latest else None,
                tvoc=latest.get("tvoc") if latest else None,
                temperature=latest.get("temperature") if latest else None,
                humidity=latest.get("humidity") if latest else None,
            )
        )
    return out


def store_symptom(user_sub: str, payload: dict | list[dict]) -> list:
    """Private health event — RLS keeps it owner-only; never exposed publicly (TDD §9)."""
    if isinstance(payload, list):
        rows = [{"user_id": user_sub, **r} for r in payload]
        return supa.sb_post("symptom_events", rows)
    return supa.sb_post("symptom_events", {"user_id": user_sub, **payload})


def get_symptoms(user_sub: str, since: datetime) -> list:
    params = {
        "user_id": f"eq.{user_sub}",
        "occurred_at": f"gte.{since.isoformat()}",
        "order": "occurred_at.desc"
    }
    return supa.sb_get("symptom_events", params)


# ── Privacy consents (§7 Privacy Control, §9) ────────────────────────────────
# Mirrors the column defaults in infra/supabase/001_aeris_schema.sql so a user who has never
# saved a preference reads back the same shape the table would have produced.
PRIVACY_DEFAULTS = {
    "sync_enabled": True,
    "share_environmental": False,
    "share_symptoms": False,
    "location_sharing": "none",
    "retention_days": 30,
    "consented_at": None,
    "withdrawn_at": None,
}
PRIVACY_FIELDS = tuple(PRIVACY_DEFAULTS)

# Every table that carries per-user rows. Used by export and by withdrawal, so a new
# user-owned table can never be silently missed by one of the two.
USER_TABLES = (
    "symptom_events",
    "exposure_events",
    "personal_baseline",
    "patterns",
    "decision_events",
    "devices",
    "action_plans",
    "emergency_contacts",
    "sos_events",
)


def get_privacy(user_sub: str) -> dict:
    rows = supa.sb_get("privacy_consents", {"user_id": f"eq.{user_sub}", "limit": "1"})
    if not rows:
        return dict(PRIVACY_DEFAULTS)
    row = rows[0]
    return {k: row.get(k, PRIVACY_DEFAULTS[k]) for k in PRIVACY_FIELDS}


def upsert_privacy(user_sub: str, changes: dict) -> dict:
    """Merge-and-store: the client sends only the toggles it changed."""
    current = get_privacy(user_sub)
    merged = {**current, **{k: v for k, v in changes.items() if k in PRIVACY_FIELDS}}
    supa.sb_post(
        "privacy_consents",
        {"user_id": user_sub, **merged},
        params={"on_conflict": "user_id"},
        headers={"Prefer": "resolution=merge-duplicates,return=representation"},
    )
    return merged


def export_user_data(user_sub: str) -> dict:
    """Everything Aeris holds for this user in Supabase, for the §9 right of access."""
    return {t: supa.sb_get(t, {"user_id": f"eq.{user_sub}"}) for t in USER_TABLES}


def delete_user_data(user_sub: str) -> dict:
    """Withdraw sync: erase the user's synced rows and record the withdrawal."""
    deleted = {}
    for table in USER_TABLES:
        rows = supa.sb_delete(table, {"user_id": f"eq.{user_sub}"})
        deleted[table] = len(rows or [])
    upsert_privacy(user_sub, {"sync_enabled": False, "withdrawn_at": influx_query.now_utc().isoformat()})
    return deleted


# ── Device registry ──────────────────────────────────────────────────────────
def list_devices(user_sub: str) -> list:
    return supa.sb_get(
        "devices", {"user_id": f"eq.{user_sub}", "order": "last_seen.desc.nullslast"}
    )


def upsert_device(user_sub: str, device: dict) -> list:
    """Register/refresh a paired device. `(user_id, external_id)` is unique in the schema, so
    re-pairing the same hardware updates the existing row instead of duplicating it."""
    row = {"user_id": user_sub, "last_seen": influx_query.now_utc().isoformat(), **device}
    return supa.sb_post(
        "devices",
        row,
        params={"on_conflict": "user_id,external_id"},
        headers={"Prefer": "resolution=merge-duplicates,return=representation"},
    )


# ── Asthma action plan (user/clinician authored — Aeris never writes medical content) ──
ACTION_PLAN_DEFAULTS = {
    "author": "user",
    "clinician_name": None,
    "reviewed_at": None,
    "normal_steps": [],
    "caution_steps": [],
    "high_steps": [],
    "emergency_steps": [],
    "notes": None,
}
ACTION_PLAN_FIELDS = tuple(ACTION_PLAN_DEFAULTS)


def get_action_plan(user_sub: str) -> dict:
    """The user's own plan, or an empty plan. An empty plan is a real state — the app shows
    "no plan recorded" rather than any default steps, because Aeris must not author care
    instructions (TDD §1.2/§14)."""
    rows = supa.sb_get("action_plans", {"user_id": f"eq.{user_sub}", "limit": "1"})
    if not rows:
        return {**ACTION_PLAN_DEFAULTS, "exists": False}
    row = rows[0]
    return {**{k: row.get(k, ACTION_PLAN_DEFAULTS[k]) for k in ACTION_PLAN_FIELDS}, "exists": True}


def upsert_action_plan(user_sub: str, changes: dict) -> dict:
    current = get_action_plan(user_sub)
    merged = {**{k: current[k] for k in ACTION_PLAN_FIELDS},
              **{k: v for k, v in changes.items() if k in ACTION_PLAN_FIELDS}}
    supa.sb_post(
        "action_plans",
        {"user_id": user_sub, **merged},
        params={"on_conflict": "user_id"},
        headers={"Prefer": "resolution=merge-duplicates,return=representation"},
    )
    return {**merged, "exists": True}


# ── Emergency contacts + SOS (§ SOS Flow) ────────────────────────────────────
def list_contacts(user_sub: str) -> list:
    return supa.sb_get(
        "emergency_contacts", {"user_id": f"eq.{user_sub}", "order": "sort_order.asc"}
    )


def add_contact(user_sub: str, contact: dict) -> list:
    return supa.sb_post("emergency_contacts", {"user_id": user_sub, **contact})


def delete_contact(user_sub: str, contact_id: str) -> list:
    return supa.sb_delete(
        "emergency_contacts", {"user_id": f"eq.{user_sub}", "id": f"eq.{contact_id}"}
    )


def store_sos(user_sub: str, event: dict) -> list:
    """Record an SOS the user raised. Location is written only when the caller already
    honoured privacy_consents.location_sharing — this layer stores what it is given."""
    return supa.sb_post("sos_events", {"user_id": user_sub, **event})


def get_sos_events(user_sub: str, limit: int = 20) -> list:
    return supa.sb_get(
        "sos_events",
        {"user_id": f"eq.{user_sub}", "order": "occurred_at.desc",
         "limit": str(max(1, min(limit, 100)))},
    )


def get_alerts(status: str | None = None, limit: int = 50) -> list:
    params = {"order": "triggered_at.desc", "limit": str(max(1, min(limit, 200)))}
    if status:
        params["status"] = f"eq.{status}"
    return supa.sb_get("alert_events", params)


def get_ranking(now: datetime, top_n: int = 5, max_age_sec: float = 900) -> list[dict]:
    """Worst current PM2.5 across nodes — only VALID, fresh nodes are ranked (never stale).

    Returns the map/compare marker shape (lat/lon + watch label), so the app can place and
    label a node without a second round trip or a client-side threshold copy.
    """
    ranked = []
    for n in get_node_contexts(now):
        if n.pm25 is None or n.last_seen is None:
            continue
        age = (now - n.last_seen).total_seconds()
        if age > max_age_sec:
            continue
        ranked.append({
            "node_code": n.node_code,
            "name": n.name,
            "lat": n.lat,
            "lon": n.lon,
            "pm25": n.pm25,
            "freshness_sec": age,
            "watch_label": analytics.watch_label_for(n.pm25),
        })
    ranked.sort(key=lambda x: x["pm25"], reverse=True)
    return ranked[:top_n]


def set_threshold(node_code: str, payload: dict) -> list:
    return supa.sb_post("threshold_config", {"node_code": node_code, **payload})
