"""Ingestion payload schemas — two transports, one downstream validation layer.

Portable follows the Aeris data contract (TDD §4). Station reuses the AirSentinel 1.2 shape
so existing nodes need no firmware change. Both are normalized to an intelligence.Reading by
``adapters.py`` and then gated by the SAME ``validate.py``.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


# ── Portable (Aeris §4) — from phone gateway over HTTPS ──
class PortableTelemetry(BaseModel):
    schema_version: str = "1.0"
    device_id: str
    timestamp: str
    pm25: float | None = None
    temperature: float | None = None
    humidity: float | None = None
    # SCD40 — a TRUE CO2 measurement (NDIR), ppm. Absent when the SCD40 is invalid.
    # Deliberately a separate field from `eco2` below; the two must never be merged.
    co2: float | None = None
    battery: int | None = None
    sensor_status: str = "OK"
    quality_score: float | None = None
    # SGP30 (optional hardware) — absent entirely when the sensor is invalid/warming up.
    # Absent means "no data"; never coerce a missing value to 0.
    tvoc: float | None = None   # Total VOC, ppb
    eco2: float | None = None   # VOC-derived CO2-equivalent ESTIMATE, ppm — NOT a true CO2
    # measurement (the SCD40 measures real CO2).


# Upper bound on one batch. A portable buffers at 5 s/sample, so 500 covers ~40 min of
# backlog in a single request; a longer outage simply drains over several requests. The cap
# exists so one client cannot hold a worker for an unbounded time.
PORTABLE_BATCH_MAX = 500


class PortableTelemetryBatch(BaseModel):
    """A replayed backlog from the phone gateway (`POST /ingest/portable/batch`).

    Each entry is an ordinary ``PortableTelemetry`` carrying the timestamp it was CAPTURED at,
    not the time it was uploaded — the whole point of the buffer is that a sample keeps its own
    moment. Ordered oldest-first by convention; the server does not rely on that.
    """

    schema_version: str = "1.0"
    readings: list[PortableTelemetry] = Field(default_factory=list, max_length=PORTABLE_BATCH_MAX)


# ── Station (AirSentinel 1.2) — from HiveMQ webhook ──
class LocationPayload(BaseModel):
    lat: float = 0.0
    lon: float = 0.0
    alt: float = 0.0
    zone: str = ""


class EdgeInference(BaseModel):
    aqi_class: str = "Unknown"
    anomaly_detected: bool = False
    model_version: str = "1.0.0"


class DeviceHealth(BaseModel):
    battery_pct: int = 100
    rssi: int = -50
    uptime_sec: int = 0
    fw_version: str = "1.0.0"


class StationTelemetry(BaseModel):
    schema_version: str = "1.2"
    org: str
    node_id: str
    timestamp: str
    location: LocationPayload = Field(default_factory=LocationPayload)
    sensors: dict = Field(default_factory=dict)  # pm2_5, pm10, co2, tvoc, temp, hum
    edge_inference: EdgeInference = Field(default_factory=EdgeInference)
    device_health: DeviceHealth = Field(default_factory=DeviceHealth)


class AlertPayload(BaseModel):
    org: str
    node_id: str
    sensor: str
    value: float
    threshold: float
    standard: str = ""
    severity: str = "warning"
    is_anomaly: bool = False
    timestamp: str
