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
    battery: int | None = None
    sensor_status: str = "OK"
    quality_score: float | None = None


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
