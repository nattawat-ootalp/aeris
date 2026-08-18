"""Ingestion HTTP surface — two transports, one validation layer.

- Station: `POST /webhook/telemetry` (HiveMQ webhook, HMAC-signed raw body)
- Portable: `POST /ingest/portable` (phone gateway over HTTPS)
- Portable backlog: `POST /ingest/portable/batch` (replay of samples the phone buffered
  while it could not reach the API — each keeps its own capture timestamp)
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

import observability

from . import adapters, writers
from .hmac_util import verify_signature
from .schemas import AlertPayload, PortableTelemetry, PortableTelemetryBatch, StationTelemetry
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


def _ingest_reading(reading, source: str, *, register_device: bool = True) -> dict:
    # Every outcome below is counted. The failures this system has actually had were all
    # silent — a station publishing into nothing, readings refused one at a time — and a
    # rejection that nobody can see is indistinguishable from a device that went quiet.
    tags = {"source": source, "device": reading.device_id}

    if not _clock_is_plausible(reading.timestamp):
        log.warning(
            "%s reading from %s rejected: device clock unsynced (ts=%s)",
            source,
            reading.device_id,
            reading.timestamp.isoformat(),
        )
        observability.metric("ingest.rejected", 1, {**tags, "reason": "clock_unsynced"})
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
        observability.metric("ingest.rejected", 1, {**tags, "reason": "store_failed"})
        return {
            "accepted": False,
            "device_id": reading.device_id,
            "source": source,
            "error": "STORE_FAILED",
            "reasons": ["STORE_FAILED"],
        }
    if register_device:
        writers.upsert_device(reading, source)

    observability.metric("ingest.accepted", 1, tags)
    observability.metric("ingest.pm25_valid", 1 if quality.pm25_valid else 0, tags)
    if quality.freshness_sec is not None:
        # The single most useful number here: how old the reading was when it arrived. A
        # station that stops publishing shows as this climbing, which is the alert that would
        # have caught every outage this system has had.
        observability.metric("ingest.reading_age_sec", quality.freshness_sec, tags)
    if reading.pm25 is not None and quality.pm25_valid:
        observability.metric("reading.pm25", reading.pm25, tags)

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


# Retrying a STORE_FAILED entry can succeed later; retrying a CLOCK_UNSYNCED one never can,
# because the fault is in the timestamp the sample carries. The phone needs to tell those apart
# to know what to keep in its outbox, so the reason travels back per entry.
_RETRYABLE_ERRORS = {"STORE_FAILED"}


@router.post("/ingest/portable/batch")
async def ingest_portable_batch(payload: PortableTelemetryBatch) -> dict:
    """Replay a phone's buffered backlog in one request.

    Same validation as the single-reading path — each entry goes through the identical §5.1
    gate and keeps its own capture timestamp, so a drained buffer lands as the history it
    actually was, not as a burst at the moment of upload. InfluxDB point identity is
    (measurement, tags, time), so re-sending an entry the server already stored overwrites it
    rather than duplicating it; a phone that never saw the response can safely retry.

    Only failures are itemised. The phone drops every entry the server did not mark retryable.
    """
    readings = [adapters.portable_to_reading(p) for p in payload.readings]
    # One registry upsert per device per batch instead of one per reading: 500 sequential
    # Supabase writes would dominate the request, and every one but the newest is stale anyway.
    last_index_for_device: dict[str, int] = {}
    for i, r in enumerate(readings):
        prev = last_index_for_device.get(r.device_id)
        if prev is None or r.timestamp >= readings[prev].timestamp:
            last_index_for_device[r.device_id] = i
    newest = set(last_index_for_device.values())

    failed: list[dict] = []
    stored = 0
    for i, reading in enumerate(readings):
        result = _ingest_reading(reading, "portable", register_device=i in newest)
        if result["accepted"]:
            stored += 1
            continue
        error = result.get("error", "UNKNOWN")
        failed.append({"index": i, "error": error, "retryable": error in _RETRYABLE_ERRORS})

    if failed:
        log.warning("portable batch: %d/%d stored, %d failed", stored, len(readings), len(failed))
    return {"accepted": True, "received": len(readings), "stored": stored, "failed": failed}


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
