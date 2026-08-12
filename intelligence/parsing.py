"""Parsing & unit conversion (TDD §10.1 "parser / unit conversion").

Turns a raw telemetry dict (Aeris contract §4) into a typed Reading, tolerating the
loose shapes real devices send. Parsing never invents values: anything missing or
unparseable becomes ``None`` so §5.1 can reject it — it must not silently default to 0.
"""
from __future__ import annotations

from datetime import UTC, datetime
from math import exp

from .models import Reading


def parse_timestamp(value) -> datetime:
    """Accept datetime or ISO-8601 string (with 'Z' or offset). Returns tz-aware UTC."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        s = value.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
    else:
        raise ValueError(f"unparseable timestamp: {value!r}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _num(value):
    """Best-effort float; None/"" and non-numeric -> None (never 0)."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_reading(payload: dict) -> Reading:
    """Parse an Aeris telemetry payload (§4) into a Reading.

    Raises ValueError only for a missing/invalid timestamp or device_id — those are
    structural, not sensor-quality, problems.
    """
    device_id = payload.get("device_id")
    if not device_id:
        raise ValueError("device_id is required")
    battery = payload.get("battery")
    try:
        battery = int(battery) if battery is not None else None
    except (TypeError, ValueError):
        battery = None
    return Reading(
        device_id=str(device_id),
        timestamp=parse_timestamp(payload["timestamp"]),
        pm25=_num(payload.get("pm25")),
        temperature=_num(payload.get("temperature")),
        humidity=_num(payload.get("humidity")),
        battery=battery,
        sensor_status=str(payload.get("sensor_status", "OK")),
        quality_score=_num(payload.get("quality_score")),
        schema_version=str(payload.get("schema_version", "1.0")),
    )


def c_to_f(celsius: float) -> float:
    return celsius * 9.0 / 5.0 + 32.0


def absolute_humidity(temp_c: float, rh_pct: float) -> float:
    """g/m³ from temperature (°C) and relative humidity (%). Matches the AirSentinel
    SGP30 compensation formula so device and backend agree."""
    return (
        216.7
        * (rh_pct / 100.0 * 6.112 * exp(17.67 * temp_c / (temp_c + 243.5)))
        / (temp_c + 273.15)
    )
