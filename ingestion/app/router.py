"""Ingestion HTTP surface — two transports, one validation layer.

- Station: `POST /webhook/telemetry` (HiveMQ webhook, HMAC-signed raw body)
- Portable: `POST /ingest/portable` (phone gateway over HTTPS)
- Alerts:  `POST /webhook/alert`

Both telemetry paths: parse → adapt to a Reading → SHARED validate (§5.1) → store. An invalid
PM reading is still recorded (flagged) but never yields a PM value or a PM-based caution. A
reading whose device clock has not synced, or one the time-series refuses, is answered with
``accepted: false`` and a reason — never a bare 500.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request

from . import adapters, writers
from .hmac_util import verify_signature
from .schemas import AlertPayload, PortableTelemetry, StationTelemetry
from .validate import validate

log = logging.getLogger("aeris.ingestion")
router = APIRouter(tags=["ingestion"])

# A device whose clock has not synced sends an epoch timestamp — the station firmware emits
# 1970-01-01 when NTP has not answered yet. Such a point is outside the bucket's retention,
# so InfluxDB rejects the write with HTTP 400 and the whole request used to fail as a 500 with
# no hint of why. Reject it here with a reason instead. The timestamp is NEVER replaced with
# server time: that would invent a freshness the reading does not have.
_CLOCK_FLOOR = datetime(2020, 1, 1, tzinfo=UTC)
_CLOCK_SKEW_AHEAD = timedelta(hours=1)


def _clock_is_plausible(ts: datetime, now: datetime | None = None) -> bool:
    now = now or datetime.now(UTC)
    return _CLOCK_FLOOR <= ts <= now + _CLOCK_SKEW_AHEAD


def _ingest_reading(reading, source: str) -> dict:
    if not _clock_is_plausible(reading.timestamp):
        log.warning(
            "%s reading from %s rejected: device clock unsynced (ts=%s)",
            source,
            reading.device_id,
            reading.timestamp.isoformat(),
        )
        return {
            "accepted": False,
            "device_id": reading.device_id,
            "source": source,
            "error": "CLOCK_UNSYNCED",
            "reasons": ["CLOCK_UNSYNCED"],
            "timestamp": reading.timestamp.isoformat(),
        }
    quality = validate(reading)
    # store time-series (pm25 only if valid) + keep the device registry fresh
    try:
        writers.write_reading(reading, quality, source)
    except Exception as e:  # noqa: BLE001 — surface the cause; a 500 tells the sender nothing
        log.error("store failed for %s (%s): %s", reading.device_id, source, e)
        return {
            "accepted": False,
            "device_id": reading.device_id,
            "source": source,
            "error": "STORE_FAILED",
            "reasons": ["STORE_FAILED"],
        }
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
