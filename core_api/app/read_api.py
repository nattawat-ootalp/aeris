"""Core read/decision API (TDD §8 + Aeris additions).

Public reads (telemetry/history/destination/decision) need no auth; writes that touch private
health data (symptom log) require a JWT. Destination + decision reuse the pure logic modules;
data access goes through ``repo`` so it can be mocked in tests.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from intelligence.baseline import build_baseline
from intelligence.config import CONFIG
from intelligence.parsing import parse_timestamp
from intelligence.pattern import detect_pattern

from . import analytics, repo
from .decision_service import evaluate_readings
from .destination import assess_destination
from .influx_query import now_utc
from .security import require_user

router = APIRouter(tags=["core"])


@router.get("/nodes/{device_id}/telemetry")
def node_telemetry(device_id: str) -> dict:
    point = repo.influx_query.latest_point(device_id)
    if point is None:
        return {"device_id": device_id, "status": "unavailable", "reason": "no recent data"}
    return point


@router.get("/nodes/{device_id}/history")
def node_history(device_id: str, hours: int = Query(24, ge=1, le=24 * 90)) -> dict:
    return {"device_id": device_id, "hours": hours, "points": repo.influx_query.history(device_id, hours)}


@router.get("/destination/assess")
def destination_assess(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
) -> dict:
    now = now_utc()
    nodes = repo.get_node_contexts(now)
    result = assess_destination(lat, lon, nodes, now)
    return asdict(result)


@router.get("/devices/{device_id}/decision")
def device_decision(device_id: str) -> dict:
    now = now_utc()
    readings = repo.get_recent_readings(device_id)
    baseline_values = repo.get_baseline_values(device_id)
    return evaluate_readings(readings, now, baseline_values=baseline_values)


@router.get("/config/thresholds")
def config_thresholds() -> dict:
    """The environmental thresholds the decision engine uses (§5.2).

    Published so a client rendering a *live* local BLE reading labels it with the same
    boundaries the backend would, instead of keeping its own copy that can drift.
    These are engineering thresholds, not medical ones.
    """
    return {
        "pm25_caution": CONFIG.pm25_env_caution,
        "pm25_high": CONFIG.pm25_env_high,
        "freshness_max_age_sec": CONFIG.freshness_max_age_sec,
    }


@router.get("/alerts")
def alerts(status: str | None = None, limit: int = Query(50, ge=1, le=200)) -> dict:
    try:
        return {"alerts": repo.get_alerts(status, limit)}
    except Exception:  # noqa: BLE001 — read endpoint degrades gracefully
        return {"alerts": []}


@router.get("/dashboard/ranking")
def dashboard_ranking(top_n: int = Query(5, ge=1, le=50)) -> dict:
    return {"ranking": repo.get_ranking(now_utc(), top_n)}


class ThresholdPayload(BaseModel):
    sensor: str
    level: str
    threshold_val: float
    standard_ref: str = "Custom"


@router.post("/nodes/{node_code}/threshold")
def set_node_threshold(
    node_code: str, payload: ThresholdPayload, user: dict = Depends(require_user)
) -> dict:
    repo.set_threshold(node_code, payload.model_dump())
    return {"updated": True, "node_code": node_code}


class SymptomPayload(BaseModel):
    symptoms: list[str] | None = None
    severity: str = "mild"
    note: str | None = None
    timestamp: str | None = None
    started_at: str | None = None


@router.post("/symptoms")
def log_symptom(payload: SymptomPayload, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")

    severity_map = {
        "mild": 2,
        "moderate": 5,
        "severe": 8
    }
    sev_val = severity_map.get(payload.severity.lower(), 2)
    occurred_at = payload.started_at or payload.timestamp or now_utc().isoformat()

    rows = []
    if payload.symptoms:
        for s in payload.symptoms:
            row = {
                "symptom_type": s,
                "severity": sev_val,
                "occurred_at": occurred_at,
            }
            if payload.note is not None:
                row["note"] = payload.note
            rows.append(row)
    else:
        row = {
            "severity": sev_val,
            "occurred_at": occurred_at,
        }
        if payload.note is not None:
            row["note"] = payload.note
        rows.append(row)

    repo.store_symptom(sub, rows)
    return {"stored": True}


def _distinct_events(symptom_rows: list[dict]) -> int:
    """One "Record symptom" save writes one row per selected symptom (§ symptom_type is a
    single column), so events are counted by their shared instant, not by row count."""
    return len({r.get("occurred_at") for r in symptom_rows})


def _symptom_times(symptom_rows: list[dict]) -> list:
    return sorted({parse_timestamp(r["occurred_at"]) for r in symptom_rows if r.get("occurred_at")})


@router.get("/devices/{device_id}/daily-summary")
def device_daily_summary(device_id: str, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    now = now_utc()
    readings = repo.get_recent_readings(device_id, hours=24)
    symptoms = repo.get_symptoms(sub, now - timedelta(hours=24))
    return analytics.daily_summary(readings, _distinct_events(symptoms))


@router.get("/devices/{device_id}/exposure-timeline")
def device_exposure_timeline(device_id: str, hours: int = Query(24, ge=1, le=24 * 7)) -> dict:
    readings = repo.get_recent_readings(device_id, hours=hours)
    return {"device_id": device_id, "hours": hours, "events": analytics.timeline(readings)}


@router.get("/devices/{device_id}/exposure-timeline/{event_id}")
def device_exposure_event(device_id: str, event_id: str, hours: int = Query(24, ge=1, le=24 * 7)) -> dict:
    detail = analytics.segment_detail(repo.get_recent_readings(device_id, hours=hours), event_id)
    if detail is None:
        raise HTTPException(404, "exposure period not found in the requested window")
    return detail


@router.get("/devices/{device_id}/weekly")
def device_weekly(device_id: str, days: int = Query(7, ge=1, le=30)) -> dict:
    now = now_utc()
    return analytics.weekly(repo.get_recent_readings(device_id, hours=days * 24), now, days)


@router.get("/devices/{device_id}/data-quality")
def device_data_quality(device_id: str) -> dict:
    now = now_utc()
    readings = repo.get_recent_readings(device_id, hours=6)
    quality = analytics.data_quality(readings, now)
    decision = evaluate_readings(readings, now, baseline_values=repo.get_baseline_values(device_id))
    return {**quality, "confidence": decision["confidence"], "decision_reasons": decision["reason_codes"]}


@router.get("/devices/{device_id}/baseline")
def device_baseline(device_id: str, user: dict = Depends(require_user)) -> dict:
    if not user.get("sub"):
        raise HTTPException(401, "token has no subject")
    values = repo.get_baseline_values(device_id)
    baseline = build_baseline(values)
    latest = repo.influx_query.latest_point(device_id)
    return {
        "ready": baseline.ready,
        "sample_count": baseline.sample_count,
        "median": baseline.median,
        "upper": baseline.upper,
        "current": (latest or {}).get("pm2_5"),
        "updated_at": (latest or {}).get("time"),
    }


@router.get("/devices/{device_id}/pattern")
def device_pattern(
    device_id: str, days: int = Query(30, ge=7, le=90), user: dict = Depends(require_user)
) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    now = now_utc()
    readings = repo.get_recent_readings(device_id, hours=days * 24)
    symptom_times = _symptom_times(repo.get_symptoms(sub, now - timedelta(days=days)))
    episodes = analytics.exposure_episode_starts(readings)
    pattern = detect_pattern(symptom_times, episodes)
    association = pattern.association
    return {
        "title": "Symptoms reported after elevated exposure",
        "condition": "within 6 hours of an elevated-exposure period",
        "event_count": len(symptom_times),
        "co_occurrence_count": round(association * pattern.sample_size) if association is not None else 0,
        "sample_size": pattern.sample_size,
        "association": association,
        "uncertainty": pattern.uncertainty,
        "sufficient": pattern.sufficient,
        "exposure_episode_count": len(episodes),
        "note": pattern.note,
    }


# ── Privacy / data rights (§7, §9) ───────────────────────────────────────────
class PrivacyPayload(BaseModel):
    sync_enabled: bool | None = None
    share_environmental: bool | None = None
    share_symptoms: bool | None = None
    location_sharing: str | None = None
    retention_days: int | None = None


@router.get("/privacy")
def get_privacy(user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return repo.get_privacy(sub)


@router.put("/privacy")
def put_privacy(payload: PrivacyPayload, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    changes = payload.model_dump(exclude_none=True)
    if changes.get("location_sharing") not in (None, "none", "coarse", "precise"):
        raise HTTPException(400, "location_sharing must be none|coarse|precise")
    if not changes:
        return repo.get_privacy(sub)
    changes["consented_at"] = now_utc().isoformat()
    return repo.upsert_privacy(sub, changes)


@router.get("/privacy/export")
def export_data(user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return {"exported_at": now_utc().isoformat(), "user_id": sub, "data": repo.export_user_data(sub)}


@router.post("/privacy/withdraw")
def withdraw_data(user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return {"withdrawn": True, "deleted": repo.delete_user_data(sub)}


# ── Device registry ──────────────────────────────────────────────────────────
class DevicePayload(BaseModel):
    external_id: str
    kind: str = "portable"
    label: str | None = None
    fw_version: str | None = None


@router.get("/me/devices")
def my_devices(user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return {"devices": repo.list_devices(sub)}


@router.post("/me/devices")
def register_device(payload: DevicePayload, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    if payload.kind not in ("portable", "station"):
        raise HTTPException(400, "kind must be portable|station")
    rows = repo.upsert_device(sub, payload.model_dump(exclude_none=True))
    return {"registered": True, "device": rows[0] if rows else None}
