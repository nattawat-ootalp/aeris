"""Ingestion HTTP surface — two transports, one validation layer.

- Station: `POST /webhook/telemetry` (HiveMQ webhook, HMAC-signed raw body)
- Portable: `POST /ingest/portable` (phone gateway over HTTPS)
- Alerts:  `POST /webhook/alert`

Both telemetry paths: parse → adapt to a Reading → SHARED validate (§5.1) → store. An invalid
PM reading is still recorded (flagged) but never yields a PM value or a PM-based caution.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request

from . import adapters, writers
from .hmac_util import verify_signature
from .schemas import AlertPayload, PortableTelemetry, StationTelemetry
from .validate import validate

log = logging.getLogger("aeris.ingestion")
router = APIRouter(tags=["ingestion"])


def _ingest_reading(reading, source: str) -> dict:
    quality = validate(reading)
    # store time-series (pm25 only if valid) + keep the device registry fresh
    writers.write_reading(reading, quality, source)
    writers.upsert_device(reading, source)
    return {
        "accepted": True,
        "device_id": reading.device_id,
        "source": source,
        "pm25_valid": quality.pm25_valid,
        "usable": quality.usable,
        "quality_score": quality.quality_score,
        "reasons": quality.reasons,
    }


@router.post("/ingest/portable")
async def ingest_portable(payload: PortableTelemetry) -> dict:
    reading = adapters.portable_to_reading(payload)
    return _ingest_reading(reading, "portable")


@router.post("/webhook/telemetry")
async def webhook_telemetry(request: Request) -> dict:
    raw = await request.body()
    if not verify_signature(raw, request.headers.get("X-Signature")):
        return {"accepted": False, "error": "invalid signature"}
    payload = StationTelemetry.model_validate_json(raw)
    reading = adapters.station_to_reading(payload)
    return _ingest_reading(reading, "station")


@router.post("/webhook/alert")
async def webhook_alert(request: Request) -> dict:
    raw = await request.body()
    if not verify_signature(raw, request.headers.get("X-Signature")):
        return {"accepted": False, "error": "invalid signature"}
    alert = AlertPayload.model_validate_json(raw)
    # environmental/device alert (NOT a medical event) — persisted to the reused alert table
    from . import supa
    try:
        supa.sb_post("alert_events", alert.model_dump())
    except Exception as e:  # noqa: BLE001
        log.warning("alert store failed: %s", e)
        return {"accepted": False, "error": "store failed"}
    return {"accepted": True, "node_id": alert.node_id, "sensor": alert.sensor}
