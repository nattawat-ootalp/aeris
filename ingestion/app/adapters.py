"""Normalize each transport's payload into a single intelligence.Reading.

This is the only place the two transports differ. Everything after this — quality gating,
decision, storage — is identical, satisfying the TDD rule that portable and station share one
validation layer and differ only in transport.
"""
from __future__ import annotations

from intelligence.models import Reading
from intelligence.parsing import parse_reading, parse_timestamp

from .schemas import PortableTelemetry, StationTelemetry


def _sensor_num(sensors: dict, key: str):
    """A station sensor value may be a bare number or an AirSentinel {value,unit,status} object."""
    v = sensors.get(key)
    if isinstance(v, dict):
        v = v.get("value")
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def portable_to_reading(p: PortableTelemetry) -> Reading:
    # the Aeris flat contract maps 1:1 to parse_reading
    return parse_reading(p.model_dump())


def station_to_reading(s: StationTelemetry) -> Reading:
    pm25 = _sensor_num(s.sensors, "pm2_5")
    return Reading(
        device_id=s.node_id,
        timestamp=parse_timestamp(s.timestamp),
        pm25=pm25,
        temperature=_sensor_num(s.sensors, "temp"),
        humidity=_sensor_num(s.sensors, "hum"),
        battery=s.device_health.battery_pct,
        # station has no per-sample status flag; treat a present, numeric PM as OK and let
        # §5.1 reject missing/impossible values. Never fabricate a value.
        sensor_status="OK" if pm25 is not None else "ERROR",
        quality_score=None,
        schema_version=s.schema_version,
    )
