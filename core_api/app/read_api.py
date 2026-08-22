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
from intelligence.exposure import aggregate_exposure
from intelligence.humidity import correct_pm25_for_humidity
from intelligence.parsing import parse_timestamp
from intelligence.pattern import detect_pattern
from intelligence.predict import forecast_pm25
from intelligence.risk import compute_risk

from . import analytics, repo
from .decision_service import evaluate_readings
from .destination import assess_destination
from .influx_query import now_utc
from .security import optional_user, require_user

router = APIRouter(tags=["core"])

# Decision -> the closed watch vocabulary (TDD §7). "SAFE" does not exist by construction.
WATCH_BY_DECISION = {
    "NORMAL": "Normal",
    "CAUTION": "Caution",
    "HIGH": "High",
    "NO_DATA": "No Data",
}


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
def device_decision(device_id: str, user: dict | None = Depends(optional_user)) -> dict:
    # The token is optional: this endpoint answers for public station ids too. It is read only
    # to pool the caller's own devices into their baseline (repo.baseline_device_ids), so a
    # replaced portable does not reset the personal reference range; an anonymous caller still
    # gets the plain single-device answer.
    now = now_utc()
    readings = repo.get_recent_readings(device_id)
    baseline_values = repo.get_baseline_values(device_id, user_sub=(user or {}).get("sub"))
    contract = evaluate_readings(readings, now, baseline_values=baseline_values)
    # Additive annotation only. The RH correction is uncalibrated and ships disabled, so with
    # the flag off this block reports the raw value back with a RH_CORRECTION_DISABLED reason
    # and every existing field — `pm25` above all — is exactly what it was before (§5.1
    # companion; see intelligence/humidity.py for why it is not applied to `pm25` itself).
    contract["pm25_rh_correction"] = correct_pm25_for_humidity(
        contract.get("pm25"), contract.get("humidity")
    ).to_payload()
    return contract


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
        # How many of the user's own readings a personal baseline needs before it exists. The
        # decision carries `sample_size` — how many it has — and without the target beside it
        # that number is unreadable: "3" says nothing about whether 3 is nearly enough or
        # nowhere near. Published for the same reason as the thresholds: so the client shows
        # the boundary the backend actually applies rather than a copy that can drift.
        "baseline_min_samples": CONFIG.baseline_min_samples,
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
    # The user reporting that they used their inhaler. Recorded as diary context only —
    # Aeris never advises for or against using it (TDD §1.2/§14).
    inhaler_used: bool = False


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
            if payload.inhaler_used:
                row["inhaler_used"] = True
            rows.append(row)
    else:
        row = {
            "severity": sev_val,
            "occurred_at": occurred_at,
        }
        if payload.note is not None:
            row["note"] = payload.note
        if payload.inhaler_used:
            row["inhaler_used"] = True
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
def device_data_quality(device_id: str, user: dict | None = Depends(optional_user)) -> dict:
    now = now_utc()
    readings = repo.get_recent_readings(device_id, hours=6)
    quality = analytics.data_quality(readings, now)
    baseline_values = repo.get_baseline_values(device_id, user_sub=(user or {}).get("sub"))
    decision = evaluate_readings(readings, now, baseline_values=baseline_values)
    return {**quality, "confidence": decision["confidence"], "decision_reasons": decision["reason_codes"]}


@router.get("/devices/{device_id}/baseline")
def device_baseline(device_id: str, user: dict = Depends(require_user)) -> dict:
    if not user.get("sub"):
        raise HTTPException(401, "token has no subject")
    values = repo.get_baseline_values(device_id, user_sub=user["sub"])
    baseline = build_baseline(values)
    latest = repo.influx_query.latest_point(device_id)
    return {
        "ready": baseline.ready,
        "sample_count": baseline.sample_count,
        # The threshold the engine actually applies, so the app can show progress towards it
        # rather than an unqualified "not enough yet". Sent as data, not duplicated in the
        # client, because it is configurable (BASELINE_MIN_SAMPLES) and a hardcoded copy would
        # quietly start lying the first time it is tuned.
        "min_samples": CONFIG.baseline_min_samples,
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


# ── Personalized risk score (§5.9) ───────────────────────────────────────────
@router.get("/devices/{device_id}/risk")
def device_risk(
    device_id: str,
    hours: int = Query(6, ge=1, le=72),
    user: dict = Depends(require_user),
) -> dict:
    """One systemic risk indicator built from this user's own exposure and history.

    Requires auth because it reads private symptom history. When the current data cannot pass
    the §5.1 gate the answer is NO_DATA with reasons — never a low score.
    """
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")

    now = now_utc()
    readings = repo.get_recent_readings(device_id, hours=hours)
    quality = analytics.data_quality(readings, now)
    points = analytics.valid_points(readings)
    window = aggregate_exposure(points, CONFIG)
    baseline = build_baseline(repo.get_baseline_values(device_id, user_sub=sub))
    symptom_rows = repo.get_symptoms(sub, now - timedelta(seconds=CONFIG.risk_history_window_sec))

    result = compute_risk(
        now=now,
        usable=bool(quality.get("usable")),
        freshness_sec=quality.get("freshness_sec"),
        window=window,
        baseline=baseline,
        symptom_times=_symptom_times(symptom_rows),
        quality_reasons=list(quality.get("reasons") or []),
    )
    return {
        "device_id": device_id,
        "score": result.score,
        "decision": str(result.decision),
        "watch_label": WATCH_BY_DECISION[str(result.decision)],
        "confidence": str(result.confidence),
        "reason_codes": result.reason_codes,
        "sample_size": result.sample_size,
        "components": result.components,
        "freshness_sec": quality.get("freshness_sec"),
        "note": result.note,
    }


# ── Predictive alert (§5.10) ─────────────────────────────────────────────────
@router.get("/devices/{device_id}/forecast")
def device_forecast(
    device_id: str,
    horizon_min: int = Query(20, ge=5, le=60),
) -> dict:
    """Short-horizon projection of environmental PM2.5 for this device.

    Public like the other environmental reads — it contains no health data. Returns
    ``available: false`` with a reason whenever the recent series cannot support a projection.
    """
    now = now_utc()
    readings = repo.get_recent_readings(device_id, hours=2)
    f = forecast_pm25(
        analytics.valid_points(readings), now=now, horizon_sec=horizon_min * 60, cfg=CONFIG
    )
    return {
        "device_id": device_id,
        "available": f.available,
        "horizon_sec": f.horizon_sec,
        "projected_pm25": f.projected_pm25,
        "uncertainty": f.uncertainty,
        "trend_per_hour": f.trend_per_hour,
        "decision": str(f.decision),
        "watch_label": WATCH_BY_DECISION[str(f.decision)],
        "confidence": str(f.confidence),
        "reason_codes": f.reason_codes,
        "sample_size": f.sample_size,
        "note": f.note,
    }


# ── Asthma action plan (user/clinician authored) ─────────────────────────────
class ActionPlanPayload(BaseModel):
    author: str | None = None
    clinician_name: str | None = None
    reviewed_at: str | None = None
    normal_steps: list[str] | None = None
    caution_steps: list[str] | None = None
    high_steps: list[str] | None = None
    emergency_steps: list[str] | None = None
    notes: str | None = None


@router.get("/me/action-plan")
def get_my_action_plan(user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return repo.get_action_plan(sub)


@router.put("/me/action-plan")
def put_action_plan(payload: ActionPlanPayload, user: dict = Depends(require_user)) -> dict:
    """Store the plan exactly as the user or their clinician wrote it.

    Aeris never authors, reorders, or completes care steps — it is storage and display only
    (TDD §1.2/§14), so the payload is written through unchanged apart from the author check.
    """
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    changes = payload.model_dump(exclude_none=True)
    if changes.get("author") not in (None, "user", "clinician"):
        raise HTTPException(400, "author must be user|clinician")
    if not changes:
        return repo.get_action_plan(sub)
    return repo.upsert_action_plan(sub, changes)


# ── Emergency contacts + SOS flow ────────────────────────────────────────────
class ContactPayload(BaseModel):
    name: str
    phone: str | None = None
    relationship: str | None = None
    notify_on_sos: bool = True
    sort_order: int = 0


@router.get("/me/contacts")
def my_contacts(user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return {"contacts": repo.list_contacts(sub)}


@router.post("/me/contacts")
def add_contact(payload: ContactPayload, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    rows = repo.add_contact(sub, payload.model_dump(exclude_none=True))
    return {"added": True, "contact": rows[0] if rows else None}


@router.delete("/me/contacts/{contact_id}")
def remove_contact(contact_id: str, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    repo.delete_contact(sub, contact_id)
    return {"deleted": True, "id": contact_id}


class SosPayload(BaseModel):
    source: str = "app"
    device_id: str | None = None
    occurred_at: str | None = None
    lat: float | None = None
    lon: float | None = None
    location_accuracy_m: float | None = None
    note: str | None = None


@router.post("/sos")
def raise_sos(payload: SosPayload, user: dict = Depends(require_user)) -> dict:
    """Record an SOS the user raised, and return their own plan and contacts.

    Two rules are enforced here rather than trusted to the client:
      * location is stored only if the user's privacy setting allows it — 'none' drops the
        coordinates entirely, 'coarse' rounds them to a ~1 km grid before storage;
      * Aeris makes no judgement about the event and contacts nobody automatically. It returns
        the contacts the user marked notify_on_sos so the user can place the call themselves.
    """
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    if payload.source not in ("app", "portable"):
        raise HTTPException(400, "source must be app|portable")

    privacy = repo.get_privacy(sub)
    sharing = privacy.get("location_sharing", "none")
    lat, lon, accuracy = payload.lat, payload.lon, payload.location_accuracy_m
    if sharing == "none":
        lat = lon = accuracy = None
    elif sharing == "coarse" and lat is not None and lon is not None:
        lat, lon = round(lat, 2), round(lon, 2)
        accuracy = None

    event = {
        "source": payload.source,
        "occurred_at": payload.occurred_at or now_utc().isoformat(),
        "lat": lat,
        "lon": lon,
        "location_accuracy_m": accuracy,
    }
    if payload.device_id:
        event["device_id"] = payload.device_id
        latest = repo.influx_query.latest_point(payload.device_id)
        if latest and latest.get("pm2_5") is not None:
            event["pm25"] = latest["pm2_5"]
    if payload.note is not None:
        event["note"] = payload.note

    contacts = [c for c in repo.list_contacts(sub) if c.get("notify_on_sos")]
    event["notified_contacts"] = 0                   # nothing is sent on the user's behalf
    rows = repo.store_sos(sub, event)
    return {
        "recorded": True,
        "event": rows[0] if rows else event,
        "location_stored": lat is not None,
        "location_sharing": sharing,
        "contacts": contacts,
        "action_plan": repo.get_action_plan(sub),
        "note": (
            "Aeris recorded this event and is showing your own plan and contacts. It does not "
            "assess medical emergencies and does not contact anyone for you."
        ),
    }


@router.get("/me/sos")
def my_sos_events(limit: int = Query(20, ge=1, le=100), user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return {"events": repo.get_sos_events(sub, limit)}
