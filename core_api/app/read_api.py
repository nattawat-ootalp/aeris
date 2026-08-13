"""Core read/decision API (TDD §8 + Aeris additions).

Public reads (telemetry/history/destination/decision) need no auth; writes that touch private
health data (symptom log) require a JWT. Destination + decision reuse the pure logic modules;
data access goes through ``repo`` so it can be mocked in tests.
"""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from . import repo
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
    severity: str = "mild"
    note: str | None = None
    timestamp: str | None = None


@router.post("/symptoms")
def log_symptom(payload: SymptomPayload, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    # private health event — stored under the owner; RLS keeps it out of any public view
    repo.store_symptom(sub, payload.model_dump(exclude_none=True))
    return {"stored": True}
