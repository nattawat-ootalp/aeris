"""Persist a validated reading — InfluxDB (time-series) + Supabase (relational).

# ingestion pattern reused from AirSentinel (validate → write InfluxDB + Supabase), extended
with Aeris fields (quality_score, sensor_status, pm25_valid). Clients are created lazily so
importing this module never opens a network connection (keeps unit tests offline).
"""
from __future__ import annotations

import logging

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from intelligence.models import QualityResult, Reading

from . import supa
from .config import settings

log = logging.getLogger("aeris.ingestion")

_influx: InfluxDBClient | None = None


def _write_api():
    global _influx
    if _influx is None:
        _influx = InfluxDBClient(
            url=settings.INFLUXDB_URL,
            token=settings.INFLUXDB_TOKEN,
            org=settings.INFLUXDB_ORG,
        )
    return _influx.write_api(write_options=SYNCHRONOUS)


def _fields(reading: Reading, quality: QualityResult) -> dict:
    """Only non-None numeric fields (InfluxDB rejects nulls). pm25 is written ONLY when valid,
    so an invalid sensor never lands a bogus PM value in the time series."""
    f: dict[str, float] = {}
    if quality.pm25_valid and reading.pm25 is not None:
        f["pm2_5"] = float(reading.pm25)
    if reading.temperature is not None:
        f["temperature"] = float(reading.temperature)
    if reading.humidity is not None:
        f["humidity"] = float(reading.humidity)
    if reading.battery is not None:
        f["battery"] = float(reading.battery)
    # SGP30 context (optional hardware) — written only when present; a missing/invalid sensor
    # must never fabricate a 0. eco2 is a VOC-derived estimate, not a true CO2 measurement.
    if reading.tvoc is not None:
        f["tvoc"] = float(reading.tvoc)
    if reading.eco2 is not None:
        f["eco2"] = float(reading.eco2)
    f["quality_score"] = float(quality.quality_score)
    f["pm25_valid"] = 1.0 if quality.pm25_valid else 0.0
    return f


def write_reading(reading: Reading, quality: QualityResult, source: str) -> None:
    """source = 'portable' | 'station'. Reuses the AirSentinel `air_quality` measurement."""
    point = (
        Point("air_quality")
        .tag("device_id", reading.device_id)
        .tag("source", source)
        .tag("sensor_status", reading.sensor_status or "OK")
        .time(reading.timestamp, WritePrecision.S)
    )
    for k, v in _fields(reading, quality).items():
        point = point.field(k, v)
    _write_api().write(bucket=settings.INFLUXDB_BUCKET, record=point)


def upsert_device(reading: Reading, source: str) -> None:
    """Keep a lightweight device registry row (idempotent). Best-effort; ingestion of
    telemetry must not fail just because the registry write did."""
    try:
        supa.sb_post(
            "devices",
            {
                "device_id": reading.device_id,
                "source": source,
                "last_seen_at": reading.timestamp.isoformat(),
            },
        )
    except Exception as e:  # noqa: BLE001 — registry is non-critical to ingestion
        log.warning("device upsert failed for %s: %s", reading.device_id, e)


def store_decision_event(device_id: str, event: dict) -> None:
    """Persist an explainable decision (§4.1/§5.8) to Supabase `decision_events`."""
    supa.sb_post(
        "decision_events",
        {
            "device_id": device_id,
            "decision": event.get("decision"),
            "confidence": event.get("confidence"),
            "reason_codes": event.get("reason_codes"),
            "freshness_sec": event.get("freshness_sec"),
            "sample_size": event.get("sample_size"),
        },
    )
